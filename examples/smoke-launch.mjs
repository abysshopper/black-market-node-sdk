// One actual current-lifecycle launch on a caller-owned loopback fixture. No live defaults.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  decodeEventLog, decodeFunctionResult, encodeFunctionData, isAddress, keccak256,
  recoverTypedDataAddress, toHex, zeroAddress, zeroHash,
} from "viem";
import {
  HELP, errorEvidence, findRevertData, loopbackUrl, parseArguments, pause,
  publishUntilIndexed, Redactor, rpcRequestSignal, RunArtifacts, smokeError, submitRecorded,
} from "./smoke-launch-support.mjs";

const CURRENT_ORCHESTRATOR = "0xb75CBD17b9aecb7305B4DFcDa69595F783341c0E";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const UNIT = 10n ** 18n;
const OPENING_PRICE = 2n ** 96n;
const MIN_SQRT_RATIO = 4295128739n;
const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;
const same = (left, right) => typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();
const addressEqual = (actual, expected, label) => assert.ok(same(actual, expected), `${label}: expected ${expected}, got ${actual}`);

function unsignedInteger(value, label, positive = true) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value) || positive && BigInt(value) === 0n) throw smokeError("INVALID_FIXTURE", `${label} must be an exact ${positive ? "positive" : "unsigned"} decimal string`);
  return BigInt(value);
}

function readFixture(file, options) {
  const fixture = JSON.parse(readFileSync(file, "utf8"));
  if (fixture.schema !== "black-market.launch-smoke-fixture.v1" || fixture.fixtureOnly !== true) throw smokeError("INVALID_FIXTURE", "Use the owned black-market.launch-smoke-fixture.v1, fixtureOnly:true manifest, never a deployment manifest");
  if (!Array.isArray(fixture.cases) || fixture.cases.length === 0 || fixture.cases.some((row) => typeof row?.id !== "string" || row.id.length === 0) || new Set(fixture.cases.map((row) => row.id)).size !== fixture.cases.length) throw smokeError("INVALID_FIXTURE", "The fixture must contain unique named catalogue cases");
  // --list deliberately stops before URL validation or any SDK/RPC operation.
  if (options.list) return fixture;
  const chainId = unsignedInteger(fixture.chainId, "chainId");
  if (chainId !== 4663n) throw smokeError("INVALID_FIXTURE", "These cases require the owned fork of current Robinhood chain 4663");
  for (const field of ["orchestrator", "creator", "quoteAsset"]) if (!isAddress(fixture[field]) || same(fixture[field], zeroAddress)) throw smokeError("INVALID_FIXTURE", `${field} must be a nonzero address`);
  addressEqual(fixture.orchestrator, CURRENT_ORCHESTRATOR, "Current lifecycle orchestrator");
  addressEqual(fixture.quoteAsset, WETH, "Canonical native-wrap quote asset");
  if (fixture.quoteDecimals !== 18) throw smokeError("INVALID_FIXTURE", "Smoke economics require the actual 18-decimal canonical WETH");
  if (!/^0x[\da-f]{64}$/i.test(fixture.oracleConfigId ?? "") || same(fixture.oracleConfigId, zeroHash)) throw smokeError("INVALID_FIXTURE", "An actual nonzero registered oracleConfigId is required");
  fixture.rpcUrl = loopbackUrl(fixture.rpcUrl, "Execution RPC");
  fixture.forkRpcUrl = loopbackUrl(fixture.forkRpcUrl, "Simulation RPC");
  const source = new URL(fixture.rpcUrl); const fork = new URL(fixture.forkRpcUrl);
  const port = (url) => url.port || (url.protocol === "https:" ? "443" : "80");
  if (port(source) === port(fork)) throw smokeError("UNSAFE_ENDPOINT", "Execution and disposable simulation RPCs must use distinct loopback ports, not hostname aliases");
  const policy = fixture.executionLimits;
  if (policy?.provenance?.scope !== "controlled-local-measurement") throw smokeError("INVALID_FIXTURE", "Execution limits require controlled-local-measurement provenance");
  for (const field of ["chainTransactionGasLimit", "rpcTransactionGasLimit", "accountTransactionGasLimit"]) unsignedInteger(policy[field], field);
  if (!Number.isSafeInteger(policy.maxCalldataBytes) || policy.maxCalldataBytes <= 0 || !Number.isSafeInteger(policy.headroomBps) || policy.headroomBps < 0 || policy.headroomBps > 10000) throw smokeError("INVALID_FIXTURE", "Actual calldata cap and explicit 0..10000 headroomBps are required");
  if (!options.chainOnly && (options.apiUrl ?? fixture.apiUrl) !== undefined) fixture.apiUrl = loopbackUrl(options.apiUrl ?? fixture.apiUrl, "Launch API");
  else delete fixture.apiUrl;
  if (options.execute && !options.chainOnly && !fixture.apiUrl) throw smokeError("MISSING_CONFIGURATION", "Execution requires an explicit owned --api-url/fixture.apiUrl, or --chain-only to omit the API");
  return fixture;
}

function validateCase(scenario) {
  if (![0, 1].includes(scenario.tokenKind) || ![0, 1, 2].includes(scenario.rewardMode) || !["atomic", "staged"].includes(scenario.mode)) throw smokeError("UNSUPPORTED_CASE", "Case token kind, reward mode and execution mode must be explicit supported values");
  const allowed = new Set(["id", "description", "tokenKind", "rewardMode", "mode", "markets", "buysPerMarket", "burnBps"]);
  for (const key of Object.keys(scenario)) if (!allowed.has(key)) throw smokeError("UNSUPPORTED_CASE", `Unsupported case economic field ${key}; it cannot be silently ignored`);
  if (!Array.isArray(scenario.markets) || scenario.markets.length < 1 || scenario.markets.length > 16 || !Number.isSafeInteger(scenario.buysPerMarket) || scenario.buysPerMarket < 1 || scenario.buysPerMarket * scenario.markets.length > 64) throw smokeError("UNSUPPORTED_CASE", "Case market/buy counts exceed lifecycle bounds");
  if (scenario.burnBps !== undefined && (!Number.isSafeInteger(scenario.burnBps) || scenario.burnBps < 0 || scenario.burnBps > 10000 || scenario.rewardMode !== 0)) throw smokeError("UNSUPPORTED_CASE", "Token-only burn policy requires an explicit reward-free 0..10000 share");
  let positions = 0;
  for (const market of scenario.markets) {
    if (!["v4", "abyss"].includes(market.venue) || !Number.isSafeInteger(market.positions) || market.positions < 1 || market.positions > 32) throw smokeError("UNSUPPORTED_CASE", "Case requires a supported venue and 1..32 exact positions per market");
    for (const key of Object.keys(market)) if (!["venue", "positions", "feeMode"].includes(key)) throw smokeError("UNSUPPORTED_CASE", `Unsupported market economic field ${key}`);
    if (market.feeMode !== undefined && (market.venue !== "v4" || ![0, 1].includes(market.feeMode))) throw smokeError("UNSUPPORTED_CASE", "Only V4 markets support explicit feeMode 0/1");
    positions += market.positions;
  }
  if (positions > 64) throw smokeError("UNSUPPORTED_CASE", "Case exceeds 64 permanent positions");
}

