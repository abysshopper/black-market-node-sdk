import { decodeEventLog, decodeFunctionResult, encodeFunctionData, toHex, type Hex } from "viem";
import { launchLifecycleAbi, lifecycleErc20Abi } from "./abi.js";
import { LifecyclePhase, type LaunchProgressV1, type LaunchReceiptV1 } from "./schema.js";
import { assertLifecycleBlock, lifecycleRpc, readLifecycleBlock, resolveLifecycleLimits, rpcHex, rpcObject, rpcQuantity } from "./rpc.js";
import { LifecyclePlanningError, type ControlledLifecycleFork, type LifecycleBlock, type LifecyclePostcondition, type LifecycleRpcClient, type LifecycleSimulation, type LifecycleSimulationStep, type LifecycleTransaction, type PlannedLaunch, type ResolvedLifecycleLimits, type SimulateLaunchPlanOptions } from "./types.js";

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
    steps.push({ transactionId: transaction.id, success: success && error === undefined, gasUsed, gasLimit: gasLimits[index], returnData, error });
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
        for (const condition of transaction.postconditions) {
          const request = conditionRequest(condition, planned);
          const data = rpcHex(await lifecycleRpc(fork.client, "eth_call", [{ ...request, from: planned.account }, toHex(currentBlock.number)]), "fork postcondition");
          checkCondition(condition, data, planned);
        }
        steps.push({ transactionId: transaction.id, success: true, gasUsed, gasLimit: gas, gasRequired });
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

