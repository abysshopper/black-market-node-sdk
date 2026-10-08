import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { keccak256, parseTransaction, recoverTransactionAddress, recoverTypedDataAddress, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createLocalLaunchWallet, errorEvidence, executionRpcUrl, launchApiUrl,
  publishUntilIndexed, readExampleConfiguration, Redactor, registerEndpointSecrets,
  rpcRequestSignal, RunArtifacts, exampleError, submitSignedRecorded,
} from "../examples/launch-example-support.mjs";
import { verifyLaunchInventory } from "../examples/launch-example.mjs";

const hash = `0x${"ab".repeat(32)}`;
const revertData = "0xdeadbeef0000000000000000000000000000000000000000000000000000000000000001";
const transaction = { id: "activate", kind: "activate", wire: { from: `0x${"11".repeat(20)}`, to: `0x${"22".repeat(20)}`, data: revertData, value: "0x0", gas: "0x100000", gasPrice: "0x1", nonce: "0x0", chainId: "0x1237" } };
function run(t) {
  const parent = mkdtempSync(join(tmpdir(), "node-launch-example-unit-"));
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
});

test("one-time recovery secrets exist only in a mode0600 file", (t) => {
  const artifacts = run(t);
  const capability = "lus_owned_session_recovery_value";
  const signature = `0x${"12".repeat(65)}`;
  artifacts.redactor.addSecret(capability); artifacts.redactor.addSecret(signature);
  artifacts.privateRecovery({ capability, authorization: { signature } });
  artifacts.result.api.session = { capability, authorization: { signature } };
  artifacts.event("session", { capability, authorization: { signature } });
  artifacts.finish("failed", exampleError("API_NOT_READY", `Do not log ${capability} or ${signature}`));
  assert.equal(statSync(join(artifacts.directory, "private-recovery.json")).mode & 0o777, 0o600);
  assert.equal(json(artifacts, "private-recovery.json").capability, capability);
  for (const name of ["events.jsonl", "result.json", "receipts.json"]) {
    const text = readFileSync(join(artifacts.directory, name), "utf8");
    assert.ok(!text.includes(capability)); assert.ok(!text.includes(signature));
  }
});

