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
    results.push({ name: fixture.name, requestedMode: fixture.mode, planHash: planned.planHash, admitted: false, confidence: planned.simulation.confidence, reason: planned.simulation.reason });
    assert.notEqual(fixture.expectedAdmitted, true, `${fixture.name}: ${planned.simulation.reason}`);
    assert.equal(planned.mode, fixture.mode, "SDK must never silently stage an atomic request");
    if (fixture.mode !== "atomic" || process.env.LAUNCH_LIFECYCLE_EXPLICIT_STAGED_FALLBACK !== "1") continue;
    selectedMode = "staged";
    planned = await planLaunch({ client, account: plan.creator, plan, mode: selectedMode, limits, fork });
    assert.equal(planned.planHash, hashLaunchPlan(plan), "Explicit staged consent cannot change economics");
    if (!planned.simulation.admitted) {
      results.push({ name: fixture.name, requestedMode: fixture.mode, selectedMode, planHash: planned.planHash, admitted: false, confidence: planned.simulation.confidence, reason: planned.simulation.reason, failedTransactionId: planned.simulation.failedTransactionId, steps: planned.simulation.steps.map(({ transactionId, success, gasUsed, gasLimit, error }) => ({ transactionId, success, gasUsed: gasUsed?.toString(), gasLimit: gasLimit?.toString(), error })) });
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
  results.push({ name: fixture.name, requestedMode: fixture.mode, selectedMode, admitted: true, token: progress.token, planHash: progress.planHash, phase: "Active", positions: progress.canonical.positionCount, markets: progress.canonical.marketCount, orderedBuys: buyEvents.length, backend: replay.backend, actualSteps, oracleHistory });
}
assert.ok(results.some((row) => row.admitted && row.selectedMode === "atomic"), "At least one complete exact atomic ERC20/ERC404 plan must execute");
assert.ok(results.some((row) => row.admitted && row.selectedMode === "staged"), "At least one explicit staged ERC20/ERC404 plan must execute");
console.log(JSON.stringify({ sdk: "@black-market/sdk/lifecycle", chainId: chainId.toString(), results }, null, 2));
