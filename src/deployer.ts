import {
  type Address,
  encodeAbiParameters,
  encodeFunctionData,
  isAddress,
  isAddressEqual,
  keccak256,
  stringToHex,
  zeroAddress,
  type Hex,
} from "viem";
import {
  type AbyssPoolProfile,
  atomicInitialBuyComponents,
  dispositionComponents,
  TokenKind,
} from "./abyss.js";
import {
  type AtomicLaunchRequest,
  DUAL_DIVIDENDS_TEMPLATE_ID,
} from "./launch.js";

export const ABYSS_POOL_TYPE = keccak256(stringToHex("black-market.pool.abyss.v1"));
export const UNISWAP_V4_V2_POOL_TYPE = keccak256(stringToHex("black-market.pool.uniswap-v4.v2"));
export const UNISWAP_V4_V3_POOL_TYPE = keccak256(stringToHex("black-market.pool.uniswap-v4.v3"));
export type LaunchPoolKind = "abyss" | "uniswap-v4-v3";
export type HistoricalLaunchPoolKind = LaunchPoolKind | "uniswap-v4-v2";

export function launchPoolTypeId(kind: HistoricalLaunchPoolKind): Hex {
  switch (kind) {
    case "abyss": return ABYSS_POOL_TYPE;
    case "uniswap-v4-v2": return UNISWAP_V4_V2_POOL_TYPE;
    case "uniswap-v4-v3": return UNISWAP_V4_V3_POOL_TYPE;
  }
}

export const launchTokenTypeBurnableFixedV2 =
  "0xe586aada1251ca18ae2d1ae0dbc7b67412291ae7184e8bae678cd4a652351868" as Hex;
export const launchTokenTypeHolderDividendV2 =
  "0x84895d7e94d7d03c557ea01d250250b3d77eb2a648bb918acf50ec481843fa37" as Hex;

