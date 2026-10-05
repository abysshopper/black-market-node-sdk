import { decodeAbiParameters, encodeAbiParameters, keccak256, stringToHex, type Address, type Hex } from "viem";

/** Current lifecycle wire schema; deployment and admission are always explicit. */
export enum LifecycleTokenKind { ERC20, ERC404 }
export enum LifecycleRewardMode { None, Staking, Dividends }
export enum LifecycleFundingKind { ERC20, NativeWrap, Swap }
export enum LifecycleMode { Atomic, Staged }
export enum LifecyclePhase { None, Preparing, Ready, Activating, Active, Cancelled }
export enum LifecycleVenue { UniswapV4, Abyss }
export type LaunchExecutionMode = "atomic" | "staged";

export type TokenConfigV1 = {
  kind: LifecycleTokenKind; rewardMode: LifecycleRewardMode; name: string; symbol: string;
  supply: bigint; nftUnit: bigint; metadataURI: string; salt: Hex;
  inventoryRecipient: Address; burnOnCancel: boolean;
};
export type AssetFundingV1 = {
  asset: Address; amount: bigint; kind: LifecycleFundingKind; inputAsset: Address;
  inputAmount: bigint; target: Address; data: Hex;
};
export type LifecycleFeeAssetPolicyV2 = { asset: Address; ownerBps: number; rewardsBps: number; burnBps: number };
export type MarketConfigV1 = {
  adapterId: Hex; profileId: Hex; quoteAsset: Address; tokenBudget: bigint; configVersion: number; config: Hex;
};
export type InitialBuyV1 = {
  marketIndex: number; quoteAmountIn: bigint; minTokenOut: bigint; recipient: Address; sqrtPriceLimitX96: bigint;
};
export type LaunchPlanV1 = {
  chainId: bigint; orchestrator: Address; creator: Address; nonce: bigint; token: TokenConfigV1;
  funding: readonly AssetFundingV1[]; feeAssets: readonly LifecycleFeeAssetPolicyV2[];
  markets: readonly MarketConfigV1[]; buys: readonly InitialBuyV1[]; deadline: bigint; executorFeeBps: number;
};
export type MarketIdentityV1 = {
  venue: LifecycleVenue; canonicalId: Hex; manager: Address; factory: Address; pool: Address; poolId: Hex;
  profileId: Hex; currency0: Address; currency1: Address; fee: number; tickSpacing: number;
  hook: Address; openingSqrtPriceX96: bigint;
};
export type PreparedMarketV1 = {
  identity: MarketIdentityV1; feeSource: Address; custody: Address; mintExecutor: Address; buyExecutor: Address;
  exclusions: readonly Address[]; positionCount: number;
};
export type PositionIdentityV1 = {
  canonicalId: Hex; marketId: Hex; manager: Address; custody: Address; tokenId: bigint;
  tickLower: number; tickUpper: number; salt: Hex; liquidity: bigint;
};
export type LaunchExecutionContextV1 = {
  launchId: Hex; marketIndex: number; operation: number; adapter: Address; executor: Address; token: Address;
  quoteAsset: Address; manager: Address; custody: Address; recipient: Address; amount: bigint;
};
export type LaunchProgressV1 = {
  launchId: Hex; planHash: Hex; creator: Address; nonce: bigint; mode: LifecycleMode; phase: LifecyclePhase;
  token: Address; feeHub: Address; rewards: Address; preparedMarkets: number; marketCount: number;
  buyCount: number; positionCount: number; deadline: bigint;
};
export type LaunchReceiptV1 = {
  launchId: Hex; planHash: Hex; token: Address; feeHub: Address; rewards: Address;
  marketCount: number; positionCount: number; quoteSpent: readonly bigint[]; tokenOut: readonly bigint[];
};
export type AdapterRegistrationV1 = {
  implementation: Address; codeHash: Hex; capabilities: bigint; configVersion: number; enabled: boolean;
};
export type ProfileRegistrationV1 = {
  adapterId: Hex; configSchema: Hex; dependencyDigest: Hex; venue: Address; factory: Address; hook: Address;
  capabilities: bigint; enabled: boolean;
};
export type ProfileTopologyV1 = {
  hookTopology: 0 | 1 | 2; configVersion: number; hookDeployer: Address; hookCreationCodeHash: Hex;
};
export type MarketLiveStateV1 = {
  sqrtPriceX96: bigint; tick: number; liquidity: bigint; publicTrading: boolean; oracleReadyAt: bigint;
};

