import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decodeEventLog, decodeFunctionData, decodeFunctionResult, encodeFunctionData, keccak256, parseAbi, toFunctionSelector, toHex, zeroAddress, zeroHash } from "viem";
import {
  buildNextTransaction, buildPoolBoundHookDeploymentTransaction, createControlledLifecycleFork, encodeLaunchPlan, hashLaunchIdentity, hashLaunchPlan, launchLifecycleAbi,
  decodeAbyssLifecycleMarketConfig, decodePoolBoundV4LifecycleMarketConfig, decodeV4LifecycleMarketConfig, encodePoolBoundV4LifecycleMarketConfig, LifecyclePhase, parseLaunchPlan, planLaunch, predictLifecycleToken,
  lifecycleAdapterAbi, lifecycleDirectoryAbi, lifecycleErc20Abi, lifecycleFeeHubAbi, lifecycleV4HookAbi, poolBoundLaunchFeeHookDeployerV1Abi, poolBoundLaunchFeeHookV1Abi,
  encodePoolBoundHookParameters, preparePoolBoundLifecyclePlan, readLaunchProgress, readLifecycleProfiles, readPoolBoundHookDeployment, simulateLaunchPlan, V4_LIFECYCLE_PROFILE_ID, V4_POOL_BOUND_LIFECYCLE_PROFILE_ID,
} from "../dist/lifecycle/index.js";

