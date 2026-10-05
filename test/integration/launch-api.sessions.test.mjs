import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { zeroHash } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { canonicalLaunchMetadataHash, launchAttributionTypes, LaunchApiError } from "../../dist/index.js";
import { createLaunchApiTestContext } from "./launch-api-context.mjs";

// Explicit signed metadata writes to a disposable HTTP service, never chain transactions.
const { api, chainId, orchestrator, account } = createLaunchApiTestContext({ signed: true });
const metadata = {
  name: " SDK Cafe\u0301 ",
  symbol: " SDK ",
  description: " Signed metadata-only HTTP integration. ",
  websiteUrl: " https://example.org ",
};

async function signedRequest(key, options = {}) {
  const selectedMetadata = options.metadata ?? metadata;
  const wallet = options.wallet ?? account.address;
  const nonce = `0x${randomBytes(32).toString("hex")}`;
  const deadline = options.deadline ?? BigInt(Math.floor(Date.now() / 1000)) + 600n;
  const signature = await (options.signer ?? account).signTypedData({
    domain: {
      name: "Abyss Launch Attribution",
      version: "1",
      chainId: options.domainChainId ?? chainId,
      verifyingContract: options.verifyingContract ?? orchestrator,
    },
    types: launchAttributionTypes,
    primaryType: "LaunchAttribution",
    message: {
      chainId: BigInt(chainId), wallet,
      metadataHash: canonicalLaunchMetadataHash(selectedMetadata),
      imageSha256: zeroHash, imageContentType: "", imageContentLength: 0n,
      idempotencyKey: key, nonce, deadline,
    },
  });
  return { chainId, wallet, metadata: selectedMetadata, authorization: { nonce, deadline: deadline.toString(), signature } };
}

function expectApiError(status, code) {
  return (error) => {
    assert.ok(error instanceof LaunchApiError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  };
}

test("real HTTP signed metadata session persistence, replay, and capability isolation", { timeout: 90_000 }, async (t) => {
  const key = `sdk-session-${randomUUID()}`;
  // Sign once and replay the byte-identical body; changing a deadline changes its request hash.
  const body = await signedRequest(key);
  const created = await api.createUploadSession(body, key);
  assert.match(created.sessionId, /^lus-[\da-f]{32}$/);
  assert.match(created.capability, /^lus_[\w-]{32,}$/);
  assert.equal(created.chainId, chainId);
  assert.equal(created.wallet.toLowerCase(), account.address.toLowerCase());
  assert.equal(created.status, "ready_to_launch");
  assert.deepEqual(created.metadata, {
    name: "SDK Caf\u00e9", symbol: "SDK", description: "Signed metadata-only HTTP integration.",
    websiteUrl: "https://example.org/", twitterUrl: null, telegramUrl: null, discordUrl: null,
  });
  assert.equal(created.image, null);
  assert.equal(created.upload, undefined);
  assert.equal(created.imageUrl, undefined);
  assert.equal(created.imageStatus, "none");
  assert.equal(created.metadataStatus, "ready");
  assert.equal(created.canonicalStatus, "pending");
  assert.equal(created.transactionHash, null);
  assert.equal(created.token, null);
  assert.equal(created.retryable, true);
  assert.ok(BigInt(created.sessionExpiresAt) > BigInt(created.createdAt));
  const { capability, ...representation } = created;

  await t.test("capability read returns persisted normalized metadata without reissuing secrets", async () => {
    const read = await api.getUploadSession(chainId, created.sessionId, capability);
    assert.deepEqual(read, representation);
  });
  await t.test("byte-identical idempotent replay returns the same session without its one-time capability", async () => {
    const replay = await api.createUploadSession(body, key);
    assert.deepEqual(replay, representation);
    assert.equal(replay.capability, undefined);
    assert.equal(replay.upload, undefined);
  });
  await t.test("new authorized payload cannot reuse the stored idempotency key", async () => {
    const changed = await signedRequest(key, { metadata: { ...metadata, description: "Different authorized payload" } });
    await assert.rejects(api.createUploadSession(changed, key), expectApiError(409, "IDEMPOTENCY_CONFLICT"));
    assert.deepEqual(await api.getUploadSession(chainId, created.sessionId, capability), representation);
  });
  await t.test("missing and mismatched capabilities cannot access an existing session", async () => {
    await assert.rejects(api.getUploadSession(chainId, created.sessionId, ""), expectApiError(401, "INVALID_CAPABILITY"));
    await assert.rejects(api.getUploadSession(chainId, created.sessionId, `lus_${randomBytes(32).toString("hex")}`), expectApiError(401, "INVALID_CAPABILITY"));
  });
  await t.test("a second real session cannot use the first session capability", async () => {
    const secondKey = `sdk-isolation-${randomUUID()}`;
    const second = await api.createUploadSession(await signedRequest(secondKey), secondKey);
    await assert.rejects(api.getUploadSession(chainId, second.sessionId, capability), expectApiError(401, "INVALID_CAPABILITY"));
    assert.equal((await api.getUploadSession(chainId, second.sessionId, second.capability)).sessionId, second.sessionId);
  });
});

test("real HTTP attribution authorization binds signer, metadata, domain, and idempotency key", { timeout: 90_000 }, async (t) => {
  await t.test("wrong signer is forbidden", async () => {
    const key = `sdk-wrong-signer-${randomUUID()}`;
    const signer = privateKeyToAccount(generatePrivateKey());
    await assert.rejects(api.createUploadSession(await signedRequest(key, { signer }), key), expectApiError(403, "AUTH_FORBIDDEN"));
  });
  await t.test("signature for another orchestrator is forbidden", async () => {
    const key = `sdk-wrong-core-${randomUUID()}`;
    const verifyingContract = privateKeyToAccount(generatePrivateKey()).address;
    await assert.rejects(api.createUploadSession(await signedRequest(key, { verifyingContract }), key), expectApiError(403, "AUTH_FORBIDDEN"));
  });
  await t.test("signature for another chain domain is forbidden", async () => {
    const key = `sdk-wrong-chain-${randomUUID()}`;
    await assert.rejects(api.createUploadSession(await signedRequest(key, { domainChainId: chainId + 1 }), key), expectApiError(403, "AUTH_FORBIDDEN"));
  });
  await t.test("metadata cannot be changed after signing", async () => {
    const key = `sdk-tampered-${randomUUID()}`;
    const body = await signedRequest(key);
    body.metadata = { ...body.metadata, description: "Unsigned change" };
    await assert.rejects(api.createUploadSession(body, key), expectApiError(403, "AUTH_FORBIDDEN"));
  });
  await t.test("signature cannot be replayed under another idempotency key", async () => {
    const key = `sdk-signed-key-${randomUUID()}`;
    await assert.rejects(api.createUploadSession(await signedRequest(key), `${key}-different`), expectApiError(403, "AUTH_FORBIDDEN"));
  });
  await t.test("expired authorization is rejected", async () => {
    const key = `sdk-expired-${randomUUID()}`;
    const deadline = BigInt(Math.floor(Date.now() / 1000)) - 1n;
    await assert.rejects(api.createUploadSession(await signedRequest(key, { deadline }), key), expectApiError(401, "AUTH_INVALID"));
  });
  await t.test("invalid signature encoding is rejected", async () => {
    const key = `sdk-invalid-signature-${randomUUID()}`;
    const body = await signedRequest(key);
    body.authorization.signature = "0x01";
    await assert.rejects(api.createUploadSession(body, key), expectApiError(401, "AUTH_INVALID"));
  });
});
