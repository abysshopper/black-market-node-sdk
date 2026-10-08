import { decodeErrorResult, decodeEventLog, decodeFunctionResult, encodeFunctionData, encodeFunctionResult, parseAbi, toHex, type Hex } from "viem";
import { fixedFeePoolHookV1Abi, launchLifecycleAbi, lifecycleErc20Abi } from "./abi.js";
import { hashLaunchIdentity, hashLaunchPlan, LifecyclePhase, type LaunchPlanV1, type LaunchProgressV1, type LaunchReceiptV1 } from "./schema.js";
import { assertLifecycleBlock, assertLifecycleReadClientOpen, lifecycleFailureReason, lifecyclePinnedRpc, lifecycleRpc, lifecycleSourceClient, lifecycleStage, nitroArbSys, nitroArbSysAbi, nitroGasInfo, nitroGasInfoAbi, readLifecycleBlock, readLifecycleChainId, readNitroPosterGas, resolveLifecycleLimits, rpcHex, rpcObject, rpcQuantity, type LifecycleLimitObservation } from "./rpc.js";
import { LifecyclePlanningError, type ControlledLifecycleFork, type LifecycleBlock, type LifecycleLimitContext, type LifecyclePostcondition, type LifecycleRpcClient, type LifecycleSimulation, type LifecycleSimulationStep, type LifecycleTransaction, type PlannedLaunch, type ResolvedLifecycleLimits, type SimulateLaunchPlanOptions } from "./types.js";
import { decodeAbyssLifecycleMarketConfig, decodePoolBoundV4LifecycleMarketConfig, decodeV4LifecycleMarketConfig, isPoolBoundV4ConfigVersion } from "./markets.js";

function committedPositionCount(plan: LaunchPlanV1): number {
  let count = 0;
  for (const market of plan.markets) {
    if (market.configVersion === 1) count += decodeAbyssLifecycleMarketConfig(market.config).positions.length;
    else if (market.configVersion === 4) count += decodeV4LifecycleMarketConfig(market.config).positions.length;
    else if (isPoolBoundV4ConfigVersion(market.configVersion)) count += decodePoolBoundV4LifecycleMarketConfig(market.config, market.configVersion).positions.length;
    else throw new LifecyclePlanningError("UNSUPPORTED_CONFIG_VERSION", "Activation requires a supported committed position schema");
  }
  return count;
}

const executionGuardErrors = [
  ...fixedFeePoolHookV1Abi.filter((item) => item.type === "error"),
  ...parseAbi([
    "error WrongDomain()", "error PlanMismatch()", "error LaunchAlreadyExists()", "error InvalidMode()",
    "error InvalidPhase()", "error InvalidPreparationOrder()", "error DeadlineExpired()", "error InvalidBinding()",
    "error InvalidMarket()", "error InsufficientEscrow()", "error InvalidPositions()", "error InvalidPlan()",
    "error InvalidFunding()", "error InvalidFeePolicy()", "error InvalidBuy()", "error DuplicateMarket()",
    "error IneligibleImplementation()", "error QuoteDebtForbidden()", "error SlippageExceeded()", "error FeeBelowMinimum()",
    "error DeploymentFailed()", "error Error(string reason)", "error Panic(uint256 code)",
  ]),
];

function executionFailure(returnData: Hex | undefined, error: unknown): Pick<LifecycleSimulationStep, "failureCategory" | "decodedError" | "nativeErrorCode" | "nativeErrorKind" | "nativeErrorDataBytes" | "nativeGasCapped" | "error"> {
  const native = error !== null && typeof error === "object" && !Array.isArray(error) ? error as Record<string, unknown> : undefined;
  let nativeData: unknown = native?.data;
  for (let depth = 0; depth < 3 && nativeData !== null && typeof nativeData === "object" && !Array.isArray(nativeData); depth += 1) nativeData = (nativeData as Record<string, unknown>).data;
  const nativeErrorDataBytes = typeof nativeData === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(nativeData) ? (nativeData.length - 2) / 2 : undefined;
  const nativeErrorCode = typeof native?.code === "number" && Number.isSafeInteger(native.code) ? native.code : undefined;
  const message = typeof native?.message === "string" ? native.message : "";
  const nativeGasCapped = message.endsWith(" (gas limit was capped by the RPC server's global gas cap)");
  // Native eth_simulateV1 uses -32015 for VM errors; -32000 is also used by RPC clients.
  // Empty data and an explicit OOG report are required. Malformed data or proximity is not proof.
  const outOfGas = (returnData === undefined || returnData === "0x") && (native?.data === undefined || nativeErrorDataBytes === 0) &&
    (nativeErrorCode === -32015 || nativeErrorCode === -32000) && /^out of gas\b/i.test(message);
  const nativeErrorKind = native === undefined ? "missing" : outOfGas ? "out-of-gas" : nativeErrorCode === 3 ? "execution-reverted" : nativeErrorCode === -32015 ? "vm-error" : "other";
  const diagnostic = { nativeErrorCode, nativeErrorKind, nativeErrorDataBytes, nativeGasCapped } as const;
  const data = returnData === undefined || returnData === "0x" ? nativeData : returnData;
  if (typeof data === "string" && /^0x(?:[0-9a-fA-F]{2}){4,}$/.test(data)) {
    try {
      const { errorName } = decodeErrorResult({ abi: executionGuardErrors, data: data as Hex });
      return { ...diagnostic, failureCategory: errorName === "DeploymentFailed" ? "opaque" : "semantic", decodedError: errorName, error: `Execution reverted (${errorName})` };
    } catch { return { ...diagnostic, failureCategory: "opaque", error: "Execution reverted without a reviewed error" }; }
  }
  if (outOfGas) return { ...diagnostic, failureCategory: nativeGasCapped ? "source" : "capacity", error: nativeGasCapped ? "Native execution ran out of gas under the reported RPC gas cap" : "Native execution ran out of gas" };
  return { ...diagnostic, failureCategory: "opaque", error: nativeErrorKind === "execution-reverted" ? "Native execution reverted without a reviewed error" : "Execution failed without a reviewed error" };
}

