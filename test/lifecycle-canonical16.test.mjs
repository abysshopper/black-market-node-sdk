import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { parseLaunchPlan, computeLifecycleLaunchGasBounds } from "../dist/lifecycle/index.js";

// Public unsigned fixture, unchanged from issue #21's keyless reproducer:
// https://gist.github.com/How1337ItIs/daf1bec51f78b821297ce60a00bb578c
const bytes = readFileSync(new URL("./fixtures/canonical16-issue21.json", import.meta.url));
assert.equal(createHash("sha256").update(bytes).digest("hex"), "547b928cf2eac4b30493018486805bba0b7d72b32b4f1233c5357dd9bc10878f");
const fixture = JSON.parse(bytes);
const plan = parseLaunchPlan(JSON.stringify(fixture.plan));
const predictedToken = plan.feeAssets.find(({ asset }) => !plan.markets.some(({ quoteAsset }) => quoteAsset.toLowerCase() === asset.toLowerCase())).asset;

test("canonical16 issue21 activation budget refuses the known native activation-failure fixture", () => {
  assert.equal(plan.markets.length, 16);
  assert.equal(plan.markets.filter(({ configVersion }) => configVersion === 1).length, 9);
  assert.equal(plan.buys.length, 0);
  const bound = computeLifecycleLaunchGasBounds({ plan, predictedToken });
  assert.ok(bound.activationComputeGasUpperBound > 32_000_000n,
    `canonical16 budget ${bound.activationComputeGasUpperBound} must refuse before begin; public native activation reverted after consuming 31,991,297 gas at a 32M envelope (not a successful gas measurement)`);
});
