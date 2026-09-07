import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, toFunctionSelector } from "viem";

const sdkPath = process.env.SDK_SOURCE_TEST === "1" ? "../src/index.ts" : "../dist/index.js";
const {
  ABYSS_FEE_TIERS,
  ATOMIC_LAUNCH_BUY_SLIPPAGE_BPS,
  ATOMIC_LAUNCH_DEADLINE_SECONDS,
  ATOMIC_LAUNCH_ORACLE_CONFIG_ID,
  AUCTION_SUPPLY,
  AUCTION_QUOTE_OPTIONS,
  AbyssPoolProfile,
  atomicLaunchFactoryAbi,
  atomicLaunchRequestComponents,
  atomicPoolConfigComponents,
  buildAtomicLaunchCalldata,
  DEFAULT_ATOMIC_LAUNCH_TARGET_MARKET_CAP_USD,
  estimateAtomicLaunchInitialBuy,
  deriveAtomicLaunchBuySqrtPriceLimitX96,
  deriveAtomicLaunchPoolRecipe,
  DUAL_DIVIDENDS_TEMPLATE_ID,
  DUAL_STAKING_TEMPLATE_ID,
  FEE_BURN_TEMPLATE_ID,
  INITIAL_TEMPLATE_VERSION,
  LAUNCH_REWARD_DURATION,
  LAUNCH_TEMPLATES,
  LaunchFeeAssetMode,
  LaunchFeeDestination,
  LaunchRewardMode,
  QUOTE_DIVIDENDS_TEMPLATE_ID,
  QUOTE_STAKING_TEMPLATE_ID,
  STANDARD_TEMPLATE_ID,
  ROBINHOOD_WETH,
  TokenKind,
} = await import(sdkPath);

const pairedToken = "0x2000000000000000000000000000000000000000";
const creator = "0x1000000000000000000000000000000000000000";
const pairedTokenUsdPriceX18 = 2_500n * 10n ** 18n;
const targetMarketCapUsdX18 = 3_000n * 10n ** 18n;
const zeroDisposition = () => ({ ownerBps: 0, rewardsBps: 0, burnBps: 0 });

function dispositionFor(destinations) {
  if (destinations === LaunchFeeDestination.Owner) {
    return { ownerBps: 10_000, rewardsBps: 0, burnBps: 0 };
  }
  if (destinations === LaunchFeeDestination.Burn) {
    return { ownerBps: 0, rewardsBps: 0, burnBps: 10_000 };
  }
  if (destinations & LaunchFeeDestination.Burn) {
    return { ownerBps: 3_000, rewardsBps: 4_000, burnBps: 3_000 };
  }
  return { ownerBps: 4_000, rewardsBps: 6_000, burnBps: 0 };
}

function activeFeeAssets(template, profile) {
  switch (template.feeAssetMode) {
    case LaunchFeeAssetMode.Profile:
      return { launched: profile === AbyssPoolProfile.StandardOracle, paired: true };
    case LaunchFeeAssetMode.PairedOnly:
      return { launched: false, paired: true };
    case LaunchFeeAssetMode.Both:
      return { launched: true, paired: true };
    case LaunchFeeAssetMode.LaunchedOnly:
      return { launched: true, paired: false };
    default:
      throw new Error("unknown fee asset mode");
  }
}

function recipeFor(launchedTokenIsQuote, fee = 3_000) {
  return deriveAtomicLaunchPoolRecipe({
    pairedTokenDecimals: 18,
    pairedTokenUsdPriceX18,
    targetMarketCapUsdX18,
    launchedTokenIsQuote,
    fee,
  });
}

function requestFor(template, profile = template.poolProfiles[0]) {
  const active = activeFeeAssets(template, profile);
  const recipe = recipeFor(template.launchedTokenIsQuote);
  return {
    creator,
    templateId: template.templateId,
    templateVersion: INITIAL_TEMPLATE_VERSION,
    token: {
      kind: template.tokenKinds[0],
      name: "Registry Token",
      symbol: "REG",
      decimals: 18,
      supply: AUCTION_SUPPLY,
    },
    pool: {
      pairedToken,
      launchedTokenIsQuote: template.launchedTokenIsQuote,
      profile,
      fee: 3_000,
      oracleConfigId: ATOMIC_LAUNCH_ORACLE_CONFIG_ID,
      launchTick: recipe.launchTick,
      liquidity: recipe.liquidity,
      launchedTokenAmountMaximum: recipe.launchedTokenAmountMaximum,
      pairedTokenAmountMaximum: recipe.pairedTokenAmountMaximum,
    },
    initialBuy: {
      pairedTokenAmountIn: 0n,
      launchedTokenAmountOutMinimum: 0n,
      sqrtPriceLimitX96: 0n,
    },
    launchedTokenFees: active.launched
      ? dispositionFor(template.launchedTokenDestinations)
      : zeroDisposition(),
    pairedTokenFees: active.paired
      ? dispositionFor(template.pairedTokenDestinations)
      : zeroDisposition(),
    deadline: 1_000n,
  };
}

