import { encodeFunctionData } from "viem";
import { launchLifecycleAbi } from "./abi.js";
import { LifecycleFundingKind, LifecycleMode } from "./schema.js";
import { LifecyclePlanningError, type BuildLaunchTransactionsOptions, type LifecycleTransaction } from "./types.js";
import { assertLifecycleTokenAllocation } from "./allocations.js";

/** Pure unsigned launch commands. Every command carries the complete commitment;
 * preparation splits only empty markets, never positions, buys or public opening.
 * Allowance discovery, recovery and execution proof belong to the planner. */
export function buildLaunchTransactions({ plan, mode, preparationBatches }: BuildLaunchTransactionsOptions): LifecycleTransaction[] {
  if (mode !== "atomic" && mode !== "staged") throw new LifecyclePlanningError("EXPLICIT_MODE_REQUIRED", "Choose atomic or staged explicitly; staged is never silently substituted");
  if (plan.chainId <= 0n || plan.chainId > BigInt(Number.MAX_SAFE_INTEGER)) throw new LifecyclePlanningError("CHAIN_MISMATCH", "Chain ID must be a positive exact JavaScript integer");
  if (plan.markets.length === 0 || plan.markets.length > 16) throw new LifecyclePlanningError("INVALID_MARKET_COUNT", "A launch requires between one and sixteen markets");
  if (mode === "atomic" && preparationBatches !== undefined) throw new LifecyclePlanningError("INVALID_PREPARATION_BATCHES", "Atomic execution has no separate preparation batches");
  assertLifecycleTokenAllocation(plan);
  const nativeValue = plan.funding.reduce((total, funding) => total + (funding.kind === LifecycleFundingKind.NativeWrap || funding.kind === LifecycleFundingKind.Swap && BigInt(funding.inputAsset) === 0n ? funding.inputAmount : 0n), 0n);
  const base = { chainId: Number(plan.chainId), from: plan.creator, to: plan.orchestrator };
  const transactions: LifecycleTransaction[] = [];
  if (mode === "atomic") {
    transactions.push({ ...base, id: "atomic", kind: "atomic", data: encodeFunctionData({ abi: launchLifecycleAbi, functionName: "launchAtomic", args: [plan] }), value: nativeValue, dependencies: [], postconditions: [{ kind: "launch", phase: "Active", preparedMarkets: plan.markets.length }] });
  } else {
    const batches = preparationBatches ?? [plan.markets.length];
    if (batches.length === 0 || batches.some((count) => !Number.isSafeInteger(count) || count <= 0) || batches.reduce((total, count) => total + count, 0) !== plan.markets.length) throw new LifecyclePlanningError("INVALID_PREPARATION_BATCHES", "Positive ordered preparation counts must cover every market exactly");
    transactions.push({ ...base, id: "begin", kind: "begin", data: encodeFunctionData({ abi: launchLifecycleAbi, functionName: "beginLaunch", args: [plan, LifecycleMode.Staged] }), value: nativeValue, dependencies: [], postconditions: [{ kind: "launch", phase: "Preparing", preparedMarkets: 0 }] });
    let first = 0;
    for (const count of batches) {
      const completed = first + count;
      transactions.push({ ...base, id: `prepare:${first}:${count}`, kind: "prepare", data: encodeFunctionData({ abi: launchLifecycleAbi, functionName: "prepareMarkets", args: [plan, first, count] }), value: 0n, dependencies: [], marketStart: first, marketCount: count, postconditions: [{ kind: "launch", phase: completed === plan.markets.length ? "Ready" : "Preparing", preparedMarkets: completed }] });
      first = completed;
    }
    transactions.push({ ...base, id: "activate", kind: "activate", data: encodeFunctionData({ abi: launchLifecycleAbi, functionName: "activateLaunch", args: [plan] }), value: 0n, dependencies: [], postconditions: [{ kind: "launch", phase: "Active", preparedMarkets: plan.markets.length }] });
  }
  return transactions.map((transaction, index) => ({ ...transaction, calldataBytes: (transaction.data.length - 2) / 2, dependencies: index === 0 ? [] : [transactions[index - 1]!.id] }));
}
