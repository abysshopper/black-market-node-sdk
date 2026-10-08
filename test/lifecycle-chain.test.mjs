import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { decodeFunctionResult, encodeFunctionData, encodeFunctionResult, toHex } from "viem";
const sdkPath = process.env.SDK_SOURCE_TEST === "1" ? "../src/lifecycle/index.ts" : "../dist/lifecycle/index.js";
const { buildNextTransaction, createControlledLifecycleFork, decodePoolBoundV4LifecycleMarketConfig, encodePoolBoundV4LifecycleMarketConfig,
  hasLifecycleV4HookPermissions, lifecycleErc20Abi, lifecycleOracleFactoryAbi, lifecycleRegistryAbi, LifecyclePhase, parseLaunchPlan, planLaunch,
  prepareAndPlanLifecycleLaunch, readLaunchProgress, readLifecycleProfiles, readPoolBoundHookDeployment, isPoolBoundV4ConfigVersion } = await import(sdkPath);
const enabled = Boolean(process.env.LAUNCH_LIFECYCLE_RPC_URL && process.env.LAUNCH_LIFECYCLE_FORK_RPC_URL && process.env.LAUNCH_LIFECYCLE_MANIFEST && process.env.LAUNCH_LIFECYCLE_FIXTURES && process.env.LAUNCH_LIFECYCLE_ALLOW_LOCAL_EXECUTION === "1");

