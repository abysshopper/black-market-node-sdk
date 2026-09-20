// Unified Launcher runner: --simulate is read-only; --execute performs API upload, WETH funding/approval, launch, and publication.
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { erc20Abi, isAddressEqual } from "viem";
import {
  ABYSS_FEE_TIERS, ABYSS_POOL_TYPE, abyssLaunchPoolAdapterV3Abi, aggregatorV3Abi,
  ATOMIC_LAUNCH_BUY_SLIPPAGE_BPS, ATOMIC_LAUNCH_DEADLINE_SECONDS, ATOMIC_LAUNCH_ORACLE_CONFIG_ID, AUCTION_SUPPLY,
  buildUnifiedLaunchCalldata, canonicalLaunchMetadataHash, createProtocolPublicClient, createProtocolWalletClient,
  deriveAtomicLaunchBuySqrtPriceLimitX96, deriveAtomicLaunchPoolRecipe, getAddresses, getLaunchTemplate, LaunchApiClient, LaunchPublishPending,
  launchAttributionTypes, launchExecutionErrorsAbi, launchPoolRegistryV3Abi, parseAmountToUnits, robinhoodMainnet,
  sha256Hex, toUnifiedLaunchRequest, toUniswapV4PoolConfig, UNISWAP_V4_V3_POOL_TYPE, unifiedLaunchValue, unifiedLauncherAbi, wethAbi,
} from "../dist/index.js";
import { getLaunchCase, LAUNCH_CASES } from "./launch-cases.mjs";

