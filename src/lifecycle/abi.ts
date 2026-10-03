import {
  adapterRegistrationV1Components, launchExecutionContextV1Components, launchPlanV1Components, launchProgressV1Components,
  launchReceiptV1Components, lifecycleFeePolicyComponents, lifecycleMarketComponents, marketIdentityV1Components,
  marketLiveStateV1Components, positionIdentityV1Components, preparedMarketV1Components,
  profileRegistrationV1Components,
} from "./schema.js";

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
  { type: "function", name: "requireEligible", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint32" }, { type: "uint64" }], outputs: [{ type: "address" }] },
  { type: "function", name: "assetAllowed", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "fundingTarget", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ name: "spender", type: "address" }, { name: "codeHash", type: "bytes32" }, { name: "enabled", type: "bool" }] },
  { type: "function", name: "adapterCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "profileCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "adapterIds", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "uint256" }], outputs: [{ type: "bytes32[]" }] },
  { type: "function", name: "profileIds", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "uint256" }], outputs: [{ type: "bytes32[]" }] },
] as const;
export const lifecycleAdapterAbi = [
  { type: "function", name: "core", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "resolve", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "address" }, { type: "tuple", components: lifecycleMarketComponents }], outputs: [{ type: "tuple", components: marketIdentityV1Components }] },
  { type: "function", name: "validatePrepared", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "uint32" }, { type: "address" }, { type: "tuple", components: lifecycleMarketComponents }, { type: "tuple", components: marketIdentityV1Components }], outputs: [] },
  { type: "function", name: "readMarket", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "uint32" }], outputs: [{ type: "tuple", components: marketLiveStateV1Components }] },
  { type: "function", name: "readPosition", stateMutability: "view", inputs: [{ type: "tuple", components: positionIdentityV1Components }], outputs: [{ type: "uint128" }, { type: "address" }] },
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
export const lifecycleFeeHubAbi = [
  { type: "function", name: "finalized", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "assets", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { type: "function", name: "sources", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { type: "function", name: "policy", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "tuple", components: lifecycleFeePolicyComponents }] },
  { type: "function", name: "claimAndSplit", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "tuple[]", components: [{ name: "asset", type: "address" }, { name: "amount", type: "uint256" }] }] },
] as const;
