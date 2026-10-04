import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, toHex, zeroHash } from "viem";

const sdkPath = process.env.SDK_SOURCE_TEST === "1" ? "../src/lifecycle/index.ts" : "../dist/lifecycle/index.js";
const { buildNextTransaction, buildPoolBoundHookDeploymentTransaction, createControlledLifecycleFork, decodeAbyssLifecycleMarketConfig, decodePoolBoundV4LifecycleMarketConfig, encodePoolBoundV4LifecycleMarketConfig, hashLaunchPlan, launchLifecycleAbi, lifecycleDirectoryAbi, lifecycleRegistryAbi, LifecycleFundingKind, LifecyclePhase, LifecycleRewardMode, lifecycleErc20Abi, parseLaunchPlan, planLaunch, predictLifecycleToken, preparePoolBoundLifecyclePlan, readLaunchProgress, readLifecycleProfiles, readPoolBoundHookDeployment, simulateLaunchPlan, V4_POOL_BOUND_LIFECYCLE_PROFILE_ID } = await import(sdkPath);
const enabled = Boolean(process.env.LAUNCH_LIFECYCLE_RPC_URL && process.env.LAUNCH_LIFECYCLE_FORK_RPC_URL && process.env.LAUNCH_LIFECYCLE_MANIFEST && process.env.LAUNCH_LIFECYCLE_FIXTURES && process.env.LAUNCH_LIFECYCLE_ALLOW_LOCAL_EXECUTION === "1");

