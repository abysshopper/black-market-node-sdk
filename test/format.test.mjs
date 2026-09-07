import assert from "node:assert/strict";
import test from "node:test";
import {
  BPS,
  formatHealthFactor,
  formatUnitsDisplay,
  healthFactorStatus,
  parseAmountToUnits,
  parseHealthFactorToWad,
  RAY,
  rayAprToApyPercent,
  rayToPercent,
  utilizationFromReserve,
  WAD,
} from "../dist/index.js";

test("RAY, WAD, and BPS are the canonical fixed-point bases", () => {
  assert.equal(RAY, 10n ** 27n);
  assert.equal(WAD, 10n ** 18n);
  assert.equal(BPS, 10_000n);
});

test("rayToPercent converts ray rates to basis-point-truncated fractions", () => {
  assert.equal(rayToPercent(0n), 0);
  // 5% APR == 0.05 ray == 0.05 as a fraction
  assert.equal(rayToPercent(5n * 10n ** 25n), 0.05);
  // truncation at basis-point precision: 0.1234% -> 0.0012
  assert.equal(rayToPercent(1_234n * 10n ** 21n), 0.0012);
});

test("rayAprToApyPercent reports simple (uncompounded) APY", () => {
  assert.equal(rayAprToApyPercent(10n ** 27n), 100);
  assert.equal(rayAprToApyPercent(35n * 10n ** 24n), 3.5);
});

test("formatHealthFactor renders wad health factors with ∞ and — sentinels", () => {
  assert.equal(formatHealthFactor(0n), "—");
  assert.equal(formatHealthFactor(142n * 10n ** 16n), "1.42");
  // Type(uint256).max — no open borrows — renders as ∞
  assert.equal(formatHealthFactor(2n ** 256n - 1n), "∞");
});

test("healthFactorStatus buckets the documented thresholds", () => {
  assert.equal(healthFactorStatus(0n), "none");
  assert.equal(healthFactorStatus(2n ** 256n - 1n), "safe");
  assert.equal(healthFactorStatus(104n * 10n ** 16n), "danger");
  assert.equal(healthFactorStatus(149n * 10n ** 16n), "watch");
  assert.equal(healthFactorStatus(15n * 10n ** 17n), "safe");
});

test("parseHealthFactorToWad parses decimals and rejects invalid input", () => {
  assert.equal(parseHealthFactorToWad("1.25"), 125n * 10n ** 16n);
  assert.equal(parseHealthFactorToWad(" 2 "), 2n * 10n ** 18n);
  assert.equal(parseHealthFactorToWad(""), undefined);
  assert.equal(parseHealthFactorToWad("0"), undefined);
  assert.equal(parseHealthFactorToWad("-1.5"), undefined);
  assert.equal(parseHealthFactorToWad("abc"), undefined);
});

test("parseAmountToUnits pads and truncates fractional digits to the token decimals", () => {
  assert.equal(parseAmountToUnits("1.5", 18), 15n * 10n ** 17n);
  assert.equal(parseAmountToUnits("250.123456789", 6), 250_123_456n);
  assert.equal(parseAmountToUnits("0.0000001", 6), 0n);
  assert.equal(parseAmountToUnits("", 18), 0n);
  assert.equal(parseAmountToUnits(".", 18), 0n);
});

test("formatUnitsDisplay trims trailing zeros and preserves signs", () => {
  assert.equal(formatUnitsDisplay(0n, 18), "0");
  assert.equal(formatUnitsDisplay(15n * 10n ** 17n, 18), "1.5");
  assert.equal(formatUnitsDisplay(12_345n * 10n ** 14n, 18), "1.2345");
  // digits cap truncates (no rounding up)
  assert.equal(formatUnitsDisplay(12_399n * 10n ** 14n, 18), "1.2399");
  assert.equal(formatUnitsDisplay(-25n * 10n ** 17n, 18), "-2.5");
  // whole-unit balances render without a decimal point
  assert.equal(formatUnitsDisplay(3n * 10n ** 6n, 6), "3");
});

test("utilizationFromReserve is a zero-safe debt share in percent", () => {
  assert.equal(utilizationFromReserve(0n, 0n), 0);
  assert.equal(utilizationFromReserve(80n, 20n), 20);
  assert.equal(utilizationFromReserve(0n, 7n), 100);
});
