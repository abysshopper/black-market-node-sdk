import type { Address, Hex } from "viem";

export enum AbyssPoolProfile {
  Standard,
  StandardOracle,
  Quote,
  QuoteOracle,
}

export enum TokenKind {
  Burnable,
  HolderDividend,
}

export type AbyssPoolKey = {
  token0: Address;
  token1: Address;
  profile: AbyssPoolProfile;
  fee: number;
  quoteIsToken0: boolean;
  oracleConfigId: Hex;
};

export const ABYSS_FEE_TIERS = [
  { feePips: 500, tickSpacing: 10, label: "0.05%" },
  { feePips: 3_000, tickSpacing: 60, label: "0.30%" },
  { feePips: 10_000, tickSpacing: 200, label: "1%" },
  { feePips: 20_000, tickSpacing: 400, label: "2%" },
  { feePips: 50_000, tickSpacing: 1_000, label: "5%" },
  { feePips: 100_000, tickSpacing: 2_000, label: "10%" },
  { feePips: 150_000, tickSpacing: 3_000, label: "15%" },
] as const;

export const abyssFactoryAbi = [
  {
    type: "function",
    name: "feeAmountTickSpacing",
    stateMutability: "view",
    inputs: [{ name: "fee", type: "uint24" }],
    outputs: [{ name: "", type: "int24" }],
  },
  {
    type: "function",
    name: "oracleConfigs",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      { name: "maxAbsTickMove", type: "uint24" },
      { name: "cardinality", type: "uint16" },
    ],
  },
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "isPool",
    stateMutability: "view",
    inputs: [{ name: "pool", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "computePoolId",
    stateMutability: "view",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "token0", type: "address" },
          { name: "token1", type: "address" },
          { name: "profile", type: "uint8" },
          { name: "fee", type: "uint24" },
          { name: "quoteIsToken0", type: "bool" },
          { name: "oracleConfigId", type: "bytes32" },
        ],
      },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "computePoolAddress",
    stateMutability: "view",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "token0", type: "address" },
          { name: "token1", type: "address" },
          { name: "profile", type: "uint8" },
          { name: "fee", type: "uint24" },
          { name: "quoteIsToken0", type: "bool" },
          { name: "oracleConfigId", type: "bytes32" },
        ],
      },
    ],
    outputs: [{ name: "predicted", type: "address" }],
  },
  {
    type: "event",
    name: "PoolCreated",
    inputs: [
      { name: "token0", type: "address", indexed: true },
      { name: "token1", type: "address", indexed: true },
      { name: "fee", type: "uint24", indexed: true },
      { name: "profile", type: "uint8", indexed: false },
      { name: "quoteIsToken0", type: "bool", indexed: false },
      { name: "oracleConfigId", type: "bytes32", indexed: false },
      { name: "pool", type: "address", indexed: false },
    ],
  },
] as const;

export const abyssPoolAbi = [
  {
    type: "function",
    name: "factory",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "token0",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "token1",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "fee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint24" }],
  },
  {
    type: "function",
    name: "tickSpacing",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "int24" }],
  },
  {
    type: "function",
    name: "liquidity",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint128" }],
  },
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "observeTruncated",
    stateMutability: "view",
    inputs: [{ name: "secondsAgos", type: "uint32[]" }],
    outputs: [
      { name: "tickCumulatives", type: "int56[]" },
      { name: "secondsPerLiquidityCumulativeX128s", type: "uint160[]" },
    ],
  },
  {
    type: "function",
    name: "quoteIsToken0",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const abyssPositionManagerAbi = [
  {
    type: "function",
    name: "factory",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "nextTokenId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "account", type: "address" },
      { name: "pool", type: "address" },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "liquidity", type: "uint128" },
    ],
  },
  {
    type: "function",
    name: "accountFor",
    stateMutability: "view",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "pool", type: "address" },
    ],
    outputs: [{ name: "account", type: "address" }],
  },
  {
    type: "function",
    name: "createAndInitializePoolIfNecessary",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "token0", type: "address" },
          { name: "token1", type: "address" },
          { name: "profile", type: "uint8" },
          { name: "fee", type: "uint24" },
          { name: "quoteIsToken0", type: "bool" },
          { name: "oracleConfigId", type: "bytes32" },
        ],
      },
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "existingPriceMinimumX96", type: "uint160" },
      { name: "existingPriceMaximumX96", type: "uint160" },
    ],
    outputs: [
      { name: "pool", type: "address" },
      { name: "created", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "pool", type: "address" },
      { name: "recipient", type: "address" },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "liquidity", type: "uint128" },
      { name: "amount0Maximum", type: "uint256" },
      { name: "amount1Maximum", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [
      { name: "tokenId", type: "uint256" },
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "multicall",
    stateMutability: "payable",
    inputs: [{ name: "data", type: "bytes[]" }],
    outputs: [{ name: "results", type: "bytes[]" }],
  },
  {
    type: "function",
    name: "safeTransferFrom",
    stateMutability: "payable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "safeTransferFrom",
    stateMutability: "payable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "id", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export const abyssPositionLockerAbi = [
  {
    type: "function",
    name: "positionManager",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "locks",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "owner", type: "address" },
      { name: "claimAuthority", type: "address" },
      { name: "feeRecipient", type: "address" },
      { name: "unlockTime", type: "uint64" },
      { name: "permissionlessClaim", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "amount0", type: "uint128" },
      { name: "amount1", type: "uint128" },
    ],
  },
] as const;

