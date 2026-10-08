// Deliberately executing proof on an owned disposable loopback fixture only.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decodeEventLog, decodeFunctionResult, encodeFunctionData, toHex, zeroHash } from "viem";
import {
  buildClaimDeveloperFeesPageTransaction, buildNextTransaction, buildPoolBoundHookDeploymentTransaction,
  createControlledLifecycleFork, decodeDeveloperClaimReceipt, decodePoolBoundV4LifecycleMarketConfig,
  encodeLaunchPlan, encodePoolBoundV4LifecycleMarketConfig, hashLaunchIdentity, hashLaunchPlan,
  launchLifecycleAbi, lifecycleAdapterAbi, lifecycleDirectoryAbi, lifecycleErc20Abi, lifecycleFeeHubAbi,
  LifecyclePhase, parseLaunchPlan, planLaunch, predictLifecycleToken, prepareAndPlanLifecycleLaunch,
  readAuthorHubs, readDeveloperFees, readLaunchProgress, readLifecycleProfiles, readPoolBoundHookDeployment,
  simulateLaunchPlan, isPoolBoundV4ConfigVersion,
} from "@black-market/sdk/lifecycle";
const [manifestFile, plansFile] = process.argv.slice(2);
if (!manifestFile || !plansFile) throw new Error("Usage: node examples/launch-lifecycle-smoke.mjs manifest.json sdk-plans.json");
const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
const exported = JSON.parse(await readFile(plansFile, "utf8"));
const rpcUrl = process.env.LAUNCH_LIFECYCLE_RPC_URL;
const forkRpcUrl = process.env.LAUNCH_LIFECYCLE_FORK_RPC_URL;
if (!rpcUrl || !forkRpcUrl || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(rpcUrl).hostname) || process.env.LAUNCH_LIFECYCLE_ALLOW_LOCAL_EXECUTION !== "1" || manifest.fixtureOnly !== true) throw new Error("Smoke requires explicitly authorized owned loopback fixture execution and a separate disposable fork");
if (!Array.isArray(exported.plans) || exported.plans.length === 0) throw new Error("Current Solidity-exported reviewed plans are required");
let requestId = 0;
const client = { async request({ method, params = [] }) {
  const response = await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }) });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw Object.assign(new Error(`${method}: ${body.error.message}`), { data: body.error.data });
  return body.result;
} };
const chainId = BigInt(await client.request({ method: "eth_chainId" }));
assert.equal(chainId, BigInt(manifest.chainId));
const policy = manifest.executionLimits;
assert.equal(policy?.provenance?.scope, "controlled-local-measurement", "Operator policy must not invent live RPC/account limits");
const limits = async ({ block, chainId, account, orchestrator }) => ({
  chainId, account, orchestrator, observedBlockNumber: block.number, observedBlockHash: block.hash,
  chainGasLimit: BigInt(policy.chainTransactionGasLimit), rpcGasLimit: BigInt(policy.rpcTransactionGasLimit),
  accountGasLimit: BigInt(policy.accountTransactionGasLimit), maxCalldataBytes: Number(policy.maxCalldataBytes), headroomBps: Number(policy.headroomBps),
});
const fork = createControlledLifecycleFork({ sourceRpcUrl: rpcUrl, forkRpcUrl, allowTransactions: true, impersonation: "anvil" });
async function readContract(to, abi, functionName, args = []) {
  return decodeFunctionResult({ abi, functionName, data: await client.request({ method: "eth_call", params: [{ to, data: encodeFunctionData({ abi, functionName, args }) }, "latest"] }) });
}
async function send(transaction) {
  assert.equal(BigInt(transaction.chainId), chainId);
  assert.equal(BigInt(await client.request({ method: "eth_chainId" })), chainId, "Owned execution RPC must remain on the reviewed chain");
  const gasPrice = transaction.gasPrice ?? BigInt(await client.request({ method: "eth_gasPrice" }));
  const head = await client.request({ method: "eth_getBlockByNumber", params: ["latest", false] });
  const ceiling = [BigInt(head.gasLimit), BigInt(policy.chainTransactionGasLimit), BigInt(policy.rpcTransactionGasLimit), BigInt(policy.accountTransactionGasLimit)].reduce((a, b) => a < b ? a : b);
  const wire = { from: transaction.from, to: transaction.to, data: transaction.data, value: toHex(transaction.value), gasPrice: toHex(gasPrice) };
  const estimated = transaction.gas ?? ((BigInt(await client.request({ method: "eth_estimateGas", params: [{ ...wire, gas: toHex(ceiling) }] })) * BigInt(10000 + Number(policy.headroomBps)) + 9999n) / 10000n);
  assert.ok(estimated <= ceiling, "Unsigned helper must still fit explicit local execution admission");
  const transactionHash = await client.request({ method: "eth_sendTransaction", params: [{ ...wire, gas: toHex(estimated) }] });
  let receipt;
  for (const deadline = Date.now() + 30000; Date.now() < deadline;) {
    receipt = await client.request({ method: "eth_getTransactionReceipt", params: [transactionHash] });
    if (receipt) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(receipt?.status, "0x1", `Actual local transaction must succeed: ${transactionHash}`);
  return { receipt, reference: { transactionHash, observedBlockNumber: BigInt(receipt.blockNumber), observedBlockHash: receipt.blockHash, confirmations: 1 } };
}
function events(receipt, address, abi, name) {
  return receipt.logs.filter((log) => log.address.toLowerCase() === address.toLowerCase()).flatMap((log) => {
    try { const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics, strict: true }); return decoded.eventName === name ? [decoded.args] : []; } catch { return []; }
  });
}
const profiles = await readLifecycleProfiles({ client, orchestrator: manifest.addresses.orchestrator });
for (const row of exported.plans) for (const market of parseLaunchPlan(JSON.stringify(row.plan)).markets) {
  const profile = profiles.find((profile) => profile.id.toLowerCase() === market.profileId.toLowerCase());
  assert.equal(profile?.admitted, true, profile?.reason);
}
const results = [];
for (const row of exported.plans) for (const mode of ["atomic", "staged"]) {
  const snapshot = await client.request({ method: "evm_snapshot" });
  try {
    let plan = parseLaunchPlan(JSON.stringify(row.plan));
    assert.equal(encodeLaunchPlan(plan).toLowerCase(), row.encodedPlan.toLowerCase());
    assert.equal(hashLaunchPlan(plan).toLowerCase(), row.planHash.toLowerCase());
    assert.equal(hashLaunchIdentity(plan).toLowerCase(), row.launchId.toLowerCase());
    assert.equal((await predictLifecycleToken({ client, plan })).toLowerCase(), row.predictedToken.toLowerCase());
    const draft = { ...plan, markets: plan.markets.map((market) => isPoolBoundV4ConfigVersion(market.configVersion) ? {
      ...market, config: encodePoolBoundV4LifecycleMarketConfig({ ...decodePoolBoundV4LifecycleMarketConfig(market.config, market.configVersion), hookSalt: zeroHash }),
    } : market) };
    let planned = await prepareAndPlanLifecycleLaunch({ client, account: draft.creator, plan: draft, mode, limits, fork });
    plan = planned.plan;
    assert.equal(hashLaunchPlan(plan).toLowerCase(), row.planHash.toLowerCase(), "Offchain mining reproduces the independent constructor/salt vector");
    if (mode === "staged") for (const deployment of planned.hookDeployments) {
      const unsigned = await buildPoolBoundHookDeploymentTransaction({ client, plan, marketIndex: deployment.marketIndex });
      await send({ chainId: Number(chainId), from: plan.creator, ...unsigned });
      const actual = await readPoolBoundHookDeployment({ client, plan, marketIndex: deployment.marketIndex });
      assert.equal(actual.predictedHook.toLowerCase(), deployment.predictedHook.toLowerCase());
    }
    if (mode === "staged" && planned.hookDeployments.length > 0) planned = await planLaunch({ client, account: plan.creator, plan, mode, limits, fork });
    assert.equal(planned.simulation.admitted, true, planned.simulation.reason);
    const atomicReceipt = planned.simulation.steps.find((step) => step.transactionId === "atomic")?.returnData;
    if (atomicReceipt) {
      const decoded = decodeFunctionResult({ abi: launchLifecycleAbi, functionName: "launchAtomic", data: atomicReceipt });
      assert.equal(decoded.planHash.toLowerCase(), planned.planHash.toLowerCase());
      for (let i = 0; i < plan.buys.length; ++i) assert.ok(decoded.tokenOut[i] >= plan.buys[i].minTokenOut);
    }
    const replay = await simulateLaunchPlan({ client, planned, limits, fork });
    assert.equal(replay.admitted, true, replay.reason);
    const receipts = [];
    let activationReceipt;
    for (let guard = 0; guard < 64; ++guard) {
      const next = await buildNextTransaction({ client, planned, receipts, limits, fork, submissionClient: client });
      if (!next) break;
      assert.equal(next.admission?.transportPreflight, "passed");
      const submitted = await send(next);
      receipts.push(submitted.reference);
      if (["atomic", "activate"].includes(next.kind)) activationReceipt = submitted.receipt;
    }
    const progress = await readLaunchProgress({ client, planned, receipts });
    assert.equal(progress.canonical.phase, LifecyclePhase.Active);
    assert.equal(progress.token.toLowerCase(), row.predictedToken.toLowerCase());
    assert.equal(progress.canonical.marketCount, plan.markets.length);
    const buys = events(activationReceipt, plan.orchestrator, launchLifecycleAbi, "InitialBuyExecuted");
    assert.equal(buys.length, plan.buys.length);
    for (let i = 0; i < buys.length; ++i) {
      assert.equal(buys[i].buyIndex, i); assert.equal(buys[i].marketIndex, plan.buys[i].marketIndex);
      assert.ok(buys[i].tokenOut >= plan.buys[i].minTokenOut); assert.ok(buys[i].quoteSpent <= plan.buys[i].quoteAmountIn);
    }
    const directory = await readContract(plan.orchestrator, launchLifecycleAbi, "directory");
    for (const market of progress.markets) {
      assert.equal(market.live.publicTrading, true);
      const positions = await readContract(directory, lifecycleDirectoryAbi, "positions", [planned.launchId, market.index, 0n, 32n]);
      const profile = profiles.find((profile) => profile.id.toLowerCase() === market.prepared.identity.profileId.toLowerCase());
      for (const position of positions) {
        const [liquidity, custody] = await readContract(profile.adapter.implementation, lifecycleAdapterAbi, "readPosition", [position]);
        assert.equal(liquidity, position.liquidity); assert.equal(custody.toLowerCase(), market.prepared.custody.toLowerCase());
      }
    }
    assert.equal(await buildNextTransaction({ client, planned, receipts, limits, fork }), undefined);
    const hub = progress.canonical.feeHub;
    assert.equal(await readContract(hub, lifecycleFeeHubAbi, "economicVersion"), 3);
    const authors = new Map();
    for (const source of await readContract(hub, lifecycleFeeHubAbi, "sources")) {
      const terms = await readContract(hub, lifecycleFeeHubAbi, "sourceTerms", [source]);
      if (terms.developerFeeBps > 0) authors.set(terms.beneficiary.toLowerCase(), terms.beneficiary);
    }
    const ownerBefore = await Promise.all(plan.feeAssets.map((policy) => readContract(hub, lifecycleFeeHubAbi, "claimableOwnerFees", [plan.creator, policy.asset])));
    const harvestData = encodeFunctionData({ abi: lifecycleFeeHubAbi, functionName: "claimAndSplit", args: [] });
    const preview = decodeFunctionResult({ abi: lifecycleFeeHubAbi, functionName: "claimAndSplit", data: await client.request({ method: "eth_call", params: [{ from: plan.creator, to: hub, data: harvestData }, "latest"] }) });
    const harvest = await send({ chainId: Number(chainId), from: plan.creator, to: hub, data: harvestData, value: 0n });
    const distributions = events(harvest.receipt, hub, lifecycleFeeHubAbi, "Distributed");
    assert.ok(distributions.some((event) => event.newlyCollected > 0n), "Real opening swaps produce actual source fees");
    for (let i = 0; i < plan.feeAssets.length; ++i) {
      const policy = plan.feeAssets[i];
      const distribution = distributions.find((event) => event.asset.toLowerCase() === policy.asset.toLowerCase());
      assert.equal(distribution.ownerAmount + distribution.developerAmount + distribution.executorAmount + distribution.rewardsAmount + distribution.burnAmount, distribution.newlyCollected);
      assert.equal(preview.find((payment) => payment.asset.toLowerCase() === policy.asset.toLowerCase()).amount, distribution.executorAmount);
      assert.equal(await readContract(hub, lifecycleFeeHubAbi, "claimableOwnerFees", [plan.creator, policy.asset]) - ownerBefore[i], distribution.ownerAmount);
      assert.equal(await readContract(policy.asset, lifecycleErc20Abi, "balanceOf", [hub]),
        await readContract(hub, lifecycleFeeHubAbi, "reservedOwnerFees", [policy.asset]) + await readContract(hub, lifecycleFeeHubAbi, "reservedDeveloperFees", [policy.asset]));
    }
    const claims = [];
    for (const authorId of authors.values()) {
      const discovered = await readAuthorHubs({ client, registry: manifest.addresses.implementationRegistry, authorId });
      assert.ok(discovered.hubs.some((value) => value.toLowerCase() === hub.toLowerCase()));
      const fees = await readDeveloperFees({ client, registry: discovered.registry, authorId, hub });
      const balancesBefore = await Promise.all(fees.assets.map((asset) => readContract(asset, lifecycleErc20Abi, "balanceOf", [fees.payout])));
      const unsigned = await buildClaimDeveloperFeesPageTransaction({ client, registry: discovered.registry, authorId, offset: 0n, limit: 10n, assets: [], account: plan.creator, chainId });
      // Bound every page child call with the explicit owned-fixture operator ceiling;
      // eth_estimateGas may otherwise succeed after reporting gas-starved failed rows.
      const head = await client.request({ method: "eth_getBlockByNumber", params: ["latest", false] });
      const pageGas = [BigInt(head.gasLimit), BigInt(policy.chainTransactionGasLimit), BigInt(policy.rpcTransactionGasLimit), BigInt(policy.accountTransactionGasLimit)].reduce((a, b) => a < b ? a : b);
      const claim = await send({ ...unsigned, gas: pageGas });
      const result = decodeDeveloperClaimReceipt({ receipt: claim.receipt, transaction: unsigned });
      assert.equal(result.cursorComplete, true); assert.equal(result.paymentsSucceeded, true);
      for (let i = 0; i < fees.assets.length; ++i) {
        const amount = result.results.filter((row) => row.asset.toLowerCase() === fees.assets[i].toLowerCase()).reduce((total, row) => total + row.amount, 0n);
        assert.equal(await readContract(fees.assets[i], lifecycleErc20Abi, "balanceOf", [fees.payout]) - balancesBefore[i], amount);
      }
      claims.push({ authorId, transactionHash: claim.reference.transactionHash, result });
    }
    results.push({ name: row.name, mode, phase: "Active", planHash: planned.planHash, token: progress.token, backend: replay.backend, receipts, buys, distributions, claims });
  } finally {
    assert.equal(await client.request({ method: "evm_revert", params: [snapshot] }), true);
    await client.request({ method: "evm_mine" });
  }
}
console.log(JSON.stringify({ schema: "black-market.node-sdk-smoke.v1", results }, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));