test("real-AMM lifecycle planning, admission, sequential execution and canonical recovery", { skip: !enabled, concurrency: false }, async (t) => {
  const rpcUrl = process.env.LAUNCH_LIFECYCLE_RPC_URL;
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(rpcUrl).hostname), "Only disposable loopback execution is authorized");
  const manifest = JSON.parse(await readFile(process.env.LAUNCH_LIFECYCLE_MANIFEST, "utf8"));
  const exported = JSON.parse(await readFile(process.env.LAUNCH_LIFECYCLE_FIXTURES, "utf8"));
  const baseFixture = exported.fixtures.find((row) => row.name === "staged-erc20-q1");
  assert.ok(baseFixture, "Real Solidity-authored fixture required");
  const boundFixture = exported.poolBoundFixtures?.find((row) => row.name === "pool-bound-staged-erc20-q1");
  const boundMultiFixture = exported.poolBoundFixtures?.find((row) => row.name === "pool-bound-staged-erc20-q2");
  const boundOnlyFixture = exported.poolBoundFixtures?.find((row) => row.name === "pool-bound-only-staged-erc20-q2");
  assert.ok(boundFixture && boundMultiFixture && boundOnlyFixture, "Actual separately-nonced original mixed and additive V4-only Solidity-authored bound fixtures are required");
  let requestId = 0;
  const client = { async request({ method, params = [] }) {
    const response = await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }) });
    const body = await response.json();
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result;
  } };
  const chainId = BigInt(await client.request({ method: "eth_chainId" }));
  assert.equal(chainId, BigInt(manifest.chainId));
  const configured = manifest.executionLimits;
  assert.ok(configured?.provenance && exported.executionLimits?.provenance, "Actual reviewed operator policy with provenance is required");
  for (const [key, value] of Object.entries(exported.executionLimits)) assert.deepEqual(configured[key], value, `Fixture and manifest reviewed execution policy ${key}`);
  const limits = async ({ block, chainId, account, orchestrator }) => ({
    chainId, account, orchestrator, observedBlockNumber: block.number, observedBlockHash: block.hash,
    chainGasLimit: BigInt(configured.chainTransactionGasLimit) < block.gasLimit ? BigInt(configured.chainTransactionGasLimit) : block.gasLimit,
    rpcGasLimit: BigInt(configured.rpcTransactionGasLimit), accountGasLimit: BigInt(configured.accountTransactionGasLimit),
    maxCalldataBytes: configured.maxCalldataBytes, headroomBps: configured.headroomBps,
  });
  const fork = createControlledLifecycleFork({ sourceRpcUrl: rpcUrl, forkRpcUrl: process.env.LAUNCH_LIFECYCLE_FORK_RPC_URL, allowTransactions: true, impersonation: "anvil" });
  let planNonce = 50_000n;
  async function freshPlan(supply, rewardMode, selectedFixture = baseFixture) {
    const plan = parseLaunchPlan(JSON.stringify(selectedFixture.plan));
    if (supply !== undefined) plan.token.supply = supply;
    if (rewardMode !== undefined) {
      plan.token.rewardMode = rewardMode;
      // Reward-enabled plans require at least one nonzero rewardsBps share with
      // each fee asset's fractions still summing to 10000 (LaunchPlanValidatorV1
      // InvalidFeePolicy otherwise reverts at begin).
      plan.feeAssets = plan.feeAssets.map((policy) => ({ ...policy, ownerBps: rewardMode === LifecycleRewardMode.None ? 10000 : 8000, rewardsBps: rewardMode === LifecycleRewardMode.None ? 0 : 2000, burnBps: 0 }));
    }
    plan.nonce = ++planNonce;
    const oldToken = selectedFixture.predictedToken;
    const orientations = plan.markets.map((market) => BigInt(oldToken) < BigInt(market.quoteAsset));
    let token;
    for (let salt = 0n; salt < 4096n; salt += 1n) {
      plan.token.salt = keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [plan.nonce, salt]));
      token = await predictLifecycleToken({ client, plan });
      if (plan.markets.every((market, index) => (BigInt(token) < BigInt(market.quoteAsset)) === orientations[index])) break;
      token = undefined;
    }
    assert.ok(token, "Deterministic token orientation search must find a real compatible token");
    plan.feeAssets = plan.feeAssets.map((policy) => policy.asset.toLowerCase() === oldToken.toLowerCase() ? { ...policy, asset: token } : policy).sort((a, b) => BigInt(a.asset) < BigInt(b.asset) ? -1 : 1);
    return plan.markets.some((market) => market.configVersion === 3) ? (await preparePoolBoundLifecyclePlan({ client, plan })).plan : plan;
  }
  async function isolated(fn) {
    const snapshot = await client.request({ method: "evm_snapshot" });
    try { await fn(); }
    finally {
      assert.equal(await client.request({ method: "evm_revert", params: [snapshot] }), true);
      // Snapshot revert restores state but does not advance the head; mine one
      // explicit block so the next test's latest-block reads observe settled state.
      await client.request({ method: "evm_mine" });
    }
  }
  async function send(transaction) {
    const transactionHash = await client.request({ method: "eth_sendTransaction", params: [{ from: transaction.from, to: transaction.to, data: transaction.data, value: toHex(transaction.value), gas: toHex(transaction.gas), ...(transaction.gasPrice === undefined ? {} : { gasPrice: toHex(transaction.gasPrice) }) }] });
    let receipt = null;
    for (const deadline = Date.now() + 3_000; receipt === null && Date.now() < deadline;) {
      receipt = await client.request({ method: "eth_getTransactionReceipt", params: [transactionHash] });
      if (receipt === null) await new Promise((resolve) => globalThis.setTimeout(resolve, 25));
    }
    assert.ok(receipt, "Mined transaction receipt must appear within the local automine window");
    assert.equal(receipt.status, "0x1");
    return { transactionHash, observedBlockNumber: BigInt(receipt.blockNumber), observedBlockHash: receipt.blockHash, confirmations: 1 };
  }
  async function startStaged(plan) {
    const planned = await planLaunch({ client, plan, account: plan.creator, mode: "staged", limits, fork });
    assert.equal(planned.simulation.admitted, true, planned.simulation.reason);
    const receipts = [];
    for (let safety = 0; safety < 12; safety += 1) {
      const next = await buildNextTransaction({ client, planned, limits, fork, receipts });
      assert.ok(next);
      if (next.kind === "begin") return { planned, receipts, begin: next };
      assert.ok(["approve", "approve-reset"].includes(next.kind));
      receipts.push(await send(next));
    }
    throw new Error("Funding prerequisites never reached begin");
  }

  async function readContract(to, abi, functionName, args = []) {
    const data = encodeFunctionData({ abi, functionName, args });
    return decodeFunctionResult({ abi, functionName, data: await client.request({ method: "eth_call", params: [{ to, data }, "latest"] }) });
  }

  await t.test("both reusable shared and single-pool offerings are certified; an empty legacy topology selector never admits bound profiles", async () => isolated(async () => {
    const profiles = await readLifecycleProfiles({ client, orchestrator: manifest.addresses.orchestrator });
    const shared = profiles.find((profile) => profile.topology.hookTopology === 1);
    const bound = profiles.find((profile) => profile.id.toLowerCase() === V4_POOL_BOUND_LIFECYCLE_PROFILE_ID.toLowerCase());
    assert.equal(shared?.admitted, true);
    assert.equal(bound?.admitted, true);
    assert.equal(bound.topology.hookTopology, 2);
    assert.equal(bound.registration.hook, "0x0000000000000000000000000000000000000000");
    const registry = await readContract(manifest.addresses.orchestrator, launchLifecycleAbi, "registry");
    const selector = encodeFunctionData({ abi: lifecycleRegistryAbi, functionName: "profileTopology", args: [bound.id] }).slice(0, 10);
    const legacy = { request: (args) => args.method === "eth_call" && args.params?.[0]?.to.toLowerCase() === registry.toLowerCase() && args.params?.[0]?.data.startsWith(selector) ? Promise.resolve("0x") : client.request(args) };
    const legacyProfiles = await readLifecycleProfiles({ client: legacy, orchestrator: manifest.addresses.orchestrator, profileIds: [shared.id, bound.id] });
    assert.equal(legacyProfiles[0].admitted, true, "Known shared admission still rechecks the actual deployed immutable graph");
    assert.equal(legacyProfiles[1].admitted, false, "Code existence or a zero global hook cannot substitute for bound topology certification");
  }));

  await t.test("bound metadata accepts unmined bits while wallet admission requires exact bits and rejects a shared-profile masquerade", async () => isolated(async () => {
    const plan = await freshPlan(undefined, undefined, boundFixture);
    const market = plan.markets[0];
    const config = decodePoolBoundV4LifecycleMarketConfig(market.config);
    let badPlan;
    for (let salt = 0n; salt < 16n; salt += 1n) {
      const candidate = { ...plan, markets: plan.markets.map((item, index) => index === 0 ? { ...item, config: encodePoolBoundV4LifecycleMarketConfig({ ...config, hookSalt: toHex(salt, { size: 32 }) }) } : item) };
      const metadata = await readPoolBoundHookDeployment({ client, plan: candidate, marketIndex: 0 });
      if ((BigInt(metadata.predictedHook) & 0x3fffn) !== 0x1afcn) { badPlan = candidate; break; }
    }
    assert.ok(badPlan, "A wrong-bit candidate still provides exact metadata for offchain mining");
    const refused = await planLaunch({ client, plan: badPlan, account: plan.creator, mode: "staged", limits, fork });
    assert.equal(refused.simulation.admitted, false);
    await assert.rejects(buildNextTransaction({ client, planned: refused, limits, fork }), { code: "PLAN_NOT_ADMITTED" });
    const sharedProfile = baseFixture.plan.markets[0].profileId;
    const wrongProfile = { ...plan, markets: plan.markets.map((item, index) => index === 0 ? { ...item, profileId: sharedProfile } : item) };
    await assert.rejects(planLaunch({ client, plan: wrongProfile, account: plan.creator, mode: "staged", limits, fork }), { code: "INVALID_MARKET" });
  }));

  await t.test("bound mining is invalidated by concurrent economic edits, and stale reviewed economics cannot produce a wallet transaction", async () => isolated(async () => {
    const plan = await freshPlan(undefined, undefined, boundFixture);
    const draft = { ...plan, markets: plan.markets.map((market) => market.configVersion === 3 ? { ...market, config: encodePoolBoundV4LifecycleMarketConfig({ ...decodePoolBoundV4LifecycleMarketConfig(market.config), hookSalt: zeroHash }) } : market) };
    let edited = false;
    await assert.rejects(preparePoolBoundLifecyclePlan({ client, plan: draft, onProgress: () => {
      if (edited) return;
      edited = true;
      draft.markets = draft.markets.map((market, index) => index === 0 ? { ...market, tokenBudget: market.tokenBudget + 1n } : market);
    } }), { code: "PLAN_MUTATED" });
    const planned = await planLaunch({ client, plan, account: plan.creator, mode: "staged", limits, fork });
    assert.equal(planned.simulation.admitted, true, planned.simulation.reason);
    const changed = { ...planned, plan: { ...plan, markets: plan.markets.map((market, index) => index === 0 ? { ...market, tokenBudget: market.tokenBudget + 1n } : market) } };
    await assert.rejects(buildNextTransaction({ client, planned: changed, limits, fork }), { code: "PLAN_MUTATED" });
    const before = await readPoolBoundHookDeployment({ client, plan, marketIndex: 0 });
    const after = await readPoolBoundHookDeployment({ client, plan: changed.plan, marketIndex: 0 });
    assert.notEqual(after.initCodeHash, before.initCodeHash, "Even a one-unit budget change invalidates the mined initcode commitment");
    assert.notEqual(after.predictedHook.toLowerCase(), before.predictedHook.toLowerCase());
  }));

  await t.test("factory runtime drift invalidates mining and reviewed execution even when token and hook predictions remain unchanged", async () => isolated(async () => {
    const plan = await freshPlan(undefined, undefined, boundFixture);
    const planned = await planLaunch({ client, plan, account: plan.creator, mode: "staged", limits, fork });
    assert.equal(planned.simulation.admitted, true, planned.simulation.reason);
    const metadata = await readPoolBoundHookDeployment({ client, plan, marketIndex: 0 });
    const factoryCode = await client.request({ method: "eth_getCode", params: [planned.tokenFactory, "latest"] });
    let mutation;
    const miningClient = { async request(request) {
      if (request.method === "eth_getBlockByNumber" && request.params?.[0] === "latest" && mutation !== undefined) await mutation;
      return client.request(request);
    } };
    await assert.rejects(preparePoolBoundLifecyclePlan({ client: miningClient, plan, onProgress() {
      mutation ??= client.request({ method: "anvil_setCode", params: [planned.tokenFactory, `${factoryCode}00`] });
    } }), { code: "TOKEN_FACTORY_BINDING" });
    await mutation;
    assert.equal(await client.request({ method: "eth_getCode", params: [planned.tokenFactory, "latest"] }), `${factoryCode}00`, "Actual fork runtime changes without altering executable factory instructions");
    assert.equal(await predictLifecycleToken({ client, plan }), planned.predictedToken, "Unchanged CREATE2 prediction alone cannot certify unchanged factory provenance");
    assert.deepEqual(await readPoolBoundHookDeployment({ client, plan, marketIndex: 0 }), metadata);
    await assert.rejects(buildNextTransaction({ client, planned, limits, fork }), { code: "TOKEN_FACTORY_BINDING" });
  }));

  await t.test("mixed shared/bound V4 markets cannot bypass the one-quote rule with different roots or adapter IDs", async () => isolated(async () => {
    const plan = await freshPlan(undefined, undefined, boundFixture);
    const shared = { ...parseLaunchPlan(JSON.stringify(baseFixture.plan)).markets[0], quoteAsset: plan.markets[0].quoteAsset };
    const duplicate = { ...plan, markets: [shared, plan.markets[0]] };
    await assert.rejects(planLaunch({ client, plan: duplicate, account: plan.creator, mode: "staged", limits, fork }), { code: "DUPLICATE_V4_QUOTE" });
  }));

  await t.test("exact permissionless hook predeployment before token deployment is reusable, but changed runtime lacks factory provenance", async () => isolated(async () => {
    const plan = await freshPlan(undefined, undefined, boundFixture);
    const deployment = await buildPoolBoundHookDeploymentTransaction({ client, plan, marketIndex: 0 });
    const token = await predictLifecycleToken({ client, plan });
    assert.equal(await client.request({ method: "eth_getCode", params: [token, "latest"] }), "0x");
    const gasPrice = BigInt(await client.request({ method: "eth_gasPrice" }));
    const estimate = BigInt(await client.request({ method: "eth_estimateGas", params: [{ from: plan.creator, to: deployment.to, data: deployment.data, gasPrice: toHex(gasPrice) }] }));
    await send({ ...deployment, from: plan.creator, gas: estimate * 115n / 100n, gasPrice });
    const metadata = await readPoolBoundHookDeployment({ client, plan, marketIndex: 0 });
    assert.equal(metadata.predictedHook.toLowerCase(), deployment.deployment.predictedHook.toLowerCase());
    const { planned, receipts, begin } = await startStaged(plan);
    receipts.push(await send(begin));
    const prepare = await buildNextTransaction({ client, planned, receipts, limits, fork });
    assert.equal(prepare.kind, "prepare");
    receipts.push(await send(prepare));
    const progress = await readLaunchProgress({ client, planned, receipts });
    assert.equal(progress.markets[0].prepared.identity.hook.toLowerCase(), metadata.predictedHook.toLowerCase(), "Actual adapter preparation reuses exactly the proven CREATE2 hook");
    assert.deepEqual(await readPoolBoundHookDeployment({ client, plan, marketIndex: 0 }), metadata, "Prepared state does not make exact metadata unavailable");
    await client.request({ method: "anvil_setCode", params: [metadata.predictedHook, "0x60006000f3"] });
    await assert.rejects(readPoolBoundHookDeployment({ client, plan, marketIndex: 0 }), { code: "HOOK_DEPLOYMENT_CHANGED" });
  }));

  await t.test("an explicitly committed bound-only multipool companion also completes without replacing the original mixed launch", async () => isolated(async () => {
    const plan = await freshPlan(undefined, undefined, boundOnlyFixture);
    const planned = await planLaunch({ client, plan, account: plan.creator, mode: "staged", limits, fork });
    assert.equal(planned.simulation.admitted, true, planned.simulation.reason);
    const receipts = [];
    for (let safety = 0; safety < 24; safety += 1) {
      const next = await buildNextTransaction({ client, planned, receipts, limits, fork });
      if (next === undefined) break;
      receipts.push(await send(next));
    }
    const done = await readLaunchProgress({ client, planned, receipts });
    assert.equal(done.canonical.phase, LifecyclePhase.Active);
    assert.equal(done.canonical.marketCount, plan.markets.length);
    assert.equal(done.canonical.positionCount, plan.markets.reduce((count, market) => count + decodePoolBoundV4LifecycleMarketConfig(market.config).positions.length, 0));
  }));

  await t.test("the original mixed bound multipool launch activates every committed venue, quote, position and salt", async () => isolated(async () => {
    const plan = await freshPlan(undefined, undefined, boundMultiFixture);
    const planned = await planLaunch({ client, plan, account: plan.creator, mode: "staged", limits, fork });
    assert.equal(planned.simulation.admitted, true, planned.simulation.reason);
    assert.equal(planned.hookDeployments.length, 2);
    const receipts = [];
    for (let safety = 0; safety < 24; safety += 1) {
      const next = await buildNextTransaction({ client, planned, receipts, limits, fork });
      if (next === undefined) break;
      receipts.push(await send(next));
    }
    const done = await readLaunchProgress({ client, planned, receipts });
    assert.equal(done.canonical.phase, LifecyclePhase.Active);
    assert.equal(done.canonical.marketCount, plan.markets.length);
    assert.equal(done.canonical.positionCount, plan.markets.reduce((count, market) => count + (market.configVersion === 3 ? decodePoolBoundV4LifecycleMarketConfig(market.config) : decodeAbyssLifecycleMarketConfig(market.config)).positions.length, 0));
    for (const deployment of planned.hookDeployments) {
      const market = done.markets[deployment.marketIndex];
      assert.equal(market.prepared.identity.hook.toLowerCase(), deployment.predictedHook.toLowerCase());
      assert.equal(market.live.publicTrading, true);
      assert.deepEqual(await readPoolBoundHookDeployment({ client, plan, marketIndex: deployment.marketIndex }), { deployer: deployment.deployer, initCodeHash: deployment.initCodeHash, salt: deployment.salt, predictedHook: deployment.predictedHook });
    }
  }));

  await t.test("adapter dependency loss refuses bound continuation but does not strand exact adapter-free cancellation", async () => isolated(async () => {
    const plan = await freshPlan(undefined, undefined, boundFixture);
    const { planned, receipts, begin } = await startStaged(plan);
    receipts.push(await send(begin));
    const profile = planned.profiles.find((profile) => profile.topology.hookTopology === 2);
    await client.request({ method: "anvil_setCode", params: [profile.adapter.implementation, "0x"] });
    await assert.rejects(buildNextTransaction({ client, planned, receipts, limits, fork }), { code: "PLAN_NOT_ADMITTED" });
    const cancel = await buildNextTransaction({ client, planned, receipts, action: "cancel", limits, fork });
    assert.equal(cancel.kind, "cancel");
    receipts.push(await send(cancel));
    assert.equal((await readLaunchProgress({ client, planned, receipts })).canonical.phase, LifecyclePhase.Cancelled);
  }));

  await t.test("wrong chain/account and missing mode are refused before any execution", async () => isolated(async () => {
    const plan = await freshPlan();
    const foreignClient = { request: (args) => args.method === "eth_chainId" ? Promise.resolve(toHex(chainId + 1n)) : client.request(args) };
    await assert.rejects(planLaunch({ client: foreignClient, plan, account: plan.creator, mode: "atomic", limits, fork }), { code: "CHAIN_MISMATCH" });
    await assert.rejects(planLaunch({ client, plan, account: "0x0000000000000000000000000000000000000001", mode: "atomic", limits, fork }), { code: "ACCOUNT_MISMATCH" });
    await assert.rejects(planLaunch({ client, plan, account: plan.creator, limits, fork }), { code: "EXPLICIT_MODE_REQUIRED" });
  }));

  await t.test("unsupported sequential RPC is provisional, never dependent eth_call proof or executable admission", async () => isolated(async () => {
    const plan = await freshPlan();
    const noSimulation = { request: (args) => args.method === "eth_simulateV1" ? Promise.reject(new Error("Method not supported")) : client.request(args) };
    const planned = await planLaunch({ client: noSimulation, plan, account: plan.creator, mode: "staged", limits });
    assert.equal(planned.simulation.confidence, "provisional");
    assert.equal(planned.simulation.admitted, false);
    await assert.rejects(buildNextTransaction({ client: noSimulation, planned, limits }), { code: "PLAN_NOT_ADMITTED" });
    assert.equal(planned.progress.canonical.phase, LifecyclePhase.None);
  }));

  await t.test("stateful fork proof restores source nonce/balances and unknown caps still refuse submission", async () => isolated(async () => {
    const plan = await freshPlan();
    const nonce = await client.request({ method: "eth_getTransactionCount", params: [plan.creator, "latest"] });
    const balance = await client.request({ method: "eth_getBalance", params: [plan.creator, "latest"] });
    const unknown = await planLaunch({ client, plan, account: plan.creator, mode: "staged", fork });
    assert.equal(unknown.simulation.confidence, "stateful");
    assert.equal(unknown.simulation.admitted, false);
    assert.equal(unknown.simulation.limits.admissionKnown, false);
    await assert.rejects(buildNextTransaction({ client, planned: unknown, fork }), { code: "PLAN_NOT_ADMITTED" });
    assert.equal(await client.request({ method: "eth_getTransactionCount", params: [plan.creator, "latest"] }), nonce);
    assert.equal(await client.request({ method: "eth_getBalance", params: [plan.creator, "latest"] }), balance);
  }));

  await t.test("calldata admission and dynamic account caps are distinct boundaries", async () => isolated(async () => {
    const plan = await freshPlan();
    const valid = await planLaunch({ client, plan, account: plan.creator, mode: "staged", limits, fork });
    assert.equal(valid.simulation.admitted, true, valid.simulation.reason);
    const shortData = await planLaunch({ client, plan, account: plan.creator, mode: "staged", fork, limits: async (context) => ({ ...await limits(context), maxCalldataBytes: 32 }) });
    assert.equal(shortData.simulation.admitted, false);
    const tinyAccount = async (context) => ({ ...await limits(context), accountGasLimit: 30_000n });
    await assert.rejects(buildNextTransaction({ client, planned: valid, fork, limits: tinyAccount }), { code: "PLAN_NOT_ADMITTED" });
  }));

  await t.test("an explicit constrained-account atomic refusal never silently stages, while fresh staged consent completes the same economics", async () => isolated(async () => {
    const plan = await freshPlan();
    const constrainedAccount = async (context) => ({ ...await limits(context), accountGasLimit: 30_000n });
    const normal = await planLaunch({ client, plan, account: plan.creator, mode: "atomic", limits: constrainedAccount, fork });
    assert.equal(normal.simulation.admitted, false);
    assert.equal(normal.mode, "atomic");
    assert.equal(normal.planHash, hashLaunchPlan(plan));
    await assert.rejects(buildNextTransaction({ client, planned: normal, limits: constrainedAccount, fork }), { code: "PLAN_NOT_ADMITTED" });
    assert.equal((await readLaunchProgress({ client, planned: normal })).canonical.phase, LifecyclePhase.None);
    const staged = await planLaunch({ client, plan, account: plan.creator, mode: "staged", limits, fork });
    assert.equal(staged.planHash, normal.planHash);
    assert.equal(staged.mode, "staged");
    assert.equal(staged.transactions.at(-1).kind, "activate");
    assert.equal(staged.simulation.admitted, true, staged.simulation.reason);
    const receipts = [];
    for (let safety = 0; safety < 20; safety += 1) {
      const next = await buildNextTransaction({ client, planned: staged, receipts, limits, fork });
      if (next === undefined) break;
      receipts.push(await send(next));
    }
    const done = await readLaunchProgress({ client, planned: staged, receipts });
    assert.equal(done.canonical.phase, LifecyclePhase.Active);
    assert.equal(done.token, staged.predictedToken);
  }));

  for (const rewardMode of [LifecycleRewardMode.None, LifecycleRewardMode.Staking, LifecycleRewardMode.Dividends]) await t.test(`the exact ERC20 supply boundary for reward mode ${rewardMode} remains executable on the real stack`, async () => isolated(async () => {
    const plan = await freshPlan(rewardMode === LifecycleRewardMode.None ? (1n << 256n) - 1n : 10n ** 77n, rewardMode);
    const atomic = await planLaunch({ client, plan, account: plan.creator, mode: "atomic", limits, fork });
    const planned = await planLaunch({ client, plan, account: plan.creator, mode: "staged", limits, fork });
    assert.equal(planned.predictedToken, atomic.predictedToken);
    assert.equal(planned.simulation.admitted, true, planned.simulation.reason);
    const receipts = [];
    for (let safety = 0; safety < 20; safety += 1) {
      const next = await buildNextTransaction({ client, planned, receipts, limits, fork });
      if (next === undefined) break;
      receipts.push(await send(next));
    }
    assert.equal((await readLaunchProgress({ client, planned, receipts })).canonical.phase, LifecyclePhase.Active);
  }));

  await t.test("confirmed staged progress rejects same-nonce changed economics and retries only canonical unfinished steps", async () => isolated(async () => {
    const plan = await freshPlan();
    const { planned, receipts, begin } = await startStaged(plan);
    receipts.push(await send(begin));
    const begun = await readLaunchProgress({ client, planned, receipts });
    assert.equal(begun.canonical.phase, LifecyclePhase.Preparing);
    const changed = { ...plan, executorFeeBps: plan.executorFeeBps + 1 };
    await assert.rejects(planLaunch({ client, plan: changed, account: plan.creator, mode: "staged", limits, fork }), { code: "PLAN_REPLAY" });
    const recovered = await planLaunch({ client, plan, account: plan.creator, mode: "staged", limits, fork, receipts });
    assert.equal(recovered.transactions[0].kind, "prepare");
    assert.equal(recovered.transactions[0].marketStart, begun.canonical.preparedMarkets);
    assert.equal(recovered.progress.token, begun.token);
    const resimulated = await simulateLaunchPlan({ client, planned, limits, fork });
    assert.equal(resimulated.admitted, true, resimulated.reason);
    assert.ok(resimulated.steps.every((step) => !step.transactionId.startsWith("approve") && step.transactionId !== "begin"), "Resimulation must use canonical remaining work, not the cached full sequence");
  }));

  await t.test("untracked approvals and lifecycle commands wait for confirmation depth even after ref-free reload", async () => isolated(async () => {
    for (let block = 0; block < 3; block += 1) await client.request({ method: "evm_mine" });
    const plan = await freshPlan();
    const initial = await planLaunch({ client, plan, account: plan.creator, mode: "staged", limits, fork });
    const approval = await buildNextTransaction({ client, planned: initial, limits, fork });
    assert.equal(approval.kind, "approve");
    await send(approval);
    const waiting = await planLaunch({ client, plan, account: plan.creator, mode: "staged", confirmations: 3, limits, fork });
    assert.equal(waiting.progress.canonical.phase, LifecyclePhase.None);
    assert.equal(waiting.progress.head.phase, LifecyclePhase.None);
    assert.equal(waiting.progress.confirmationSafe, false, "Approval changes account nonce despite unchanged core progress");
    assert.equal(waiting.simulation.admitted, false);
    await assert.rejects(buildNextTransaction({ client, planned: waiting, limits, fork }), { code: "UNCONFIRMED_STATE" });
    await client.request({ method: "evm_mine" }); await client.request({ method: "evm_mine" });
    const confirmed = await planLaunch({ client, plan, account: plan.creator, mode: "staged", confirmations: 3, limits, fork });
    assert.equal(confirmed.simulation.admitted, true, confirmed.simulation.reason);
    const begin = await buildNextTransaction({ client, planned: confirmed, limits, fork });
    assert.equal(begin.kind, "begin"); await send(begin);
    const unconfirmed = await readLaunchProgress({ client, planned: confirmed });
    assert.equal(unconfirmed.canonical.phase, LifecyclePhase.None);
    assert.equal(unconfirmed.head.phase, LifecyclePhase.Preparing);
    await assert.rejects(buildNextTransaction({ client, planned: confirmed, limits, fork }), { code: "UNCONFIRMED_STATE" });
    await client.request({ method: "evm_mine" }); await client.request({ method: "evm_mine" });
    assert.equal((await buildNextTransaction({ client, planned: confirmed, limits, fork })).kind, "prepare");
  }));

  await t.test("stale block/account/core limit provenance cannot authorize submission", async () => isolated(async () => {
    const plan = await freshPlan();
    for (const mutate of [
      (current) => ({ ...current, observedBlockNumber: current.observedBlockNumber - 1n }),
      (current) => ({ ...current, observedBlockHash: `0x${"00".repeat(32)}` }),
      (current) => ({ ...current, chainId: current.chainId + 1n }),
      (current) => ({ ...current, account: "0x0000000000000000000000000000000000000001" }),
      (current) => ({ ...current, orchestrator: "0x0000000000000000000000000000000000000001" }),
    ]) {
      const stale = async (context) => mutate(await limits(context));
      const planned = await planLaunch({ client, plan, account: plan.creator, mode: "staged", limits: stale, fork });
      assert.equal(planned.simulation.admitted, false);
      assert.equal(planned.simulation.limits.admissionKnown, false);
      await assert.rejects(buildNextTransaction({ client, planned, limits: stale, fork }), { code: "PLAN_NOT_ADMITTED" });
    }
  }));

  await t.test("a reorged begin receipt never advances progress or changes deterministic token identity", async () => isolated(async () => {
    const plan = await freshPlan();
    const { planned, receipts, begin } = await startStaged(plan);
    const beforeBegin = await client.request({ method: "evm_snapshot" });
    const mined = await send(begin);
    receipts.push(mined);
    assert.equal((await readLaunchProgress({ client, planned, receipts })).canonical.phase, LifecyclePhase.Preparing);
    assert.equal(await client.request({ method: "evm_revert", params: [beforeBegin] }), true);
    await client.request({ method: "evm_mine" });
    const recovered = await readLaunchProgress({ client, planned, receipts });
    assert.equal(recovered.receipts.at(-1).status, "reorged");
    assert.equal(recovered.canonical.phase, LifecyclePhase.None);
    assert.equal(recovered.token, planned.predictedToken);
    assert.equal((await buildNextTransaction({ client, planned, receipts, limits, fork })).kind, "begin");
  }));

  for (const cancelled of [false, true]) await t.test(cancelled ? "replacement cancellation never counts as launch completion" : "a same-nonce replacement receipt recovers canonical launch completion", async () => isolated(async () => {
    const plan = await freshPlan();
    const { planned, receipts, begin } = await startStaged(plan);
    const nonce = await client.request({ method: "eth_getTransactionCount", params: [plan.creator, "pending"] });
    const price = BigInt(await client.request({ method: "eth_gasPrice" }));
    await client.request({ method: "evm_setAutomine", params: [false] });
    try {
      const original = await client.request({ method: "eth_sendTransaction", params: [{ from: begin.from, to: begin.to, data: begin.data, value: toHex(begin.value), gas: toHex(begin.gas), nonce, gasPrice: toHex(price) }] });
      const replacement = await client.request({ method: "eth_sendTransaction", params: [{ from: begin.from, to: cancelled ? begin.from : begin.to, data: cancelled ? "0x" : begin.data, value: cancelled ? "0x0" : toHex(begin.value), gas: cancelled ? toHex(21000n) : toHex(begin.gas), nonce, gasPrice: toHex(price * 2n + 1n) }] });
      await client.request({ method: "evm_mine" });
      receipts.push({ transactionHash: original, replacementHash: replacement, confirmations: 1 });
      const progress = await readLaunchProgress({ client, planned, receipts });
      assert.equal(progress.receipts.at(-1).replaced, true);
      assert.equal(progress.receipts.at(-1).status, cancelled ? "replacement-cancelled" : "confirmed");
      assert.equal(progress.canonical.phase, cancelled ? LifecyclePhase.None : LifecyclePhase.Preparing);
    } finally { await client.request({ method: "evm_setAutomine", params: [true] }); }
    assert.equal((await buildNextTransaction({ client, planned, receipts, limits, fork })).kind, cancelled ? "begin" : "prepare");
  }));

  await t.test("indivisible activation refuses a gas cap, mined OOG restores Ready/empty gates and cancellation refunds every external asset", async () => isolated(async () => {
    const plan = await freshPlan();
    const balances = await Promise.all(plan.funding.map((funding) => client.request({ method: "eth_call", params: [{ to: funding.asset, data: encodeFunctionData({ abi: lifecycleErc20Abi, functionName: "balanceOf", args: [plan.creator] }) }, "latest"] })));
    const { planned, receipts, begin } = await startStaged(plan);
    receipts.push(await send(begin));
    let activation;
    for (let safety = 0; safety < 16; safety += 1) {
      const next = await buildNextTransaction({ client, planned, receipts, limits, fork });
      if (next.kind === "activate") { activation = next; break; }
      assert.equal(next.kind, "prepare"); receipts.push(await send(next));
    }
    assert.ok(activation);
    const ready = await readLaunchProgress({ client, planned, receipts });
    assert.equal(ready.canonical.phase, LifecyclePhase.Ready);
    const cap = activation.gas / 2n < 1_000_000n ? activation.gas / 2n : 1_000_000n;
    const intrinsic = 21_000n + activation.data.slice(2).match(/../g).reduce((gas, byte) => gas + (byte === "00" ? 4n : 16n), 0n);
    assert.ok(cap > intrinsic, "Gas cap must reach EVM execution rather than fail intrinsic validation");
    const refused = await planLaunch({ client, plan, account: plan.creator, mode: "staged", fork, limits: async (context) => ({ ...await limits(context), accountGasLimit: cap }) });
    assert.equal(refused.simulation.admitted, false);
    assert.deepEqual(refused.transactions.map((transaction) => transaction.kind), ["activate"]);
    const failedHash = await client.request({ method: "eth_sendTransaction", params: [{ from: activation.from, to: activation.to, data: activation.data, value: toHex(activation.value), gas: toHex(cap), gasPrice: toHex(activation.gasPrice) }] });
    let failed = null;
    for (const deadline = Date.now() + 3_000; failed === null && Date.now() < deadline;) {
      failed = await client.request({ method: "eth_getTransactionReceipt", params: [failedHash] });
      if (failed === null) await new Promise((resolve) => globalThis.setTimeout(resolve, 25));
    }
    assert.ok(failed, "Failed capped activation receipt must appear within the local automine window");
    assert.equal(failed.status, "0x0");
    assert.ok(BigInt(failed.gasUsed) >= cap - intrinsic, "Mined activation must exhaust its explicit execution gas within intrinsic tolerance");
    const after = await readLaunchProgress({ client, planned, receipts });
    assert.equal(after.canonical.phase, LifecyclePhase.Ready);
    // progress.positionCount counts PREPARED committed identities and persists
    // across a failed activation; empty live liquidity and empty directory
    // positions (asserted below) are the failed-activation invariants.
    for (const market of after.markets) { assert.equal(market.live.publicTrading, false); assert.equal(market.live.liquidity, 0n); }
    const directory = manifest.addresses.directory;
    for (let marketIndex = 0; marketIndex < plan.markets.length; marketIndex += 1) {
      const data = encodeFunctionData({ abi: lifecycleDirectoryAbi, functionName: "positions", args: [planned.launchId, marketIndex, 0n, 32n] });
      const result = await client.request({ method: "eth_call", params: [{ to: directory, data }, "latest"] });
      assert.deepEqual(decodeFunctionResult({ abi: lifecycleDirectoryAbi, functionName: "positions", data: result }), []);
    }
    const activeData = encodeFunctionData({ abi: launchLifecycleAbi, functionName: "isLaunchActive", args: [planned.launchId] });
    assert.equal(decodeFunctionResult({ abi: launchLifecycleAbi, functionName: "isLaunchActive", data: await client.request({ method: "eth_call", params: [{ to: plan.orchestrator, data: activeData }, "latest"] }) }), false);
    const cancel = await buildNextTransaction({ client, planned, receipts, action: "cancel", fork });
    receipts.push(await send(cancel));
    assert.equal((await readLaunchProgress({ client, planned, receipts })).canonical.phase, LifecyclePhase.Cancelled);
    for (let index = 0; index < plan.funding.length; index += 1) {
      const funding = plan.funding[index];
      const balance = await client.request({ method: "eth_call", params: [{ to: funding.asset, data: encodeFunctionData({ abi: lifecycleErc20Abi, functionName: "balanceOf", args: [plan.creator] }) }, "latest"] });
      assert.equal(balance, balances[index]);
    }
  }));

  await t.test("registry revocation and deadline expiry cannot strand pending external funding cancellation", async () => isolated(async () => {
    const plan = await freshPlan();
    const funding = plan.funding[0];
    const balanceData = encodeFunctionData({ abi: lifecycleErc20Abi, functionName: "balanceOf", args: [plan.creator] });
    const before = await client.request({ method: "eth_call", params: [{ to: funding.asset, data: balanceData }, "latest"] });
    const { planned, receipts, begin } = await startStaged(plan);
    receipts.push(await send(begin));
    const adminAbi = parseAbi(["function execute((address target,uint256 value,bytes data)[] calls) payable returns (bytes[] results)"]);
    const registryAbi = parseAbi(["function disableAdapter(bytes32 id)"]);
    const disable = encodeFunctionData({ abi: registryAbi, functionName: "disableAdapter", args: [plan.markets[0].adapterId] });
    const execute = encodeFunctionData({ abi: adminAbi, functionName: "execute", args: [[{ target: manifest.addresses.registry, value: 0n, data: disable }]] });
    await send({ from: plan.creator, to: manifest.addresses.admin, data: execute, value: 0n, gas: 1_000_000n });
    await client.request({ method: "evm_setNextBlockTimestamp", params: [Number(plan.deadline + 1n)] });
    await client.request({ method: "evm_mine" });
    const revoked = await planLaunch({ client, plan, account: plan.creator, mode: "staged", limits, fork, receipts });
    assert.equal(revoked.simulation.admitted, false);
    const cancel = await buildNextTransaction({ client, planned: revoked, receipts, action: "cancel", limits, fork });
    assert.equal(cancel.kind, "cancel"); receipts.push(await send(cancel));
    assert.equal((await readLaunchProgress({ client, planned: revoked, receipts })).canonical.phase, LifecyclePhase.Cancelled);
    assert.equal(await client.request({ method: "eth_call", params: [{ to: funding.asset, data: balanceData }, "latest"] }), before);
    assert.equal(await buildNextTransaction({ client, planned: revoked, receipts, limits, fork }), undefined);
  }));

  await t.test("native-wrap funding is executed by the real escrow with explicit value and no false ERC20 approval", async () => isolated(async () => {
    const plan = await freshPlan();
    const wrapped = manifest.quotes.find((quote) => quote.address.toLowerCase() === plan.funding[0].asset.toLowerCase());
    assert.ok(wrapped && wrapped.decimals === 18, "Fixture first quote must be local wrapped native");
    plan.funding = plan.funding.map((funding) => ({ ...funding, kind: LifecycleFundingKind.NativeWrap }));
    const planned = await planLaunch({ client, plan, account: plan.creator, mode: "staged", limits, fork });
    assert.equal(planned.simulation.admitted, true, planned.simulation.reason);
    assert.equal(planned.prerequisites[0].conversion, "native-wrap");
    const begin = await buildNextTransaction({ client, planned, limits, fork });
    assert.equal(begin.kind, "begin"); assert.equal(begin.value, plan.funding[0].inputAmount);
    const receipt = await send(begin);
    assert.equal((await readLaunchProgress({ client, planned, receipts: [receipt] })).canonical.phase, LifecyclePhase.Preparing);
  }));

  await t.test("a genuinely-admitted single-market atomic fixture executes in one transaction on the live graph", async () => isolated(async () => {
    const row = exported.admitted ?? exported.fixtures.find((entry) => entry.name === "atomic-erc20-q1-single");
    assert.ok(row, "The separately committed single-market atomic fixture is required");
    assert.equal(row.name, "atomic-erc20-q1-single");
    const plan = parseLaunchPlan(JSON.stringify(row.plan));
    assert.equal(plan.markets.length, 1);
    assert.equal(plan.buys.length, 3);
    const atomic = await planLaunch({ client, plan, account: plan.creator, mode: "atomic", limits, fork });
    assert.equal(atomic.simulation.admitted, true, atomic.simulation.reason);
    assert.deepEqual(atomic.transactions.map((transaction) => transaction.kind), ["approve", "atomic"]);
    const receipts = [];
    for (let safety = 0; safety < 8; safety += 1) {
      const next = await buildNextTransaction({ client, planned: atomic, receipts, limits, fork });
      if (next === undefined) break;
      receipts.push(await send(next));
    }
    const done = await readLaunchProgress({ client, planned: atomic, receipts });
    assert.equal(done.canonical.phase, LifecyclePhase.Active);
    assert.equal(done.token, atomic.predictedToken);
    assert.equal(done.canonical.marketCount, 1);
    assert.equal(done.canonical.positionCount, 2);
    for (const market of done.markets) assert.equal(market.live.publicTrading, true);
  }));
});
