import { encodeFunctionData, type Address } from "viem";
import { launchLifecycleAbi } from "./abi.js";
import { LifecycleFundingKind, LifecycleMode, type LaunchPlanV1 } from "./schema.js";
import { LifecyclePlanningError, type BuildLaunchTransactionsOptions, type LifecycleTransaction } from "./types.js";
import { assertLifecycleTokenAllocation } from "./allocations.js";
import { ufgLaunchProxyV1Abi } from "./ufg-abi.js";
import { UFG_LAUNCH_PROXY_ADDRESS, isUfgProfile } from "./ufg-config.js";
import { decodeAbyssLifecycleMarketConfig, decodePoolBoundV4LifecycleMarketConfig, decodeV4LifecycleMarketConfig, isPoolBoundV4ConfigVersion } from "./markets.js";
import { isHmmProfile } from "./hmm.js";
import { isRaetoProfile } from "./raeto.js";
import { isAutoCompoundProfile } from "./auto-compound.js";
import type { UfgLaunchConfig } from "./ufg-config.js";

// Native9,723,187 Abyss3 (0x679d…e77), fork32-position10,900,786;
// fork V4 fixed/dynamic8-position8,804,466; UFG9,896,176; native HMM8-position14,676,638 (0x459c…5b7).
const preparationCosts = {
  abyss: { market: 9_800_000n, position: 70_000n },
  v4: { market: 9_000_000n, position: 40_000n },
  ufg: { market: 10_000_000n, position: 70_000n },
  hmm: { market: 15_000_000n, position: 50_000n },
  // template-gas-matrix.json: Raeto1 <=9.13M,32 <=11.23M.
  raeto: { market: 9_300_000n, position: 70_000n },
  // Same matrix: auto-compound1 <=8.71M,32 <=10.76M.
  autoCompound: { market: 8_900_000n, position: 70_000n },
} as const;
export const LIFECYCLE_CAPACITY_PADDING_BPS = 2500;
/** Full single-market observations include call overhead. Add conservative full
 * calldata/hash processing (16 intrinsic gas per nonzero byte plus8 for copying). */
export function preparationCalldataGas(data: `0x${string}`): bigint { return 24n * BigInt((data.length - 2) / 2); }

export function preparationGasEstimate(plan: LaunchPlanV1, first: number, count: number): bigint {
  let gas = 0n;
  for (let index = first; index < first + count; index += 1) {
    const market = plan.markets[index]!;
    const positions = market.configVersion === 1 ? decodeAbyssLifecycleMarketConfig(market.config).positions.length
      : isPoolBoundV4ConfigVersion(market.configVersion) ? decodePoolBoundV4LifecycleMarketConfig(market.config, market.configVersion).positions.length
      : decodeV4LifecycleMarketConfig(market.config).positions.length;
    const cost = market.configVersion === 1 ? preparationCosts.abyss : isHmmProfile(market.profileId) ? preparationCosts.hmm
      : isUfgProfile(market.profileId) ? preparationCosts.ufg : isRaetoProfile(market.profileId) ? preparationCosts.raeto
      : isAutoCompoundProfile(market.profileId) ? preparationCosts.autoCompound : preparationCosts.v4;
    gas += cost.market + cost.position * BigInt(positions - 1);
  }
  return gas;
}

/** Contiguous deterministic packing with compute headroom. The caller reserves
 * poster allocation separately from computeCap; neither resizes transaction gas. */
export function packPreparationBatches(plan: LaunchPlanV1, prepared: number, computeCap: bigint, headroomBps = 1500): number[] {
  const data = buildLifecycleCommand(plan, { kind: "prepare", first: prepared, count: 1 }).data;
  return packLifecyclePreparationBatches(plan, prepared, computeCap, headroomBps, preparationCalldataGas(data));
}

/** Internal path reuses the command already encoded for poster allocation. */
export function packLifecyclePreparationBatches(plan: LaunchPlanV1, prepared: number, computeCap: bigint, headroomBps: number, calldataGas: bigint): number[] {
  if (!Number.isSafeInteger(headroomBps) || headroomBps < 0 || headroomBps > 10000) throw new LifecyclePlanningError("INVALID_LIMITS", "Headroom must be between zero and10000 basis points");
  const padding = BigInt(10000 + Math.max(LIFECYCLE_CAPACITY_PADDING_BPS, headroomBps));
  const fits = (gas: bigint) => ((gas + calldataGas) * padding + 9999n) / 10000n <= computeCap;
  const batches = prepared > 0 ? [prepared] : [];
  let count = 0, gas = 0n;
  for (let index = prepared; index < plan.markets.length; index += 1) {
    const estimate = preparationGasEstimate(plan, index, 1);
    if (!fits(estimate)) throw new LifecyclePlanningError("PREPARATION_GAS_LIMIT", "A market exceeds the preparation gas budget. Reduce its positions before launching.");
    if (count > 0 && !fits(gas + estimate)) { batches.push(count); count = 0; gas = 0n; }
    count += 1;
    gas += estimate;
  }
  if (count > 0) batches.push(count);
  return batches;
}

