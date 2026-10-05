import type { Address, Chain } from "viem";
import { defineChain } from "viem";
import { foundry } from "viem/chains";

export type SupportedChainId = 31337 | 4663 | 46631;

export type AbyssInfrastructureAddresses = {
  abyssFactory: Address;
  abyssFeeVault: Address;
  abyssPoolDeployer: Address;
  abyssRouter: Address;
  abyssQuoter: Address;
  abyssPositionManager: Address;
  abyssPositionLocker: Address;
  abyssToken: Address;
  abyssBuybackBurnerImplementation: Address;
  abyssBuybackBurner: Address;
  abyssFeeRouterImplementation: Address;
  abyssFeeRouter: Address;
};

export type LaunchApplicationAddresses = {
  /** Mined mainnet deployment; local chains require explicit environment configuration. */
  launchOrchestrator: Address;
  launchImplementationRegistry: Address;
  launchFeeOwnerRegistry: Address;
};

export type ProtocolAddresses = AbyssInfrastructureAddresses &
  LaunchApplicationAddresses & {
    lendingPool: Address;
    addressesProvider: Address;
    dataProvider: Address;
    uiPoolDataProvider: Address;
    walletBalanceProvider: Address;
    aaveOracle: Address;
    liquidationExecutor: Address;
    protocolVault: Address;
    ethUsdFeed: Address;
    weth: Address;
    wethGateway: Address;
    lens: Address;
    tokenVesting: Address;
    faucet: Address;
  };

const zero = "0x0000000000000000000000000000000000000000" as Address;

function readEnv(...keys: string[]): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return undefined;
}

const rpcUrl = readEnv("VITE_RPC_URL", "NEXT_PUBLIC_RPC_URL", "RPC_URL") ?? "http://127.0.0.1:8545";

/** Local Anvil (DeployLocal / plain forge). */
export const anvilLocal = foundry;

/** Robinhood-mainnet fork workbench (contracts/script/workbench.sh). */
export const workbenchChain = defineChain({
  id: 46631,
  name: "Black Market Workbench",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [rpcUrl] },
  },
  testnet: true,
});

/** Canonical Robinhood Chain mainnet. */
export const robinhoodMainnet = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.chain.robinhood.com/"] },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Chain Explorer",
      url: "https://robinhoodchain.blockscout.com",
    },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
});

function envAddr(keys: string[], fallback: Address = zero): Address {
  return (readEnv(...keys) as Address | undefined) ?? fallback;
}

function abyssInfrastructureFromEnv(
  fallback: AbyssInfrastructureAddresses,
): AbyssInfrastructureAddresses {
  const address = (name: string, defaultAddress: Address) =>
    envAddr([name, `VITE_${name}`, `NEXT_PUBLIC_${name}`], defaultAddress);

  return {
    abyssFactory: address("ABYSS_FACTORY", fallback.abyssFactory),
    abyssFeeVault: address("ABYSS_FEE_VAULT", fallback.abyssFeeVault),
    abyssPoolDeployer: address("ABYSS_POOL_DEPLOYER", fallback.abyssPoolDeployer),
    abyssRouter: address("ABYSS_ROUTER", fallback.abyssRouter),
    abyssQuoter: address("ABYSS_QUOTER", fallback.abyssQuoter),
    abyssPositionManager: address("ABYSS_POSITION_MANAGER", fallback.abyssPositionManager),
    abyssPositionLocker: address("ABYSS_POSITION_LOCKER", fallback.abyssPositionLocker),
    abyssToken: address("ABYSS_TOKEN", fallback.abyssToken),
    abyssBuybackBurnerImplementation: address(
      "ABYSS_BUYBACK_BURNER_IMPLEMENTATION",
      fallback.abyssBuybackBurnerImplementation,
    ),
    abyssBuybackBurner: address("ABYSS_BUYBACK_BURNER", fallback.abyssBuybackBurner),
    abyssFeeRouterImplementation: address(
      "ABYSS_FEE_ROUTER_IMPLEMENTATION",
      fallback.abyssFeeRouterImplementation,
    ),
    abyssFeeRouter: address("ABYSS_FEE_ROUTER", fallback.abyssFeeRouter),
  };
}