function rpcClient(url, artifacts, signal, label) {
  let id = 0;
  return { async request({ method, params = [] }) {
    const requestSignal = rpcRequestSignal(signal, label, method);
    const started = Date.now();
    try {
      const response = await fetch(url, {
        method: "POST", redirect: "error", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        signal: requestSignal,
      });
      if (!response.ok) throw smokeError("RPC_HTTP_ERROR", `${label} ${method}: HTTP ${response.status}`, { status: response.status });
      const body = await response.json();
      if (body.error) throw smokeError(body.error.code ?? "RPC_ERROR", `${label} ${method}: ${body.error.message}`, { data: body.error.data, cause: body.error });
      if (!("result" in body)) throw smokeError("INVALID_RPC_RESPONSE", `${label} ${method}: result was omitted`, { data: body });
      if (method === "eth_simulateV1" || label === "simulation" && ["eth_sendTransaction", "anvil_reset", "evm_snapshot", "evm_revert"].includes(method)) artifacts.event("rpc-observation", { backend: label, method, params, result: body.result, elapsedMs: Date.now() - started });
      return body.result;
    } catch (error) {
      artifacts.event("rpc-error", { backend: label, method, params, elapsedMs: Date.now() - started, error: errorEvidence(error) });
      throw error;
    }
  } };
}

function contractReader(client) {
  return async (to, abi, functionName, args = [], tag = "latest") => decodeFunctionResult({
    abi, functionName,
    data: await client.request({ method: "eth_call", params: [{ to, data: encodeFunctionData({ abi, functionName, args }) }, tag] }),
  });
}

function receiptEvents(receipt, address, abi, eventName) {
  return receipt.logs.filter((log) => same(log.address, address)).flatMap((log) => {
    let decoded;
    try { decoded = decodeEventLog({ abi, data: log.data, topics: log.topics, strict: true }); }
    catch { return []; } // A different event at the same contract is not the expected event.
    return decoded.eventName === eventName ? [decoded.args] : [];
  });
}

