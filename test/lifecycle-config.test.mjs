import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sdkPath = process.env.SDK_SOURCE_TEST === "1" ? "../src/lifecycle/index.ts" : "../dist/lifecycle/index.js";
const {
  decodeAbyssLifecycleMarketConfig, decodeV4LifecycleMarketConfig,
  encodeAbyssLifecycleMarketConfig, encodeV4LifecycleMarketConfig,
} = await import(sdkPath);
const fixture = JSON.parse(await readFile(new URL("./fixtures/launch-lifecycle-v1.json", import.meta.url), "utf8"));

// Expected wire bytes are independently generated from the literal Solidity ABI,
// not from either public codec under test.
const v4 = {
  version: 1, lpFeePips: 3000, tickSpacing: 60, sqrtPriceX96: 2n ** 96n,
  hookFeePips: 10000, feeMode: 0, protocolFeeDenominator: 6,
  treasury: "0x00000000000000000000000000000000000000a0", externalLiquidityDisabled: true,
  positions: [{ tickLower: 60, tickUpper: 120, liquidity: 10n ** 18n,
    salt: `0x${"0".repeat(63)}1`, maxTokenAmount: 10n ** 24n }],
};
const abyss = {
  profile: 3, fee: 3000, oracleConfigId: `0x${"0".repeat(62)}55`, openingSqrtPriceX96: 2n ** 96n,
  positions: [{ tickLower: 60, tickUpper: 120, liquidity: 10n ** 18n, tokenAmountMaximum: 10n ** 24n }],
};

test("V4 public config codec preserves every economic field in the independent commitment vector", () => {
  assert.equal(encodeV4LifecycleMarketConfig(v4), fixture.plan.markets[0].config);
  const decoded = decodeV4LifecycleMarketConfig(fixture.plan.markets[0].config);
  assert.deepEqual({ ...decoded, treasury: decoded.treasury.toLowerCase() }, v4);
});

test("Abyss public config codec preserves profile, oracle and large position budgets in the independent vector", () => {
  assert.equal(encodeAbyssLifecycleMarketConfig(abyss), fixture.plan.markets[1].config);
  assert.deepEqual(decodeAbyssLifecycleMarketConfig(fixture.plan.markets[1].config), abyss);
});
