import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const HELP = `Usage: pnpm smoke:launch --fixture fixture.json --case CASE --output NEW_DIRECTORY [options]

Prepare one unsigned current-lifecycle plan by default. No signing, API session,
simulation transactions, or source-chain writes occur without --execute.

  --fixture FILE                 Owned black-market.launch-smoke-fixture.v1 JSON
  --case ID                      Exactly one case ID from the fixture catalogue
  --output DIRECTORY             Fresh, exclusive run directory (parent must exist)
  --execute                      Authorize local simulation, chain and API writes
  --api-url URL                  Explicit loopback API root; overrides fixture.apiUrl
  --chain-only                   Omit API entirely; never an end-to-end API pass
  --publish-timeout-seconds N     Bound pending-indexer publication (default: 90)
  --list                         List fixture cases unsigned, without any RPC request
  --help                         Show this help

Examples:
  pnpm smoke:launch --fixture /tmp/sdk-smoke/fixture.json --list
  pnpm smoke:launch --fixture /tmp/sdk-smoke/fixture.json --case erc20-v4-basic --output /tmp/node-plan
  pnpm smoke:launch --fixture /tmp/sdk-smoke/fixture.json --case erc404-dividends-mixed --output /tmp/node-launch --execute --api-url http://127.0.0.1:18763
  pnpm smoke:launch --fixture /tmp/sdk-smoke/fixture.json --case erc20-burn-mixed --output /tmp/node-chain --execute --chain-only

Inspect events.jsonl, plan.json, receipts.json and result.json even after failure.
private-recovery.json (0600) alone retains the API signature/capability. Never share it.
Execution state is retained; the runner never reverts the source chain or relaunches
because publication fails. No default live RPC/API endpoint or private key is used.
`;

export function smokeError(code, message, details = {}) {
  return Object.assign(new Error(message), { name: "LaunchSmokeError", code, ...details });
}

/** An interrupted simulation still must restore its snapshot; never revert source state. */
export function rpcRequestSignal(signal, backend, method) {
  const cleanup = backend === "simulation" && ["evm_revert", "anvil_stopImpersonatingAccount", "hardhat_stopImpersonatingAccount"].includes(method);
  if (!cleanup) signal.throwIfAborted();
  // Cold nested-fork state fetches can exceed 30 seconds. This bound applies only
  // to the smoke runner's owned local RPCs, including its instrumented fork.
  const timeout = AbortSignal.timeout(120_000);
  return cleanup ? timeout : AbortSignal.any([signal, timeout]);
}

export function parseArguments(argv) {
  const options = { execute: false, chainOnly: false, list: false, publishTimeoutSeconds: 90 };
  const values = new Map([["--fixture", "fixture"], ["--case", "caseId"], ["--output", "output"], ["--api-url", "apiUrl"], ["--publish-timeout-seconds", "publishTimeoutSeconds"]]);
  const flags = new Map([["--execute", "execute"], ["--chain-only", "chainOnly"], ["--list", "list"], ["--help", "help"]]);
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (seen.has(arg)) throw smokeError("INVALID_ARGUMENT", `Duplicate option ${arg}`);
    seen.add(arg);
    if (flags.has(arg)) options[flags.get(arg)] = true;
    else if (values.has(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw smokeError("INVALID_ARGUMENT", `${arg} requires a value`);
      options[values.get(arg)] = value;
    } else throw smokeError("INVALID_ARGUMENT", `Unknown option ${arg}; use --help`);
  }
  if (options.help) return options;
  if (!options.fixture) throw smokeError("MISSING_CONFIGURATION", "--fixture is required; there are no live defaults");
  if (options.list) {
    if (options.execute || options.caseId || options.output || options.apiUrl || options.chainOnly) throw smokeError("INVALID_ARGUMENT", "--list accepts only --fixture (and optional publication timeout)");
    return options;
  }
  if (!options.caseId || !options.output) throw smokeError("MISSING_CONFIGURATION", "--case and a fresh --output directory are required");
  if (options.chainOnly && options.apiUrl) throw smokeError("INVALID_ARGUMENT", "--chain-only cannot be combined with --api-url");
  const timeout = Number(options.publishTimeoutSeconds);
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 3600) throw smokeError("INVALID_ARGUMENT", "Publication timeout must be an integer within 1..3600 seconds");
  options.publishTimeoutSeconds = timeout;
  return options;
}

