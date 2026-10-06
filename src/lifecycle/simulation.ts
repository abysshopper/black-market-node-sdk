import { decodeEventLog, decodeFunctionResult, encodeFunctionData, encodeFunctionResult, toHex, type Hex } from "viem";
import { launchLifecycleAbi, lifecycleErc20Abi } from "./abi.js";
import { LifecyclePhase, type LaunchProgressV1, type LaunchReceiptV1 } from "./schema.js";
import { assertLifecycleBlock, lifecyclePinnedRpc, lifecycleRpc, lifecycleSourceClient, lifecycleStage, nitroArbSys, nitroArbSysAbi, nitroGasInfo, nitroGasInfoAbi, readLifecycleBlock, readNitroPosterGas, resolveLifecycleLimits, rpcHex, rpcObject, rpcQuantity } from "./rpc.js";
import { LifecyclePlanningError, type ControlledLifecycleFork, type LifecycleBlock, type LifecycleLimitContext, type LifecycleLimits, type LifecyclePostcondition, type LifecycleRpcClient, type LifecycleSimulation, type LifecycleSimulationStep, type LifecycleTransaction, type PlannedLaunch, type ResolvedLifecycleLimits, type SimulateLaunchPlanOptions } from "./types.js";

function conditionRequest(condition: LifecyclePostcondition, planned: PlannedLaunch): { to: Hex; data: Hex } {
  if (condition.kind === "allowance") return {
    to: condition.asset, data: encodeFunctionData({ abi: lifecycleErc20Abi, functionName: "allowance", args: [planned.account, condition.spender] }),
  };
  return { to: planned.plan.orchestrator, data: encodeFunctionData({ abi: launchLifecycleAbi, functionName: "readLaunchProgress", args: [planned.launchId] }) };
}
function checkCondition(condition: LifecyclePostcondition, data: Hex, planned: PlannedLaunch): void {
  if (condition.kind === "allowance") {
    const allowance = decodeFunctionResult({ abi: lifecycleErc20Abi, functionName: "allowance", data });
    if (allowance < condition.minimum || (condition.exact !== undefined && allowance !== condition.exact)) throw new LifecyclePlanningError("POSTCONDITION_FAILED", "Funding allowance was not established");
    return;
  }
  // The frozen ABI decoder produces the precise progress tuple, including all identity fields.
  const progress = decodeFunctionResult({ abi: launchLifecycleAbi, functionName: "readLaunchProgress", data }) as LaunchProgressV1;
  const phase = LifecyclePhase[condition.phase];
  if (progress.phase !== phase || progress.preparedMarkets !== condition.preparedMarkets || progress.planHash.toLowerCase() !== planned.planHash.toLowerCase() || progress.launchId.toLowerCase() !== planned.launchId.toLowerCase() || progress.token.toLowerCase() !== planned.predictedToken.toLowerCase()) {
    throw new LifecyclePlanningError("POSTCONDITION_FAILED", "Simulation did not establish the committed launch identity, phase and ordered progress");
  }
}

/** Native Nitro eth_simulateV1 executes commit-mode ArbOS charging, including its
 * compute hold after the actual poster charge. A generic EVM/fork is not this proof. */
async function proveNitroBackend(client: LifecycleRpcClient, planned: PlannedLaunch, block: LifecycleBlock, limits: ResolvedLifecycleLimits, gasPrice: bigint): Promise<void> {
  if (limits.arbOSVersion === undefined || limits.maxTxComputeGas === undefined || limits.maxBlockComputeGas === undefined) throw new LifecyclePlanningError("NITRO_METERING_UNAVAILABLE", "Pinned Nitro metering context is incomplete");
  const probes = [
    { to: nitroArbSys, data: encodeFunctionData({ abi: nitroArbSysAbi, functionName: "arbOSVersion" }), expected: limits.arbOSVersion + 55n },
    { to: nitroGasInfo, data: encodeFunctionData({ abi: nitroGasInfoAbi, functionName: "getMaxTxGasLimit" }), expected: limits.maxTxComputeGas },
    { to: nitroGasInfo, data: encodeFunctionData({ abi: nitroGasInfoAbi, functionName: "getMaxBlockGasLimit" }), expected: limits.maxBlockComputeGas },
  ];
  const gas = limits.executionGasCeiling < 100_000n ? limits.executionGasCeiling : 100_000n;
  if (limits.maxSimulationGas !== undefined && gas * BigInt(probes.length) > limits.maxSimulationGas) throw new LifecyclePlanningError("SIMULATION_RPC_CAP", "Nitro metering probe exceeds the supplied RPC aggregate simulation cap");
  // This isolated read-only request does not add synthetic verification transactions to the launch sequence.
  const result = await lifecycleRpc(client, "eth_simulateV1", [{
    validation: true, traceTransfers: false, returnFullTransactions: false,
    blockStateCalls: [{
      // Capability reads are isolated from payer affordability. Real launch replay never overrides balances.
      stateOverrides: { [planned.account]: { balance: toHex((1n << 256n) - 1n) } },
      blockOverrides: { number: toHex(block.number + 1n), time: toHex(block.timestamp + 1n), gasLimit: toHex(block.gasLimit) },
      calls: probes.map(({ to, data }) => ({ from: planned.account, to, data, value: "0x0", gas: toHex(gas), gasPrice: toHex(gasPrice) })),
    }],
  }, toHex(block.number)]);
  if (!Array.isArray(result) || result.length !== 1) throw new LifecyclePlanningError("NITRO_METERING_UNAVAILABLE", "Native simulation omitted the pinned ArbOS metering probe");
  const simulated = rpcObject(result[0], "Nitro metering probe block");
  if (!Array.isArray(simulated.calls) || simulated.calls.length !== probes.length) throw new LifecyclePlanningError("NITRO_METERING_UNAVAILABLE", "Native simulation omitted ArbOS version or compute getters");
  for (let index = 0; index < probes.length; index += 1) {
    const call = rpcObject(simulated.calls[index], "Nitro metering probe");
    const data = rpcHex(call.returnData, "simulated Nitro metering result");
    if (rpcQuantity(call.status, "Nitro metering probe status") !== 1n || rpcQuantity(call.gasUsed, "Nitro metering probe gas") > gas || data.length !== 66 || BigInt(data) !== probes[index]?.expected) {
      throw new LifecyclePlanningError("NITRO_METERING_UNAVAILABLE", "Simulated ArbOS version/compute getters differ from the exact pinned chain context");
    }
  }
  // The enclosing simulation rechecks chain and canonical hash after its proofs
  // (including every refusal path); a separate probe-only recheck is redundant.
}