async function constructPlan({ client, fixture, scenario, sdk, artifacts, signal }) {
  const read = contractReader(client);
  artifacts.stage("profile-discovery");
  const profiles = await sdk.readLifecycleProfiles({ client, orchestrator: fixture.orchestrator });
  artifacts.save("profiles.json", profiles);
  artifacts.event("registry-profiles", { profiles });
  const selected = {};
  if (scenario.markets.some((row) => row.venue === "v4")) {
    const bound = profiles.filter((row) => row.venueKind === "uniswap-v4" && same(row.registration.configSchema, sdk.V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA) && row.topology.hookTopology === 2 && row.topology.configVersion === 5);
    if (bound.length !== 1 || !bound[0].admitted || !bound[0].envelope || !bound[0].developerTerms) throw smokeError("PROFILE_NOT_ADMITTED", "An unambiguous admitted certified pool-bound V4/schema5 profile with frozen terms is required", { data: bound });
    selected.v4 = bound[0];
  }
  if (scenario.markets.some((row) => row.venue === "abyss")) {
    const canonical = [];
    const adapters = new Set(profiles.filter((row) => row.venueKind === "abyss").map((row) => row.adapter.implementation.toLowerCase()));
    for (const adapter of adapters) {
      const canonicalId = await read(adapter, sdk.abyssLifecycleAdapterAbi, "profileId", [3]);
      const profile = profiles.find((row) => same(row.id, canonicalId) && same(row.adapter.implementation, adapter));
      if (profile) canonical.push(profile);
    }
    if (canonical.length !== 1 || !canonical[0].admitted || canonical[0].topology.configVersion !== 1 || !same(canonical[0].registration.configSchema, sdk.ABYSS_LIFECYCLE_CONFIG_SCHEMA)) throw smokeError("PROFILE_NOT_ADMITTED", "The registry-discovered canonical Abyss profile3 QUOTE_ORACLE/schema1 is required", { data: canonical });
    selected.abyss = canonical[0];
  }
  const escrow = await read(fixture.orchestrator, sdk.launchLifecycleAbi, "fundingEscrow");
  addressEqual(await read(escrow, sdk.lifecycleFundingEscrowAbi, "wrappedNative"), fixture.quoteAsset, "Actual native-wrap funding binding");
  assert.equal(await read(fixture.quoteAsset, sdk.erc20Abi, "decimals"), fixture.quoteDecimals, "Actual quote decimals");
  const block = await client.request({ method: "eth_getBlockByNumber", params: ["latest", false] });
  const identity = { nonce: BigInt(`0x${randomBytes(32).toString("hex")}`), tokenSalt: `0x${randomBytes(32).toString("hex")}` };
  artifacts.save("identity.json", { ...identity, caseId: scenario.id, creator: fixture.creator });
  const token = {
    kind: scenario.tokenKind, rewardMode: scenario.rewardMode, name: `Smoke ${scenario.id}`, symbol: "SMOKE",
    supply: (scenario.tokenKind === 1 ? 10_000n : 1_000_000n) * UNIT,
    nftUnit: scenario.tokenKind === 1 ? 100n * UNIT : 0n,
    metadataURI: scenario.tokenKind === 1 ? "ipfs://sdk-smoke/" : "", salt: identity.tokenSalt,
    inventoryRecipient: fixture.creator, burnOnCancel: false,
  };
  const draft = {
    chainId: BigInt(fixture.chainId), orchestrator: fixture.orchestrator, creator: fixture.creator, nonce: identity.nonce,
    token, funding: [], feeAssets: [], markets: [], buys: [], deadline: BigInt(block.timestamp) + 3600n, executorFeeBps: 275,
  };
  // CREATE2 token identity is independent of finalized market config/hook salts.
  const predictedToken = await sdk.predictLifecycleToken({ client, plan: draft });
  const token0 = BigInt(predictedToken) < BigInt(fixture.quoteAsset);
  const markets = scenario.markets.map((spec, marketIndex) => {
    const profile = selected[spec.venue];
    const positions = Array.from({ length: spec.positions }, (_unused, index) => ({
      tickLower: token0 ? index * 120 : index === spec.positions - 1 ? -887220 : -(index + 1) * 120,
      tickUpper: token0 ? index === spec.positions - 1 ? 887220 : (index + 1) * 120 : -index * 120,
      liquidity: 1000n * UNIT,
    }));
    let config;
    if (spec.venue === "v4") {
      const envelope = profile.envelope;
      const feeMode = spec.feeMode ?? 0;
      if (spec.positions > envelope.bounds.maximumPositions || 60 < envelope.bounds.minimumTickSpacing || 60 > envelope.bounds.maximumTickSpacing || !(envelope.bounds.feeModeFlags & 1 << feeMode)) throw smokeError("UNSUPPORTED_CASE", "Exact V4 positions, spacing or fee mode exceed the actual certified envelope", { data: { spec, bounds: envelope.bounds } });
      config = sdk.encodePoolBoundV4LifecycleMarketConfig({
        version: 5, lpFeePips: 3000, hookFeePips: 10000, tickSpacing: 60, sqrtPriceX96: OPENING_PRICE,
        feeMode, protocolFeeDenominator: envelope.protocolFeeDenominator, treasury: envelope.protocolTreasury,
        externalLiquidityDisabled: true, oracleConfigId: fixture.oracleConfigId, profileId: profile.id,
        termsDigest: envelope.termsDigest, developerBeneficiary: envelope.beneficiary, developerFeeBps: 0, hookSalt: zeroHash,
        positions: positions.map((position, index) => ({ ...position, salt: toHex(BigInt(marketIndex * 32 + index + 1), { size: 32 }), maxTokenAmount: 1100n * UNIT })),
      });
    } else config = sdk.encodeAbyssLifecycleMarketConfig({
      profile: 3, fee: 3000, oracleConfigId: fixture.oracleConfigId, openingSqrtPriceX96: OPENING_PRICE,
      positions: positions.map((position) => ({ ...position, tokenAmountMaximum: 1100n * UNIT })),
    });
    return { adapterId: profile.registration.adapterId, profileId: profile.id, quoteAsset: fixture.quoteAsset, tokenBudget: 1100n * UNIT, configVersion: spec.venue === "v4" ? 5 : 1, config };
  });
  const buys = markets.flatMap((_market, marketIndex) => Array.from({ length: scenario.buysPerMarket }, () => ({
    marketIndex, quoteAmountIn: 10n ** 15n, minTokenOut: 1n, recipient: fixture.creator,
    sqrtPriceLimitX96: token0 ? MAX_SQRT_RATIO - 1n : MIN_SQRT_RATIO + 1n,
  })));
  const amount = buys.reduce((sum, buy) => sum + buy.quoteAmountIn, 0n);
  const feeAssets = [predictedToken, fixture.quoteAsset].sort((left, right) => BigInt(left) < BigInt(right) ? -1 : 1).map((asset) => {
    const rewardsBps = scenario.rewardMode === 0 ? 0 : 4000;
    const burnBps = same(asset, predictedToken) ? scenario.burnBps ?? 0 : 0;
    return { asset, ownerBps: 10000 - rewardsBps - burnBps, rewardsBps, burnBps };
  });
  const plan = { ...draft, markets, buys, feeAssets, funding: [{ asset: fixture.quoteAsset, amount, kind: sdk.LifecycleFundingKind.NativeWrap, inputAsset: fixture.quoteAsset, inputAmount: amount, target: zeroAddress, data: "0x" }] };
  artifacts.save("draft-plan.json", plan);
  artifacts.result.chain.predictedToken = predictedToken;
  artifacts.stage("salt-finalization", { predictedToken, selectedProfiles: Object.fromEntries(Object.entries(selected).map(([key, profile]) => [key, profile.id])) });
  const prepared = await sdk.preparePoolBoundLifecyclePlan({ client, plan, signal,
    onProgress: (progress) => artifacts.event("salt-mining", progress),
  });
  artifacts.save("plan.json", JSON.parse(sdk.serializeLaunchPlan(prepared.plan)));
  artifacts.save("hook-deployments.json", prepared.deployments);
  const actualPrediction = await sdk.predictLifecycleToken({ client, plan: prepared.plan });
  addressEqual(actualPrediction, predictedToken, "Finalized token prediction");
  artifacts.result.chain.planHash = sdk.hashLaunchPlan(prepared.plan);
  artifacts.result.chain.launchId = sdk.hashLaunchIdentity(prepared.plan);
  artifacts.event("plan-finalized", { predictedToken, planHash: artifacts.result.chain.planHash, launchId: artifacts.result.chain.launchId, mode: scenario.mode, markets: markets.length, positions: scenario.markets.reduce((sum, market) => sum + market.positions, 0), buys: buys.length, deployments: prepared.deployments });
  return { plan: prepared.plan, predictedToken };
}

function apiTransport({ artifacts, signal }) {
  let requestTimeoutMs = 30_000;
  return {
    setTimeoutMs(ms) { requestTimeoutMs = Math.max(1, Math.min(30_000, ms)); },
    async fetch(url, init = {}) {
      loopbackUrl(new URL(url).origin, "API request origin");
      const started = Date.now();
      artifacts.event("api-request", { method: init.method ?? "GET", url: String(url), headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
      try {
        const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]) });
        const text = await response.clone().text();
        let body; try { body = JSON.parse(text); } catch { body = text; }
        if (body?.capability) {
          artifacts.redactor.addSecret(body.capability);
          artifacts.privateRecovery({ ...artifacts.recovery, session: body, capability: body.capability });
        }
        artifacts.event("api-response", { method: init.method ?? "GET", url: String(url), status: response.status, retryAfter: response.headers.get("Retry-After"), body, elapsedMs: Date.now() - started });
        return response;
      } catch (error) {
        artifacts.event("api-error", { url: String(url), elapsedMs: Date.now() - started, error: errorEvidence(error) });
        throw error;
      }
    },
  };
}

