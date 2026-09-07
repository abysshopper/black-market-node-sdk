import {
  type Address,
  encodeFunctionData,
  type Hex,
  isAddress,
  keccak256,
  stringToHex,
  zeroAddress,
} from "viem";
import { ABYSS_FEE_TIERS, AbyssPoolProfile, atomicLaunchFactoryAbi, TokenKind } from "./abyss.js";
import { AUCTION_SUPPLY } from "./auction.js";

export const INITIAL_TEMPLATE_VERSION = 1 as const;
export const STANDARD_TEMPLATE_ID = keccak256(stringToHex("black-market.standard"));
export const QUOTE_STAKING_TEMPLATE_ID = keccak256(stringToHex("black-market.quote-staking"));
export const QUOTE_DIVIDENDS_TEMPLATE_ID = keccak256(stringToHex("black-market.quote-dividends"));
export const DUAL_STAKING_TEMPLATE_ID = keccak256(stringToHex("black-market.dual-staking"));
export const DUAL_DIVIDENDS_TEMPLATE_ID = keccak256(stringToHex("black-market.dual-dividends"));
export const FEE_BURN_TEMPLATE_ID = keccak256(stringToHex("black-market.fee-burn"));
export const STANDARD_TEMPLATE_VERSION = INITIAL_TEMPLATE_VERSION;
export const LAUNCH_REWARD_DURATION = 7 * 24 * 60 * 60;

/**
 * Canonical registered volatile/P3 oracle configuration for Atomic launches.
 * Deployment evidence records maxAbsTickMove=17 and cardinality=4096 for this ID.
 */
export const ATOMIC_LAUNCH_ORACLE_CONFIG_ID =
  "0xc0e9bed88d70a13fd3ab31451fefdd073b7266e838aee0ad1c236c8c9eff855d" as const;

/** Existing Abyss execution policy: Atomic launch requests expire after 20 minutes. */
export const ATOMIC_LAUNCH_DEADLINE_SECONDS = 20 * 60;

/** Existing Abyss execution policy: initial Atomic buys tolerate 50 basis points of price movement. */
export const ATOMIC_LAUNCH_BUY_SLIPPAGE_BPS = 50;

/**
 * Atomic lifecycle recipes and tests use a $5,000 initial fully diluted market cap.
 * The form converts this editable whole-USD default to an X18 value before recipe derivation.
 */
export const DEFAULT_ATOMIC_LAUNCH_TARGET_MARKET_CAP_USD = 5_000;


export enum LaunchRewardMode {
  None,
  Staking,
  Dividends,
}

export enum LaunchFeeAssetMode {
  Profile,
  PairedOnly,
  Both,
  LaunchedOnly,
}

export enum LaunchFeeDestination {
  Owner = 1 << 0,
  Rewards = 1 << 1,
  Burn = 1 << 2,
}

export type LaunchTemplateId =
  | "standard"
  | "quote-staking"
  | "quote-dividends"
  | "dual-staking"
  | "dual-dividends"
  | "fee-burn";
export type AbyssFeePips = (typeof ABYSS_FEE_TIERS)[number]["feePips"];

export type FeeDisposition = {
  ownerBps: number;
  rewardsBps: number;
  burnBps: number;
};

export type LaunchTemplate = {
  id: LaunchTemplateId;
  templateId: Hex;
  version: typeof INITIAL_TEMPLATE_VERSION;
  label: string;
  tokenKinds: readonly TokenKind[];
  poolProfiles: readonly AbyssPoolProfile[];
  launchedTokenIsQuote: boolean;
  rewardMode: LaunchRewardMode;
  rewardDuration: number;
  feeAssetMode: LaunchFeeAssetMode;
  launchedTokenDestinations: number;
  pairedTokenDestinations: number;
};

const OWNER = LaunchFeeDestination.Owner;
const REWARDS = LaunchFeeDestination.Rewards;
const BURN = LaunchFeeDestination.Burn;
const BURNABLE_ONLY = [TokenKind.Burnable] as const;
const DIVIDEND_ONLY = [TokenKind.HolderDividend] as const;