async function simulateRpcPass(client: LifecycleRpcClient, planned: PlannedLaunch, block: LifecycleBlock, transactions: readonly LifecycleTransaction[], gasLimits: readonly bigint[], limits: ResolvedLifecycleLimits, gasPrice: bigint, validation: boolean): Promise<LifecycleSimulationStep[]> {
  const totalRequestedGas = gasLimits.reduce((total, gas) => total + gas, 0n);
  if (limits.maxSimulationGas !== undefined && totalRequestedGas > limits.maxSimulationGas) throw new LifecyclePlanningError("SIMULATION_RPC_CAP", "Sequential request exceeds the current RPC aggregate simulation gas cap; use an isolated controlled fork");
  // Natural child-block fees must govern fee-bearing admission; overriding
  // baseFeePerGas with the parent's would fabricate a lower envelope and admit
  // calls that the actual chain would reject. eth_simulateV1 derives the child
  // base fee itself; only structural child fields (number/time) and the
  // parent gasLimit are set.
  const blockStateCalls = transactions.map((transaction, index) => ({
    blockOverrides: { number: toHex(block.number + BigInt(index + 1)), time: toHex(block.timestamp + BigInt(index + 1)), gasLimit: toHex(block.gasLimit) },
    calls: [{ from: transaction.from, to: transaction.to, data: transaction.data, value: toHex(transaction.value), gas: toHex(gasLimits[index] ?? limits.executionGasCeiling), gasPrice: toHex(gasPrice) }],
  }));
  const result = await lifecycleRpc(client, "eth_simulateV1", [{ blockStateCalls, validation, traceTransfers: false, returnFullTransactions: false }, toHex(block.number)]);
  if (!Array.isArray(result) || result.length !== transactions.length) throw new LifecyclePlanningError("INVALID_RPC_RESPONSE", "Sequential simulation omitted blocks");
  const steps: LifecycleSimulationStep[] = [];
  for (let index = 0; index < transactions.length; index += 1) {
    const transaction = transactions[index];
    if (transaction === undefined) throw new LifecyclePlanningError("INVALID_SIMULATION", "Missing simulation transaction");
    const simulatedBlock = rpcObject(result[index], "simulated block");
    if (!Array.isArray(simulatedBlock.calls) || simulatedBlock.calls.length !== 1) throw new LifecyclePlanningError("INVALID_RPC_RESPONSE", "Sequential simulation omitted transaction results");
    const call = rpcObject(simulatedBlock.calls[0], "simulated transaction");
    const gasUsed = rpcQuantity(call.gasUsed, "simulated gas used");
    const gasRequired = call.maxUsedGas === undefined ? gasUsed : rpcQuantity(call.maxUsedGas, "simulated gross gas");
    if (gasRequired < gasUsed || gasRequired > (gasLimits[index] ?? 0n)) throw new LifecyclePlanningError("INVALID_RPC_RESPONSE", "Simulated gas use is outside the exact requested envelope");
    const returnData = rpcHex(call.returnData, "simulated return data");
    const success = rpcQuantity(call.status, "simulated status") === 1n;
    let error: string | undefined;
    if (!success) error = call.error === undefined ? `Execution reverted: ${returnData}` : JSON.stringify(call.error);
    if (success) {
      try {
        // Verification reads must not become synthetic transactions that consume creator nonce/fees.
        // Core return tuples/events and subsequent dependent commands prove persisted transitions.
        const events = (Array.isArray(call.logs) ? call.logs : []).flatMap((raw) => {
          const log = rpcObject(raw, "simulation event");
          if (rpcHex(log.address, "simulation event address").toLowerCase() !== planned.plan.orchestrator.toLowerCase() || !Array.isArray(log.topics)) return [];
          const topics = log.topics.map((topic) => rpcHex(topic, "event topic"));
          if (topics.length === 0) return [];
          const event = decodeEventLog({ abi: launchLifecycleAbi, topics: topics as [Hex, ...Hex[]], data: rpcHex(log.data, "simulation event data") });
          return [event];
        });
        if (transaction.kind === "begin") checkCondition({ kind: "launch", phase: "Preparing", preparedMarkets: 0 }, returnData, planned);
        else if (transaction.kind === "prepare") {
          const prepared = events.filter((event) => event.eventName === "MarketPrepared");
          if (prepared.length !== transaction.marketCount || prepared.some((event, ordinal) => event.eventName !== "MarketPrepared" || event.args.launchId.toLowerCase() !== planned.launchId.toLowerCase() || event.args.marketIndex !== (transaction.marketStart ?? 0) + ordinal)) throw new LifecyclePlanningError("POSTCONDITION_FAILED", "Simulation did not prepare each exact ordered market");
        } else if (transaction.kind === "atomic" || transaction.kind === "activate") {
          const functionName = transaction.kind === "atomic" ? "launchAtomic" : "activateLaunch";
          const receipt = decodeFunctionResult({ abi: launchLifecycleAbi, functionName, data: returnData }) as LaunchReceiptV1;
          if (receipt.planHash.toLowerCase() !== planned.planHash.toLowerCase() || receipt.launchId.toLowerCase() !== planned.launchId.toLowerCase() || receipt.token.toLowerCase() !== planned.predictedToken.toLowerCase() || receipt.marketCount !== planned.plan.markets.length || receipt.quoteSpent.length !== planned.plan.buys.length || receipt.tokenOut.length !== planned.plan.buys.length || !events.some((event) => event.eventName === "LaunchActivated" && event.args.planHash.toLowerCase() === planned.planHash.toLowerCase() && event.args.token.toLowerCase() === planned.predictedToken.toLowerCase())) throw new LifecyclePlanningError("POSTCONDITION_FAILED", "Simulation did not atomically complete the committed launch");
          for (let buyIndex = 0; buyIndex < planned.plan.buys.length; buyIndex += 1) {
            const buy = planned.plan.buys[buyIndex];
            if (buy === undefined || (receipt.quoteSpent[buyIndex] ?? buy.quoteAmountIn + 1n) > buy.quoteAmountIn || (receipt.tokenOut[buyIndex] ?? 0n) < buy.minTokenOut) throw new LifecyclePlanningError("POSTCONDITION_FAILED", "Simulation did not satisfy every ordered buy's budget and output minimum");
          }
        } else if (transaction.kind === "cancel" && !events.some((event) => event.eventName === "LaunchCancelled" && event.args.launchId.toLowerCase() === planned.launchId.toLowerCase() && event.args.creator.toLowerCase() === planned.account.toLowerCase())) throw new LifecyclePlanningError("POSTCONDITION_FAILED", "Simulation did not cancel the exact committed launch");
        else if ((transaction.kind === "approve" || transaction.kind === "approve-reset") && returnData !== "0x" && decodeFunctionResult({ abi: lifecycleErc20Abi, functionName: "approve", data: returnData }) !== true) throw new LifecyclePlanningError("POSTCONDITION_FAILED", "Funding approval returned failure");
      } catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
    }
    steps.push({ transactionId: transaction.id, success: success && error === undefined, gasUsed, gasRequired, gasLimit: gasLimits[index], returnData, error });
    if (!success || error !== undefined) break;
  }
  return steps;
}
/** A failure that consumed nearly the whole limit is treated as possible gas-envelope
 *  exhaustion (EIP-150 retention starves forwarded sub-calls; the surfaced revert bytes
 *  may be a wrapped inner bubble rather than empty). Discovery is safe: a genuine
 *  business revert also fails at the exact ceiling, so it can never be masked. */