async function stageMetadata({ client, fixture, plan, sdk, artifacts, transport }) {
  artifacts.stage("api-metadata");
  artifacts.result.api.status = "staging";
  delete artifacts.result.api.reason;
  const metadata = { name: plan.token.name, symbol: plan.token.symbol, description: `Actual Node SDK launch smoke: ${artifacts.result.caseId}` };
  const idempotencyKey = `node-smoke-${randomUUID()}`;
  const nonce = `0x${randomBytes(32).toString("hex")}`;
  const deadline = BigInt(Math.floor(Date.now() / 1000)) + 600n;
  const typedData = {
    domain: { name: "Abyss Launch Attribution", version: "1", chainId: Number(plan.chainId), verifyingContract: plan.orchestrator },
    types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }], ...sdk.launchAttributionTypes },
    primaryType: "LaunchAttribution",
    message: { chainId: plan.chainId.toString(), wallet: plan.creator, metadataHash: sdk.canonicalLaunchMetadataHash(metadata), imageSha256: zeroHash, imageContentType: "", imageContentLength: "0", idempotencyKey, nonce, deadline: deadline.toString() },
  };
  const signature = await client.request({ method: "eth_signTypedData_v4", params: [plan.creator, JSON.stringify(typedData)] });
  artifacts.redactor.addSecret(signature);
  const request = { chainId: Number(plan.chainId), wallet: plan.creator, metadata, authorization: { nonce, deadline: deadline.toString(), signature } };
  const recovery = { schema: "black-market.launch-smoke-recovery.v1", sdk: "node", caseId: artifacts.result.caseId, apiUrl: fixture.apiUrl, idempotencyKey, typedData, request };
  artifacts.privateRecovery(recovery);
  const signer = await recoverTypedDataAddress({ ...typedData, signature });
  addressEqual(signer, plan.creator, "Anvil attribution signer");
  const api = new sdk.LaunchApiClient({ baseUrl: fixture.apiUrl, retries: 1, fetch: transport.fetch.bind(transport) });
  const session = await api.createUploadSession(request, idempotencyKey);
  if (session.capability) artifacts.redactor.addSecret(session.capability);
  // Persist the one-time capability before even validating the response.
  artifacts.privateRecovery({ ...recovery, session, capability: session.capability });
  artifacts.result.api.session = session;
  artifacts.result.api.sessionId = session.sessionId;
  artifacts.event("metadata-session-created", { session });
  assert.ok(typeof session.capability === "string" && session.capability.length > 0, "Actual API must issue the one-time session capability");
  assert.equal(session.chainId, Number(plan.chainId)); addressEqual(session.wallet, plan.creator, "Session wallet");
  assert.equal(session.status, "ready_to_launch"); assert.equal(session.metadata.name, plan.token.name); assert.equal(session.metadata.symbol, plan.token.symbol);
  assert.equal(session.image, null, "This smoke stages metadata only");
  artifacts.result.api.status = "session-ready";
  return { api, sessionId: session.sessionId, capability: session.capability };
}

function limitSource(fixture, artifacts) {
  const policy = fixture.executionLimits;
  return async ({ block, chainId, account, orchestrator }) => {
    const limits = {
      chainId, account, orchestrator, observedBlockNumber: block.number, observedBlockHash: block.hash,
      chainGasLimit: BigInt(policy.chainTransactionGasLimit), rpcGasLimit: BigInt(policy.rpcTransactionGasLimit),
      accountGasLimit: BigInt(policy.accountTransactionGasLimit), maxCalldataBytes: policy.maxCalldataBytes, headroomBps: policy.headroomBps,
    };
    artifacts.event("local-execution-limits", { limits, provenance: policy.provenance });
    return limits;
  };
}

async function executePlan({ client, fixture, planned, sdk, artifacts, signal, limits, fork }) {
  const references = [];
  let activation;
  for (let step = 0; step < 64; step += 1) {
    artifacts.stage("build-next", { step });
    const next = await sdk.buildNextTransaction({ client, planned, receipts: references, limits, fork });
    if (!next) return { references, activation };
    artifacts.event("next-admitted", { transaction: next });
    assert.equal(next.chainId, Number(planned.chainId));
    assert.equal(BigInt(await client.request({ method: "eth_chainId" })), planned.chainId, "Recheck execution chain before every send");
    addressEqual(next.from, planned.plan.creator, "Exact transaction creator");
    addressEqual(next.to, planned.plan.orchestrator, "Native-wrap launch transaction destination");
    const functions = { atomic: "launchAtomic", begin: "beginLaunch", prepare: "prepareMarkets", activate: "activateLaunch" };
    const functionName = functions[next.kind];
    assert.ok(functionName, "These native-wrap cases do not permit unrelated approval/cancellation writes");
    const args = next.kind === "begin" ? [planned.plan, sdk.LifecycleMode.Staged] : next.kind === "prepare" ? [planned.plan, next.marketStart, next.marketCount] : [planned.plan];
    assert.equal(next.data.toLowerCase(), encodeFunctionData({ abi: sdk.launchLifecycleAbi, functionName, args }).toLowerCase(), "Exact finalized-plan calldata");
    assert.ok(next.gas !== undefined && next.gasPrice !== undefined && next.admission?.admitted === true, "Actual next transaction needs stateful gas/envelope admission");
    const head = await client.request({ method: "eth_getBlockByNumber", params: ["latest", false] });
    const ceiling = [BigInt(head.gasLimit), ...["chainTransactionGasLimit", "rpcTransactionGasLimit", "accountTransactionGasLimit"].map((key) => BigInt(fixture.executionLimits[key]))].reduce((left, right) => left < right ? left : right);
    assert.ok(next.gas > 0n && next.gas <= ceiling, "Admitted gas must fit all explicit local caps");
    assert.ok((next.data.length - 2) / 2 <= fixture.executionLimits.maxCalldataBytes, "Exact calldata cap");
    const nonce = await client.request({ method: "eth_getTransactionCount", params: [next.from, "pending"] });
    const wire = { chainId: toHex(planned.chainId), from: next.from, to: next.to, data: next.data, value: toHex(next.value), gas: toHex(next.gas), gasPrice: toHex(next.gasPrice), nonce };
    artifacts.stage(`submit-${next.kind}`, { id: next.id });
    artifacts.result.execution = "running"; artifacts.result.chain.status = "executing";
    const submitted = await submitRecorded({
      transaction: { ...next, wire }, artifacts, signal,
      send: (envelope) => client.request({ method: "eth_sendTransaction", params: [envelope] }),
      wait: async (hash) => {
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
          const receipt = await client.request({ method: "eth_getTransactionReceipt", params: [hash] });
          if (receipt) return receipt;
          await pause(100, signal);
        }
        throw smokeError("RECEIPT_TIMEOUT", `Submitted transaction was not included within 30 seconds: ${hash}`, { transactionHash: hash });
      },
    });
    const { row, receipt } = submitted;
    addressEqual(receipt.transactionHash, row.transactionHash, "Receipt transaction hash");
    if (BigInt(receipt.status) !== 1n) {
      let trace;
      try { trace = await client.request({ method: "debug_traceTransaction", params: [row.transactionHash, { tracer: "callTracer" }] }); }
      catch (error) { artifacts.event("revert-trace-unavailable", { transactionHash: row.transactionHash, error: errorEvidence(error) }); }
      if (trace) artifacts.event("transaction-revert-trace", { transactionHash: row.transactionHash, trace });
      row.status = "reverted"; artifacts.saveReceipts();
      throw smokeError("TRANSACTION_REVERTED", `Actual source-chain transaction reverted: ${row.transactionHash}`, { transactionHash: row.transactionHash, revertData: findRevertData(trace), receipt });
    }
    const includedBlock = await client.request({ method: "eth_getBlockByNumber", params: [receipt.blockNumber, false] });
    addressEqual(includedBlock?.hash, receipt.blockHash, "Canonical included block");
    const latest = BigInt(await client.request({ method: "eth_blockNumber" }));
    assert.ok(latest >= BigInt(receipt.blockNumber), "Required one confirmation must be included canonically");
    const reference = { transactionHash: row.transactionHash, observedBlockNumber: BigInt(receipt.blockNumber), observedBlockHash: receipt.blockHash, confirmations: 1 };
    row.status = "confirmed"; row.reference = reference; artifacts.saveReceipts();
    references.push(reference);
    if (["atomic", "activate"].includes(next.kind)) {
      assert.equal(activation, undefined, "Exactly one activation transaction is allowed");
      activation = { transactionHash: row.transactionHash, receipt };
      artifacts.result.chain.activationTransactionHash = row.transactionHash;
    }
    artifacts.event("transaction-confirmed", { reference, gasUsed: receipt.gasUsed, transactionKind: next.kind });
  }
  throw smokeError("EXECUTION_STEP_LIMIT", "Lifecycle did not terminate within 64 exact SDK transactions; state/hashes are retained");
}