const nitroProofsByInvocation = new WeakMap<LifecycleRpcClient, Map<string, Promise<void>>>();

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
    const failureDiagnostic = success ? undefined : executionFailure(returnData, call.error);
    let error = failureDiagnostic?.error;
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
          const positionCount = committedPositionCount(planned.plan);
          if (receipt.planHash.toLowerCase() !== planned.planHash.toLowerCase() || receipt.launchId.toLowerCase() !== planned.launchId.toLowerCase() || receipt.token.toLowerCase() !== planned.predictedToken.toLowerCase() || receipt.marketCount !== planned.plan.markets.length || receipt.positionCount !== positionCount || receipt.quoteSpent.length !== planned.plan.buys.length || receipt.tokenOut.length !== planned.plan.buys.length || !events.some((event) => event.eventName === "LaunchActivated" && event.args.launchId.toLowerCase() === planned.launchId.toLowerCase() && event.args.planHash.toLowerCase() === planned.planHash.toLowerCase() && event.args.token.toLowerCase() === planned.predictedToken.toLowerCase() && event.args.marketCount === planned.plan.markets.length && event.args.positionCount === positionCount)) throw new LifecyclePlanningError("POSTCONDITION_FAILED", "Simulation did not atomically complete every committed market, position and ordered buy");
          for (let buyIndex = 0; buyIndex < planned.plan.buys.length; buyIndex += 1) {
            const buy = planned.plan.buys[buyIndex];
            if (buy === undefined || (receipt.quoteSpent[buyIndex] ?? buy.quoteAmountIn + 1n) > buy.quoteAmountIn || (receipt.tokenOut[buyIndex] ?? 0n) < buy.minTokenOut) throw new LifecyclePlanningError("POSTCONDITION_FAILED", "Simulation did not satisfy every ordered buy's budget and output minimum");
          }
        } else if (transaction.kind === "cancel" && !events.some((event) => event.eventName === "LaunchCancelled" && event.args.launchId.toLowerCase() === planned.launchId.toLowerCase() && event.args.creator.toLowerCase() === planned.account.toLowerCase())) throw new LifecyclePlanningError("POSTCONDITION_FAILED", "Simulation did not cancel the exact committed launch");
        else if ((transaction.kind === "approve" || transaction.kind === "approve-reset") && returnData !== "0x" && decodeFunctionResult({ abi: lifecycleErc20Abi, functionName: "approve", data: returnData }) !== true) throw new LifecyclePlanningError("POSTCONDITION_FAILED", "Funding approval returned failure");
      } catch (failure) { error = failure instanceof LifecyclePlanningError ? failure.message : "Simulation returned an invalid committed postcondition"; }
    }
    steps.push({ transactionId: transaction.id, success: success && error === undefined, gasUsed, gasRequired, gasLimit: gasLimits[index], returnData, error, ...failureDiagnostic, ...(success && error !== undefined ? { failureCategory: "postcondition" as const } : {}) });
    if (!success || error !== undefined) break;
  }
  return steps;
}
/** A decoded semantic refusal or opaque deployment wrapper is never gas evidence. */
function looksGasExhausted(step: LifecycleSimulationStep, gasLimit: bigint): boolean {
  return !step.success && step.failureCategory === "capacity" && step.gasUsed !== undefined && step.gasUsed >= gasLimit - gasLimit / 64n;
}