function looksGasExhausted(step: LifecycleSimulationStep, gasLimit: bigint): boolean {
  return !step.success && step.gasUsed !== undefined && step.gasUsed >= gasLimit - gasLimit / 64n;
}

async function waitForkReceipt(client: LifecycleRpcClient, transactionHash: Hex, timeoutMs: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const receipt = await lifecycleRpc(client, "eth_getTransactionReceipt", [transactionHash]);
    if (receipt !== null) return rpcObject(receipt, "fork receipt");
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 25));
  }
  throw new LifecyclePlanningError("FORK_RECEIPT_TIMEOUT", "The disposable fork did not mine its simulation transaction");
}
async function simulateForkPass(fork: ControlledLifecycleFork, planned: PlannedLaunch, block: LifecycleBlock, transactions: readonly LifecycleTransaction[], gasLimits: readonly bigint[], gasPrice: bigint, measure: boolean, headroomBps: number): Promise<LifecycleSimulationStep[]> {
  if (fork.isolation !== "disposable" || fork.allowTransactions !== true || !fork.sourceRpcUrl || !fork.forkRpcUrl) throw new LifecyclePlanningError("UNSAFE_FORK", "Actual simulation transactions require an explicitly distinct disposable controlled fork");
  const sourceUrl = new URL(fork.sourceRpcUrl);
  const forkUrl = new URL(fork.forkRpcUrl);
  const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"];
  const sourcePort = sourceUrl.port || (sourceUrl.protocol === "https:" ? "443" : "80");
  const forkPort = forkUrl.port || (forkUrl.protocol === "https:" ? "443" : "80");
  if (!loopback.includes(forkUrl.hostname) || sourceUrl.href === forkUrl.href || (loopback.includes(sourceUrl.hostname) && sourcePort === forkPort)) throw new LifecyclePlanningError("UNSAFE_FORK", "Disposable fork must not alias or share the loopback source endpoint");
  let forkBlock = await readLifecycleBlock(fork.client);
  if (fork.sourceRpcUrl !== undefined && forkBlock.hash.toLowerCase() !== block.hash.toLowerCase()) {
    if (block.number > BigInt(Number.MAX_SAFE_INTEGER)) throw new LifecyclePlanningError("FORK_STATE_MISMATCH", "Pinned block is not exactly representable by the fork reset API");
    await lifecycleRpc(fork.client, fork.resetMethod ?? "anvil_reset", [{ forking: { jsonRpcUrl: fork.sourceRpcUrl, blockNumber: Number(block.number) } }]);
    forkBlock = await readLifecycleBlock(fork.client);
  }
  const forkChain = rpcQuantity(await lifecycleRpc(fork.client, "eth_chainId"), "fork chain ID");
  if (forkChain !== planned.chainId || forkChain !== (fork.expectedChainId ?? planned.chainId) || forkBlock.hash.toLowerCase() !== block.hash.toLowerCase() || forkBlock.hash.toLowerCase() !== (fork.expectedBlockHash ?? block.hash).toLowerCase()) throw new LifecyclePlanningError("FORK_STATE_MISMATCH", "Controlled fork must match the exact source chain and pinned latest block before simulation");
  const snapshot = rpcHex(await lifecycleRpc(fork.client, "evm_snapshot"), "fork snapshot");
  const steps: LifecycleSimulationStep[] = [];
  let impersonated = false;
  try {
    if (fork.impersonation !== undefined && fork.impersonation !== "none") {
      await lifecycleRpc(fork.client, `${fork.impersonation}_impersonateAccount`, [planned.account]);
      impersonated = true;
    }
    for (let index = 0; index < transactions.length; index += 1) {
      const transaction = transactions[index];
      let gas = gasLimits[index];
      let gasRequired: bigint | undefined;
      if (transaction === undefined || gas === undefined) throw new LifecyclePlanningError("INVALID_SIMULATION", "Missing fork transaction/gas context");
      try {
        if (measure) {
          const estimated = rpcQuantity(await lifecycleRpc(fork.client, "eth_estimateGas", [{ from: transaction.from, to: transaction.to, data: transaction.data, value: toHex(transaction.value), gasPrice: toHex(gasPrice) }]), "fork sequential gas estimate");
          gasRequired = estimated;
          const buffered = (estimated * BigInt(10000 + headroomBps) + 9999n) / 10000n;
          if (buffered < gas) gas = buffered;
        }
        const hash = rpcHex(await lifecycleRpc(fork.client, "eth_sendTransaction", [{ from: transaction.from, to: transaction.to, data: transaction.data, value: toHex(transaction.value), gas: toHex(gas), gasPrice: toHex(gasPrice) }]), "fork transaction hash");
        const receipt = await waitForkReceipt(fork.client, hash, fork.receiptTimeoutMs ?? 10_000);
        const gasUsed = rpcQuantity(receipt.gasUsed, "fork gas used");
        if (rpcQuantity(receipt.status, "fork transaction status") !== 1n) {
          steps.push({ transactionId: transaction.id, success: false, gasUsed, gasLimit: gas, error: "Actual fork transaction reverted" });
          break;
        }
        const currentBlock = await readLifecycleBlock(fork.client);
        let returnData: Hex | undefined;
        if (transaction.kind === "atomic" || transaction.kind === "activate") {
          const progressData = rpcHex(await lifecycleRpc(fork.client, "eth_call", [{ to: planned.plan.orchestrator, data: encodeFunctionData({ abi: launchLifecycleAbi, functionName: "readLaunchProgress", args: [planned.launchId] }) }, toHex(currentBlock.number)]), "fork activation progress");
          const progress = decodeFunctionResult({ abi: launchLifecycleAbi, functionName: "readLaunchProgress", data: progressData });
          if (!Array.isArray(receipt.logs)) throw new LifecyclePlanningError("POSTCONDITION_FAILED", "Actual fork receipt does not contain canonical launch logs");
          const events = receipt.logs.flatMap((raw) => {
            const log = rpcObject(raw, "fork activation log");
            if (rpcHex(log.address, "fork log emitter").toLowerCase() !== planned.plan.orchestrator.toLowerCase()) return [];
            if (!Array.isArray(log.topics)) throw new LifecyclePlanningError("POSTCONDITION_FAILED", "Actual fork log topics are malformed");
            try { return [decodeEventLog({ abi: launchLifecycleAbi, data: rpcHex(log.data, "fork log data"), topics: log.topics.map((topic) => rpcHex(topic, "fork log topic")) as [Hex, ...Hex[]] })]; }
            catch { return []; }
          });
          const activated = events.filter((event) => event.eventName === "LaunchActivated");
          const buys = events.filter((event) => event.eventName === "InitialBuyExecuted");
          if (activated.length !== 1 || !activated.some((event) => event.eventName === "LaunchActivated" && event.args.launchId.toLowerCase() === planned.launchId.toLowerCase() && event.args.planHash.toLowerCase() === planned.planHash.toLowerCase() && event.args.token.toLowerCase() === planned.predictedToken.toLowerCase()) ||
            progress.phase !== LifecyclePhase.Active || progress.planHash.toLowerCase() !== planned.planHash.toLowerCase() || progress.token.toLowerCase() !== planned.predictedToken.toLowerCase() ||
            buys.length !== planned.plan.buys.length) throw new LifecyclePlanningError("POSTCONDITION_FAILED", "Actual fork activation differs from the exact committed launch");
          const quoteSpent: bigint[] = []; const tokenOut: bigint[] = [];
          for (let buyIndex = 0; buyIndex < buys.length; buyIndex += 1) {
            const event = buys[buyIndex]; const buy = planned.plan.buys[buyIndex];
            if (event?.eventName !== "InitialBuyExecuted" || buy === undefined || event.args.launchId.toLowerCase() !== planned.launchId.toLowerCase() ||
              event.args.buyIndex !== buyIndex || event.args.marketIndex !== buy.marketIndex || event.args.recipient.toLowerCase() !== buy.recipient.toLowerCase() ||
              event.args.quoteAsset.toLowerCase() !== planned.plan.markets[buy.marketIndex]?.quoteAsset.toLowerCase() ||
              event.args.quoteSpent > buy.quoteAmountIn || event.args.tokenOut < buy.minTokenOut) throw new LifecyclePlanningError("POSTCONDITION_FAILED", "Actual fork initial buy differs from its committed index, budget, destination or minimum");
            quoteSpent.push(event.args.quoteSpent); tokenOut.push(event.args.tokenOut);
          }
          returnData = encodeFunctionResult({ abi: launchLifecycleAbi, functionName: transaction.kind === "atomic" ? "launchAtomic" : "activateLaunch", result: {
            launchId: planned.launchId, planHash: progress.planHash, token: progress.token, feeHub: progress.feeHub, rewards: progress.rewards,
            marketCount: progress.marketCount, positionCount: progress.positionCount, quoteSpent, tokenOut,
          } });
        }
        for (const condition of transaction.postconditions) {
          const request = conditionRequest(condition, planned);
          const data = rpcHex(await lifecycleRpc(fork.client, "eth_call", [{ ...request, from: planned.account }, toHex(currentBlock.number)]), "fork postcondition");
          checkCondition(condition, data, planned);
        }
        steps.push({ transactionId: transaction.id, success: true, gasUsed, gasLimit: gas, gasRequired, returnData });
      } catch (failure) {
        steps.push({ transactionId: transaction.id, success: false, gasLimit: gas, error: failure instanceof Error ? failure.message : String(failure) });
        break;
      }
    }
    return steps;
  } finally {
    try {
      if (impersonated && fork.impersonation !== undefined) await lifecycleRpc(fork.client, `${fork.impersonation}_stopImpersonatingAccount`, [planned.account]);
    } finally {
      if (await lifecycleRpc(fork.client, "evm_revert", [snapshot]) !== true) throw new LifecyclePlanningError("FORK_CLEANUP_FAILED", "Disposable fork snapshot could not be reverted; do not reuse this RPC");
    }
  }
}

