import type { Address } from "viem";
import { RAY, rayAprToApyPercent } from "./format.js";

/** Native ETH sentinel used by `WalletBalanceProvider`. */
export const MOCK_ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as Address;

export const MARKET_REFERENCE_CURRENCY_UNIT = 10n ** 18n;

export function rayMul(a: bigint, b: bigint): bigint {
  return (a * b + RAY / 2n) / RAY;
}

export function usd18ToNumber(price: bigint): number {
  if (price === 0n) return 0;
  return Number(price) / 1e18;
}

export function tokensToNumber(amount: bigint, decimals: number): number {
  if (amount === 0n) return 0;
  return Number(amount) / 10 ** decimals;
}

export type CatalogReserveFields = {
  token: Address;
  decimals: number;
  priceUsd: number;
  supplyApy: number;
  variableBorrowApy: number;
  totalSupplyUsd: number;
  totalBorrowUsd: number;
  supplyCapUsd?: number;
  borrowCapUsd?: number;
  borrowingEnabled: boolean;
  stableBorrowEnabled: boolean;
  collateralEnabled: boolean;
  ltvBps: number;
  liquidationThresholdBps: number;
  liquidationBonusBps: number;
  reserveFactorBps: number;
};

export type LiveReserve = {
  token: Address;
  symbol: string;
  name: string;
  isActive: boolean;
  decimals: number;
  priceUsd: number;
  collateralPriceUsd?: number;
  debtPriceUsd?: number;
  supplyApy: number;
  variableBorrowApy: number;
  totalSupplyUsd: number;
  totalBorrowUsd: number;
  supplyCapUsd?: number;
  borrowCapUsd?: number;
  isFrozen?: boolean;
  isIsolated?: boolean;
  borrowableInIsolation?: boolean;
  debtCeilingUsd?: number;
  isolationModeTotalDebtUsd?: number;
  borrowingEnabled?: boolean;
  totalSupply: bigint;
  totalBorrow: bigint;
  supplyCap: bigint;
  borrowCap: bigint;
  stableBorrowEnabled?: boolean;
  collateralEnabled?: boolean;
  ltvBps?: number;
  liquidationThresholdBps?: number;
  liquidationBonusBps?: number;
  reserveFactorBps?: number;
  availableLiquidity: bigint;
  liquidityIndex: bigint;
  variableBorrowIndex: bigint;
  aToken?: Address;
  stableDebtToken?: Address;
  variableDebtToken?: Address;
};

export type LiveUserReserve = {
  token: Address;
  supplied: number;
  borrowed: number;
  isCollateral: boolean;
  suppliedRaw: bigint;
  borrowedRaw: bigint;
};

export type UiAggregatedReserve = {
  underlyingAsset: Address;
  name: string;
  symbol: string;
  decimals: bigint;
  baseLTVasCollateral: bigint;
  reserveLiquidationThreshold: bigint;
  reserveLiquidationBonus: bigint;
  reserveFactor: bigint;
  usageAsCollateralEnabled: boolean;
  borrowingEnabled: boolean;
  stableBorrowRateEnabled: boolean;
  isActive: boolean;
  isFrozen: boolean;
  liquidityIndex: bigint;
  variableBorrowIndex: bigint;
  liquidityRate: bigint;
  variableBorrowRate: bigint;
  availableLiquidity: bigint;
  totalPrincipalStableDebt: bigint;
  totalScaledVariableDebt: bigint;
  priceInUsd: bigint;
  supplyCap: bigint;
  borrowCap: bigint;
};

export type UiUserReserve = {
  underlyingAsset: Address;
  scaledATokenBalance: bigint;
  usageAsCollateralEnabledOnUser: boolean;
  scaledVariableDebt: bigint;
  principalStableDebt: bigint;
};

/** Index helper rows by underlying token. The pool reserve list is the listing set. */
export function indexByToken<T extends { token: Address }>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) map.set(row.token.toLowerCase(), row);
  return map;
}

