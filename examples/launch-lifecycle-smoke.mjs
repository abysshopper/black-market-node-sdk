import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decodeEventLog, decodeFunctionResult, encodeFunctionData, parseAbi, toFunctionSelector, toHex } from "viem";
import {
  buildNextTransaction, createControlledLifecycleFork, encodeLaunchPlan, hashLaunchIdentity, hashLaunchPlan, launchLifecycleAbi,
  decodeAbyssLifecycleMarketConfig, decodeV4LifecycleMarketConfig, LifecyclePhase, parseLaunchPlan, planLaunch, predictLifecycleToken,
  readLaunchProgress, simulateLaunchPlan,
} from "../dist/lifecycle/index.js";

const [manifestFile, fixturesFile] = process.argv.slice(2);
if (!manifestFile || !fixturesFile) throw new Error("Usage: node examples/launch-lifecycle-smoke.mjs manifest.json sdk-plans.json");
const rpcUrl = process.env.LAUNCH_LIFECYCLE_RPC_URL;
if (!rpcUrl || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(rpcUrl).hostname) || process.env.LAUNCH_LIFECYCLE_ALLOW_LOCAL_EXECUTION !== "1") throw new Error("Actual SDK smoke requires explicitly authorized disposable loopback RPC execution");
const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
const exported = JSON.parse(await readFile(fixturesFile, "utf8"));
if (!Array.isArray(exported.fixtures) || exported.fixtures.length === 0) throw new Error("Expected actual Solidity-exported fixture array");
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
  const result = await client.request({ method: "eth_call", params: [{ to: v4 ? manifest.addresses.v4Hook : identity.pool, data }, blockNumber] });
  return decodeFunctionResult({ abi, functionName: "observeTruncated", data: result });
}
const chainId = BigInt(await client.request({ method: "eth_chainId" }));
assert.equal(chainId, BigInt(manifest.chainId));
const configured = manifest.executionLimits ?? {};
const limits = async ({ block, chainId, account, orchestrator }) => ({
  chainId, account, orchestrator, observedBlockNumber: block.number, observedBlockHash: block.hash,
  chainGasLimit: configured.chainTransactionGasLimit === undefined ? undefined : BigInt(configured.chainTransactionGasLimit) < block.gasLimit ? BigInt(configured.chainTransactionGasLimit) : block.gasLimit,
  rpcGasLimit: process.env.LAUNCH_LIFECYCLE_RPC_GAS_CAP === undefined ? configured.rpcTransactionGasLimit === undefined ? undefined : BigInt(configured.rpcTransactionGasLimit) : BigInt(process.env.LAUNCH_LIFECYCLE_RPC_GAS_CAP),
  accountGasLimit: process.env.LAUNCH_LIFECYCLE_ACCOUNT_GAS_CAP === undefined ? configured.accountTransactionGasLimit === undefined ? undefined : BigInt(configured.accountTransactionGasLimit) : BigInt(process.env.LAUNCH_LIFECYCLE_ACCOUNT_GAS_CAP),
  maxCalldataBytes: Number(process.env.LAUNCH_LIFECYCLE_CALLDATA_CAP_BYTES ?? configured.maxCalldataBytes) || undefined,
  headroomBps: Number(process.env.LAUNCH_LIFECYCLE_HEADROOM_BPS ?? configured.headroomBps ?? 1500),
});
const forkUrl = process.env.LAUNCH_LIFECYCLE_FORK_RPC_URL;
if (!forkUrl) throw new Error("Actual SDK sequential fallback requires a distinct disposable LAUNCH_LIFECYCLE_FORK_RPC_URL");
const fork = createControlledLifecycleFork({ sourceRpcUrl: rpcUrl, forkRpcUrl: forkUrl, allowTransactions: true, impersonation: "anvil" });
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

const smokeRows = [...exported.fixtures, ...(exported.admitted ? [exported.admitted] : [])];
const intentionalRefusal = new Set(["gas-cap-refusal"]);
const refusalOutcome = (simulation, transactions) => {
  const ceiling = simulation.limits.executionGasCeiling;
  if (simulation.confidence !== "stateful" || ceiling <= 0n) return `failure:${simulation.reason ?? "unmeasured refusal"}`;
  const index = simulation.steps.findIndex((step) => step.transactionId === simulation.failedTransactionId);
  const step = simulation.steps[index];
  const transaction = transactions.find((item) => item.id === step?.transactionId);
  if (transaction && ["activate", "atomic"].includes(transaction.kind)
    && simulation.steps.slice(0, index).every((item) => item.success)) {
    if (!step.success && step.gasUsed !== undefined && step.gasLimit === ceiling
      && (step.gasUsed >= ceiling - ceiling / 64n || step.outOfGas === true)) return "gas-cap-refusal";
    const required = step.gasRequired ?? step.gasUsed;
    if (step.success && required !== undefined
      && (required * BigInt(10000 + simulation.limits.headroomBps) + 9999n) / 10000n > ceiling
      && simulation.reason?.startsWith("Execution gas plus conservative headroom exceeds current transaction limits")) return "gas-cap-refusal";
  }
  return `failure:${simulation.reason || "unknown refusal"}`;
};