const tokenConfigComponents = [
  { name: "tokenType", type: "bytes32" }, { name: "tokenConfig", type: "bytes" },
  { name: "name", type: "string" }, { name: "symbol", type: "string" },
  { name: "decimals", type: "uint8" }, { name: "supply", type: "uint256" },
] as const;
export const abyssPoolConfigComponents = [
  { name: "pairedToken", type: "address" }, { name: "launchedTokenIsQuote", type: "bool" },
  { name: "profile", type: "uint8" }, { name: "fee", type: "uint24" },
  { name: "oracleConfigId", type: "bytes32" }, { name: "launchTick", type: "int24" },
  { name: "liquidity", type: "uint128" }, { name: "launchedTokenAmountMaximum", type: "uint256" },
  { name: "pairedTokenAmountMaximum", type: "uint256" },
] as const;
/** Active V4 V3 adapter wire format. Despite the route name, this is V4PoolConfigV2. */
export const uniswapV4PoolConfigComponents = [
  { name: "pairedToken", type: "address" }, { name: "profile", type: "uint8" },
  { name: "oracleConfigId", type: "bytes32" }, { name: "tickLower", type: "int24" },
  { name: "tickUpper", type: "int24" }, { name: "sqrtPriceX96", type: "uint160" },
  { name: "liquidity", type: "uint128" }, { name: "launchedTokenAmountMaximum", type: "uint256" },
  { name: "abyssFeePips", type: "uint24" }, { name: "externalLiquidityDisabled", type: "bool" },
] as const;
export const unifiedLaunchRequestComponents = [
  { name: "creator", type: "address" }, { name: "poolType", type: "bytes32" },
  { name: "templateId", type: "bytes32" }, { name: "templateVersion", type: "uint32" },
  { name: "token", type: "tuple", components: tokenConfigComponents },
  { name: "poolConfig", type: "bytes" },
  { name: "initialBuy", type: "tuple", components: atomicInitialBuyComponents },
  { name: "launchedTokenFees", type: "tuple", components: dispositionComponents },
  { name: "pairedTokenFees", type: "tuple", components: dispositionComponents },
  { name: "deadline", type: "uint256" },
] as const;
const unifiedLaunchReceiptComponents = [
  { name: "token", type: "address" }, { name: "pool", type: "address" }, { name: "tokenId", type: "uint256" },
  { name: "liquidityLaunchedTokenAmount", type: "uint256" }, { name: "liquidityPairedTokenAmount", type: "uint256" },
  { name: "initialBuyPairedTokenAmount", type: "uint256" }, { name: "initialBuyLaunchedTokenAmount", type: "uint256" },
  { name: "rewards", type: "address" }, { name: "splitter", type: "address" }, { name: "feeClaimer", type: "address" },
  { name: "poolData", type: "bytes" },
] as const;
export const unifiedLauncherAbi = [
  { type: "function", name: "poolRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "launch", stateMutability: "payable", inputs: [{ name: "request", type: "tuple", components: unifiedLaunchRequestComponents }], outputs: [{ name: "receipt", type: "tuple", components: unifiedLaunchReceiptComponents }] },
  { type: "event", name: "LaunchCompleted", anonymous: false, inputs: [
    { name: "poolType", type: "bytes32", indexed: true }, { name: "token", type: "address", indexed: true },
    { name: "creator", type: "address", indexed: true }, { name: "pool", type: "address", indexed: false },
    { name: "templateId", type: "bytes32", indexed: false }, { name: "templateVersion", type: "uint32", indexed: false },
    { name: "tokenId", type: "uint256", indexed: false }, { name: "liquidityLaunchedTokenAmount", type: "uint256", indexed: false },
    { name: "liquidityPairedTokenAmount", type: "uint256", indexed: false }, { name: "initialBuyPairedTokenAmount", type: "uint256", indexed: false },
    { name: "initialBuyLaunchedTokenAmount", type: "uint256", indexed: false },
  ] },
] as const;
export const wethAbi = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
] as const;
export const launchExecutionErrorsAbi = [
  { type: "error", name: "TransferFromFailed", inputs: [] },
] as const;
export const launchPoolRegistryV3Abi = [{ type: "function", name: "poolTypes", stateMutability: "view", inputs: [{ name: "poolType", type: "bytes32" }], outputs: [{ name: "adapter", type: "address" }, { name: "disabled", type: "bool" }] }] as const;
export const abyssLaunchPoolAdapterV3Abi = [{ type: "function", name: "launchFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const;
export const uniswapV4LaunchPoolAdapterV3Abi = [{ type: "function", name: "abyssFactory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;

export type UniswapV4PoolConfig = {
  pairedToken: Address; profile: AbyssPoolProfile; oracleConfigId: Hex; tickLower: number; tickUpper: number;
  sqrtPriceX96: bigint; liquidity: bigint; launchedTokenAmountMaximum: bigint; abyssFeePips: number; externalLiquidityDisabled: boolean;
};
export type UnifiedLaunchRequest = Omit<AtomicLaunchRequest, "token" | "pool"> & {
  poolType: Hex; token: { tokenType: Hex; tokenConfig: Hex; name: string; symbol: string; decimals: number; supply: bigint }; poolConfig: Hex;
};
export type UnifiedLaunchPool =
  | { kind: "abyss"; config: AtomicLaunchRequest["pool"] }
  | { kind: "uniswap-v4-v2" | "uniswap-v4-v3"; config: UniswapV4PoolConfig };

export function enabledLaunchPoolAdapter(entry: readonly [Address, boolean] | undefined): Address | undefined {
  return entry === undefined || entry[1] || isAddressEqual(entry[0], zeroAddress) ? undefined : entry[0];
}
export function encodeAbyssPoolConfig(config: AtomicLaunchRequest["pool"]): Hex {
  return encodeAbiParameters([{ type: "tuple", components: abyssPoolConfigComponents }], [config]);
}
export function encodeUniswapV4PoolConfig(config: UniswapV4PoolConfig): Hex {
  return encodeAbiParameters([{ type: "tuple", components: uniswapV4PoolConfigComponents }], [config]);
}
export function toUnifiedLaunchRequest(request: AtomicLaunchRequest, pool: UnifiedLaunchPool): UnifiedLaunchRequest {
  if (!isAddress(request.creator) || isAddressEqual(request.creator, zeroAddress)) throw new Error("creator must be a nonzero address");
  const { token, pool: _ignored, ...rest } = request;
  const dividends = token.kind === TokenKind.HolderDividend;
  return {
    ...rest, poolType: launchPoolTypeId(pool.kind),
    token: { tokenType: dividends ? launchTokenTypeHolderDividendV2 : launchTokenTypeBurnableFixedV2,
      tokenConfig: dividends ? encodeAbiParameters([{ type: "bool" }], [request.templateId === DUAL_DIVIDENDS_TEMPLATE_ID]) : "0x",
      name: token.name, symbol: token.symbol, decimals: token.decimals, supply: token.supply },
    poolConfig: pool.kind === "abyss" ? encodeAbyssPoolConfig(pool.config) : encodeUniswapV4PoolConfig(pool.config),
  };
}
export function buildUnifiedLaunchCalldata(request: UnifiedLaunchRequest): Hex {
  return encodeFunctionData({ abi: unifiedLauncherAbi, functionName: "launch", args: [request] });
}
export function unifiedLaunchValue(kind: HistoricalLaunchPoolKind, launchFee: bigint, nativeBuy = 0n): bigint {
  return kind === "abyss" ? launchFee + nativeBuy : 0n;
}

const MIN_TICK = -887_272;
const MAX_TICK = 887_272;
function tickAlignment(tick: number, spacing: number, up: boolean): number {
  const remainder = tick % spacing;
  return remainder === 0 ? tick : up ? tick + (spacing - remainder) : tick - remainder;
}
/** Builds the active V4 V3 route payload from an Abyss-derived recipe. */
export function toUniswapV4PoolConfig(
  pool: AtomicLaunchRequest["pool"], launchSqrtPriceX96: bigint, tickSpacing: number, externalLiquidityDisabled: boolean,
): UniswapV4PoolConfig {
  if (!Number.isInteger(tickSpacing) || tickSpacing <= 0) throw new Error("tickSpacing must be a positive integer");
  if (pool.liquidity < 101n) throw new Error("V4 liquidity is too small for the 99/1 split");
  const liquidity = pool.liquidity - (pool.liquidity % 100n === 0n ? 2n : 1n);
  return { pairedToken: pool.pairedToken, profile: pool.profile, oracleConfigId: pool.oracleConfigId,
    tickLower: pool.launchedTokenIsQuote ? pool.launchTick : tickAlignment(MIN_TICK, tickSpacing, true),
    tickUpper: pool.launchedTokenIsQuote ? tickAlignment(MAX_TICK, tickSpacing, false) : pool.launchTick,
    sqrtPriceX96: launchSqrtPriceX96, liquidity, launchedTokenAmountMaximum: pool.launchedTokenAmountMaximum,
    abyssFeePips: pool.fee, externalLiquidityDisabled };
}