export function liveReserveFromUi(row: UiAggregatedReserve): LiveReserve {
  const decimals = Number(row.decimals);
  const variableDebt = rayMul(row.totalScaledVariableDebt, row.variableBorrowIndex);
  const totalBorrow = row.totalPrincipalStableDebt + variableDebt;
  const totalSupply = row.availableLiquidity + totalBorrow;
  const priceUsd = usd18ToNumber(row.priceInUsd);
  return {
    token: row.underlyingAsset,
    symbol: row.symbol,
    name: row.name,
    isActive: row.isActive,
    decimals,
    priceUsd,
    supplyApy: rayAprToApyPercent(row.liquidityRate),
    variableBorrowApy: rayAprToApyPercent(row.variableBorrowRate),
    totalSupplyUsd: tokensToNumber(totalSupply, decimals) * priceUsd,
    totalBorrowUsd: tokensToNumber(totalBorrow, decimals) * priceUsd,
    supplyCapUsd: Number(row.supplyCap) * priceUsd,
    borrowCapUsd: Number(row.borrowCap) * priceUsd,
    totalSupply,
    totalBorrow,
    supplyCap: row.supplyCap,
    borrowCap: row.borrowCap,
    borrowingEnabled: row.borrowingEnabled && row.isActive && !row.isFrozen,
    stableBorrowEnabled: row.stableBorrowRateEnabled && row.isActive && !row.isFrozen,
    collateralEnabled: row.usageAsCollateralEnabled,
    ltvBps: Number(row.baseLTVasCollateral),
    liquidationThresholdBps: Number(row.reserveLiquidationThreshold),
    liquidationBonusBps: Number(row.reserveLiquidationBonus),
    reserveFactorBps: Number(row.reserveFactor),
    availableLiquidity: row.availableLiquidity,
    liquidityIndex: row.liquidityIndex,
    variableBorrowIndex: row.variableBorrowIndex,
  };
}

export function liveUserFromUi(user: UiUserReserve, reserve: LiveReserve): LiveUserReserve {
  const suppliedRaw = rayMul(user.scaledATokenBalance, reserve.liquidityIndex);
  const variableDebt = rayMul(user.scaledVariableDebt, reserve.variableBorrowIndex);
  const borrowedRaw = variableDebt + user.principalStableDebt;
  return {
    token: user.underlyingAsset,
    supplied: tokensToNumber(suppliedRaw, reserve.decimals),
    borrowed: tokensToNumber(borrowedRaw, reserve.decimals),
    isCollateral: user.usageAsCollateralEnabledOnUser,
    suppliedRaw,
    borrowedRaw,
  };
}

export type LensReserve = {
  token: Address;
  aToken: Address;
  stableDebtToken: Address;
  variableDebtToken: Address;
  decimals: bigint;
  isActive: boolean;
  isFrozen: boolean;
  borrowingEnabled: boolean;
  stableBorrowEnabled: boolean;
  collateralEnabled: boolean;
  ltvBps: bigint;
  liquidationThresholdBps: bigint;
  liquidationBonusBps: bigint;
  reserveFactorBps: bigint;
  priceUsd: bigint;
  collateralPriceUsd: bigint;
  debtPriceUsd: bigint;
  isIsolated: boolean;
  borrowableInIsolation: boolean;
  debtCeiling: bigint;
  isolationModeTotalDebt: bigint;
  liquidityRate: bigint;
  variableBorrowRate: bigint;
  availableLiquidity: bigint;
  totalStableDebt: bigint;
  totalVariableDebt: bigint;
  supplyCap: bigint;
  borrowCap: bigint;
};

export type LensPosition = {
  token: Address;
  supplied: bigint;
  borrowed: bigint;
  wallet: bigint;
  isCollateral: boolean;
};

