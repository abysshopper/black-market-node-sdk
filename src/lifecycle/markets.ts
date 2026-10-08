import { concatHex, decodeAbiParameters, encodeAbiParameters, getAddress, hexToBytes, keccak256, pad, stringToHex, toHex, zeroHash, type Address, type Hex } from "viem";
import type { MarketConfigV1 } from "./schema.js";
import { LifecyclePlanningError, type LifecycleProfile, type PoolBoundHookSaltProgress } from "./types.js";

export type V4LifecyclePositionConfig = {
  tickLower: number; tickUpper: number; liquidity: bigint; salt: Hex; maxTokenAmount: bigint;
};
export type V4LifecycleMarketConfig = {
  version: 4; lpFeePips: number; tickSpacing: number; sqrtPriceX96: bigint; hookFeePips: number;
  feeMode: number; protocolFeeDenominator: number; treasury: Address; externalLiquidityDisabled: boolean;
  oracleConfigId: Hex; profileId: Hex; termsDigest: Hex; developerBeneficiary: Address; developerFeeBps: number;
  positions: readonly V4LifecyclePositionConfig[];
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
  { name: "profileId", type: "bytes32" }, { name: "termsDigest", type: "bytes32" },
  { name: "developerBeneficiary", type: "address" }, { name: "developerFeeBps", type: "uint16" },
  { name: "positions", type: "tuple[]", components: v4LifecyclePositionComponents },
] as const;
export function encodeV4LifecycleMarketConfig(config: V4LifecycleMarketConfig): Hex {
  if (config.version !== 4) throw new Error("Shared V4 lifecycle market config version must be 4");
  if (!Number.isInteger(config.developerFeeBps) || config.developerFeeBps < 0 || config.developerFeeBps > 65535) throw new Error("developerFeeBps must be an explicit uint16");
  return encodeAbiParameters([{ type: "tuple", components: v4LifecycleMarketComponents }], [config]);
}
export function decodeV4LifecycleMarketConfig(encoded: Hex): V4LifecycleMarketConfig {
  const config = decodeAbiParameters([{ type: "tuple", components: v4LifecycleMarketComponents }], encoded)[0];
  if (config.version !== 4) throw new Error("Shared V4 lifecycle market config version must be 4");
  return config as V4LifecycleMarketConfig;
}