const recipeIds = [
  ["standard", STANDARD_TEMPLATE_ID],
  ["quote-staking", QUOTE_STAKING_TEMPLATE_ID],
  ["quote-dividends", QUOTE_DIVIDENDS_TEMPLATE_ID],
  ["dual-staking", DUAL_STAKING_TEMPLATE_ID],
  ["dual-dividends", DUAL_DIVIDENDS_TEMPLATE_ID],
  ["fee-burn", FEE_BURN_TEMPLATE_ID],
];

const DEPLOY_AND_LAUNCH_SIGNATURE =
  "deployAndLaunch((address,bytes32,uint32,(uint8,string,string,uint8,uint256),(address,bool,uint8,uint24,bytes32,int24,uint128,uint256,uint256),(uint256,uint256,uint160),(uint16,uint16,uint16),(uint16,uint16,uint16),uint256))";

test("six immutable launch recipes match their on-chain IDs and capabilities", () => {
  assert.equal(LAUNCH_TEMPLATES.length, 6);
  assert.deepEqual(
    LAUNCH_TEMPLATES.map(({ id, templateId }) => [id, templateId]),
    recipeIds,
  );

  for (const template of LAUNCH_TEMPLATES) {
    const expectedKind = template.rewardMode === LaunchRewardMode.Dividends
      ? TokenKind.HolderDividend
      : TokenKind.Burnable;
    assert.equal(template.version, 1);
    assert.deepEqual(template.tokenKinds, [expectedKind]);
    assert.doesNotThrow(() => buildAtomicLaunchCalldata(requestFor(template)));
  }

  for (const id of ["quote-staking", "quote-dividends", "dual-staking", "dual-dividends"]) {
    const template = LAUNCH_TEMPLATES.find((candidate) => candidate.id === id);
    assert.equal(template.rewardDuration, LAUNCH_REWARD_DURATION);
    assert.notEqual(template.rewardMode, LaunchRewardMode.None);
  }
  assert.equal(LAUNCH_TEMPLATES.find(({ id }) => id === "fee-burn").launchedTokenIsQuote, true);
});

test("Atomic launch ABI encodes the deployed nine-field PoolConfig and selector", () => {
  assert.deepEqual(
    atomicPoolConfigComponents.map(({ name, type }) => [name, type]),
    [
      ["pairedToken", "address"],
      ["launchedTokenIsQuote", "bool"],
      ["profile", "uint8"],
      ["fee", "uint24"],
      ["oracleConfigId", "bytes32"],
      ["launchTick", "int24"],
      ["liquidity", "uint128"],
      ["launchedTokenAmountMaximum", "uint256"],
      ["pairedTokenAmountMaximum", "uint256"],
    ],
  );
  assert.equal(atomicPoolConfigComponents.length, 9);
  assert.equal(
    atomicPoolConfigComponents.some(({ name }) =>
      ["sqrtPriceX96", "tickLower", "tickUpper"].includes(name),
    ),
    false,
  );
  assert.deepEqual(
    atomicLaunchRequestComponents.map(({ name }) => name),
    [
      "creator",
      "templateId",
      "templateVersion",
      "token",
      "pool",
      "initialBuy",
      "launchedTokenFees",
      "pairedTokenFees",
      "deadline",
    ],
  );
  assert.equal(toFunctionSelector(DEPLOY_AND_LAUNCH_SIGNATURE), "0xe5ac002e");

  const standard = LAUNCH_TEMPLATES.find(({ id }) => id === "standard");
  const request = requestFor(standard);
  const data = buildAtomicLaunchCalldata(request);
  assert.equal(data.slice(0, 10), "0xe5ac002e");

  const decoded = decodeFunctionData({ abi: atomicLaunchFactoryAbi, data });
  assert.equal(decoded.functionName, "deployAndLaunch");
  assert.deepEqual(decoded.args[0].pool, request.pool);
  assert.equal(decoded.args[0].pool.pairedTokenAmountMaximum, 0n);
});