export function liveReserveFromLens(row: LensReserve): LiveReserve {
  const decimals = Number(row.decimals);
  const totalBorrow = row.totalStableDebt + row.totalVariableDebt;
  const totalSupply = row.availableLiquidity + totalBorrow;
  const priceUsd = usd18ToNumber(row.priceUsd);
  return {
    token: row.token,
    symbol: "",
    name: "",
    isActive: row.isActive,
    decimals,
    priceUsd,
    collateralPriceUsd: usd18ToNumber(row.collateralPriceUsd),
    debtPriceUsd: usd18ToNumber(row.debtPriceUsd),
    supplyApy: rayAprToApyPercent(row.liquidityRate),
    variableBorrowApy: rayAprToApyPercent(row.variableBorrowRate),
    totalSupplyUsd: tokensToNumber(totalSupply, decimals) * priceUsd,
    totalBorrowUsd: tokensToNumber(totalBorrow, decimals) * priceUsd,
    supplyCapUsd: Number(row.supplyCap) * priceUsd,
    borrowCapUsd: Number(row.borrowCap) * priceUsd,
    isFrozen: row.isFrozen,
    isIsolated: row.isIsolated,
    borrowableInIsolation: row.borrowableInIsolation,
    debtCeilingUsd: Number(row.debtCeiling),
    totalSupply,
    totalBorrow,
    supplyCap: row.supplyCap,
    borrowCap: row.borrowCap,
    isolationModeTotalDebtUsd: usd18ToNumber(row.isolationModeTotalDebt),
    borrowingEnabled: row.borrowingEnabled && row.isActive && !row.isFrozen,
    stableBorrowEnabled: row.stableBorrowEnabled && row.isActive && !row.isFrozen,
    collateralEnabled: row.collateralEnabled,
    ltvBps: Number(row.ltvBps),
    liquidationThresholdBps: Number(row.liquidationThresholdBps),
    liquidationBonusBps: Number(row.liquidationBonusBps),
    reserveFactorBps: Number(row.reserveFactorBps),
    availableLiquidity: row.availableLiquidity,
    liquidityIndex: 0n,
    variableBorrowIndex: 0n,
    aToken: row.aToken,
    stableDebtToken: row.stableDebtToken,
    variableDebtToken: row.variableDebtToken,
  };
}

export function liveUserFromLens(row: LensPosition, decimals: number): LiveUserReserve {
  return {
    token: row.token,
    supplied: tokensToNumber(row.supplied, decimals),
    borrowed: tokensToNumber(row.borrowed, decimals),
    isCollateral: row.isCollateral,
    suppliedRaw: row.supplied,
    borrowedRaw: row.borrowed,
  };
}

export function liveReserveFromPdp(opts: {
  token: Address;
  symbol: string;
  name?: string;
  decimals: number;
  priceUsd18: bigint;
  availableLiquidity: bigint;
  totalStableDebt: bigint;
  totalVariableDebt: bigint;
  liquidityRate: bigint;
  variableBorrowRate: bigint;
  isActive?: boolean;
  isFrozen?: boolean;
  borrowingEnabled?: boolean;
  stableBorrowEnabled?: boolean;
  collateralEnabled?: boolean;
  ltvBps?: number;
  liquidationThresholdBps?: number;
  liquidationBonusBps?: number;
  reserveFactorBps?: number;
  supplyCapTokens?: bigint;
  borrowCapTokens?: bigint;
}): LiveReserve {
  const totalBorrow = opts.totalStableDebt + opts.totalVariableDebt;
  const totalSupply = opts.availableLiquidity + totalBorrow;
  const priceUsd = usd18ToNumber(opts.priceUsd18);
  const active = opts.isActive ?? true;
  const frozen = opts.isFrozen ?? false;
  return {
    token: opts.token,
    symbol: opts.symbol,
    name: opts.name ?? opts.symbol,
    isActive: active,
    decimals: opts.decimals,
    priceUsd,
    supplyApy: rayAprToApyPercent(opts.liquidityRate),
    variableBorrowApy: rayAprToApyPercent(opts.variableBorrowRate),
    totalSupplyUsd: tokensToNumber(totalSupply, opts.decimals) * priceUsd,
    totalBorrowUsd: tokensToNumber(totalBorrow, opts.decimals) * priceUsd,
    supplyCapUsd:
      opts.supplyCapTokens !== undefined ? Number(opts.supplyCapTokens) * priceUsd : undefined,
    borrowCapUsd:
      opts.borrowCapTokens !== undefined ? Number(opts.borrowCapTokens) * priceUsd : undefined,
    borrowingEnabled: (opts.borrowingEnabled ?? true) && active && !frozen,
    stableBorrowEnabled: (opts.stableBorrowEnabled ?? false) && active && !frozen,
    collateralEnabled: opts.collateralEnabled,
    ltvBps: opts.ltvBps,
    liquidationThresholdBps: opts.liquidationThresholdBps,
    liquidationBonusBps: opts.liquidationBonusBps,
    reserveFactorBps: opts.reserveFactorBps,
    availableLiquidity: opts.availableLiquidity,
    liquidityIndex: 0n,
    totalSupply,
    totalBorrow,
    supplyCap: opts.supplyCapTokens ?? 0n,
    borrowCap: opts.borrowCapTokens ?? 0n,
    variableBorrowIndex: 0n,
  };
}

