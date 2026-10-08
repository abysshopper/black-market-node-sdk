import { decodeFunctionResult, keccak256, type Address } from "viem";
import { launchLifecycleAbi } from "./abi.js";
import { buildPoolBoundHookParameters, decodePoolBoundV4LifecycleMarketConfig, isPoolBoundV4ConfigVersion, poolBoundHookInitCodeHash, poolBoundV4LifecycleConfigSchema, predictPoolBoundHookAddress, type PoolBoundHookParameters, type PoolBoundLifecycleConfigVersion } from "./markets.js";
import { getKnownLifecycleProfile, type LifecycleProfilePreset } from "./presets.js";
import { type LaunchPlanV1, type LaunchReceiptV1 } from "./schema.js";
import { LifecyclePlanningError, type PlannedLaunch, type PoolBoundHookDeployment } from "./types.js";

const verifiedCreationCode = new WeakSet<LifecycleProfilePreset>();

/** Construction only: a release preset never certifies current registry admission.
 * Unknown chain/core/profile identities deliberately return to live discovery. */
export function deriveKnownPoolBoundHookDeployment(options: { plan: LaunchPlanV1; marketIndex: number; token: Address }): { deployment: PoolBoundHookDeployment; parameters: PoolBoundHookParameters; configVersion: PoolBoundLifecycleConfigVersion } | undefined {
  const { plan, marketIndex, token } = options;
  const market = plan.markets[marketIndex];
  if (market === undefined || !isPoolBoundV4ConfigVersion(market.configVersion)) throw new LifecyclePlanningError("INVALID_BOUND_MARKET", "Market index must select explicit pool-bound config version 5 or 6");
  const preset = getKnownLifecycleProfile({ chainId: plan.chainId, orchestrator: plan.orchestrator, profileId: market.profileId });
  if (preset === undefined) return undefined;
  if (!preset.supported) throw new LifecyclePlanningError("UNSUPPORTED_CONFIG_VERSION", preset.unavailableReason ?? "This historical deployment does not support the current pool-bound ABI");
  const { profile, boundHook: graph } = preset;
  if (graph === undefined || profile.topology.hookTopology !== 2 || profile.topology.configVersion !== market.configVersion ||
    profile.adapter.configVersion !== market.configVersion || profile.envelope?.configVersion !== market.configVersion ||
    profile.registration.configSchema.toLowerCase() !== poolBoundV4LifecycleConfigSchema(market.configVersion).toLowerCase() ||
    market.adapterId.toLowerCase() !== profile.registration.adapterId.toLowerCase()) throw new LifecyclePlanningError("INVALID_BOUND_MARKET", "Market does not select the preset's exact version, schema, adapter and bound-hook topology");
  if (!verifiedCreationCode.has(preset)) {
    if (keccak256(graph.creationCode).toLowerCase() !== profile.topology.hookCreationCodeHash.toLowerCase() || graph.deployer.toLowerCase() !== profile.topology.hookDeployer.toLowerCase() || graph.registrar.toLowerCase() !== profile.adapter.implementation.toLowerCase()) throw new LifecyclePlanningError("HOOK_CREATION_CODE_MISMATCH", "Frozen hook creation code or constructor graph differs from its reviewed preset");
    verifiedCreationCode.add(preset);
  }
  const config = decodePoolBoundV4LifecycleMarketConfig(market.config, market.configVersion);
  const parameters = buildPoolBoundHookParameters({
    chainId: plan.chainId, core: plan.orchestrator, poolManager: graph.poolManager, registrar: graph.registrar,
    oracleFactory: graph.oracleFactory, liquidityLocker: graph.liquidityLocker, token, market, config,
  });
  const initCodeHash = poolBoundHookInitCodeHash(graph.creationCode, parameters, market.configVersion);
  const deployment = { deployer: graph.deployer, initCodeHash, salt: config.hookSalt, predictedHook: predictPoolBoundHookAddress({ deployer: graph.deployer, initCodeHash, salt: config.hookSalt }) };
  return { deployment, parameters, configVersion: market.configVersion };
}

export function validateBuySlippageBps(bps: number): void {
  if (!Number.isSafeInteger(bps) || bps < 0 || bps >= 10000) throw new LifecyclePlanningError("INVALID_BUY_SLIPPAGE", "Buy slippage must be an integer between zero and 9999 basis points");
}

/** Actual ordered receipt outputs, never reserve geometry or caller-supplied quotes. */
export function protectOrderedBuyMinimums(planned: PlannedLaunch, bps: number): LaunchPlanV1 {
  validateBuySlippageBps(bps);
  const { simulation, plan } = planned;
  if (simulation.confidence !== "stateful" || simulation.backend === "unavailable" || simulation.steps.length !== planned.transactions.length || simulation.steps.some((step, index) => !step.success || step.transactionId !== planned.transactions[index]?.id)) throw new LifecyclePlanningError("LAUNCH_DIAGNOSTIC_FAILED", simulation.reason ?? "The complete diagnostic launch sequence did not execute successfully", simulation);
  const activation = planned.transactions.find((transaction) => transaction.kind === "atomic" || transaction.kind === "activate");
  const step = simulation.steps.find((candidate) => candidate.transactionId === activation?.id);
  if (activation === undefined || step?.returnData === undefined) throw new LifecyclePlanningError("MISSING_BUY_OUTPUTS", "Diagnostic execution omitted the actual activation receipt", simulation);
  const receipt = decodeFunctionResult({ abi: launchLifecycleAbi, functionName: activation.kind === "atomic" ? "launchAtomic" : "activateLaunch", data: step.returnData }) as LaunchReceiptV1;
  if (receipt.planHash.toLowerCase() !== planned.planHash.toLowerCase() || receipt.launchId.toLowerCase() !== planned.launchId.toLowerCase() || receipt.token.toLowerCase() !== planned.predictedToken.toLowerCase() || receipt.marketCount !== plan.markets.length || receipt.tokenOut.length !== plan.buys.length || receipt.quoteSpent.length !== plan.buys.length) throw new LifecyclePlanningError("MISSING_BUY_OUTPUTS", "Diagnostic receipt differs from the complete committed launch and ordered buys", simulation);
  const factor = BigInt(10000 - bps);
  return { ...plan, buys: plan.buys.map((buy, index) => {
    const output = receipt.tokenOut[index]!;
    const minTokenOut = output * factor / 10000n;
    if (receipt.quoteSpent[index]! > buy.quoteAmountIn || output < buy.minTokenOut || minTokenOut <= 0n) throw new LifecyclePlanningError("INVALID_BUY_OUTPUT", "Each actual buy must satisfy its budget and produce a positive protected minimum", simulation);
    return { ...buy, minTokenOut };
  }) };
}
