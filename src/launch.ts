import { ABYSS_FEE_TIERS } from "./abyss.js";
import { AUCTION_SUPPLY } from "./auction.js";

export const LAUNCH_REWARD_DURATION = 7 * 24 * 60 * 60;

/** Canonical P3 oracle default; reviewed V4 markets may select any valid registered oracle within their cardinality bounds. */
export const LAUNCH_ORACLE_CONFIG_ID =
  "0xc0e9bed88d70a13fd3ab31451fefdd073b7266e838aee0ad1c236c8c9eff855d" as const;
export const LAUNCH_DEADLINE_SECONDS = 20 * 60;
export const LAUNCH_BUY_SLIPPAGE_BPS = 50;
export const DEFAULT_LAUNCH_TARGET_MARKET_CAP_USD = 5_000;


export type AbyssFeePips = (typeof ABYSS_FEE_TIERS)[number]["feePips"];

export type LaunchPoolRecipeInput = {
  pairedTokenDecimals: number;
  pairedTokenUsdPriceX18: bigint;
  targetMarketCapUsdX18: bigint;
  launchedTokenIsQuote: boolean;
  fee: AbyssFeePips;
  supply?: bigint; tokenBudget?: bigint; tickSpacing?: number;
};

export type LaunchPoolRecipe = {
  launchTick: number;
  launchSqrtPriceX96: bigint;
  liquidity: bigint;
  launchedTokenAmountMaximum: bigint;
  pairedTokenAmountMaximum: 0n;
  tickLower: number; tickUpper: number;
};

export type LaunchPositionRangesInput = {
  /** Exact, spacing-aligned opening ratio, as returned by deriveLaunchPoolRecipe. */
  launchSqrtPriceX96: bigint;
  /** Existing launch convention: true means the launched token is token0. */
  launchedTokenIsQuote: boolean;
  /** Raw launch-token units allocated to ONE pool, not the entire launch supply. */
  tokenBudget: bigint;
  tickSpacing: number;
  venue: "abyss" | "uniswap-v4";
  /** Source-defined Black Market inventory weights, widths and gaps. */
  distributionPreset: "early-scarcity" | "staircase" | "smooth-ramp";
  positionCount?: number;
  /** Defaults to source-gaps; adjacent removes only Staircase's empty shelf gaps. */
  staircaseBoundaries?: "source-gaps" | "adjacent";
  /** Defaults to false; extends only the final band's far endpoint. */
  extendFinalRangeToBoundary?: boolean;
};

export type LaunchPositionRange = {
  tickLower: number;
  tickUpper: number;
  sqrtPriceLowerX96: bigint;
  sqrtPriceUpperX96: bigint;
  inventoryBps: number;
  /** Intended inventory allocation, including any rounding dust burned before buys. */
  allocatedTokenAmount: bigint;
  liquidity: bigint;
  /** Admitted maximum: equals allocatedTokenAmount, not the smaller actual mint debit. */
  maxTokenAmount: bigint;
  maxQuoteAmount: 0n;
};

export type LaunchPositionRanges = {
  launchTick: number;
  launchSqrtPriceX96: bigint;
  boundaryTick: number;
  boundarySqrtPriceX96: bigint;
  positions: readonly LaunchPositionRange[];
  tokenAmountMaximum: bigint;
  /** Expected rounding residual burned before buys; not an unallocated creator reserve. */
  unspentTokenAmount: bigint;
  totalLiquidity: bigint;
  openingActiveLiquidity: bigint;
  buySideLiquidity: bigint;
  maxLiquidityPerTick: bigint;
};

export type LaunchBuySqrtPriceLimitInput = {
  launchSqrtPriceX96: bigint;
  launchedTokenIsQuote: boolean;
  slippageBps?: number;
};