export function liveUserFromPdp(opts: {
  token: Address;
  decimals: number;
  currentATokenBalance: bigint;
  currentStableDebt: bigint;
  currentVariableDebt: bigint;
  usageAsCollateralEnabled: boolean;
}): LiveUserReserve {
  return {
    token: opts.token,
    supplied: tokensToNumber(opts.currentATokenBalance, opts.decimals),
    borrowed: tokensToNumber(opts.currentStableDebt + opts.currentVariableDebt, opts.decimals),
    isCollateral: opts.usageAsCollateralEnabled,
    suppliedRaw: opts.currentATokenBalance,
    borrowedRaw: opts.currentStableDebt + opts.currentVariableDebt,
  };
}

/** Join catalog display metadata onto a deployed reserve. Does not add or drop listings. */
export function overlayCatalogWithLive<T extends CatalogReserveFields>(
  catalog: T,
  live: LiveReserve | undefined,
): T {
  if (!live) return catalog;
  return {
    ...catalog,
    priceUsd: live.priceUsd,
    supplyApy: live.supplyApy,
    variableBorrowApy: live.variableBorrowApy,
    totalSupplyUsd: live.totalSupplyUsd,
    totalBorrowUsd: live.totalBorrowUsd,
    supplyCapUsd: live.supplyCapUsd ?? catalog.supplyCapUsd,
    borrowCapUsd: live.borrowCapUsd ?? catalog.borrowCapUsd,
    borrowingEnabled: live.borrowingEnabled ?? catalog.borrowingEnabled,
    stableBorrowEnabled: live.stableBorrowEnabled ?? catalog.stableBorrowEnabled,
    collateralEnabled: live.collateralEnabled ?? catalog.collateralEnabled,
    ltvBps: live.ltvBps ?? catalog.ltvBps,
    liquidationThresholdBps: live.liquidationThresholdBps ?? catalog.liquidationThresholdBps,
    liquidationBonusBps: live.liquidationBonusBps ?? catalog.liquidationBonusBps,
    reserveFactorBps: live.reserveFactorBps ?? catalog.reserveFactorBps,
  };
}

/** Native ETH reported by the lens. ERC-20 wallet balances must be read separately. */
export function walletMapFromLens(nativeEth: bigint): Map<string, bigint> {
  return new Map([[MOCK_ETH_ADDRESS.toLowerCase(), nativeEth]]);
}

export function indexWalletBalances(
  tokens: readonly Address[],
  balances: readonly bigint[],
): Map<string, bigint> {
  const map = new Map<string, bigint>();
  for (let i = 0; i < tokens.length && i < balances.length; i++) {
    map.set(tokens[i]!.toLowerCase(), balances[i]!);
  }
  return map;
}