test("exclusive output refuses reuse without overwriting recovery evidence", (t) => {
  const artifacts = run(t);
  artifacts.finish("failed", exampleError("ORIGINAL", "Keep original failure"));
  assert.throws(() => new RunArtifacts(artifacts.directory, "other-case"), { code: "EEXIST" });
  assert.equal(json(artifacts, "result.json").error.code, "ORIGINAL");
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

test("interruption refuses more work but permits bounded simulation-only cleanup", () => {
  const controller = new AbortController();
  const failure = exampleError("INTERRUPTED", "Preserve source state and restore simulation");
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

const signingKey = `0x${"42".repeat(32)}`;
const signingCreator = privateKeyToAccount(signingKey).address;
function localSigner(artifacts, request) {
  const client = { request: request ?? (async ({ method }) => {
    assert.equal(method, "eth_chainId");
    return "0x1237";
  }) };
  return { client, wallet: createLocalLaunchWallet({
    privateKey: signingKey, creator: signingCreator, chainId: 4663,
    orchestrator: transaction.wire.to, client, redactor: artifacts.redactor,
  }) };
}
const signingTransaction = { ...transaction, wire: { ...transaction.wire, from: signingCreator } };

test("example endpoint guards accept HTTPS and owned loopback, never insecure remote writes", () => {
  assert.equal(executionRpcUrl("https://provider.example/credential?api_key=secret"), "https://provider.example/credential?api_key=secret");
  assert.equal(executionRpcUrl("http://127.0.0.1:8545"), "http://127.0.0.1:8545/");
  for (const url of ["http://provider.example", "ftp://provider.example", "https://provider.example/#secret"]) assert.throws(() => executionRpcUrl(url), { code: "UNSAFE_ENDPOINT" });
  assert.equal(launchApiUrl("https://api.example"), "https://api.example/");
  assert.equal(launchApiUrl("http://127.0.0.1:18763"), "http://127.0.0.1:18763/");
  for (const url of ["http://api.example", "https://user:secret@api.example", "https://api.example/private", "https://api.example/?key=secret"]) assert.throws(() => launchApiUrl(url), { code: "UNSAFE_ENDPOINT" });
});

test("RPC URL credential path/query values are registered before public errors", () => {
  const redactor = new Redactor();
  registerEndpointSecrets(redactor, "https://user:pass@rpc.example/v2/credential-path?api_key=credential-query");
  const text = redactor.text("RPC credential-path credential-query user pass https://user:pass@rpc.example/v2/credential-path?api_key=credential-query");
  for (const secret of ["credential-path", "credential-query", "user", "pass"]) assert.ok(!text.includes(secret));
});

test("local wallet signs exact legacy and EIP1559 fields without unlocked RPC", async (t) => {
  const artifacts = run(t);
  const { wallet } = localSigner(artifacts);
  for (const wire of [
    signingTransaction.wire,
    { ...signingTransaction.wire, gasPrice: undefined, type: "eip1559", maxFeePerGas: "0x20", maxPriorityFeePerGas: "0x2", nonce: "0x7" },
  ]) {
    const envelope = Object.fromEntries(Object.entries(wire).filter(([, value]) => value !== undefined));
    const signed = await wallet.signTransaction(envelope);
    assert.equal(signed.transactionHash, keccak256(signed.rawTransaction));
    assert.equal((await recoverTransactionAddress({ serializedTransaction: signed.rawTransaction })).toLowerCase(), signingCreator.toLowerCase());
    const parsed = parseTransaction(signed.rawTransaction);
    for (const field of ["value", "gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas"]) if (envelope[field] !== undefined) assert.equal(field === "value" ? parsed.value ?? 0n : parsed[field], BigInt(envelope[field]));
    assert.equal(parsed.nonce, Number(BigInt(envelope.nonce)));
    assert.equal(parsed.chainId, 4663); assert.equal(parsed.data, envelope.data);
    assert.equal(parsed.to.toLowerCase(), envelope.to.toLowerCase());
    assert.equal(artifacts.redactor.text(signed.rawTransaction), "[REDACTED]");
  }
});

test("wallet prepares only absent nonce/legacy fee and retains exact supplied fields", async (t) => {
  const artifacts = run(t); const methods = [];
  const { wallet } = localSigner(artifacts, async ({ method, params }) => {
    methods.push(method);
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_getTransactionCount") { assert.deepEqual(params, [signingCreator, "pending"]); return "0x5"; }
    if (method === "eth_gasPrice") return "0x99";
    assert.fail(`Unexpected wallet RPC: ${method}`);
  });
  const { nonce, gasPrice, ...wire } = signingTransaction.wire;
  const signed = await wallet.signTransaction(wire);
  assert.equal(signed.wire.nonce, "0x5"); assert.equal(signed.wire.gasPrice, "0x99");
  assert.equal(signed.wire.gas, wire.gas); assert.equal(signed.wire.data, wire.data);
  assert.deepEqual(methods, ["eth_chainId", "eth_getTransactionCount", "eth_gasPrice"]);
});

test("wallet refuses wrong creator, chain, gas and attribution domain", async (t) => {
  const artifacts = run(t);
  const { wallet, client } = localSigner(artifacts);
  assert.throws(() => createLocalLaunchWallet({ privateKey: signingKey, creator: transaction.wire.from, chainId: 4663, client, redactor: artifacts.redactor }), { code: "CREATOR_KEY_MISMATCH" });
  await assert.rejects(wallet.signTransaction({ ...signingTransaction.wire, chainId: "0x1" }), { code: "INVALID_ENVELOPE" });
  await assert.rejects(wallet.signTransaction({ ...signingTransaction.wire, from: transaction.wire.from }), { code: "INVALID_ENVELOPE" });
  await assert.rejects(wallet.signTransaction({ ...signingTransaction.wire, gas: undefined }), { code: "INVALID_ENVELOPE" });
  const types = { Attribution: [{ name: "wallet", type: "address" }, { name: "chainId", type: "uint256" }] };
  const typedData = { domain: { name: "test", version: "1", chainId: 4663, verifyingContract: transaction.wire.to }, types, primaryType: "Attribution", message: { wallet: signingCreator, chainId: 4663n } };
  const signature = await wallet.signTypedData(typedData);
  assert.equal((await recoverTypedDataAddress({ ...typedData, signature })).toLowerCase(), signingCreator.toLowerCase());
  await assert.rejects(wallet.signTypedData({ ...typedData, domain: { ...typedData.domain, chainId: 1 } }), { code: "TYPED_DATA_MISMATCH" });
  await assert.rejects(wallet.signTypedData({ ...typedData, domain: { ...typedData.domain, verifyingContract: transaction.wire.from } }), { code: "TYPED_DATA_MISMATCH" });
  const changed = localSigner(artifacts, async () => "0x1");
  await assert.rejects(changed.wallet.signTransaction(signingTransaction.wire), { code: "CHAIN_MISMATCH" });
});

test("ambiguous raw broadcast retains computed hash before send with no retry", async (t) => {
  const artifacts = run(t); const failure = exampleError("RPC_TIMEOUT", "Broadcast outcome unknown");
  let sends = 0;
  const { wallet, client } = localSigner(artifacts, async ({ method, params }) => {
    if (method === "eth_chainId") return "0x1237";
    assert.equal(method, "eth_sendRawTransaction"); sends += 1;
    const row = json(artifacts, "receipts.json").transactions[0];
    assert.equal(row.transactionHash, keccak256(params[0]));
    assert.equal(row.status, "broadcast-attempt"); assert.deepEqual(row.transaction, signingTransaction.wire);
    const recovery = json(artifacts, "private-recovery.json");
    assert.equal(recovery.signedTransactions[0].rawTransaction, params[0]);
    assert.equal(statSync(join(artifacts.directory, "private-recovery.json")).mode & 0o777, 0o600);
    throw failure;
  });
  await assert.rejects(submitSignedRecorded({ transaction: signingTransaction, wallet, client, artifacts, wait: async () => assert.fail("Do not poll an ambiguous send") }), failure);
  artifacts.finish("failed", failure);
  assert.equal(sends, 1);
  const recovery = json(artifacts, "private-recovery.json");
  const signed = recovery.signedTransactions[0];
  assert.equal(json(artifacts, "result.json").chain.transactions[0].transactionHash, signed.transactionHash);
  for (const name of ["events.jsonl", "result.json", "receipts.json"]) assert.ok(!readFileSync(join(artifacts.directory, name), "utf8").includes(signed.rawTransaction));
});

test("raw returned-hash mismatch keeps attempt hash and refuses polling", async (t) => {
  const artifacts = run(t);
  const { wallet, client } = localSigner(artifacts, async ({ method }) => method === "eth_chainId" ? "0x1237" : hash);
  await assert.rejects(submitSignedRecorded({ transaction: signingTransaction, wallet, client, artifacts, wait: async () => assert.fail("Hash mismatch must not poll") }), { code: "BROADCAST_HASH_MISMATCH" });
  assert.notEqual(json(artifacts, "receipts.json").transactions[0].transactionHash, hash);
  assert.equal(json(artifacts, "receipts.json").transactions[0].status, "broadcast-attempt");
});

test("example fails missing key or API upfront and retains redacted configuration evidence", (t) => {
  const parent = mkdtempSync(join(tmpdir(), "node-example-config-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const script = new URL("../examples/launch-erc20-v4.mjs", import.meta.url).pathname;
  for (const [index, privateKey, apiUrl] of [
    [0, "", "https://api.invalid"],
    [1, signingKey, ""],
  ]) {
    const cwd = mkdtempSync(join(parent, `case-${index}-`));
    const child = spawnSync(process.execPath, [script], {
      cwd, encoding: "utf8", timeout: 10_000,
      env: { ...process.env, PRIVATE_KEY: privateKey, LAUNCH_API_URL: apiUrl, RPC_URL: "https://rpc.invalid/private-path?key=private-query" },
    });
    assert.equal(child.status, 1, child.stderr);
    const results = join(cwd, "launch-results");
    const runs = readdirSync(results);
    assert.equal(runs.length, 1);
    const result = JSON.parse(readFileSync(join(results, runs[0], "result.json"), "utf8"));
    assert.equal(result.error.code, "MISSING_CONFIGURATION");
    assert.equal(result.execution, "not-run"); assert.equal(result.chain.transactions.length, 0);
    assert.ok(!child.stderr.includes(signingKey));
    for (const secret of ["private-path", "private-query"]) assert.ok(!child.stderr.includes(secret));
  }
});

test("working-directory .env loads once and existing environment wins", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "node-example-dotenv-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFileSync(join(cwd, ".env"), 'EXAMPLE_TEST_KEEP="file value"\nEXAMPLE_TEST_LOAD="quoted # value" # comment\n', { mode: 0o600 });
  const helper = new URL("../examples/launch-example-support.mjs", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { writeFileSync } from "node:fs";
    import { loadExampleEnvironment } from ${JSON.stringify(helper)};
    loadExampleEnvironment();
    writeFileSync(".env", 'EXAMPLE_TEST_LOAD=changed\\n');
    loadExampleEnvironment();
    console.log(JSON.stringify([process.env.EXAMPLE_TEST_KEEP, process.env.EXAMPLE_TEST_LOAD]));
  `], { cwd, encoding: "utf8", timeout: 10_000, env: { ...process.env, EXAMPLE_TEST_KEEP: "process value", EXAMPLE_TEST_LOAD: undefined } });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), ["process value", "quoted # value"]);
});

test("signed broadcast interruption and reverted receipts retain durable evidence", async (t) => {
  const artifacts = run(t);
  const controller = new AbortController();
  const failure = exampleError("INTERRUPTED", "Retain the signed attempt");
  const { wallet, client } = localSigner(artifacts, async ({ method, params }) => {
    if (method === "eth_chainId") return "0x1237";
    assert.equal(method, "eth_sendRawTransaction");
    controller.abort(failure);
    return keccak256(params[0]);
  });
  await assert.rejects(submitSignedRecorded({ transaction: signingTransaction, wallet, client, artifacts, signal: controller.signal, wait: async () => assert.fail("Interrupted send must not poll") }), failure);
  assert.equal(json(artifacts, "receipts.json").transactions[0].status, "submitted");
  const next = run(t);
  const signer = localSigner(next, async ({ method, params }) => method === "eth_chainId" ? "0x1237" : keccak256(params[0]));
  const submitted = await submitSignedRecorded({ transaction: signingTransaction, ...signer, artifacts: next, wait: async (transactionHash) => ({ transactionHash, status: "0x0", logs: [] }) });
  next.finish("failed", exampleError("TRANSACTION_REVERTED", "Launch reverted", { revertData }));
  assert.equal(submitted.receipt.status, "0x0");
  assert.equal(json(next, "result.json").chain.transactions[0].receipt.status, "0x0");
});

test("fixed example configuration never invents optional execution caps and defaults to fifteen percent headroom", () => {
  const sdk = {
    getAddresses(chainId) { assert.equal(chainId, 4663); return { launchOrchestrator: transaction.wire.to, launchImplementationRegistry: transaction.wire.to, weth: transaction.wire.to, abyssFactory: transaction.wire.to }; },
    robinhoodMainnet: { rpcUrls: { default: { http: ["https://rpc.example.invalid/"] } } },
  };
  const env = { PRIVATE_KEY: signingKey, LAUNCH_API_URL: "https://api.example.invalid/" };
  const configuration = readExampleConfiguration(sdk, new Redactor(), env);
  assert.equal(configuration.implementationRegistry, transaction.wire.to);
  const policy = configuration.executionLimits;
  assert.equal(policy.headroomBps, 1500);
  for (const field of ["chainTransactionGasLimit", "rpcTransactionGasLimit", "accountTransactionGasLimit", "maxCalldataBytes"]) assert.equal(policy[field], undefined);
  assert.equal("forkRpcUrl" in configuration, false);
  const restricted = readExampleConfiguration(sdk, new Redactor(), { ...env, EXAMPLE_RPC_GAS_CAP: "12000000", EXAMPLE_MAX_CALLDATA_BYTES: "120000", EXAMPLE_HEADROOM_BPS: "0" }).executionLimits;
  assert.equal(restricted.rpcTransactionGasLimit, "12000000"); assert.equal(restricted.maxCalldataBytes, 120000); assert.equal(restricted.headroomBps, 0);
  for (const value of ["-1", "0", "1.5", "unknown"]) assert.throws(() => readExampleConfiguration(sdk, new Redactor(), { ...env, EXAMPLE_RPC_GAS_CAP: value }), { code: "INVALID_CONFIGURATION" });
});

test("launch receipt accounting accepts burned mint residuals without a creator reserve", () => {
  const evidence = {
    supply: 1000n, totalSupply: 950n, orchestrator: transaction.wire.to, creator: signingCreator,
    transfers: [
      { from: zeroAddress, to: transaction.wire.to, value: 1000n },
      { from: transaction.wire.to, to: zeroAddress, value: 50n },
    ],
    buys: [{ recipient: signingCreator, tokenOut: 10n }, { recipient: signingCreator, tokenOut: 20n }],
    orchestratorBalance: 0n, creatorBalance: 30n,
  };
  assert.deepEqual(verifyLaunchInventory(evidence), { minted: 1000n, burned: 50n, remainingSupply: 950n, creatorBought: 30n });
  assert.deepEqual(verifyLaunchInventory({ ...evidence, totalSupply: 1000n, transfers: evidence.transfers.slice(0, 1) }),
    { minted: 1000n, burned: 0n, remainingSupply: 1000n, creatorBought: 30n });
  for (const change of [
    { totalSupply: 1000n }, { creatorBalance: 80n }, { orchestratorBalance: 50n },
    { transfers: [] },
    { transfers: [{ from: zeroAddress, to: signingCreator, value: 1000n }, evidence.transfers[1]] },
    { transfers: [evidence.transfers[0], { from: signingCreator, to: zeroAddress, value: 50n }] },
  ]) assert.throws(() => verifyLaunchInventory({ ...evidence, ...change }), { code: "ERR_ASSERTION" });
});