async function verifyChain({ client, planned, references, activation, fixture, scenario, sdk, artifacts }) {
  artifacts.stage("chain-verification");
  assert.ok(activation, "A real atomic/activate receipt is required");
  const progress = await sdk.readLaunchProgress({ client, planned, receipts: references, confirmations: 1 });
  artifacts.result.chain.progress = progress;
  artifacts.save("progress.json", progress);
  artifacts.event("canonical-progress", { progress });
  const expectedPositions = scenario.markets.reduce((sum, market) => sum + market.positions, 0);
  assert.equal(progress.canonical.phase, sdk.LifecyclePhase.Active);
  addressEqual(progress.canonical.token, planned.predictedToken, "Actual canonical token");
  assert.equal(progress.canonical.marketCount, scenario.markets.length);
  assert.equal(progress.canonical.preparedMarkets, scenario.markets.length);
  assert.equal(progress.canonical.positionCount, expectedPositions);
  assert.equal(progress.canonical.buyCount, planned.plan.buys.length);
  assert.equal(progress.markets.length, scenario.markets.length);
  assert.ok(progress.confirmationSafe); assert.ok(progress.receipts.every((row) => row.status === "confirmed"));
  const tag = toHex(progress.confirmedBlockNumber);
  const read = (to, abi, name, args = []) => contractReader(client)(to, abi, name, args, tag);
  const token = planned.predictedToken;
  const runtime = await client.request({ method: "eth_getCode", params: [token, tag] });
  assert.ok(runtime !== "0x", "Actual deployed token runtime is required");
  const factoryRuntime = await client.request({ method: "eth_getCode", params: [planned.tokenFactory, tag] });
  assert.equal(keccak256(factoryRuntime).toLowerCase(), planned.tokenFactoryCodeHash.toLowerCase(), "Current immutable token-factory runtime binding");
  const deployments = artifacts.transactions.flatMap((row) => receiptEvents(row.receipt, planned.tokenFactory, sdk.lifecycleTokenFactoryAbi, "TokenDeployed"));
  assert.equal(deployments.length, 1, "Actual token-factory deployment event");
  addressEqual(deployments[0].token, token, "Factory deployed token"); addressEqual(deployments[0].launchId, planned.launchId, "Factory launch ID");
  assert.equal(deployments[0].kind, scenario.tokenKind, "Actual factory token kind");
  addressEqual(await read(planned.tokenFactory, sdk.lifecycleTokenFactoryAbi, "tokenOfLaunch", [planned.launchId]), token, "Factory token binding");
  addressEqual(await read(planned.tokenFactory, sdk.lifecycleTokenFactoryAbi, "launchOfToken", [token]), planned.launchId, "Factory reverse launch binding");
  const tokenState = {};
  for (const name of ["authority", "tokenFactory", "launchId", "rewardMode", "initialSupply", "burnOnCancel", "active", "cancelled", "exclusionsFinalized", "feeHub", "rewardModule"]) tokenState[name] = await read(token, sdk.lifecycleTokenContextAbi, name);
  for (const name of ["name", "symbol", "decimals", "totalSupply"]) tokenState[name] = await read(token, sdk.erc20Abi, name);
  tokenState.runtimeCodeHash = keccak256(runtime); tokenState.kind = deployments[0].kind;
  artifacts.result.chain.token = token;
  artifacts.result.chain.tokenState = tokenState;
  artifacts.event("actual-token", { token, tokenState });
  assert.equal(tokenState.name, planned.plan.token.name); assert.equal(tokenState.symbol, planned.plan.token.symbol); assert.equal(tokenState.decimals, 18);
  assert.equal(tokenState.initialSupply, planned.plan.token.supply); assert.equal(tokenState.totalSupply, planned.plan.token.supply);
  assert.equal(tokenState.rewardMode, scenario.rewardMode); assert.equal(tokenState.burnOnCancel, false);
  assert.equal(tokenState.active, true); assert.equal(tokenState.cancelled, false); assert.equal(tokenState.exclusionsFinalized, true);
  addressEqual(tokenState.authority, fixture.orchestrator, "Token authority"); addressEqual(tokenState.tokenFactory, planned.tokenFactory, "Token factory"); addressEqual(tokenState.launchId, planned.launchId, "Token launch ID");
  addressEqual(tokenState.feeHub, progress.canonical.feeHub, "Token fee hub"); addressEqual(tokenState.rewardModule, progress.canonical.rewards, "Token rewards binding");
  if (scenario.rewardMode === 0) addressEqual(tokenState.rewardModule, zeroAddress, "Reward-free module");
  else if (scenario.rewardMode === 2) addressEqual(tokenState.rewardModule, token, "Embedded holder dividends");
  else {
    assert.ok(!same(tokenState.rewardModule, token) && !same(tokenState.rewardModule, zeroAddress), "Actual distinct staking module");
    assert.notEqual(await client.request({ method: "eth_getCode", params: [tokenState.rewardModule, tag] }), "0x", "Staking runtime");
  }
  if (scenario.tokenKind === 1) {
    tokenState.nftUnit = await read(token, sdk.lifecycleErc404Abi, "unit");
    tokenState.metadataURI = await read(token, sdk.lifecycleErc404Abi, "baseURI");
    tokenState.mirror = await read(token, sdk.lifecycleErc404Abi, "mirrorERC721");
    artifacts.event("actual-erc404", { nftUnit: tokenState.nftUnit, metadataURI: tokenState.metadataURI, mirror: tokenState.mirror });
    assert.equal(tokenState.nftUnit, planned.plan.token.nftUnit); assert.equal(tokenState.metadataURI, planned.plan.token.metadataURI);
    assert.notEqual(await client.request({ method: "eth_getCode", params: [tokenState.mirror, tag] }), "0x", "Real ERC404 mirror runtime");
    addressEqual(await read(tokenState.mirror, sdk.lifecycleErc404MirrorAbi, "baseERC20"), token, "ERC404 mirror link");
  }
  const hub = tokenState.feeHub;
  addressEqual(await read(hub, sdk.lifecycleFeeHubAbi, "launchToken"), token, "Hub token");
  addressEqual(await read(hub, sdk.lifecycleFeeHubAbi, "rewards"), tokenState.rewardModule, "Hub reward module");
  assert.equal(await read(hub, sdk.lifecycleFeeHubAbi, "executorFeeBps"), 275);
  assert.equal(await read(hub, sdk.lifecycleFeeHubAbi, "finalized"), true);
  const assets = await read(hub, sdk.lifecycleFeeHubAbi, "assets");
  assert.deepEqual(assets.map((value) => value.toLowerCase()), planned.plan.feeAssets.map((policy) => policy.asset.toLowerCase()));
  const expectedRewardAssets = planned.plan.feeAssets.filter((policy) => policy.rewardsBps > 0).map((policy) => policy.asset.toLowerCase());
  const rewardAssets = await read(hub, sdk.lifecycleFeeHubAbi, "rewardAssets");
  assert.deepEqual(rewardAssets.map((value) => value.toLowerCase()), expectedRewardAssets);
  if (scenario.rewardMode !== 0) {
    const moduleAssets = await read(tokenState.rewardModule, sdk.lifecycleRewardsAbi, "rewardAssets");
    assert.deepEqual(moduleAssets.map((value) => value.toLowerCase()), expectedRewardAssets, "Actual reward-module assets");
  }
  artifacts.event("actual-reward-binding", { mode: scenario.rewardMode, module: tokenState.rewardModule, rewardAssets });
  for (const policy of planned.plan.feeAssets) {
    const actual = await read(hub, sdk.lifecycleFeeHubAbi, "policy", [policy.asset]);
    artifacts.event("actual-fee-policy", { policy: actual });
    addressEqual(actual.asset, policy.asset, "Actual fee asset");
    for (const key of ["ownerBps", "rewardsBps", "burnBps"]) assert.equal(actual[key], policy[key], `Actual ${key}`);
  }
  const activated = receiptEvents(activation.receipt, fixture.orchestrator, sdk.launchLifecycleAbi, "LaunchActivated");
  assert.equal(activated.length, 1); addressEqual(activated[0].launchId, planned.launchId, "Activation launch ID"); addressEqual(activated[0].planHash, planned.planHash, "Activation commitment"); addressEqual(activated[0].token, token, "Activation token");
  assert.equal(activated[0].marketCount, scenario.markets.length); assert.equal(activated[0].positionCount, expectedPositions);
  const buys = receiptEvents(activation.receipt, fixture.orchestrator, sdk.launchLifecycleAbi, "InitialBuyExecuted");
  artifacts.result.chain.buys = buys;
  artifacts.event("actual-ordered-buys", { buys });
  assert.equal(buys.length, planned.plan.buys.length);
  for (let index = 0; index < buys.length; index += 1) {
    const actual = buys[index]; const expected = planned.plan.buys[index];
    assert.equal(actual.buyIndex, index); assert.equal(actual.marketIndex, expected.marketIndex); addressEqual(actual.launchId, planned.launchId, "Buy launch ID");
    addressEqual(actual.quoteAsset, fixture.quoteAsset, "Buy quote"); addressEqual(actual.recipient, expected.recipient, "Buy recipient");
    assert.ok(actual.tokenOut >= expected.minTokenOut); assert.ok(actual.quoteSpent > 0n && actual.quoteSpent <= expected.quoteAmountIn);
  }
  const directory = await read(fixture.orchestrator, sdk.launchLifecycleAbi, "directory");
  const canonicalMarkets = [];
  artifacts.result.chain.markets = canonicalMarkets;
  for (const market of progress.markets) {
    const spec = scenario.markets[market.index];
    const identity = market.prepared.identity;
    const observation = { ...market, positions: [] };
    canonicalMarkets.push(observation);
    artifacts.event("actual-market", { market });
    assert.equal(market.live?.publicTrading, true, market.error ?? "Actual public trading must be open");
    assert.equal(identity.openingSqrtPriceX96, OPENING_PRICE); assert.equal(identity.fee, 3000); assert.equal(identity.tickSpacing, 60);
    assert.equal(identity.venue, spec.venue === "v4" ? sdk.LifecycleVenue.UniswapV4 : sdk.LifecycleVenue.Abyss);
    assert.equal(market.prepared.positionCount, spec.positions); assert.ok(!same(market.prepared.custody, zeroAddress));
    if (spec.venue === "v4") {
      const sealed = await read(market.prepared.custody, sdk.lifecycleV4LockerAbi, "isSealed", [identity.poolId]);
      const count = await read(market.prepared.custody, sdk.lifecycleV4LockerAbi, "positionCount", [identity.poolId]);
      observation.permanentCustody = { sealed, count };
      assert.equal(sealed, true); assert.equal(count, BigInt(spec.positions));
    }
    const positions = await read(directory, sdk.lifecycleDirectoryAbi, "positions", [planned.launchId, market.index, 0n, BigInt(spec.positions)]);
    assert.equal(positions.length, spec.positions);
    const profile = planned.profiles.find((row) => same(row.id, identity.profileId));
    assert.ok(profile, "Actual market must use the planned registered profile");
    const config = spec.venue === "v4" ? sdk.decodePoolBoundV4LifecycleMarketConfig(planned.plan.markets[market.index].config) : sdk.decodeAbyssLifecycleMarketConfig(planned.plan.markets[market.index].config);
    for (let index = 0; index < positions.length; index += 1) {
      const position = positions[index]; const expected = config.positions[index];
      const [liquidity, custody] = await read(profile.adapter.implementation, sdk.lifecycleAdapterAbi, "readPosition", [position]);
      const actual = { ...position, actualLiquidity: liquidity, actualCustody: custody };
      observation.positions.push(actual);
      addressEqual(position.marketId, identity.canonicalId, "Position canonical market"); addressEqual(position.custody, market.prepared.custody, "Position committed custody");
      assert.equal(position.tickLower, expected.tickLower); assert.equal(position.tickUpper, expected.tickUpper);
      assert.equal(position.liquidity, expected.liquidity); assert.equal(liquidity, expected.liquidity); addressEqual(custody, market.prepared.custody, "Actual permanent position custody");
      if (spec.venue === "v4") addressEqual(position.salt, expected.salt, "Committed V4 position salt");
      else {
        const lock = await read(custody, sdk.abyssPositionLockerAbi, "locks", [position.tokenId]);
        actual.permanentLock = lock;
        for (let term = 0; term < 3; term += 1) addressEqual(lock[term], market.prepared.feeSource, "Abyss collector-owned permanent lock");
        assert.equal(lock[3], 0n); assert.equal(lock[4], false);
      }
      artifacts.event("actual-position-custody", { marketIndex: market.index, position: actual });
    }
  }
  assert.equal(await sdk.buildNextTransaction({ client, planned, receipts: references }), undefined, "Active is terminal; no implicit launch retry");
  artifacts.result.chain.status = "passed"; artifacts.result.execution = "completed";
  artifacts.event("chain-verified", { token, activationTransactionHash: activation.transactionHash, marketCount: canonicalMarkets.length, positionCount: expectedPositions, buyCount: buys.length });
}

