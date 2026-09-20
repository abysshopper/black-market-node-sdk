import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, encodeAbiParameters, toFunctionSelector } from "viem";
import * as sdk from "../dist/index.js";

const creator = "0x1000000000000000000000000000000000000000";
const pairedToken = "0x2000000000000000000000000000000000000000";
const baseRequest = {
  creator, templateId: sdk.STANDARD_TEMPLATE_ID, templateVersion: 1,
  token: { kind: sdk.TokenKind.Burnable, name: "Current Token", symbol: "NOW", decimals: 18, supply: 1_000_000n },
  pool: { pairedToken, launchedTokenIsQuote: false, profile: sdk.AbyssPoolProfile.StandardOracle, fee: 3_000, oracleConfigId: sdk.ATOMIC_LAUNCH_ORACLE_CONFIG_ID, launchTick: 0, liquidity: 1_000n, launchedTokenAmountMaximum: 1_000_000n, pairedTokenAmountMaximum: 0n },
  initialBuy: { pairedTokenAmountIn: 0n, launchedTokenAmountOutMinimum: 0n, sqrtPriceLimitX96: 0n },
  launchedTokenFees: { ownerBps: 10_000, rewardsBps: 0, burnBps: 0 }, pairedTokenFees: { ownerBps: 10_000, rewardsBps: 0, burnBps: 0 }, deadline: 1_000n,
};

test("current deployer encodes the Unified Launcher V3 envelope", () => {
  const request = sdk.toUnifiedLaunchRequest(baseRequest, { kind: "abyss", config: baseRequest.pool });
  assert.equal(request.poolType, sdk.ABYSS_POOL_TYPE);
  assert.equal(request.token.tokenType, sdk.launchTokenTypeBurnableFixedV2);
  assert.equal(request.token.tokenConfig, "0x");
  const data = sdk.buildUnifiedLaunchCalldata(request);
  assert.equal(data.slice(0, 10), toFunctionSelector("launch((address,bytes32,bytes32,uint32,(bytes32,bytes,string,string,uint8,uint256),bytes,(uint256,uint256,uint160),(uint16,uint16,uint16),(uint16,uint16,uint16),uint256))"));
  assert.deepEqual(decodeFunctionData({ abi: sdk.unifiedLauncherAbi, data }).args[0], request);
});

test("active Uniswap V4 V3 route preserves its ten-field V2 wire layout", () => {
  const config = sdk.toUniswapV4PoolConfig(baseRequest.pool, 2n ** 96n, 60, true);
  assert.equal(config.liquidity, 998n);
  assert.deepEqual(sdk.uniswapV4PoolConfigComponents.map(({ name }) => name), ["pairedToken", "profile", "oracleConfigId", "tickLower", "tickUpper", "sqrtPriceX96", "liquidity", "launchedTokenAmountMaximum", "abyssFeePips", "externalLiquidityDisabled"]);
  const wire = sdk.encodeUniswapV4PoolConfig(config);
  assert.equal(wire, encodeAbiParameters([{ type: "tuple", components: sdk.uniswapV4PoolConfigComponents }], [config]));
  const request = sdk.toUnifiedLaunchRequest(baseRequest, { kind: "uniswap-v4-v3", config });
  assert.equal(request.poolType, sdk.UNISWAP_V4_V3_POOL_TYPE);
  assert.equal(sdk.unifiedLaunchValue("uniswap-v4-v3", 10n, 7n), 0n);
  assert.equal(sdk.unifiedLaunchValue("abyss", 10n, 7n), 17n);
});

test("mainnet address catalog targets the current unified deployer and optimized V4 route", () => {
  assert.equal(sdk.addresses[4663].unifiedLauncher, "0xa7a4755fb907593f05fd1e289aa780f0d57f3a12");
  assert.equal(sdk.addresses[4663].uniswapV4V3Adapter, "0x9607ddc99381f18985770b4f93685ed90220bc98");
});

test("API client uses chain-scoped session protocol without network access", async () => {
  let request;
  const client = new sdk.LaunchApiClient({ baseUrl: "https://api.example", fetch: async (url, init) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({ sessionId: "s", chainId: 4663, wallet: creator, status: "ready_to_launch", metadata: {}, image: null, canonicalStatus: "pending", metadataStatus: "queued", imageStatus: "none", retryable: false, createdAt: "", updatedAt: "", sessionExpiresAt: "" }), { status: 201 });
  } });
  await client.createUploadSession({ chainId: 4663, wallet: creator, metadata: { name: "N", symbol: "S", description: "" }, authorization: { nonce: `0x${"00".repeat(32)}`, deadline: "1", signature: `0x${"00".repeat(65)}` } }, "idempotency");
  assert.equal(request.init.headers["Idempotency-Key"], "idempotency");
});