const [manifestFile, fixturesFile] = process.argv.slice(2);
if (!manifestFile || !fixturesFile) throw new Error("Usage: node examples/launch-lifecycle-smoke.mjs manifest.json sdk-plans.json");
const rpcUrl = process.env.LAUNCH_LIFECYCLE_RPC_URL;
if (!rpcUrl || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(rpcUrl).hostname) || process.env.LAUNCH_LIFECYCLE_ALLOW_LOCAL_EXECUTION !== "1") throw new Error("Actual SDK smoke requires explicitly authorized disposable loopback RPC execution");
const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
const exported = JSON.parse(await readFile(fixturesFile, "utf8"));
if (!Array.isArray(exported.fixtures) || exported.fixtures.length === 0) throw new Error("Expected actual Solidity-exported fixture array");
if (!Array.isArray(exported.poolBoundFixtures) || exported.poolBoundFixtures.length === 0) throw new Error("Expected actual Solidity-exported pool-bound fixture array");
const boundOnlyCompanions = [0, 1].flatMap((tokenKind) => [2, 3].map((quoteCount) => ({ tokenKind, quoteCount, name: `pool-bound-only-staged-erc${tokenKind === 0 ? "20" : "404"}-q${quoteCount}` })));
for (const companion of boundOnlyCompanions) assert.ok(exported.poolBoundFixtures.some((fixture) => fixture.name === companion.name), `Missing explicitly committed supported multiquote fixture ${companion.name}`);
assert.equal(exported.catalogueFixtures?.length, 32, "All eight one-buy core shapes require both explicit modes and offerings");
let requestId = 0;
const client = { async request({ method, params = [] }) {
  const response = await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }) });
  if (!response.ok) throw new Error(`Local RPC HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw Object.assign(new Error(`${method}: ${body.error.message}`), { data: body.error.data });
  return body.result;
} };
const v4OracleAbi = parseAbi(["function observeTruncated(bytes32 poolId,uint32[] secondsAgos) view returns (int56[] tickCumulatives,uint160[] secondsPerLiquidityCumulativeX128s)"]);
const abyssOracleAbi = parseAbi(["function observeTruncated(uint32[] secondsAgos) view returns (int56[] tickCumulatives,uint160[] secondsPerLiquidityCumulativeX128s)"]);
const beforeGenesisError = toFunctionSelector("ObservationTooOld()");
async function observeMarketOracle(identity, secondsAgo, blockNumber) {
  const v4 = identity.venue === 0;
  const abi = v4 ? v4OracleAbi : abyssOracleAbi;
  const args = v4 ? [identity.poolId, [secondsAgo]] : [[secondsAgo]];
  const data = encodeFunctionData({ abi, functionName: "observeTruncated", args });
  const result = await client.request({ method: "eth_call", params: [{ to: v4 ? identity.hook : identity.pool, data }, blockNumber] });
  return decodeFunctionResult({ abi, functionName: "observeTruncated", data: result });
}
const chainId = BigInt(await client.request({ method: "eth_chainId" }));
assert.equal(chainId, BigInt(manifest.chainId));
const configured = manifest.executionLimits;
assert.ok(configured?.provenance && exported.executionLimits?.provenance, "Captured and exported reviewed execution policy with provenance is required");
for (const [key, value] of Object.entries(exported.executionLimits)) assert.deepEqual(configured[key], value, `Fixture and manifest reviewed execution policy ${key}`);
const limits = async ({ block, chainId, account, orchestrator }) => ({
  chainId, account, orchestrator, observedBlockNumber: block.number, observedBlockHash: block.hash,
  chainGasLimit: BigInt(configured.chainTransactionGasLimit) < block.gasLimit ? BigInt(configured.chainTransactionGasLimit) : block.gasLimit,
  rpcGasLimit: BigInt(configured.rpcTransactionGasLimit),
  accountGasLimit: BigInt(configured.accountTransactionGasLimit),
  maxCalldataBytes: configured.maxCalldataBytes,
  headroomBps: configured.headroomBps,
});
const forkUrl = process.env.LAUNCH_LIFECYCLE_FORK_RPC_URL;
if (!forkUrl) throw new Error("Actual SDK sequential fallback requires a distinct disposable LAUNCH_LIFECYCLE_FORK_RPC_URL");
const fork = createControlledLifecycleFork({ sourceRpcUrl: rpcUrl, forkRpcUrl: forkUrl, allowTransactions: true, impersonation: "anvil" });
const discovered = await readLifecycleProfiles({ client, orchestrator: manifest.addresses.orchestrator });
assert.ok(discovered.some((profile) => profile.admitted && profile.topology.hookTopology === 1), "Shared reusable V4 offering remains discoverable");
assert.ok(discovered.some((profile) => profile.admitted && profile.topology.hookTopology === 2), "Pool-bound V4 offering is separately certified and discoverable");
async function readContractAt(to, abi, functionName, args = [], blockTag = "latest") {
  const data = encodeFunctionData({ abi, functionName, args });
  const result = await client.request({ method: "eth_call", params: [{ to, data }, blockTag] });
  return decodeFunctionResult({ abi, functionName, data: result });
}
const results = [];
async function sendLocal(transaction) {
  const transactionHash = await client.request({ method: "eth_sendTransaction", params: [{ from: transaction.from, to: transaction.to, data: transaction.data, value: toHex(transaction.value), gas: toHex(transaction.gas), gasPrice: toHex(transaction.gasPrice) }] });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const receipt = await client.request({ method: "eth_getTransactionReceipt", params: [transactionHash] });
    if (receipt !== null) { assert.equal(receipt.status, "0x1"); return { transactionHash, receipt }; }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Local SDK smoke transaction did not mine");
}

async function sendContract(from, to, abi, functionName, args = []) {
  const data = encodeFunctionData({ abi, functionName, args });
  const gasPrice = BigInt(await client.request({ method: "eth_gasPrice" }));
  const head = await client.request({ method: "eth_getBlockByNumber", params: ["latest", false] });
  const caps = await limits({ block: { number: BigInt(head.number), hash: head.hash, gasLimit: BigInt(head.gasLimit) }, chainId, account: from, orchestrator: manifest.addresses.orchestrator });
  const ceiling = [BigInt(head.gasLimit), caps.chainGasLimit, caps.rpcGasLimit, caps.accountGasLimit].filter((cap) => cap !== undefined).reduce((a, b) => a < b ? a : b);
  const estimated = BigInt(await client.request({ method: "eth_estimateGas", params: [{ from, to, data, gas: toHex(ceiling), gasPrice: toHex(gasPrice) }] }));
  const gas = (estimated * BigInt(10000 + caps.headroomBps) + 9999n) / 10000n;
  assert.ok(gas <= ceiling, "Exact local predeployment/fee-claim envelope must fit operator caps");
  return sendLocal({ from, to, data, gas, gasPrice, value: 0n });
}
async function isolatedFixture(fixture, execute) {
  const baseline = await client.request({ method: "eth_getBlockByNumber", params: ["latest", false] });
  const creator = fixture.plan.creator;
  const nonce = await client.request({ method: "eth_getTransactionCount", params: [creator, "latest"] });
  const nativeBalance = await client.request({ method: "eth_getBalance", params: [creator, "latest"] });
  const funding = await Promise.all(fixture.plan.funding.map(async (item) => ({
    inputAsset: item.inputAsset, inputAmount: item.inputAmount,
    availableBalance: await readContractAt(item.inputAsset, lifecycleErc20Abi, "balanceOf", [creator]),
  })));
  const snapshot = await client.request({ method: "evm_snapshot" });
  const firstResult = results.length;
  try {
    await execute();
  } finally {
    assert.equal(await client.request({ method: "evm_revert", params: [snapshot] }), true, "Every independent fixture restores its own funding and source writes");
    const restored = await client.request({ method: "eth_getBlockByNumber", params: ["latest", false] });
    assert.equal(restored.hash, baseline.hash);
    assert.equal(restored.stateRoot, baseline.stateRoot);
    assert.equal(await client.request({ method: "eth_getTransactionCount", params: [creator, "latest"] }), nonce);
    assert.equal(await client.request({ method: "eth_getBalance", params: [creator, "latest"] }), nativeBalance);
    for (const item of funding) assert.equal(await readContractAt(item.inputAsset, lifecycleErc20Abi, "balanceOf", [creator]), item.availableBalance, "Original input amounts are never replenished, reduced or accumulated across scenarios");
    await fork.client.request({ method: "anvil_reset", params: [{ forking: { jsonRpcUrl: rpcUrl, blockNumber: Number(BigInt(baseline.number)) } }] });
    for (const result of results.slice(firstResult)) result.scenarioIsolation = {
      method: "independent-local-snapshot", sourceRestored: true, baselineBlockHash: baseline.hash,
      baselineStateRoot: baseline.stateRoot, funding, receiptEvidence: "observed-before-rollback",
    };
  }
}


const fixtures = [...exported.fixtures, ...exported.poolBoundFixtures];
const smokeRows = [...fixtures, ...(exported.admitted ? [exported.admitted] : []), ...exported.catalogueFixtures];
const intentionalRefusal = new Set(["gas-cap-refusal"]);
const refusalOutcome = (simulation, transactions) => {
  const ceiling = simulation.limits.executionGasCeiling;
  if (simulation.confidence !== "stateful" || ceiling <= 0n) return `failure:${simulation.reason ?? "unmeasured refusal"}`;
  const index = simulation.steps.findIndex((step) => step.transactionId === simulation.failedTransactionId);
  const step = simulation.steps[index];
  const transaction = transactions.find((item) => item.id === step?.transactionId);
  if (transaction && ["activate", "atomic"].includes(transaction.kind)
    && simulation.steps.slice(0, index).every((item) => item.success)) {
    if (!step.success && step.outOfGas === true && step.gasLimit === ceiling) return "gas-cap-refusal";
    const required = step.gasRequired ?? step.gasUsed;
    if (step.success && required !== undefined
      && (required * BigInt(10000 + simulation.limits.headroomBps) + 9999n) / 10000n > ceiling) return "gas-cap-refusal";
  }
  return `failure:${simulation.reason || "unknown refusal"}`;
};

async function refusalEvidence(planned) {
  let simulation = planned.simulation;
  // Opaque RPC/estimator reverts are NOT gas proof. Execute the exact sequence at
  // the unchanged operator ceiling on the already-owned separate fork to obtain
  // actual receipt consumption. This is verification only, never source execution.
  const ceiling = simulation.limits.executionGasCeiling;
  const tag = toHex(simulation.blockNumber);
  const source = await client.request({ method: "eth_getBlockByNumber", params: [tag, false] });
  assert.equal(source.hash.toLowerCase(), simulation.blockHash.toLowerCase(), "Refusal proof source must remain canonical");
  const reset = async () => {
    await fork.client.request({ method: "anvil_reset", params: [{ forking: { jsonRpcUrl: rpcUrl, blockNumber: Number(simulation.blockNumber) } }] });
    const head = await fork.client.request({ method: "eth_getBlockByNumber", params: ["latest", false] });
    assert.equal(head.hash.toLowerCase(), simulation.blockHash.toLowerCase(), "Refusal proof must restore the exact pinned fork head");
    assert.equal(BigInt(await fork.client.request({ method: "eth_chainId" })), planned.chainId);
    assert.equal(await fork.client.request({ method: "eth_getTransactionCount", params: [planned.account, "latest"] }),
      await client.request({ method: "eth_getTransactionCount", params: [planned.account, tag] }), "Refusal proof fork nonce");
  };
  assert.ok(simulation.blockNumber <= BigInt(Number.MAX_SAFE_INTEGER) && ceiling > 0n);
  await reset();
  const steps = [];
  try {
    const gasPrice = await client.request({ method: "eth_gasPrice" });
    for (const transaction of planned.transactions) {
      const hash = await fork.client.request({ method: "eth_sendTransaction", params: [{
        from: transaction.from, to: transaction.to, data: transaction.data,
        value: toHex(transaction.value), gas: toHex(ceiling), gasPrice,
      }] });
      let receipt;
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        receipt = await fork.client.request({ method: "eth_getTransactionReceipt", params: [hash] });
        if (receipt !== null) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.ok(receipt, "Refusal proof requires an actual automined receipt");
      const success = BigInt(receipt.status) === 1n;
      const failureTrace = [];
      if (!success) {
        let frame = await fork.client.request({ method: "debug_traceTransaction", params: [hash, { tracer: "callTracer" }] });
        // Only the terminal failing call chain can authenticate exhaustion.
        // An earlier caught/recovered OOG must not excuse a later business revert.
        while (frame?.error) {
          failureTrace.push(frame.error);
          frame = frame.calls?.at(-1);
        }
      }
      steps.push({ transactionId: transaction.id, transactionHash: hash, success, gasUsed: BigInt(receipt.gasUsed), gasRequired: success ? BigInt(receipt.gasUsed) : undefined,
        gasLimit: ceiling, outOfGas: failureTrace.some((error) => /\bout of gas\b|\bOutOfGas\b/i.test(error)), failureTrace });
      if (!success) break;
    }
    const failed = steps.find((step) => !step.success);
    const headroomExceeded = failed === undefined ? steps.find((step) => (step.gasUsed * BigInt(10000 + simulation.limits.headroomBps) + 9999n) / 10000n > ceiling) : undefined;
    simulation = { ...simulation, backend: "controlled-fork", steps, failedTransactionId: (failed ?? headroomExceeded)?.transactionId,
      refusalKind: failed?.outOfGas === true ? "terminal-oog" : headroomExceeded === undefined ? "unclassified" : "headroom-only",
      reason: failed ? "Exact ceiling receipt failure" : headroomExceeded ? "Successful matched-cap receipts exceed the explicit operator headroom envelope" : "Exact ceiling sequence succeeded; original refusal is not proven gas exhaustion or headroom failure" };
    return simulation;
  } finally {
    await reset();
    assert.equal((await client.request({ method: "eth_getBlockByNumber", params: [tag, false] })).hash.toLowerCase(),
      source.hash.toLowerCase(), "Refusal proof must not outlive its canonical source block");
  }
}
for (const fixture of smokeRows) {
  assert.equal(fixture.expectationMode, "measured-policy", `${fixture.name}: actual execution determines outcomes under the reviewed policy`);
}
async function runFixture(fixture) {
  let plan = parseLaunchPlan(JSON.stringify(fixture.plan));
  assert.equal(encodeLaunchPlan(plan).toLowerCase(), fixture.encodedPlan.toLowerCase(), "Solidity ABI plan bytes");
  assert.equal(hashLaunchPlan(plan).toLowerCase(), fixture.planHash.toLowerCase(), "Solidity domain commitment");
  assert.equal(hashLaunchIdentity(plan).toLowerCase(), fixture.launchId.toLowerCase(), "Solidity launch identity");
  assert.equal((await predictLifecycleToken({ client, plan })).toLowerCase(), fixture.predictedToken.toLowerCase(), "Deterministic actual token prediction");
  const bound = plan.markets.some((market) => market.profileId.toLowerCase() === V4_POOL_BOUND_LIFECYCLE_PROFILE_ID.toLowerCase());
  let hookDeployments = [];
  let predeployment;
  if (bound) {
    const draft = { ...plan, markets: plan.markets.map((market) => market.configVersion === 3 ? { ...market, config: encodePoolBoundV4LifecycleMarketConfig({ ...decodePoolBoundV4LifecycleMarketConfig(market.config), hookSalt: zeroHash }) } : market) };
    const miningProgress = [];
    const prepared = await preparePoolBoundLifecyclePlan({ client, plan: draft, onProgress: (event) => miningProgress.push(event) });
    plan = prepared.plan;
    hookDeployments = prepared.deployments;
    assert.equal(encodeLaunchPlan(plan).toLowerCase(), fixture.encodedPlan.toLowerCase(), "Actual nonblocking SDK mining reproduces Solidity's exact final salts and plan");
    assert.equal(hashLaunchPlan(plan).toLowerCase(), fixture.planHash.toLowerCase());
    assert.equal((await predictLifecycleToken({ client, plan })).toLowerCase(), fixture.predictedToken.toLowerCase());
    assert.equal(hookDeployments.length, fixture.hookDeployments.length);
    for (const deployment of hookDeployments) {
      const expected = fixture.hookDeployments.find((row) => row.marketIndex === deployment.marketIndex);
      assert.ok(expected, "Every bound market has an independently exported deployment vector");
      for (const field of ["deployer", "initCodeHash", "salt", "predictedHook"]) assert.equal(deployment[field].toLowerCase(), expected[field].toLowerCase(), `actual metadata ${field}`);
      assert.ok(miningProgress.some((event) => event.marketIndex === deployment.marketIndex && event.attempts === 0n), "Mining discloses initial progress before work");
      assert.equal(miningProgress.filter((event) => event.marketIndex === deployment.marketIndex).at(-1).predictedHook.toLowerCase(), deployment.predictedHook.toLowerCase(), "Mining discloses the winning prediction");
      const transaction = await buildPoolBoundHookDeploymentTransaction({ client, plan, marketIndex: deployment.marketIndex });
      const decoded = decodeFunctionData({ abi: poolBoundLaunchFeeHookDeployerV1Abi, data: transaction.data });
      assert.equal(keccak256(expected.encodedParameters).toLowerCase(), expected.deploymentConfigHash.toLowerCase());
      assert.equal(encodePoolBoundHookParameters(decoded.args[0]).toLowerCase(), expected.encodedParameters.toLowerCase(), "Predeploy calldata binds all eighteen independently exported constructor words");
      assert.equal(decoded.args[0].marketCommitment.toLowerCase(), expected.marketCommitment.toLowerCase());
      assert.equal(decoded.args[1].toLowerCase(), expected.salt.toLowerCase(), "Optional predeploy calldata commits the finalized salt");
    }
    if (fixture.name === "pool-bound-staged-erc20-q1") {
      const deployment = hookDeployments[0];
      assert.equal(await client.request({ method: "eth_getCode", params: [fixture.predictedToken, "latest"] }), "0x", "Exact permissionless predeployment precedes token deployment");
      const transaction = await buildPoolBoundHookDeploymentTransaction({ client, plan, marketIndex: deployment.marketIndex });
      const decoded = decodeFunctionData({ abi: poolBoundLaunchFeeHookDeployerV1Abi, data: transaction.data });
      predeployment = await sendContract(plan.creator, transaction.to, poolBoundLaunchFeeHookDeployerV1Abi, "deploy", decoded.args);
      const hookCode = await client.request({ method: "eth_getCode", params: [deployment.predictedHook, "latest"] });
      assert.equal((await readContractAt(deployment.deployer, poolBoundLaunchFeeHookDeployerV1Abi, "deployedCodeHash", [deployment.predictedHook])).toLowerCase(), keccak256(hookCode).toLowerCase(), "Factory records actual successful runtime provenance");
    }
  }
  // The first committed buy of an old mixed stress row selects Abyss, not V4.
  // Select the actual V4 market explicitly for both representative and stress evidence.
  const selectedV4MarketIndex = fixture.selectedV4MarketIndex ?? plan.markets.findIndex((market) =>
    [V4_LIFECYCLE_PROFILE_ID, V4_POOL_BOUND_LIFECYCLE_PROFILE_ID].some((id) => market.profileId.toLowerCase() === id.toLowerCase()));
  assert.ok(selectedV4MarketIndex >= 0);
  const selectedMarket = plan.markets[selectedV4MarketIndex];
  const selectedConfig = selectedMarket.configVersion === 3
    ? decodePoolBoundV4LifecycleMarketConfig(selectedMarket.config) : decodeV4LifecycleMarketConfig(selectedMarket.config);
  const selectedProfile = discovered.find((profile) => profile.id.toLowerCase() === selectedMarket.profileId.toLowerCase());
  const selectedV4Pool = await readContractAt(selectedProfile.adapter.implementation, lifecycleAdapterAbi, "resolve", [hashLaunchIdentity(plan), fixture.predictedToken, selectedMarket]);
  if (fixture.selectedV4Pool) for (const field of ["poolId", "hook", "currency0", "currency1", "manager"]) assert.equal(selectedV4Pool[field].toLowerCase(), fixture.selectedV4Pool[field].toLowerCase(), `Exported selected V4 pool ${field}`);
  const workload = {
    workload: fixture.workload, shapeName: fixture.shapeName, catalogueProfile: fixture.catalogueProfile,
    corePositionCount: selectedConfig.positions.length, openingBuyCount: plan.buys.length,
    selectedV4MarketIndex, selectedV4Pool, policy: configured,
  };
  const balanceBefore = await client.request({ method: "eth_getBalance", params: [plan.creator, "latest"] });
  const nonceBefore = await client.request({ method: "eth_getTransactionCount", params: [plan.creator, "latest"] });
  let planned = await planLaunch({ client, account: plan.creator, plan, mode: fixture.mode, limits, fork });
  assert.equal(planned.progress.canonical.phase, LifecyclePhase.None, "Smoke requires an unstarted exact fixture, not an already completed launch");
  assert.equal(await client.request({ method: "eth_getBalance", params: [plan.creator, "latest"] }), balanceBefore, "Snapshot simulation must restore real native balances");
  assert.equal(await client.request({ method: "eth_getTransactionCount", params: [plan.creator, "latest"] }), nonceBefore, "Snapshot simulation must restore real account nonce");
  let selectedMode = fixture.mode;
  if (!planned.simulation.admitted) {
    const evidence = await refusalEvidence(planned);
    results.push({ ...workload, name: fixture.name, requestedMode: fixture.mode, selectedMode, planHash: planned.planHash, admitted: false, confidence: planned.simulation.confidence, reason: planned.simulation.reason, outcome: refusalOutcome(evidence, planned.transactions), gasEvidence: { backend: evidence.backend, blockNumber: evidence.blockNumber.toString(), blockHash: evidence.blockHash, failedTransactionId: evidence.failedTransactionId, refusalKind: evidence.refusalKind, steps: evidence.steps.map(({ transactionId, transactionHash, success, gasUsed, gasLimit, gasRequired, outOfGas, failureTrace }) => ({ transactionId, transactionHash, success, gasUsed: gasUsed?.toString(), gasLimit: gasLimit?.toString(), gasRequired: gasRequired?.toString(), outOfGas, failureTrace })) } });
    assert.ok(intentionalRefusal.has(results.at(-1).outcome), `${fixture.name}: refusal is not an intentional known gas-cap refusal: ${planned.simulation.reason}`);
    assert.equal(planned.mode, fixture.mode, "SDK must never silently stage an atomic request");
    if (fixture.mode !== "atomic" || fixture.workload === "representative-one-opening-swap" || process.env.LAUNCH_LIFECYCLE_EXPLICIT_STAGED_FALLBACK !== "1") return;
    selectedMode = "staged";
    planned = await planLaunch({ client, account: plan.creator, plan, mode: selectedMode, limits, fork });
    assert.equal(planned.planHash, hashLaunchPlan(plan), "Explicit staged consent cannot change economics");
    if (!planned.simulation.admitted) {
      const evidence = await refusalEvidence(planned);
      results.push({ ...workload, name: fixture.name, requestedMode: fixture.mode, selectedMode, planHash: planned.planHash, admitted: false, confidence: planned.simulation.confidence, reason: planned.simulation.reason, outcome: refusalOutcome(evidence, planned.transactions), gasEvidence: { backend: evidence.backend, blockNumber: evidence.blockNumber.toString(), blockHash: evidence.blockHash, failedTransactionId: evidence.failedTransactionId, refusalKind: evidence.refusalKind, steps: evidence.steps.map(({ transactionId, transactionHash, success, gasUsed, gasLimit, gasRequired, outOfGas, failureTrace }) => ({ transactionId, transactionHash, success, gasUsed: gasUsed?.toString(), gasLimit: gasLimit?.toString(), gasRequired: gasRequired?.toString(), outOfGas, failureTrace })) } });
      assert.ok(intentionalRefusal.has(results.at(-1).outcome), `${fixture.name}: staged refusal is not an intentional known gas-cap refusal`);
      return;
    }
  }
  assert.equal(planned.simulation.admitted, true, planned.simulation.reason);
  const replay = await simulateLaunchPlan({ client, planned, limits, fork });
  assert.equal(replay.admitted, true, replay.reason);
  const receipts = [];
  const actualSteps = [];
  let activationReceipt;
  for (let safety = 0; safety < 40; safety += 1) {
    const next = await buildNextTransaction({ client, planned, receipts, limits, fork });
    if (next === undefined) break;
    assert.equal(next.admission?.admitted, true);
    const sent = await sendLocal(next);
    actualSteps.push({ kind: next.kind, transactionHash: sent.transactionHash, blockHash: sent.receipt.blockHash, blockNumber: BigInt(sent.receipt.blockNumber).toString(), gasUsed: BigInt(sent.receipt.gasUsed).toString(), gasLimit: next.gas.toString(), status: sent.receipt.status, canonicalAtCapture: true });
    receipts.push({ transactionHash: sent.transactionHash, observedBlockNumber: BigInt(sent.receipt.blockNumber), observedBlockHash: sent.receipt.blockHash, confirmations: 1 });
    const progress = await readLaunchProgress({ client, planned, receipts });
    assert.equal(progress.receipts.at(-1).status, "confirmed");
    if (next.kind === "atomic" || next.kind === "activate") activationReceipt = sent.receipt;
    else if (next.kind === "begin" || next.kind === "prepare") {
      assert.notEqual(progress.canonical.phase, LifecyclePhase.Active);
      for (const market of progress.markets) { assert.equal(market.live.publicTrading, false); assert.equal(market.live.liquidity, 0n); }
    }
  }
  const progress = await readLaunchProgress({ client, planned, receipts });
  assert.equal(progress.canonical.phase, LifecyclePhase.Active, "Every admitted plan must reach actual Active");
  assert.equal(progress.markets[selectedV4MarketIndex].prepared.identity.poolId.toLowerCase(), selectedV4Pool.poolId.toLowerCase(), "Actual manager selected pool must equal the exact exporter/adapter identity");
  if (fixture.workload === "representative-one-opening-swap") {
    assert.equal(plan.markets.length, 1);
    assert.equal(plan.buys.length, 1);
    assert.equal(plan.buys[0].marketIndex, selectedV4MarketIndex);
    assert.equal(progress.canonical.positionCount, fixture.corePositionCount);
  }
  assert.equal(progress.canonical.preparedMarkets, plan.markets.length);
  assert.ok(activationReceipt, "All-buys public activation receipt is required");
  const buyEvents = activationReceipt.logs.filter((log) => log.address.toLowerCase() === plan.orchestrator.toLowerCase()).flatMap((log) => {
    try { const event = decodeEventLog({ abi: launchLifecycleAbi, data: log.data, topics: log.topics }); return event.eventName === "InitialBuyExecuted" ? [event.args] : []; } catch { return []; }
  });
  assert.equal(buyEvents.length, plan.buys.length);
  for (let index = 0; index < plan.buys.length; index += 1) {
    assert.equal(buyEvents[index].buyIndex, index);
    assert.equal(buyEvents[index].marketIndex, plan.buys[index].marketIndex);
    assert.equal(buyEvents[index].recipient.toLowerCase(), plan.buys[index].recipient.toLowerCase());
    assert.ok(buyEvents[index].tokenOut >= plan.buys[index].minTokenOut);
    assert.ok(buyEvents[index].quoteSpent <= plan.buys[index].quoteAmountIn);
  }
  const oracleReadBlock = await client.request({ method: "eth_getBlockByHash", params: [activationReceipt.blockHash, false] });
  const oracleHistory = [];
  for (const market of progress.markets) {
    assert.equal(market.live.publicTrading, true);
    // The fixture selects oracle-enabled pools on both venues. This is genesis, not maturity.
    assert.ok(market.live.oracleReadyAt > 0n && market.live.oracleReadyAt <= BigInt(oracleReadBlock.timestamp), "real oracle genesis is disclosed on every market");
    const identity = market.prepared.identity;
    const elapsed = BigInt(oracleReadBlock.timestamp) - market.live.oracleReadyAt;
    const marketConfig = plan.markets[market.index];
    const config = identity.venue === 0 ? marketConfig.configVersion === 3 ? decodePoolBoundV4LifecycleMarketConfig(marketConfig.config) : decodeV4LifecycleMarketConfig(marketConfig.config) : decodeAbyssLifecycleMarketConfig(marketConfig.config);
    const directory = await readContractAt(plan.orchestrator, launchLifecycleAbi, "directory");
    const positions = await readContractAt(directory, lifecycleDirectoryAbi, "positions", [planned.launchId, market.index, 0n, 32n]);
    assert.equal(positions.length, config.positions.length, "Actual canonical directory contains every committed position");
    const profile = planned.profiles.find((item) => item.id.toLowerCase() === identity.profileId.toLowerCase());
    for (let positionIndex = 0; positionIndex < positions.length; positionIndex += 1) {
      const position = positions[positionIndex];
      const committed = config.positions[positionIndex];
      assert.equal(position.marketId.toLowerCase(), identity.canonicalId.toLowerCase());
      assert.equal(position.tickLower, committed.tickLower);
      assert.equal(position.tickUpper, committed.tickUpper);
      assert.equal(position.liquidity, committed.liquidity);
      if (identity.venue === 0) assert.equal(position.salt.toLowerCase(), committed.salt.toLowerCase());
      const [liquidity, owner] = await readContractAt(profile.adapter.implementation, lifecycleAdapterAbi, "readPosition", [position]);
      assert.equal(liquidity, committed.liquidity, "Actual manager liquidity equals the committed position");
      assert.equal(owner.toLowerCase(), market.prepared.custody.toLowerCase(), "Each position remains in permanent custody");
    }
    if (marketConfig.configVersion === 3) {
      const metadata = await readPoolBoundHookDeployment({ client, plan, marketIndex: market.index });
      assert.equal(metadata.predictedHook.toLowerCase(), identity.hook.toLowerCase(), "Metadata remains exact after actual preparation/activation");
      assert.equal(await readContractAt(identity.hook, poolBoundLaunchFeeHookV1Abi, "registered", [identity.poolId]), true);
      assert.equal(await readContractAt(identity.hook, poolBoundLaunchFeeHookV1Abi, "initialized", [identity.poolId]), true);
      assert.ok(await readContractAt(identity.hook, poolBoundLaunchFeeHookV1Abi, "openingCompletedAt", [identity.poolId]) > 0n);
    }
    // Solidity fixture geometry anchors its first token-only range at the exact opening tick.
    const tokenIs0 = progress.token.toLowerCase() === identity.currency0.toLowerCase();
    const openingTick = BigInt(tokenIs0 ? config.positions[0].tickLower : config.positions[0].tickUpper);
    const normalizedTick = tokenIs0 ? openingTick : -openingTick;
    const [ticks, secondsPerLiquidity] = await observeMarketOracle(identity, 0, activationReceipt.blockNumber);
    assert.equal(ticks[0], normalizedTick * elapsed, "real quote-normalized opening history accrues until atomic/staged activation");
    assert.equal(secondsPerLiquidity[0], elapsed << 128n, "pre-activation history uses genuinely empty active liquidity");
    await assert.rejects(() => observeMarketOracle(identity, Number(elapsed + 1n), activationReceipt.blockNumber), (error) => error.data === beforeGenesisError, "oracle refuses fabricated history before actual pool genesis");
    oracleHistory.push({ marketIndex: market.index, venue: identity.venue, initializedAt: market.live.oracleReadyAt.toString(), blockHash: activationReceipt.blockHash, tickCumulative: ticks[0].toString(), secondsPerLiquidityCumulativeX128: secondsPerLiquidity[0].toString(), beforeGenesisRejected: true });
  }
  assert.equal(await buildNextTransaction({ client, planned, receipts, limits, fork }), undefined);
  const hub = progress.canonical.feeHub;
  assert.equal(await readContractAt(hub, lifecycleFeeHubAbi, "finalized"), true);
  assert.deepEqual((await readContractAt(hub, lifecycleFeeHubAbi, "sources")).map((address) => address.toLowerCase()).sort(), progress.markets.map((market) => market.prepared.feeSource.toLowerCase()).sort(), "Exact prepared fee sources finalize in the launch hub");
  const claimableBefore = await Promise.all(plan.feeAssets.map((policy) => readContractAt(hub, lifecycleFeeHubAbi, "claimableOwnerFees", [plan.creator, policy.asset])));
  const rewardsBefore = await Promise.all(plan.feeAssets.map((policy) => progress.canonical.rewards === zeroAddress ? 0n : readContractAt(policy.asset, lifecycleErc20Abi, "balanceOf", [progress.canonical.rewards])));
  const feeReceipt = await sendContract(plan.creator, hub, lifecycleFeeHubAbi, "claimAndSplit");
  const distributions = feeReceipt.receipt.logs.filter((log) => log.address.toLowerCase() === hub.toLowerCase()).flatMap((log) => {
    try { const event = decodeEventLog({ abi: lifecycleFeeHubAbi, data: log.data, topics: log.topics }); return event.eventName === "Distributed" ? [event.args] : []; } catch { return []; }
  });
  assert.equal(distributions.length, plan.feeAssets.length);
  assert.ok(distributions.some((event) => event.newlyCollected > 0n), "Real opening buys generate positive canonical fees, not a zero-fee mock claim");
  const feeClaims = [];
  for (let assetIndex = 0; assetIndex < plan.feeAssets.length; assetIndex += 1) {
    const policy = plan.feeAssets[assetIndex];
    const distribution = distributions.find((event) => event.asset.toLowerCase() === policy.asset.toLowerCase());
    assert.ok(distribution);
    assert.equal(distribution.executorAmount, distribution.newlyCollected * BigInt(plan.executorFeeBps) / 10000n, "Executor bounty applies only to real newly collected fees");
    assert.equal(distribution.ownerAmount + distribution.rewardsAmount + distribution.burnAmount + distribution.executorAmount, distribution.newlyCollected, "Actual fee split conserves every unit");
    const credit = await readContractAt(hub, lifecycleFeeHubAbi, "claimableOwnerFees", [plan.creator, policy.asset]);
    assert.equal(credit - claimableBefore[assetIndex], distribution.ownerAmount, "Real owner proceeds become exact withdrawable credits");
    if (progress.canonical.rewards !== zeroAddress) assert.equal(await readContractAt(policy.asset, lifecycleErc20Abi, "balanceOf", [progress.canonical.rewards]) - rewardsBefore[assetIndex], distribution.rewardsAmount, "Real rewards custody receives the exact committed share");
    assert.equal(await readContractAt(policy.asset, lifecycleErc20Abi, "balanceOf", [hub]), await readContractAt(hub, lifecycleFeeHubAbi, "reservedOwnerFees", [policy.asset]), "No unaccounted fee inventory remains in the finalized hub");
    let ownerClaim;
    if (credit > 0n) {
      const before = await readContractAt(policy.asset, lifecycleErc20Abi, "balanceOf", [plan.creator]);
      ownerClaim = await sendContract(plan.creator, hub, lifecycleFeeHubAbi, "claimOwnerFees", [policy.asset, plan.creator]);
      assert.equal(await readContractAt(policy.asset, lifecycleErc20Abi, "balanceOf", [plan.creator]) - before, credit, "Actual owner fee withdrawal delivers exact credited units");
      assert.equal(await readContractAt(hub, lifecycleFeeHubAbi, "claimableOwnerFees", [plan.creator, policy.asset]), 0n);
    }
    feeClaims.push({ asset: policy.asset, newlyCollected: distribution.newlyCollected.toString(), executorAmount: distribution.executorAmount.toString(), ownerAmount: distribution.ownerAmount.toString(), rewardsAmount: distribution.rewardsAmount.toString(), burnAmount: distribution.burnAmount.toString(), ownerClaimHash: ownerClaim?.transactionHash });
  }
  for (const market of progress.markets.filter((item) => item.prepared.identity.venue === 0)) for (const asset of [market.prepared.identity.currency0, market.prepared.identity.currency1]) assert.equal(await readContractAt(market.prepared.identity.hook, lifecycleV4HookAbi, "pendingFees", [market.prepared.identity.poolId, asset]), 0n, "Actual hub claim settles every V4 hook liability");
  results.push({ ...workload, name: fixture.name, requestedMode: fixture.mode, selectedMode, admitted: true, outcome: "active", topology: bound ? "pool-bound" : "shared", tokenKind: Number(plan.token.kind), token: progress.token, planHash: progress.planHash, phase: "Active", positions: progress.canonical.positionCount, markets: progress.canonical.marketCount, orderedBuys: buyEvents.length, buyEvents, backend: replay.backend, actualSteps, hookDeployments, predeploymentHash: predeployment?.transactionHash, oracleHistory, feeClaimHash: feeReceipt.transactionHash, feeClaims });
}
for (const fixture of smokeRows) await isolatedFixture(fixture, () => runFixture(fixture));
for (const fixture of smokeRows) {
  const requested = results.find((row) => row.name === fixture.name && row.selectedMode === fixture.mode);
  assert.ok(requested && (requested.admitted || intentionalRefusal.has(requested.outcome)), `${fixture.name}: actual requested-mode outcome is missing or unproven`);
  assert.equal(requested.planHash.toLowerCase(), fixture.planHash.toLowerCase(), `${fixture.name}: measured execution cannot change the committed economics`);
  if (fixture.mode === "atomic" && !requested.admitted && fixture.workload !== "representative-one-opening-swap" && process.env.LAUNCH_LIFECYCLE_EXPLICIT_STAGED_FALLBACK === "1") {
    const staged = results.find((row) => row.name === fixture.name && row.selectedMode === "staged");
    assert.ok(staged && (staged.admitted || intentionalRefusal.has(staged.outcome)), `${fixture.name}: explicitly consented staged measurement is missing or unproven`);
    assert.equal(staged.planHash.toLowerCase(), fixture.planHash.toLowerCase());
  }
}
for (const kind of [0, 1]) {
  assert.ok(results.some((row) => row.admitted && row.selectedMode === "staged" && row.tokenKind === kind), `an admitted staged ERC${kind === 0 ? "20" : "404"} row is required`);
}
for (const { name, tokenKind, quoteCount } of boundOnlyCompanions) {
  const result = results.find((row) => row.name === name && row.selectedMode === "staged" && row.admitted);
  assert.ok(result, `${name}: the separate committed V4-only multiquote offering must actually activate`);
  assert.equal(result.topology, "pool-bound");
  assert.equal(result.tokenKind, tokenKind);
  assert.equal(result.markets, quoteCount);
  assert.equal(result.hookDeployments.length, quoteCount);
  assert.equal(result.oracleHistory.length, quoteCount);
  const fixture = exported.poolBoundFixtures.find((row) => row.name === name);
  for (const market of fixture.plan.markets) {
    const claim = result.feeClaims.find((item) => item.asset.toLowerCase() === market.quoteAsset.toLowerCase());
    assert.ok(claim && BigInt(claim.newlyCollected) > 0n && claim.ownerClaimHash, `${name}: every committed quote produces real collected and withdrawn opening fees`);
  }
}
for (const profile of [0, 1, 2, 3, 4, 5, 6, 7]) {
  const rows = exported.catalogueFixtures.filter((fixture) => fixture.catalogueProfile === profile);
  assert.equal(rows.length, 4);
  for (const offering of ["shared-v4", "pool-bound-v4"]) {
    const atomic = rows.find((row) => row.offering === offering && row.mode === "atomic");
    const staged = rows.find((row) => row.offering === offering && row.mode === "staged");
    assert.equal(atomic.encodedPlan.toLowerCase(), staged.encodedPlan.toLowerCase(), "Explicit staged path keeps the full atomic plan/economics");
    const actual = results.find((row) => row.name === staged.name && row.selectedMode === "staged");
    assert.ok(actual?.admitted, `${staged.name}: full one-buy catalogue staged path must reach actual Active`);
    assert.equal(actual.openingBuyCount, 1);
    assert.equal(actual.orderedBuys, 1);
    assert.equal(actual.positions, staged.corePositionCount);
  }
  assert.equal(new Set(rows.map((row) => row.predictedToken.toLowerCase())).size, 1, "Paired modes/offerings retain the identical token identity");
}
console.log(JSON.stringify({ schema: "black-market.launch-lifecycle-sdk-smoke.v1", sdk: "@black-market/sdk/lifecycle", chainId: chainId.toString(), executionLimits: configured, scenarioIsolation: { method: "independent-local-snapshot", sourceRestored: true, receiptEvidence: "observed-before-rollback" }, results }, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));
