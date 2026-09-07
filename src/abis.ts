// Auto-trimmed from forge artifacts for the Black Market web app.
export const lendingPoolAbi = [
  {
    type: "function",
    name: "borrow",
    inputs: [
      {
        name: "asset",
        type: "address",
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "interestRateMode",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "referralCode",
        type: "uint16",
        internalType: "uint16",
      },
      {
        name: "onBehalfOf",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "deposit",
    inputs: [
      {
        name: "asset",
        type: "address",
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "onBehalfOf",
        type: "address",
        internalType: "address",
      },
      {
        name: "referralCode",
        type: "uint16",
        internalType: "uint16",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getReserveData",
    inputs: [
      {
        name: "asset",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct DataTypes.ReserveData",
        components: [
          {
            name: "configuration",
            type: "tuple",
            internalType: "struct DataTypes.ReserveConfigurationMap",
            components: [
              {
                name: "data",
                type: "uint256",
                internalType: "uint256",
              },
            ],
          },
          {
            name: "liquidityIndex",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "variableBorrowIndex",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "currentLiquidityRate",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "currentVariableBorrowRate",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "currentStableBorrowRate",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "lastUpdateTimestamp",
            type: "uint40",
            internalType: "uint40",
          },
          {
            name: "aTokenAddress",
            type: "address",
            internalType: "address",
          },
          {
            name: "stableDebtTokenAddress",
            type: "address",
            internalType: "address",
          },
          {
            name: "variableDebtTokenAddress",
            type: "address",
            internalType: "address",
          },
          {
            name: "interestRateStrategyAddress",
            type: "address",
            internalType: "address",
          },
          {
            name: "id",
            type: "uint8",
            internalType: "uint8",
          },
          {
            name: "isolationModeTotalDebt",
            type: "uint128",
            internalType: "uint128",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getReservesList",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address[]",
        internalType: "address[]",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getUserAccountData",
    inputs: [
      {
        name: "user",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "totalCollateralETH",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "totalDebtETH",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "availableBorrowsETH",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "currentLiquidationThreshold",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "ltv",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "healthFactor",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "liquidationCall",
    inputs: [
      {
        name: "collateralAsset",
        type: "address",
        internalType: "address",
      },
      {
        name: "debtAsset",
        type: "address",
        internalType: "address",
      },
      {
        name: "user",
        type: "address",
        internalType: "address",
      },
      {
        name: "debtToCover",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "receiveAToken",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "paused",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "repay",
    inputs: [
      {
        name: "asset",
        type: "address",
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "rateMode",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "onBehalfOf",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setUserUseReserveAsCollateral",
    inputs: [
      {
        name: "asset",
        type: "address",
        internalType: "address",
      },
      {
        name: "useAsCollateral",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "swapBorrowRateMode",
    inputs: [
      {
        name: "asset",
        type: "address",
        internalType: "address",
      },
      {
        name: "rateMode",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdraw",
    inputs: [
      {
        name: "asset",
        type: "address",
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "to",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "Borrow",
    inputs: [
      {
        name: "reserve",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "user",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "onBehalfOf",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "borrowRateMode",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "borrowRate",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "referral",
        type: "uint16",
        indexed: true,
        internalType: "uint16",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Deposit",
    inputs: [
      {
        name: "reserve",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "user",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "onBehalfOf",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "referral",
        type: "uint16",
        indexed: true,
        internalType: "uint16",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "LiquidationCall",
    inputs: [
      {
        name: "collateralAsset",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "debtAsset",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "user",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "debtToCover",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "liquidatedCollateralAmount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "liquidator",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "receiveAToken",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Repay",
    inputs: [
      {
        name: "reserve",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "user",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "repayer",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ReserveUsedAsCollateralDisabled",
    inputs: [
      {
        name: "reserve",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "user",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ReserveUsedAsCollateralEnabled",
    inputs: [
      {
        name: "reserve",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "user",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Withdraw",
    inputs: [
      {
        name: "reserve",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "user",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "to",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
] as const;

export const protocolDataProviderAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "addressesProvider",
        type: "address",
        internalType: "contract ILendingPoolAddressesProvider",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "ADDRESSES_PROVIDER",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract ILendingPoolAddressesProvider",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAllATokens",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        internalType: "struct AaveProtocolDataProvider.TokenData[]",
        components: [
          {
            name: "symbol",
            type: "string",
            internalType: "string",
          },
          {
            name: "tokenAddress",
            type: "address",
            internalType: "address",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAllReservesTokens",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        internalType: "struct AaveProtocolDataProvider.TokenData[]",
        components: [
          {
            name: "symbol",
            type: "string",
            internalType: "string",
          },
          {
            name: "tokenAddress",
            type: "address",
            internalType: "address",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getReserveConfigurationData",
    inputs: [
      {
        name: "asset",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "decimals",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "ltv",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "liquidationThreshold",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "liquidationBonus",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "reserveFactor",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "usageAsCollateralEnabled",
        type: "bool",
        internalType: "bool",
      },
      {
        name: "borrowingEnabled",
        type: "bool",
        internalType: "bool",
      },
      {
        name: "stableBorrowRateEnabled",
        type: "bool",
        internalType: "bool",
      },
      {
        name: "isActive",
        type: "bool",
        internalType: "bool",
      },
      {
        name: "isFrozen",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getReserveData",
    inputs: [
      {
        name: "asset",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "availableLiquidity",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "totalStableDebt",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "totalVariableDebt",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "liquidityRate",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "variableBorrowRate",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "stableBorrowRate",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "averageStableBorrowRate",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "liquidityIndex",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "variableBorrowIndex",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "lastUpdateTimestamp",
        type: "uint40",
        internalType: "uint40",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getReserveTokensAddresses",
    inputs: [
      {
        name: "asset",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "aTokenAddress",
        type: "address",
        internalType: "address",
      },
      {
        name: "stableDebtTokenAddress",
        type: "address",
        internalType: "address",
      },
      {
        name: "variableDebtTokenAddress",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getUserReserveData",
    inputs: [
      {
        name: "asset",
        type: "address",
        internalType: "address",
      },
      {
        name: "user",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "currentATokenBalance",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "currentStableDebt",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "currentVariableDebt",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "principalStableDebt",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "scaledVariableDebt",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "stableBorrowRate",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "liquidityRate",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "stableRateLastUpdated",
        type: "uint40",
        internalType: "uint40",
      },
      {
        name: "usageAsCollateralEnabled",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getReserveCaps",
    inputs: [
      {
        name: "asset",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "supplyCap",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "borrowCap",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "spender",
        type: "address",
      },
      {
        name: "amount",
        type: "uint256",
      },
    ],
    outputs: [
      {
        type: "bool",
      },
    ],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      {
        name: "owner",
        type: "address",
      },
      {
        name: "spender",
        type: "address",
      },
    ],
    outputs: [
      {
        type: "uint256",
      },
    ],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      {
        name: "account",
        type: "address",
      },
    ],
    outputs: [
      {
        type: "uint256",
      },
    ],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "uint8",
      },
    ],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "string",
      },
    ],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "string",
      },
    ],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "uint256",
      },
    ],
  },
] as const;

export const aggregatorV3Abi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "uint8",
      },
    ],
  },
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "roundId",
        type: "uint80",
      },
      {
        name: "answer",
        type: "int256",
      },
      {
        name: "startedAt",
        type: "uint256",
      },
      {
        name: "updatedAt",
        type: "uint256",
      },
      {
        name: "answeredInRound",
        type: "uint80",
      },
    ],
  },
  {
    type: "function",
    name: "setAnswer",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "newAnswer",
        type: "int256",
      },
    ],
    outputs: [],
  },
] as const;

export const wethGatewayAbi = [
  {
    type: "function",
    name: "depositETH",
    stateMutability: "payable",
    inputs: [
      { name: "lendingPool", type: "address" },
      { name: "onBehalfOf", type: "address" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdrawETH",
    stateMutability: "nonpayable",
    inputs: [
      { name: "lendingPool", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "repayETH",
    stateMutability: "payable",
    inputs: [
      { name: "lendingPool", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "rateMode", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "borrowETH",
    stateMutability: "nonpayable",
    inputs: [
      { name: "lendingPool", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "interesRateMode", type: "uint256" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getWETHAddress",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export const creditDelegationAbi = [
  {
    type: "function",
    name: "approveDelegation",
    stateMutability: "nonpayable",
    inputs: [
      { name: "delegatee", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export const aaveOracleAbi = [
  {
    type: "function",
    name: "getAssetPrice",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getCollateralPrice",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getDebtPrice",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getAssetsPrices",
    stateMutability: "view",
    inputs: [{ name: "assets", type: "address[]" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "getSourceOfAsset",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const lensReserveComponents = [
  { name: "token", type: "address" },
  { name: "aToken", type: "address" },
  { name: "stableDebtToken", type: "address" },
  { name: "variableDebtToken", type: "address" },
  { name: "decimals", type: "uint256" },
  { name: "isActive", type: "bool" },
  { name: "isFrozen", type: "bool" },
  { name: "borrowingEnabled", type: "bool" },
  { name: "stableBorrowEnabled", type: "bool" },
  { name: "collateralEnabled", type: "bool" },
  { name: "ltvBps", type: "uint256" },
  { name: "liquidationThresholdBps", type: "uint256" },
  { name: "liquidationBonusBps", type: "uint256" },
  { name: "reserveFactorBps", type: "uint256" },
  { name: "priceUsd", type: "uint256" },
  { name: "liquidityRate", type: "uint256" },
  { name: "variableBorrowRate", type: "uint256" },
  { name: "availableLiquidity", type: "uint256" },
  { name: "totalStableDebt", type: "uint256" },
  { name: "totalVariableDebt", type: "uint256" },
  { name: "supplyCap", type: "uint256" },
  { name: "borrowCap", type: "uint256" },
  { name: "collateralPriceUsd", type: "uint256" },
  { name: "debtPriceUsd", type: "uint256" },
  { name: "isIsolated", type: "bool" },
  { name: "borrowableInIsolation", type: "bool" },
  { name: "debtCeiling", type: "uint256" },
  { name: "isolationModeTotalDebt", type: "uint256" },
] as const;

const lensPositionComponents = [
  { name: "token", type: "address" },
  { name: "supplied", type: "uint256" },
  { name: "borrowed", type: "uint256" },
  { name: "wallet", type: "uint256" },
  { name: "isCollateral", type: "bool" },
] as const;

export const blackMarketLensAbi = [
  {
    type: "function",
    name: "MAX_LIMIT",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "reserveCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "auctionCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "markets",
    stateMutability: "view",
    inputs: [
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [
      {
        name: "items",
        type: "tuple[]",
        components: [...lensReserveComponents],
      },
      { name: "total", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "market",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [...lensReserveComponents],
      },
    ],
  },
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [
      {
        name: "page",
        type: "tuple",
        components: [
          {
            name: "items",
            type: "tuple[]",
            components: [...lensPositionComponents],
          },
          { name: "total", type: "uint256" },
          { name: "totalCollateralWad", type: "uint256" },
          { name: "totalDebtWad", type: "uint256" },
          { name: "availableBorrowsWad", type: "uint256" },
          { name: "healthFactorWad", type: "uint256" },
          { name: "ltvBps", type: "uint256" },
          { name: "liquidationThresholdBps", type: "uint256" },
          { name: "nativeEth", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "snapshot",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          {
            name: "markets",
            type: "tuple[]",
            components: [...lensReserveComponents],
          },
          { name: "marketTotal", type: "uint256" },
          {
            name: "positions",
            type: "tuple[]",
            components: [...lensPositionComponents],
          },
          { name: "positionTotal", type: "uint256" },
          { name: "totalCollateralWad", type: "uint256" },
          { name: "totalDebtWad", type: "uint256" },
          { name: "availableBorrowsWad", type: "uint256" },
          { name: "healthFactorWad", type: "uint256" },
          { name: "ltvBps", type: "uint256" },
          { name: "liquidationThresholdBps", type: "uint256" },
          { name: "nativeEth", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export const uiPoolDataProviderAbi = [
  {
    type: "function",
    name: "MARKET_REFERENCE_CURRENCY_UNIT",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
  },
  {
    type: "function",
    name: "getReservesData",
    stateMutability: "view",
    inputs: [
      {
        name: "provider",
        type: "address",
        internalType: "contract ILendingPoolAddressesProvider",
      },
      { name: "user", type: "address", internalType: "address" },
    ],
    outputs: [
      {
        name: "reservesData",
        type: "tuple[]",
        internalType: "struct IUiPoolDataProvider.AggregatedReserveData[]",
        components: [
          { name: "underlyingAsset", type: "address" },
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "decimals", type: "uint256" },
          { name: "baseLTVasCollateral", type: "uint256" },
          { name: "reserveLiquidationThreshold", type: "uint256" },
          { name: "reserveLiquidationBonus", type: "uint256" },
          { name: "reserveFactor", type: "uint256" },
          { name: "usageAsCollateralEnabled", type: "bool" },
          { name: "borrowingEnabled", type: "bool" },
          { name: "stableBorrowRateEnabled", type: "bool" },
          { name: "isActive", type: "bool" },
          { name: "isFrozen", type: "bool" },
          { name: "liquidityIndex", type: "uint128" },
          { name: "variableBorrowIndex", type: "uint128" },
          { name: "liquidityRate", type: "uint128" },
          { name: "variableBorrowRate", type: "uint128" },
          { name: "stableBorrowRate", type: "uint128" },
          { name: "lastUpdateTimestamp", type: "uint40" },
          { name: "aTokenAddress", type: "address" },
          { name: "stableDebtTokenAddress", type: "address" },
          { name: "variableDebtTokenAddress", type: "address" },
          { name: "interestRateStrategyAddress", type: "address" },
          { name: "availableLiquidity", type: "uint256" },
          { name: "totalPrincipalStableDebt", type: "uint256" },
          { name: "averageStableRate", type: "uint256" },
          { name: "stableDebtLastUpdateTimestamp", type: "uint256" },
          { name: "totalScaledVariableDebt", type: "uint256" },
          { name: "priceInUsd", type: "uint256" },
          { name: "variableRateSlope1", type: "uint256" },
          { name: "variableRateSlope2", type: "uint256" },
          { name: "stableRateSlope1", type: "uint256" },
          { name: "stableRateSlope2", type: "uint256" },
          { name: "supplyCap", type: "uint256" },
          { name: "borrowCap", type: "uint256" },
        ],
      },
      {
        name: "userReservesData",
        type: "tuple[]",
        internalType: "struct IUiPoolDataProvider.UserReserveData[]",
        components: [
          { name: "underlyingAsset", type: "address" },
          { name: "scaledATokenBalance", type: "uint256" },
          { name: "usageAsCollateralEnabledOnUser", type: "bool" },
          { name: "stableBorrowRate", type: "uint256" },
          { name: "scaledVariableDebt", type: "uint256" },
          { name: "principalStableDebt", type: "uint256" },
          { name: "stableBorrowLastUpdateTimestamp", type: "uint256" },
        ],
      },
      { name: "marketReferenceCurrencyUnit", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getUserReservesData",
    stateMutability: "view",
    inputs: [
      {
        name: "provider",
        type: "address",
        internalType: "contract ILendingPoolAddressesProvider",
      },
      { name: "user", type: "address", internalType: "address" },
    ],
    outputs: [
      {
        name: "userReservesData",
        type: "tuple[]",
        internalType: "struct IUiPoolDataProvider.UserReserveData[]",
        components: [
          { name: "underlyingAsset", type: "address" },
          { name: "scaledATokenBalance", type: "uint256" },
          { name: "usageAsCollateralEnabledOnUser", type: "bool" },
          { name: "stableBorrowRate", type: "uint256" },
          { name: "scaledVariableDebt", type: "uint256" },
          { name: "principalStableDebt", type: "uint256" },
          { name: "stableBorrowLastUpdateTimestamp", type: "uint256" },
        ],
      },
    ],
  },
] as const;

export const walletBalanceProviderAbi = [
  {
    type: "function",
    name: "getUserWalletBalances",
    stateMutability: "view",
    inputs: [
      { name: "provider", type: "address" },
      { name: "user", type: "address" },
    ],
    outputs: [
      { name: "", type: "address[]" },
      { name: "", type: "uint256[]" },
    ],
  },
] as const;

export const priceFeedAbi = [
  {
    type: "function",
    name: "fetchPrice",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const chainedPriceFeedAbi = [
  {
    type: "function",
    name: "base",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "quoteUsd",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "fetchPrice",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "spotUsd",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "fetchCollateralPrice",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "fetchDebtPrice",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const vestingSchedule = {
  type: "tuple",
  components: [
    { name: "creator", type: "address" },
    { name: "beneficiary", type: "address" },
    { name: "token", type: "address" },
    { name: "cliffTime", type: "uint64" },
    { name: "endTime", type: "uint64" },
    { name: "cliffAmount", type: "uint256" },
    { name: "totalAmount", type: "uint256" },
    { name: "releasedAmount", type: "uint256" },
    { name: "claimedCliffAmount", type: "bool" },
  ],
} as const;

const vestingScheduleView = {
  type: "tuple",
  components: [
    { name: "id", type: "uint256" },
    { name: "creator", type: "address" },
    { name: "beneficiary", type: "address" },
    { name: "token", type: "address" },
    { name: "cliffTime", type: "uint64" },
    { name: "endTime", type: "uint64" },
    { name: "cliffAmount", type: "uint256" },
    { name: "totalAmount", type: "uint256" },
    { name: "releasedAmount", type: "uint256" },
    { name: "claimedCliffAmount", type: "bool" },
    { name: "claimable", type: "uint256" },
  ],
} as const;

export const tokenVestingAbi = [
  {
    type: "function",
    name: "createVestingSchedule",
    stateMutability: "nonpayable",
    inputs: [
      { name: "target", type: "address" },
      { name: "token", type: "address" },
      { name: "cliffTime", type: "uint256" },
      { name: "endTime", type: "uint256" },
      { name: "cliffAmount", type: "uint256" },
      { name: "totalAmount", type: "uint256" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function",
    name: "claimTokens",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getSchedule",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ ...vestingSchedule, name: "" }],
  },
  {
    type: "function",
    name: "claimable",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "function",
    name: "schedulesByBeneficiary",
    stateMutability: "view",
    inputs: [{ name: "beneficiary", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "schedulesByCreator",
    stateMutability: "view",
    inputs: [{ name: "creator", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "schedulesByToken",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "previewByIds",
    stateMutability: "view",
    inputs: [{ name: "ids", type: "uint256[]" }],
    outputs: [{ name: "rows", type: "tuple[]", components: vestingScheduleView.components }],
  },
  {
    type: "function",
    name: "previewByBeneficiary",
    stateMutability: "view",
    inputs: [{ name: "beneficiary", type: "address" }],
    outputs: [{ name: "", type: "tuple[]", components: vestingScheduleView.components }],
  },
  {
    type: "function",
    name: "previewByCreator",
    stateMutability: "view",
    inputs: [{ name: "creator", type: "address" }],
    outputs: [{ name: "", type: "tuple[]", components: vestingScheduleView.components }],
  },
  {
    type: "function",
    name: "previewByToken",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "tuple[]", components: vestingScheduleView.components }],
  },
  {
    type: "function",
    name: "lookup",
    stateMutability: "view",
    inputs: [
      { name: "wallet", type: "address" },
      { name: "token", type: "address" },
    ],
    outputs: [
      { name: "toWallet", type: "tuple[]", components: vestingScheduleView.components },
      { name: "fromWallet", type: "tuple[]", components: vestingScheduleView.components },
      { name: "ofToken", type: "tuple[]", components: vestingScheduleView.components },
    ],
  },
  {
    type: "function",
    name: "MAX_LOOKUP",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "nextScheduleId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "VestingScheduleCreated",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "target", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: false },
      { name: "cliffAmount", type: "uint256", indexed: false },
      { name: "totalAmount", type: "uint256", indexed: false },
      { name: "cliffTime", type: "uint64", indexed: false },
      { name: "endTime", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "VestingScheduleCompleted",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "target", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "totalAmount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TokensClaimed",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "target", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "claimedCliff", type: "bool", indexed: false },
    ],
  },
] as const;

export const workbenchFaucetAbi = [
  {
    type: "function",
    name: "drip",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "assets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "function",
    name: "assetCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "dripOf",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "Dripped",
    inputs: [{ name: "account", type: "address", indexed: true }],
  },
] as const;

const abyssPoolKeyComponents = [
  { internalType: "address", name: "token0", type: "address" },
  { internalType: "address", name: "token1", type: "address" },
  { internalType: "enum PoolProfile", name: "profile", type: "uint8" },
  { internalType: "uint24", name: "fee", type: "uint24" },
  { internalType: "bool", name: "quoteIsToken0", type: "bool" },
  { internalType: "bytes32", name: "oracleConfigId", type: "bytes32" },
] as const;

const abyssLiquidationRouteHopComponents = [
  {
    components: abyssPoolKeyComponents,
    internalType: "struct PoolKey",
    name: "key",
    type: "tuple",
  },
  { internalType: "bool", name: "zeroForOne", type: "bool" },
  { internalType: "uint160", name: "sqrtPriceLimitX96", type: "uint160" },
] as const;

const abyssLiquidationRequestComponents = [
  { internalType: "address", name: "borrower", type: "address" },
  { internalType: "address", name: "collateralAsset", type: "address" },
  { internalType: "address", name: "debtAsset", type: "address" },
  { internalType: "uint256", name: "debtToCover", type: "uint256" },
  { internalType: "uint256", name: "minimumProfit", type: "uint256" },
  { internalType: "uint256", name: "deadline", type: "uint256" },
] as const;

export const abyssLiquidationExecutorAbi = [
  {
    type: "constructor",
    inputs: [
      { internalType: "address", name: "lendingPool_", type: "address" },
      { internalType: "address", name: "abyssRouter_", type: "address" },
      { internalType: "address", name: "abyssFactory_", type: "address" },
      { internalType: "address", name: "owner_", type: "address" },
      { internalType: "address", name: "profitRecipient_", type: "address" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "executeLiquidation",
    inputs: [
      {
        components: abyssLiquidationRequestComponents,
        internalType: "struct AbyssLiquidationExecutor.LiquidationRequest",
        name: "request",
        type: "tuple",
      },
    ],
    outputs: [{ internalType: "uint256", name: "profit", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "executeOperation",
    inputs: [
      { internalType: "address[]", name: "assets", type: "address[]" },
      { internalType: "uint256[]", name: "amounts", type: "uint256[]" },
      { internalType: "uint256[]", name: "premiums", type: "uint256[]" },
      { internalType: "address", name: "initiator", type: "address" },
      { internalType: "bytes", name: "params", type: "bytes" },
    ],
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setOperator",
    inputs: [
      { internalType: "address", name: "operator", type: "address" },
      { internalType: "bool", name: "allowed", type: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setProfitRecipient",
    inputs: [{ internalType: "address", name: "profitRecipient_", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setRoute",
    inputs: [
      { internalType: "address", name: "collateralAsset", type: "address" },
      { internalType: "address", name: "debtAsset", type: "address" },
      {
        components: abyssLiquidationRouteHopComponents,
        internalType: "struct AbyssLiquidationExecutor.RouteHop[]",
        name: "hops",
        type: "tuple[]",
      },
      { internalType: "uint256", name: "minimumProfit", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "removeRoute",
    inputs: [
      { internalType: "address", name: "collateralAsset", type: "address" },
      { internalType: "address", name: "debtAsset", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "routeInfo",
    inputs: [
      { internalType: "address", name: "collateralAsset", type: "address" },
      { internalType: "address", name: "debtAsset", type: "address" },
    ],
    outputs: [
      { internalType: "bool", name: "enabled", type: "bool" },
      { internalType: "uint256", name: "minimumProfit", type: "uint256" },
      { internalType: "uint256", name: "hopCount", type: "uint256" },
      { internalType: "bytes32", name: "routeHash", type: "bytes32" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "routeHop",
    inputs: [
      { internalType: "address", name: "collateralAsset", type: "address" },
      { internalType: "address", name: "debtAsset", type: "address" },
      { internalType: "uint256", name: "index", type: "uint256" },
    ],
    outputs: [
      {
        components: abyssLiquidationRouteHopComponents,
        internalType: "struct AbyssLiquidationExecutor.RouteHop",
        name: "hop",
        type: "tuple",
      },
    ],
    stateMutability: "view",
  },
] as const;

