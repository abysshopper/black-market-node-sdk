import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createPublicClient, custom, isAddress, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";


export function exampleError(code, message, details = {}) {
  return Object.assign(new Error(message), { name: "LaunchExampleError", code, ...details });
}

/** An interrupted simulation still must restore its snapshot; never revert source state. */
export function rpcRequestSignal(signal, backend, method) {
  const cleanup = backend === "simulation" && ["evm_revert", "anvil_stopImpersonatingAccount", "hardhat_stopImpersonatingAccount"].includes(method);
  if (!cleanup) signal.throwIfAborted();
  // Cold nested-fork state fetches can exceed 30 seconds. Bound each request,
  // including instrumented controlled simulation; never retry a source broadcast.
  const timeout = AbortSignal.timeout(120_000);
  return cleanup ? timeout : AbortSignal.any([signal, timeout]);
}


export function loopbackUrl(value, label) {
  let url;
  try { url = new URL(value); } catch { throw exampleError("UNSAFE_ENDPOINT", `${label} must be an explicit loopback HTTP(S) URL`); }
  if (!["http:", "https:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw exampleError("UNSAFE_ENDPOINT", `${label} must be a loopback HTTP(S) service root without credentials, path, query or fragment`);
  }
  return url.href;
}

/** Register endpoint secrets before parsing/validation can emit public evidence. */
export function registerEndpointSecrets(redactor, value) {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    const values = [url.username, url.password, url.search, url.hash, ...url.searchParams.values()];
    if (url.pathname !== "/") values.push(url.pathname, ...url.pathname.split("/").filter(Boolean));
    for (const secret of values) {
      redactor.addSecret(secret);
      try { redactor.addSecret(decodeURIComponent(secret)); } catch { /* Invalid encoding remains registered verbatim. */ }
    }
    if (values.some(Boolean)) redactor.addSecret(value);
  } catch { redactor.addSecret(value); }
}

export function executionRpcUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw exampleError("UNSAFE_ENDPOINT", "RPC_URL must be HTTPS or an owned loopback HTTP URL"); }
  if (url.hash || url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) throw exampleError("UNSAFE_ENDPOINT", "RPC_URL must be HTTPS or an owned loopback HTTP URL without a fragment");
  return url.href;
}

export function launchApiUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw exampleError("UNSAFE_ENDPOINT", "LAUNCH_API_URL must be HTTPS or an owned loopback root"); }
  if (url.protocol === "http:") return loopbackUrl(value, "Launch API");
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search || !["", "/"].includes(url.pathname)) throw exampleError("UNSAFE_ENDPOINT", "LAUNCH_API_URL must be a service root without credentials, path, query or fragment");
  return url.href;
}