function launchApplicationFromEnv(
  fallback: LaunchApplicationAddresses,
): LaunchApplicationAddresses {
  const address = (name: string, defaultAddress: Address) =>
    envAddr([name, `VITE_${name}`, `NEXT_PUBLIC_${name}`], defaultAddress);

  return {
    launchOrchestrator: address("LAUNCH_ORCHESTRATOR", fallback.launchOrchestrator),
    launchImplementationRegistry: address("LAUNCH_IMPLEMENTATION_REGISTRY", fallback.launchImplementationRegistry),
    launchFeeOwnerRegistry: address("LAUNCH_FEE_OWNER_REGISTRY", fallback.launchFeeOwnerRegistry),
  };
}

const ROBINHOOD_WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" as Address;
const ROBINHOOD_ETH_USD = "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9" as Address;

const zeroAbyssInfrastructure: AbyssInfrastructureAddresses = {
  abyssFactory: zero,
  abyssFeeVault: zero,
  abyssPoolDeployer: zero,
  abyssRouter: zero,
  abyssQuoter: zero,
  abyssPositionManager: zero,
  abyssPositionLocker: zero,
  abyssToken: zero,
  abyssBuybackBurnerImplementation: zero,
  abyssBuybackBurner: zero,
  abyssFeeRouterImplementation: zero,
  abyssFeeRouter: zero,
};

const zeroLaunchApplication: LaunchApplicationAddresses = {
  launchOrchestrator: zero,
  launchImplementationRegistry: zero,
  launchFeeOwnerRegistry: zero,
};

/** Canonical replacement: abyss/deployments/4663/abyss-canonical-replacement-20260830/deployment.json. */
export const robinhoodAbyssInfrastructure: AbyssInfrastructureAddresses = {
  abyssFactory: "0xe7feF2BC860B25bbdEB6F6AB96d88bAAa77ddad7",
  abyssFeeVault: "0x19b04F2E86fFDf26510ACf25344c406240214d5F",
  abyssPoolDeployer: "0xe49Ff46f2Ca543D5504cDCF533fe84e0c95eF693",
  abyssRouter: "0xF7818c69e31bf98eFF96C721B557Bb519659CD27",
  abyssQuoter: "0xF1ff7c78605939df2d705F3E12Ac9CEB69Bcfe76",
  abyssPositionManager: "0x1b2176d4D2C7bd36227D92Ed84F1A3aE30B635bF",
  abyssPositionLocker: "0xa0d4fA31740FA0d8fc6b5b4173Da17864Eb6e888",
  abyssToken: "0x15f3385625D7e364C5a6216FBbceadf10fa90e7d",
  abyssBuybackBurnerImplementation: "0xd17F05C41FfdebB6b57b3e232c20a340906A0aAd",
  abyssBuybackBurner: "0xF6C7159e967f28C65d9Fb5b919567E04540cD2FF",
  abyssFeeRouterImplementation: "0xB35b85db23fEF3A146Fbd755D76be12F9e1eBfFC",
  abyssFeeRouter: "0x2c3B1b6fe0EDa8e10C0445567b47e66E825B34cd",
};

/** Mined pool-launch-v1 deployment, 20261005T053747Z-b5a7b88 (manifest.json). */
export const robinhoodLaunchApplication: LaunchApplicationAddresses = {
  launchOrchestrator: "0xb75CBD17b9aecb7305B4DFcDa69595F783341c0E",
  launchImplementationRegistry: "0xaa8a410709B79cBA6F118F1be1FF568877A3B8Ee",
  launchFeeOwnerRegistry: "0x15778Aad08e12D458B2848F035860e2a8c2a0725",
};