export type PoolBoundLifecycleConfigVersion = 5 | 6;
export type V4PoolBoundLifecycleMarketConfigV5 = Omit<V4LifecycleMarketConfig, "version"> & {
  version: 5; hookSalt: Hex; minimumHookFeePips?: never; feeSensitivityPipsSecondsPerTick?: never;
};
export type V4PoolBoundLifecycleMarketConfigV6 = Omit<V4LifecycleMarketConfig, "version"> & {
  version: 6; minimumHookFeePips: number; feeSensitivityPipsSecondsPerTick: number; hookSalt: Hex;
};
export type V4PoolBoundLifecycleMarketConfig = V4PoolBoundLifecycleMarketConfigV5 | V4PoolBoundLifecycleMarketConfigV6;
export const V4_LIFECYCLE_CONFIG_SCHEMA = keccak256(stringToHex("(uint16,uint24,int24,uint160,uint24,uint8,uint8,address,bool,bytes32,bytes32,bytes32,address,uint16,(int24,int24,uint128,bytes32,uint256)[])"));
export const V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA_V5 = keccak256(stringToHex("(uint16,uint24,int24,uint160,uint24,uint8,uint8,address,bool,bytes32,bytes32,bytes32,bytes32,address,uint16,(int24,int24,uint128,bytes32,uint256)[])"));
export const V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA_V6 = keccak256(stringToHex("(uint16,uint24,int24,uint160,uint24,uint24,uint32,uint8,uint8,address,bool,bytes32,bytes32,bytes32,bytes32,address,uint16,(int24,int24,uint128,bytes32,uint256)[])"));
export const V4_POOL_BOUND_MARKET_ECONOMICS_DOMAIN = keccak256(stringToHex("black-market.pool-bound-market-economics.v1"));
export const V4_LIFECYCLE_HOOK_PERMISSION_MASK = 0x3fffn;
export const V4_LIFECYCLE_HOOK_PERMISSIONS = 0x1afcn;
export const poolBoundV4LifecycleMarketComponentsV5 = [
  { name: "version", type: "uint16" }, { name: "lpFeePips", type: "uint24" }, { name: "tickSpacing", type: "int24" },
  { name: "sqrtPriceX96", type: "uint160" }, { name: "hookFeePips", type: "uint24" }, { name: "feeMode", type: "uint8" },
  { name: "protocolFeeDenominator", type: "uint8" }, { name: "treasury", type: "address" },
  { name: "externalLiquidityDisabled", type: "bool" }, { name: "oracleConfigId", type: "bytes32" },
  { name: "hookSalt", type: "bytes32" }, { name: "profileId", type: "bytes32" }, { name: "termsDigest", type: "bytes32" },
  { name: "developerBeneficiary", type: "address" }, { name: "developerFeeBps", type: "uint16" },
  { name: "positions", type: "tuple[]", components: v4LifecyclePositionComponents },
] as const;
export const poolBoundV4LifecycleMarketComponentsV6 = [
  { name: "version", type: "uint16" }, { name: "lpFeePips", type: "uint24" }, { name: "tickSpacing", type: "int24" },
  { name: "sqrtPriceX96", type: "uint160" }, { name: "hookFeePips", type: "uint24" },
  { name: "minimumHookFeePips", type: "uint24" }, { name: "feeSensitivityPipsSecondsPerTick", type: "uint32" },
  { name: "feeMode", type: "uint8" },
  { name: "protocolFeeDenominator", type: "uint8" }, { name: "treasury", type: "address" },
  { name: "externalLiquidityDisabled", type: "bool" }, { name: "oracleConfigId", type: "bytes32" },
  { name: "hookSalt", type: "bytes32" },
  { name: "profileId", type: "bytes32" }, { name: "termsDigest", type: "bytes32" },
  { name: "developerBeneficiary", type: "address" }, { name: "developerFeeBps", type: "uint16" },
  { name: "positions", type: "tuple[]", components: v4LifecyclePositionComponents },
] as const;

export function isPoolBoundV4ConfigVersion(version: number): version is PoolBoundLifecycleConfigVersion {
  return version === 5 || version === 6;
}

export function poolBoundV4LifecycleConfigSchema(version: PoolBoundLifecycleConfigVersion): Hex {
  if (version === 5) return V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA_V5;
  if (version === 6) return V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA_V6;
  throw new LifecyclePlanningError("UNSUPPORTED_CONFIG_VERSION", "Pool-bound V4 config version must be explicitly 5 or 6");
}

function assertV1HookFeeShape(config: object): void {
  if ("minimumHookFeePips" in config || "feeSensitivityPipsSecondsPerTick" in config) {
    throw new LifecyclePlanningError("UNSUPPORTED_CONFIG_VERSION", "Config5/V1 cannot encode config6/V2 fee-policy fields");
  }
}

export function encodePoolBoundV4LifecycleMarketConfig(config: V4PoolBoundLifecycleMarketConfig): Hex {
  if (!isPoolBoundV4ConfigVersion(config.version)) throw new LifecyclePlanningError("UNSUPPORTED_CONFIG_VERSION", "Pool-bound V4 config version must be explicitly 5 or 6");
  if (config.version === 6) validatePoolBoundHookFees(config);
  else assertV1HookFeeShape(config);
  if (!Number.isInteger(config.developerFeeBps) || config.developerFeeBps < 0 || config.developerFeeBps > 65535) throw new Error("developerFeeBps must be an explicit uint16");
  return config.version === 5
    ? encodeAbiParameters([{ type: "tuple", components: poolBoundV4LifecycleMarketComponentsV5 }], [config])
    : encodeAbiParameters([{ type: "tuple", components: poolBoundV4LifecycleMarketComponentsV6 }], [config]);
}
export function decodePoolBoundV4LifecycleMarketConfig(encoded: Hex, expectedVersion?: PoolBoundLifecycleConfigVersion): V4PoolBoundLifecycleMarketConfig {
  // Both dynamic config tuples begin with their ABI offset and explicit uint16 version.
  // The selected schema must re-encode byte-for-byte; relabelled or padded tuples are not another version.
  const [offset, version] = decodeAbiParameters([{ type: "uint256" }, { type: "uint16" }], encoded);
  if (!isPoolBoundV4ConfigVersion(version)) throw new LifecyclePlanningError("UNSUPPORTED_CONFIG_VERSION", "Pool-bound V4 config version must be explicitly 5 or 6");
  if (offset !== 32n || expectedVersion !== undefined && version !== expectedVersion) throw new LifecyclePlanningError("INVALID_BOUND_MARKET", "Pool-bound wire config does not match its committed version");
  const config = version === 5
    ? decodeAbiParameters([{ type: "tuple", components: poolBoundV4LifecycleMarketComponentsV5 }], encoded)[0] as V4PoolBoundLifecycleMarketConfigV5
    : decodeAbiParameters([{ type: "tuple", components: poolBoundV4LifecycleMarketComponentsV6 }], encoded)[0] as V4PoolBoundLifecycleMarketConfigV6;
  if (encodePoolBoundV4LifecycleMarketConfig(config).toLowerCase() !== encoded.toLowerCase()) throw new LifecyclePlanningError("INVALID_BOUND_MARKET", "Pool-bound config is not canonical for its explicit schema");
  return config;
}

