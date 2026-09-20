// Offline quickstart for @black-market/sdk — no RPC, no wallet, no network.
// Exercises the real public API the way a consumer would: addresses, launch
// recipe derivation, calldata building, and RAY/WAD formatting helpers.
//
// Run after building the package (examples import the built dist output):
//
//   pnpm build && node examples/quickstart.mjs
//
// or simply:
//
//   pnpm examples

import {
  AUCTION_QUOTE_OPTIONS,
  AUCTION_SUPPLY,
  ATOMIC_LAUNCH_DEADLINE_SECONDS,
  ATOMIC_LAUNCH_ORACLE_CONFIG_ID,
  buildAtomicLaunchCalldata,
  DEFAULT_ATOMIC_LAUNCH_TARGET_MARKET_CAP_USD,
  deriveAtomicLaunchBuySqrtPriceLimitX96,
  deriveAtomicLaunchPoolRecipe,
  estimateAtomicLaunchInitialBuy,
  formatHealthFactor,
  formatUnitsDisplay,
  getAddresses,
  getLaunchTemplate,
  LAUNCH_TEMPLATES,
  parseAmountToUnits,
  rayAprToApyPercent,
  robinhoodMainnet,
} from "../dist/index.js";

// 1. Canonical Robinhood Chain mainnet deployment addresses.
const addresses = getAddresses(4663);
console.log("network:", robinhoodMainnet.name, `(chain ${robinhoodMainnet.id})`);
console.log("abyssRouter:", addresses.abyssRouter);
console.log("unifiedLauncher:", addresses.unifiedLauncher);

// 2. Pick a launch template and a paired (quote) asset from the catalog.
const template = getLaunchTemplate("standard");
console.log(`\ntemplate: ${template.label} (${LAUNCH_TEMPLATES.length} templates registered)`);
const usdg = AUCTION_QUOTE_OPTIONS.find((option) => option.id === "USDG");
console.log("paired asset:", usdg.name, `(${usdg.decimals} decimals, usdPeg=${usdg.usdPeg})`);

// 3. Derive the one-sided Atomic launch position from a target FDV.
//    USDG is a $1-pegged 6-decimal quote; the default target is $5,000 FDV.
const recipe = deriveAtomicLaunchPoolRecipe({
  pairedTokenDecimals: usdg.decimals,
  pairedTokenUsdPriceX18: 10n ** 18n, // $1.00
  targetMarketCapUsdX18: BigInt(DEFAULT_ATOMIC_LAUNCH_TARGET_MARKET_CAP_USD) * 10n ** 18n,
  launchedTokenIsQuote: template.launchedTokenIsQuote,
  fee: 3_000, // 0.30% Abyss fee tier
});
console.log("\nrecipe: launchTick", recipe.launchTick);
console.log("  launchSqrtPriceX96:", recipe.launchSqrtPriceX96);
console.log("  liquidity:", recipe.liquidity);
console.log("  launchedTokenAmountMaximum:", formatUnitsDisplay(recipe.launchedTokenAmountMaximum, 18));

// 4. Estimate the first buy and derive its exclusive price limit.
const pairedTokenAmountIn = parseAmountToUnits("250", usdg.decimals); // 250 USDG
const estimate = estimateAtomicLaunchInitialBuy({
  launchSqrtPriceX96: recipe.launchSqrtPriceX96,
  liquidity: recipe.liquidity,
  pairedTokenAmountIn,
  launchedTokenIsQuote: template.launchedTokenIsQuote,
  fee: 3_000,
});
console.log("\ninitial buy: 250 USDG ->", formatUnitsDisplay(estimate.launchedTokenAmountOut, 18), "tokens");

const sqrtPriceLimitX96 = deriveAtomicLaunchBuySqrtPriceLimitX96({
  launchSqrtPriceX96: recipe.launchSqrtPriceX96,
  launchedTokenIsQuote: template.launchedTokenIsQuote,
});

// 5. Encode the deployAndLaunch calldata for the AtomicLaunchFactory.
const calldata = buildAtomicLaunchCalldata(
  {
    creator: "0x1000000000000000000000000000000000000001", // replace with your address
    templateId: template.templateId,
    templateVersion: template.version,
    token: {
      kind: template.tokenKinds[0],
      name: "Example Token",
      symbol: "EXMPL",
      decimals: 18,
      supply: AUCTION_SUPPLY,
    },
    pool: {
      pairedToken: usdg.address,
      launchedTokenIsQuote: template.launchedTokenIsQuote,
      profile: template.poolProfiles[0],
      fee: 3_000,
      oracleConfigId: ATOMIC_LAUNCH_ORACLE_CONFIG_ID,
      launchTick: recipe.launchTick,
      liquidity: recipe.liquidity,
      launchedTokenAmountMaximum: recipe.launchedTokenAmountMaximum,
      pairedTokenAmountMaximum: recipe.pairedTokenAmountMaximum,
    },
    initialBuy: {
      pairedTokenAmountIn,
      launchedTokenAmountOutMinimum: 0n,
      sqrtPriceLimitX96,
    },
    // Standard template + StandardOracle profile: both fee assets are active and
    // must each total 10,000 bps; the template allows owner-only destinations.
    launchedTokenFees: { ownerBps: 10_000, rewardsBps: 0, burnBps: 0 },
    pairedTokenFees: { ownerBps: 10_000, rewardsBps: 0, burnBps: 0 },
    deadline: BigInt(Math.floor(Date.now() / 1000) + ATOMIC_LAUNCH_DEADLINE_SECONDS),
  },
  0n,
);
console.log("\ncalldata:", calldata.slice(0, 42), `… (${(calldata.length - 2) / 2} bytes)`);

// 6. Formatting helpers for lending-market reads.
console.log("\n5% borrow APR in ray:", rayAprToApyPercent(5n * 10n ** 25n), "%");
console.log("health factor 1.42:", formatHealthFactor(142n * 10n ** 16n));
