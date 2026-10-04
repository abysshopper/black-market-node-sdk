// Offline current-wire example: no RPC, signature, deployment, publication or broadcast.
import { toHex } from "viem";
import {
  AUCTION_QUOTE_OPTIONS, AUCTION_SUPPLY, DEFAULT_LAUNCH_TARGET_MARKET_CAP_USD,
  deriveLaunchPoolRecipe, deriveLaunchBuySqrtPriceLimitX96, estimateLaunchInitialBuy,
  encodeV4LifecycleMarketConfig, decodeV4LifecycleMarketConfig, formatHealthFactor,
  formatUnitsDisplay, getAddresses, hashLaunchPlan, LifecycleTokenKind, LifecycleRewardMode,
  parseAmountToUnits, rayAprToApyPercent,
} from "../dist/index.js";

const infrastructure = getAddresses(4663);
console.log("canonical Abyss router:", infrastructure.abyssRouter);
const quote = AUCTION_QUOTE_OPTIONS.find((asset) => asset.id === "USDG");
if (!quote) throw new Error("USDG catalog metadata is missing");
const recipe = deriveLaunchPoolRecipe({
  pairedTokenDecimals: quote.decimals, pairedTokenUsdPriceX18: 10n ** 18n,
  targetMarketCapUsdX18: BigInt(DEFAULT_LAUNCH_TARGET_MARKET_CAP_USD) * 10n ** 18n,
  launchedTokenIsQuote: false, fee: 3000, supply: AUCTION_SUPPLY, tokenBudget: AUCTION_SUPPLY,
});
const buyLimit = deriveLaunchBuySqrtPriceLimitX96({ launchSqrtPriceX96: recipe.launchSqrtPriceX96, launchedTokenIsQuote: false });
const estimate = estimateLaunchInitialBuy({
  launchSqrtPriceX96: recipe.launchSqrtPriceX96, liquidity: recipe.liquidity,
  pairedTokenAmountIn: parseAmountToUnits("1", quote.decimals), launchedTokenIsQuote: false,
  fee: 3000, sqrtPriceLimitX96: buyLimit,
});
console.log("pure geometric estimate (not execution proof):", formatUnitsDisplay(estimate.launchedTokenAmountOut, 18));

// Illustrative non-deployed identities demonstrate only the wire contract. Real profiles,
// bounds and terms must come from readLifecycleProfiles on the explicit reviewed core.
const creator = "0x1000000000000000000000000000000000000001";
const profileId = toHex(11n, { size: 32 });
const config = encodeV4LifecycleMarketConfig({
  version: 4, lpFeePips: 3000, tickSpacing: 60, sqrtPriceX96: recipe.launchSqrtPriceX96,
  hookFeePips: 10000, feeMode: 0, protocolFeeDenominator: 6, treasury: creator,
  externalLiquidityDisabled: true, oracleConfigId: toHex(17n, { size: 32 }), profileId,
  termsDigest: toHex(21n, { size: 32 }), developerBeneficiary: "0x2000000000000000000000000000000000000001",
  developerFeeBps: 250, // explicit creator selection, never a SDK default
  positions: [{ tickLower: recipe.tickLower, tickUpper: recipe.tickUpper, liquidity: recipe.liquidity,
    salt: toHex(0n, { size: 32 }), maxTokenAmount: recipe.launchedTokenAmountMaximum }],
});
const plan = {
  chainId: 4663n, orchestrator: "0x3000000000000000000000000000000000000001", creator, nonce: 1n,
  token: { kind: LifecycleTokenKind.ERC20, rewardMode: LifecycleRewardMode.None, name: "Wire Example", symbol: "WIRE",
    supply: AUCTION_SUPPLY, nftUnit: 0n, metadataURI: "", salt: toHex(1n, { size: 32 }), inventoryRecipient: creator, burnOnCancel: true },
  funding: [], feeAssets: [{ asset: quote.address, ownerBps: 10000, rewardsBps: 0, burnBps: 0 }],
  markets: [{ adapterId: toHex(1n, { size: 32 }), profileId, quoteAsset: quote.address,
    tokenBudget: AUCTION_SUPPLY, configVersion: 4, config }], buys: [], deadline: 2000000000n, executorFeeBps: 100,
};
console.log("decoded explicit developer rate:", decodeV4LifecycleMarketConfig(config).developerFeeBps);
console.log("offline economic commitment:", hashLaunchPlan(plan));
console.log("5% borrow APR in ray:", rayAprToApyPercent(5n * 10n ** 25n));
console.log("health factor 1.42:", formatHealthFactor(142n * 10n ** 16n));