async function publishAndVerify({ fixture, planned, activation, session, sdk, artifacts, transport, signal, timeoutSeconds }) {
  artifacts.stage("api-publication", { transactionHash: activation.transactionHash, timeoutSeconds });
  artifacts.result.api.activationTransactionHash = activation.transactionHash;
  const published = await publishUntilIndexed({
    timeoutMs: timeoutSeconds * 1000, artifacts, signal,
    isPending: (error) => error instanceof sdk.LaunchPublishPending,
    publish: async (remainingMs) => {
      transport.setTimeoutMs(remainingMs);
      try { return await session.api.publishUploadSession(Number(planned.chainId), session.sessionId, session.capability, { chainId: Number(planned.chainId), transactionHash: activation.transactionHash }); }
      catch (error) {
        if (error instanceof sdk.LaunchPublishPending && error.session.token != null) addressEqual(error.session.token, planned.predictedToken, "Pending API token");
        throw error;
      }
    },
  });
  artifacts.result.api.session = published;
  artifacts.event("actual-published-session", { session: published });
  addressEqual(published.token, planned.predictedToken, "Published actual token");
  addressEqual(published.transactionHash, activation.transactionHash, "Published activation transaction");
  assert.equal(published.chainId, Number(planned.chainId)); addressEqual(published.wallet, planned.plan.creator, "Published wallet");
  assert.ok(["optimistic", "final"].includes(published.status)); assert.ok(["optimistic", "final"].includes(published.canonicalStatus));
  assert.equal(published.metadata.name, planned.plan.token.name); assert.equal(published.metadata.symbol, planned.plan.token.symbol);
  artifacts.stage("api-token-verification");
  transport.setTimeoutMs(30_000);
  const url = new URL(`/api/v1/launches/${planned.predictedToken}`, fixture.apiUrl);
  url.searchParams.set("chainId", String(planned.chainId));
  const response = await transport.fetch(url, { method: "GET" });
  const representation = await response.json();
  artifacts.result.api.representation = representation;
  artifacts.save("published-token.json", representation);
  artifacts.event("actual-api-token", { status: response.status, representation });
  if (!response.ok) throw smokeError(representation.code ?? "API_TOKEN_HTTP_ERROR", representation.error ?? `Actual token GET failed: HTTP ${response.status}`, { status: response.status, data: representation });
  assert.equal(representation.chainId, Number(planned.chainId));
  const item = representation.item;
  assert.ok(item && typeof item === "object", "Actual API launch detail must contain item");
  assert.equal(item.chainId, Number(planned.chainId)); addressEqual(item.token, planned.predictedToken, "Indexed actual token");
  addressEqual(item.transactionHash, activation.transactionHash, "Indexed activation provenance"); addressEqual(item.creator, planned.plan.creator, "Indexed creator");
  assert.ok(["optimistic", "final"].includes(item.canonicalStatus), "Indexed canonical status");
  assert.equal(item.metadata?.document?.name, planned.plan.token.name); assert.equal(item.metadata?.document?.symbol, planned.plan.token.symbol);
  assert.equal(item.launchedToken?.name, planned.plan.token.name); assert.equal(item.launchedToken?.symbol, planned.plan.token.symbol);
  artifacts.result.api.status = "passed";
}

