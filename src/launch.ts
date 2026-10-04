import { ABYSS_FEE_TIERS } from "./abyss.js";
import { AUCTION_SUPPLY } from "./auction.js";

export const LAUNCH_REWARD_DURATION = 7 * 24 * 60 * 60;

/** Canonical Abyss oracle ID; reviewed V4 uses the selected envelope's exact ID. */
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

export type LaunchBuySqrtPriceLimitInput = {
  launchSqrtPriceX96: bigint;
  launchedTokenIsQuote: boolean;
  slippageBps?: number;
};

const Q32 = 1n << 32n;
const Q96 = 1n << 96n;
const MAX_UINT128 = (1n << 128n) - 1n;
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

function getSqrtRatioAtTick(tick: number): bigint {
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

// Signed-remainder alignment matches the canonical Solidity range geometry.
function alignDown(tick: number, tickSpacing: number): number {
  const remainder = tick % tickSpacing;
  return remainder === 0 ? tick : tick - remainder;
}

function alignUp(tick: number, tickSpacing: number): number {
  const remainder = tick % tickSpacing;
  return remainder === 0 ? tick : tick + (tickSpacing - remainder);
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
