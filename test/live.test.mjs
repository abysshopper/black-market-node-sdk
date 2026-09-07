import assert from "node:assert/strict";
import test from "node:test";
import {
  indexByToken,
  indexWalletBalances,
  liveReserveFromLens,
  liveReserveFromPdp,
  liveReserveFromUi,
  liveUserFromLens,
  liveUserFromPdp,
  liveUserFromUi,
  MOCK_ETH_ADDRESS,
  overlayCatalogWithLive,
  RAY,
  walletMapFromLens,
} from "../dist/index.js";

const tokenA = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const tokenB = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

function uiRow(overrides = {}) {
  return {
    underlyingAsset: tokenA,
    name: "Wrapped Ether",
    symbol: "WETH",
    decimals: 18n,
    baseLTVasCollateral: 8_000n,
    reserveLiquidationThreshold: 8_500n,
    reserveLiquidationBonus: 10_500n,
    reserveFactor: 1_000n,
    usageAsCollateralEnabled: true,
    borrowingEnabled: true,
    stableBorrowRateEnabled: false,
    isActive: true,
    isFrozen: false,
    liquidityIndex: RAY,
    variableBorrowIndex: RAY,
    liquidityRate: 5n * 10n ** 25n, // 5% supply APR
    variableBorrowRate: 8n * 10n ** 25n, // 8% borrow APR
    availableLiquidity: 60n * 10n ** 18n,
    totalPrincipalStableDebt: 0n,
    totalScaledVariableDebt: 40n * 10n ** 18n,
    priceInUsd: 2_500n * 10n ** 18n,
    supplyCap: 0n,
    borrowCap: 0n,
    ...overrides,
  };
}

test("liveReserveFromUi unscales variable debt and derives supply/borrow totals", () => {
  // 40 scaled variable-debt units at a 1.25 index == 50 real units borrowed.
  const reserve = liveReserveFromUi(
    uiRow({ variableBorrowIndex: 125n * 10n ** 25n }),
  );

  assert.equal(reserve.totalBorrow, 50n * 10n ** 18n);
  assert.equal(reserve.totalSupply, 110n * 10n ** 18n);
  assert.equal(reserve.priceUsd, 2_500);
  assert.equal(reserve.totalSupplyUsd, 275_000);
  assert.equal(reserve.totalBorrowUsd, 125_000);
  assert.equal(reserve.supplyApy, 5);
  assert.equal(reserve.variableBorrowApy, 8);
  assert.equal(reserve.borrowingEnabled, true);
  assert.equal(reserve.ltvBps, 8_000);
});

test("frozen or inactive reserves force borrowingEnabled and stableBorrowEnabled off", () => {
  for (const overrides of [{ isFrozen: true }, { isActive: false }]) {
    const reserve = liveReserveFromUi(uiRow({ ...overrides, stableBorrowRateEnabled: true }));
    assert.equal(reserve.borrowingEnabled, false);
    assert.equal(reserve.stableBorrowEnabled, false);
  }
});

test("liveUserFromUi unscales aToken balances and variable debt by the indices", () => {
  const reserve = liveReserveFromUi(uiRow());
  const user = liveUserFromUi(
    {
      underlyingAsset: tokenA,
      scaledATokenBalance: 4n * 10n ** 18n,
      usageAsCollateralEnabledOnUser: true,
      scaledVariableDebt: 10n * 10n ** 18n,
      principalStableDebt: 3n * 10n ** 18n,
    },
    { ...reserve, liquidityIndex: 15n * 10n ** 26n, variableBorrowIndex: 12n * 10n ** 26n },
  );

  assert.equal(user.suppliedRaw, 6n * 10n ** 18n); // 4 * 1.5
  assert.equal(user.borrowedRaw, 15n * 10n ** 18n); // 10 * 1.2 + 3
  assert.equal(user.supplied, 6);
  assert.equal(user.borrowed, 15);
  assert.equal(user.isCollateral, true);
  assert.equal(user.token, tokenA);
});

test("liveReserveFromLens passes through isolation metadata the UI rows lack", () => {
  const reserve = liveReserveFromLens({
    token: tokenA,
    aToken: tokenB,
    stableDebtToken: "0xCcCCcCCCCcCCccCCcCcCCcCCccCCcCcCCccCcc",
    variableDebtToken: "0xDDdDddDdDdddDDddDDdDDDDdDdDDdDDdDDDDDDdD",
    decimals: 18n,
    isActive: true,
    isFrozen: false,
    borrowingEnabled: true,
    stableBorrowEnabled: false,
    collateralEnabled: true,
    ltvBps: 7_500n,
    liquidationThresholdBps: 8_000n,
    liquidationBonusBps: 10_400n,
    reserveFactorBps: 1_500n,
    priceUsd: 10n ** 18n,
    collateralPriceUsd: 10n ** 18n,
    debtPriceUsd: 10n ** 18n,
    isIsolated: true,
    borrowableInIsolation: false,
    debtCeiling: 1_000_000n,
    isolationModeTotalDebt: 25n * 10n ** 17n,
    liquidityRate: 2n * 10n ** 25n,
    variableBorrowRate: 4n * 10n ** 25n,
    availableLiquidity: 100n * 10n ** 18n,
    totalStableDebt: 0n,
    totalVariableDebt: 25n * 10n ** 18n,
    supplyCap: 0n,
    borrowCap: 0n,
  });

  assert.equal(reserve.isIsolated, true);
  assert.equal(reserve.borrowableInIsolation, false);
  // debtCeilingUsd passes the lens row's raw ceiling units through unconverted.
  assert.equal(reserve.debtCeilingUsd, 1_000_000);
  assert.equal(reserve.isolationModeTotalDebtUsd, 2.5);
  assert.equal(reserve.totalSupply, 125n * 10n ** 18n);
  assert.equal(reserve.symbol, "");
  assert.equal(reserve.aToken, tokenB);
  assert.equal(reserve.priceUsd, 1);
});

