import type { Address } from "viem";
import { ABYSS_FEE_TIERS } from "../abyss.js";
import { getSqrtRatioAtTick, getTickAtSqrtRatio } from "../launch.js";
import { decodeAbyssLifecycleMarketConfig, decodePoolBoundV4LifecycleMarketConfig } from "./markets.js";
import { getKnownLifecycleProfile, KnownLifecycleProfile } from "./presets.js";
import type { LaunchPlanV1 } from "./schema.js";
import { LifecyclePlanningError, type LifecycleOpeningBuyQuote } from "./types.js";

// Independent integer model of the reviewed openings. Mathematical rounding and
// uint256 overflow branches match Uniswap v4 SqrtPriceMath/SwapMath (MIT) and
// the corresponding Abyss libraries. Bitmap word boundaries cannot be skipped:
// each step rounds input/fees up and output down, in the pool's favor.
const Q96 = 1n << 96n;
const PIPS = 1_000_000n;
const MAX_UINT256 = (1n << 256n) - 1n;
const MIN_PRICE = 4_295_128_739n;
const MAX_PRICE = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n;
const ceil = (numerator: bigint, denominator: bigint): bigint => (numerator + denominator - 1n) / denominator;

type OpeningState = {
  price: bigint; tick: number; liquidity: bigint; spacing: number;
  lpFee: bigint; hookFee: bigint;
  liquidityNet: Map<number, bigint>; ticks: number[];
};

/** Only the exact release-owned schemas/hooks have profiled opening behavior. */
export function hasProfiledOpeningMath(plan: LaunchPlanV1): boolean {
  return plan.markets.every((market) => {
    const preset = getKnownLifecycleProfile({ chainId: plan.chainId, orchestrator: plan.orchestrator, profileId: market.profileId });
    return preset?.supported === true && preset.profile.topology.configVersion === market.configVersion &&
      preset.profile.registration.adapterId.toLowerCase() === market.adapterId.toLowerCase();
  });
}

function openingState(plan: LaunchPlanV1, marketIndex: number): OpeningState {
  const market = plan.markets[marketIndex];
  if (market === undefined) throw new LifecyclePlanningError("INVALID_BUY", "Opening buy market index is outside the plan");
  const preset = getKnownLifecycleProfile({ chainId: plan.chainId, orchestrator: plan.orchestrator, profileId: market.profileId });
  if (preset?.supported !== true || preset.profile.topology.configVersion !== market.configVersion ||
    preset.profile.registration.adapterId.toLowerCase() !== market.adapterId.toLowerCase()) throw new LifecyclePlanningError("OPENING_BUY_NOT_PROFILED", "Opening buy math requires the exact release-owned profile and schema");
  let price: bigint, spacing: number, lpFee: bigint, hookFee = 0n;
  let positions: readonly { tickLower: number; tickUpper: number; liquidity: bigint }[];
  if (market.configVersion === 1) {
    const config = decodeAbyssLifecycleMarketConfig(market.config);
    const tier = ABYSS_FEE_TIERS.find((candidate) => candidate.feePips === config.fee);
    if (tier === undefined || preset.key !== `abyss-${config.profile}`) throw new LifecyclePlanningError("INVALID_MARKET", "Abyss opening must use its committed profile and canonical fee tier");
    price = config.openingSqrtPriceX96; spacing = tier.tickSpacing; lpFee = BigInt(config.fee); positions = config.positions;
  } else {
    // All current release-owned V4 offerings use config6. Dynamic first buys
    // share the opening block's minimum fee. HMM work starts onOpened and
    // auto-compounding defers until openingCompletedAt, after all opening buys.
    const config = decodePoolBoundV4LifecycleMarketConfig(market.config, 6);
    if (config.profileId.toLowerCase() !== market.profileId.toLowerCase()) throw new LifecyclePlanningError("INVALID_MARKET", "V4 opening config differs from the selected profile");
    price = config.sqrtPriceX96; spacing = config.tickSpacing; lpFee = BigInt(config.lpFeePips); positions = config.positions;
    const dynamic = preset.key === KnownLifecycleProfile.V4DynamicFeePool || preset.key === KnownLifecycleProfile.V4HmmDynamicPool || preset.key === KnownLifecycleProfile.V4UfgDynamicPool || preset.key === KnownLifecycleProfile.V4AutoCompoundDynamicPool || preset.key === KnownLifecycleProfile.V4RaetoDynamicPool;
    hookFee = BigInt(dynamic ? config.minimumHookFeePips! : config.hookFeePips);
  }
  const tick = getTickAtSqrtRatio(price), liquidityNet = new Map<number, bigint>();
  let liquidity = 0n;
  for (const position of positions) {
    liquidityNet.set(position.tickLower, (liquidityNet.get(position.tickLower) ?? 0n) + position.liquidity);
    liquidityNet.set(position.tickUpper, (liquidityNet.get(position.tickUpper) ?? 0n) - position.liquidity);
    if (position.tickLower <= tick && tick < position.tickUpper) liquidity += position.liquidity;
  }
  return { price, tick, liquidity, spacing, lpFee, hookFee, liquidityNet, ticks: [...liquidityNet.keys()].sort((a, b) => a - b) };
}

function lowerBound(ticks: readonly number[], value: number): number {
  let left = 0, right = ticks.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (ticks[middle]! < value) left = middle + 1; else right = middle;
  }
  return left;
}

function nextTick(state: OpeningState, zeroForOne: boolean): number {
  const compressed = Math.floor(state.tick / state.spacing) + (zeroForOne ? 0 : 1);
  const first = Math.floor(compressed / 256) * 256, last = first + 255;
  const index = lowerBound(state.ticks, (compressed + (zeroForOne ? 1 : 0)) * state.spacing) - (zeroForOne ? 1 : 0);
  const initialized = state.ticks[index];
  const selected = initialized !== undefined && initialized >= first * state.spacing && initialized <= last * state.spacing
    ? initialized : (zeroForOne ? first : last) * state.spacing;
  return Math.max(-887272, Math.min(887272, selected));
}

