import type { LaunchPlanV1, MarketConfigV1 } from "./schema.js";
import { decodeAbyssLifecycleMarketConfig, decodePoolBoundV4LifecycleMarketConfig, decodeV4LifecycleMarketConfig, isPoolBoundV4ConfigVersion } from "./markets.js";
import { LifecyclePlanningError } from "./types.js";

/** Intended allocation is exact; actual mint rounding residuals burn before buys. */
export function assertLifecycleSupplyAllocation(plan: LaunchPlanV1): void {
  if (plan.markets.reduce((sum, market) => sum + market.tokenBudget, 0n) !== plan.token.supply) {
    throw new LifecyclePlanningError("INVALID_TOKEN_BUDGET", "Market token budgets must sum exactly to committed supply");
  }
}

export function assertLifecycleMarketAllocation(market: MarketConfigV1, positions: readonly ({ maxTokenAmount: bigint } | { tokenAmountMaximum: bigint })[]): number {
  if (positions.length === 0 || positions.length > 32) throw new LifecyclePlanningError("INVALID_POSITION_COUNT", "Every market requires one through 32 positions");
  const maxima = positions.reduce((sum, position) => sum + ("maxTokenAmount" in position ? position.maxTokenAmount : position.tokenAmountMaximum), 0n);
  if (maxima !== market.tokenBudget) throw new LifecyclePlanningError("INVALID_TOKEN_BUDGET", "Position token maxima must sum exactly to their market budget");
  return positions.length;
}

/** Pure compilation decodes once; planning reuses its already decoded configs. */
export function assertLifecycleTokenAllocation(plan: LaunchPlanV1): void {
  assertLifecycleSupplyAllocation(plan);
  let positionCount = 0;
  for (const market of plan.markets) {
    const positions = market.configVersion === 1
      ? decodeAbyssLifecycleMarketConfig(market.config).positions
      : market.configVersion === 4
        ? decodeV4LifecycleMarketConfig(market.config).positions
        : isPoolBoundV4ConfigVersion(market.configVersion)
          ? decodePoolBoundV4LifecycleMarketConfig(market.config, market.configVersion).positions
          : undefined;
    if (positions === undefined) throw new LifecyclePlanningError("UNSUPPORTED_CONFIG_VERSION", "Allocation requires an explicit supported position schema");
    positionCount += assertLifecycleMarketAllocation(market, positions);
  }
  if (positionCount > 32) throw new LifecyclePlanningError("INVALID_POSITION_COUNT", "A launch commits at most 32 total positions across every venue");
}