test("reviewed real-AMM metadata, admission, cancellation and canonical recovery boundaries", { skip: !enabled, concurrency: false }, async (t) => {
  const rpcUrl = process.env.LAUNCH_LIFECYCLE_RPC_URL;
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(rpcUrl).hostname));
  const manifest = JSON.parse(await readFile(process.env.LAUNCH_LIFECYCLE_MANIFEST, "utf8"));
  const exported = JSON.parse(await readFile(process.env.LAUNCH_LIFECYCLE_FIXTURES, "utf8"));
  assert.equal(manifest.fixtureOnly, true, "Only the owned disposable fixture is authorized");
  const fixture = exported.plans.find((row) => row.plan.markets.some((market) => isPoolBoundV4ConfigVersion(Number(market.configVersion))));
  assert.ok(fixture, "Solidity-authored version-matched bound plan required");
  const policy = manifest.executionLimits;
  assert.equal(policy.provenance.scope, "controlled-local-measurement");
  let requestId = 0;
  const client = { async request({ method, params = [] }) {
    const response = await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }) });
    const body = await response.json();
    if (body.error) throw Object.assign(new Error(`${method}: ${body.error.message}`), { data: body.error.data });
    return body.result;
  } };
  const limits = async ({ block, chainId, account, orchestrator }) => ({
    chainId, account, orchestrator, observedBlockNumber: block.number, observedBlockHash: block.hash,
    chainGasLimit: BigInt(policy.chainTransactionGasLimit), rpcGasLimit: BigInt(policy.rpcTransactionGasLimit), accountGasLimit: BigInt(policy.accountTransactionGasLimit),
    maxCalldataBytes: Number(policy.maxCalldataBytes), headroomBps: Number(policy.headroomBps),
  });
  const fork = createControlledLifecycleFork({ sourceRpcUrl: rpcUrl, forkRpcUrl: process.env.LAUNCH_LIFECYCLE_FORK_RPC_URL, allowTransactions: true, impersonation: "anvil" });
  async function isolated(fn) {
    const snapshot = await client.request({ method: "evm_snapshot" });
    try { await fn(); } finally { assert.equal(await client.request({ method: "evm_revert", params: [snapshot] }), true); await client.request({ method: "evm_mine" }); }
  }
  async function currentPlan() {
    const plan = parseLaunchPlan(JSON.stringify(fixture.plan));
    return (await prepareAndPlanLifecycleLaunch({ client, account: plan.creator, plan, mode: "staged", limits, fork })).plan;
  }
  async function send(transaction) {
    const transactionHash = await client.request({ method: "eth_sendTransaction", params: [{ from: transaction.from, to: transaction.to, data: transaction.data, value: toHex(transaction.value), gas: toHex(transaction.gas), gasPrice: toHex(transaction.gasPrice) }] });
    const receipt = await client.request({ method: "eth_getTransactionReceipt", params: [transactionHash] });
    assert.equal(receipt?.status, "0x1");
    return { transactionHash, observedBlockNumber: BigInt(receipt.blockNumber), observedBlockHash: receipt.blockHash, confirmations: 1 };
  }
  async function begin(plan) {
    const planned = await planLaunch({ client, account: plan.creator, plan, mode: "staged", limits, fork });
    assert.equal(planned.simulation.admitted, true, planned.simulation.reason);
    const receipts = [];
    for (let guard = 0; guard < 32; ++guard) {
      const next = await buildNextTransaction({ client, planned, receipts, limits, fork });
      assert.ok(next);
      receipts.push(await send(next));
      if (next.kind === "begin") return { planned, receipts };
      assert.ok(["approve", "approve-reset"].includes(next.kind));
    }
    throw new Error("Funding prerequisites did not reach the actual begin transaction");
  }

  await t.test("registry enumeration admits multiple reviewed identities by schema/topology, not template ID", async () => {
    const oracleSelector = encodeFunctionData({ abi: lifecycleOracleFactoryAbi, functionName: "oracleConfigs", args: [toHex(1n, { size: 32 })] }).slice(0, 10);
    const discovery = { request(args) {
      if (args.method === "eth_call") assert.notEqual(args.params[0].data.slice(0, 10), oracleSelector, "Profile discovery must not query a profile-wide oracle selection");
      return client.request(args);
    } };
    const profiles = await readLifecycleProfiles({ client: discovery, orchestrator: manifest.addresses.orchestrator });
    for (const row of exported.plans) for (const market of row.plan.markets) {
      const profile = profiles.find((item) => item.id.toLowerCase() === market.profileId.toLowerCase());
      assert.equal(profile?.admitted, true, profile?.reason);
      if (Number(market.configVersion) === 4 || isPoolBoundV4ConfigVersion(Number(market.configVersion))) {
        assert.equal(profile.developerTerms.beneficiary.toLowerCase(), profile.envelope.beneficiary.toLowerCase());
        assert.equal(profile.topology.configVersion, Number(market.configVersion));
        assert.deepEqual(Object.keys(profile.envelope.bounds), ["minimumTickSpacing", "maximumTickSpacing", "maximumPositions", "maximumOracleCardinality", "feeModeFlags"]);
      }
    }
  });

  await t.test("unsupported schema is reported independently from an unreadable topology/position list", async () => {
    const plan = await currentPlan();
    const registry = manifest.addresses.implementationRegistry;
    const profileId = plan.markets[0].profileId;
    const data = encodeFunctionData({ abi: lifecycleRegistryAbi, functionName: "profile", args: [profileId] });
    const opaque = { async request(args) {
      const answer = await client.request(args);
      if (args.method !== "eth_call" || args.params[0].to.toLowerCase() !== registry.toLowerCase() || args.params[0].data.toLowerCase() !== data.toLowerCase()) return answer;
      const registration = decodeFunctionResult({ abi: lifecycleRegistryAbi, functionName: "profile", data: answer });
      return encodeFunctionResult({ abi: lifecycleRegistryAbi, functionName: "profile", result: { ...registration, configSchema: toHex(999n, { size: 32 }) } });
    } };
    const [profile] = await readLifecycleProfiles({ client: opaque, orchestrator: plan.orchestrator, profileIds: [profileId] });
    assert.equal(profile.admitted, false); assert.equal(profile.venueKind, "unknown");
  });

  await t.test("permission bits alone cannot authenticate an undeployed root with counterfeit runtime", async () => {
    const plan = await currentPlan();
    const marketIndex = plan.markets.findIndex((market) => isPoolBoundV4ConfigVersion(market.configVersion));
    const metadata = await readPoolBoundHookDeployment({ client, plan, marketIndex });
    assert.equal(hasLifecycleV4HookPermissions(metadata.predictedHook), true);
    const counterfeit = { request(args) {
      if (args.method === "eth_getCode" && args.params[0].toLowerCase() === metadata.predictedHook.toLowerCase()) return Promise.resolve("0x60006000f3");
      return client.request(args);
    } };
    await assert.rejects(readPoolBoundHookDeployment({ client: counterfeit, plan, marketIndex }), { code: "HOOK_DEPLOYMENT_CHANGED" });
  });

  await t.test("changing frozen developer terms invalidates mining rather than silently binding replacement consent", async () => {
    const plan = await currentPlan();
    const marketIndex = plan.markets.findIndex((market) => isPoolBoundV4ConfigVersion(market.configVersion));
    const market = plan.markets[marketIndex];
    const config = decodePoolBoundV4LifecycleMarketConfig(market.config, market.configVersion);
    const changed = { ...plan, markets: plan.markets.map((market, i) => i === marketIndex ? { ...market, config: encodePoolBoundV4LifecycleMarketConfig({ ...config, developerBeneficiary: plan.creator }) } : market) };
    await assert.rejects(prepareAndPlanLifecycleLaunch({ client, account: changed.creator, plan: changed, mode: "staged", limits, fork }), { code: "PROFILE_TERMS_MISMATCH" });
  });

  await t.test("missing optional policy stays explicit without an implicit staged fallback", async () => {
    const plan = await currentPlan();
    const planned = await planLaunch({ client, account: plan.creator, plan, mode: "atomic", fork });
    assert.equal(planned.mode, "atomic");
    assert.ok(planned.simulation.limits.unknownExecutionConstraints.length > 0);
    assert.doesNotMatch(planned.simulation.reason ?? "", /admission constraints are incomplete/);
    if (planned.simulation.admitted) {
      const next = await buildNextTransaction({ client, planned, fork });
      assert.equal(next?.admission.executionProof, "proved");
      assert.equal(next?.admission.transportPreflight, "not-requested");
    } else await assert.rejects(buildNextTransaction({ client, planned, fork }), { code: "PLAN_NOT_ADMITTED" });
  });

  await t.test("fresh actual-source execution and submission accept a held envelope despite a higher advisory quote", async () => {
    const plan = await currentPlan();
    const planned = await planLaunch({ client, account: plan.creator, plan, mode: "staged", limits, fork });
    assert.equal(planned.simulation.admitted, true, planned.simulation.reason);
    const reviewedTransaction = await buildNextTransaction({ client, planned, limits, fork, submissionClient: client });
    assert.equal(reviewedTransaction.admission.transportPreflight, "passed");
    let advisoryReads = 0;
    const higherRecommendation = { async request(args) {
      const result = await client.request(args);
      if (args.method !== "eth_gasPrice") return result;
      advisoryReads += 1;
      return toHex(BigInt(result) + 1n);
    } };
    const next = await buildNextTransaction({ client: higherRecommendation, planned, limits, fork, reviewedTransaction, submissionClient: client });
    assert.equal(advisoryReads, 1);
    for (const field of ["id", "kind", "chainId", "from", "to", "data", "value", "gas", "gasPrice"]) assert.equal(next[field], reviewedTransaction[field]);
    assert.equal(next.admission.executionProof, "proved");
    assert.equal(next.admission.protocolFit, "proved");
    assert.equal(next.admission.transportPreflight, "passed");
    const canonical = await client.request({ method: "eth_getBlockByNumber", params: [toHex(next.admission.blockNumber), false] });
    assert.equal(next.admission.blockHash.toLowerCase(), canonical.hash.toLowerCase());
    await assert.rejects(buildNextTransaction({ client, planned, limits, fork, reviewedTransaction: { ...reviewedTransaction, value: reviewedTransaction.value + 1n },
      submissionClient: client }), { code: "REVIEWED_TRANSACTION_MISMATCH" });
  });

  await t.test("pending launch cancellation does not require fresh profile admission and refunds committed external funding", async () => isolated(async () => {
    const plan = await currentPlan();
    const assets = [...new Set(plan.funding.filter((item) => item.kind === 0).map((item) => item.inputAsset))];
    const balance = async (asset) => decodeFunctionResult({ abi: lifecycleErc20Abi, functionName: "balanceOf",
      data: await client.request({ method: "eth_call", params: [{ to: asset, data: encodeFunctionData({ abi: lifecycleErc20Abi, functionName: "balanceOf", args: [plan.creator] }) }, "latest"] }) });
    const balancesBefore = await Promise.all(assets.map(balance));
    const { planned, receipts } = await begin(plan);
    const unavailableAdmission = { request(args) {
      if (args.method === "eth_call" && args.params[0].to.toLowerCase() === manifest.addresses.implementationRegistry.toLowerCase()) throw new Error("Pending admission unavailable after retirement");
      return client.request(args);
    } };
    const cancel = await buildNextTransaction({ client: unavailableAdmission, planned, receipts, limits, fork, action: "cancel" });
    assert.equal(cancel.kind, "cancel"); receipts.push(await send(cancel));
    const progress = await readLaunchProgress({ client, planned, receipts });
    assert.equal(progress.canonical.phase, LifecyclePhase.Cancelled);
    assert.deepEqual(await Promise.all(assets.map(balance)), balancesBefore, "Direct ERC20 funding returns exactly to the committed creator without consuming preparation inventory");
    assert.equal(await buildNextTransaction({ client, planned, receipts, limits, fork }), undefined);
  }));

  await t.test("real receipt removal restores unstarted canonical progress instead of advancing a cached step counter", async () => isolated(async () => {
    const plan = await currentPlan();
    const before = await client.request({ method: "evm_snapshot" });
    const { planned, receipts } = await begin(plan);
    assert.equal(await client.request({ method: "evm_revert", params: [before] }), true);
    await client.request({ method: "evm_mine" });
    const progress = await readLaunchProgress({ client, planned, receipts });
    assert.equal(progress.canonical.phase, LifecyclePhase.None);
    assert.ok(progress.receipts.some((receipt) => receipt.status === "reorged"));
  }));
});