/** Robinhood-mainnet fork lending defaults; launch deployment remains explicit. */
const workbenchDefaults: ProtocolAddresses = {
  ...robinhoodAbyssInfrastructure,
  ...launchApplicationFromEnv(zeroLaunchApplication),
  lendingPool: "0x5D8878b145904425C598f12EB8eD550985369a82",
  addressesProvider: "0x892faB533E8D04135D902F94974e45dB48C17697",
  dataProvider: "0x1f3faA42C1D5cC330f6BD0242B9a56d611bdC78a",
  uiPoolDataProvider: zero,
  walletBalanceProvider: zero,
  aaveOracle: "0x6837B3cF5d959d01e07bf6DaB53f562877BF7d53",
  liquidationExecutor: zero,
  protocolVault: "0x83Ec5DbFEd6d972be89df88d3654EA2c70Fa2FB3",
  ethUsdFeed: ROBINHOOD_ETH_USD,
  weth: ROBINHOOD_WETH,
  wethGateway: zero,
  lens: zero,
  tokenVesting: zero,
  faucet: zero,
};

export const addresses: Record<SupportedChainId, ProtocolAddresses> = {
  31337: {
    ...abyssInfrastructureFromEnv(zeroAbyssInfrastructure),
    ...launchApplicationFromEnv(zeroLaunchApplication),
    lendingPool: envAddr(["LENDING_POOL", "VITE_LENDING_POOL", "NEXT_PUBLIC_LENDING_POOL"]),
    addressesProvider: envAddr([
      "ADDRESSES_PROVIDER",
      "VITE_ADDRESSES_PROVIDER",
      "NEXT_PUBLIC_ADDRESSES_PROVIDER",
    ]),
    dataProvider: envAddr(["DATA_PROVIDER", "VITE_DATA_PROVIDER", "NEXT_PUBLIC_DATA_PROVIDER"]),
    uiPoolDataProvider: envAddr([
      "UI_POOL_DATA_PROVIDER",
      "VITE_UI_POOL_DATA_PROVIDER",
      "NEXT_PUBLIC_UI_POOL_DATA_PROVIDER",
    ]),
    walletBalanceProvider: envAddr([
      "WALLET_BALANCE_PROVIDER",
      "VITE_WALLET_BALANCE_PROVIDER",
      "NEXT_PUBLIC_WALLET_BALANCE_PROVIDER",
    ]),
    aaveOracle: envAddr(["AAVE_ORACLE", "VITE_AAVE_ORACLE", "NEXT_PUBLIC_AAVE_ORACLE"]),
    liquidationExecutor: envAddr([
      "LIQUIDATION_EXECUTOR",
      "VITE_LIQUIDATION_EXECUTOR",
      "NEXT_PUBLIC_LIQUIDATION_EXECUTOR",
    ]),
    protocolVault: envAddr(["PROTOCOL_VAULT", "VITE_PROTOCOL_VAULT", "NEXT_PUBLIC_PROTOCOL_VAULT"]),
    ethUsdFeed: envAddr(["ETH_USD_FEED", "VITE_ETH_USD_FEED", "NEXT_PUBLIC_ETH_USD_FEED"]),
    weth: envAddr(["WETH", "VITE_WETH", "NEXT_PUBLIC_WETH"]),
    wethGateway: envAddr(["WETH_GATEWAY", "VITE_WETH_GATEWAY", "NEXT_PUBLIC_WETH_GATEWAY"]),
    lens: envAddr(["LENS", "VITE_LENS", "NEXT_PUBLIC_LENS"]),
    tokenVesting: envAddr(["TOKEN_VESTING", "VITE_TOKEN_VESTING", "NEXT_PUBLIC_TOKEN_VESTING"]),
    faucet: envAddr(["FAUCET", "VITE_FAUCET", "NEXT_PUBLIC_FAUCET"]),
  },
  /** Current mined launch, canonical Abyss, and replacement lending infrastructure. */
  4663: {
    ...robinhoodAbyssInfrastructure,
    ...launchApplicationFromEnv(robinhoodLaunchApplication),
    lendingPool: "0x5D8878b145904425C598f12EB8eD550985369a82",
    addressesProvider: "0x892faB533E8D04135D902F94974e45dB48C17697",
    dataProvider: "0x1f3faA42C1D5cC330f6BD0242B9a56d611bdC78a",
    uiPoolDataProvider: "0x02D2CA3bBbBaBD3C25bEDD4bE0eE6E5885C4D152",
    walletBalanceProvider: "0xBbb5D81123C3d514456974e9Fe6C7C8d7a0E4E2A",
    aaveOracle: "0x6837B3cF5d959d01e07bf6DaB53f562877BF7d53",
    liquidationExecutor: envAddr([
      "LIQUIDATION_EXECUTOR",
      "VITE_LIQUIDATION_EXECUTOR",
      "NEXT_PUBLIC_LIQUIDATION_EXECUTOR",
    ]),
    protocolVault: "0x83Ec5DbFEd6d972be89df88d3654EA2c70Fa2FB3",
    ethUsdFeed: ROBINHOOD_ETH_USD,
    weth: ROBINHOOD_WETH,
    wethGateway: "0xa16aB7646267327cB26dD3533526309cDe676d9d",
    lens: "0xB56079f966597CB9edaE27c589F8190f4dCD12df",
    tokenVesting: zero,
    faucet: zero,
  },
  46631: {
    ...workbenchDefaults,
    ...abyssInfrastructureFromEnv(robinhoodAbyssInfrastructure),
    ...launchApplicationFromEnv(zeroLaunchApplication),
    lendingPool: envAddr(
      ["VITE_LENDING_POOL", "NEXT_PUBLIC_LENDING_POOL"],
      workbenchDefaults.lendingPool,
    ),
    addressesProvider: envAddr(
      ["VITE_ADDRESSES_PROVIDER", "NEXT_PUBLIC_ADDRESSES_PROVIDER"],
      workbenchDefaults.addressesProvider,
    ),
    dataProvider: envAddr(
      ["VITE_DATA_PROVIDER", "NEXT_PUBLIC_DATA_PROVIDER"],
      workbenchDefaults.dataProvider,
    ),
    uiPoolDataProvider: envAddr(
      ["VITE_UI_POOL_DATA_PROVIDER", "NEXT_PUBLIC_UI_POOL_DATA_PROVIDER"],
      workbenchDefaults.uiPoolDataProvider,
    ),
    walletBalanceProvider: envAddr(
      ["VITE_WALLET_BALANCE_PROVIDER", "NEXT_PUBLIC_WALLET_BALANCE_PROVIDER"],
      workbenchDefaults.walletBalanceProvider,
    ),
    aaveOracle: envAddr(
      ["VITE_AAVE_ORACLE", "NEXT_PUBLIC_AAVE_ORACLE"],
      workbenchDefaults.aaveOracle,
    ),
    liquidationExecutor: envAddr(
      ["LIQUIDATION_EXECUTOR", "VITE_LIQUIDATION_EXECUTOR", "NEXT_PUBLIC_LIQUIDATION_EXECUTOR"],
      workbenchDefaults.liquidationExecutor,
    ),
    protocolVault: envAddr(
      ["VITE_PROTOCOL_VAULT", "NEXT_PUBLIC_PROTOCOL_VAULT"],
      workbenchDefaults.protocolVault,
    ),
    ethUsdFeed: envAddr(
      ["VITE_ETH_USD_FEED", "NEXT_PUBLIC_ETH_USD_FEED"],
      workbenchDefaults.ethUsdFeed,
    ),
    weth: envAddr(["VITE_WETH", "NEXT_PUBLIC_WETH"], workbenchDefaults.weth),
    wethGateway: envAddr(
      ["VITE_WETH_GATEWAY", "NEXT_PUBLIC_WETH_GATEWAY"],
      workbenchDefaults.wethGateway,
    ),
    lens: envAddr(["VITE_LENS", "NEXT_PUBLIC_LENS"], workbenchDefaults.lens),
    tokenVesting: envAddr(
      ["VITE_TOKEN_VESTING", "NEXT_PUBLIC_TOKEN_VESTING"],
      workbenchDefaults.tokenVesting,
    ),
    faucet: envAddr(["VITE_FAUCET", "NEXT_PUBLIC_FAUCET"], workbenchDefaults.faucet),
  },
};

export const chains: Record<SupportedChainId, Chain> = {
  31337: anvilLocal,
  4663: robinhoodMainnet,
  46631: workbenchChain,
};

export function getAddresses(chainId: SupportedChainId = 46631): ProtocolAddresses {
  return addresses[chainId];
}

export function isSupportedChainId(id: number): id is SupportedChainId {
  return id === 31337 || id === 4663 || id === 46631;
}