export function loopbackUrl(value, label) {
  let url;
  try { url = new URL(value); } catch { throw smokeError("UNSAFE_ENDPOINT", `${label} must be an explicit loopback HTTP(S) URL`); }
  if (!["http:", "https:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw smokeError("UNSAFE_ENDPOINT", `${label} must be a loopback HTTP(S) service root without credentials, path, query or fragment`);
  }
  return url.href;
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
      schema: "black-market.launch-smoke-result.v1", sdk: "node", caseId: caseId ?? null,
      status: "failed", stage: "configuration", scope: "plan-only", execution: "not-run",
      chain: { status: "not-run", confirmations: 1, transactions: this.transactions },
      api: { status: "not-run" }, startedAt: new Date().toISOString(), completedAt: null,
    };
    this.stageStartedAt = Date.now();
  }
  initialize() {
    this.event("started", { directory: this.directory });
    this.save("receipts.json", { schema: "black-market.launch-smoke-receipts.v1", sdk: "node", caseId: this.result.caseId, transactions: this.transactions });
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
  submission(transaction, transactionHash) {
    const row = { id: transaction.id, kind: transaction.kind, transaction: transaction.wire, transactionHash, status: "submitted", submittedAt: new Date().toISOString(), receipt: null };
    this.transactions.push(row);
    this.saveReceipts();
    this.event("transaction-submitted", row);
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
    this.save("receipts.json", { schema: "black-market.launch-smoke-receipts.v1", sdk: "node", caseId: this.result.caseId, transactions: this.transactions });
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

export async function submitRecorded({ transaction, send, wait, artifacts, signal }) {
  signal?.throwIfAborted();
  artifacts.event("transaction-send-started", { id: transaction.id, kind: transaction.kind, transaction: transaction.wire });
  const hash = await send(transaction.wire);
  if (!/^0x[\da-f]{64}$/i.test(hash)) throw smokeError("INVALID_RPC_RESPONSE", "Transaction submission omitted a valid hash", { data: hash });
  // Never check interruption or start polling between send and durable hash storage.
  const row = artifacts.submission(transaction, hash);
  signal?.throwIfAborted();
  const receipt = await wait(hash);
  artifacts.inclusion(row, receipt);
  return { row, receipt };
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
    if (remainingMs <= 0) throw smokeError("PUBLISH_TIMEOUT", "Actual API publication did not reach indexed optimistic/final state before the deadline");
    artifacts.event("publish-request", { attempt: ++attempt, remainingMs });
    try {
      const session = await publish(remainingMs);
      if (now() >= deadline) throw smokeError("PUBLISH_TIMEOUT", "The API publication response arrived after the indexing deadline");
      return session;
    }
    catch (error) {
      if (!isPending(error)) throw error; // No retry of API/RPC/schema/provenance errors.
      artifacts.result.api.status = "awaiting-indexer";
      artifacts.result.api.session = error.session;
      artifacts.event("publish-pending", { session: error.session, retryAfterMs: error.retryAfterMs });
      const retryAfterMs = Number(error.retryAfterMs);
      if (!Number.isFinite(retryAfterMs) || retryAfterMs < 0) throw smokeError("INVALID_RETRY_AFTER", "The API returned an invalid pending publication delay");
      const availableMs = deadline - now();
      if (availableMs <= 0) throw smokeError("PUBLISH_TIMEOUT", "Actual API publication exhausted its indexing deadline");
      await sleep(Math.min(Math.max(250, retryAfterMs), availableMs), signal);
    }
  }
}
