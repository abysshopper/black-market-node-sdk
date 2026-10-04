import { concatHex, decodeAbiParameters, encodeAbiParameters, getCreate2Address, keccak256, stringToHex, toHex, zeroHash, type Address, type Hex } from "viem";
import type { MarketConfigV1 } from "./schema.js";
import { LifecyclePlanningError, type PoolBoundHookSaltProgress } from "./types.js";

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

export type V4PoolBoundLifecycleMarketConfig = Omit<V4LifecycleMarketConfig, "version"> & { version: 3; hookSalt: Hex };
export const V4_POOL_BOUND_LIFECYCLE_PROFILE_ID = keccak256(stringToHex("black-market.v4-pool-bound-lifecycle-market.v1"));
export const V4_POOL_BOUND_LIFECYCLE_ADAPTER_ID = keccak256(stringToHex("black-market.adapter.v4-pool-bound-lifecycle.v1"));
export const V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA = keccak256(stringToHex("(uint16,uint24,int24,uint160,uint24,uint8,uint8,address,bool,bytes32,bytes32,(int24,int24,uint128,bytes32,uint256)[])"));
export const V4_POOL_BOUND_MARKET_ECONOMICS_DOMAIN = keccak256(stringToHex("black-market.v4-pool-bound-market-economics.v1"));
export const V4_LIFECYCLE_HOOK_PERMISSION_MASK = 0x3fffn;
export const V4_LIFECYCLE_HOOK_PERMISSIONS = 0x1afcn;
export const poolBoundV4LifecycleMarketComponents = [
  { name: "version", type: "uint16" }, { name: "lpFeePips", type: "uint24" }, { name: "tickSpacing", type: "int24" },
  { name: "sqrtPriceX96", type: "uint160" }, { name: "hookFeePips", type: "uint24" }, { name: "feeMode", type: "uint8" },
  { name: "protocolFeeDenominator", type: "uint8" }, { name: "treasury", type: "address" },
  { name: "externalLiquidityDisabled", type: "bool" }, { name: "oracleConfigId", type: "bytes32" },
  { name: "hookSalt", type: "bytes32" },
  { name: "positions", type: "tuple[]", components: v4LifecyclePositionComponents },
] as const;

export function encodePoolBoundV4LifecycleMarketConfig(config: V4PoolBoundLifecycleMarketConfig): Hex {
  if (config.version !== 3) throw new Error("Pool-bound V4 lifecycle market config version must be 3");
  return encodeAbiParameters([{ type: "tuple", components: poolBoundV4LifecycleMarketComponents }], [config]);
}
export function decodePoolBoundV4LifecycleMarketConfig(encoded: Hex): V4PoolBoundLifecycleMarketConfig {
  const config = decodeAbiParameters([{ type: "tuple", components: poolBoundV4LifecycleMarketComponents }], encoded)[0];
  if (config.version !== 3) throw new Error("Pool-bound V4 lifecycle market config version must be 3");
  return config as V4PoolBoundLifecycleMarketConfig;
}