function simulationFailureKind(failure: unknown): "abort" | "out-of-gas" | "execution" | "source" {
  for (let depth = 0; depth < 8 && failure !== null && typeof failure === "object"; depth += 1) {
    const error = failure as { name?: unknown; code?: unknown; status?: unknown; statusCode?: unknown; message?: unknown; details?: unknown; data?: unknown; cause?: unknown };
    if (error.name === "AbortError") return "abort";
    const status = error.status ?? error.statusCode;
    if (typeof status === "number" && status >= 400 && status <= 599) return "source";
    const message = typeof error.details === "string" ? error.details : typeof error.message === "string" ? error.message : "";
    const execution = executionFailure(undefined, { ...error, message });
    if (execution.nativeErrorKind === "out-of-gas" && execution.nativeGasCapped) return "source";
    if (execution.failureCategory === "capacity") return "out-of-gas";
    if (error.code === 3 || error.code === -32000 && /^execution (?:failed|reverted)\b/i.test(message)) return "execution";
    failure = error.cause;
  }
  return "source";
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
            progress.phase !== LifecyclePhase.Active || progress.planHash.toLowerCase() !== planned.planHash.toLowerCase() || progress.token.toLowerCase() !== planned.predictedToken.toLowerCase() || progress.marketCount !== planned.plan.markets.length || progress.positionCount !== committedPositionCount(planned.plan) ||
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
        steps.push({ transactionId: transaction.id, success: false, gasLimit: gas, error: lifecycleFailureReason(failure) });
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

type SimulationObservations = [LifecycleLimitObservation, unknown, unknown, unknown];
/** Internal, operation-local fee envelope for the already matched immediate step. */
export type NextTransactionEnvelope = Readonly<{ gas: bigint; gasPrice: bigint }>;
export type PreparedLaunchSimulation = ((transactions: readonly LifecycleTransaction[], nextEnvelope?: NextTransactionEnvelope) => Promise<LifecycleSimulation>) & {
  /** Unadmitted diagnostic results only; final admission always performs validated replay. */
  measure(transactions: readonly LifecycleTransaction[]): Promise<LifecycleSimulation>;
  close(): void;
};

function observedFields<T extends object>(value: T): () => boolean {
  const keys = Object.keys(value) as (keyof T)[];
  const values = keys.map((key) => value[key]);
  return () => keys.length === Object.keys(value).length && keys.every((key, index) => value[key] === values[index]);
}

/** Internal continuation owned by one SDK read invocation. Only its positive
 * capability proof is reused; every candidate executes its entire economic sequence. */
export function prepareLaunchSimulation(options: SimulateLaunchPlanOptions, block: LifecycleBlock, hasTransactions = true): PreparedLaunchSimulation {
  const { client, planned, fork } = options;
  const signal = options.signal;
  if (signal?.aborted) throw Object.assign(new Error("Lifecycle simulation cancelled"), { name: "AbortError" });
  const sourceClient = lifecycleSourceClient(client), sourceRequest = sourceClient.request;
  const sourceBatching = sourceClient.supportsReadBatching;
  const reusable = assertLifecycleReadClientOpen(client);
  const plan = planned.plan, planHash = planned.planHash, launchId = planned.launchId;
  const optionsLimits = options.limits, plannedLimits = planned.limits;
  const policy = optionsLimits === undefined ? plannedLimits : optionsLimits;
  const blockMatches = observedFields(block);
  const forkMatches = fork === undefined ? undefined : observedFields(fork);
  const forkRequest = fork?.client.request;
  const plannedMatches = observedFields(planned);
  const context: LifecycleLimitContext = Object.freeze({ client, account: planned.account, orchestrator: plan.orchestrator, block: Object.freeze({ ...block }), chainId: planned.chainId });
  let closed = false, active = false, consumed = false, capabilityProved = false;
  let capabilityPending: Promise<void> | undefined;
  const assertContext = () => {
    if (closed) throw new LifecyclePlanningError("INVALID_SIMULATION", "Prepared simulation continuation has closed");
    if (signal?.aborted) throw Object.assign(new Error("Lifecycle simulation cancelled"), { name: "AbortError" });
    assertLifecycleReadClientOpen(client);
    if (options.client !== client || options.planned !== planned || options.limits !== optionsLimits || options.fork !== fork || options.signal !== signal ||
      lifecycleSourceClient(client) !== sourceClient || sourceClient.request !== sourceRequest || !plannedMatches() || !blockMatches() ||
      sourceClient.supportsReadBatching !== sourceBatching ||
      planned.plan !== plan || planned.account !== context.account || plan.orchestrator !== context.orchestrator || planned.chainId !== context.chainId ||
      planned.limits !== plannedLimits || forkMatches !== undefined && !forkMatches() || fork?.client.request !== forkRequest) {
      throw new LifecyclePlanningError("LIMIT_CONTEXT_MISMATCH", "Prepared simulation differs from its source/account/core/plan/header/policy context");
    }
    if (hashLaunchPlan(plan).toLowerCase() !== planHash.toLowerCase() || hashLaunchIdentity(plan).toLowerCase() !== launchId.toLowerCase()) {
      throw new LifecyclePlanningError("PLAN_MUTATED", "Economic plan changed after its simulation context was bound");
    }
  };
  const pending = (async () => {
    if (fork !== undefined && lifecycleSourceClient(fork.client) === sourceClient) throw new LifecyclePlanningError("UNSAFE_FORK", "Source RPC must never receive controlled simulation transactions/snapshots/resets");
    return lifecycleStage(client, "simulation.context", () => Promise.all([
      resolveLifecycleLimits(context, policy),
      readLifecycleChainId(client),
      lifecyclePinnedRpc(client, "eth_getCode", [context.account, toHex(context.block.number)], context.block),
      hasTransactions ? lifecycleRpc(client, "eth_gasPrice") : undefined,
    ]));
  })().then((observations) => ({ observations }), (failure: unknown) => ({ failure }));
  // Refused inputs may discard this read-only preparation before it settles.
  // Its rejection is handled immediately; no capability or economic work starts.
  const run = async (transactions: readonly LifecycleTransaction[], diagnostic: boolean, nextEnvelope?: NextTransactionEnvelope): Promise<LifecycleSimulation> => {
    if (active || consumed && !reusable || !hasTransactions && transactions.length !== 0) {
      closed = true;
      throw new LifecyclePlanningError("INVALID_SIMULATION", "Prepared candidates require sequential consumption by their SDK invocation owner");
    }
    active = true;
    consumed = true;
    try {
      assertContext();
      const envelopeMatches = nextEnvelope === undefined ? undefined : observedFields(nextEnvelope);
      const candidates = transactions.map((transaction) => ({
        transaction, matches: observedFields(transaction),
        dependencies: [...transaction.dependencies],
        conditions: transaction.postconditions.map((condition) => ({ condition, matches: observedFields(condition) })),
      }));
      const result = await pending;
      if ("failure" in result) throw result.failure;
      const assertCurrent = () => {
        assertContext();
        result.observations[0].assertCurrent();
        if (envelopeMatches !== undefined && !envelopeMatches()) throw new LifecyclePlanningError("INVALID_SIMULATION", "Reviewed gas envelope changed during its complete economic proof");
        if (transactions.length !== candidates.length || candidates.some(({ transaction, matches, dependencies, conditions }, index) =>
          transactions[index] !== transaction || !matches() || transaction.dependencies.length !== dependencies.length ||
          dependencies.some((dependency, ordinal) => transaction.dependencies[ordinal] !== dependency) ||
          transaction.postconditions.length !== conditions.length || conditions.some(({ condition, matches: conditionMatches }, ordinal) =>
            transaction.postconditions[ordinal] !== condition || !conditionMatches()))) {
          throw new LifecyclePlanningError("INVALID_SIMULATION", "Candidate transactions changed during their complete economic proof");
        }
      };
      assertCurrent();
      const proveBackend = async (limits: ResolvedLifecycleLimits, gasPrice: bigint) => {
        assertCurrent();
        if (capabilityProved) return;
        if (capabilityPending === undefined) {
          const key = JSON.stringify([context.chainId.toString(), context.account.toLowerCase(), context.orchestrator.toLowerCase(), context.block.number.toString(), context.block.hash.toLowerCase(), context.block.timestamp.toString(), context.block.gasLimit.toString(), limits.arbOSVersion?.toString(), limits.maxTxComputeGas?.toString(), limits.maxBlockComputeGas?.toString(), limits.executionGasCeiling.toString(), limits.maxSimulationGas?.toString(), gasPrice.toString()]);
          let proofs = reusable ? nitroProofsByInvocation.get(client) : undefined;
          if (reusable && proofs === undefined) { proofs = new Map(); nitroProofsByInvocation.set(client, proofs); }
          const ownedProofs = proofs;
          let nativeProof = ownedProofs?.get(key);
          if (nativeProof === undefined) {
            nativeProof = lifecycleStage(client, "simulation.nitro", () => proveNitroBackend(client, planned, context.block, limits, gasPrice));
            ownedProofs?.set(key, nativeProof);
            const pending = nativeProof;
            void pending.catch(() => { if (ownedProofs?.get(key) === pending) ownedProofs?.delete(key); });
          }
          const proof = nativeProof.then(() => {
            assertContext();
            result.observations[0].assertCurrent();
            capabilityProved = true;
          });
          capabilityPending = proof;
          void proof.then(
            () => { if (capabilityPending === proof) capabilityPending = undefined; },
            () => { if (capabilityPending === proof) capabilityPending = undefined; },
          );
        }
        await capabilityPending;
        assertCurrent();
      };
      const simulation = await simulateLaunchTransactionsWithContext(options, transactions, context, result.observations, proveBackend, assertCurrent, diagnostic, nextEnvelope);
      assertCurrent();
      return simulation;
    } catch (failure) {
      closed = true;
      capabilityProved = false;
      capabilityPending = undefined;
      throw failure;
    } finally { active = false; }
  };
  const simulate: PreparedLaunchSimulation = Object.assign(
    (transactions: readonly LifecycleTransaction[], nextEnvelope?: NextTransactionEnvelope) => run(transactions, false, nextEnvelope),
    { measure: (transactions: readonly LifecycleTransaction[]) => run(transactions, true),
      close() { closed = true; capabilityProved = false; capabilityPending = undefined; } },
  );
  return simulate;
}

export async function simulateLaunchTransactions(options: SimulateLaunchPlanOptions, transactions: readonly LifecycleTransaction[], pinnedBlock?: LifecycleBlock, nextEnvelope?: NextTransactionEnvelope): Promise<LifecycleSimulation> {
  // Standalone calls always produce fresh context, including live chain and fees.
  if (options.fork !== undefined && lifecycleSourceClient(options.fork.client) === lifecycleSourceClient(options.client)) throw new LifecyclePlanningError("UNSAFE_FORK", "Source RPC must never receive controlled simulation transactions/snapshots/resets");
  const block = pinnedBlock ?? await readLifecycleBlock(options.client);
  const prepared = prepareLaunchSimulation(options, block, transactions.length !== 0);
  try { return await prepared(transactions, nextEnvelope); }
  finally { prepared.close(); }
}

async function simulateLaunchTransactionsWithContext(
  options: SimulateLaunchPlanOptions,
  transactions: readonly LifecycleTransaction[],
  context: LifecycleLimitContext,
  observations: SimulationObservations,
  proveBackend: (limits: ResolvedLifecycleLimits, gasPrice: bigint) => Promise<void>,
  assertCurrent: () => void,
  diagnostic: boolean,
  nextEnvelope?: NextTransactionEnvelope,
): Promise<LifecycleSimulation> {
  const { client, planned } = options;
  const sourceClient = lifecycleSourceClient(client);
  const { block } = context;
  const [{ limits, configuration }, chainId, accountCodeValue, gasPriceValue] = observations;
  const base = { confidence: "stateful" as const, executionProof: "failed" as const, protocolFit: "unknown" as const, transportPreflight: "not-requested" as const, blockNumber: block.number, blockHash: block.hash, account: planned.account, chainId: planned.chainId, limits };
  if (chainId !== planned.chainId) throw new LifecyclePlanningError("CHAIN_MISMATCH", "RPC chain changed before sequential simulation");
  const accountCode = rpcHex(accountCodeValue, "account code");
  if (accountCode !== "0x") {
    await assertLifecycleBlock(client, block, planned.chainId);
    return { ...base, confidence: "provisional", executionProof: "unavailable", backend: "unavailable", admitted: false, steps: [], reason: "Direct EOA transaction simulation cannot prove smart-account signature/execution behavior" };
  }
  for (const transaction of transactions) {
    if (transaction.from.toLowerCase() !== planned.account.toLowerCase() || BigInt(transaction.chainId) !== planned.chainId) throw new LifecyclePlanningError("ACCOUNT_MISMATCH", "Simulation transaction differs from the committed chain/account");
    if (limits.maxCalldataBytes !== undefined && (transaction.data.length - 2) / 2 > limits.maxCalldataBytes) {
      await assertLifecycleBlock(client, block, planned.chainId);
      return { ...base, executionProof: "unavailable", protocolFit: "failed", backend: "unavailable", admitted: false, steps: [], failedTransactionId: transaction.id, failureCategory: "capacity", capacityConstraint: "calldata", reason: "Exact calldata exceeds the supplied chain/account/RPC byte cap" };
    }
  }
  if (transactions.length === 0) { await assertLifecycleBlock(client, block, planned.chainId); return { ...base, executionProof: "proved", protocolFit: "proved", backend: "unavailable", admitted: true, steps: [] }; }
  const recommendedGasPrice = rpcQuantity(gasPriceValue, "gas price");
  if (recommendedGasPrice >= 1n << 256n) throw new LifecyclePlanningError("INVALID_RPC_RESPONSE", "Recommended gas price must be a uint256 quantity");
  // Initial construction reserves twice the pinned base fee if the quote lags.
  // Reviewed fees are not new recommendations: native replay must accept them
  // under natural child fees, with no base-fee override or silent fee increase.
  const baseFeeEnvelope = (block.baseFeePerGas ?? 0n) * 2n;
  const gasPrice = nextEnvelope?.gasPrice ?? (recommendedGasPrice > baseFeeEnvelope ? recommendedGasPrice : baseFeeEnvelope);
  if (gasPrice >= 1n << 256n) throw new LifecyclePlanningError("INVALID_RPC_RESPONSE", "Gas price must be a uint256 quantity");
  if (nextEnvelope !== undefined && (typeof nextEnvelope.gas !== "bigint" || nextEnvelope.gas <= 0n || nextEnvelope.gas >= 1n << 64n ||
    typeof nextEnvelope.gasPrice !== "bigint" || nextEnvelope.gasPrice < 0n || nextEnvelope.gasPrice >= 1n << 256n)) {
    throw new LifecyclePlanningError("INVALID_GAS_ENVELOPE", "Reviewed gas and gas price must be exact positive uint64 gas and nonnegative uint256 price");
  }
  const buffer = (gas: bigint) => (gas * BigInt(10000 + limits.headroomBps) + 9999n) / 10000n;
  const computeCeiling = limits.transactionGasCeiling !== undefined && limits.transactionGasCeiling < limits.executionGasCeiling ? limits.transactionGasCeiling : limits.executionGasCeiling;
  // Nonnegative poster gas cannot make this complete discovery request smaller.
  // A generic controlled fork retains the existing RPC-to-fork fallback.
  if (limits.maxSimulationGas !== undefined && BigInt(transactions.length) * computeCeiling > limits.maxSimulationGas &&
    (limits.protocol === "nitro" || options.fork === undefined)) {
    assertCurrent();
    await assertLifecycleBlock(client, block, planned.chainId);
    return { ...base, confidence: "provisional", executionProof: "unavailable", backend: "unavailable", admitted: false, steps: [], failureCategory: "capacity", capacityConstraint: "simulation-gas", reason: `Stateful sequential RPC simulation unavailable: Sequential request exceeds the current RPC aggregate simulation gas cap; use an isolated controlled fork. ${limits.protocol === "nitro" ? "Generic Anvil/Hardhat forks cannot prove ArbOS compute/poster metering." : "Dependent eth_call estimates are not proof."}` };
  }
  const posterGas: bigint[] = [];
  if (limits.protocol === "nitro") {
    // Lightweight poster reads may overlap the isolated capability request.
    // Economic work is not even queued until both prerequisites have succeeded.
    try {
      const [, estimates] = await Promise.all([
        proveBackend(limits, gasPrice),
        lifecycleStage(client, "simulation.poster", () => Promise.all(transactions.map(async (transaction) => buffer((await readNitroPosterGas(transaction, context)).posterGas)))),
      ]);
      posterGas.push(...estimates);
    } catch (failure) {
      if (simulationFailureKind(failure) === "abort") throw failure;
      assertCurrent();
      await assertLifecycleBlock(client, block, planned.chainId);
      return { ...base, confidence: "provisional", executionProof: "unavailable", backend: "unavailable", admitted: false, steps: [], reason: `Native Nitro compute/poster proof unavailable: ${lifecycleFailureReason(failure)}. Generic Anvil/Hardhat forks cannot prove ArbOS metering.` };
    }
  }
  assertCurrent();
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
  // A permissive measurement needs the legal complete compute + poster envelope.
  // It is not proof: fixed compute/headroom checks and exact validated replay still follow.
  try {
    measured = await lifecycleStage(client, "simulation.measure", () => simulateRpcPass(client, planned, block, transactions, discoveryGas, limits, gasPrice, false));
  }
  catch (failure) {
    if (simulationFailureKind(failure) === "abort") throw failure;
    assertCurrent();
    if (options.fork === undefined || limits.protocol === "nitro") {
      await assertLifecycleBlock(client, block, planned.chainId);
      return { ...base, confidence: "provisional", executionProof: "unavailable", backend: "unavailable", admitted: false, steps: [], reason: `Stateful sequential RPC simulation unavailable: ${lifecycleFailureReason(failure)}. ${limits.protocol === "nitro" ? "Generic Anvil/Hardhat forks cannot prove ArbOS compute/poster metering." : "Dependent eth_call estimates are not proof."}` };
    }
    backend = "controlled-fork";
    measured = await simulateForkPass(options.fork, planned, block, transactions, discoveryGas, gasPrice, true, limits.headroomBps);
  }
  assertCurrent();
  const failed = measured.find((step) => !step.success);
  if (failed !== undefined) { await assertLifecycleBlock(client, block, planned.chainId); return { ...base, backend, admitted: false, steps: measured, reason: failed.error, failedTransactionId: failed.transactionId, failureCategory: failed.failureCategory ?? "opaque", capacityConstraint: failed.failureCategory === "capacity" ? "compute" : undefined }; }
  if (diagnostic) {
    await assertLifecycleBlock(client, block, planned.chainId);
    return { ...base, backend, admitted: false, executionProof: "unavailable", steps: measured };
  }
  const computeGas = measured.map((step) => buffer(step.gasRequired ?? step.gasUsed ?? computeCeiling));
  const gasLimits = computeGas.map((gas, index) => gas + (posterGas[index] ?? 0n));
  const exceeds = gasLimits.findIndex((gas, index) => gas <= 0n || gas >= 1n << 64n || (computeGas[index] ?? 0n) > limits.executionGasCeiling || limits.transactionGasCeiling !== undefined && gas > limits.transactionGasCeiling);
  if (exceeds >= 0) {
    await assertLifecycleBlock(client, block, planned.chainId);
    return { ...base, executionProof: "unavailable", protocolFit: "failed", backend, admitted: false, steps: measured, failureCategory: "capacity", capacityConstraint: (computeGas[exceeds] ?? 0n) > limits.executionGasCeiling ? "compute" : "gas-envelope", reason: "Execution compute/headroom or complete poster gas envelope is outside positive uint64 gas and current protocol/known transaction limits", failedTransactionId: transactions[exceeds]?.id };
  }
  if (nextEnvelope !== undefined) {
    if (nextEnvelope.gas < (gasLimits[0] ?? 0n) || limits.transactionGasCeiling !== undefined && nextEnvelope.gas > limits.transactionGasCeiling) {
      await assertLifecycleBlock(client, block, planned.chainId);
      return { ...base, executionProof: "unavailable", protocolFit: "failed", backend, admitted: false, steps: measured,
        failureCategory: "capacity", capacityConstraint: "gas-envelope", failedTransactionId: transactions[0]?.id,
        reason: "Reviewed gas cannot cover current minimum compute/headroom/poster requirements or exceeds the current transaction ceiling" };
    }
    gasLimits[0] = nextEnvelope.gas;
  }
  // Envelope discovery may enlarge future unfinished steps, never the reviewed
  // immediate one. Every retry still executes the entire sequence at held price.
  const envelopeDiscoveryGas = nextEnvelope === undefined ? discoveryGas : discoveryGas.map((gas, index) => index === 0 ? nextEnvelope.gas : gas);
  // Replay the complete sequence from its original state at the exact buffered
  // limits. Only explicit native OOG can discover one larger legal envelope;
  // semantic, opaque and transport failures cannot authorize a capacity retry.
  let verified: LifecycleSimulationStep[];
  let validatedReplayError: string | undefined;
  assertCurrent();
  try {
    if (backend === "eth_simulateV1") verified = await lifecycleStage(client, "simulation.replay", () => simulateRpcPass(client, planned, block, transactions, gasLimits, limits, gasPrice, true));
    else {
      if (options.fork === undefined) throw new LifecyclePlanningError("INVALID_SIMULATION", "Controlled fork is missing for the exact-gas replay");
      verified = await simulateForkPass(options.fork, planned, block, transactions, gasLimits, gasPrice, false, limits.headroomBps);
    }
  } catch (failure) {
    const kind = simulationFailureKind(failure);
    if (kind === "abort") throw failure;
    assertCurrent();
    const message = lifecycleFailureReason(failure);
    if (backend !== "eth_simulateV1") {
      await assertLifecycleBlock(client, block, planned.chainId);
      return { ...base, backend, admitted: false, steps: [], reason: `Exact-gas validated replay failed: ${message}` };
    }
    if (kind !== "out-of-gas") {
      await assertLifecycleBlock(client, block, planned.chainId);
      return { ...base, backend: "unavailable", confidence: "provisional", executionProof: "unavailable", admitted: false, steps: measured, failureCategory: kind === "source" ? "source" : "opaque", reason: `Exact-gas validated replay unavailable: ${message}` };
    }
    validatedReplayError = message;
    verified = [];
  }
  assertCurrent();
  let verifiedSteps = verified;
  let admittedGasLimits = gasLimits;
  let finalFailure = verifiedSteps.find((step) => !step.success);
  let finalFailureReason: string | undefined;
  if (finalFailure === undefined && validatedReplayError !== undefined) {
    if (!envelopeDiscoveryGas.some((gas, index) => gas > (gasLimits[index] ?? gas))) {
      await assertLifecycleBlock(client, block, planned.chainId);
      return { ...base, backend, admitted: false, steps: measured, reason: `Validated execution at the exact current gas ceiling failed: ${validatedReplayError}` };
    }
    // The buffered validated replay threw before yielding steps. Attempt one
    // explicit envelope-discovery replay at the exact execution ceiling on the
    // same pinned block; headroom is never silently raised — the carried gas is
    // the validated envelope itself.
    assertCurrent();
    try {
      const ceilingLimits = envelopeDiscoveryGas;
      const retried = backend === "eth_simulateV1"
        ? await lifecycleStage(client, "simulation.envelope", () => simulateRpcPass(client, planned, block, transactions, ceilingLimits, limits, gasPrice, true))
        : options.fork === undefined ? undefined : await simulateForkPass(options.fork, planned, block, transactions, ceilingLimits, gasPrice, false, limits.headroomBps);
      const retryFailureIndex = retried?.findIndex((step) => !step.success) ?? -1;
      const retryFailure = retried?.[retryFailureIndex];
      if (retried === undefined) {
        await assertLifecycleBlock(client, block, planned.chainId);
        return { ...base, backend, admitted: false, steps: measured, reason: `Validated execution at the exact current gas ceiling still failed: ${validatedReplayError}` };
      }
      admittedGasLimits = ceilingLimits;
      verifiedSteps = retried;
      finalFailure = retryFailure;
      validatedReplayError = undefined;
      if (retryFailure !== undefined) {
        const kind = transactions[retryFailureIndex]?.kind;
        const indivisible = kind === "activate" || kind === "atomic";
        finalFailureReason = `Validated execution at the exact current gas ceiling still failed: ${retryFailure.error ?? "Execution reverted"}${indivisible ? "; final mint/lock/all-buys/public-opening is indivisible and will not be partitioned" : ""}`;
      }
    } catch (failure) {
      const kind = simulationFailureKind(failure);
      if (kind === "abort") throw failure;
      assertCurrent();
      await assertLifecycleBlock(client, block, planned.chainId);
      if (kind !== "out-of-gas") return { ...base, backend: "unavailable", confidence: "provisional", executionProof: "unavailable", admitted: false, steps: measured, failureCategory: kind === "source" ? "source" : "opaque", reason: `Legal-envelope validated replay unavailable after buffered execution refusal: ${lifecycleFailureReason(failure)}` };
      return { ...base, backend, admitted: false, steps: measured, reason: `Validated buffered replay failed (${validatedReplayError}) and execution at the exact gas ceiling still reverted; final mint/lock/all-buys/public-opening is indivisible` };
    }
  } else if (finalFailure !== undefined) {
    const failedIndex = verifiedSteps.findIndex((step) => !step.success);
    const bufferedLimit = gasLimits[failedIndex];
    const failedTransaction = transactions[failedIndex];
    if (bufferedLimit !== undefined && failedTransaction !== undefined && (nextEnvelope === undefined || failedIndex !== 0) &&
      looksGasExhausted(finalFailure, bufferedLimit) && (envelopeDiscoveryGas[failedIndex] ?? 0n) > bufferedLimit) {
      // Buffered replay returned an exhaustion-shaped failed step; learn the true
      // validated envelope with one explicit replay at the exact execution ceiling.
      assertCurrent();
      try {
        const ceilingLimits = envelopeDiscoveryGas;
        const retried = backend === "eth_simulateV1"
          ? await lifecycleStage(client, "simulation.envelope", () => simulateRpcPass(client, planned, block, transactions, ceilingLimits, limits, gasPrice, true))
          : options.fork === undefined ? undefined : await simulateForkPass(options.fork, planned, block, transactions, ceilingLimits, gasPrice, false, limits.headroomBps);
        if (retried === undefined) {
          await assertLifecycleBlock(client, block, planned.chainId);
          return { ...base, backend, admitted: false, steps: measured, reason: "Validated execution at the exact current gas ceiling omitted transaction results" };
        }
        const retryFailureIndex = retried.findIndex((step) => !step.success);
        const retryFailure = retried[retryFailureIndex];
        admittedGasLimits = ceilingLimits;
        verifiedSteps = retried;
        finalFailure = retryFailure;
        if (retryFailure !== undefined) {
          const kind = transactions[retryFailureIndex]?.kind;
          const indivisible = kind === "activate" || kind === "atomic";
          finalFailureReason = `Validated execution at the exact current gas ceiling still failed: ${retryFailure.error ?? "Execution reverted"}${indivisible ? "; final mint/lock/all-buys/public-opening is indivisible and will not be partitioned" : ""}`;
        }
      } catch (failure) {
        const kind = simulationFailureKind(failure);
        if (kind === "abort") throw failure;
        assertCurrent();
        if (kind !== "out-of-gas") {
          await assertLifecycleBlock(client, block, planned.chainId);
          return { ...base, backend: "unavailable", confidence: "provisional", executionProof: "unavailable", admitted: false, steps: measured, reason: `Legal-envelope validated replay unavailable: ${lifecycleFailureReason(failure)}` };
        }
        await assertLifecycleBlock(client, block, planned.chainId);
        return { ...base, backend, admitted: false, steps: measured, reason: `Validated buffered replay failed (${finalFailure?.error ?? "Execution reverted"}) and execution at the exact gas ceiling still reverted: ${lifecycleFailureReason(failure)}` };
      }
    }
  }
  assertCurrent();
  if (nextEnvelope !== undefined && finalFailure === undefined) {
    const currentMinimum = buffer(verifiedSteps[0]?.gasRequired ?? verifiedSteps[0]?.gasUsed ?? nextEnvelope.gas);
    if (nextEnvelope.gas < currentMinimum) {
      await assertLifecycleBlock(client, block, planned.chainId);
      return { ...base, backend, admitted: false, executionProof: "proved", protocolFit: "failed", steps: verifiedSteps,
        failureCategory: "capacity", capacityConstraint: "gas-envelope", failedTransactionId: transactions[0]?.id,
        reason: "Exact reviewed replay leaves insufficient current minimum gas headroom" };
    }
  }
  const estimates: LifecycleSimulationStep[] = [];
  // A definitive returned replay failure already refuses execution. Retain its
  // fee observations without inventing a balance or doing redundant payer work.
  let remainingBalance = finalFailure === undefined
    ? rpcQuantity(await lifecyclePinnedRpc(client, "eth_getBalance", [planned.account, toHex(block.number)], block), "creator native balance")
    : undefined;
  let affordabilityFailure: string | undefined;
  const feeContext = configuration.estimateDataFee === undefined || sourceClient === client ? context : { ...context, client: sourceClient };
  for (let index = 0; index < verifiedSteps.length; index += 1) {
    const step = verifiedSteps[index]; const transaction = transactions[index]; const gasLimit = admittedGasLimits[index];
    if (step === undefined || transaction === undefined || gasLimit === undefined) throw new LifecyclePlanningError("INVALID_SIMULATION", "Missing verified fee context");
    const dataFee = limits.protocol === "nitro" ? 0n : configuration.estimateDataFee === undefined ? undefined : await configuration.estimateDataFee({ ...transaction, gas: gasLimit, gasPrice }, feeContext);
    if (dataFee !== undefined && (typeof dataFee !== "bigint" || dataFee < 0n || dataFee >= 1n << 256n)) throw new LifecyclePlanningError("INVALID_DATA_FEE", "Data-fee oracle must return a nonnegative uint256 bigint amount");
    // Nitro gas includes poster charges. Never add the quoted poster fee again.
    const executionFee = gasLimit * gasPrice;
    const required = transaction.value + executionFee + (dataFee ?? 0n);
    if (required >= 1n << 256n) throw new LifecyclePlanningError("INVALID_GAS_ENVELOPE", "Transaction value and fee envelope exceed uint256");
    if (remainingBalance !== undefined) {
      if (required > remainingBalance && affordabilityFailure === undefined) affordabilityFailure = "Creator native balance cannot fund the remaining transaction value and execution/data fee envelopes";
      remainingBalance -= required;
    }
    const poster = posterGas[index];
    estimates.push({ ...step, estimate: { gasUsed: step.gasUsed ?? 0n, gasLimit, gasPrice, executionFee, dataFee, posterGas: poster, posterFee: poster === undefined ? undefined : poster * gasPrice, dataFeeIncludedInGas: limits.protocol === "nitro", totalFee: dataFee === undefined ? undefined : executionFee + dataFee, feeConfidence: dataFee === undefined ? "execution-only" : "execution-and-data" } });
  }
  await assertLifecycleBlock(client, block, planned.chainId);
  return { ...base, backend, executionProof: finalFailure === undefined ? "proved" : "failed", protocolFit: finalFailure === undefined ? "proved" : "unknown", admitted: finalFailure === undefined && affordabilityFailure === undefined, steps: estimates, reason: finalFailureReason ?? finalFailure?.error ?? affordabilityFailure, failedTransactionId: finalFailure?.transactionId, failureCategory: finalFailure?.failureCategory ?? (affordabilityFailure === undefined ? undefined : "affordability"), capacityConstraint: finalFailure?.failureCategory === "capacity" ? "compute" : undefined };
}