/** Immutable per-pool fee policy: pips, and fee-pips * seconds per observed tick. */
export function validatePoolBoundHookFees(config: Pick<PoolBoundHookParametersV2, "hookFeePips" | "minimumHookFeePips" | "feeSensitivityPipsSecondsPerTick">): void {
  if (!Number.isInteger(config.hookFeePips) || config.hookFeePips < 0 || config.hookFeePips > 1000000 ||
    !Number.isInteger(config.minimumHookFeePips) || config.minimumHookFeePips < 0 || config.minimumHookFeePips > config.hookFeePips ||
    !Number.isInteger(config.feeSensitivityPipsSecondsPerTick) || config.feeSensitivityPipsSecondsPerTick < 0 || config.feeSensitivityPipsSecondsPerTick > 0xffffffff) {
    throw new LifecyclePlanningError("INVALID_HOOK_FEES", "Pool-bound fees require integer 0 <= minimum <= maximum <= 1000000 pips and sensitivity between 0 and 4294967295 fee-pips * seconds/tick");
  }
}

/** Exact pending-source admission terms; author identity is never the live payout address. */
export function validateV4LifecycleMarket(options: {
  market: MarketConfigV1; config: V4LifecycleMarketConfig | V4PoolBoundLifecycleMarketConfig; profile: LifecycleProfile; token: Address;
}): void {
  const { market, config, profile, token } = options;
  if (config.version !== 4 && !isPoolBoundV4ConfigVersion(config.version)) throw new LifecyclePlanningError("UNSUPPORTED_CONFIG_VERSION", "Reviewed V4 config version must be 4, 5 or 6");
  if (config.version === 6) validatePoolBoundHookFees(config);
  else if (config.version === 5) assertV1HookFeeShape(config);
  const { envelope, developerTerms: terms, protocolMaximumDeveloperFeeBps: protocolCeiling } = profile;
  if (envelope === undefined || terms === undefined || protocolCeiling === undefined || !terms.enabled ||
    profile.topology.hookTopology !== (config.version === 4 ? 1 : 2) || market.configVersion !== config.version ||
    profile.topology.configVersion !== config.version || profile.adapter.configVersion !== config.version ||
    envelope.topology !== profile.topology.hookTopology || envelope.configVersion !== config.version || envelope.economicVersion !== 3 ||
    profile.registration.configSchema.toLowerCase() !== (config.version === 4 ? V4_LIFECYCLE_CONFIG_SCHEMA : poolBoundV4LifecycleConfigSchema(config.version)).toLowerCase() ||
    market.adapterId.toLowerCase() !== profile.registration.adapterId.toLowerCase() ||
    market.profileId.toLowerCase() !== profile.id.toLowerCase() || config.profileId.toLowerCase() !== profile.id.toLowerCase() ||
    terms.adapter.toLowerCase() !== profile.adapter.implementation.toLowerCase() ||
    config.termsDigest.toLowerCase() !== envelope.termsDigest.toLowerCase() || config.termsDigest.toLowerCase() !== terms.termsDigest.toLowerCase() ||
    config.developerBeneficiary.toLowerCase() !== envelope.beneficiary.toLowerCase() ||
    config.developerBeneficiary.toLowerCase() !== terms.beneficiary.toLowerCase() ||
    BigInt(config.developerBeneficiary) === 0n || config.developerBeneficiary.toLowerCase() === token.toLowerCase() ||
    config.developerBeneficiary.toLowerCase() === market.quoteAsset.toLowerCase()) {
    throw new LifecyclePlanningError("PROFILE_TERMS_MISMATCH", "Market must explicitly bind the admitted profile, frozen terms and stable author identity");
  }
  if (!Number.isInteger(config.developerFeeBps) || config.developerFeeBps < 0 ||
    config.developerFeeBps > envelope.maximumDeveloperFeeBps || config.developerFeeBps > terms.maximumDeveloperFeeBps ||
    config.developerFeeBps > protocolCeiling) throw new LifecyclePlanningError("DEVELOPER_FEE_CEILING", "Explicit developer fee exceeds the reviewed or protocol ceiling");
  const b = envelope.bounds;
  if (config.oracleConfigId.toLowerCase() === zeroHash) throw new LifecyclePlanningError("INVALID_ORACLE_CONFIG", "Market oracle configuration must be nonzero");
  if (config.treasury.toLowerCase() !== envelope.protocolTreasury.toLowerCase() ||
    config.protocolFeeDenominator !== envelope.protocolFeeDenominator || !Number.isInteger(config.hookFeePips) || config.hookFeePips < 0 || (config.version === 6 ? config.hookFeePips > 1000000 : config.hookFeePips >= 1000000) ||
    !Number.isInteger(config.lpFeePips) || config.lpFeePips < 0 || config.lpFeePips >= 1000000 ||
    !Number.isInteger(config.feeMode) || config.feeMode < 0 || config.feeMode > 1 || (b.feeModeFlags & (1 << config.feeMode)) === 0 ||
    config.tickSpacing < b.minimumTickSpacing || config.tickSpacing > b.maximumTickSpacing ||
    config.positions.length === 0 || config.positions.length > b.maximumPositions) {
    throw new LifecyclePlanningError("PROFILE_BOUNDS_MISMATCH", "Market economics exceed or differ from the exact admitted envelope bounds");
  }
}