export type PoolBoundHookParametersV1 = {
  poolManager: Address; registrar: Address; oracleFactory: Address; core: Address; liquidityLocker: Address;
  token: Address; quoteCurrency: Address; lpFeePips: number; tickSpacing: number; sqrtPriceX96: bigint;
  hookFeePips: number; feeMode: number; protocolFeeDenominator: number; treasury: Address;
  externalLiquidityDisabled: boolean; oracleConfigId: Hex; marketCommitment: Hex; expectedPositionCount: number;
};
export const poolBoundHookParametersV1Components = [
  { name: "poolManager", type: "address" }, { name: "registrar", type: "address" },
  { name: "oracleFactory", type: "address" }, { name: "core", type: "address" },
  { name: "liquidityLocker", type: "address" }, { name: "token", type: "address" },
  { name: "quoteCurrency", type: "address" }, { name: "lpFeePips", type: "uint24" },
  { name: "tickSpacing", type: "int24" }, { name: "sqrtPriceX96", type: "uint160" },
  { name: "hookFeePips", type: "uint24" }, { name: "feeMode", type: "uint8" },
  { name: "protocolFeeDenominator", type: "uint8" }, { name: "treasury", type: "address" },
  { name: "externalLiquidityDisabled", type: "bool" }, { name: "oracleConfigId", type: "bytes32" },
  { name: "marketCommitment", type: "bytes32" }, { name: "expectedPositionCount", type: "uint32" },
] as const;
export function encodePoolBoundHookParameters(parameters: PoolBoundHookParametersV1): Hex {
  return encodeAbiParameters([{ type: "tuple", components: poolBoundHookParametersV1Components }], [parameters]);
}
export function hashPoolBoundV4MarketCommitment(options: { chainId: bigint; core: Address; registrar: Address; token: Address; market: MarketConfigV1 }): Hex {
  const { chainId, core, registrar, token, market } = options;
  if (market.configVersion !== 3 || market.profileId.toLowerCase() !== V4_POOL_BOUND_LIFECYCLE_PROFILE_ID.toLowerCase()) throw new LifecyclePlanningError("INVALID_BOUND_MARKET", "Market is not the exact pool-bound V4 profile/version");
  const config = decodePoolBoundV4LifecycleMarketConfig(market.config);
  const configHash = keccak256(encodePoolBoundV4LifecycleMarketConfig({ ...config, hookSalt: zeroHash }));
  return keccak256(encodeAbiParameters([
    { type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "address" },
    { type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "uint256" }, { type: "uint32" }, { type: "bytes32" },
  ], [V4_POOL_BOUND_MARKET_ECONOMICS_DOMAIN, chainId, core, registrar, token, market.adapterId, market.profileId, market.quoteAsset, market.tokenBudget, market.configVersion, configHash]));
}
export function hasLifecycleV4HookPermissions(hook: Address): boolean {
  return (BigInt(hook) & V4_LIFECYCLE_HOOK_PERMISSION_MASK) === V4_LIFECYCLE_HOOK_PERMISSIONS;
}
export function predictPoolBoundHookAddress(options: { deployer: Address; initCodeHash: Hex; salt: Hex }): Address {
  return getCreate2Address({ from: options.deployer, bytecodeHash: options.initCodeHash, salt: options.salt });
}
export function poolBoundHookInitCodeHash(creationCode: Hex, parameters: PoolBoundHookParametersV1): Hex {
  return keccak256(concatHex([creationCode, encodePoolBoundHookParameters(parameters)]));
}

/** Deterministic CREATE2 search with a macrotask boundary before work and between bounded batches. */
export async function minePoolBoundHookSalt(options: {
  deployer: Address; initCodeHash: Hex; startSalt?: bigint; signal?: AbortSignal;
  onProgress?: (progress: PoolBoundHookSaltProgress) => void;
}): Promise<{ salt: Hex; predictedHook: Address }> {
  const { signal, onProgress } = options;
  let candidate = options.startSalt ?? 0n;
  if (candidate < 0n || candidate >= 1n << 256n) throw new LifecyclePlanningError("INVALID_HOOK_SALT", "Starting hook salt must fit uint256");
  const checkCancelled = () => {
    if (signal?.aborted) throw Object.assign(new Error("Pool-bound hook salt mining cancelled"), { name: "AbortError" });
  };
  let attempts = 0n;
  checkCancelled();
  const initialSalt = toHex(candidate, { size: 32 });
  onProgress?.({ attempts, salt: initialSalt, predictedHook: predictPoolBoundHookAddress({ deployer: options.deployer, initCodeHash: options.initCodeHash, salt: initialSalt }) });
  for (;;) {
    checkCancelled();
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    checkCancelled();
    const deadline = Date.now() + 8;
    let last: PoolBoundHookSaltProgress | undefined;
    for (let batch = 0; batch < 256 && (batch === 0 || Date.now() < deadline); batch += 1) {
      checkCancelled();
      if (candidate >= 1n << 256n) throw new LifecyclePlanningError("HOOK_SALT_EXHAUSTED", "No valid hook address remains in the uint256 salt range");
      const salt = toHex(candidate, { size: 32 });
      const predictedHook = predictPoolBoundHookAddress({ deployer: options.deployer, initCodeHash: options.initCodeHash, salt });
      attempts += 1n;
      last = { attempts, salt, predictedHook };
      if (hasLifecycleV4HookPermissions(predictedHook)) {
        onProgress?.(last);
        checkCancelled();
        return { salt, predictedHook };
      }
      candidate += 1n;
    }
    if (last !== undefined) onProgress?.(last);
  }
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