export const abyssRouterAbi = [
  {
    type: "function",
    name: "factory",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "token0", type: "address" },
          { name: "token1", type: "address" },
          { name: "profile", type: "uint8" },
          { name: "fee", type: "uint24" },
          { name: "quoteIsToken0", type: "bool" },
          { name: "oracleConfigId", type: "bytes32" },
        ],
      },
      { name: "recipient", type: "address" },
      { name: "zeroForOne", type: "bool" },
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMinimum", type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

const erc20SurfaceAbi = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "sender", type: "address" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const configurableSupplyConstructor = {
  type: "constructor",
  stateMutability: "nonpayable",
  inputs: [
    { name: "name_", type: "string" },
    { name: "symbol_", type: "string" },
    { name: "decimals_", type: "uint8" },
    { name: "recipient", type: "address" },
    { name: "supply", type: "uint256" },
  ],
} as const;

export const abyssFixedSupplyTokenAbi = [
  configurableSupplyConstructor,
  ...erc20SurfaceAbi,
] as const;

export const burnableFixedSupplyTokenAbi = [
  configurableSupplyConstructor,
  ...erc20SurfaceAbi,
  {
    type: "function",
    name: "burn",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "burnFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;
export const launchTokenBurnSinkAbi = [
  {
    type: "constructor",
    stateMutability: "nonpayable",
    inputs: [{ name: "token_", type: "address" }],
  },
  {
    type: "error",
    name: "BurnAccountingMismatch",
    inputs: [
      { name: "balanceBefore", type: "uint256" },
      { name: "balanceAfter", type: "uint256" },
      { name: "supplyBefore", type: "uint256" },
      { name: "supplyAfter", type: "uint256" },
    ],
  },
  { type: "error", name: "BurnFailed", inputs: [] },
  {
    type: "error",
    name: "InvalidToken",
    inputs: [{ name: "token", type: "address" }],
  },
  { type: "error", name: "Reentrancy", inputs: [] },
  { type: "error", name: "ZeroBalance", inputs: [] },
  {
    type: "event",
    name: "Burned",
    inputs: [
      { name: "caller", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "function",
    name: "burn",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "function",
    name: "token",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const launchTokenFactoryBindingAbi = [
  {
    type: "function",
    name: "configurator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "launcher",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "DEPLOYMENT_SALT_DOMAIN",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "deploymentNonce",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "setLauncher",
    stateMutability: "nonpayable",
    inputs: [{ name: "launcher_", type: "address" }],
    outputs: [],
  },
] as const;

export const launchTokenFactoryAbi = [
  ...launchTokenFactoryBindingAbi,
  {
    type: "function",
    name: "deploy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "creator", type: "address" },
      { name: "kind", type: "uint8" },
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "decimals", type: "uint8" },
      { name: "supply", type: "uint256" },
    ],
    outputs: [{ name: "token", type: "address" }],
  },
  {
    type: "function",
    name: "computeDeploymentSalt",
    stateMutability: "view",
    inputs: [
      { name: "creator", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "prevrandao", type: "uint256" },
      { name: "kind", type: "uint8" },
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "decimals", type: "uint8" },
      { name: "supply", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "predictTokenAddress",
    stateMutability: "view",
    inputs: [
      { name: "creator", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "prevrandao", type: "uint256" },
      { name: "kind", type: "uint8" },
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "decimals", type: "uint8" },
      { name: "supply", type: "uint256" },
    ],
    outputs: [{ name: "token", type: "address" }],
  },
  {
    type: "function",
    name: "launchAuthority",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "authority", type: "address" }],
  },
  {
    type: "event",
    name: "TokenDeployed",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "salt", type: "bytes32", indexed: true },
      { name: "kind", type: "uint8", indexed: false },
      { name: "nonce", type: "uint256", indexed: false },
      { name: "prevrandao", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "LauncherConfigured",
    inputs: [{ name: "launcher", type: "address", indexed: true }],
    anonymous: false,
  },
  { type: "error", name: "EmptyName", inputs: [] },
  { type: "error", name: "EmptySymbol", inputs: [] },
  { type: "error", name: "ZeroSupply", inputs: [] },
  { type: "error", name: "ZeroCreator", inputs: [] },
  { type: "error", name: "Unauthorized", inputs: [] },
  { type: "error", name: "AlreadyConfigured", inputs: [] },
  { type: "error", name: "InvalidLauncher", inputs: [] },
] as const;

const abyssLaunchResultComponents = [
  { name: "creator", type: "address" },
  { name: "feeRecipient", type: "address" },
  { name: "pool", type: "address" },
  { name: "positionAccount", type: "address" },
  { name: "tokenId", type: "uint256" },
  { name: "amount0", type: "uint256" },
  { name: "amount1", type: "uint256" },
  { name: "created", type: "bool" },
] as const;

const abyssLaunchParamsComponents = [
  { name: "launchedToken", type: "address" },
  { name: "feeRecipient", type: "address" },
  { name: "creator", type: "address" },
  {
    name: "key",
    type: "tuple",
    components: [
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "profile", type: "uint8" },
      { name: "fee", type: "uint24" },
      { name: "quoteIsToken0", type: "bool" },
      { name: "oracleConfigId", type: "bytes32" },
    ],
  },
  { name: "sqrtPriceX96", type: "uint160" },
  { name: "existingPriceMinimumX96", type: "uint160" },
  { name: "existingPriceMaximumX96", type: "uint160" },
  { name: "tickLower", type: "int24" },
  { name: "tickUpper", type: "int24" },
  { name: "liquidity", type: "uint128" },
  { name: "amount0Maximum", type: "uint256" },
  { name: "amount1Maximum", type: "uint256" },
  { name: "deadline", type: "uint256" },
] as const;

export const abyssLaunchCoordinatorAbi = [
  {
    type: "constructor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "factory_", type: "address" },
      { name: "positionManager_", type: "address" },
      { name: "positionLocker_", type: "address" },
      { name: "tokenFactory_", type: "address" },
    ],
  },
  {
    type: "function",
    name: "factory",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "positionManager",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "positionLocker",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "tokenFactory",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "launches",
    stateMutability: "view",
    inputs: [{ name: "launchedToken", type: "address" }],
    outputs: [{ name: "result", type: "tuple", components: abyssLaunchResultComponents }],
  },
  {
    type: "function",
    name: "launch",
    stateMutability: "nonpayable",
    inputs: [{ name: "params", type: "tuple", components: abyssLaunchParamsComponents }],
    outputs: [{ name: "result", type: "tuple", components: abyssLaunchResultComponents }],
  },
  {
    type: "event",
    name: "LaunchCompleted",
    inputs: [
      { name: "launchedToken", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "pool", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: false },
      { name: "positionAccount", type: "address", indexed: false },
      { name: "feeRecipient", type: "address", indexed: false },
      { name: "amount0", type: "uint256", indexed: false },
      { name: "amount1", type: "uint256", indexed: false },
      { name: "created", type: "bool", indexed: false },
    ],
    anonymous: false,
  },
] as const;