async function runCase({ options, artifacts, signal }) {
  artifacts.result.scope = options.execute ? options.chainOnly ? "chain-only" : "end-to-end" : "plan-only";
  const fixture = readFixture(options.fixture, options);
  const scenario = fixture.cases.find((row) => row.id === options.caseId);
  if (!scenario) throw smokeError("UNKNOWN_CASE", `Unknown fixture case ${options.caseId}; use --fixture FILE --list`);
  validateCase(scenario);
  artifacts.result.chain.chainId = fixture.chainId; artifacts.result.chain.rpcUrl = fixture.rpcUrl;
  artifacts.result.chain.orchestrator = fixture.orchestrator; artifacts.result.chain.creator = fixture.creator;
  artifacts.result.api = options.execute && options.chainOnly ? { status: "skipped", reason: "--chain-only explicitly omits API metadata, publication and indexing" } : { status: "not-run", endpoint: fixture.apiUrl, reason: options.execute ? "Execution has not reached API staging" : "--execute is required for signing/API writes" };
  artifacts.save("run-config.json", { fixture, options, case: scenario });
  const sdk = await import("../dist/index.js");
  const client = rpcClient(fixture.rpcUrl, artifacts, signal, "execution");
  artifacts.stage("fixture-provenance");
  const chainId = BigInt(await client.request({ method: "eth_chainId" }));
  assert.equal(chainId, BigInt(fixture.chainId));
  const backend = await client.request({ method: "web3_clientVersion" });
  assert.match(backend, /anvil/i, "Source writes are only authorized on the owned unlocked Anvil fixture");
  const accounts = await client.request({ method: "eth_accounts" });
  assert.ok(accounts.some((account) => same(account, fixture.creator)), "Fixture creator must be an owned unlocked Anvil account");
  artifacts.event("fixture-verified", { chainId, backend, creator: fixture.creator });
  const { plan, predictedToken } = await constructPlan({ client, fixture, scenario, sdk, artifacts, signal });
  if (!options.execute) {
    artifacts.stage("plan-prepared");
    artifacts.event("execution-not-run", { predictedToken, reason: "--execute is required for controlled-fork simulation, signing, source-chain transactions and API writes" });
    return "Plan prepared; launch not executed";
  }
  artifacts.stage("execution-planning");
  const limits = limitSource(fixture, artifacts);
  const baseFork = sdk.createControlledLifecycleFork({ sourceRpcUrl: fixture.rpcUrl, forkRpcUrl: fixture.forkRpcUrl, allowTransactions: true, impersonation: "anvil", receiptTimeoutMs: 30_000 });
  // Instrument the real controlled-fork transport too: simulation errors otherwise
  // may be condensed by the SDK into a planning reason, losing raw revert bytes.
  const fork = { ...baseFork, client: rpcClient(fixture.forkRpcUrl, artifacts, signal, "simulation") };
  assert.match(await fork.client.request({ method: "web3_clientVersion" }), /anvil/i);
  const planned = await sdk.planLaunch({ client, account: fixture.creator, plan, mode: scenario.mode, limits, fork, confirmations: 1 });
  artifacts.save("planning.json", planned);
  artifacts.event("execution-plan", { mode: planned.mode, simulation: planned.simulation, atomicAttempt: planned.atomicAttempt, prerequisites: planned.prerequisites, transactions: planned.transactions });
  assert.equal(planned.mode, scenario.mode, "Never silently change requested mode"); addressEqual(planned.predictedToken, predictedToken, "Planner token prediction");
  if (!planned.simulation.admitted) throw smokeError("PLAN_NOT_ADMITTED", planned.simulation.reason ?? "The actual SDK did not admit this exact launch", { simulation: planned.simulation });
  const transport = apiTransport({ artifacts, signal });
  const session = options.chainOnly ? undefined : await stageMetadata({ client, fixture, plan, sdk, artifacts, transport });
  const executed = await executePlan({ client, fixture, planned, sdk, artifacts, signal, limits, fork });
  await verifyChain({ client, planned, ...executed, fixture, scenario, sdk, artifacts });
  if (session) await publishAndVerify({ fixture, planned, activation: executed.activation, session, sdk, artifacts, transport, signal, timeoutSeconds: options.publishTimeoutSeconds });
  artifacts.stage("completed");
  return options.chainOnly ? "Chain-only launch passed; API skipped (not an end-to-end pass)" : "Actual chain launch and API publication/indexing passed";
}