export type PoolBoundHookParametersV1 = {
  poolManager: Address; registrar: Address; oracleFactory: Address; core: Address; liquidityLocker: Address;
  token: Address; quoteCurrency: Address; lpFeePips: number; tickSpacing: number; sqrtPriceX96: bigint; hookFeePips: number;
  feeMode: number; protocolFeeDenominator: number; treasury: Address;
  externalLiquidityDisabled: boolean; oracleConfigId: Hex; marketCommitment: Hex; expectedPositionCount: number;
};
export type PoolBoundHookParametersV2 = PoolBoundHookParametersV1 & {
  minimumHookFeePips: number; feeSensitivityPipsSecondsPerTick: number;
};
export type PoolBoundHookParameters = PoolBoundHookParametersV1 | PoolBoundHookParametersV2;
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
export const poolBoundHookParametersV2Components = [
  { name: "poolManager", type: "address" }, { name: "registrar", type: "address" },
  { name: "oracleFactory", type: "address" }, { name: "core", type: "address" },
  { name: "liquidityLocker", type: "address" }, { name: "token", type: "address" },
  { name: "quoteCurrency", type: "address" }, { name: "lpFeePips", type: "uint24" },
  { name: "tickSpacing", type: "int24" }, { name: "sqrtPriceX96", type: "uint160" },
  { name: "hookFeePips", type: "uint24" },
  { name: "minimumHookFeePips", type: "uint24" }, { name: "feeSensitivityPipsSecondsPerTick", type: "uint32" },
  { name: "feeMode", type: "uint8" },
  { name: "protocolFeeDenominator", type: "uint8" }, { name: "treasury", type: "address" },
  { name: "externalLiquidityDisabled", type: "bool" }, { name: "oracleConfigId", type: "bytes32" },
  { name: "marketCommitment", type: "bytes32" }, { name: "expectedPositionCount", type: "uint32" },
] as const;
export function encodePoolBoundHookParameters(parameters: PoolBoundHookParameters, configVersion: PoolBoundLifecycleConfigVersion): Hex {
  if (configVersion === 5) {
    assertV1HookFeeShape(parameters);
    return encodeAbiParameters([{ type: "tuple", components: poolBoundHookParametersV1Components }], [parameters]);
  }
  if (configVersion !== 6) throw new LifecyclePlanningError("UNSUPPORTED_CONFIG_VERSION", "Constructor encoding requires explicit config5/V1 or config6/V2 context");
  const v2 = parameters as PoolBoundHookParametersV2;
  validatePoolBoundHookFees(v2);
  return encodeAbiParameters([{ type: "tuple", components: poolBoundHookParametersV2Components }], [v2]);
}