export const dispositionComponents = [
  { name: "ownerBps", type: "uint16" },
  { name: "rewardsBps", type: "uint16" },
  { name: "burnBps", type: "uint16" },
] as const;

export const launchTemplateComponents = [
  { name: "tokenKindMask", type: "uint8" },
  { name: "poolProfileMask", type: "uint8" },
  { name: "rewardMode", type: "uint8" },
  { name: "feeAssetMode", type: "uint8" },
  { name: "rewardDuration", type: "uint32" },
  { name: "launchedTokenIsQuote", type: "bool" },
  { name: "launchedTokenDestinations", type: "uint8" },
  { name: "pairedTokenDestinations", type: "uint8" },
] as const;

const registryBytes32Getter = (name: string) =>
  ({
    type: "function",
    name,
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  }) as const;

const registryUint32Getter = (name: string) =>
  ({
    type: "function",
    name,
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint32" }],
  }) as const;

const registryUint8Getter = (name: string) =>
  ({
    type: "function",
    name,
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  }) as const;

export const launchTemplateRegistryAbi = [
  registryBytes32Getter("STANDARD_TEMPLATE_ID"),
  registryBytes32Getter("QUOTE_STAKING_TEMPLATE_ID"),
  registryBytes32Getter("QUOTE_DIVIDENDS_TEMPLATE_ID"),
  registryBytes32Getter("DUAL_STAKING_TEMPLATE_ID"),
  registryBytes32Getter("DUAL_DIVIDENDS_TEMPLATE_ID"),
  registryBytes32Getter("FEE_BURN_TEMPLATE_ID"),
  registryUint32Getter("INITIAL_VERSION"),
  registryUint32Getter("REWARD_DURATION"),
  registryUint8Getter("DESTINATION_OWNER"),
  registryUint8Getter("DESTINATION_REWARDS"),
  registryUint8Getter("DESTINATION_BURN"),
  registryUint8Getter("REWARD_MODE_NONE"),
  registryUint8Getter("REWARD_MODE_STAKING"),
  registryUint8Getter("REWARD_MODE_DIVIDENDS"),
  registryUint8Getter("FEE_ASSET_MODE_PROFILE"),
  registryUint8Getter("FEE_ASSET_MODE_PAIRED_ONLY"),
  registryUint8Getter("FEE_ASSET_MODE_BOTH"),
  registryUint8Getter("FEE_ASSET_MODE_LAUNCHED_ONLY"),
  {
    type: "function",
    name: "registrar",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "registerTemplate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "templateId", type: "bytes32" },
      { name: "version", type: "uint32" },
      { name: "config", type: "tuple", components: launchTemplateComponents },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "template",
    stateMutability: "view",
    inputs: [
      { name: "templateId", type: "bytes32" },
      { name: "version", type: "uint32" },
    ],
    outputs: [{ name: "config", type: "tuple", components: launchTemplateComponents }],
  },
  {
    type: "function",
    name: "isRegistered",
    stateMutability: "view",
    inputs: [
      { name: "templateId", type: "bytes32" },
      { name: "version", type: "uint32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "templateKey",
    stateMutability: "pure",
    inputs: [
      { name: "templateId", type: "bytes32" },
      { name: "version", type: "uint32" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "supportsTokenKind",
    stateMutability: "pure",
    inputs: [
      { name: "config", type: "tuple", components: launchTemplateComponents },
      { name: "kind", type: "uint8" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "supportsPoolProfile",
    stateMutability: "pure",
    inputs: [
      { name: "config", type: "tuple", components: launchTemplateComponents },
      { name: "profile", type: "uint8" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "supportsDispositions",
    stateMutability: "pure",
    inputs: [
      { name: "config", type: "tuple", components: launchTemplateComponents },
      { name: "profile", type: "uint8" },
      { name: "launchedTokenFees", type: "tuple", components: dispositionComponents },
      { name: "pairedTokenFees", type: "tuple", components: dispositionComponents },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "TemplateRegistered",
    inputs: [
      { name: "templateId", type: "bytes32", indexed: true },
      { name: "version", type: "uint32", indexed: true },
      { name: "config", type: "tuple", components: launchTemplateComponents, indexed: false },
    ],
    anonymous: false,
  },
  { type: "error", name: "InvalidTemplate", inputs: [] },
  { type: "error", name: "TemplateAlreadyRegistered", inputs: [] },
  { type: "error", name: "Unauthorized", inputs: [] },
] as const;

export const atomicTokenConfigComponents = [
  { name: "kind", type: "uint8" },
  { name: "name", type: "string" },
  { name: "symbol", type: "string" },
  { name: "decimals", type: "uint8" },
  { name: "supply", type: "uint256" },
] as const;

export const atomicPoolConfigComponents = [
  { name: "pairedToken", type: "address" },
  { name: "launchedTokenIsQuote", type: "bool" },
  { name: "profile", type: "uint8" },
  { name: "fee", type: "uint24" },
  { name: "oracleConfigId", type: "bytes32" },
  { name: "launchTick", type: "int24" },
  { name: "liquidity", type: "uint128" },
  { name: "launchedTokenAmountMaximum", type: "uint256" },
  { name: "pairedTokenAmountMaximum", type: "uint256" },
] as const;

export const atomicInitialBuyComponents = [
  { name: "pairedTokenAmountIn", type: "uint256" },
  { name: "launchedTokenAmountOutMinimum", type: "uint256" },
  { name: "sqrtPriceLimitX96", type: "uint160" },
] as const;


export const atomicLaunchRequestComponents = [
  { name: "creator", type: "address" },
  { name: "templateId", type: "bytes32" },
  { name: "templateVersion", type: "uint32" },
  { name: "token", type: "tuple", components: atomicTokenConfigComponents },
  { name: "pool", type: "tuple", components: atomicPoolConfigComponents },
  { name: "initialBuy", type: "tuple", components: atomicInitialBuyComponents },
  { name: "launchedTokenFees", type: "tuple", components: dispositionComponents },
  { name: "pairedTokenFees", type: "tuple", components: dispositionComponents },
  { name: "deadline", type: "uint256" },
] as const;

export const atomicLaunchReceiptComponents = [
  { name: "token", type: "address" },
  { name: "pool", type: "address" },
  { name: "tokenId", type: "uint256" },
  { name: "liquidityLaunchedTokenAmount", type: "uint256" },
  { name: "liquidityPairedTokenAmount", type: "uint256" },
  { name: "initialBuyPairedTokenAmount", type: "uint256" },
  { name: "initialBuyLaunchedTokenAmount", type: "uint256" },
  { name: "rewards", type: "address" },
  { name: "splitter", type: "address" },
  { name: "feeClaimer", type: "address" },
] as const;

const bytes32TemplateGetter = (name: string) =>
  ({
    type: "function",
    name,
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  }) as const;

const addressGetter = (name: string) =>
  ({
    type: "function",
    name,
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  }) as const;

const uint256Getter = (name: string) =>
  ({
    type: "function",
    name,
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  }) as const;

export const atomicLaunchFactoryAbi = [
  bytes32TemplateGetter("STANDARD_TEMPLATE_ID"),
  bytes32TemplateGetter("QUOTE_STAKING_TEMPLATE_ID"),
  bytes32TemplateGetter("QUOTE_DIVIDENDS_TEMPLATE_ID"),
  bytes32TemplateGetter("DUAL_STAKING_TEMPLATE_ID"),
  bytes32TemplateGetter("DUAL_DIVIDENDS_TEMPLATE_ID"),
  bytes32TemplateGetter("FEE_BURN_TEMPLATE_ID"),
  {
    type: "function",
    name: "INITIAL_TEMPLATE_VERSION",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint32" }],
  },
  addressGetter("abyssFactory"),
  addressGetter("coordinator"),
  addressGetter("feeOwnerRegistry"),
  uint256Getter("launchFee"),
  addressGetter("launchFeeRecipient"),
  addressGetter("moduleFactory"),
  addressGetter("positionLocker"),
  addressGetter("router"),
  addressGetter("templateRegistry"),
  addressGetter("tokenFactory"),
  addressGetter("wrappedNative"),
  {
    type: "function",
    name: "deployAndLaunch",
    stateMutability: "payable",
    inputs: [{ name: "request", type: "tuple", components: atomicLaunchRequestComponents }],
    outputs: [{ name: "receipt", type: "tuple", components: atomicLaunchReceiptComponents }],
  },
  {
    type: "event",
    name: "AtomicLaunchCompleted",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "pool", type: "address", indexed: true },
      { name: "templateId", type: "bytes32", indexed: false },
      { name: "templateVersion", type: "uint32", indexed: false },
      { name: "tokenId", type: "uint256", indexed: false },
      { name: "liquidityLaunchedTokenAmount", type: "uint256", indexed: false },
      { name: "liquidityPairedTokenAmount", type: "uint256", indexed: false },
      { name: "initialBuyPairedTokenAmount", type: "uint256", indexed: false },
      { name: "initialBuyLaunchedTokenAmount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "LaunchFeePaid",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "payer", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "LaunchModulesDeployed",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "rewards", type: "address", indexed: false },
      { name: "splitter", type: "address", indexed: false },
      { name: "feeClaimer", type: "address", indexed: false },
    ],
    anonymous: false,
  },
  { type: "error", name: "ApprovalMismatch", inputs: [] },
  { type: "error", name: "ApproveFailed", inputs: [] },
  { type: "error", name: "ExistingPool", inputs: [] },
  { type: "error", name: "InexactTransfer", inputs: [] },
  { type: "error", name: "InvalidBinding", inputs: [] },
  { type: "error", name: "InvalidConfiguration", inputs: [] },
  { type: "error", name: "InvalidSwapResult", inputs: [] },
  { type: "error", name: "Reentrancy", inputs: [] },
  { type: "error", name: "TransferFailed", inputs: [] },
  { type: "error", name: "TransferFromFailed", inputs: [] },
  { type: "error", name: "UnsupportedTemplate", inputs: [] },
  {
    type: "error",
    name: "IncorrectLaunchFee",
    inputs: [
      { name: "provided", type: "uint256" },
      { name: "required", type: "uint256" },
    ],
  },
  { type: "error", name: "LaunchFeePaymentFailed", inputs: [] },
] as const;
// StreamedRewards.sol:90,95,104,113,45,40-41,118,123,26 — the shared reward surface inherited
// by StakingRewardVault and HolderDividendTracker. Tuple components mirror the RewardData
// struct fields (StreamedRewards.sol:29-38); note the two `earned` overloads.
const streamedRewardsAbi = [
  {
    type: "function",
    name: "REWARDS_DURATION",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "claimFor",
    stateMutability: "nonpayable",
    inputs: [{ name: "beneficiary", type: "address" }],
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "earned",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "earned",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "rewardToken", type: "address" },
    ],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "function",
    name: "lastTimeRewardApplicable",
    stateMutability: "view",
    inputs: [{ name: "rewardToken", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "rewardData",
    stateMutability: "view",
    inputs: [{ name: "rewardToken", type: "address" }],
    outputs: [
      { name: "periodFinish", type: "uint256" },
      { name: "rewardRate", type: "uint256" },
      { name: "lastUpdateTime", type: "uint256" },
      { name: "rewardPerTokenStored", type: "uint256" },
      { name: "rewardPerTokenRemainder", type: "uint256" },
      { name: "remainingRewards", type: "uint256" },
      { name: "queuedRewards", type: "uint256" },
      { name: "accountedBalance", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "rewardPerToken",
    stateMutability: "view",
    inputs: [{ name: "rewardToken", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "rewardToken0",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "rewardToken1",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "rewardsDistributor",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "RewardNotified",
    inputs: [
      { name: "rewardToken", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "totalScheduled", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RewardQueued",
    inputs: [
      { name: "rewardToken", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RewardPaid",
    inputs: [
      { name: "beneficiary", type: "address", indexed: true },
      { name: "rewardToken", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  { type: "error", name: "InexactTransfer", inputs: [] },
  { type: "error", name: "InvalidRewardTokens", inputs: [] },
  { type: "error", name: "NothingToClaim", inputs: [] },
  { type: "error", name: "RewardBalanceDeficit", inputs: [] },
  { type: "error", name: "Unauthorized", inputs: [] },
  { type: "error", name: "UnsupportedRewardToken", inputs: [] },
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "ZeroAmount", inputs: [] },
] as const;

// StakingRewardVault.sol:25,45,15-16,14,11-12 plus the full StreamedRewards surface.
export const stakingRewardVaultAbi = [
  ...streamedRewardsAbi,
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "function",
    name: "stake",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "stakingToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "event",
    name: "Staked",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Withdrawn",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  { type: "error", name: "InsufficientStake", inputs: [] },
] as const;

// HolderDividendTracker.sol:94,23,24,21,22,19 plus the full StreamedRewards surface.
export const holderDividendTrackerAbi = [
  ...streamedRewardsAbi,
  {
    type: "function",
    name: "eligibleBalanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "eligibleSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "isExcluded",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "excluded", type: "bool" }],
  },
  {
    type: "function",
    name: "protocolAdmin",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "trackedToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "AccountExcluded",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "initial", type: "bool", indexed: true },
    ],
    anonymous: false,
  },
] as const;

// HolderDividendToken.sol:26,21 on top of the burnable fixed-supply token surface.
export const holderDividendTokenAbi = [
  ...burnableFixedSupplyTokenAbi,
  {
    type: "function",
    name: "rewardTracker",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "RewardTrackerConfigured",
    inputs: [{ name: "tracker", type: "address", indexed: true }],
    anonymous: false,
  },
] as const;

// LaunchFeeSplitter.sol:120,181,56,91,95,47-49,53,54,52,33-43. Policy tuple components mirror
// the Disposition struct (contracts/src/interfaces/IAbyssLaunch.sol:23-27).
export const launchFeeSplitterAbi = [
  {
    type: "function",
    name: "claimableOwnerFees",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "token", type: "address" },
    ],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "function",
    name: "claimer",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "claimOwnerFees",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "recipient", type: "address" },
    ],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "function",
    name: "distribute",
    stateMutability: "nonpayable",
    inputs: [{ name: "token", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "launchToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "requiresRewards",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "rewards",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "token0",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "token0Policy",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "tuple", components: dispositionComponents }],
  },
  {
    type: "function",
    name: "token1",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "token1Policy",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "tuple", components: dispositionComponents }],
  },
  {
    type: "event",
    name: "Distributed",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "ownerAmount", type: "uint256", indexed: false },
      { name: "rewardsAmount", type: "uint256", indexed: false },
      { name: "burnAmount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "OwnerFeesClaimed",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  { type: "error", name: "InactivePolicy", inputs: [] },
  { type: "error", name: "InexactTransfer", inputs: [] },
  { type: "error", name: "InvalidBinding", inputs: [] },
  { type: "error", name: "InvalidRecipient", inputs: [] },
  { type: "error", name: "NothingToClaim", inputs: [] },
  { type: "error", name: "Unauthorized", inputs: [] },
  { type: "error", name: "UnsupportedToken", inputs: [] },
] as const;

// LockedFeeClaimer.sol:55,24-28,30 — the single atomic fee-moving transaction plus its
// immutable binding reads.
export const lockedFeeClaimerAbi = [
  {
    type: "function",
    name: "claimAndDistribute",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "positionLocker",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "splitter",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "token0",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "token1",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "tokenId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "ClaimedAndDistributed",
    inputs: [
      { name: "caller", type: "address", indexed: true },
      { name: "amount0", type: "uint256", indexed: false },
      { name: "amount1", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  { type: "error", name: "ClaimMismatch", inputs: [] },
  { type: "error", name: "InexactTransfer", inputs: [] },
  { type: "error", name: "InvalidBinding", inputs: [] },
  { type: "error", name: "InvalidLock", inputs: [] },
] as const;

// LaunchFeeOwnerRegistry.sol:27-28 — fee-owner identity and bound splitter per launch token.
export const launchFeeOwnerRegistryAbi = [
  {
    type: "function",
    name: "feeOwner",
    stateMutability: "view",
    inputs: [{ name: "launch", type: "address" }],
    outputs: [{ name: "owner", type: "address" }],
  },
  {
    type: "function",
    name: "feeSplitter",
    stateMutability: "view",
    inputs: [{ name: "launch", type: "address" }],
    outputs: [{ name: "splitter", type: "address" }],
  },
] as const;