const Q32 = 1n << 32n;
const Q96 = 1n << 96n;
const MAX_UINT128 = (1n << 128n) - 1n;
const MAX_INT128 = (1n << 127n) - 1n;
const MAX_UINT160 = (1n << 160n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const MIN_INT24 = -(1 << 23);
const MAX_INT24 = (1 << 23) - 1;

// These are the deployed TickMathLib bounds. Swap limits are exclusive at both ends.
const MIN_TICK = -887_272;
const MAX_TICK = 887_272;
const MIN_SQRT_RATIO = 4_295_128_739n;
const MAX_SQRT_RATIO = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n;

// Canonical Uniswap v3 TickMath multipliers, matching contracts/src/oracles/TickMathLib.sol.
const TICK_MULTIPLIERS = [
  0xfffcb933bd6fad37aa2d162d1a594001n,
  0xfff97272373d413259a46990580e213an,
  0xfff2e50f5f656932ef12357cf3c7fdccn,
  0xffe5caca7e10e4e61c3624eaa0941cd0n,
  0xffcb9843d60f6159c9db58835c926644n,
  0xff973b41fa98c081472e6896dfb254c0n,
  0xff2ea16466c96a3843ec78b326b52861n,
  0xfe5dee046a99a2a811c461f1969c3053n,
  0xfcbe86c7900a88aedcffc83b479aa3a4n,
  0xf987a7253ac413176f2b074cf7815e54n,
  0xf3392b0822b70005940c7a398e4b70f3n,
  0xe7159475a2c29b7443b29c7fa6e889d9n,
  0xd097f3bdfd2022b8845ad8f792aa5825n,
  0xa9f746462d870fdf8a65dc1f90e061e5n,
  0x70d869a156d2a1b890bb3df62baf32f7n,
  0x31be135f97d08fd981231505542fcfa6n,
  0x9aa508b5b7a84e1c677de54f3e99bc9n,
  0x5d6af8dedb81196699c329225ee604n,
  0x2216e584f5fa1ea926041bedfe98n,
  0x48a170391f7dc42444e8fa2n,
] as const;

function assertUint(value: unknown, maximum: bigint, name: string): asserts value is bigint {
  if (typeof value !== "bigint" || value < 0n || value > maximum) {
    throw new Error(`${name} must be a nonnegative integer within its Solidity type`);
  }
}

function assertPositiveUint(value: unknown, maximum: bigint, name: string): asserts value is bigint {
  assertUint(value, maximum, name);
  if (value === 0n) throw new Error(`${name} must be positive`);
}

function assertInt24(value: unknown, name: string): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < MIN_INT24 ||
    value > MAX_INT24
  ) {
    throw new Error(`${name} must be an int24 integer`);
  }
}

function assertTokenDecimals(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`${name} must be a uint8 integer`);
  }
}


function assertCanonicalSqrtPrice(value: unknown, name: string): asserts value is bigint {
  assertUint(value, MAX_UINT160, name);
  if (value < MIN_SQRT_RATIO || value >= MAX_SQRT_RATIO) {
    throw new Error(`${name} is outside the canonical swap price bounds`);
  }
}

function getFeeTier(fee: unknown): (typeof ABYSS_FEE_TIERS)[number] {
  const tier = ABYSS_FEE_TIERS.find(({ feePips }) => feePips === fee);
  if (!tier) throw new Error("pool.fee is not an Abyss fee tier");
  return tier;
}

function integerSqrt(value: bigint): bigint {
  if (value < 0n) throw new Error("Cannot calculate a negative square root");
  if (value < 2n) return value;

  let x0 = value;
  let x1 = (x0 + value / x0) >> 1n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + value / x0) >> 1n;
  }
  return x0;
}

/** Canonical Q64.96 endpoint ratio, rounded up; MAX is not a usable swap limit. */
export function getSqrtRatioAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) {
    throw new Error("Tick is outside the canonical TickMath range");
  }

  const absoluteTick = Math.abs(tick);
  let ratio =
    absoluteTick & 1 ? TICK_MULTIPLIERS[0] : 0x100000000000000000000000000000000n;
  for (let bit = 1; bit < TICK_MULTIPLIERS.length; bit += 1) {
    if (absoluteTick & (1 << bit)) {
      ratio = (ratio * TICK_MULTIPLIERS[bit]!) >> 128n;
    }
  }
  if (tick > 0) ratio = MAX_UINT256 / ratio;
  return (ratio >> 32n) + (ratio % Q32 === 0n ? 0n : 1n);
}

