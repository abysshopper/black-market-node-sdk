import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { encodeAbiParameters, parseAbiParameters } from "viem";

const sdkPath = process.env.SDK_SOURCE_TEST === "1" ? "../src/lifecycle/index.ts" : "../dist/lifecycle/index.js";
const {
  decodeAbyssLifecycleMarketConfig, decodeV4LifecycleMarketConfig,
  encodeAbyssLifecycleMarketConfig, encodeV4LifecycleMarketConfig,
} = await import(sdkPath);
const fixture = JSON.parse(await readFile(new URL("./fixtures/launch-lifecycle-v1.json", import.meta.url), "utf8"));

// Expected wire bytes are independently generated from the literal Solidity ABI,
// not from either public codec under test.
const v4 = {
  version: 4, lpFeePips: 3000, tickSpacing: 60, sqrtPriceX96: 2n ** 96n,
  hookFeePips: 10000, feeMode: 0, protocolFeeDenominator: 6,
  treasury: "0x00000000000000000000000000000000000000a0", externalLiquidityDisabled: true,
  oracleConfigId: "0xc0e9bed88d70a13fd3ab31451fefdd073b7266e838aee0ad1c236c8c9eff855d",
  profileId: `0x${"0".repeat(63)}b`, termsDigest: `0x${"0".repeat(62)}15`,
  developerBeneficiary: "0x00000000000000000000000000000000000000d0", developerFeeBps: 250,
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
  assert.deepEqual({ ...decoded, treasury: decoded.treasury.toLowerCase(), developerBeneficiary: decoded.developerBeneficiary.toLowerCase() }, v4);
});

test("V4 public config codecs reject retired or unsupported inner wire versions", () => {
  for (const version of [0, 1, 2, 3, 5]) {
    assert.throws(() => encodeV4LifecycleMarketConfig({ ...v4, version }));
    const encoded = encodeAbiParameters(
      parseAbiParameters("(uint16,uint24,int24,uint160,uint24,uint8,uint8,address,bool,bytes32,bytes32,bytes32,address,uint16,(int24,int24,uint128,bytes32,uint256)[])"),
      [[version, v4.lpFeePips, v4.tickSpacing, v4.sqrtPriceX96, v4.hookFeePips, v4.feeMode,
        v4.protocolFeeDenominator, v4.treasury, v4.externalLiquidityDisabled, v4.oracleConfigId,
        v4.profileId, v4.termsDigest, v4.developerBeneficiary, v4.developerFeeBps,
        v4.positions.map((position) => [position.tickLower, position.tickUpper, position.liquidity, position.salt, position.maxTokenAmount])]],
    );
    assert.throws(() => decodeV4LifecycleMarketConfig(encoded));
  }
});

test("reviewed codecs require creator-selected developer rates without implicit defaults", () => {
  for (const developerFeeBps of [undefined, -1, 65536, 0.5]) assert.throws(() => encodeV4LifecycleMarketConfig({ ...v4, developerFeeBps }));
  const decoded = decodeV4LifecycleMarketConfig(encodeV4LifecycleMarketConfig({ ...v4, developerFeeBps: 0 }));
  assert.equal(decoded.developerFeeBps, 0);
  assert.equal(decoded.termsDigest, v4.termsDigest);
});

test("Abyss public config codec preserves profile, oracle and large position budgets in the independent vector", () => {
  assert.equal(encodeAbyssLifecycleMarketConfig(abyss), fixture.plan.markets[1].config);
  assert.deepEqual(decodeAbyssLifecycleMarketConfig(fixture.plan.markets[1].config), abyss);
});
