import assert from "node:assert/strict";
import test from "node:test";
import { LAUNCH_CASES } from "../examples/launch-cases.mjs";

test("launch example matrix covers every template on both current routes", () => {
  assert.equal(LAUNCH_CASES.length, 18);
  assert.deepEqual(new Set(LAUNCH_CASES.map(({ template }) => template)), new Set(["standard", "quote-staking", "quote-dividends", "dual-staking", "dual-dividends", "fee-burn"]));
  for (const launchCase of LAUNCH_CASES) {
    for (const fees of [launchCase.launched, launchCase.paired]) {
      assert.equal(fees.ownerBps + fees.rewardsBps + fees.burnBps, fees.ownerBps === 0 && fees.rewardsBps === 0 && fees.burnBps === 0 ? 0 : 10_000, launchCase.id);
    }
  }
});

test("Lighthouse examples use quote-oracle profile and dual templates remain Beacon", () => {
  const lighthouse = LAUNCH_CASES.filter(({ id }) => id.includes("lighthouse"));
  assert.ok(lighthouse.length > 0);
  assert.ok(lighthouse.every(({ profile }) => profile === 3));
  assert.ok(LAUNCH_CASES.filter(({ template }) => template.startsWith("dual-")).every(({ profile }) => profile === 1));
});
