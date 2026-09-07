import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ABBY_DEPLOYMENT, abbyCalldata } from "../examples/abby-launch.mjs";

const source = JSON.parse(readFileSync(new URL("./fixtures/abby-launch.json", import.meta.url), "utf8"));

test("Abby example reproduces the successful mainnet transaction input", () => {
  assert.equal(abbyCalldata, source.calldata);
  assert.equal(ABBY_DEPLOYMENT.transactionHash, source.transactionHash);
  assert.equal(ABBY_DEPLOYMENT.token.toLowerCase(), source.token.toLowerCase());
  assert.equal(ABBY_DEPLOYMENT.pool.toLowerCase(), source.pool.toLowerCase());
});