/** Internal one-shot continuation. Only SDK reads can produce its context; callers
 * cannot supply resolved policy or account/chain observations as authority. */
export function prepareLaunchSimulation(options: SimulateLaunchPlanOptions, block: LifecycleBlock, hasTransactions = true): (transactions: readonly LifecycleTransaction[]) => Promise<LifecycleSimulation> {
  const { client, planned } = options;
  const sourceClient = lifecycleSourceClient(client);
  const blockNumber = block.number, blockHash = block.hash;
  const context = { client, account: planned.account, orchestrator: planned.plan.orchestrator, block, chainId: planned.chainId };
  const pending = (async () => {
    if (options.fork !== undefined && lifecycleSourceClient(options.fork.client) === sourceClient) throw new LifecyclePlanningError("UNSAFE_FORK", "Source RPC must never receive controlled simulation transactions/snapshots/resets");
    return lifecycleStage(client, "simulation.context", () => Promise.all([
      resolveLifecycleLimits(context, options.limits === undefined ? planned.limits : options.limits),
      lifecycleRpc(client, "eth_chainId"),
      lifecyclePinnedRpc(client, "eth_getCode", [context.account, toHex(block.number)], block),
      hasTransactions ? lifecycleRpc(client, "eth_gasPrice") : undefined,
    ]));
  })().then((observations) => ({ observations }), (failure: unknown) => ({ failure }));
  // Attach the failure handler before input validation can refuse or throw.
  // Preparation is read-only; no probe, measurement, replay or fork work starts.
  let consumed = false;
  return async (transactions) => {
    if (consumed) throw new LifecyclePlanningError("INVALID_SIMULATION", "Prepared simulation context is invocation-local and may only be consumed once");
    consumed = true;
    const result = await pending;
    if ("failure" in result) throw result.failure;
    if (options.client !== client || options.planned !== planned || context.client !== client || context.block !== block || lifecycleSourceClient(client) !== sourceClient ||
      planned.account !== context.account || planned.plan.orchestrator !== context.orchestrator || planned.chainId !== context.chainId ||
      block.number !== blockNumber || block.hash !== blockHash) throw new LifecyclePlanningError("LIMIT_CONTEXT_MISMATCH", "Prepared simulation context differs from the bound source/chain/account/core/block");
    return simulateLaunchTransactionsWithContext(options, transactions, context, result.observations);
  };
}