/** The explicit market version selects constructor economics, never missing-field defaults. */
export function buildPoolBoundHookParameters(options: {
  chainId: bigint; core: Address; poolManager: Address; registrar: Address; oracleFactory: Address;
  liquidityLocker: Address; token: Address; market: MarketConfigV1; config: V4PoolBoundLifecycleMarketConfig;
}): PoolBoundHookParameters {
  const { config, market } = options;
  if (config.version !== market.configVersion) throw new LifecyclePlanningError("INVALID_BOUND_MARKET", "Constructor config differs from the committed market version");
  return {
    poolManager: options.poolManager, registrar: options.registrar, oracleFactory: options.oracleFactory, core: options.core,
    liquidityLocker: options.liquidityLocker, token: options.token, quoteCurrency: market.quoteAsset,
    lpFeePips: config.lpFeePips, tickSpacing: config.tickSpacing, sqrtPriceX96: config.sqrtPriceX96, hookFeePips: config.hookFeePips,
    ...(config.version === 6 ? { minimumHookFeePips: config.minimumHookFeePips, feeSensitivityPipsSecondsPerTick: config.feeSensitivityPipsSecondsPerTick } : {}),
    feeMode: config.feeMode, protocolFeeDenominator: config.protocolFeeDenominator, treasury: config.treasury,
    externalLiquidityDisabled: config.externalLiquidityDisabled, oracleConfigId: config.oracleConfigId,
    marketCommitment: hashPoolBoundV4MarketCommitment(options), expectedPositionCount: config.positions.length,
  };
}
export function hashPoolBoundV4MarketCommitment(options: { chainId: bigint; core: Address; registrar: Address; token: Address; market: MarketConfigV1 }): Hex {
  const { chainId, core, registrar, token, market } = options;
  if (!isPoolBoundV4ConfigVersion(market.configVersion)) throw new LifecyclePlanningError("INVALID_BOUND_MARKET", "Pool-bound V4 market requires explicit config version 5 or 6");
  const config = decodePoolBoundV4LifecycleMarketConfig(market.config, market.configVersion);
  if (config.profileId.toLowerCase() !== market.profileId.toLowerCase()) throw new LifecyclePlanningError("INVALID_BOUND_MARKET", "Config profile differs from the committed market profile");
  const configHash = keccak256(encodePoolBoundV4LifecycleMarketConfig({ ...config, hookSalt: zeroHash }));
  return keccak256(encodeAbiParameters([
    { type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "address" },
    { type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "uint256" }, { type: "uint32" }, { type: "bytes32" },
  ], [V4_POOL_BOUND_MARKET_ECONOMICS_DOMAIN, chainId, core, registrar, token, market.adapterId, market.profileId, market.quoteAsset, market.tokenBudget, market.configVersion, configHash]));
}
export function hasLifecycleV4HookPermissions(hook: Address): boolean {
  return (BigInt(hook) & V4_LIFECYCLE_HOOK_PERMISSION_MASK) === V4_LIFECYCLE_HOOK_PERMISSIONS;
}
function poolBoundHookPreimage(deployer: Address, initCodeHash: Hex): Uint8Array {
  const codeHash = hexToBytes(initCodeHash);
  const preimage = new Uint8Array(53 + codeHash.length);
  preimage[0] = 0xff;
  preimage.set(hexToBytes(getAddress(deployer)), 1);
  preimage.set(codeHash, 53);
  return preimage;
}