const argv = process.argv.slice(2);
const redactor = new Redactor();
let artifacts;
const controller = new AbortController();
const interrupted = () => controller.abort(smokeError("INTERRUPTED", "Launch smoke interrupted; submitted hashes and local chain state are retained"));
process.on("SIGINT", interrupted); process.on("SIGTERM", interrupted);
try {
  // Capture a writable output before strict option/fixture validation, so early
  // configuration failures have the same journal/result protocol as chain failures.
  const outputIndex = argv.indexOf("--output");
  const caseIndex = argv.indexOf("--case");
  if (!argv.includes("--help") && !argv.includes("--list") && outputIndex >= 0 && argv[outputIndex + 1] && !argv[outputIndex + 1].startsWith("--")) {
    artifacts = new RunArtifacts(argv[outputIndex + 1], caseIndex >= 0 ? argv[caseIndex + 1] : null, redactor);
    artifacts.initialize();
  }
  const options = parseArguments(argv);
  if (options.help) console.log(HELP);
  else if (options.list) {
    const fixture = readFixture(options.fixture, options);
    console.log(fixture.cases.map((row) => `${row.id}\t${row.description ?? ""}`).join("\n"));
  } else {
    assert.ok(artifacts, "A fresh output directory is required");
    const message = await runCase({ options, artifacts, signal: controller.signal });
    artifacts.finish("passed");
    console.log(`${message}\nArtifacts: ${artifacts.directory}\nToken: ${artifacts.result.chain.token ?? artifacts.result.chain.predictedToken}`);
  }
} catch (failure) {
  const error = controller.signal.aborted ? controller.signal.reason : failure;
  if (error !== failure && error instanceof Error) error.cause = failure;
  if (artifacts) {
    if (artifacts.result.stage.startsWith("api-")) artifacts.result.api.status = "failed";
    else if (artifacts.result.execution === "running") artifacts.result.chain.status = "failed";
    try { artifacts.finish("failed", error); }
    catch (storageError) { console.error(JSON.stringify(redactor.value({ artifactWriteError: errorEvidence(storageError), originalError: errorEvidence(error) }))); }
  }
  console.error(JSON.stringify(redactor.value({ sdk: "node", caseId: artifacts?.result.caseId, status: "failed", stage: artifacts?.result.stage ?? "configuration", error: errorEvidence(error), artifacts: artifacts?.directory }), null, 2));
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", interrupted); process.removeListener("SIGTERM", interrupted);
}