test("automatic recipes deterministically derive current market-cap vectors", () => {
  assert.equal(ATOMIC_LAUNCH_ORACLE_CONFIG_ID, "0xc0e9bed88d70a13fd3ab31451fefdd073b7266e838aee0ad1c236c8c9eff855d");
  assert.equal(ATOMIC_LAUNCH_DEADLINE_SECONDS, 20 * 60);
  assert.equal(ATOMIC_LAUNCH_BUY_SLIPPAGE_BPS, 50);
  assert.equal(DEFAULT_ATOMIC_LAUNCH_TARGET_MARKET_CAP_USD, 5_000);

  assert.deepEqual(recipeFor(false), {
    launchTick: 205_380,
    launchSqrtPriceX96: 2_282_583_348_588_035_653_859_784_169_833_792n,
    liquidity: 34_709_866_153_747_871_271_353n,
    launchedTokenAmountMaximum: 1_000_000_000_000_000_000_000_000_000n,
    pairedTokenAmountMaximum: 0n,
  });
  assert.deepEqual(recipeFor(true), {
    launchTick: -205_380,
    launchSqrtPriceX96: 2_749_998_916_477_499_577_759_667n,
    liquidity: 34_709_866_153_747_871_271_353n,
    launchedTokenAmountMaximum: 1_000_000_000_000_000_000_000_000_000n,
    pairedTokenAmountMaximum: 0n,
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

test("request validation follows the current single-sided Atomic request contract", () => {
  const standard = LAUNCH_TEMPLATES.find(({ id }) => id === "standard");
  const valid = requestFor(standard);
  assert.doesNotThrow(() => buildAtomicLaunchCalldata(valid));

  const nonzeroPairedMaximum = requestFor(standard);
  nonzeroPairedMaximum.pool.pairedTokenAmountMaximum = 1n;
  assert.throws(() => buildAtomicLaunchCalldata(nonzeroPairedMaximum), /must be zero/);

  const overflowingTick = requestFor(standard);
  overflowingTick.pool.launchTick = 8_388_608;
  assert.throws(() => buildAtomicLaunchCalldata(overflowingTick), /int24/);

  const overflowingLiquidity = requestFor(standard);
  overflowingLiquidity.pool.liquidity = 1n << 128n;
  assert.throws(() => buildAtomicLaunchCalldata(overflowingLiquidity), /pool\.liquidity/);

  const malformedOracle = requestFor(standard);
  malformedOracle.pool.oracleConfigId = "0x11";
  assert.throws(() => buildAtomicLaunchCalldata(malformedOracle), /oracleConfigId/);

  const negativeAmount = requestFor(standard);
  negativeAmount.initialBuy.pairedTokenAmountIn = -1n;
  assert.throws(() => buildAtomicLaunchCalldata(negativeAmount), /initialBuy\.pairedTokenAmountIn/);

  const zeroDeadline = requestFor(standard);
  zeroDeadline.deadline = 0n;
  assert.throws(() => buildAtomicLaunchCalldata(zeroDeadline), /deadline/);

  const unsafeguardedBuy = requestFor(standard);
  unsafeguardedBuy.initialBuy.pairedTokenAmountIn = 1n;
  assert.throws(() => buildAtomicLaunchCalldata(unsafeguardedBuy), /directional price limit/);

  const zeroBuyWithSafeguard = requestFor(standard);
  zeroBuyWithSafeguard.initialBuy.sqrtPriceLimitX96 = 1n;
  assert.throws(() => buildAtomicLaunchCalldata(zeroBuyWithSafeguard), /zero initial buy/);

  const nativeBuyWithSafeguard = requestFor(standard);
  const nativeRecipe = recipeFor(false);
  nativeBuyWithSafeguard.initialBuy = {
    pairedTokenAmountIn: 0n,
    launchedTokenAmountOutMinimum: 0n,
    sqrtPriceLimitX96: deriveAtomicLaunchBuySqrtPriceLimitX96({
      launchSqrtPriceX96: nativeRecipe.launchSqrtPriceX96,
      launchedTokenIsQuote: false,
    }),
  };
  assert.doesNotThrow(() => buildAtomicLaunchCalldata(nativeBuyWithSafeguard, 1n));

  const nativeBuyWithoutSafeguard = requestFor(standard);
  assert.throws(
    () => buildAtomicLaunchCalldata(nativeBuyWithoutSafeguard, 1n),
    /directional price limit/,
  );

  const misdirectedBuy = requestFor(standard);
  const aboveRecipe = recipeFor(false);
  misdirectedBuy.initialBuy = {

    pairedTokenAmountIn: 1n,
    launchedTokenAmountOutMinimum: 0n,
    sqrtPriceLimitX96: aboveRecipe.launchSqrtPriceX96,
  };
  assert.throws(() => buildAtomicLaunchCalldata(misdirectedBuy), /swap direction/);

  const guardedBuy = requestFor(standard);
  guardedBuy.initialBuy = {
    pairedTokenAmountIn: 1n,
    launchedTokenAmountOutMinimum: 0n,
    sqrtPriceLimitX96: deriveAtomicLaunchBuySqrtPriceLimitX96({
      launchSqrtPriceX96: aboveRecipe.launchSqrtPriceX96,
      launchedTokenIsQuote: false,
    }),
  };
  assert.doesNotThrow(() => buildAtomicLaunchCalldata(guardedBuy));
});

test("pure initial-buy estimate updates monotonically with input", () => {
  const recipe = deriveAtomicLaunchPoolRecipe({
    pairedTokenDecimals: 18,
    pairedTokenUsdPriceX18,
    targetMarketCapUsdX18,
    launchedTokenIsQuote: false,
    fee: 10_000,
  });
  const small = estimateAtomicLaunchInitialBuy({
    launchSqrtPriceX96: recipe.launchSqrtPriceX96,
    liquidity: recipe.liquidity,
    pairedTokenAmountIn: 1n * 10n ** 18n,
    launchedTokenIsQuote: false,
    fee: 10_000,
  });
  const large = estimateAtomicLaunchInitialBuy({
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
  const downLimit = deriveAtomicLaunchBuySqrtPriceLimitX96({
    launchSqrtPriceX96: above,
    launchedTokenIsQuote: false,
  });
  const upLimit = deriveAtomicLaunchBuySqrtPriceLimitX96({
    launchSqrtPriceX96: below,
    launchedTokenIsQuote: true,
    slippageBps: 50,
  });

  assert.equal(
    downLimit,
    deriveAtomicLaunchBuySqrtPriceLimitX96({
      launchSqrtPriceX96: above,
      launchedTokenIsQuote: false,
      slippageBps: ATOMIC_LAUNCH_BUY_SLIPPAGE_BPS,
    }),
  );
  assert(downLimit < above);
  assert(upLimit > below);
  assert(downLimit > 4_295_128_739n);
  assert(upLimit < 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n);
  assert(downLimit * downLimit * 10_000n >= above * above * 9_950n);
  assert(upLimit * upLimit * 10_000n <= below * below * 10_050n);

  assert.equal(
    deriveAtomicLaunchBuySqrtPriceLimitX96({
      launchSqrtPriceX96: 4_295_128_740n,
      launchedTokenIsQuote: false,
      slippageBps: 9_999,
    }),
    4_295_128_740n,
  );
  assert.equal(
    deriveAtomicLaunchBuySqrtPriceLimitX96({
      launchSqrtPriceX96: 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_341n,
      launchedTokenIsQuote: true,
      slippageBps: 9_999,
    }),
    1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_341n,
  );
  assert.throws(
    () => deriveAtomicLaunchBuySqrtPriceLimitX96({ launchSqrtPriceX96: above, launchedTokenIsQuote: false, slippageBps: 0 }),
    /1 through 9,999/,
  );
  assert.throws(
    () => deriveAtomicLaunchBuySqrtPriceLimitX96({ launchSqrtPriceX96: above, launchedTokenIsQuote: false, slippageBps: 10_000 }),
    /1 through 9,999/,
  );
});

test("all fee dispositions preserve the six template capabilities", () => {
  for (const template of LAUNCH_TEMPLATES) {
    for (const { feePips } of ABYSS_FEE_TIERS) {
      const request = requestFor(template);
      request.pool.fee = feePips;
      const recipe = recipeFor(template.launchedTokenIsQuote, feePips);
      request.pool.launchTick = recipe.launchTick;
      request.pool.liquidity = recipe.liquidity;
      assert.doesNotThrow(() => buildAtomicLaunchCalldata(request));
    }
  }

  const quote = LAUNCH_TEMPLATES.find(({ id }) => id === "quote-staking");
  const invalidDestination = requestFor(quote);
  invalidDestination.pairedTokenFees = { ownerBps: 0, rewardsBps: 5_000, burnBps: 5_000 };
  assert.throws(() => buildAtomicLaunchCalldata(invalidDestination), /destination not allowed/);

  const feeBurn = LAUNCH_TEMPLATES.find(({ id }) => id === "fee-burn");
  const invalidInactiveFees = requestFor(feeBurn);
  invalidInactiveFees.pairedTokenFees = { ownerBps: 10_000, rewardsBps: 0, burnBps: 0 };
  assert.throws(() => buildAtomicLaunchCalldata(invalidInactiveFees), /must total zero/);
});

test("launch quote catalog includes canonical Robinhood WETH", () => {
  const weth = AUCTION_QUOTE_OPTIONS.find(({ id }) => id === "WETH");

  assert.deepEqual(weth, {
    id: "WETH",
    symbol: "WETH",
    address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
    decimals: 18,
    name: "Wrapped Ether",
    usdPeg: false,
  });
  assert.equal(ROBINHOOD_WETH, weth.address);
});