async function refusalEvidence(planned) {
  let simulation = planned.simulation;
  if (refusalOutcome(simulation, planned.transactions) === "gas-cap-refusal") return simulation;
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
      steps.push({ transactionId: transaction.id, transactionHash: hash, success, gasUsed: BigInt(receipt.gasUsed),
        gasLimit: ceiling, outOfGas: failureTrace.some((error) => /\bout of gas\b|\bOutOfGas\b/i.test(error)), failureTrace });
      if (!success) break;
    }
    const failed = steps.find((step) => !step.success);
    simulation = { ...simulation, backend: "controlled-fork", steps, failedTransactionId: failed?.transactionId,
      reason: failed ? "Exact ceiling receipt failure" : "Exact ceiling sequence succeeded; original refusal is not proven gas exhaustion" };
    return simulation;
  } finally {
    await reset();
    assert.equal((await client.request({ method: "eth_getBlockByNumber", params: [tag, false] })).hash.toLowerCase(),
      source.hash.toLowerCase(), "Refusal proof must not outlive its canonical source block");
  }
}
const expectedRows = new Map();
for (const fixture of exported.fixtures) {
  const expectations = [];
  if (typeof fixture.expectedAdmitted === "boolean") expectations.push({ mode: fixture.mode, expected: fixture.expectedAdmitted ? "active" : fixture.expectedOutcome });
  if (fixture.mode === "atomic" && process.env.LAUNCH_LIFECYCLE_EXPLICIT_STAGED_FALLBACK === "1" && fixture.expectedStagedAdmitted !== undefined) {
    expectations.push({ mode: "staged", expected: fixture.expectedStagedAdmitted === true ? "active" : fixture.expectedStagedOutcome });
  }
  if (expectations.length === 0) throw new Error(`Fixture ${fixture.name} lacks an explicit exporter expectation`);
  expectedRows.set(fixture.name, expectations);
}
for (const fixture of smokeRows) {
  const plan = parseLaunchPlan(JSON.stringify(fixture.plan));
  assert.equal(encodeLaunchPlan(plan).toLowerCase(), fixture.encodedPlan.toLowerCase(), "Solidity ABI plan bytes");
  assert.equal(hashLaunchPlan(plan).toLowerCase(), fixture.planHash.toLowerCase(), "Solidity domain commitment");
  assert.equal(hashLaunchIdentity(plan).toLowerCase(), fixture.launchId.toLowerCase(), "Solidity launch identity");
  assert.equal((await predictLifecycleToken({ client, plan })).toLowerCase(), fixture.predictedToken.toLowerCase(), "Deterministic actual token prediction");
  const balanceBefore = await client.request({ method: "eth_getBalance", params: [plan.creator, "latest"] });
  const nonceBefore = await client.request({ method: "eth_getTransactionCount", params: [plan.creator, "latest"] });
  let planned = await planLaunch({ client, account: plan.creator, plan, mode: fixture.mode, limits, fork });
  assert.equal(planned.progress.canonical.phase, LifecyclePhase.None, "Smoke requires an unstarted exact fixture, not an already completed launch");
  assert.equal(await client.request({ method: "eth_getBalance", params: [plan.creator, "latest"] }), balanceBefore, "Snapshot simulation must restore real native balances");
  assert.equal(await client.request({ method: "eth_getTransactionCount", params: [plan.creator, "latest"] }), nonceBefore, "Snapshot simulation must restore real account nonce");
  let selectedMode = fixture.mode;
  if (!planned.simulation.admitted) {
    const evidence = await refusalEvidence(planned);
    results.push({ name: fixture.name, requestedMode: fixture.mode, selectedMode, planHash: planned.planHash, admitted: false, confidence: planned.simulation.confidence, reason: planned.simulation.reason, outcome: refusalOutcome(evidence, planned.transactions), gasEvidence: { backend: evidence.backend, blockNumber: evidence.blockNumber.toString(), blockHash: evidence.blockHash, failedTransactionId: evidence.failedTransactionId, steps: evidence.steps.map(({ transactionId, transactionHash, success, gasUsed, gasLimit, gasRequired, outOfGas, failureTrace }) => ({ transactionId, transactionHash, success, gasUsed: gasUsed?.toString(), gasLimit: gasLimit?.toString(), gasRequired: gasRequired?.toString(), outOfGas, failureTrace })) } });
    if (fixture.expectedAdmitted === true) throw new Error(`${fixture.name}: expected admission was refused: ${planned.simulation.reason}`);
    const expected = fixture.mode === "atomic" ? fixture.expectedOutcome : fixture.expectedStagedOutcome;
    assert.equal(results.at(-1).outcome, expected, `${fixture.name}: refusal must be the expected intentional outcome; ${JSON.stringify(results.at(-1).gasEvidence)}`);
    assert.ok(intentionalRefusal.has(results.at(-1).outcome), `${fixture.name}: refusal is not an intentional known gas-cap refusal: ${planned.simulation.reason}`);
    assert.equal(planned.mode, fixture.mode, "SDK must never silently stage an atomic request");
    if (fixture.mode !== "atomic" || process.env.LAUNCH_LIFECYCLE_EXPLICIT_STAGED_FALLBACK !== "1") continue;
    selectedMode = "staged";
    planned = await planLaunch({ client, account: plan.creator, plan, mode: selectedMode, limits, fork });
    assert.equal(planned.planHash, hashLaunchPlan(plan), "Explicit staged consent cannot change economics");
    if (!planned.simulation.admitted) {
      const evidence = await refusalEvidence(planned);
      results.push({ name: fixture.name, requestedMode: fixture.mode, selectedMode, planHash: planned.planHash, admitted: false, confidence: planned.simulation.confidence, reason: planned.simulation.reason, outcome: refusalOutcome(evidence, planned.transactions), gasEvidence: { backend: evidence.backend, blockNumber: evidence.blockNumber.toString(), blockHash: evidence.blockHash, failedTransactionId: evidence.failedTransactionId, steps: evidence.steps.map(({ transactionId, transactionHash, success, gasUsed, gasLimit, gasRequired, outOfGas, failureTrace }) => ({ transactionId, transactionHash, success, gasUsed: gasUsed?.toString(), gasLimit: gasLimit?.toString(), gasRequired: gasRequired?.toString(), outOfGas, failureTrace })) } });
      assert.equal(fixture.expectedStagedOutcome, results.at(-1).outcome, `${fixture.name}: explicit staged refusal must be the expected intentional outcome; ${JSON.stringify(results.at(-1).gasEvidence)}`);
      assert.ok(intentionalRefusal.has(results.at(-1).outcome), `${fixture.name}: staged refusal is not an intentional known gas-cap refusal`);
      continue;
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
    actualSteps.push({ kind: next.kind, transactionHash: sent.transactionHash, gasUsed: BigInt(sent.receipt.gasUsed).toString(), gasLimit: next.gas.toString() });
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
    const config = identity.venue === 0 ? decodeV4LifecycleMarketConfig(plan.markets[market.index].config) : decodeAbyssLifecycleMarketConfig(plan.markets[market.index].config);
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
  results.push({ name: fixture.name, requestedMode: fixture.mode, selectedMode, admitted: true, outcome: "active", tokenKind: Number(plan.token.kind), token: progress.token, planHash: progress.planHash, phase: "Active", positions: progress.canonical.positionCount, markets: progress.canonical.marketCount, orderedBuys: buyEvents.length, backend: replay.backend, actualSteps, oracleHistory });
}
for (const [name, expectations] of expectedRows) {
  for (const { mode, expected } of expectations) {
    if (expected === "active") assert.ok(results.some((row) => row.name === name && row.selectedMode === mode && row.admitted), `${name}: expected ${mode} admission was rejected`);
    else assert.ok(results.some((row) => row.name === name && !row.admitted && row.selectedMode === mode && row.outcome === expected), `${name}: expected ${mode} ${expected} outcome is missing`);
  }
}
for (const kind of [0, 1]) {
  assert.ok(results.some((row) => row.admitted && row.selectedMode === "staged" && row.tokenKind === kind), `an admitted staged ERC${kind === 0 ? "20" : "404"} row is required`);
}
console.log(JSON.stringify({ sdk: "@black-market/sdk/lifecycle", chainId: chainId.toString(), results }, null, 2));