export const LAUNCH_TEMPLATES = [
  {
    id: "standard",
    templateId: STANDARD_TEMPLATE_ID,
    version: INITIAL_TEMPLATE_VERSION,
    label: "Standard",
    tokenKinds: BURNABLE_ONLY,
    poolProfiles: [AbyssPoolProfile.StandardOracle, AbyssPoolProfile.QuoteOracle],
    launchedTokenIsQuote: false,
    rewardMode: LaunchRewardMode.None,
    rewardDuration: 0,
    feeAssetMode: LaunchFeeAssetMode.Profile,
    launchedTokenDestinations: OWNER,
    pairedTokenDestinations: OWNER,
  },
  {
    id: "quote-staking",
    templateId: QUOTE_STAKING_TEMPLATE_ID,
    version: INITIAL_TEMPLATE_VERSION,
    label: "Quote Staking",
    tokenKinds: BURNABLE_ONLY,
    poolProfiles: [AbyssPoolProfile.QuoteOracle],
    launchedTokenIsQuote: false,
    rewardMode: LaunchRewardMode.Staking,
    rewardDuration: LAUNCH_REWARD_DURATION,
    feeAssetMode: LaunchFeeAssetMode.PairedOnly,
    launchedTokenDestinations: 0,
    pairedTokenDestinations: OWNER | REWARDS,
  },
  {
    id: "quote-dividends",
    templateId: QUOTE_DIVIDENDS_TEMPLATE_ID,
    version: INITIAL_TEMPLATE_VERSION,
    label: "Quote Dividends",
    tokenKinds: DIVIDEND_ONLY,
    poolProfiles: [AbyssPoolProfile.QuoteOracle],
    launchedTokenIsQuote: false,
    rewardMode: LaunchRewardMode.Dividends,
    rewardDuration: LAUNCH_REWARD_DURATION,
    feeAssetMode: LaunchFeeAssetMode.PairedOnly,
    launchedTokenDestinations: 0,
    pairedTokenDestinations: OWNER | REWARDS,
  },
  {
    id: "dual-staking",
    templateId: DUAL_STAKING_TEMPLATE_ID,
    version: INITIAL_TEMPLATE_VERSION,
    label: "Dual Staking",
    tokenKinds: BURNABLE_ONLY,
    poolProfiles: [AbyssPoolProfile.StandardOracle],
    launchedTokenIsQuote: false,
    rewardMode: LaunchRewardMode.Staking,
    rewardDuration: LAUNCH_REWARD_DURATION,
    feeAssetMode: LaunchFeeAssetMode.Both,
    launchedTokenDestinations: OWNER | REWARDS | BURN,
    pairedTokenDestinations: OWNER | REWARDS,
  },
  {
    id: "dual-dividends",
    templateId: DUAL_DIVIDENDS_TEMPLATE_ID,
    version: INITIAL_TEMPLATE_VERSION,
    label: "Dual Dividends",
    tokenKinds: DIVIDEND_ONLY,
    poolProfiles: [AbyssPoolProfile.StandardOracle],
    launchedTokenIsQuote: false,
    rewardMode: LaunchRewardMode.Dividends,
    rewardDuration: LAUNCH_REWARD_DURATION,
    feeAssetMode: LaunchFeeAssetMode.Both,
    launchedTokenDestinations: OWNER | REWARDS | BURN,
    pairedTokenDestinations: OWNER | REWARDS,
  },
  {
    id: "fee-burn",
    templateId: FEE_BURN_TEMPLATE_ID,
    version: INITIAL_TEMPLATE_VERSION,
    label: "Fee Burn",
    tokenKinds: BURNABLE_ONLY,
    poolProfiles: [AbyssPoolProfile.QuoteOracle],
    launchedTokenIsQuote: true,
    rewardMode: LaunchRewardMode.None,
    rewardDuration: 0,
    feeAssetMode: LaunchFeeAssetMode.LaunchedOnly,
    launchedTokenDestinations: BURN,
    pairedTokenDestinations: 0,
  },
] as const satisfies readonly LaunchTemplate[];

export type AtomicLaunchRequest = {
  creator: Address;
  templateId: Hex;
  templateVersion: number;
  token: {
    kind: TokenKind;
    name: string;
    symbol: string;
    decimals: number;
    supply: bigint;
  };
  pool: {
    pairedToken: Address;
    launchedTokenIsQuote: boolean;
    profile: AbyssPoolProfile;
    fee: AbyssFeePips;
    oracleConfigId: Hex;
    launchTick: number;
    liquidity: bigint;
    launchedTokenAmountMaximum: bigint;
    pairedTokenAmountMaximum: bigint;
  };
  initialBuy: {
    pairedTokenAmountIn: bigint;
    launchedTokenAmountOutMinimum: bigint;
    sqrtPriceLimitX96: bigint;
  };
  launchedTokenFees: FeeDisposition;
  pairedTokenFees: FeeDisposition;
  deadline: bigint;
};

