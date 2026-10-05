import {
  adapterRegistrationV1Components, launchExecutionContextV1Components, launchPlanV1Components, launchProgressV1Components,
  launchReceiptV1Components, lifecycleFeePolicyComponents, lifecycleMarketComponents, marketIdentityV1Components,
  marketLiveStateV1Components, positionIdentityV1Components, preparedMarketV1Components,
  profileRegistrationV1Components, profileTopologyV1Components, launchEnvelopeV2Components, sourceTermsV3Components,
} from "./schema.js";
import { poolBoundHookParametersV1Components, v4LifecycleMarketComponents } from "./markets.js";

const planInput = { name: "plan", type: "tuple", components: launchPlanV1Components } as const;
export const launchLifecycleAbi = [
  { type: "function", name: "hashPlan", stateMutability: "pure", inputs: [planInput], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "launchIdOf", stateMutability: "pure", inputs: [planInput], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "predictToken", stateMutability: "view", inputs: [planInput], outputs: [{ type: "address" }] },
  { type: "function", name: "launchAtomic", stateMutability: "payable", inputs: [planInput], outputs: [{ type: "tuple", components: launchReceiptV1Components }] },
  { type: "function", name: "beginLaunch", stateMutability: "payable", inputs: [planInput, { name: "mode", type: "uint8" }], outputs: [{ type: "tuple", components: launchProgressV1Components }] },
  { type: "function", name: "prepareMarkets", stateMutability: "nonpayable", inputs: [planInput, { name: "firstMarket", type: "uint32" }, { name: "count", type: "uint32" }], outputs: [] },
  { type: "function", name: "activateLaunch", stateMutability: "nonpayable", inputs: [planInput], outputs: [{ type: "tuple", components: launchReceiptV1Components }] },
  { type: "function", name: "cancelLaunch", stateMutability: "nonpayable", inputs: [planInput], outputs: [] },
  { type: "function", name: "readLaunchProgress", stateMutability: "view", inputs: [{ name: "launchId", type: "bytes32" }], outputs: [{ type: "tuple", components: launchProgressV1Components }] },
  { type: "function", name: "executionContext", stateMutability: "view", inputs: [], outputs: [{ type: "tuple", components: launchExecutionContextV1Components }] },
  { type: "function", name: "authorizeTokenTransfer", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "bool" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "isLaunchActive", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "escrowBalance", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "registry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "directory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "tokenFactory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "fundingEscrow", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "feeFactory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "event", name: "LaunchBegun", anonymous: false, inputs: [
    { name: "launchId", type: "bytes32", indexed: true }, { name: "planHash", type: "bytes32", indexed: true },
    { name: "creator", type: "address", indexed: true }, { name: "token", type: "address", indexed: false },
    { name: "feeHub", type: "address", indexed: false }, { name: "rewards", type: "address", indexed: false }, { name: "mode", type: "uint8", indexed: false },
  ] },
  { type: "event", name: "MarketPrepared", anonymous: false, inputs: [
    { name: "launchId", type: "bytes32", indexed: true }, { name: "marketIndex", type: "uint32", indexed: true },
    { name: "canonicalId", type: "bytes32", indexed: true }, { name: "adapter", type: "address", indexed: false },
    { name: "feeSource", type: "address", indexed: false }, { name: "positionCount", type: "uint32", indexed: false },
  ] },
  { type: "event", name: "LaunchReady", anonymous: false, inputs: [{ name: "launchId", type: "bytes32", indexed: true }] },
  { type: "event", name: "InitialBuyExecuted", anonymous: false, inputs: [
    { name: "launchId", type: "bytes32", indexed: true }, { name: "buyIndex", type: "uint32", indexed: true },
    { name: "marketIndex", type: "uint32", indexed: true }, { name: "quoteAsset", type: "address", indexed: false },
    { name: "quoteSpent", type: "uint256", indexed: false }, { name: "tokenOut", type: "uint256", indexed: false }, { name: "recipient", type: "address", indexed: false },
  ] },
  { type: "event", name: "LaunchActivated", anonymous: false, inputs: [
    { name: "launchId", type: "bytes32", indexed: true }, { name: "planHash", type: "bytes32", indexed: true },
    { name: "token", type: "address", indexed: true }, { name: "marketCount", type: "uint32", indexed: false }, { name: "positionCount", type: "uint32", indexed: false },
  ] },
  { type: "event", name: "LaunchCancelled", anonymous: false, inputs: [
    { name: "launchId", type: "bytes32", indexed: true }, { name: "creator", type: "address", indexed: true }, { name: "inventoryBurned", type: "bool", indexed: false },
  ] },
  { type: "event", name: "AssetRefunded", anonymous: false, inputs: [
    { name: "launchId", type: "bytes32", indexed: true }, { name: "asset", type: "address", indexed: true },
    { name: "creator", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false },
  ] },
] as const;
export const lifecycleRegistryAbi = [
  { type: "function", name: "core", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "adapter", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "tuple", components: adapterRegistrationV1Components }] },
  { type: "function", name: "profile", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "tuple", components: profileRegistrationV1Components }] },
  { type: "function", name: "profileTopology", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "tuple", components: profileTopologyV1Components }] },
  { type: "function", name: "requireEligible", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint32" }, { type: "uint64" }], outputs: [{ type: "address" }] },
  { type: "function", name: "fundingInputAllowed", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "fundingTarget", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ name: "spender", type: "address" }, { name: "codeHash", type: "bytes32" }, { name: "enabled", type: "bool" }] },
  { type: "function", name: "adapterCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "profileCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "adapterIds", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "uint256" }], outputs: [{ type: "bytes32[]" }] },
  { type: "function", name: "profileIds", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "uint256" }], outputs: [{ type: "bytes32[]" }] },
  { type: "function", name: "admin", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "protocolMaximumDeveloperFeeBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "profileEnvelope", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "tuple", components: launchEnvelopeV2Components }] },
  { type: "function", name: "profileId", stateMutability: "pure", inputs: [{ type: "tuple", components: launchEnvelopeV2Components }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "developerTerms", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [
    { name: "adapter", type: "address" }, { name: "beneficiary", type: "address" },
    { name: "maximumDeveloperFeeBps", type: "uint16" }, { name: "termsDigest", type: "bytes32" }, { name: "enabled", type: "bool" },
  ] },
  { type: "function", name: "beneficiaryNonces", stateMutability: "view", inputs: [{ name: "authorId", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "authorizationDigest", stateMutability: "view", inputs: [
    { name: "profileId", type: "bytes32" }, { name: "registration", type: "tuple", components: profileRegistrationV1Components },
    { name: "envelope", type: "tuple", components: launchEnvelopeV2Components },
    { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
  ], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "registerProfile", stateMutability: "nonpayable", inputs: [
    { name: "profileId", type: "bytes32" }, { name: "registration", type: "tuple", components: profileRegistrationV1Components },
    { name: "envelope", type: "tuple", components: launchEnvelopeV2Components },
    { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }, { name: "authorization", type: "bytes" },
  ], outputs: [] },
  { type: "function", name: "registerAbyssProfile", stateMutability: "nonpayable", inputs: [
    { name: "variant", type: "uint8" },
    { name: "registration", type: "tuple", components: profileRegistrationV1Components },
  ], outputs: [] },
  { type: "function", name: "authorPayout", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "address" }] },
  { type: "function", name: "setAuthorPayout", stateMutability: "nonpayable", inputs: [{ name: "authorId", type: "address" }, { name: "payout", type: "address" }], outputs: [] },
  { type: "function", name: "authorHubCount", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "authorHubs", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }, { type: "uint256" }], outputs: [
    { name: "hubs", type: "address[]" }, { name: "nextOffset", type: "uint256" }, { name: "total", type: "uint256" },
  ] },
  { type: "event", name: "AuthorPayoutUpdated", anonymous: false, inputs: [
    { name: "authorId", type: "address", indexed: true }, { name: "previousPayout", type: "address", indexed: true },
    { name: "newPayout", type: "address", indexed: true }, { name: "operator", type: "address", indexed: false },
  ] },
  { type: "event", name: "AuthorHubRegistered", anonymous: false, inputs: [
    { name: "authorId", type: "address", indexed: true }, { name: "hub", type: "address", indexed: true }, { name: "index", type: "uint256", indexed: false },
  ] },
] as const;
export const lifecycleAdapterAbi = [
  { type: "function", name: "core", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "dependencyDigest", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "resolve", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "address" }, { type: "tuple", components: lifecycleMarketComponents }], outputs: [{ type: "tuple", components: marketIdentityV1Components }] },
  { type: "function", name: "validatePrepared", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "uint32" }, { type: "address" }, { type: "tuple", components: lifecycleMarketComponents }, { type: "tuple", components: marketIdentityV1Components }], outputs: [] },
  { type: "function", name: "readMarket", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "uint32" }], outputs: [{ type: "tuple", components: marketLiveStateV1Components }] },
  { type: "function", name: "readPosition", stateMutability: "view", inputs: [{ type: "tuple", components: positionIdentityV1Components }], outputs: [{ type: "uint128" }, { type: "address" }] },
] as const;