export async function simulateLaunchTransactions(options: SimulateLaunchPlanOptions, transactions: readonly LifecycleTransaction[], pinnedBlock?: LifecycleBlock): Promise<LifecycleSimulation> {
  // Standalone calls always produce fresh context, including live chain and fees.
  if (options.fork !== undefined && lifecycleSourceClient(options.fork.client) === lifecycleSourceClient(options.client)) throw new LifecyclePlanningError("UNSAFE_FORK", "Source RPC must never receive controlled simulation transactions/snapshots/resets");
  const block = pinnedBlock ?? await readLifecycleBlock(options.client);
  return prepareLaunchSimulation(options, block, transactions.length !== 0)(transactions);
}

async function simulateLaunchTransactionsWithContext(
  options: SimulateLaunchPlanOptions,
  transactions: readonly LifecycleTransaction[],
  context: LifecycleLimitContext,
  observations: [{ limits: ResolvedLifecycleLimits; configuration: LifecycleLimits }, unknown, unknown, unknown],
): Promise<LifecycleSimulation> {
  const { client, planned } = options;
  const sourceClient = lifecycleSourceClient(client);
  const { block } = context;
  const [{ limits, configuration }, chainId, accountCodeValue, gasPriceValue] = observations;
  const base = { confidence: "stateful" as const, executionProof: "failed" as const, protocolFit: "unknown" as const, transportPreflight: "not-requested" as const, blockNumber: block.number, blockHash: block.hash, account: planned.account, chainId: planned.chainId, limits };
  if (rpcQuantity(chainId, "chain ID") !== planned.chainId) throw new LifecyclePlanningError("CHAIN_MISMATCH", "RPC chain changed before sequential simulation");
  const accountCode = rpcHex(accountCodeValue, "account code");
  if (accountCode !== "0x") return { ...base, confidence: "provisional", executionProof: "unavailable", backend: "unavailable", admitted: false, steps: [], reason: "Direct EOA transaction simulation cannot prove smart-account signature/execution behavior" };
  for (const transaction of transactions) {
    if (transaction.from.toLowerCase() !== planned.account.toLowerCase() || BigInt(transaction.chainId) !== planned.chainId) throw new LifecyclePlanningError("ACCOUNT_MISMATCH", "Simulation transaction differs from the committed chain/account");
    if (limits.maxCalldataBytes !== undefined && (transaction.data.length - 2) / 2 > limits.maxCalldataBytes) return { ...base, executionProof: "unavailable", protocolFit: "failed", backend: "unavailable", admitted: false, steps: [], failedTransactionId: transaction.id, reason: "Exact calldata exceeds the supplied chain/account/RPC byte cap" };
  }
  if (transactions.length === 0) { await assertLifecycleBlock(client, block, planned.chainId); return { ...base, executionProof: "proved", protocolFit: "proved", backend: "unavailable", admitted: true, steps: [] }; }
  const gasPrice = rpcQuantity(gasPriceValue, "gas price");
  if (gasPrice >= 1n << 256n) throw new LifecyclePlanningError("INVALID_RPC_RESPONSE", "Gas price must be a uint256 quantity");
  const buffer = (gas: bigint) => (gas * BigInt(10000 + limits.headroomBps) + 9999n) / 10000n;
  const computeCeiling = limits.transactionGasCeiling !== undefined && limits.transactionGasCeiling < limits.executionGasCeiling ? limits.transactionGasCeiling : limits.executionGasCeiling;
  const capGas = transactions.map(() => computeCeiling);
  let parallelMeasurement: Promise<{ steps: LifecycleSimulationStep[] } | { failure: unknown }> | undefined;
  const posterGas: bigint[] = [];
  if (limits.protocol === "nitro") {
    // The isolated capability probe, poster quote and permissive cap measurement
    // have no data dependency. Only an actually batching source overlaps all three.
    const nitroEvidence = Promise.all([
      lifecycleStage(client, "simulation.nitro", () => proveNitroBackend(client, planned, block, limits, gasPrice)),
      lifecycleStage(client, "simulation.poster", () => Promise.all(transactions.map(async (transaction) => buffer((await readNitroPosterGas(transaction, context)).posterGas)))),
    ]);
    if (sourceClient.supportsReadBatching === true) {
      // Handle settlement immediately so a failed measurement cannot escape while
      // the independent metering evidence is still pending. It is never admission.
      parallelMeasurement = lifecycleStage(client, "simulation.measure", () => simulateRpcPass(client, planned, block, transactions, capGas, limits, gasPrice, false))
        .then((steps) => ({ steps }), (failure: unknown) => ({ failure }));
    }
    try {
      const [, estimates] = await nitroEvidence;
      posterGas.push(...estimates);
    } catch (failure) {
      await assertLifecycleBlock(client, block, planned.chainId);
      return { ...base, confidence: "provisional", executionProof: "unavailable", backend: "unavailable", admitted: false, steps: [], reason: `Native Nitro compute/poster proof unavailable: ${failure instanceof Error ? failure.message : String(failure)}. Generic Anvil/Hardhat forks cannot prove ArbOS metering.` };
    }
  }
  // The poster quote allocates gas only. The native exact replay enforces actual
  // compute hold; subtracting this approximate budget from gasUsed would not.
  const discoveryGas = transactions.map((_, index) => {
    const total = limits.executionGasCeiling + (posterGas[index] ?? 0n);
    const capped = limits.transactionGasCeiling !== undefined && limits.transactionGasCeiling < total ? limits.transactionGasCeiling : total;
    if (capped <= 0n || capped >= 1n << 64n) throw new LifecyclePlanningError("INVALID_GAS_ENVELOPE", "Compute/poster envelope exceeds uint64 gas");
    return capped;
  });
  let backend: "eth_simulateV1" | "controlled-fork" = "eth_simulateV1";
  let measured: LifecycleSimulationStep[];
  // Permissive cap measurement is not proof; only the exact-gas validated replay admits a plan.
  try {
    if (parallelMeasurement === undefined) measured = await lifecycleStage(client, "simulation.measure", () => simulateRpcPass(client, planned, block, transactions, capGas, limits, gasPrice, false));
    else {
      const observation = await parallelMeasurement;
      if ("failure" in observation) throw observation.failure;
      measured = observation.steps;
    }
  }
  catch (failure) {
    if (options.fork === undefined || limits.protocol === "nitro") {
      await assertLifecycleBlock(client, block, planned.chainId);
      return { ...base, confidence: "provisional", executionProof: "unavailable", backend: "unavailable", admitted: false, steps: [], reason: `Stateful sequential RPC simulation unavailable: ${failure instanceof Error ? failure.message : String(failure)}. ${limits.protocol === "nitro" ? "Generic Anvil/Hardhat forks cannot prove ArbOS compute/poster metering." : "Dependent eth_call estimates are not proof."}` };
    }
    backend = "controlled-fork";
    measured = await simulateForkPass(options.fork, planned, block, transactions, capGas, gasPrice, true, limits.headroomBps);
  }
  const failed = measured.find((step) => !step.success);
  if (failed !== undefined) { await assertLifecycleBlock(client, block, planned.chainId); return { ...base, backend, admitted: false, steps: measured, reason: failed.error, failedTransactionId: failed.transactionId }; }
  const computeGas = measured.map((step) => buffer(step.gasRequired ?? step.gasUsed ?? computeCeiling));
  const gasLimits = computeGas.map((gas, index) => gas + (posterGas[index] ?? 0n));
  const exceeds = gasLimits.findIndex((gas, index) => gas <= 0n || gas >= 1n << 64n || (computeGas[index] ?? 0n) > limits.executionGasCeiling || limits.transactionGasCeiling !== undefined && gas > limits.transactionGasCeiling);
  if (exceeds >= 0) {
    await assertLifecycleBlock(client, block, planned.chainId);
    return { ...base, executionProof: "unavailable", protocolFit: "failed", backend, admitted: false, steps: measured, reason: "Execution compute/headroom or complete poster gas envelope is outside positive uint64 gas and current protocol/known transaction limits", failedTransactionId: transactions[exceeds]?.id };
  }
  // Replay from the same initial state with exact headroom limits: gasUsed alone is not an EIP-150/gasleft proof.
  // eth_simulateV1 with validation raises an RPC error on any revert (a generic
  // -32000 "execution failed" carries no gasUsed/returnData), so a validated
  // replay failure surfaces as a thrown error here. Route it through envelope
  // discovery too: EIP-150 retention can starve a forwarded sub-call below the
  // buffered limit while the true envelope still fits the execution ceiling.
  let verified: LifecycleSimulationStep[];
  let validatedReplayError: string | undefined;
  try {
    if (backend === "eth_simulateV1") verified = await lifecycleStage(client, "simulation.replay", () => simulateRpcPass(client, planned, block, transactions, gasLimits, limits, gasPrice, true));
    else {
      if (options.fork === undefined) throw new LifecyclePlanningError("INVALID_SIMULATION", "Controlled fork is missing for the exact-gas replay");
      verified = await simulateForkPass(options.fork, planned, block, transactions, gasLimits, gasPrice, false, limits.headroomBps);
    }
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : String(failure);
    if (backend !== "eth_simulateV1") {
      await assertLifecycleBlock(client, block, planned.chainId);
      return { ...base, backend, admitted: false, steps: [], reason: `Exact-gas validated replay failed: ${message}` };
    }
    validatedReplayError = message;
    verified = [];
  }
  let verifiedSteps = verified;
  let admittedGasLimits = gasLimits;
  let finalFailure = verifiedSteps.find((step) => !step.success);
  if (finalFailure === undefined && validatedReplayError !== undefined) {
    // The buffered validated replay threw before yielding steps. Attempt one
    // explicit envelope-discovery replay at the exact execution ceiling on the
    // same pinned block; headroom is never silently raised — the carried gas is
    // the validated envelope itself.
    try {
      const ceilingLimits = discoveryGas;
      const retried = backend === "eth_simulateV1"
        ? await lifecycleStage(client, "simulation.envelope", () => simulateRpcPass(client, planned, block, transactions, ceilingLimits, limits, gasPrice, true))
        : options.fork === undefined ? undefined : await simulateForkPass(options.fork, planned, block, transactions, ceilingLimits, gasPrice, false, limits.headroomBps);
      if (retried === undefined || retried.some((step) => !step.success)) {
        await assertLifecycleBlock(client, block, planned.chainId);
        return { ...base, backend, admitted: false, steps: measured, reason: `Validated execution at the exact current gas ceiling still failed: ${retried?.find((step) => !step.success)?.error ?? validatedReplayError}; final mint/lock/all-buys/public-opening is indivisible and will not be partitioned`, failedTransactionId: transactions[0]?.id };
      }
      admittedGasLimits = ceilingLimits;
      verifiedSteps = retried;
      finalFailure = undefined;
      validatedReplayError = undefined;
    } catch {
      await assertLifecycleBlock(client, block, planned.chainId);
      return { ...base, backend, admitted: false, steps: measured, reason: `Validated buffered replay failed (${validatedReplayError}) and envelope discovery at the exact gas ceiling was rejected by the simulation backend; final mint/lock/all-buys/public-opening is indivisible`, failedTransactionId: transactions[0]?.id };
    }
  }
  if (finalFailure !== undefined) {
    const failedIndex = verifiedSteps.findIndex((step) => !step.success);
    const bufferedLimit = gasLimits[failedIndex];
    const failedTransaction = transactions[failedIndex];
    if (bufferedLimit !== undefined && failedTransaction !== undefined && looksGasExhausted(finalFailure, bufferedLimit) && (discoveryGas[failedIndex] ?? 0n) > bufferedLimit) {
      // Buffered replay returned an exhaustion-shaped failed step; learn the true
      // validated envelope with one explicit replay at the exact execution ceiling.
      try {
        const ceilingLimits = discoveryGas;
        const retried = backend === "eth_simulateV1"
          ? await simulateRpcPass(client, planned, block, transactions, ceilingLimits, limits, gasPrice, true)
          : options.fork === undefined ? undefined : await simulateForkPass(options.fork, planned, block, transactions, ceilingLimits, gasPrice, false, limits.headroomBps);
        if (retried !== undefined) {
          const retryFailure = retried.find((step) => !step.success);
          if (retryFailure === undefined) {
            admittedGasLimits = ceilingLimits;
            verifiedSteps = retried;
            finalFailure = undefined;
          } else {
            const indivisible = failedTransaction.kind === "activate" || failedTransaction.kind === "atomic";
            await assertLifecycleBlock(client, block, planned.chainId);
            return { ...base, backend, admitted: false, steps: measured, reason: `Validated execution at the exact current gas ceiling still failed: ${retryFailure.error ?? "the true gas envelope exceeds the current execution limit"}${indivisible ? "; final mint/lock/all-buys/public-opening is indivisible and will not be partitioned" : ""}`, failedTransactionId: failedTransaction.id };
          }
        }
      } catch { /* Envelope discovery unavailable; report the original buffered-limit failure unchanged. */ }
    }
  }
  const estimates: LifecycleSimulationStep[] = [];
  const balance = rpcQuantity(await lifecyclePinnedRpc(client, "eth_getBalance", [planned.account, toHex(block.number)], block), "creator native balance");
  let remainingBalance = balance;
  let affordabilityFailure: string | undefined;
  const feeContext = configuration.estimateDataFee === undefined || sourceClient === client ? context : { ...context, client: sourceClient };
  for (let index = 0; index < verifiedSteps.length; index += 1) {
    const step = verifiedSteps[index]; const transaction = transactions[index]; const gasLimit = admittedGasLimits[index];
    if (step === undefined || transaction === undefined || gasLimit === undefined) throw new LifecyclePlanningError("INVALID_SIMULATION", "Missing verified fee context");
    const dataFee = limits.protocol === "nitro" ? 0n : configuration.estimateDataFee === undefined ? undefined : await configuration.estimateDataFee({ ...transaction, gas: gasLimit }, feeContext);
    if (dataFee !== undefined && (typeof dataFee !== "bigint" || dataFee < 0n || dataFee >= 1n << 256n)) throw new LifecyclePlanningError("INVALID_DATA_FEE", "Data-fee oracle must return a nonnegative uint256 bigint amount");
    // Nitro gas includes poster charges. Never add the quoted poster fee again.
    const executionFee = gasLimit * gasPrice;
    const required = transaction.value + executionFee + (dataFee ?? 0n);
    if (required >= 1n << 256n) throw new LifecyclePlanningError("INVALID_GAS_ENVELOPE", "Transaction value and fee envelope exceed uint256");
    if (required > remainingBalance && affordabilityFailure === undefined) affordabilityFailure = "Creator native balance cannot fund the remaining transaction value and execution/data fee envelopes";
    remainingBalance -= required;
    const poster = posterGas[index];
    estimates.push({ ...step, estimate: { gasUsed: step.gasUsed ?? 0n, gasLimit, gasPrice, executionFee, dataFee, posterGas: poster, posterFee: poster === undefined ? undefined : poster * gasPrice, dataFeeIncludedInGas: limits.protocol === "nitro", totalFee: dataFee === undefined ? undefined : executionFee + dataFee, feeConfidence: dataFee === undefined ? "execution-only" : "execution-and-data" } });
  }
  await assertLifecycleBlock(client, block, planned.chainId);
  return { ...base, backend, executionProof: finalFailure === undefined ? "proved" : "failed", protocolFit: finalFailure === undefined ? "proved" : "unknown", admitted: finalFailure === undefined && affordabilityFailure === undefined, steps: estimates, reason: finalFailure?.error ?? affordabilityFailure, failedTransactionId: finalFailure?.transactionId };
}