export type LaunchBoundsV2 = {
  minimumTickSpacing: number; maximumTickSpacing: number;
  maximumPositions: number; maximumOracleCardinality: number; feeModeFlags: number;
};
export type LaunchGraphV2 = {
  manager: Address; hookRoot: Address; oracleFactory: Address; locker: Address; collectorFactory: Address;
  collectorDeployer: Address; hookDeployer: Address; coreCodeHash: Hex; managerCodeHash: Hex;
  hookRuntimeCodeHash: Hex; oracleFactoryCodeHash: Hex; lockerCodeHash: Hex; collectorFactoryCodeHash: Hex;
  collectorDeployerCodeHash: Hex; hookDeployerCodeHash: Hex; hookCreationCodeHash: Hex;
  codeChunk0: Address; codeChunk0Hash: Hex; codeChunk1: Address; codeChunk1Hash: Hex; sharedHookSalt: Hex;
};
export type LaunchEnvelopeV2 = {
  artifactDigest: Hex; reviewManifestDigest: Hex; configBoundsDigest: Hex; termsDigest: Hex;
  topology: 1 | 2; configVersion: number; economicVersion: number; capabilities: bigint; flags: bigint;
  callbackFlags: number; callbackMask: number; protocolTreasury: Address; protocolFeeDenominator: number;
  beneficiary: Address; maximumDeveloperFeeBps: number; bounds: LaunchBoundsV2; graph: LaunchGraphV2;
};
export type LifecycleDeveloperTerms = {
  adapter: Address; beneficiary: Address; maximumDeveloperFeeBps: number; termsDigest: Hex; enabled: boolean;
};
export type SourceTermsV3 = {
  adapter: Address; profileId: Hex; termsDigest: Hex; beneficiary: Address;
  maximumDeveloperFeeBps: number; developerFeeBps: number;
};
export const launchBoundsV2Components = [
  { name: "minimumTickSpacing", type: "int24" }, { name: "maximumTickSpacing", type: "int24" },
  { name: "maximumPositions", type: "uint16" }, { name: "maximumOracleCardinality", type: "uint16" },
  { name: "feeModeFlags", type: "uint8" },
] as const;
export const launchGraphV2Components = [
  { name: "manager", type: "address" }, { name: "hookRoot", type: "address" },
  { name: "oracleFactory", type: "address" }, { name: "locker", type: "address" },
  { name: "collectorFactory", type: "address" }, { name: "collectorDeployer", type: "address" },
  { name: "hookDeployer", type: "address" }, { name: "coreCodeHash", type: "bytes32" },
  { name: "managerCodeHash", type: "bytes32" }, { name: "hookRuntimeCodeHash", type: "bytes32" },
  { name: "oracleFactoryCodeHash", type: "bytes32" }, { name: "lockerCodeHash", type: "bytes32" },
  { name: "collectorFactoryCodeHash", type: "bytes32" }, { name: "collectorDeployerCodeHash", type: "bytes32" },
  { name: "hookDeployerCodeHash", type: "bytes32" }, { name: "hookCreationCodeHash", type: "bytes32" },
  { name: "codeChunk0", type: "address" }, { name: "codeChunk0Hash", type: "bytes32" },
  { name: "codeChunk1", type: "address" }, { name: "codeChunk1Hash", type: "bytes32" },
  { name: "sharedHookSalt", type: "bytes32" },
] as const;
export const launchEnvelopeV2Components = [
  { name: "artifactDigest", type: "bytes32" }, { name: "reviewManifestDigest", type: "bytes32" },
  { name: "configBoundsDigest", type: "bytes32" }, { name: "termsDigest", type: "bytes32" },
  { name: "topology", type: "uint8" }, { name: "configVersion", type: "uint32" },
  { name: "economicVersion", type: "uint32" }, { name: "capabilities", type: "uint64" },
  { name: "flags", type: "uint64" }, { name: "callbackFlags", type: "uint16" },
  { name: "callbackMask", type: "uint16" }, { name: "protocolTreasury", type: "address" },
  { name: "protocolFeeDenominator", type: "uint8" }, { name: "beneficiary", type: "address" },
  { name: "maximumDeveloperFeeBps", type: "uint16" },
  { name: "bounds", type: "tuple", components: launchBoundsV2Components },
  { name: "graph", type: "tuple", components: launchGraphV2Components },
] as const;
export const sourceTermsV3Components = [
  { name: "adapter", type: "address" }, { name: "profileId", type: "bytes32" },
  { name: "termsDigest", type: "bytes32" }, { name: "beneficiary", type: "address" },
  { name: "maximumDeveloperFeeBps", type: "uint16" }, { name: "developerFeeBps", type: "uint16" },
] as const;
export function encodeLaunchBounds(bounds: LaunchBoundsV2): Hex {
  return encodeAbiParameters([{ type: "tuple", components: launchBoundsV2Components }], [bounds]);
}
export function decodeLaunchBounds(encoded: Hex): LaunchBoundsV2 {
  return decodeAbiParameters([{ type: "tuple", components: launchBoundsV2Components }], encoded)[0];
}
export function hashLaunchBounds(bounds: LaunchBoundsV2): Hex {
  return keccak256(encodeLaunchBounds(bounds));
}
export function encodeLaunchEnvelope(envelope: LaunchEnvelopeV2): Hex {
  return encodeAbiParameters([{ type: "tuple", components: launchEnvelopeV2Components }], [envelope]);
}
export function decodeLaunchEnvelope(encoded: Hex): LaunchEnvelopeV2 {
  const envelope = decodeAbiParameters([{ type: "tuple", components: launchEnvelopeV2Components }], encoded)[0];
  if (envelope.topology !== 1 && envelope.topology !== 2) throw new Error("Unsupported reviewed hook topology");
  return { ...envelope, topology: envelope.topology };
}
/** The registry identity deliberately excludes instance addresses and runtime immutables. */
export function hashLifecycleProfile(envelope: LaunchEnvelopeV2): Hex {
  return keccak256(encodeAbiParameters([
    { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" },
    { type: "uint8" }, { type: "uint32" }, { type: "uint32" }, { type: "address" }, { type: "uint16" }, { type: "uint64" },
  ], [keccak256(stringToHex("black-market.launch-profile.v2")), envelope.artifactDigest,
    envelope.reviewManifestDigest, envelope.configBoundsDigest, envelope.termsDigest, envelope.topology,
    envelope.configVersion, envelope.economicVersion, envelope.beneficiary, envelope.maximumDeveloperFeeBps, envelope.capabilities]));
}
/** Exact LaunchGraphLibV2 domain; shared salt is provenance, not an economic dependency. */
export function hashLaunchDependencies(options: {
  chainId: bigint; core: Address; registry: Address; registrar: Address; graph: LaunchGraphV2;
}): Hex {
  const { chainId, core, registry, registrar, graph: g } = options;
  return keccak256(encodeAbiParameters([
    { type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" },
    { type: "address" }, { type: "address" }, { type: "address" }, { type: "bytes32" },
    { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" },
    { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" },
    { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" },
    { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" },
  ], [keccak256(stringToHex("black-market.v4-dependencies.v2")), chainId, core, g.coreCodeHash,
    registry, registrar, g.manager, g.managerCodeHash, g.hookRoot, g.hookRuntimeCodeHash,
    g.oracleFactory, g.oracleFactoryCodeHash, g.locker, g.lockerCodeHash, g.collectorFactory, g.collectorFactoryCodeHash,
    g.collectorDeployer, g.collectorDeployerCodeHash, g.hookDeployer, g.hookDeployerCodeHash,
    g.hookCreationCodeHash, g.codeChunk0, g.codeChunk0Hash, g.codeChunk1, g.codeChunk1Hash]));
}
export const LIFECYCLE_TOKEN_ONLY_CAPABILITY = 1n;
export const LIFECYCLE_EMPTY_PREPARE_CAPABILITY = 2n;
export const LIFECYCLE_PERMANENT_CUSTODY_CAPABILITY = 8n;
export const LIFECYCLE_CANONICAL_FEES_CAPABILITY = 16n;
export const LIFECYCLE_ERC404_CAPABILITY = 32n;
export const LIFECYCLE_MULTI_POSITION_CAPABILITY = 64n;
/** TOKEN_ONLY|EMPTY_PREPARE|PERMANENT_CUSTODY|CANONICAL_FEES. The retired POOL_GATE bit
 *  is never requested: preactivation safety is token transfer restrictions plus the
 *  activation-time canonical opening-state verification on both canonical venues. Atomic
 *  and staged share this mask; mode changes execution grouping, never venue eligibility. */
export const LIFECYCLE_REQUIRED_CAPABILITIES = LIFECYCLE_TOKEN_ONLY_CAPABILITY | LIFECYCLE_EMPTY_PREPARE_CAPABILITY | LIFECYCLE_PERMANENT_CUSTODY_CAPABILITY | LIFECYCLE_CANONICAL_FEES_CAPABILITY;
export const LIFECYCLE_MAX_ERC20_SUPPLY = (1n << 256n) - 1n;
export const LIFECYCLE_MAX_REWARD_ERC20_SUPPLY = 10n ** 77n;
export const LIFECYCLE_MAX_ERC404_SUPPLY = (1n << 96n) - 1n;

export const lifecycleTokenComponents = [
  { name: "kind", type: "uint8" }, { name: "rewardMode", type: "uint8" },
  { name: "name", type: "string" }, { name: "symbol", type: "string" },
  { name: "supply", type: "uint256" }, { name: "nftUnit", type: "uint256" },
  { name: "metadataURI", type: "string" }, { name: "salt", type: "bytes32" },
  { name: "inventoryRecipient", type: "address" }, { name: "burnOnCancel", type: "bool" },
] as const;
export const lifecycleFundingComponents = [
  { name: "asset", type: "address" }, { name: "amount", type: "uint256" }, { name: "kind", type: "uint8" },
  { name: "inputAsset", type: "address" }, { name: "inputAmount", type: "uint256" },
  { name: "target", type: "address" }, { name: "data", type: "bytes" },
] as const;
export const lifecycleFeePolicyComponents = [
  { name: "asset", type: "address" }, { name: "ownerBps", type: "uint16" },
  { name: "rewardsBps", type: "uint16" }, { name: "burnBps", type: "uint16" },
] as const;
export const lifecycleMarketComponents = [
  { name: "adapterId", type: "bytes32" }, { name: "profileId", type: "bytes32" },
  { name: "quoteAsset", type: "address" }, { name: "tokenBudget", type: "uint256" },
  { name: "configVersion", type: "uint32" }, { name: "config", type: "bytes" },
] as const;
export const lifecycleBuyComponents = [
  { name: "marketIndex", type: "uint32" }, { name: "quoteAmountIn", type: "uint256" },
  { name: "minTokenOut", type: "uint256" }, { name: "recipient", type: "address" },
  { name: "sqrtPriceLimitX96", type: "uint160" },
] as const;
export const launchPlanV1Components = [
  { name: "chainId", type: "uint256" }, { name: "orchestrator", type: "address" },
  { name: "creator", type: "address" }, { name: "nonce", type: "uint256" },
  { name: "token", type: "tuple", components: lifecycleTokenComponents },
  { name: "funding", type: "tuple[]", components: lifecycleFundingComponents },
  { name: "feeAssets", type: "tuple[]", components: lifecycleFeePolicyComponents },
  { name: "markets", type: "tuple[]", components: lifecycleMarketComponents },
  { name: "buys", type: "tuple[]", components: lifecycleBuyComponents },
  { name: "deadline", type: "uint256" }, { name: "executorFeeBps", type: "uint16" },
] as const;
export const marketIdentityV1Components = [
  { name: "venue", type: "uint8" }, { name: "canonicalId", type: "bytes32" },
  { name: "manager", type: "address" }, { name: "factory", type: "address" }, { name: "pool", type: "address" },
  { name: "poolId", type: "bytes32" }, { name: "profileId", type: "bytes32" },
  { name: "currency0", type: "address" }, { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" },
  { name: "hook", type: "address" }, { name: "openingSqrtPriceX96", type: "uint160" },
] as const;
export const preparedMarketV1Components = [
  { name: "identity", type: "tuple", components: marketIdentityV1Components },
  { name: "feeSource", type: "address" }, { name: "custody", type: "address" },
  { name: "mintExecutor", type: "address" }, { name: "buyExecutor", type: "address" },
  { name: "exclusions", type: "address[]" }, { name: "positionCount", type: "uint32" },
] as const;
export const positionIdentityV1Components = [
  { name: "canonicalId", type: "bytes32" }, { name: "marketId", type: "bytes32" },
  { name: "manager", type: "address" }, { name: "custody", type: "address" }, { name: "tokenId", type: "uint256" },
  { name: "tickLower", type: "int24" }, { name: "tickUpper", type: "int24" },
  { name: "salt", type: "bytes32" }, { name: "liquidity", type: "uint128" },
] as const;
export const launchProgressV1Components = [
  { name: "launchId", type: "bytes32" }, { name: "planHash", type: "bytes32" },
  { name: "creator", type: "address" }, { name: "nonce", type: "uint256" },
  { name: "mode", type: "uint8" }, { name: "phase", type: "uint8" },
  { name: "token", type: "address" }, { name: "feeHub", type: "address" }, { name: "rewards", type: "address" },
  { name: "preparedMarkets", type: "uint32" }, { name: "marketCount", type: "uint32" },
  { name: "buyCount", type: "uint32" }, { name: "positionCount", type: "uint32" }, { name: "deadline", type: "uint256" },
] as const;
export const launchReceiptV1Components = [
  { name: "launchId", type: "bytes32" }, { name: "planHash", type: "bytes32" },
  { name: "token", type: "address" }, { name: "feeHub", type: "address" }, { name: "rewards", type: "address" },
  { name: "marketCount", type: "uint32" }, { name: "positionCount", type: "uint32" },
  { name: "quoteSpent", type: "uint256[]" }, { name: "tokenOut", type: "uint256[]" },
] as const;
export const adapterRegistrationV1Components = [
  { name: "implementation", type: "address" }, { name: "codeHash", type: "bytes32" },
  { name: "capabilities", type: "uint64" }, { name: "configVersion", type: "uint32" }, { name: "enabled", type: "bool" },
] as const;
export const profileRegistrationV1Components = [
  { name: "adapterId", type: "bytes32" }, { name: "configSchema", type: "bytes32" },
  { name: "dependencyDigest", type: "bytes32" }, { name: "venue", type: "address" },
  { name: "factory", type: "address" }, { name: "hook", type: "address" },
  { name: "capabilities", type: "uint64" }, { name: "enabled", type: "bool" },
] as const;
export const profileTopologyV1Components = [
  { name: "hookTopology", type: "uint8" }, { name: "configVersion", type: "uint32" },
  { name: "hookDeployer", type: "address" }, { name: "hookCreationCodeHash", type: "bytes32" },
] as const;
export const marketLiveStateV1Components = [
  { name: "sqrtPriceX96", type: "uint160" }, { name: "tick", type: "int24" }, { name: "liquidity", type: "uint128" },
  { name: "publicTrading", type: "bool" }, { name: "oracleReadyAt", type: "uint256" },
] as const;
export const launchExecutionContextV1Components = [
  { name: "launchId", type: "bytes32" }, { name: "marketIndex", type: "uint32" }, { name: "operation", type: "uint8" },
  { name: "adapter", type: "address" }, { name: "executor", type: "address" }, { name: "token", type: "address" },
  { name: "quoteAsset", type: "address" }, { name: "manager", type: "address" }, { name: "custody", type: "address" },
  { name: "recipient", type: "address" }, { name: "amount", type: "uint256" },
] as const;

export function encodeLaunchPlan(plan: LaunchPlanV1): Hex {
  return encodeAbiParameters([{ name: "plan", type: "tuple", components: launchPlanV1Components }], [plan]);
}

export const LIFECYCLE_PLAN_DOMAIN = keccak256(stringToHex("BLACK_MARKET_LAUNCH_PLAN_V1"));

/** Commitment to all economic fields, including chain, orchestrator, creator and nonce. */
export function hashLaunchPlan(plan: LaunchPlanV1): Hex {
  return keccak256(encodeAbiParameters([
    { type: "bytes32" }, { type: "tuple", components: launchPlanV1Components },
  ], [LIFECYCLE_PLAN_DOMAIN, plan]));
}

/** Stable across blocks and modes; token config is committed separately by CREATE2. */
export function hashLaunchIdentity(plan: Pick<LaunchPlanV1, "chainId" | "orchestrator" | "creator" | "nonce">): Hex {
  return keccak256(encodeAbiParameters([
    { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "uint256" },
  ], [plan.chainId, plan.orchestrator, plan.creator, plan.nonce]));
}

/** Portable JSON uses decimal strings for uint160/uint256 fields, preserving exact integers. */
export function serializeLaunchPlan(plan: LaunchPlanV1): string {
  return JSON.stringify(plan, (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value);
}
function planRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  // The object guard establishes the JSON schema boundary; individual fields remain unknown.
  const record = value as Record<string, unknown>;
  return record;
}
function planUint(value: unknown, bits: number, label: string): bigint {
  let result: bigint;
  if (typeof value === "string" && /^[0-9]+$/.test(value)) result = BigInt(value);
  else if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) result = BigInt(value);
  else throw new Error(`${label} must be an exact unsigned decimal integer`);
  if (result >= 1n << BigInt(bits)) throw new Error(`${label} exceeds uint${bits}`);
  return result;
}
function planString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}
function planAddress(value: unknown, label: string): Address {
  const string = planString(value, label);
  if (!/^0x[0-9a-fA-F]{40}$/.test(string)) throw new Error(`${label} must be an address`);
  // Exact 20-byte validation above establishes Address without changing committed casing.
  return string as Address;
}
function planHex(value: unknown, label: string, bytes?: number): Hex {
  const string = planString(value, label);
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(string) || (bytes !== undefined && string.length !== 2 + bytes * 2)) throw new Error(`${label} must be ${bytes === undefined ? "byte" : `${bytes}-byte`} hex`);
  // Even-length byte validation establishes the ABI bytes boundary.
  return string as Hex;
}
function planArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}
export function parseLaunchPlan(json: string): LaunchPlanV1 {
  const value = planRecord(JSON.parse(json), "plan");
  const token = planRecord(value.token, "token");
  if (typeof token.burnOnCancel !== "boolean") throw new Error("burnOnCancel must be boolean");
  const kind = Number(planUint(token.kind, 8, "token.kind"));
  const rewardMode = Number(planUint(token.rewardMode, 8, "token.rewardMode"));
  if (kind > LifecycleTokenKind.ERC404 || rewardMode > LifecycleRewardMode.Dividends) throw new Error("Unsupported token or reward kind");
  return {
    chainId: planUint(value.chainId, 256, "chainId"), orchestrator: planAddress(value.orchestrator, "orchestrator"),
    creator: planAddress(value.creator, "creator"), nonce: planUint(value.nonce, 256, "nonce"),
    token: {
      kind, rewardMode, name: planString(token.name, "token.name"), symbol: planString(token.symbol, "token.symbol"),
      supply: planUint(token.supply, 256, "token.supply"), nftUnit: planUint(token.nftUnit, 256, "token.nftUnit"),
      metadataURI: planString(token.metadataURI, "metadataURI"), salt: planHex(token.salt, "token.salt", 32),
      inventoryRecipient: planAddress(token.inventoryRecipient, "inventoryRecipient"), burnOnCancel: token.burnOnCancel,
    },
    funding: planArray(value.funding, "funding").map((raw) => {
      const item = planRecord(raw, "funding asset");
      const fundingKind = Number(planUint(item.kind, 8, "funding.kind"));
      if (fundingKind > LifecycleFundingKind.Swap) throw new Error("Unsupported funding kind");
      return { asset: planAddress(item.asset, "funding.asset"), amount: planUint(item.amount, 256, "funding.amount"),
        kind: fundingKind, inputAsset: planAddress(item.inputAsset, "funding.inputAsset"), inputAmount: planUint(item.inputAmount, 256, "funding.inputAmount"),
        target: planAddress(item.target, "funding.target"), data: planHex(item.data, "funding.data") };
    }),
    feeAssets: planArray(value.feeAssets, "feeAssets").map((raw) => {
      const item = planRecord(raw, "fee policy");
      return { asset: planAddress(item.asset, "fee asset"), ownerBps: Number(planUint(item.ownerBps, 16, "ownerBps")),
        rewardsBps: Number(planUint(item.rewardsBps, 16, "rewardsBps")), burnBps: Number(planUint(item.burnBps, 16, "burnBps")) };
    }),
    markets: planArray(value.markets, "markets").map((raw) => {
      const item = planRecord(raw, "market");
      return { adapterId: planHex(item.adapterId, "adapterId", 32), profileId: planHex(item.profileId, "profileId", 32),
        quoteAsset: planAddress(item.quoteAsset, "quoteAsset"), tokenBudget: planUint(item.tokenBudget, 256, "tokenBudget"),
        configVersion: Number(planUint(item.configVersion, 32, "configVersion")), config: planHex(item.config, "config") };
    }),
    buys: planArray(value.buys, "buys").map((raw) => {
      const item = planRecord(raw, "initial buy");
      return { marketIndex: Number(planUint(item.marketIndex, 32, "marketIndex")), quoteAmountIn: planUint(item.quoteAmountIn, 256, "quoteAmountIn"),
        minTokenOut: planUint(item.minTokenOut, 256, "minTokenOut"), recipient: planAddress(item.recipient, "recipient"),
        sqrtPriceLimitX96: planUint(item.sqrtPriceLimitX96, 160, "sqrtPriceLimitX96") };
    }),
    deadline: planUint(value.deadline, 256, "deadline"), executorFeeBps: Number(planUint(value.executorFeeBps, 16, "executorFeeBps")),
  };
}