const v4AdapterMetadataAbi = [
  ...lifecycleAdapterAbi,
  { type: "function", name: "PROFILE_ID", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "CONFIG_SCHEMA", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "CONFIG_VERSION", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
  { type: "function", name: "implementationRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "poolManager", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "oracleFactory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "locker", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "collectorFactory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "hookDeployer", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;
export const sharedMarketAdapterV1Abi = [
  ...v4AdapterMetadataAbi,
  { type: "function", name: "hookRoot", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "constructor", stateMutability: "nonpayable", inputs: [
    { name: "core_", type: "address" }, { name: "manager_", type: "address" }, { name: "root_", type: "address" },
    { name: "locker_", type: "address" }, { name: "helper_", type: "address" }, { name: "registry_", type: "address" },
    { name: "deployer_", type: "address" }, { name: "profileId_", type: "bytes32" },
  ] },
] as const;
export const abyssLifecycleAdapterAbi = [
  ...lifecycleAdapterAbi,
  { type: "function", name: "CONFIG_SCHEMA", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "CONFIG_VERSION", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
  { type: "function", name: "profileId", stateMutability: "view", inputs: [{ type: "uint8" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;
export const poolMarketAdapterV1Abi = [
  ...v4AdapterMetadataAbi,
  { type: "function", name: "hookRoot", stateMutability: "pure", inputs: [], outputs: [{ type: "address" }] },
  { type: "constructor", stateMutability: "nonpayable", inputs: [
    { name: "core_", type: "address" }, { name: "manager_", type: "address" }, { name: "oracleFactory_", type: "address" },
    { name: "locker_", type: "address" }, { name: "deployer_", type: "address" }, { name: "helper_", type: "address" },
    { name: "registry_", type: "address" }, { name: "profileId_", type: "bytes32" },
  ] },
  { type: "function", name: "hookDeploymentMetadata", stateMutability: "view", inputs: [
    { name: "token", type: "address" }, { name: "market", type: "tuple", components: lifecycleMarketComponents },
  ], outputs: [
    { name: "deployer", type: "address" }, { name: "initCodeHash", type: "bytes32" },
    { name: "salt", type: "bytes32" }, { name: "predictedHook", type: "address" },
  ] },
] as const;
const boundParametersInput = { name: "parameters", type: "tuple", components: poolBoundHookParametersV1Components } as const;
export const poolHookDeployerV1Abi = [
  { type: "constructor", stateMutability: "nonpayable", inputs: [{ name: "creationCode", type: "bytes" }] },
  { type: "function", name: "creationCodeHash", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "codeChunk0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "codeChunk1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "deployedCodeHash", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "initCodeHash", stateMutability: "view", inputs: [boundParametersInput], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "predict", stateMutability: "view", inputs: [boundParametersInput, { name: "salt", type: "bytes32" }], outputs: [{ type: "address" }] },
  { type: "function", name: "validHookAddress", stateMutability: "pure", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "deploy", stateMutability: "nonpayable", inputs: [boundParametersInput, { name: "salt", type: "bytes32" }], outputs: [{ name: "hook", type: "address" }] },
] as const;
export const sharedHookDeployerV1Abi = [
  { type: "constructor", stateMutability: "nonpayable", inputs: [{ name: "creationCode", type: "bytes" }] },
  { type: "function", name: "creationCodeHash", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "codeChunk0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "codeChunk1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "deployedCodeHash", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "predict", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "bytes32" }], outputs: [{ type: "address" }] },
] as const;
export const lifecycleV4PoolKeyComponents = [
  { name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" },
] as const;
export const lifecycleV4HookPoolConfigComponents = [
  { name: "collector", type: "address" }, { name: "liquidityLocker", type: "address" }, { name: "quoteCurrency", type: "address" },
  { name: "feeMode", type: "uint8" }, { name: "hookFeePips", type: "uint24" }, { name: "protocolFeeDenominator", type: "uint8" },
  { name: "treasury", type: "address" }, { name: "externalLiquidityDisabled", type: "bool" }, { name: "oracleConfigId", type: "bytes32" },
] as const;
export const lifecycleV4HookAbi = [
  { type: "function", name: "poolManager", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "registrar", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "oracleFactory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "REQUIRED_HOOK_FLAGS", stateMutability: "view", inputs: [], outputs: [{ type: "uint160" }] },
  { type: "function", name: "ALL_HOOK_MASK", stateMutability: "view", inputs: [], outputs: [{ type: "uint160" }] },
  { type: "function", name: "registered", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "initialized", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "openingCompletedAt", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "oracleInitializedAt", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "poolKey", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "tuple", components: lifecycleV4PoolKeyComponents }] },
  { type: "function", name: "poolConfig", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "tuple", components: lifecycleV4HookPoolConfigComponents }] },
  { type: "function", name: "registerPool", stateMutability: "nonpayable", inputs: [{ type: "tuple", components: lifecycleV4PoolKeyComponents }, { type: "tuple", components: lifecycleV4HookPoolConfigComponents }], outputs: [] },
  { type: "function", name: "completePoolOpening", stateMutability: "nonpayable", inputs: [{ type: "tuple", components: lifecycleV4PoolKeyComponents }], outputs: [] },
  { type: "function", name: "validateCollector", stateMutability: "view", inputs: [{ type: "tuple", components: lifecycleV4PoolKeyComponents }, { type: "address" }, { type: "address" }], outputs: [] },
  { type: "function", name: "collectFees", stateMutability: "nonpayable", inputs: [{ type: "tuple", components: lifecycleV4PoolKeyComponents }], outputs: [{ type: "uint256" }, { type: "uint256" }] },
  { type: "function", name: "validateOracleConfig", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint24" }, { type: "uint16" }] },
  { type: "function", name: "observeTruncated", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "uint32[]" }], outputs: [{ type: "int56[]" }, { type: "uint160[]" }] },
  { type: "function", name: "increaseObservationCardinalityNext", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "uint16" }], outputs: [] },
  { type: "function", name: "pendingFees", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "settledFees", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
/** Complete mined FixedFeePoolHookV1 ABI (pool-launch-v1, 20261005T053747Z-b5a7b88).
 * Compiler-only internalType annotations are omitted; the constructor is one 18-field tuple. */
export const fixedFeePoolHookV1Abi = [
  { type: "constructor", inputs: [boundParametersInput], stateMutability: "nonpayable" },
  { type: "function", name: "ALL_HOOK_MASK", inputs: [], outputs: [{ name: "", type: "uint160" }], stateMutability: "view" },
  { type: "function", name: "MAX_ORACLE_CARDINALITY", inputs: [], outputs: [{ name: "", type: "uint16" }], stateMutability: "view" },
  { type: "function", name: "PIPS_DENOMINATOR", inputs: [], outputs: [{ name: "", type: "uint24" }], stateMutability: "view" },
  { type: "function", name: "REQUIRED_HOOK_FLAGS", inputs: [], outputs: [{ name: "", type: "uint160" }], stateMutability: "view" },
  { type: "function", name: "afterDonate", inputs: [{ name: "", type: "address" }, { name: "key", type: "tuple", components: lifecycleV4PoolKeyComponents }, { name: "", type: "uint256" }, { name: "", type: "uint256" }, { name: "", type: "bytes" }], outputs: [{ name: "", type: "bytes4" }], stateMutability: "nonpayable" },
  { type: "function", name: "afterInitialize", inputs: [{ name: "sender", type: "address" }, { name: "key", type: "tuple", components: lifecycleV4PoolKeyComponents }, { name: "sqrtPriceX96", type: "uint160" }, { name: "tick", type: "int24" }], outputs: [{ name: "", type: "bytes4" }], stateMutability: "nonpayable" },
  { type: "function", name: "afterSwap", inputs: [{ name: "", type: "address" }, { name: "key", type: "tuple", components: lifecycleV4PoolKeyComponents }, { name: "params", type: "tuple", components: [{ name: "zeroForOne", type: "bool" }, { name: "amountSpecified", type: "int256" }, { name: "sqrtPriceLimitX96", type: "uint160" }] }, { name: "delta", type: "int256" }, { name: "", type: "bytes" }], outputs: [{ name: "", type: "bytes4" }, { name: "", type: "int128" }], stateMutability: "nonpayable" },
  { type: "function", name: "aggregateLiabilities", inputs: [{ name: "asset", type: "address" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "aggregateManagerClaims", inputs: [{ name: "asset", type: "address" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "beforeAddLiquidity", inputs: [{ name: "sender", type: "address" }, { name: "key", type: "tuple", components: lifecycleV4PoolKeyComponents }, { name: "params", type: "tuple", components: [{ name: "tickLower", type: "int24" }, { name: "tickUpper", type: "int24" }, { name: "liquidityDelta", type: "int256" }, { name: "salt", type: "bytes32" }] }, { name: "", type: "bytes" }], outputs: [{ name: "", type: "bytes4" }], stateMutability: "nonpayable" },
  { type: "function", name: "beforeDonate", inputs: [{ name: "", type: "address" }, { name: "key", type: "tuple", components: lifecycleV4PoolKeyComponents }, { name: "amount0", type: "uint256" }, { name: "amount1", type: "uint256" }, { name: "", type: "bytes" }], outputs: [{ name: "", type: "bytes4" }], stateMutability: "nonpayable" },
  { type: "function", name: "beforeRemoveLiquidity", inputs: [{ name: "sender", type: "address" }, { name: "key", type: "tuple", components: lifecycleV4PoolKeyComponents }, { name: "params", type: "tuple", components: [{ name: "tickLower", type: "int24" }, { name: "tickUpper", type: "int24" }, { name: "liquidityDelta", type: "int256" }, { name: "salt", type: "bytes32" }] }, { name: "", type: "bytes" }], outputs: [{ name: "", type: "bytes4" }], stateMutability: "nonpayable" },
  { type: "function", name: "beforeSwap", inputs: [{ name: "", type: "address" }, { name: "key", type: "tuple", components: lifecycleV4PoolKeyComponents }, { name: "params", type: "tuple", components: [{ name: "zeroForOne", type: "bool" }, { name: "amountSpecified", type: "int256" }, { name: "sqrtPriceLimitX96", type: "uint160" }] }, { name: "", type: "bytes" }], outputs: [{ name: "", type: "bytes4" }, { name: "", type: "int256" }, { name: "", type: "uint24" }], stateMutability: "nonpayable" },
  { type: "function", name: "boundPoolId", inputs: [], outputs: [{ name: "", type: "bytes32" }], stateMutability: "view" },
  { type: "function", name: "collectFees", inputs: [{ name: "key", type: "tuple", components: lifecycleV4PoolKeyComponents }], outputs: [{ name: "amount0", type: "uint256" }, { name: "amount1", type: "uint256" }], stateMutability: "nonpayable" },
  { type: "function", name: "completePoolOpening", inputs: [{ name: "key", type: "tuple", components: lifecycleV4PoolKeyComponents }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "core", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  { type: "function", name: "deploymentConfigHash", inputs: [], outputs: [{ name: "", type: "bytes32" }], stateMutability: "view" },
  { type: "function", name: "expectedPositionCount", inputs: [], outputs: [{ name: "", type: "uint32" }], stateMutability: "view" },
  { type: "function", name: "increaseObservationCardinalityNext", inputs: [{ name: "id", type: "bytes32" }, { name: "requested", type: "uint16" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "initialized", inputs: [{ name: "id", type: "bytes32" }], outputs: [{ name: "", type: "bool" }], stateMutability: "view" },
  { type: "function", name: "liquidityLocker", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  { type: "function", name: "marketCommitment", inputs: [], outputs: [{ name: "", type: "bytes32" }], stateMutability: "view" },
  { type: "function", name: "observations", inputs: [{ name: "id", type: "bytes32" }, { name: "index", type: "uint256" }], outputs: [{ name: "blockTimestamp", type: "uint32" }, { name: "tickCumulative", type: "int56" }, { name: "secondsPerLiquidityCumulativeX128", type: "uint160" }, { name: "observationInitialized", type: "bool" }], stateMutability: "view" },
  { type: "function", name: "observeTruncated", inputs: [{ name: "id", type: "bytes32" }, { name: "secondsAgos", type: "uint32[]" }], outputs: [{ name: "tickCumulatives", type: "int56[]" }, { name: "secondsPerLiquidityCumulativeX128s", type: "uint160[]" }], stateMutability: "view" },
  { type: "function", name: "openingCompletedAt", inputs: [{ name: "id", type: "bytes32" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "openingSqrtPriceX96", inputs: [], outputs: [{ name: "", type: "uint160" }], stateMutability: "view" },
  { type: "function", name: "oracleFactory", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  { type: "function", name: "oracleInitializedAt", inputs: [{ name: "id", type: "bytes32" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "oracleState", inputs: [{ name: "id", type: "bytes32" }], outputs: [{ name: "index", type: "uint16" }, { name: "cardinality", type: "uint16" }, { name: "cardinalityNext", type: "uint16" }, { name: "tick", type: "int24" }, { name: "lastBlock", type: "uint64" }, { name: "initializedAt", type: "uint64" }, { name: "maxAbsTickMove", type: "int24" }, { name: "cardinalityCap", type: "uint16" }], stateMutability: "view" },
  { type: "function", name: "pendingFees", inputs: [{ name: "id", type: "bytes32" }, { name: "asset", type: "address" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "pendingTreasurySweeps", inputs: [{ name: "id", type: "bytes32" }, { name: "asset", type: "address" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "poolConfig", inputs: [{ name: "id", type: "bytes32" }], outputs: [{ name: "", type: "tuple", components: lifecycleV4HookPoolConfigComponents }], stateMutability: "view" },
  { type: "function", name: "poolKey", inputs: [{ name: "id", type: "bytes32" }], outputs: [{ name: "", type: "tuple", components: lifecycleV4PoolKeyComponents }], stateMutability: "view" },
  { type: "function", name: "poolManager", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  { type: "function", name: "pools", inputs: [], outputs: [{ name: "ids", type: "bytes32[]" }], stateMutability: "view" },
  { type: "function", name: "registerPool", inputs: [{ name: "key", type: "tuple", components: lifecycleV4PoolKeyComponents }, { name: "config", type: "tuple", components: lifecycleV4HookPoolConfigComponents }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "registered", inputs: [{ name: "id", type: "bytes32" }], outputs: [{ name: "", type: "bool" }], stateMutability: "view" },
  { type: "function", name: "registrar", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  { type: "function", name: "settledFees", inputs: [{ name: "id", type: "bytes32" }, { name: "asset", type: "address" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "token", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  { type: "function", name: "unlockCallback", inputs: [{ name: "data", type: "bytes" }], outputs: [{ name: "", type: "bytes" }], stateMutability: "nonpayable" },
  { type: "function", name: "validateCollector", inputs: [{ name: "key", type: "tuple", components: lifecycleV4PoolKeyComponents }, { name: "collector", type: "address" }, { name: "locker", type: "address" }], outputs: [], stateMutability: "view" },
  { type: "function", name: "validateOracleConfig", inputs: [{ name: "oracleConfigId", type: "bytes32" }], outputs: [{ name: "maxAbsTickMove", type: "uint24" }, { name: "cardinality", type: "uint16" }], stateMutability: "view" },
  { type: "event", name: "FeeAccrued", inputs: [{ name: "poolId", type: "bytes32", indexed: true }, { name: "asset", type: "address", indexed: true }, { name: "gross", type: "uint256", indexed: false }, { name: "treasury", type: "uint256", indexed: false }], anonymous: false },
  { type: "event", name: "FeesCollected", inputs: [{ name: "poolId", type: "bytes32", indexed: true }, { name: "collector", type: "address", indexed: true }, { name: "amount0", type: "uint256", indexed: false }, { name: "amount1", type: "uint256", indexed: false }], anonymous: false },
  { type: "event", name: "IncreaseObservationCardinalityNext", inputs: [{ name: "poolId", type: "bytes32", indexed: true }, { name: "cardinalityNextOld", type: "uint16", indexed: false }, { name: "cardinalityNextNew", type: "uint16", indexed: false }], anonymous: false },
  { type: "event", name: "LpFeesCheckpointed", inputs: [{ name: "poolId", type: "bytes32", indexed: true }, { name: "locker", type: "address", indexed: true }, { name: "amount0", type: "uint256", indexed: false }, { name: "amount1", type: "uint256", indexed: false }], anonymous: false },
  { type: "event", name: "OpeningCompleted", inputs: [{ name: "poolId", type: "bytes32", indexed: true }, { name: "completedAt", type: "uint256", indexed: true }], anonymous: false },
  { type: "event", name: "PoolInitialized", inputs: [{ name: "poolId", type: "bytes32", indexed: true }], anonymous: false },
  { type: "event", name: "PoolRegistered", inputs: [{ name: "poolId", type: "bytes32", indexed: true }, { name: "collector", type: "address", indexed: true }, { name: "locker", type: "address", indexed: true }], anonymous: false },
  { type: "error", name: "AlreadyRegistered", inputs: [] },
  { type: "error", name: "ClaimMismatch", inputs: [] },
  { type: "error", name: "ExternalLiquidityDisabled", inputs: [] },
  { type: "error", name: "FeeSettlementRequired", inputs: [] },
  { type: "error", name: "FeeTooLarge", inputs: [] },
  { type: "error", name: "IncompleteFill", inputs: [] },
  { type: "error", name: "InexactTransfer", inputs: [] },
  { type: "error", name: "InvalidCallback", inputs: [] },
  { type: "error", name: "InvalidConfiguration", inputs: [] },
  { type: "error", name: "InvalidHookAddress", inputs: [] },
  { type: "error", name: "InvalidObservationState", inputs: [] },
  { type: "error", name: "InvalidPool", inputs: [] },
  { type: "error", name: "ObservationTooOld", inputs: [] },
  { type: "error", name: "OpeningAlreadyComplete", inputs: [] },
  { type: "error", name: "OpeningNotComplete", inputs: [] },
  { type: "error", name: "Reentrancy", inputs: [] },
  { type: "error", name: "Unauthorized", inputs: [] },
] as const;
export const lifecycleV4LockerAbi = [
  { type: "function", name: "poolManager", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "launcher", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "positionCount", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "isSealed", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
] as const;
export const poolFeeCollectorFactoryV1Abi = [
  { type: "function", name: "collectorDeployer", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "poolBoundHookParameters", stateMutability: "view", inputs: [
    { name: "registrar", type: "address" }, { name: "token", type: "address" }, { name: "market", type: "tuple", components: lifecycleMarketComponents },
  ], outputs: [boundParametersInput, { name: "salt", type: "bytes32" }] },
  { type: "function", name: "decodeAndValidate", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }, { type: "tuple", components: lifecycleMarketComponents }], outputs: [{ type: "tuple", components: v4LifecycleMarketComponents }] },
  { type: "function", name: "poolBoundDeploymentMetadata", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }, { type: "tuple", components: lifecycleMarketComponents }], outputs: [{ type: "address" }, { type: "bytes32" }, { type: "bytes32" }, { type: "address" }] },
  { type: "function", name: "dependencyDigest", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "create", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "address" }, { type: "tuple", components: lifecycleV4PoolKeyComponents }, { type: "uint256" }], outputs: [{ type: "address" }] },
] as const;
export const lifecycleDirectoryAbi = [
  { type: "function", name: "core", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "market", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "uint32" }], outputs: [{ name: "adapter", type: "address" }, { name: "prepared", type: "tuple", components: preparedMarketV1Components }] },
  { type: "function", name: "positions", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "uint32" }, { type: "uint256" }, { type: "uint256" }], outputs: [{ type: "tuple[]", components: positionIdentityV1Components }] },
  { type: "function", name: "launches", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "uint256" }], outputs: [{ type: "bytes32[]" }] },
  { type: "function", name: "launchOfToken", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bytes32" }] },
] as const;
export const lifecycleFundingEscrowAbi = [
  { type: "function", name: "core", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "wrappedNative", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;
export const lifecycleErc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;
/** Shared immutable bindings and terminal state of LaunchERC20V1 / LaunchERC404V1. */
export const lifecycleTokenContextAbi = [
  { type: "function", name: "authority", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "tokenFactory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "launchId", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "rewardMode", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "initialSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "burnOnCancel", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "active", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "cancelled", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "exclusionsFinalized", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "feeHub", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "rewardModule", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;
export const lifecycleErc404Abi = [
  ...lifecycleTokenContextAbi,
  { type: "function", name: "unit", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "baseURI", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "mirrorERC721", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;
export const lifecycleErc404MirrorAbi = [
  { type: "function", name: "baseERC20", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;
export const lifecycleTokenFactoryAbi = [
  { type: "function", name: "core", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "tokenOfLaunch", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "address" }] },
  { type: "function", name: "launchOfToken", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bytes32" }] },
  { type: "event", name: "TokenDeployed", anonymous: false, inputs: [
    { name: "launchId", type: "bytes32", indexed: true }, { name: "token", type: "address", indexed: true },
    { name: "kind", type: "uint8", indexed: false },
  ] },
] as const;

export const lifecycleOracleFactoryAbi = [
  { type: "function", name: "oracleConfigs", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint24" }, { type: "uint16" }] },
] as const;
export const lifecycleFeeHubAbi = [
  { type: "function", name: "economicVersion", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "implementationRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "protocolMaximumDeveloperFeeBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "configurator", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "launchToken", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "feeOwnerRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "rewards", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "requiresOwner", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "requiresRewards", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "rewardAssets", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { type: "function", name: "sourceAssets", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "address[]" }] },
  { type: "function", name: "sourceTerms", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "tuple", components: sourceTermsV3Components }] },
  { type: "function", name: "claimableDeveloperFees", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "reservedDeveloperFees", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "claimDeveloperFees", stateMutability: "nonpayable", inputs: [{ name: "authorId", type: "address" }, { name: "asset", type: "address" }], outputs: [{ name: "amount", type: "uint256" }] },
  { type: "event", name: "DeveloperFeesClaimed", anonymous: false, inputs: [
    { name: "authorId", type: "address", indexed: true }, { name: "asset", type: "address", indexed: true },
    { name: "payout", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false },
  ] },
  { type: "event", name: "DeveloperFeesCredited", anonymous: false, inputs: [
    { name: "authorId", type: "address", indexed: true }, { name: "source", type: "address", indexed: true },
    { name: "asset", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false },
  ] },
  { type: "error", name: "UnsupportedAsset", inputs: [] },
  { type: "function", name: "MAX_EXECUTOR_FEE_BPS", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "executorFeeBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "setExecutorFeeBps", stateMutability: "nonpayable", inputs: [{ name: "newFeeBps", type: "uint16" }], outputs: [] },
  { type: "event", name: "ExecutorFeeUpdated", inputs: [{ name: "feeOwner", type: "address", indexed: true }, { name: "previousFeeBps", type: "uint16", indexed: false }, { name: "newFeeBps", type: "uint16", indexed: false }], anonymous: false },
  { type: "function", name: "finalized", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "assets", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { type: "function", name: "sources", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { type: "function", name: "policy", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "tuple", components: lifecycleFeePolicyComponents }] },
  { type: "function", name: "claimAndSplit", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "tuple[]", components: [{ name: "asset", type: "address" }, { name: "amount", type: "uint256" }] }] },
  { type: "event", name: "Distributed", anonymous: false, inputs: [
    { name: "asset", type: "address", indexed: true }, { name: "owner", type: "address", indexed: true }, { name: "executor", type: "address", indexed: true },
    { name: "newlyCollected", type: "uint256", indexed: false }, { name: "executorAmount", type: "uint256", indexed: false },
    { name: "ownerAmount", type: "uint256", indexed: false }, { name: "developerAmount", type: "uint256", indexed: false },
    { name: "rewardsAmount", type: "uint256", indexed: false }, { name: "burnAmount", type: "uint256", indexed: false },
  ] },
  { type: "function", name: "claimableOwnerFees", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "asset", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "reservedOwnerFees", stateMutability: "view", inputs: [{ name: "asset", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "claimOwnerFees", stateMutability: "nonpayable", inputs: [{ name: "asset", type: "address" }, { name: "recipient", type: "address" }], outputs: [{ name: "amount", type: "uint256" }] },
  { type: "event", name: "OwnerFeesCredited", inputs: [{ name: "owner", type: "address", indexed: true }, { name: "asset", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }], anonymous: false },
  { type: "event", name: "OwnerFeesClaimed", inputs: [{ name: "owner", type: "address", indexed: true }, { name: "asset", type: "address", indexed: true }, { name: "recipient", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }], anonymous: false },
] as const;
export const developerClaimResultV3Components = [
  { name: "hub", type: "address" }, { name: "asset", type: "address" }, { name: "amount", type: "uint256" },
  { name: "status", type: "uint8" }, { name: "errorSelector", type: "bytes4" },
] as const;
export const lifecycleFeeHubFactoryAbi = [
  { type: "function", name: "isHub", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "implementationRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "deploymentAuthority", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "claimDeveloperFeesPage", stateMutability: "nonpayable", inputs: [
    { name: "authorId", type: "address" }, { name: "offset", type: "uint256" }, { name: "limit", type: "uint256" }, { name: "assets", type: "address[]" },
  ], outputs: [{ name: "results", type: "tuple[]", components: developerClaimResultV3Components }, { name: "nextOffset", type: "uint256" }, { name: "total", type: "uint256" }] },
  { type: "event", name: "DeveloperClaimResult", anonymous: false, inputs: [
    { name: "authorId", type: "address", indexed: true }, { name: "hub", type: "address", indexed: true },
    { name: "asset", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false },
    { name: "status", type: "uint8", indexed: false }, { name: "errorSelector", type: "bytes4", indexed: false },
  ] },
  { type: "event", name: "DeveloperClaimPage", anonymous: false, inputs: [
    { name: "authorId", type: "address", indexed: true }, { name: "offset", type: "uint256", indexed: false },
    { name: "nextOffset", type: "uint256", indexed: false }, { name: "total", type: "uint256", indexed: false },
  ] },
] as const;

/** Multiasset staking and dividend claims; return values and RewardPaid are beneficiary net. */
export const lifecycleRewardsAbi = [
  { type: "function", name: "rewardAssets", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { type: "function", name: "earned", stateMutability: "view", inputs: [{ name: "beneficiary", type: "address" }, { name: "asset", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "pendingRewards", stateMutability: "view", inputs: [{ name: "beneficiary", type: "address" }], outputs: [{ type: "uint256[]" }] },
  { type: "function", name: "lifetimeRewardsPaid", stateMutability: "view", inputs: [{ name: "asset", type: "address" }, { name: "beneficiary", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "uint256[]" }] },
  { type: "function", name: "claimFor", stateMutability: "nonpayable", inputs: [{ name: "beneficiary", type: "address" }], outputs: [{ type: "uint256[]" }] },
  { type: "function", name: "claimRange", stateMutability: "nonpayable", inputs: [{ name: "beneficiary", type: "address" }, { name: "start", type: "uint256" }, { name: "count", type: "uint256" }], outputs: [{ type: "uint256[]" }] },
  { type: "event", name: "RewardPaid", inputs: [{ name: "beneficiary", type: "address", indexed: true }, { name: "asset", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }], anonymous: false },
  { type: "event", name: "RewardClaimBountyPaid", inputs: [{ name: "executor", type: "address", indexed: true }, { name: "beneficiary", type: "address", indexed: true }, { name: "asset", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }], anonymous: false },
] as const;

/** Dividend-only policy; initially zero, controlled by the token's current registered fee owner. */
export const lifecycleDividendAbi = [
  ...lifecycleRewardsAbi,
  { type: "function", name: "MAX_DIVIDEND_BOUNTY_BPS", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "dividendBountyBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "setDividendBountyBps", stateMutability: "nonpayable", inputs: [{ name: "newBountyBps", type: "uint16" }], outputs: [] },
  { type: "event", name: "DividendBountyUpdated", inputs: [{ name: "feeOwner", type: "address", indexed: true }, { name: "previousBountyBps", type: "uint16", indexed: false }, { name: "newBountyBps", type: "uint16", indexed: false }], anonymous: false },
] as const;
