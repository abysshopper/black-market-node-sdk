import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  errorEvidence, loopbackUrl, parseArguments, publishUntilIndexed, Redactor,
  rpcRequestSignal, RunArtifacts, smokeError, submitRecorded,
} from "../examples/smoke-launch-support.mjs";

const hash = `0x${"ab".repeat(32)}`;
const revertData = "0xdeadbeef0000000000000000000000000000000000000000000000000000000000000001";
const transaction = { id: "activate", kind: "activate", wire: { from: `0x${"11".repeat(20)}`, to: `0x${"22".repeat(20)}`, data: revertData, value: "0x0", gas: "0x100000", gasPrice: "0x1", nonce: "0x0", chainId: "0x1237" } };
function run(t) {
  const parent = mkdtempSync(join(tmpdir(), "node-launch-smoke-unit-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const artifacts = new RunArtifacts(join(parent, "run"), "diagnostic-boundary");
  artifacts.initialize();
  return artifacts;
}
const json = (artifacts, name) => JSON.parse(readFileSync(join(artifacts.directory, name), "utf8"));

// Diagnostic boundaries only. These tests do not pretend to deploy a token,
// simulate a chain, or prove publication against a mocked API/indexer.
test("recursive evidence redaction preserves selector/calldata/cause and public capabilities", () => {
  const redactor = new Redactor();
  const signature = `0x${"cd".repeat(65)}`;
  const capability = "lus_private_recovery_capability_value";
  redactor.addSecret(signature); redactor.addSecret(capability);
  const cause = Object.assign(new Error(`execution reverted ${revertData}`), { code: -32000, data: { data: revertData } });
  const failure = Object.assign(new Error(`signature=${signature}; ${capability}; RPC https://user:password@example.org/path?credential=secret`), { code: "PLAN_NOT_ADMITTED", cause, data: { nested: { signature, capability, privateKey: "disposable-private", mnemonic: "secret words", headers: { Authorization: "Bearer hidden", "X-API-Key": "hidden-api-key" } }, capabilities: 123n, transaction: { data: revertData, token: transaction.wire.to }, url: "https://object.example.org/item?X-Amz-Signature=signed-query" } });
  const evidence = redactor.value(errorEvidence(failure));
  const text = JSON.stringify(evidence);
  for (const secret of [signature, capability, "disposable-private", "secret words", "password@example", "credential=secret", "signed-query", "hidden-api-key", "Bearer hidden"]) assert.ok(!text.includes(secret), secret);
  assert.equal(evidence.cause.code, -32000);
  assert.equal(evidence.cause.data.data, revertData);
  assert.equal(evidence.data.transaction.data, revertData);
  assert.equal(evidence.data.transaction.token, transaction.wire.to);
  assert.equal(evidence.data.capabilities, "123");
  assert.equal(evidence.code, "PLAN_NOT_ADMITTED");
  assert.match(evidence.stack, /signature=\[REDACTED\]/);
});

test("one-time recovery secrets exist only in a mode0600 file", (t) => {
  const artifacts = run(t);
  const capability = "lus_owned_session_recovery_value";
  const signature = `0x${"12".repeat(65)}`;
  artifacts.redactor.addSecret(capability); artifacts.redactor.addSecret(signature);
  artifacts.privateRecovery({ capability, authorization: { signature } });
  artifacts.result.api.session = { capability, authorization: { signature } };
  artifacts.event("session", { capability, authorization: { signature } });
  artifacts.finish("failed", smokeError("API_NOT_READY", `Do not log ${capability} or ${signature}`));
  assert.equal(statSync(join(artifacts.directory, "private-recovery.json")).mode & 0o777, 0o600);
  assert.equal(json(artifacts, "private-recovery.json").capability, capability);
  for (const name of ["events.jsonl", "result.json", "receipts.json"]) {
    const text = readFileSync(join(artifacts.directory, name), "utf8");
    assert.ok(!text.includes(capability)); assert.ok(!text.includes(signature));
  }
});

test("exclusive output refuses reuse without overwriting recovery evidence", (t) => {
  const artifacts = run(t);
  artifacts.finish("failed", smokeError("ORIGINAL", "Keep original failure"));
  assert.throws(() => new RunArtifacts(artifacts.directory, "other-case"), { code: "EEXIST" });
  assert.equal(json(artifacts, "result.json").error.code, "ORIGINAL");
});

test("submitted hash/envelope are durably stored before polling can fail", async (t) => {
  const artifacts = run(t);
  artifacts.stage("submit-activate");
  const failure = smokeError("RECEIPT_TIMEOUT", "The actual receipt has not arrived");
  await assert.rejects(submitRecorded({ transaction, artifacts,
    send: async () => hash,
    wait: async (submitted) => {
      assert.equal(submitted, hash);
      const stored = json(artifacts, "receipts.json").transactions[0];
      assert.equal(stored.transactionHash, hash); assert.deepEqual(stored.transaction, transaction.wire);
      assert.equal(stored.status, "submitted"); assert.equal(stored.receipt, null);
      throw failure;
    },
  }), failure);
  artifacts.finish("failed", failure);
  const result = json(artifacts, "result.json");
  assert.equal(result.schema, "black-market.launch-smoke-result.v1");
  assert.equal(result.stage, "submit-activate"); assert.equal(result.status, "failed");
  assert.equal(result.chain.transactions[0].transactionHash, hash);
  assert.equal(result.error.code, "RECEIPT_TIMEOUT");
});

test("interruption after submission preserves the hash before honoring abort", async (t) => {
  const artifacts = run(t);
  const controller = new AbortController();
  const interruption = smokeError("INTERRUPTED", "Local state retained");
  let waited = false;
  await assert.rejects(submitRecorded({ transaction, artifacts, signal: controller.signal,
    send: async () => { controller.abort(interruption); return hash; },
    wait: async () => { waited = true; },
  }), interruption);
  assert.equal(waited, false);
  assert.equal(json(artifacts, "receipts.json").transactions[0].transactionHash, hash);
});

test("reverted receipt survives later status validation and terminal failure", async (t) => {
  const artifacts = run(t);
  const receipt = { transactionHash: hash, status: "0x0", blockNumber: "0x1", blockHash: hash, gasUsed: "0x999", logs: [] };
  const submitted = await submitRecorded({ transaction, artifacts, send: async () => hash, wait: async () => receipt });
  assert.equal(submitted.receipt.status, "0x0");
  assert.deepEqual(json(artifacts, "receipts.json").transactions[0].receipt, receipt);
  artifacts.finish("failed", smokeError("TRANSACTION_REVERTED", "Actual launch reverted", { receipt, revertData }));
  assert.equal(json(artifacts, "result.json").chain.transactions[0].receipt.status, "0x0");
  assert.equal(json(artifacts, "result.json").error.revertData, revertData);
});

test("pending publication respects server delay and uses a decreasing deadline", async (t) => {
  const artifacts = run(t);
  let clock = 0; const sleeps = []; const remaining = [];
  const pending = Object.assign(new Error("pending"), { pending: true, session: { status: "awaiting_indexer", token: null }, retryAfterMs: 5000 });
  const result = await publishUntilIndexed({ artifacts, timeoutMs: 10_000, now: () => clock,
    isPending: (error) => error.pending === true,
    sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    publish: async (ms) => { remaining.push(ms); if (remaining.length === 1) throw pending; return { status: "optimistic" }; },
  });
  assert.deepEqual(sleeps, [5000]); assert.deepEqual(remaining, [10000, 5000]);
  assert.equal(result.status, "optimistic");
});

test("pending indexing expires without an extra publication after deadline", async (t) => {
  const artifacts = run(t);
  let clock = 0; let calls = 0;
  await assert.rejects(publishUntilIndexed({ artifacts, timeoutMs: 1000, now: () => clock,
    isPending: (error) => error.pending === true,
    sleep: async (ms) => { assert.equal(ms, 1000); clock += ms; },
    publish: async () => { calls += 1; throw Object.assign(new Error("pending"), { pending: true, session: {}, retryAfterMs: 5000 }); },
  }), { code: "PUBLISH_TIMEOUT" });
  assert.equal(calls, 1);
});

test("non-pending API errors fail immediately instead of retrying or relaunching", async (t) => {
  const artifacts = run(t);
  let calls = 0;
  const failure = Object.assign(new Error("Real indexer unavailable"), { status: 503, code: "INDEXER_UNAVAILABLE" });
  await assert.rejects(publishUntilIndexed({ artifacts, timeoutMs: 1000,
    isPending: () => false,
    sleep: async () => assert.fail("API error must not sleep"),
    publish: async () => { calls += 1; throw failure; },
  }), failure);
  assert.equal(calls, 1); assert.equal(artifacts.transactions.length, 0);
});

test("late publication success cannot become an in-bound pass", async (t) => {
  const artifacts = run(t);
  let clock = 0;
  await assert.rejects(publishUntilIndexed({ artifacts, timeoutMs: 1000, now: () => clock,
    isPending: () => false,
    publish: async () => { clock = 1001; return { status: "final" }; },
  }), { code: "PUBLISH_TIMEOUT" });
});

test("local endpoint and CLI guards require explicit one-case write authorization", () => {
  const options = parseArguments(["--fixture", "fixture.json", "--case", "erc20-v4-basic", "--output", "fresh"]);
  assert.equal(options.execute, false); assert.equal(options.publishTimeoutSeconds, 90);
  assert.equal(parseArguments(["--fixture", "fixture.json", "--list"]).list, true);
  assert.throws(() => parseArguments(["--fixture", "fixture.json", "--list", "--execute"]), { code: "INVALID_ARGUMENT" });
  assert.throws(() => parseArguments(["--fixture", "fixture.json", "--case", "one", "--output", "new", "--chain-only", "--api-url", "http://127.0.0.1:1"]), { code: "INVALID_ARGUMENT" });
  for (const value of ["https://api.abyss.trading", "http://127.0.0.1.evil:1", "http://user:pass@localhost:1", "http://localhost:1?auth=secret", "http://localhost:1/proxy"]) assert.throws(() => loopbackUrl(value, "API"), { code: "UNSAFE_ENDPOINT" });
  assert.equal(loopbackUrl("http://127.0.0.1:18764", "API"), "http://127.0.0.1:18764/");
});

test("interruption refuses more work but permits bounded simulation-only cleanup", () => {
  const controller = new AbortController();
  const failure = smokeError("INTERRUPTED", "Preserve source state and restore simulation");
  controller.abort(failure);
  assert.throws(() => rpcRequestSignal(controller.signal, "execution", "eth_sendTransaction"), failure);
  assert.throws(() => rpcRequestSignal(controller.signal, "simulation", "eth_sendTransaction"), failure);
  assert.throws(() => rpcRequestSignal(controller.signal, "execution", "evm_revert"), failure);
  assert.equal(rpcRequestSignal(controller.signal, "simulation", "evm_revert").aborted, false);
  assert.equal(rpcRequestSignal(controller.signal, "simulation", "anvil_stopImpersonatingAccount").aborted, false);
});

test("serialized diagnostic JSON redacts secrets without treating repeated objects as cycles", () => {
  const redactor = new Redactor();
  const shared = { data: revertData };
  const value = redactor.value({
    serializedError: JSON.stringify({ signature: "unregistered-signature", nested: { privateKey: "unregistered-key", capabilities: "123", data: revertData } }),
    first: shared, second: shared,
  });
  assert.ok(!value.serializedError.includes("unregistered-signature"));
  assert.ok(!value.serializedError.includes("unregistered-key"));
  assert.equal(JSON.parse(value.serializedError).nested.data, revertData);
  assert.equal(JSON.parse(value.serializedError).nested.capabilities, "123");
  assert.equal(value.first.data, revertData); assert.equal(value.second.data, revertData);
});