test("liveUserFromLens reports raw wallet-independent positions", () => {
  const user = liveUserFromLens(
    { token: tokenA, supplied: 25n * 10n ** 17n, borrowed: 5n * 10n ** 17n, wallet: 0n, isCollateral: false },
    18,
  );
  assert.equal(user.supplied, 2.5);
  assert.equal(user.borrowed, 0.5);
  assert.equal(user.isCollateral, false);
  assert.equal(user.suppliedRaw, 25n * 10n ** 17n);
});

test("liveReserveFromPdp defaults to an active borrowable reserve and optional caps", () => {
  const reserve = liveReserveFromPdp({
    token: tokenA,
    symbol: "USDG",
    decimals: 6,
    priceUsd18: 10n ** 18n,
    availableLiquidity: 800n * 10n ** 6n,
    totalStableDebt: 0n,
    totalVariableDebt: 200n * 10n ** 6n,
    liquidityRate: 3n * 10n ** 25n,
    variableBorrowRate: 6n * 10n ** 25n,
  });

  assert.equal(reserve.name, "USDG");
  assert.equal(reserve.isActive, true);
  assert.equal(reserve.borrowingEnabled, true);
  assert.equal(reserve.stableBorrowEnabled, false);
  assert.equal(reserve.totalSupply, 1_000n * 10n ** 6n);
  assert.equal(reserve.totalSupplyUsd, 1_000);
  assert.equal(reserve.supplyCapUsd, undefined);
  assert.equal(reserve.supplyCap, 0n);

  const frozen = liveReserveFromPdp({
    token: tokenA,
    symbol: "USDG",
    decimals: 6,
    priceUsd18: 10n ** 18n,
    availableLiquidity: 0n,
    totalStableDebt: 0n,
    totalVariableDebt: 0n,
    liquidityRate: 0n,
    variableBorrowRate: 0n,
    isFrozen: true,
    supplyCapTokens: 5_000n,
  });
  assert.equal(frozen.borrowingEnabled, false);
  assert.equal(frozen.supplyCapUsd, 5_000);
});

test("liveUserFromPdp folds stable and variable debt into one borrow balance", () => {
  const user = liveUserFromPdp({
    token: tokenA,
    decimals: 6,
    currentATokenBalance: 150n * 10n ** 6n,
    currentStableDebt: 20n * 10n ** 6n,
    currentVariableDebt: 30n * 10n ** 6n,
    usageAsCollateralEnabled: true,
  });
  assert.equal(user.supplied, 150);
  assert.equal(user.borrowed, 50);
  assert.equal(user.borrowedRaw, 50n * 10n ** 6n);
});

test("overlayCatalogWithLive overlays live fields without dropping catalog rows", () => {
  const catalog = {
    token: tokenA,
    decimals: 18,
    priceUsd: 1,
    supplyApy: 0,
    variableBorrowApy: 0,
    totalSupplyUsd: 0,
    totalBorrowUsd: 0,
    borrowingEnabled: false,
    stableBorrowEnabled: false,
    collateralEnabled: true,
    ltvBps: 0,
    liquidationThresholdBps: 0,
    liquidationBonusBps: 0,
    reserveFactorBps: 0,
  };

  // Missing live data returns the catalog row untouched (listing preserved).
  assert.equal(overlayCatalogWithLive(catalog, undefined), catalog);

  const live = liveReserveFromUi(uiRow({ underlyingAsset: tokenA }));
  const overlaid = overlayCatalogWithLive(catalog, live);
  assert.equal(overlaid.priceUsd, 2_500);
  assert.equal(overlaid.supplyApy, 5);
  assert.equal(overlaid.ltvBps, 8_000);
  assert.equal(overlaid.token, tokenA);
});

test("indexByToken and indexWalletBalances key maps by lowercase address", () => {
  const rows = [{ token: tokenA, value: 1 }, { token: tokenB, value: 2 }];
  const byToken = indexByToken(rows);
  assert.equal(byToken.get(tokenA.toLowerCase()).value, 1);
  assert.equal(byToken.get(tokenB.toLowerCase()).value, 2);

  const wallet = indexWalletBalances([tokenA, tokenB], [7n]);
  assert.equal(wallet.get(tokenA.toLowerCase()), 7n);
  assert.equal(wallet.has(tokenB.toLowerCase()), false);
});

test("walletMapFromLens only reports the native ETH sentinel balance", () => {
  const map = walletMapFromLens(3n * 10n ** 18n);
  assert.equal(map.size, 1);
  assert.equal(map.get(MOCK_ETH_ADDRESS.toLowerCase()), 3n * 10n ** 18n);
});