let environmentLoaded = false;
export function loadExampleEnvironment() {
  if (environmentLoaded) return;
  environmentLoaded = true;
  try { process.loadEnvFile(); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}

export function readExampleConfiguration(sdk, redactor, env = process.env) {
  redactor.addSecret(env.PRIVATE_KEY);
  if (typeof env.PRIVATE_KEY === "string") redactor.addSecret(env.PRIVATE_KEY.slice(2));
  for (const value of [env.RPC_URL, env.LAUNCH_API_URL, env.SIMULATION_RPC_URL, env.NFT_BASE_URI]) registerEndpointSecrets(redactor, value);
  if (!env.PRIVATE_KEY?.trim()) throw exampleError("MISSING_CONFIGURATION", "PRIVATE_KEY is required in the environment or working-directory .env");
  if (!env.LAUNCH_API_URL?.trim()) throw exampleError("MISSING_CONFIGURATION", "LAUNCH_API_URL is required in the environment or working-directory .env");
  if (!/^0x[\da-f]{64}$/i.test(env.PRIVATE_KEY)) throw exampleError("INVALID_PRIVATE_KEY", "PRIVATE_KEY must be a 32-byte hex private key");
  let account;
  try { account = privateKeyToAccount(env.PRIVATE_KEY); }
  catch { throw exampleError("INVALID_PRIVATE_KEY", "PRIVATE_KEY must be a valid 32-byte secp256k1 hex private key"); }
  const addresses = sdk.getAddresses(4663);
  const rpcUrl = executionRpcUrl(env.RPC_URL || sdk.robinhoodMainnet.rpcUrls.default.http[0]);
  const forkRpcUrl = env.SIMULATION_RPC_URL ? loopbackUrl(env.SIMULATION_RPC_URL, "Simulation RPC") : undefined;
  if (forkRpcUrl) {
    const source = new URL(rpcUrl); const fork = new URL(forkRpcUrl);
    const port = (url) => url.port || (url.protocol === "https:" ? "443" : "80");
    if (["127.0.0.1", "localhost", "[::1]"].includes(source.hostname) && port(source) === port(fork)) throw exampleError("UNSAFE_ENDPOINT", "Execution and disposable simulation RPCs must use distinct loopback ports");
  }
  const gasCap = (key) => {
    const value = env[key] || "16000000";
    if (!/^[1-9]\d*$/.test(value)) throw exampleError("INVALID_CONFIGURATION", `${key} must be a positive decimal integer`);
    return value;
  };
  const integer = (key, fallback, minimum, maximum) => {
    const value = env[key] || String(fallback);
    if (!/^(?:0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum || Number(value) > maximum) throw exampleError("INVALID_CONFIGURATION", `${key} is outside its allowed integer range`);
    return Number(value);
  };
  return {
    chainId: "4663", rpcUrl, forkRpcUrl, apiUrl: launchApiUrl(env.LAUNCH_API_URL),
    orchestrator: addresses.launchOrchestrator, creator: account.address,
    quoteAsset: addresses.weth, quoteDecimals: 18, oracleFactory: addresses.abyssFactory,
    nftBaseUri: env.NFT_BASE_URI || "",
    executionLimits: {
      chainTransactionGasLimit: gasCap("EXAMPLE_CHAIN_GAS_CAP"),
      rpcTransactionGasLimit: gasCap("EXAMPLE_RPC_GAS_CAP"),
      accountTransactionGasLimit: gasCap("EXAMPLE_ACCOUNT_GAS_CAP"),
      maxCalldataBytes: integer("EXAMPLE_MAX_CALLDATA_BYTES", 131072, 1, Number.MAX_SAFE_INTEGER),
      headroomBps: integer("EXAMPLE_HEADROOM_BPS", 1000, 0, 10000),
      provenance: { scope: "example-ceilings", note: "EXAMPLE ceilings, not verified provider or account limits; bounded by each observed block gas limit" },
    },
  };
}

const envelopeFields = ["chainId", "from", "to", "data", "value", "gas", "gasPrice", "nonce", "maxFeePerGas", "maxPriorityFeePerGas", "type", "accessList"];
export function transactionEnvelope(transaction) {
  return Object.fromEntries(envelopeFields.filter((field) => transaction[field] !== undefined).map((field) => [field, transaction[field]]));
}

function exactNumber(value, label) {
  const result = Number(BigInt(value));
  if (!Number.isSafeInteger(result) || result < 0) throw exampleError("INVALID_ENVELOPE", `${label} must be a nonnegative safe integer`);
  return result;
}

const transactionTypes = { "0x0": "legacy", "0x1": "eip2930", "0x2": "eip1559", legacy: "legacy", eip2930: "eip2930", eip1559: "eip1559" };

/**
 * Bounded local signer for exact SDK envelopes. No unlocked-account RPC, retries,
 * gas estimation, impersonation, source mutations or endpoint defaults.
 * Endpoint configuration belongs to the example; this helper also works
 * against an owned local Anvil supplied by the verification owner.
 */
export function createLocalLaunchWallet({ privateKey, creator, chainId, orchestrator, client, redactor }) {
  redactor.addSecret(privateKey);
  if (typeof privateKey === "string") redactor.addSecret(privateKey.slice(2));
  if (typeof privateKey !== "string" || !/^0x[\da-f]{64}$/i.test(privateKey)) throw exampleError("INVALID_PRIVATE_KEY", "PRIVATE_KEY must be a 32-byte hex private key");
  let account;
  try { account = privateKeyToAccount(privateKey); }
  catch { throw exampleError("INVALID_PRIVATE_KEY", "PRIVATE_KEY is not a valid secp256k1 private key"); }
  const equal = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
  if (!equal(account.address, creator)) throw exampleError("CREATOR_KEY_MISMATCH", "Local key must match the launch creator");
  const id = exactNumber(chainId, "chainId");
  const publicClient = createPublicClient({ transport: custom(client, { retryCount: 0 }) });
  async function assertChain() {
    if (BigInt(await client.request({ method: "eth_chainId" })) !== BigInt(id)) throw exampleError("CHAIN_MISMATCH", "Wallet RPC chain must match the launch/envelope");
  }
  return {
    address: account.address,
    async signTypedData(typedData) {
      await assertChain();
      if (BigInt(typedData.domain?.chainId ?? 0) !== BigInt(id) || !equal(typedData.domain?.verifyingContract, orchestrator) ||
          !equal(typedData.message?.wallet, creator) || BigInt(typedData.message?.chainId ?? 0) !== BigInt(id)) {
        throw exampleError("TYPED_DATA_MISMATCH", "Attribution domain, chain and wallet must match the launch");
      }
      const signature = await account.signTypedData(typedData);
      redactor.addSecret(signature);
      return signature;
    },
    async signTransaction(envelope) {
      await assertChain();
      for (const field of Object.keys(envelope)) if (!envelopeFields.includes(field)) throw exampleError("INVALID_ENVELOPE", `Unsupported transaction envelope field ${field}`);
      if (!equal(envelope.from, creator) || BigInt(envelope.chainId ?? 0) !== BigInt(id) || !isAddress(envelope.to)) throw exampleError("INVALID_ENVELOPE", "Transaction sender, chain and destination must be explicit and match the wallet");
      if (!/^0x(?:[\da-f]{2})*$/i.test(envelope.data ?? "") || envelope.value === undefined || envelope.gas === undefined || BigInt(envelope.gas) <= 0n) throw exampleError("INVALID_ENVELOPE", "Exact calldata, value and admitted positive gas are required");
      const request = { ...envelope, chainId: id };
      delete request.from;
      for (const field of ["value", "gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas"]) {
        if (request[field] !== undefined) {
          request[field] = BigInt(request[field]);
          if (request[field] < 0n) throw exampleError("INVALID_ENVELOPE", `${field} must be unsigned`);
        }
      }
      request.nonce = envelope.nonce === undefined
        ? exactNumber(await client.request({ method: "eth_getTransactionCount", params: [creator, "pending"] }), "nonce")
        : exactNumber(envelope.nonce, "nonce");
      if (request.type !== undefined) {
        request.type = transactionTypes[request.type];
        if (!request.type) throw exampleError("INVALID_ENVELOPE", "Only legacy/EIP-2930/EIP-1559 envelopes are supported");
      }
      if (request.gasPrice !== undefined && (request.maxFeePerGas !== undefined || request.maxPriorityFeePerGas !== undefined)) throw exampleError("INVALID_ENVELOPE", "Do not mix legacy and EIP-1559 fee fields");
      if (request.gasPrice === undefined && request.maxFeePerGas === undefined && request.maxPriorityFeePerGas === undefined && request.type !== "eip1559") {
        request.gasPrice = BigInt(await client.request({ method: "eth_gasPrice" }));
      } else if (request.gasPrice === undefined && (request.maxFeePerGas === undefined || request.maxPriorityFeePerGas === undefined)) {
        const fees = await publicClient.estimateFeesPerGas({ type: "eip1559" });
        request.maxFeePerGas ??= fees.maxFeePerGas;
        request.maxPriorityFeePerGas ??= fees.maxPriorityFeePerGas;
      }
      const rawTransaction = await account.signTransaction(request);
      redactor.addSecret(rawTransaction);
      const wire = { ...envelope, chainId: toHex(id), nonce: toHex(request.nonce) };
      for (const field of ["value", "gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas"]) if (request[field] !== undefined) wire[field] = toHex(request[field]);
      return { wire, rawTransaction, transactionHash: keccak256(rawTransaction) };
    },
  };
}

/** Persist hash + exact unsigned envelope BEFORE the single raw broadcast attempt. */
export async function submitSignedRecorded({ transaction, wallet, client, wait, artifacts, signal }) {
  signal?.throwIfAborted();
  const signed = await wallet.signTransaction(transaction.wire);
  artifacts.privateRecovery({ ...artifacts.recovery, signedTransactions: [
    ...(artifacts.recovery?.signedTransactions ?? []),
    { id: transaction.id, transactionHash: signed.transactionHash, rawTransaction: signed.rawTransaction },
  ] });
  signal?.throwIfAborted();
  const row = artifacts.submission({ ...transaction, wire: signed.wire }, signed.transactionHash, "broadcast-attempt");
  // The attempt is durable even if send times out, throws, or is interrupted.
  const returnedHash = await client.request({ method: "eth_sendRawTransaction", params: [signed.rawTransaction] });
  if (typeof returnedHash !== "string" || returnedHash.toLowerCase() !== signed.transactionHash.toLowerCase()) {
    throw exampleError("BROADCAST_HASH_MISMATCH", "RPC returned a hash different from the locally signed transaction", { transactionHash: signed.transactionHash, returnedHash });
  }
  row.status = "submitted"; row.submittedAt = new Date().toISOString();
  artifacts.saveReceipts();
  artifacts.event("transaction-submitted", row);
  signal?.throwIfAborted();
  const receipt = await wait(signed.transactionHash);
  artifacts.inclusion(row, receipt);
  return { row, receipt };
}

// Public evidence retains transaction calldata and revert bytes. Secrets are identified
// by field names, capability syntax, URLs, and values learned before any persistence.
export class Redactor {
  secrets = new Set();
  addSecret(value) { if (typeof value === "string" && value.length > 0) this.secrets.add(value); }
  text(value) {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}") || trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try { return JSON.stringify(this.value(JSON.parse(trimmed))); } catch { /* Not a serialized JSON value. */ }
    }
    let result = value;
    for (const secret of this.secrets) result = result.split(secret).join("[REDACTED]");
    result = result.replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
      try {
        const url = new URL(raw);
        const credentials = Boolean(url.username || url.password);
        const query = Boolean(url.search);
        url.username = ""; url.password = ""; url.search = ""; url.hash = "";
        return `${url.href}${credentials || query ? "[REDACTED_URL_SECRET]" : ""}`;
      } catch { return "[REDACTED_URL]"; }
    });
    result = result.replace(/\blus_[A-Za-z0-9_-]+\b/g, "[REDACTED]");
    result = result.replace(/\b(?:Launch-Upload-Capability|Bearer|Basic)\s+[^\s,"'}]+/gi, "[REDACTED_AUTH]");
    return result.replace(/((?:private[_ -]?key|signature|capability|authorization|password|secret|mnemonic|seed[_ -]?phrase|api[_ -]?key)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|0x[\da-f]+|[^\s,"'}]+)/gi, "$1[REDACTED]");
  }
  value(value) {
    const visited = new WeakSet();
    const visit = (item, depth) => {
      if (depth > 30) return "[DEPTH_LIMIT]";
      if (typeof item === "bigint") return item.toString();
      if (typeof item === "string") return this.text(item);
      if (typeof item === "function") return undefined;
      if (item === null || typeof item !== "object") return item;
      if (visited.has(item)) return "[CIRCULAR]";
      visited.add(item);
      if (Array.isArray(item)) {
        const result = item.map((entry) => visit(entry, depth + 1));
        visited.delete(item);
        return result;
      }
      const result = {};
      const keys = item instanceof Error ? [...new Set(["name", "message", "stack", "cause", ...Object.getOwnPropertyNames(item)])] : Object.keys(item);
      for (const key of keys) {
        if (/private.?key|secret|signature|capability|authorization|authentication|password|credential|mnemonic|seed.?phrase|(?:access|refresh|auth)[_-]?token|api[_-]?key|cookie/i.test(key)) result[this.text(key)] = "[REDACTED]";
        else if (item[key] !== undefined) result[this.text(key)] = visit(item[key], depth + 1);
      }
      visited.delete(item);
      return result;
    };
    return visit(value, 0);
  }
}

export function errorEvidence(error) {
  if (!(error instanceof Error)) return { name: "UnknownError", message: String(error), cause: error };
  const evidence = { name: error.name, code: error.code, message: error.message, stack: error.stack, cause: error.cause, revertData: error.revertData, data: error.data };
  for (const key of Object.getOwnPropertyNames(error)) if (!(key in evidence)) evidence[key] = error[key];
  if (evidence.revertData === undefined) evidence.revertData = findRevertData(error.data ?? error.cause);
  return evidence;
}

export function findRevertData(value, seen = new WeakSet()) {
  if (typeof value === "string") return /^0x(?:[\da-f]{2})+$/i.test(value) ? value : undefined;
  if (!value || typeof value !== "object" || seen.has(value)) return undefined;
  seen.add(value);
  for (const key of ["revertData", "returnValue", "output", "data", "result", "cause"]) {
    const data = findRevertData(value[key], seen);
    if (data) return data;
  }
  return undefined;
}

function durableWrite(path, content, mode = 0o600) {
  const fd = openSync(path, "w", mode);
  try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
}

export class RunArtifacts {
  constructor(output, caseId, redactor = new Redactor()) {
    this.directory = resolve(output);
    mkdirSync(this.directory, { mode: 0o700 }); // EEXIST deliberately refuses reuse.
    this.redactor = redactor;
    this.transactions = [];
    this.result = {
      schema: "black-market.launch-example-result.v1", sdk: "node", caseId: caseId ?? null,
      status: "failed", stage: "configuration", scope: "end-to-end", execution: "not-run",
      chain: { status: "not-run", confirmations: 1, transactions: this.transactions },
      api: { status: "not-run" }, startedAt: new Date().toISOString(), completedAt: null,
    };
    this.stageStartedAt = Date.now();
  }
  initialize() {
    this.event("started", { directory: this.directory });
    this.save("receipts.json", { schema: "black-market.launch-example-receipts.v1", sdk: "node", caseId: this.result.caseId, transactions: this.transactions });
  }
  event(event, observations = {}) {
    const row = this.redactor.value({ timestamp: new Date().toISOString(), sdk: "node", caseId: this.result.caseId, stage: this.result.stage, event, ...observations });
    const fd = openSync(join(this.directory, "events.jsonl"), "a", 0o600);
    try { appendFileSync(fd, `${JSON.stringify(row)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
  }
  stage(stage, observations = {}) {
    this.event("stage-completed", { elapsedMs: Date.now() - this.stageStartedAt });
    this.result.stage = stage;
    this.stageStartedAt = Date.now();
    this.event("stage-started", observations);
  }
  save(name, value) {
    const path = join(this.directory, name);
    durableWrite(`${path}.tmp`, `${JSON.stringify(this.redactor.value(value), null, 2)}\n`);
    renameSync(`${path}.tmp`, path);
  }
  privateRecovery(value) {
    const path = join(this.directory, "private-recovery.json");
    durableWrite(`${path}.tmp`, `${JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item, 2)}\n`, 0o600);
    renameSync(`${path}.tmp`, path);
    this.recovery = value;
  }
  submission(transaction, transactionHash, status = "submitted") {
    const row = { id: transaction.id, kind: transaction.kind, transaction: transaction.wire, transactionHash, status, attemptedAt: new Date().toISOString(), receipt: null };
    if (status === "submitted") row.submittedAt = row.attemptedAt;
    this.transactions.push(row);
    this.saveReceipts();
    this.event(status === "broadcast-attempt" ? "transaction-broadcast-attempt" : "transaction-submitted", row);
    return row;
  }
  inclusion(row, receipt) {
    row.receipt = receipt;
    row.status = "included"; // Status/provenance is checked only after preserving it.
    row.includedAt = new Date().toISOString();
    this.saveReceipts();
    this.event("transaction-included", { id: row.id, transactionHash: row.transactionHash, receipt });
  }
  saveReceipts() {
    this.save("receipts.json", { schema: "black-market.launch-example-receipts.v1", sdk: "node", caseId: this.result.caseId, transactions: this.transactions });
  }
  finish(status, error) {
    this.result.status = status;
    this.result.completedAt = new Date().toISOString();
    if (error) this.result.error = errorEvidence(error);
    // Write the terminal result before its journal row, so a journal I/O error cannot
    // erase a completed transaction or the original failure diagnosis.
    this.save("result.json", this.result);
    this.event(status, { elapsedMs: Date.now() - this.stageStartedAt, scope: this.result.scope, error: this.result.error });
  }
}


export async function pause(ms, signal) {
  signal?.throwIfAborted();
  await delay(ms, undefined, { signal });
}

export async function publishUntilIndexed({ publish, isPending, timeoutMs, artifacts, signal, now = Date.now, sleep = pause }) {
  const deadline = now() + timeoutMs;
  let attempt = 0;
  for (;;) {
    signal?.throwIfAborted();
    const remainingMs = deadline - now();
    if (remainingMs <= 0) throw exampleError("PUBLISH_TIMEOUT", "Actual API publication did not reach indexed optimistic/final state before the deadline");
    artifacts.event("publish-request", { attempt: ++attempt, remainingMs });
    try {
      const session = await publish(remainingMs);
      if (now() >= deadline) throw exampleError("PUBLISH_TIMEOUT", "The API publication response arrived after the indexing deadline");
      return session;
    }
    catch (error) {
      if (!isPending(error)) throw error; // No retry of API/RPC/schema/provenance errors.
      artifacts.result.api.status = "awaiting-indexer";
      artifacts.result.api.session = error.session;
      artifacts.event("publish-pending", { session: error.session, retryAfterMs: error.retryAfterMs });
      const retryAfterMs = Number(error.retryAfterMs);
      if (!Number.isFinite(retryAfterMs) || retryAfterMs < 0) throw exampleError("INVALID_RETRY_AFTER", "The API returned an invalid pending publication delay");
      const availableMs = deadline - now();
      if (availableMs <= 0) throw exampleError("PUBLISH_TIMEOUT", "Actual API publication exhausted its indexing deadline");
      await sleep(Math.min(Math.max(250, retryAfterMs), availableMs), signal);
    }
  }
}
