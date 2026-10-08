import assert from "node:assert/strict";
import test from "node:test";

const sdkPath = process.env.SDK_SOURCE_TEST === "1" ? "../src/index.ts" : "../dist/index.js";
const {
  ABYSS_FEE_TIERS, AUCTION_SUPPLY, deriveLaunchPoolRecipe, estimateLaunchInitialBuy, deriveLaunchBuySqrtPriceLimitX96,
} = await import(sdkPath);

const pairedTokenUsdPriceX18 = 2_500n * 10n ** 18n;
const targetMarketCapUsdX18 = 3_000n * 10n ** 18n;

function recipeFor(launchedTokenIsQuote, fee = 3_000) {
  return deriveLaunchPoolRecipe({
    pairedTokenDecimals: 18,
    pairedTokenUsdPriceX18,
    targetMarketCapUsdX18,
    launchedTokenIsQuote,
    fee,
  });
}

test("automatic recipes deterministically derive current market-cap vectors", () => {

  assert.deepEqual(recipeFor(false), {
    launchTick: 205_380,
    launchSqrtPriceX96: 2_282_583_348_588_035_653_859_784_169_833_792n,
    liquidity: 34_709_866_153_747_871_271_353n,
    launchedTokenAmountMaximum: 1_000_000_000_000_000_000_000_000_000n,
    pairedTokenAmountMaximum: 0n,
    tickLower: -887_220, tickUpper: 205_380,
  });
  assert.deepEqual(recipeFor(true), {
    launchTick: -205_380,
    launchSqrtPriceX96: 2_749_998_916_477_499_577_759_667n,
    liquidity: 34_709_866_153_747_871_271_353n,
    launchedTokenAmountMaximum: 1_000_000_000_000_000_000_000_000_000n,
    pairedTokenAmountMaximum: 0n,
    tickLower: -205_380, tickUpper: 887_220,
  });

  for (const { feePips, tickSpacing } of ABYSS_FEE_TIERS) {
    for (const launchedTokenIsQuote of [false, true]) {
      const recipe = recipeFor(launchedTokenIsQuote, feePips);
      assert.equal(Math.abs(recipe.launchTick % tickSpacing), 0);
      assert.equal(recipe.launchedTokenAmountMaximum, AUCTION_SUPPLY);
      assert.equal(recipe.pairedTokenAmountMaximum, 0n);
      assert(recipe.liquidity > 0n);
      assert(recipe.liquidity <= (1n << 128n) - 1n);
    }
  }
});


test("pure initial-buy estimate updates monotonically with input", () => {
  const recipe = deriveLaunchPoolRecipe({
    pairedTokenDecimals: 18,
    pairedTokenUsdPriceX18,
    targetMarketCapUsdX18,
    launchedTokenIsQuote: false,
    fee: 10_000,
  });
  const small = estimateLaunchInitialBuy({
    launchSqrtPriceX96: recipe.launchSqrtPriceX96,
    liquidity: recipe.liquidity,
    pairedTokenAmountIn: 1n * 10n ** 18n,
    launchedTokenIsQuote: false,
    fee: 10_000,
  });
  const large = estimateLaunchInitialBuy({
    launchSqrtPriceX96: recipe.launchSqrtPriceX96,
    liquidity: recipe.liquidity,
    pairedTokenAmountIn: 2n * 10n ** 18n,
    launchedTokenIsQuote: false,
    fee: 10_000,
  });
  assert(small.launchedTokenAmountOut > 0n);
  assert(large.launchedTokenAmountOut > small.launchedTokenAmountOut);
  assert(large.sqrtPriceAfterX96 < small.sqrtPriceAfterX96);
});

test("paired-token buy limits move in the safe direction with exact bounds", () => {
  const above = recipeFor(false).launchSqrtPriceX96;
  const below = recipeFor(true).launchSqrtPriceX96;
  const downLimit = deriveLaunchBuySqrtPriceLimitX96({
    launchSqrtPriceX96: above,
    launchedTokenIsQuote: false,
  });
  const upLimit = deriveLaunchBuySqrtPriceLimitX96({
    launchSqrtPriceX96: below,
    launchedTokenIsQuote: true,
    slippageBps: 50,
  });

  assert(downLimit < above);
  assert(upLimit > below);
  assert(downLimit > 4_295_128_739n);
  assert(upLimit < 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n);
  assert(downLimit * downLimit * 10_000n >= above * above * 9_950n);
  assert(upLimit * upLimit * 10_000n <= below * below * 10_050n);

  assert.equal(
    deriveLaunchBuySqrtPriceLimitX96({
      launchSqrtPriceX96: 4_295_128_740n,
      launchedTokenIsQuote: false,
      slippageBps: 9_999,
    }),
    4_295_128_740n,
  );
  assert.equal(
    deriveLaunchBuySqrtPriceLimitX96({
      launchSqrtPriceX96: 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_341n,
      launchedTokenIsQuote: true,
      slippageBps: 9_999,
    }),
    1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_341n,
  );
  assert.throws(
    () => deriveLaunchBuySqrtPriceLimitX96({ launchSqrtPriceX96: above, launchedTokenIsQuote: false, slippageBps: 0 }),
    /1 through 9,999/,
  );
  assert.throws(
    () => deriveLaunchBuySqrtPriceLimitX96({ launchSqrtPriceX96: above, launchedTokenIsQuote: false, slippageBps: 10_000 }),
    /1 through 9,999/,
  );
});