export async function simulateLaunchTransactions(options: SimulateLaunchPlanOptions, transactions: readonly LifecycleTransaction[], pinnedBlock?: LifecycleBlock): Promise<LifecycleSimulation> {
  const { client, planned } = options;
  if (options.fork?.client === client) throw new LifecyclePlanningError("UNSAFE_FORK", "Source RPC must never receive controlled simulation transactions/snapshots/resets");
  const block = pinnedBlock ?? await readLifecycleBlock(client);
  const context = { client, account: planned.account, orchestrator: planned.plan.orchestrator, block, chainId: planned.chainId };
  const { limits, configuration } = await resolveLifecycleLimits(context, options.limits ?? planned.limits);
  const base = { confidence: "stateful" as const, blockNumber: block.number, blockHash: block.hash, account: planned.account, chainId: planned.chainId, limits };
  if (rpcQuantity(await lifecycleRpc(client, "eth_chainId"), "chain ID") !== planned.chainId) throw new LifecyclePlanningError("CHAIN_MISMATCH", "RPC chain changed before sequential simulation");
  const accountCode = rpcHex(await lifecycleRpc(client, "eth_getCode", [planned.account, toHex(block.number)]), "account code");
  if (accountCode !== "0x") return { ...base, confidence: "provisional", backend: "unavailable", admitted: false, steps: [], reason: "Direct EOA transaction simulation cannot prove smart-account signature/execution behavior" };
  for (const transaction of transactions) {
    if (limits.maxCalldataBytes !== undefined && (transaction.data.length - 2) / 2 > limits.maxCalldataBytes) return { ...base, backend: "unavailable", admitted: false, steps: [], failedTransactionId: transaction.id, reason: "Exact calldata exceeds the current chain/account/RPC byte cap" };
  }
  if (transactions.length === 0) { await assertLifecycleBlock(client, block); return { ...base, backend: "unavailable", admitted: true, steps: [] }; }
  const gasPrice = rpcQuantity(await lifecycleRpc(client, "eth_gasPrice"), "gas price");
  const capGas = transactions.map(() => limits.executionGasCeiling);
  let backend: "eth_simulateV1" | "controlled-fork" = "eth_simulateV1";
  let measured: LifecycleSimulationStep[];
  // Permissive cap measurement is not proof; only the exact-gas validated replay admits a plan.
  try { measured = await simulateRpcPass(client, planned, block, transactions, capGas, limits, gasPrice, false); }
  catch (failure) {
    if (options.fork === undefined) {
      await assertLifecycleBlock(client, block);
      return { ...base, confidence: "provisional", backend: "unavailable", admitted: false, steps: [], reason: `Stateful sequential RPC simulation unavailable: ${failure instanceof Error ? failure.message : String(failure)}. Dependent eth_call estimates are not proof.` };
    }
    backend = "controlled-fork";
    measured = await simulateForkPass(options.fork, planned, block, transactions, capGas, gasPrice, true, limits.headroomBps);
  }
  const failed = measured.find((step) => !step.success);
  if (failed !== undefined) { await assertLifecycleBlock(client, block); return { ...base, backend, admitted: false, steps: measured, reason: failed.error, failedTransactionId: failed.transactionId }; }
  const gasLimits = measured.map((step) => ((step.gasRequired ?? step.gasUsed ?? limits.executionGasCeiling) * BigInt(10000 + limits.headroomBps) + 9999n) / 10000n);
  const exceeds = gasLimits.findIndex((gas) => gas > limits.executionGasCeiling);
  if (exceeds >= 0) {
    await assertLifecycleBlock(client, block);
    return { ...base, backend, admitted: false, steps: measured, reason: "Execution gas plus conservative headroom exceeds current transaction limits", failedTransactionId: transactions[exceeds]?.id };
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
    if (backend === "eth_simulateV1") verified = await simulateRpcPass(client, planned, block, transactions, gasLimits, limits, gasPrice, true);
    else {
      if (options.fork === undefined) throw new LifecyclePlanningError("INVALID_SIMULATION", "Controlled fork is missing for the exact-gas replay");
      verified = await simulateForkPass(options.fork, planned, block, transactions, gasLimits, gasPrice, false, limits.headroomBps);
    }
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : String(failure);
    if (backend !== "eth_simulateV1") {
      await assertLifecycleBlock(client, block);
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
      const ceilingLimits = transactions.map(() => limits.executionGasCeiling);
      const retried = backend === "eth_simulateV1"
        ? await simulateRpcPass(client, planned, block, transactions, ceilingLimits, limits, gasPrice, true)
        : options.fork === undefined ? undefined : await simulateForkPass(options.fork, planned, block, transactions, ceilingLimits, gasPrice, false, limits.headroomBps);
      if (retried === undefined || retried.some((step) => !step.success)) {
        await assertLifecycleBlock(client, block);
        return { ...base, backend, admitted: false, steps: measured, reason: `Validated execution at the exact current gas ceiling still failed: ${retried?.find((step) => !step.success)?.error ?? validatedReplayError}; final mint/lock/all-buys/public-opening is indivisible and will not be partitioned`, failedTransactionId: transactions[0]?.id };
      }
      admittedGasLimits = ceilingLimits;
      verifiedSteps = retried;
      finalFailure = undefined;
      validatedReplayError = undefined;
    } catch {
      await assertLifecycleBlock(client, block);
      return { ...base, backend, admitted: false, steps: measured, reason: `Validated buffered replay failed (${validatedReplayError}) and envelope discovery at the exact gas ceiling was rejected by the simulation backend; final mint/lock/all-buys/public-opening is indivisible`, failedTransactionId: transactions[0]?.id };
    }
  }
  if (finalFailure !== undefined) {
    const failedIndex = verifiedSteps.findIndex((step) => !step.success);
    const bufferedLimit = gasLimits[failedIndex];
    const failedTransaction = transactions[failedIndex];
    if (bufferedLimit !== undefined && failedTransaction !== undefined && looksGasExhausted(finalFailure, bufferedLimit) && limits.executionGasCeiling > bufferedLimit) {
      // Buffered replay returned an exhaustion-shaped failed step; learn the true
      // validated envelope with one explicit replay at the exact execution ceiling.
      try {
        const ceilingLimits = transactions.map(() => limits.executionGasCeiling);
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
            await assertLifecycleBlock(client, block);
            return { ...base, backend, admitted: false, steps: measured, reason: `Validated execution at the exact current gas ceiling still failed: ${retryFailure.error ?? "the true gas envelope exceeds the current execution limit"}${indivisible ? "; final mint/lock/all-buys/public-opening is indivisible and will not be partitioned" : ""}`, failedTransactionId: failedTransaction.id };
          }
        }
      } catch { /* Envelope discovery unavailable; report the original buffered-limit failure unchanged. */ }
    }
  }
  const estimates: LifecycleSimulationStep[] = [];
  const balance = rpcQuantity(await lifecycleRpc(client, "eth_getBalance", [planned.account, toHex(block.number)]), "creator native balance");
  let remainingBalance = balance;
  let affordabilityFailure: string | undefined;
  for (let index = 0; index < verifiedSteps.length; index += 1) {
    const step = verifiedSteps[index]; const transaction = transactions[index]; const gasLimit = admittedGasLimits[index];
    if (step === undefined || transaction === undefined || gasLimit === undefined) throw new LifecyclePlanningError("INVALID_SIMULATION", "Missing verified fee context");
    const dataFee = configuration.estimateDataFee === undefined ? undefined : await configuration.estimateDataFee({ ...transaction, gas: gasLimit }, context);
    if (dataFee !== undefined && dataFee < 0n) throw new LifecyclePlanningError("INVALID_DATA_FEE", "Data-fee oracle returned a negative amount");
    const executionFee = gasLimit * gasPrice;
    const required = transaction.value + executionFee + (dataFee ?? 0n);
    if (required > remainingBalance && affordabilityFailure === undefined) affordabilityFailure = "Creator native balance cannot fund the remaining transaction value and execution/data fee envelopes";
    remainingBalance -= required;
    estimates.push({ ...step, estimate: { gasUsed: step.gasUsed ?? 0n, gasLimit, gasPrice, executionFee, dataFee, totalFee: dataFee === undefined ? undefined : executionFee + dataFee, feeConfidence: dataFee === undefined ? "execution-only" : "execution-and-data" } });
  }
  await assertLifecycleBlock(client, block);
  return { ...base, backend, admitted: finalFailure === undefined && affordabilityFailure === undefined && limits.admissionKnown, steps: estimates, reason: finalFailure?.error ?? affordabilityFailure ?? (limits.admissionKnown ? undefined : `Stateful execution was proved, but current execution admission constraints are incomplete: ${limits.unknownExecutionConstraints.join("; ")}`), failedTransactionId: finalFailure?.transactionId };
}