export type LifecycleCommand =
  | { kind: "atomic" | "begin" | "activate" }
  | { kind: "prepare"; first: number; count: number };
type LifecycleUfgRoute = { account: Address; config: UfgLaunchConfig };

/** Internal encoder shared by complete plans and the one-command continuation. */
export function buildLifecycleCommand(plan: LaunchPlanV1, command: LifecycleCommand, ufg?: LifecycleUfgRoute): LifecycleTransaction {
  const abi = ufg === undefined ? launchLifecycleAbi : ufgLaunchProxyV1Abi;
  const base = { chainId: Number(plan.chainId), from: ufg?.account ?? plan.creator, to: ufg === undefined ? plan.orchestrator : UFG_LAUNCH_PROXY_ADDRESS };
  const value = command.kind === "atomic" || command.kind === "begin"
    ? plan.funding.reduce((total, funding) => total + (funding.kind === LifecycleFundingKind.NativeWrap || funding.kind === LifecycleFundingKind.Swap && BigInt(funding.inputAsset) === 0n ? funding.inputAmount : 0n), 0n) : 0n;
  switch (command.kind) {
    case "atomic": return { ...base, id: "atomic", kind: "atomic", data: encodeFunctionData({ abi, functionName: "launchAtomic", args: ufg === undefined ? [plan] : [plan, ufg.config] }), value, dependencies: [], postconditions: [{ kind: "launch", phase: "Active", preparedMarkets: plan.markets.length }] };
    case "begin": return { ...base, id: "begin", kind: "begin", data: encodeFunctionData({ abi, functionName: "beginLaunch", args: ufg === undefined ? [plan, LifecycleMode.Staged] : [plan, LifecycleMode.Staged, ufg.config] }), value, dependencies: [], postconditions: [{ kind: "launch", phase: "Preparing", preparedMarkets: 0 }] };
    case "activate": return { ...base, id: "activate", kind: "activate", data: encodeFunctionData({ abi, functionName: "activateLaunch", args: [plan] }), value, dependencies: [], postconditions: [{ kind: "launch", phase: "Active", preparedMarkets: plan.markets.length }] };
    case "prepare": return { ...base, id: `prepare:${command.first}:${command.count}`, kind: "prepare", data: encodeFunctionData({ abi, functionName: "prepareMarkets", args: [plan, command.first, command.count] }), value, dependencies: [], marketStart: command.first, marketCount: command.count,
      postconditions: [{ kind: "launch", phase: command.first + command.count === plan.markets.length ? "Ready" : "Preparing", preparedMarkets: command.first + command.count }] };
  }
}

/** Pure unsigned launch commands. Every command carries the complete commitment;
 * preparation splits only empty markets, never positions, buys or public opening.
 * Allowance discovery, recovery and gas-budget checks belong to the planner. */
export function buildLifecycleCommands({ plan, mode, preparationBatches }: BuildLaunchTransactionsOptions, ufg?: LifecycleUfgRoute): LifecycleTransaction[] {
  if (mode !== "atomic" && mode !== "staged") throw new LifecyclePlanningError("EXPLICIT_MODE_REQUIRED", "Choose atomic or staged explicitly; staged is never silently substituted");
  if (plan.chainId <= 0n || plan.chainId > BigInt(Number.MAX_SAFE_INTEGER)) throw new LifecyclePlanningError("CHAIN_MISMATCH", "Chain ID must be a positive exact JavaScript integer");
  if (plan.markets.length === 0 || plan.markets.length > 16) throw new LifecyclePlanningError("INVALID_MARKET_COUNT", "A launch requires between one and sixteen markets");
  if (mode === "atomic" && preparationBatches !== undefined) throw new LifecyclePlanningError("INVALID_PREPARATION_BATCHES", "Atomic execution has no separate preparation batches");
  assertLifecycleTokenAllocation(plan);
  const transactions: LifecycleTransaction[] = [];
  if (mode === "atomic") {
    transactions.push(buildLifecycleCommand(plan, { kind: "atomic" }, ufg));
  } else {
    const batches = preparationBatches ?? [plan.markets.length];
    if (batches.length === 0 || batches.some((count) => !Number.isSafeInteger(count) || count <= 0) || batches.reduce((total, count) => total + count, 0) !== plan.markets.length) throw new LifecyclePlanningError("INVALID_PREPARATION_BATCHES", "Positive ordered preparation counts must cover every market exactly");
    transactions.push(buildLifecycleCommand(plan, { kind: "begin" }, ufg));
    let first = 0;
    for (const count of batches) {
      transactions.push(buildLifecycleCommand(plan, { kind: "prepare", first, count }, ufg));
      first += count;
    }
    transactions.push(buildLifecycleCommand(plan, { kind: "activate" }, ufg));
  }
  return transactions.map((transaction, index) => ({ ...transaction, calldataBytes: (transaction.data.length - 2) / 2, dependencies: index === 0 ? [] : [transactions[index - 1]!.id] }));
}

/** Pure unsigned core commands, with no account nonce assigned by the SDK. */
export function buildLaunchTransactions(options: BuildLaunchTransactionsOptions): LifecycleTransaction[] {
  return buildLifecycleCommands(options);
}