const args = process.argv.slice(2);
const option = (name) => { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1]; };
const mode = args.includes("--execute") ? "execute" : args.includes("--simulate") ? "simulate" : "list";
if (args.includes("--resume-publish")) {
  const sessionId = option("--session");
  const capability = option("--capability");
  const transactionHash = option("--transaction");
  if (!sessionId || !capability || !transactionHash) throw new Error("--resume-publish requires --session, --capability, and --transaction.");
  const chainId = Number(process.env.CHAIN_ID ?? 4663);
  const api = new LaunchApiClient({ baseUrl: process.env.LAUNCH_API_URL });
  let session;
  try {
    session = await api.publishUploadSession(chainId, sessionId, capability, { chainId, transactionHash });
  } catch (error) {
    if (!(error instanceof LaunchPublishPending)) throw error;
    session = error.session;
  }
  while (session.status === "awaiting_indexer" || session.status === "transaction_submitted") {
    await delay(5_000);
    session = await api.getUploadSession(chainId, sessionId, capability);
  }
  if (session.status === "reorged" || session.status === "rejected" || session.status === "expired") throw new Error(`Launch publication reached terminal state: ${session.status}.`);
  console.log(JSON.stringify({ transactionHash, sessionId: session.sessionId, token: session.token, status: session.status }, null, 2));
  process.exit(0);
}
if (mode === "list") {
  console.table(LAUNCH_CASES.map(({ id, template, tokenKind, profile, launched, paired }) => ({ id, template, tokenKind: tokenKind === 0 ? "Burnable" : "Holder dividend", profile: profile === 3 ? "Lighthouse" : "Beacon", launched: `${launched.ownerBps}/${launched.rewardsBps}/${launched.burnBps}`, paired: `${paired.ownerBps}/${paired.rewardsBps}/${paired.burnBps}` })));
  process.exit(0);
}
const id = option("--case");
const route = option("--route");
const pairedToken = option("--paired-token");
const pairedDecimals = Number(option("--paired-decimals"));
const feeTier = ABYSS_FEE_TIERS.find(({ feePips }) => feePips === Number(option("--fee-pips") ?? "10000"));
const initialBuyAmount = option("--initial-buy") ?? "0";
if (!id || (route !== "abyss" && route !== "uniswap-v4-v3") || !pairedToken || !Number.isInteger(pairedDecimals) || feeTier === undefined) throw new Error("Missing or invalid case, route, paired-token, paired-decimals, or fee-pips.");
if (!/^\d+(?:\.\d+)?$/.test(initialBuyAmount) || (initialBuyAmount.split(".")[1]?.length ?? 0) > pairedDecimals) throw new Error("initial-buy must be a nonnegative decimal within paired-token precision.");
const chainId = Number(process.env.CHAIN_ID ?? 4663);
if (chainId !== 4663) throw new Error("This example is pinned to current Robinhood mainnet; use a fork RPC for testing.");
const rpcUrl = process.env.RPC_URL ?? robinhoodMainnet.rpcUrls.default.http[0];
const privateKey = process.env.PRIVATE_KEY;
if (mode === "execute" && !privateKey) throw new Error("--execute requires PRIVATE_KEY.");
const client = createProtocolPublicClient({ chainId, rpcUrl });
const wallet = privateKey ? createProtocolWalletClient({ privateKey, chainId, rpcUrl }) : undefined;
const creator = wallet?.account.address ?? option("--creator");
if (!creator) throw new Error("--simulate requires --creator; --execute derives it from PRIVATE_KEY.");
const addresses = getAddresses(chainId);
const manualPrice = option("--paired-usd-x18");
const pairedUsdPriceX18 = manualPrice === undefined && isAddressEqual(pairedToken, addresses.weth) ? await (async () => {
  const [roundData, decimals] = await Promise.all([
    client.readContract({ address: addresses.ethUsdFeed, abi: aggregatorV3Abi, functionName: "latestRoundData" }),
    client.readContract({ address: addresses.ethUsdFeed, abi: aggregatorV3Abi, functionName: "decimals" }),
  ]);
  const answer = roundData[1];
  if (answer <= 0n) throw new Error("ETH/USD price feed returned a nonpositive answer.");
  return decimals <= 18 ? answer * 10n ** BigInt(18 - decimals) : answer / 10n ** BigInt(decimals - 18);
})() : manualPrice === undefined ? undefined : BigInt(manualPrice);
if (pairedUsdPriceX18 === undefined || pairedUsdPriceX18 <= 0n) throw new Error("paired-usd-x18 is required for non-WETH paired tokens.");
const preset = getLaunchCase(id);
const template = getLaunchTemplate(preset.template);
const recipe = deriveAtomicLaunchPoolRecipe({ pairedTokenDecimals: pairedDecimals, pairedTokenUsdPriceX18: pairedUsdPriceX18, targetMarketCapUsdX18: 5_000n * 10n ** 18n, launchedTokenIsQuote: template.launchedTokenIsQuote, fee: feeTier.feePips });
const initialBuyBaseUnits = parseAmountToUnits(initialBuyAmount, pairedDecimals);
if (initialBuyBaseUnits > 0n && (route !== "uniswap-v4-v3" || !isAddressEqual(pairedToken, addresses.weth))) throw new Error("This runner supports an initial buy only as WETH on the Uniswap V4 V3 route.");
const Q96 = 1n << 96n;
const postBuySqrtPriceX96 = initialBuyBaseUnits === 0n ? undefined : template.launchedTokenIsQuote ? recipe.launchSqrtPriceX96 + (initialBuyBaseUnits * Q96) / recipe.liquidity : (() => { const numerator = recipe.liquidity * Q96 * recipe.launchSqrtPriceX96; const denominator = recipe.liquidity * Q96 + initialBuyBaseUnits * recipe.launchSqrtPriceX96; return (numerator + denominator - 1n) / denominator; })();
const startedAt = Date.now();
const request = {
  creator, templateId: template.templateId, templateVersion: template.version,
  token: { kind: preset.tokenKind, name: option("--name") ?? `SDK ${preset.id} ${startedAt}`, symbol: option("--symbol") ?? `SDK${startedAt.toString(36).slice(-5).toUpperCase()}`, decimals: 18, supply: AUCTION_SUPPLY },
  pool: { pairedToken, launchedTokenIsQuote: template.launchedTokenIsQuote, profile: preset.profile, fee: feeTier.feePips, oracleConfigId: ATOMIC_LAUNCH_ORACLE_CONFIG_ID, launchTick: recipe.launchTick, liquidity: recipe.liquidity, launchedTokenAmountMaximum: recipe.launchedTokenAmountMaximum, pairedTokenAmountMaximum: 0n },
  initialBuy: { pairedTokenAmountIn: initialBuyBaseUnits, launchedTokenAmountOutMinimum: 0n, sqrtPriceLimitX96: postBuySqrtPriceX96 === undefined ? 0n : deriveAtomicLaunchBuySqrtPriceLimitX96({ launchSqrtPriceX96: postBuySqrtPriceX96, launchedTokenIsQuote: template.launchedTokenIsQuote, slippageBps: ATOMIC_LAUNCH_BUY_SLIPPAGE_BPS }) },
  launchedTokenFees: preset.launched, pairedTokenFees: preset.paired, deadline: BigInt(Math.floor(startedAt / 1000) + ATOMIC_LAUNCH_DEADLINE_SECONDS),
};
if (route === "uniswap-v4-v3") {
  const [adapter, disabled] = await client.readContract({ address: addresses.launchPoolRegistry, abi: launchPoolRegistryV3Abi, functionName: "poolTypes", args: [UNISWAP_V4_V3_POOL_TYPE] });
  if (disabled || !isAddressEqual(adapter, addresses.uniswapV4V3Adapter)) {
    throw new Error("The active Uniswap V4 V3 deployment is not enabled at the recorded registry binding.");
  }
}
let pool = route === "abyss" ? { kind: route, config: request.pool } : { kind: route, config: toUniswapV4PoolConfig(request.pool, recipe.launchSqrtPriceX96, feeTier.tickSpacing, true) };
let unified = toUnifiedLaunchRequest(request, pool);
const value = unifiedLaunchValue(route, 0n);
if (initialBuyBaseUnits > 0n && mode === "execute") {
  const balance = await client.readContract({ address: pairedToken, abi: erc20Abi, functionName: "balanceOf", args: [creator] });
  if (balance < initialBuyBaseUnits) {
    const hash = await wallet.writeContract({ address: pairedToken, abi: wethAbi, functionName: "deposit", value: initialBuyBaseUnits - balance });
    if ((await client.waitForTransactionReceipt({ hash })).status !== "success") throw new Error(`WETH wrapping reverted: ${hash}`);
  }
  const allowance = await client.readContract({ address: pairedToken, abi: erc20Abi, functionName: "allowance", args: [creator, addresses.unifiedLauncher] });
  if (allowance < initialBuyBaseUnits) {
    const hash = await wallet.writeContract({ address: pairedToken, abi: erc20Abi, functionName: "approve", args: [addresses.unifiedLauncher, initialBuyBaseUnits] });
    if ((await client.waitForTransactionReceipt({ hash })).status !== "success") throw new Error(`WETH approval reverted: ${hash}`);
  }
}
if (initialBuyBaseUnits > 0n) {
  const provisional = await client.simulateContract({ address: addresses.unifiedLauncher, abi: [...unifiedLauncherAbi, ...launchExecutionErrorsAbi], functionName: "launch", args: [unified], account: creator, value });
  const output = provisional.result.initialBuyLaunchedTokenAmount;
  if (output === 0n) throw new Error("Initial-buy simulation returned zero launched tokens.");
  const protectedRequest = { ...request, initialBuy: { ...request.initialBuy, launchedTokenAmountOutMinimum: (output * BigInt(10_000 - ATOMIC_LAUNCH_BUY_SLIPPAGE_BPS)) / 10_000n } };
  pool = route === "abyss" ? { kind: route, config: protectedRequest.pool } : { kind: route, config: toUniswapV4PoolConfig(protectedRequest.pool, recipe.launchSqrtPriceX96, feeTier.tickSpacing, true) };
  unified = toUnifiedLaunchRequest(protectedRequest, pool);
}
await client.simulateContract({ address: addresses.unifiedLauncher, abi: [...unifiedLauncherAbi, ...launchExecutionErrorsAbi], functionName: "launch", args: [unified], account: creator, value });
if (mode !== "execute") { console.log("simulation succeeded; no signature, API request, upload, or transaction was made."); process.exit(0); }
const imagePath = option("--image");
const imageContentType = option("--image-content-type");
if ((imagePath === undefined) !== (imageContentType === undefined)) throw new Error("Provide --image and --image-content-type together.");
const imageBytes = imagePath === undefined ? undefined : await readFile(imagePath);
const imageSha256 = imageBytes === undefined ? `0x${"00".repeat(32)}` : await sha256Hex(imageBytes.buffer.slice(imageBytes.byteOffset, imageBytes.byteOffset + imageBytes.byteLength));
const metadata = { name: request.token.name, symbol: request.token.symbol, description: option("--description") ?? "", websiteUrl: option("--website"), twitterUrl: option("--twitter"), telegramUrl: option("--telegram"), discordUrl: option("--discord") };
const api = new LaunchApiClient({ baseUrl: process.env.LAUNCH_API_URL });
const idempotencyKey = crypto.randomUUID();
const nonce = `0x${crypto.randomUUID().replaceAll("-", "").padEnd(64, "0")}`;
const attributionDeadline = BigInt(Math.floor(Date.now() / 1000) + 15 * 60);
const signature = await wallet.signTypedData({ account: wallet.account, domain: { name: "Abyss Launch Attribution", version: "1", chainId, verifyingContract: addresses.unifiedLauncher }, types: launchAttributionTypes, primaryType: "LaunchAttribution", message: { chainId: BigInt(chainId), wallet: creator, metadataHash: canonicalLaunchMetadataHash(metadata), imageSha256, imageContentType: imageContentType ?? "", imageContentLength: BigInt(imageBytes?.byteLength ?? 0), idempotencyKey, nonce, deadline: attributionDeadline } });
let session = await api.createUploadSession({ chainId, wallet: creator, metadata, ...(imageBytes === undefined ? {} : { image: { sha256: imageSha256, contentType: imageContentType, contentLength: imageBytes.byteLength } }), authorization: { nonce, deadline: attributionDeadline.toString(), signature } }, idempotencyKey);
const sessionId = session.sessionId;
const sessionCapability = session.capability;
if (sessionCapability === undefined) throw new Error("The API did not issue the required private session capability.");
if (imageBytes !== undefined) { if (session.upload === undefined) throw new Error("The API did not issue the image upload URL."); await api.putImage(session.upload, new Blob([imageBytes], { type: imageContentType })); session = await api.completeUpload(chainId, sessionId, sessionCapability); }
if (session.status !== "ready_to_launch") throw new Error(`Launch API session is not ready: ${session.status}.`);
console.log(JSON.stringify({ apiSessionId: sessionId, apiCapability: sessionCapability, apiStatus: session.status }, null, 2));
const launchHash = await wallet.writeContract({ address: addresses.unifiedLauncher, abi: unifiedLauncherAbi, functionName: "launch", args: [unified], value });
console.log("submitted:", launchHash);
if ((await client.waitForTransactionReceipt({ hash: launchHash })).status !== "success") throw new Error(`Launch transaction reverted: ${launchHash}`);
let published;
try {
  published = await api.publishUploadSession(chainId, sessionId, sessionCapability, { chainId, transactionHash: launchHash });
} catch (error) {
  if (!(error instanceof LaunchPublishPending)) throw error;
  published = error.session;
  while (published.status === "awaiting_indexer" || published.status === "transaction_submitted") {
    await delay(error.retryAfterMs);
    published = await api.getUploadSession(chainId, sessionId, sessionCapability);
  }
}
if (published.status === "reorged" || published.status === "rejected" || published.status === "expired") throw new Error(`Launch publication reached terminal state: ${published.status}.`);
console.log(JSON.stringify({ transactionHash: launchHash, sessionId: published.sessionId, token: published.token, status: published.status }, null, 2));