function getTickAtSqrtRatio(sqrtPriceX96: bigint): number {
  assertCanonicalSqrtPrice(sqrtPriceX96, "sqrtPriceX96");

  let low = MIN_TICK;
  let high = MAX_TICK;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (getSqrtRatioAtTick(middle) <= sqrtPriceX96) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

// Usable endpoints require mathematical floor/ceil, including negative ticks.
function alignDown(tick: number, tickSpacing: number): number {
  return Math.floor(tick / tickSpacing) * tickSpacing;
}

function alignUp(tick: number, tickSpacing: number): number {
  return Math.ceil(tick / tickSpacing) * tickSpacing;
}

function launchBand(
  launchTick: number,
  tickSpacing: number,
  launchedTokenIsQuote: boolean,
): { tickLower: number; tickUpper: number } {
  const tickLower = launchedTokenIsQuote
    ? alignUp(launchTick, tickSpacing)
    : alignUp(MIN_TICK, tickSpacing);
  const tickUpper = launchedTokenIsQuote
    ? alignDown(MAX_TICK, tickSpacing)
    : alignDown(launchTick, tickSpacing);
  if (
    tickLower < MIN_TICK ||
    tickUpper > MAX_TICK ||
    tickLower >= tickUpper
  ) {
    throw new Error("launchTick cannot form a valid one-sided launch band");
  }
  return { tickLower, tickUpper };
}

function liquidityForAmount0(amount0: bigint, sqrtLowerX96: bigint, sqrtUpperX96: bigint): bigint {
  return (((amount0 * sqrtLowerX96) / Q96) * sqrtUpperX96) / (sqrtUpperX96 - sqrtLowerX96);
}

function liquidityForAmount1(amount1: bigint, sqrtLowerX96: bigint, sqrtUpperX96: bigint): bigint {
  return (amount1 * Q96) / (sqrtUpperX96 - sqrtLowerX96);
}

function divideRoundingUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

// Canonical SqrtPriceMath.getAmount0Delta(..., true) uses two ceiling divisions.
function amount0ForLiquidityRoundingUp(liquidity: bigint, sqrtLowerX96: bigint, sqrtUpperX96: bigint): bigint {
  return divideRoundingUp(
    divideRoundingUp((liquidity << 96n) * (sqrtUpperX96 - sqrtLowerX96), sqrtUpperX96),
    sqrtLowerX96,
  );
}

/**
 * Derives one-sided launch geometry from explicit supply, budget and fully diluted market cap.
 * The raw price remains a rational bigint until the canonical Q64.96 square root conversion.
 */
export function deriveLaunchPoolRecipe(
  input: LaunchPoolRecipeInput,
): LaunchPoolRecipe {
  assertTokenDecimals(input.pairedTokenDecimals, "pairedTokenDecimals");
  assertPositiveUint(input.pairedTokenUsdPriceX18, MAX_UINT256, "pairedTokenUsdPriceX18");
  assertPositiveUint(input.targetMarketCapUsdX18, MAX_UINT256, "targetMarketCapUsdX18");
  if (typeof input.launchedTokenIsQuote !== "boolean") {
    throw new Error("launchedTokenIsQuote must be a boolean");
  }

  const supply = input.supply ?? AUCTION_SUPPLY; const tokenBudget = input.tokenBudget ?? supply;
  assertPositiveUint(supply, MAX_UINT256, "supply"); assertPositiveUint(tokenBudget, MAX_UINT256, "tokenBudget");
  if (tokenBudget > supply) throw new Error("tokenBudget cannot exceed supply");
  const tickSpacing = input.tickSpacing ?? getFeeTier(input.fee).tickSpacing;
  if (!Number.isInteger(tickSpacing) || tickSpacing < 1 || tickSpacing > 32767) throw new Error("tickSpacing must be 1..32767");
  const pairedTokenUnit = 10n ** BigInt(input.pairedTokenDecimals);
  const [priceNumerator, priceDenominator]: [bigint, bigint] = input.launchedTokenIsQuote ? [input.targetMarketCapUsdX18 * pairedTokenUnit, input.pairedTokenUsdPriceX18 * supply] : [input.pairedTokenUsdPriceX18 * supply, input.targetMarketCapUsdX18 * pairedTokenUnit];
  const targetSqrtPriceX96 = integerSqrt((priceNumerator << 192n) / priceDenominator);
  const rawTick = getTickAtSqrtRatio(targetSqrtPriceX96);
  const launchTick = input.launchedTokenIsQuote
    ? Math.ceil(rawTick / tickSpacing) * tickSpacing
    : Math.floor(rawTick / tickSpacing) * tickSpacing;
  assertInt24(launchTick, "launchTick");

  const { tickLower, tickUpper } = launchBand(
    launchTick,
    tickSpacing,
    input.launchedTokenIsQuote,
  );
  const sqrtLowerX96 = getSqrtRatioAtTick(tickLower);
  const sqrtUpperX96 = getSqrtRatioAtTick(tickUpper);
  const launchSqrtPriceX96 = input.launchedTokenIsQuote ? sqrtLowerX96 : sqrtUpperX96;
  const liquidity = input.launchedTokenIsQuote
    ? liquidityForAmount0(tokenBudget, sqrtLowerX96, sqrtUpperX96)
    : liquidityForAmount1(tokenBudget, sqrtLowerX96, sqrtUpperX96);
  if (liquidity <= 0n || liquidity > MAX_UINT128) {
    throw new Error("Derived liquidity is outside the uint128 range");
  }

  return {
    launchTick,
    launchSqrtPriceX96,
    liquidity,
    launchedTokenAmountMaximum: tokenBudget,
    pairedTokenAmountMaximum: 0n,
    tickLower, tickUpper,
  };
}

// Black Market apps/web/src/lib/launch.ts uses cumulative rounding for both
// preset inventory weights (10,000 bps) and active widths (64 spacing steps).
function apportionLaunchInventory(total: number, scores: readonly number[]): number[] {
  const sum = scores.reduce((value, score) => value + score, 0);
  let cumulative = 0;
  let allocated = 0;
  return scores.map((score) => {
    cumulative += score;
    const next = Math.round((total * cumulative) / sum);
    const share = next - allocated;
    allocated = next;
    return share;
  });
}

/**
 * Source-defined one-sided Black Market presets, ordered toward higher launch-token
 * prices. The first position starts at launch; later bands are contiguous or leave
 * the preset's intentional gaps. Only an explicit final-tail adaptation reaches
 * the usable protocol boundary; no equal-tick extrapolation is applied.
 * Supply allocation across pools belongs to the caller: pass each pool's share.
 * Budget caps floor all but the final allocation, which receives the remainder.
 * Exact rational funding floors guarantee canonical rounded-up mint debits fit
 * their caps, without a percentage liquidity reserve or creator allocation.
 * Gross liquidity is checked at each endpoint, including adjacent shared ticks.
 * Active liquidity follows [lower, upper); the first downward token1 buy crosses
 * the opening upper endpoint and activates only the first reachable band.
 * Boundary ratios are position endpoints, not exclusive swap-price guards.
 */
export function deriveLaunchPositionRanges(input: LaunchPositionRangesInput): LaunchPositionRanges {
  assertCanonicalSqrtPrice(input.launchSqrtPriceX96, "launchSqrtPriceX96");
  assertPositiveUint(input.tokenBudget, MAX_UINT256, "tokenBudget");
  if (typeof input.launchedTokenIsQuote !== "boolean") throw new Error("launchedTokenIsQuote must be a boolean");
  const { tickSpacing, venue, distributionPreset } = input;
  if (!Number.isInteger(tickSpacing) || tickSpacing < 1 || tickSpacing > 32767) throw new Error("tickSpacing must be 1..32767");
  if (venue !== "abyss" && venue !== "uniswap-v4") throw new Error("venue must be abyss or uniswap-v4");
  if (distributionPreset !== "early-scarcity" && distributionPreset !== "staircase" && distributionPreset !== "smooth-ramp") {
    throw new Error("distributionPreset must be early-scarcity, staircase or smooth-ramp");
  }
  const positionCount = input.positionCount ?? 5;
  if (!Number.isInteger(positionCount) || positionCount < 2 || positionCount > 16) throw new Error("positionCount must be 2..16");
  const extendFinalRangeToBoundary = input.extendFinalRangeToBoundary ?? false;
  if (typeof extendFinalRangeToBoundary !== "boolean") throw new Error("extendFinalRangeToBoundary must be a boolean");
  const staircaseBoundaries = input.staircaseBoundaries === undefined ? "source-gaps" : input.staircaseBoundaries;
  if (staircaseBoundaries !== "source-gaps" && staircaseBoundaries !== "adjacent") {
    throw new Error("staircaseBoundaries must be source-gaps or adjacent");
  }
  if (input.staircaseBoundaries !== undefined && distributionPreset !== "staircase") {
    throw new Error("staircaseBoundaries is only valid for the staircase preset");
  }
  const launchTick = getTickAtSqrtRatio(input.launchSqrtPriceX96);
  if (launchTick % tickSpacing !== 0 || getSqrtRatioAtTick(launchTick) !== input.launchSqrtPriceX96) {
    throw new Error("Opening sqrt price must be an exact spacing-aligned tick");
  }
  const band = launchBand(launchTick, tickSpacing, input.launchedTokenIsQuote);
  const boundaryTick = input.launchedTokenIsQuote ? band.tickUpper : band.tickLower;
  const inventoryBps = apportionLaunchInventory(10_000, Array.from({ length: positionCount }, (_, index) => {
    if (distributionPreset === "early-scarcity") return (positionCount - 1) ** 2 + 15 * index ** 2;
    if (distributionPreset === "staircase") return (Math.floor((index * 4) / positionCount) + 1) ** 2;
    return positionCount + 2 * index;
  }));
  const widths = apportionLaunchInventory(64, inventoryBps.map((_, index) => {
    if (distributionPreset === "early-scarcity") return positionCount - 1 + 3 * index;
    if (distributionPreset === "staircase") return Math.floor((index * 4) / positionCount) + 1;
    return 2 * positionCount - index;
  }));

  // V4 Pool.sol floors the negative tick INDEX; Abyss Tick.sol truncates toward
  // zero, equivalent to ceil here. The resulting canonical capacities differ.
  const minimumTickIndex = venue === "uniswap-v4" ? Math.floor(MIN_TICK / tickSpacing) : Math.ceil(MIN_TICK / tickSpacing);
  const maximumTickIndex = Math.floor(MAX_TICK / tickSpacing);
  const maxLiquidityPerTick = MAX_UINT128 / BigInt(maximumTickIndex - minimumTickIndex + 1);
  const positions: LaunchPositionRange[] = [];
  const grossLiquidityByTick = new Map<number, bigint>();
  const direction = input.launchedTokenIsQuote ? 1 : -1;
  let distance = 0;
  let allocated = 0n;
  let totalLiquidity = 0n;
  let tokenAmountMaximum = 0n;
  let tokenAmountSpent = 0n;
  let openingActiveLiquidity = 0n;
  for (let index = 0; index < positionCount; index += 1) {
    const weight = inventoryBps[index]!;
    const allocatedTokenAmount = index === positionCount - 1
      ? input.tokenBudget - allocated
      : (input.tokenBudget * BigInt(weight)) / 10_000n;
    if (allocatedTokenAmount <= 0n) throw new Error("Every position must have a positive allocated token cap");
    allocated += allocatedTokenAmount;
    if (index > 0) {
      if (distributionPreset === "early-scarcity") {
        distance += 2 + Math.floor((4 * index) / (positionCount - 1));
      } else if (distributionPreset === "staircase" && staircaseBoundaries === "source-gaps" &&
        Math.floor((index * 4) / positionCount) !== Math.floor(((index - 1) * 4) / positionCount)) {
        distance += 3;
      }
    }
    const start = launchTick + direction * distance * tickSpacing;
    distance += widths[index]!;
    const canonicalEnd = launchTick + direction * distance * tickSpacing;
    if (Math.min(start, canonicalEnd) < band.tickLower || Math.max(start, canonicalEnd) > band.tickUpper) {
      throw new Error("The launch tick leaves too little room for this distribution preset");
    }
    const end = extendFinalRangeToBoundary && index === positionCount - 1 ? boundaryTick : canonicalEnd;
    const tickLower = Math.min(start, end);
    const tickUpper = Math.max(start, end);
    const sqrtLowerX96 = tickLower === launchTick ? input.launchSqrtPriceX96 : getSqrtRatioAtTick(tickLower);
    const sqrtUpperX96 = tickUpper === launchTick ? input.launchSqrtPriceX96 : getSqrtRatioAtTick(tickUpper);
    // For integer caps, flooring the exact rational inverse guarantees the
    // two-ceiling amount0 debit (or one-ceiling amount1 debit) cannot exceed cap.
    const liquidity = input.launchedTokenIsQuote
      ? (allocatedTokenAmount * sqrtLowerX96 * sqrtUpperX96) / (Q96 * (sqrtUpperX96 - sqrtLowerX96))
      : liquidityForAmount1(allocatedTokenAmount, sqrtLowerX96, sqrtUpperX96);
    if (liquidity <= 0n || liquidity > MAX_INT128) throw new Error("Derived position liquidity is outside the positive int128 mint range");
    const mintDebit = input.launchedTokenIsQuote
      ? amount0ForLiquidityRoundingUp(liquidity, sqrtLowerX96, sqrtUpperX96)
      : divideRoundingUp(liquidity * (sqrtUpperX96 - sqrtLowerX96), Q96);
    if (mintDebit <= 0n || mintDebit > allocatedTokenAmount || (venue === "uniswap-v4" && mintDebit > MAX_INT128)) {
      throw new Error("Derived position mint debit exceeds its budget or settlement range");
    }
    const lowerGross = (grossLiquidityByTick.get(tickLower) ?? 0n) + liquidity;
    const upperGross = (grossLiquidityByTick.get(tickUpper) ?? 0n) + liquidity;
    if (lowerGross > maxLiquidityPerTick || upperGross > maxLiquidityPerTick) {
      throw new Error(`Gross position liquidity exceeds the tick capacity at ${lowerGross > maxLiquidityPerTick ? tickLower : tickUpper}`);
    }
    grossLiquidityByTick.set(tickLower, lowerGross);
    grossLiquidityByTick.set(tickUpper, upperGross);
    totalLiquidity += liquidity;
    tokenAmountMaximum += allocatedTokenAmount;
    tokenAmountSpent += mintDebit;
    if (tickLower <= launchTick && launchTick < tickUpper) openingActiveLiquidity += liquidity;
    positions.push({ tickLower, tickUpper, sqrtPriceLowerX96: sqrtLowerX96, sqrtPriceUpperX96: sqrtUpperX96,
      inventoryBps: weight, allocatedTokenAmount, liquidity, maxTokenAmount: allocatedTokenAmount, maxQuoteAmount: 0n });
  }
  return {
    launchTick,
    launchSqrtPriceX96: input.launchSqrtPriceX96,
    boundaryTick,
    boundarySqrtPriceX96: getSqrtRatioAtTick(boundaryTick),
    positions,
    tokenAmountMaximum,
    unspentTokenAmount: input.tokenBudget - tokenAmountSpent,
    totalLiquidity,
    openingActiveLiquidity,
    buySideLiquidity: positions[0]!.liquidity,
    maxLiquidityPerTick,
  };
}

export type LaunchInitialBuyEstimateInput = {
  launchSqrtPriceX96: bigint;
  liquidity: bigint;
  pairedTokenAmountIn: bigint;
  launchedTokenIsQuote: boolean;
  fee: number;
  sqrtPriceLimitX96?: bigint;
};

export type LaunchInitialBuyEstimate = {
  launchedTokenAmountOut: bigint;
  pairedTokenAmountConsumed: bigint;
  sqrtPriceAfterX96: bigint;
};

/**
 * Pure estimate for the first exact-input buy against a fresh one-sided
 * launch position. No wallet balance, allowance, pool deployment, or RPC state.
 * Uses conservative input-fee rounding; execution simulation remains the final
 * authority before submission.
 */
export function estimateLaunchInitialBuy(
  input: LaunchInitialBuyEstimateInput,
): LaunchInitialBuyEstimate {
  assertCanonicalSqrtPrice(input.launchSqrtPriceX96, "launchSqrtPriceX96");
  assertPositiveUint(input.liquidity, MAX_UINT128, "liquidity");
  assertUint(input.pairedTokenAmountIn, MAX_UINT256, "pairedTokenAmountIn");
  if (!Number.isInteger(input.fee) || input.fee < 0 || input.fee >= 1000000) throw new Error("fee must be pips below 1000000");
  const fee = BigInt(input.fee);
  const amountAfterFee =
    (input.pairedTokenAmountIn * (1_000_000n - fee)) / 1_000_000n;
  if (amountAfterFee === 0n) {
    return {
      launchedTokenAmountOut: 0n,
      pairedTokenAmountConsumed: input.pairedTokenAmountIn,
      sqrtPriceAfterX96: input.launchSqrtPriceX96,
    };
  }

  const limit = input.sqrtPriceLimitX96;
  let sqrtPriceAfterX96: bigint;
  let launchedTokenAmountOut: bigint;
  if (input.launchedTokenIsQuote) {
    // Paired token is token1; exact token1 input moves price upward and buys token0.
    const delta = (amountAfterFee * Q96) / input.liquidity;
    sqrtPriceAfterX96 = input.launchSqrtPriceX96 + delta;
    if (limit !== undefined && sqrtPriceAfterX96 > limit) sqrtPriceAfterX96 = limit;
    launchedTokenAmountOut =
      (input.liquidity * (sqrtPriceAfterX96 - input.launchSqrtPriceX96) * Q96) /
      (sqrtPriceAfterX96 * input.launchSqrtPriceX96);
  } else {
    // Paired token is token0; exact token0 input moves price downward and buys token1.
    const numerator = input.liquidity * Q96 * input.launchSqrtPriceX96;
    const denominator = input.liquidity * Q96 + amountAfterFee * input.launchSqrtPriceX96;
    sqrtPriceAfterX96 = numerator / denominator;
    if (limit !== undefined && sqrtPriceAfterX96 < limit) sqrtPriceAfterX96 = limit;
    launchedTokenAmountOut =
      (input.liquidity * (input.launchSqrtPriceX96 - sqrtPriceAfterX96)) / Q96;
  }
  return {
    launchedTokenAmountOut,
    pairedTokenAmountConsumed: input.pairedTokenAmountIn,
    sqrtPriceAfterX96,
  };
}

function ceilSqrtRatio(numerator: bigint, denominator: bigint): bigint {
  const root = integerSqrt(numerator / denominator);
  return root * root * denominator === numerator ? root : root + 1n;
}

/**
 * Produces the router's exclusive sqrt-price guard for the paired-token initial buy.
 * A paired input moves down when the launch token is currency1 and up when it is currency0.
 */
export function deriveLaunchBuySqrtPriceLimitX96(
  input: LaunchBuySqrtPriceLimitInput,
): bigint {
  assertCanonicalSqrtPrice(input.launchSqrtPriceX96, "launchSqrtPriceX96");
  if (typeof input.launchedTokenIsQuote !== "boolean") {
    throw new Error("launchedTokenIsQuote must be a boolean");
  }

  const slippageBps = input.slippageBps ?? LAUNCH_BUY_SLIPPAGE_BPS;
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 9_999) {
    throw new Error("slippageBps must be an integer from 1 through 9,999");
  }

  const slippage = BigInt(slippageBps);
  const squaredLaunchSqrt = input.launchSqrtPriceX96 * input.launchSqrtPriceX96;
  if (input.launchedTokenIsQuote) {
    const limit = integerSqrt((squaredLaunchSqrt * (10_000n + slippage)) / 10_000n);
    return limit >= MAX_SQRT_RATIO ? MAX_SQRT_RATIO - 1n : limit;
  }

  const limit = ceilSqrtRatio(squaredLaunchSqrt * (10_000n - slippage), 10_000n);
  return limit <= MIN_SQRT_RATIO ? MIN_SQRT_RATIO + 1n : limit;
}