function amount0(a: bigint, b: bigint, liquidity: bigint, roundUp: boolean): bigint {
  if (a > b) [a, b] = [b, a];
  const numerator = liquidity * Q96 * (b - a), denominator = a * b;
  return roundUp ? ceil(numerator, denominator) : numerator / denominator;
}
function amount1(a: bigint, b: bigint, liquidity: bigint, roundUp: boolean): bigint {
  const numerator = liquidity * (a > b ? a - b : b - a);
  return roundUp ? ceil(numerator, Q96) : numerator / Q96;
}
function inputPrice(price: bigint, liquidity: bigint, input: bigint, zeroForOne: boolean): bigint {
  if (input === 0n) return price;
  if (!zeroForOne) return price + input * Q96 / liquidity;
  const numerator = liquidity * Q96, product = input * price, denominator = numerator + product;
  return product <= MAX_UINT256 && denominator <= MAX_UINT256
    ? ceil(numerator * price, denominator)
    : ceil(numerator, numerator / price + input);
}

function swap(state: OpeningState, amount: bigint, limit: bigint, zeroForOne: boolean): { tokenOut: bigint; quoteSpent: bigint } {
  let remaining = amount, tokenOut = 0n;
  while (remaining > 0n && state.price !== limit) {
    const tick = nextTick(state, zeroForOne), boundary = getSqrtRatioAtTick(tick), before = state.price;
    const target = zeroForOne ? boundary < limit ? limit : boundary : boundary > limit ? limit : boundary;
    const available = remaining * (PIPS - state.lpFee) / PIPS;
    const required = zeroForOne ? amount0(target, before, state.liquidity, true) : amount1(before, target, state.liquidity, true);
    let next: bigint, spent: bigint;
    if (available >= required) {
      next = target;
      spent = required + (state.lpFee === PIPS ? 0n : ceil(required * state.lpFee, PIPS - state.lpFee));
    } else {
      next = inputPrice(before, state.liquidity, available, zeroForOne);
      spent = remaining;
    }
    tokenOut += zeroForOne ? amount1(next, before, state.liquidity, false) : amount0(before, next, state.liquidity, false);
    remaining -= spent;
    state.price = next;
    if (next === boundary) {
      const net = state.liquidityNet.get(tick);
      if (net !== undefined) state.liquidity += zeroForOne ? -net : net;
      state.tick = zeroForOne ? tick - 1 : tick;
    } else if (next !== before) state.tick = getTickAtSqrtRatio(next);
  }
  return { tokenOut, quoteSpent: amount - remaining };
}

/** Exact integer opening-curve outputs for ordered, unopened release templates.
 * This is not a live-pool quote or execution proof. Funding, token callbacks,
 * current registry admission and wallet execution remain separate authorities. */
export function computeLifecycleOpeningBuys(options: { plan: LaunchPlanV1; predictedToken: Address }): LifecycleOpeningBuyQuote[] {
  const { plan, predictedToken } = options, states = new Map<number, OpeningState>();
  const quotes: LifecycleOpeningBuyQuote[] = [];
  for (const [buyIndex, buy] of plan.buys.entries()) {
    if (!Number.isSafeInteger(buy.marketIndex) || buy.marketIndex < 0 || typeof buy.quoteAmountIn !== "bigint" || buy.quoteAmountIn <= 0n || buy.quoteAmountIn > MAX_UINT256 >> 1n) throw new LifecyclePlanningError("INVALID_BUY", "Opening buy requires a valid market and positive int256 input");
    let state = states.get(buy.marketIndex);
    if (state === undefined) { state = openingState(plan, buy.marketIndex); states.set(buy.marketIndex, state); }
    const market = plan.markets[buy.marketIndex]!, zeroForOne = BigInt(market.quoteAsset) < BigInt(predictedToken);
    if (typeof buy.sqrtPriceLimitX96 !== "bigint") throw new LifecyclePlanningError("INVALID_BUY_PRICE_LIMIT", "Opening buy price limit must be an exact bigint");
    // Only the V4 lifecycle adapter resolves this sentinel. Abyss calls its
    // pool directly, so zero remains invalid there. Never rewrite calldata.
    const limit = market.configVersion !== 1 && buy.sqrtPriceLimitX96 === 0n
      ? zeroForOne ? MIN_PRICE + 1n : MAX_PRICE - 1n : buy.sqrtPriceLimitX96;
    if (market.quoteAsset.toLowerCase() === predictedToken.toLowerCase() || limit <= MIN_PRICE || limit >= MAX_PRICE ||
      (zeroForOne ? limit >= state.price : limit <= state.price)) throw new LifecyclePlanningError("INVALID_BUY_PRICE_LIMIT", "Opening buy price limit must be strictly beyond the current curve price in the input direction");
    const hookCharge = buy.quoteAmountIn * state.hookFee / PIPS;
    const adjusted = buy.quoteAmountIn - hookCharge;
    const result = swap(state, adjusted, limit, zeroForOne);
    if (hookCharge > 0n && result.quoteSpent !== adjusted) throw new LifecyclePlanningError("INCOMPLETE_BUY_FILL", "A specified-input hook fee requires the complete adjusted input to fill");
    quotes.push({ buyIndex, marketIndex: buy.marketIndex, quoteAmountIn: buy.quoteAmountIn, quoteSpent: result.quoteSpent + hookCharge, tokenOut: result.tokenOut, sqrtPriceAfterX96: state.price });
  }
  return quotes;
}
