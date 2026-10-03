import { decodeAbiParameters, encodeAbiParameters, type Address, type Hex } from "viem";

export type V4LifecyclePositionConfig = {
  tickLower: number; tickUpper: number; liquidity: bigint; salt: Hex; maxTokenAmount: bigint;
};
export type V4LifecycleMarketConfig = {
  version: 2; lpFeePips: number; tickSpacing: number; sqrtPriceX96: bigint; hookFeePips: number;
  feeMode: number; protocolFeeDenominator: number; treasury: Address; externalLiquidityDisabled: boolean;
  oracleConfigId: Hex; positions: readonly V4LifecyclePositionConfig[];
};
export const v4LifecyclePositionComponents = [
  { name: "tickLower", type: "int24" }, { name: "tickUpper", type: "int24" },
  { name: "liquidity", type: "uint128" }, { name: "salt", type: "bytes32" }, { name: "maxTokenAmount", type: "uint256" },
] as const;
export const v4LifecycleMarketComponents = [
  { name: "version", type: "uint16" }, { name: "lpFeePips", type: "uint24" }, { name: "tickSpacing", type: "int24" },
  { name: "sqrtPriceX96", type: "uint160" }, { name: "hookFeePips", type: "uint24" }, { name: "feeMode", type: "uint8" },
  { name: "protocolFeeDenominator", type: "uint8" }, { name: "treasury", type: "address" },
  { name: "externalLiquidityDisabled", type: "bool" },
  { name: "oracleConfigId", type: "bytes32" },
  { name: "positions", type: "tuple[]", components: v4LifecyclePositionComponents },
] as const;
export function encodeV4LifecycleMarketConfig(config: V4LifecycleMarketConfig): Hex {
  if (config.version !== 2) throw new Error("V4 lifecycle market config version must be 2");
  return encodeAbiParameters([{ type: "tuple", components: v4LifecycleMarketComponents }], [config]);
}
export function decodeV4LifecycleMarketConfig(encoded: Hex): V4LifecycleMarketConfig {
  const config = decodeAbiParameters([{ type: "tuple", components: v4LifecycleMarketComponents }], encoded)[0];
  if (config.version !== 2) throw new Error("V4 lifecycle market config version must be 2");
  return config as V4LifecycleMarketConfig;
}

export type AbyssLifecyclePositionConfig = {
  tickLower: number; tickUpper: number; liquidity: bigint; tokenAmountMaximum: bigint;
};
export type AbyssLifecycleMarketConfig = {
  profile: number; fee: number; oracleConfigId: Hex; openingSqrtPriceX96: bigint;
  positions: readonly AbyssLifecyclePositionConfig[];
};
export const abyssLifecyclePositionComponents = [
  { name: "tickLower", type: "int24" }, { name: "tickUpper", type: "int24" },
  { name: "liquidity", type: "uint128" }, { name: "tokenAmountMaximum", type: "uint256" },
] as const;
export const abyssLifecycleMarketComponents = [
  { name: "profile", type: "uint8" }, { name: "fee", type: "uint24" }, { name: "oracleConfigId", type: "bytes32" },
  { name: "openingSqrtPriceX96", type: "uint160" },
  { name: "positions", type: "tuple[]", components: abyssLifecyclePositionComponents },
] as const;
export function encodeAbyssLifecycleMarketConfig(config: AbyssLifecycleMarketConfig): Hex {
  if (!Number.isInteger(config.profile) || config.profile < 0 || config.profile > 3) throw new Error("Unsupported Abyss lifecycle pool profile");
  return encodeAbiParameters([{ type: "tuple", components: abyssLifecycleMarketComponents }], [config]);
}
export function decodeAbyssLifecycleMarketConfig(encoded: Hex): AbyssLifecycleMarketConfig {
  return decodeAbiParameters([{ type: "tuple", components: abyssLifecycleMarketComponents }], encoded)[0];
}
