import type { Address, Hex } from "viem";

export enum AbyssPoolProfile {
  Standard,
  StandardOracle,
  Quote,
  QuoteOracle,
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

/** Wrapped-native funding primitive; the ERC20 surface is shared with the DEX. */
export const wethAbi = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
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