function poolBoundHookAddress(digest: Uint8Array): Address {
  return getAddress(toHex(digest.subarray(12)));
}

export function predictPoolBoundHookAddress(options: { deployer: Address; initCodeHash: Hex; salt: Hex }): Address {
  const preimage = poolBoundHookPreimage(options.deployer, options.initCodeHash);
  preimage.set(pad(hexToBytes(options.salt), { size: 32 }), 21);
  return poolBoundHookAddress(keccak256(preimage, "bytes"));
}
export function poolBoundHookInitCodeHash(creationCode: Hex, parameters: PoolBoundHookParameters, configVersion: PoolBoundLifecycleConfigVersion): Hex {
  return keccak256(concatHex([creationCode, encodePoolBoundHookParameters(parameters, configVersion)]));
}

/** Deterministic CREATE2 search with a macrotask boundary before work and between bounded batches. */
export async function minePoolBoundHookSalt(options: {
  deployer: Address; initCodeHash: Hex; startSalt?: bigint; signal?: AbortSignal;
  onProgress?: (progress: PoolBoundHookSaltProgress) => void;
}): Promise<{ salt: Hex; predictedHook: Address }> {
  const { signal, onProgress } = options;
  const candidate = options.startSalt ?? 0n;
  if (candidate < 0n || candidate >= 1n << 256n) throw new LifecyclePlanningError("INVALID_HOOK_SALT", "Starting hook salt must fit uint256");
  const checkCancelled = () => {
    if (signal?.aborted) throw Object.assign(new Error("Pool-bound hook salt mining cancelled"), { name: "AbortError" });
  };
  let attempts = 0n;
  checkCancelled();
  // The same EIP-1014 owner as the public predictor freezes immutable prefix/
  // suffix once. Only uint256 salt bytes change; viem still owns exact Keccak.
  const preimage = poolBoundHookPreimage(options.deployer, options.initCodeHash);
  const saltBytes = preimage.subarray(21, 53);
  saltBytes.set(hexToBytes(toHex(candidate, { size: 32 })));
  const mask = Number(V4_LIFECYCLE_HOOK_PERMISSION_MASK);
  const permissions = Number(V4_LIFECYCLE_HOOK_PERMISSIONS);
  let firstDigest = onProgress === undefined ? undefined : keccak256(preimage, "bytes");
  if (onProgress !== undefined) onProgress({ attempts, salt: toHex(saltBytes), predictedHook: poolBoundHookAddress(firstDigest!) });
  let advanceSalt = false;
  for (;;) {
    checkCancelled();
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    checkCancelled();
    const deadline = Date.now() + 8;
    let lastDigest: Uint8Array | undefined;
    let batchAttempts = 0;
    for (let batch = 0; batch < 256 && (batch === 0 || Date.now() < deadline); batch += 1) {
      checkCancelled();
      if (advanceSalt) {
        let byte = saltBytes.length - 1;
        while (byte >= 0 && saltBytes[byte] === 0xff) { saltBytes[byte] = 0; byte -= 1; }
        if (byte < 0) throw new LifecyclePlanningError("HOOK_SALT_EXHAUSTED", "No valid hook address remains in the uint256 salt range");
        saltBytes[byte] = saltBytes[byte]! + 1;
      }
      const digest = firstDigest ?? keccak256(preimage, "bytes");
      firstDigest = undefined;
      batchAttempts += 1;
      // Check all fourteen permission bits without checksumming/materializing
      // every rejected address or allocating a progress object per attempt.
      if ((((digest[30]! << 8) | digest[31]!) & mask) === permissions) {
        attempts += BigInt(batchAttempts);
        const result = { salt: toHex(saltBytes), predictedHook: poolBoundHookAddress(digest) };
        onProgress?.({ attempts, ...result });
        checkCancelled();
        return result;
      }
      lastDigest = digest;
      advanceSalt = true;
    }
    attempts += BigInt(batchAttempts);
    if (onProgress !== undefined && lastDigest !== undefined) onProgress({ attempts, salt: toHex(saltBytes), predictedHook: poolBoundHookAddress(lastDigest) });
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