export type AtomicLaunchPoolRecipeInput = {
  pairedTokenDecimals: number;
  pairedTokenUsdPriceX18: bigint;
  targetMarketCapUsdX18: bigint;
  launchedTokenIsQuote: boolean;
  fee: AbyssFeePips;
};

export type AtomicLaunchPoolRecipe = {
  launchTick: number;
  launchSqrtPriceX96: bigint;
  liquidity: bigint;
  launchedTokenAmountMaximum: bigint;
  pairedTokenAmountMaximum: 0n;
};

export type AtomicLaunchBuySqrtPriceLimitInput = {
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
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const BYTES32_HEX = /^0x[0-9a-fA-F]{64}$/;

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

function assertOracleConfigId(value: unknown): asserts value is Hex {
  if (
    typeof value !== "string" ||
    !BYTES32_HEX.test(value) ||
    value.toLowerCase() === ZERO_BYTES32
  ) {
    throw new Error("pool.oracleConfigId must be a nonzero bytes32");
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

// Deliberately retain Solidity's signed-remainder alignment semantics from AtomicLaunchFactory.
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
    throw new Error("launchTick cannot form a valid Atomic launch band");
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
 * Derives the one-sided Atomic launch position from a target fully diluted market cap.
 * The raw price remains a rational bigint until the canonical Q64.96 square root conversion.
 */
export function deriveAtomicLaunchPoolRecipe(
  input: AtomicLaunchPoolRecipeInput,
): AtomicLaunchPoolRecipe {
  assertTokenDecimals(input.pairedTokenDecimals, "pairedTokenDecimals");
  assertPositiveUint(input.pairedTokenUsdPriceX18, MAX_UINT256, "pairedTokenUsdPriceX18");
  assertPositiveUint(input.targetMarketCapUsdX18, MAX_UINT256, "targetMarketCapUsdX18");
  if (typeof input.launchedTokenIsQuote !== "boolean") {
    throw new Error("launchedTokenIsQuote must be a boolean");
  }

  const feeTier = getFeeTier(input.fee);
  const pairedTokenUnit = 10n ** BigInt(input.pairedTokenDecimals);
  const [priceNumerator, priceDenominator]: [bigint, bigint] = input.launchedTokenIsQuote ? [input.targetMarketCapUsdX18 * pairedTokenUnit, input.pairedTokenUsdPriceX18 * AUCTION_SUPPLY] : [input.pairedTokenUsdPriceX18 * AUCTION_SUPPLY, input.targetMarketCapUsdX18 * pairedTokenUnit];
  const targetSqrtPriceX96 = integerSqrt((priceNumerator << 192n) / priceDenominator);
  const rawTick = getTickAtSqrtRatio(targetSqrtPriceX96);
  const launchTick = input.launchedTokenIsQuote
    ? Math.ceil(rawTick / feeTier.tickSpacing) * feeTier.tickSpacing
    : Math.floor(rawTick / feeTier.tickSpacing) * feeTier.tickSpacing;
  assertInt24(launchTick, "launchTick");

  const { tickLower, tickUpper } = launchBand(
    launchTick,
    feeTier.tickSpacing,
    input.launchedTokenIsQuote,
  );
  const sqrtLowerX96 = getSqrtRatioAtTick(tickLower);
  const sqrtUpperX96 = getSqrtRatioAtTick(tickUpper);
  const launchSqrtPriceX96 = input.launchedTokenIsQuote ? sqrtLowerX96 : sqrtUpperX96;
  const liquidity = input.launchedTokenIsQuote
    ? liquidityForAmount0(AUCTION_SUPPLY, sqrtLowerX96, sqrtUpperX96)
    : liquidityForAmount1(AUCTION_SUPPLY, sqrtLowerX96, sqrtUpperX96);
  if (liquidity <= 0n || liquidity > MAX_UINT128) {
    throw new Error("Derived liquidity is outside the uint128 range");
  }

  return {
    launchTick,
    launchSqrtPriceX96,
    liquidity,
    launchedTokenAmountMaximum: AUCTION_SUPPLY,
    pairedTokenAmountMaximum: 0n,
  };
}

export type AtomicLaunchInitialBuyEstimateInput = {
  launchSqrtPriceX96: bigint;
  liquidity: bigint;
  pairedTokenAmountIn: bigint;
  launchedTokenIsQuote: boolean;
  fee: AbyssFeePips;
  sqrtPriceLimitX96?: bigint;
};

export type AtomicLaunchInitialBuyEstimate = {
  launchedTokenAmountOut: bigint;
  pairedTokenAmountConsumed: bigint;
  sqrtPriceAfterX96: bigint;
};

/**
 * Pure estimate for the first exact-input buy against a fresh one-sided Atomic
 * launch position. No wallet balance, allowance, pool deployment, or RPC state.
 * Uses conservative input-fee rounding; execution simulation remains the final
 * authority before submission.
 */
export function estimateAtomicLaunchInitialBuy(
  input: AtomicLaunchInitialBuyEstimateInput,
): AtomicLaunchInitialBuyEstimate {
  assertCanonicalSqrtPrice(input.launchSqrtPriceX96, "launchSqrtPriceX96");
  assertPositiveUint(input.liquidity, MAX_UINT128, "liquidity");
  assertUint(input.pairedTokenAmountIn, MAX_UINT256, "pairedTokenAmountIn");
  const fee = BigInt(getFeeTier(input.fee).feePips);
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
 * A paired input moves down for deployAbove and up for fee-burn/deployBelow.
 */
export function deriveAtomicLaunchBuySqrtPriceLimitX96(
  input: AtomicLaunchBuySqrtPriceLimitInput,
): bigint {
  assertCanonicalSqrtPrice(input.launchSqrtPriceX96, "launchSqrtPriceX96");
  if (typeof input.launchedTokenIsQuote !== "boolean") {
    throw new Error("launchedTokenIsQuote must be a boolean");
  }

  const slippageBps = input.slippageBps ?? ATOMIC_LAUNCH_BUY_SLIPPAGE_BPS;
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
export function getLaunchTemplate(id: LaunchTemplateId): LaunchTemplate {
  const template = LAUNCH_TEMPLATES.find((candidate) => candidate.id === id);
  if (!template) throw new Error(`Unknown launch template: ${id}`);
  return template;
}

export function getLaunchTemplateByHash(templateId: Hex): LaunchTemplate {
  const template = LAUNCH_TEMPLATES.find(
    (candidate) => candidate.templateId.toLowerCase() === templateId.toLowerCase(),
  );
  if (!template) throw new Error(`Unknown launch template id: ${templateId}`);
  return template;
}

function dispositionTotal(disposition: FeeDisposition): number {
  return disposition.ownerBps + disposition.rewardsBps + disposition.burnBps;
}

function dispositionDestinations(disposition: FeeDisposition): number {
  return (
    (disposition.ownerBps === 0 ? 0 : OWNER) |
    (disposition.rewardsBps === 0 ? 0 : REWARDS) |
    (disposition.burnBps === 0 ? 0 : BURN)
  );
}

function validateDisposition(
  name: "launchedTokenFees" | "pairedTokenFees",
  disposition: FeeDisposition,
  active: boolean,
  allowedDestinations: number,
): void {
  if (
    !Number.isInteger(disposition.ownerBps) ||
    !Number.isInteger(disposition.rewardsBps) ||
    !Number.isInteger(disposition.burnBps) ||
    disposition.ownerBps < 0 ||
    disposition.rewardsBps < 0 ||
    disposition.burnBps < 0
  ) {
    throw new Error(`${name} must contain nonnegative integer basis points`);
  }

  const total = dispositionTotal(disposition);
  if (active ? total !== 10_000 : total !== 0) {
    throw new Error(`${name} must total ${active ? "10,000" : "zero"} basis points`);
  }
  if (dispositionDestinations(disposition) & ~allowedDestinations) {
    throw new Error(`${name} uses a destination not allowed by the template`);
  }
}

export function buildAtomicLaunchCalldata(
  request: AtomicLaunchRequest,
  nativeBuyAmount = 0n,
): Hex {
  if (!isAddress(request.creator) || request.creator.toLowerCase() === zeroAddress) {
    throw new Error("creator must be a nonzero address");
  }
  const template = getLaunchTemplateByHash(request.templateId);
  if (request.templateVersion !== template.version) throw new Error("Unsupported template version");
  if (!template.tokenKinds.includes(request.token.kind)) {
    throw new Error("Token kind is not supported by the template");
  }
  if (!template.poolProfiles.includes(request.pool.profile)) {
    throw new Error("Pool profile is not supported by the template");
  }
  if (!isAddress(request.pool.pairedToken) || request.pool.pairedToken.toLowerCase() === zeroAddress) {
    throw new Error("pairedToken must be a nonzero address");
  }
  if (request.pool.launchedTokenIsQuote !== template.launchedTokenIsQuote) {
    throw new Error("Pool orientation does not match the template");
  }

  const feeTier = getFeeTier(request.pool.fee);
  assertOracleConfigId(request.pool.oracleConfigId);
  assertInt24(request.pool.launchTick, "pool.launchTick");
  assertTokenDecimals(request.token.decimals, "token.decimals");
  assertPositiveUint(request.token.supply, MAX_UINT256, "token.supply");
  assertPositiveUint(request.pool.liquidity, MAX_UINT128, "pool.liquidity");
  assertPositiveUint(
    request.pool.launchedTokenAmountMaximum,
    MAX_UINT256,
    "pool.launchedTokenAmountMaximum",
  );
  assertUint(request.pool.pairedTokenAmountMaximum, MAX_UINT256, "pool.pairedTokenAmountMaximum");
  if (request.pool.pairedTokenAmountMaximum !== 0n) {
    throw new Error("pool.pairedTokenAmountMaximum must be zero for a single-sided Atomic launch");
  }
  if (request.pool.launchedTokenAmountMaximum > request.token.supply) {
    throw new Error("pool.launchedTokenAmountMaximum cannot exceed token.supply");
  }
  assertPositiveUint(request.deadline, MAX_UINT256, "deadline");

  assertUint(request.initialBuy.pairedTokenAmountIn, MAX_UINT256, "initialBuy.pairedTokenAmountIn");
  assertUint(nativeBuyAmount, MAX_UINT256, "nativeBuyAmount");
  assertUint(
    request.initialBuy.launchedTokenAmountOutMinimum,
    MAX_UINT256,
    "initialBuy.launchedTokenAmountOutMinimum",
  );
  assertUint(request.initialBuy.sqrtPriceLimitX96, MAX_UINT160, "initialBuy.sqrtPriceLimitX96");
  const effectiveBuyAmount = request.initialBuy.pairedTokenAmountIn + nativeBuyAmount;
  if (effectiveBuyAmount === 0n) {
    if (
      request.initialBuy.launchedTokenAmountOutMinimum !== 0n ||
      request.initialBuy.sqrtPriceLimitX96 !== 0n
    ) {
      throw new Error("zero initial buy cannot set output or price limits");
    }
  } else {
    if (request.initialBuy.sqrtPriceLimitX96 === 0n) {
      throw new Error("nonzero initial buy requires a directional price limit");
    }
    assertCanonicalSqrtPrice(
      request.initialBuy.sqrtPriceLimitX96,
      "initialBuy.sqrtPriceLimitX96",
    );
    const { tickLower, tickUpper } = launchBand(
      request.pool.launchTick,
      feeTier.tickSpacing,
      request.pool.launchedTokenIsQuote,
    );
    const launchSqrtPriceX96 = getSqrtRatioAtTick(
      request.pool.launchedTokenIsQuote ? tickLower : tickUpper,
    );
    if (
      (!request.pool.launchedTokenIsQuote &&
        request.initialBuy.sqrtPriceLimitX96 >= launchSqrtPriceX96) ||
      (request.pool.launchedTokenIsQuote &&
        request.initialBuy.sqrtPriceLimitX96 <= launchSqrtPriceX96)
    ) {
      throw new Error("initial buy price limit does not protect the paired-token swap direction");
    }
  }

  const launchedFeesActive =
    template.feeAssetMode === LaunchFeeAssetMode.Both ||
    template.feeAssetMode === LaunchFeeAssetMode.LaunchedOnly ||
    (template.feeAssetMode === LaunchFeeAssetMode.Profile &&
      request.pool.profile === AbyssPoolProfile.StandardOracle);
  const pairedFeesActive =
    template.feeAssetMode === LaunchFeeAssetMode.Profile ||
    template.feeAssetMode === LaunchFeeAssetMode.PairedOnly ||
    template.feeAssetMode === LaunchFeeAssetMode.Both;
  validateDisposition(
    "launchedTokenFees",
    request.launchedTokenFees,
    launchedFeesActive,
    template.launchedTokenDestinations,
  );
  validateDisposition(
    "pairedTokenFees",
    request.pairedTokenFees,
    pairedFeesActive,
    template.pairedTokenDestinations,
  );

  return encodeFunctionData({
    abi: atomicLaunchFactoryAbi,
    functionName: "deployAndLaunch",
    args: [request],
  });
}
