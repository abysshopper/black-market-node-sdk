import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { LaunchApiError } from "../../dist/index.js";
import { createLaunchApiTestContext } from "./launch-api-context.mjs";

// This suite never creates a session, signs, uploads, publishes, or sends a chain transaction.
const { api, chainId } = createLaunchApiTestContext();

test("real HTTP session reads require a capability", { timeout: 15_000 }, async () => {
  await assert.rejects(api.getUploadSession(chainId, randomUUID(), ""), (error) => {
    assert.ok(error instanceof LaunchApiError);
    assert.equal(error.status, 401);
    assert.equal(error.code, "INVALID_CAPABILITY");
    return true;
  });
});

test("real HTTP session reads reject malformed capabilities", { timeout: 15_000 }, async () => {
  await assert.rejects(api.getUploadSession(chainId, randomUUID(), "not a capability"), (error) => {
    assert.ok(error instanceof LaunchApiError);
    assert.equal(error.status, 401);
    assert.equal(error.code, "INVALID_CAPABILITY");
    return true;
  });
});

test("real HTTP session reads report a nonexistent session without disclosing a capability", { timeout: 15_000 }, async () => {
  await assert.rejects(api.getUploadSession(chainId, randomUUID(), `lus_${randomUUID().replaceAll("-", "")}`), (error) => {
    assert.ok(error instanceof LaunchApiError);
    assert.equal(error.status, 404);
    assert.equal(error.code, "NOT_FOUND");
    return true;
  });
});
