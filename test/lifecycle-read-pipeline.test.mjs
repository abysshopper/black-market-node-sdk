import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { decodeFunctionData, encodeFunctionData, encodeFunctionResult, keccak256, parseAbi, toHex, zeroAddress, zeroHash } from "viem";

const sourceTests = process.env.SDK_SOURCE_TEST === "1";
const sdkPath = sourceTests ? "../src/lifecycle/index.ts" : "../dist/lifecycle/index.js";
const rpcPath = sourceTests ? "../src/lifecycle/rpc.ts" : "../dist/lifecycle/rpc.js";
const { hashLaunchBounds, hashLaunchDependencies, hashLaunchIdentity, hashLaunchPlan, hashLifecycleProfile, launchLifecycleAbi, lifecycleAdapterAbi, lifecycleRegistryAbi,
  lifecycleV4LockerAbi, poolFeeCollectorFactoryV1Abi, poolHookDeployerV1Abi, poolMarketAdapterV1Abi, parseLaunchPlan, readLaunchProgress,
  LIFECYCLE_REQUIRED_CAPABILITIES, readLifecycleProfiles, V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA } = await import(sdkPath);
const { assertLifecycleBlock, lifecyclePinnedRpc, lifecycleRpc, readLifecycleContract, withLifecycleReadClient } = await import(rpcPath);
const address = (value) => toHex(BigInt(value), { size: 20 });
const hash = (value) => toHex(BigInt(value), { size: 32 });
const CORE = address(0xf0), REGISTRY = address(0xf1), ADAPTER = address(0xf2);
const CODE = "0x600160005560016000f3", CHUNK = `0x00${CODE.slice(2)}`;
const block = { number: 42n, hash: hash(42), timestamp: 100n, gasLimit: 30_000_000n };
const echoAbi = parseAbi(["function echo() view returns (uint256)", "function change() returns (uint256)"]);

// Complete frozen config-5 observations exercise the real graph certification path.
// These are offline RPC fixtures, not deployment or simulation evidence.
function boundProfileClient() {
  const codeHash = keccak256(CODE);
  const bounds = { minimumTickSpacing: 1, maximumTickSpacing: 200, maximumPositions: 32, maximumOracleCardinality: 4096, feeModeFlags: 3 };
  const graph = { manager: address(0xf3), hookRoot: zeroAddress, oracleFactory: address(0xf4), locker: address(0xf5), collectorFactory: address(0xf6),
    collectorDeployer: address(0xf7), hookDeployer: address(0xf8), coreCodeHash: codeHash, managerCodeHash: codeHash,
    hookRuntimeCodeHash: zeroHash, oracleFactoryCodeHash: codeHash, lockerCodeHash: codeHash, collectorFactoryCodeHash: codeHash,
    collectorDeployerCodeHash: codeHash, hookDeployerCodeHash: codeHash, hookCreationCodeHash: codeHash,
    codeChunk0: address(0xf9), codeChunk0Hash: keccak256(CHUNK), codeChunk1: zeroAddress, codeChunk1Hash: zeroHash, sharedHookSalt: zeroHash };
  const envelope = { artifactDigest: hash(1), reviewManifestDigest: hash(2), configBoundsDigest: hashLaunchBounds(bounds), termsDigest: hash(3),
    topology: 2, configVersion: 5, economicVersion: 3, capabilities: LIFECYCLE_REQUIRED_CAPABILITIES, flags: 0n, callbackFlags: 0x1afc,
    callbackMask: 0x3fff, protocolTreasury: address(0xda), protocolFeeDenominator: 5, beneficiary: address(0xdb), maximumDeveloperFeeBps: 500, bounds, graph };
  const id = hashLifecycleProfile(envelope), adapterId = hash(4);
  const digest = hashLaunchDependencies({ chainId: 4663n, core: CORE, registry: REGISTRY, registrar: ADAPTER, graph });
  const registration = { adapterId, configSchema: V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA, dependencyDigest: digest, venue: graph.manager,
    factory: zeroAddress, hook: zeroAddress, capabilities: LIFECYCLE_REQUIRED_CAPABILITIES, enabled: true };
  const adapterRegistration = { implementation: ADAPTER, codeHash, capabilities: LIFECYCLE_REQUIRED_CAPABILITIES, configVersion: 5, enabled: true };
  const state = { codes: {}, values: {}, failures: {}, reorg: false, chainDrift: false };
  const captured = [];
  const client = { state, captured, id, graph, envelope, async request({ method, params = [] }) {
    captured.push({ method, params });
    if (method === "eth_chainId") return toHex(state.chainDrift ? 4664n : 4663n);
    if (method === "eth_getBlockByNumber") return { number: "0x2a", hash: state.reorg && params[0] !== "latest" ? hash(43) : block.hash,
      timestamp: "0x64", gasLimit: toHex(block.gasLimit) };
    if (method === "eth_getCode") return state.codes[params[0].toLowerCase()] ?? (params[0].toLowerCase() === graph.codeChunk0 ? CHUNK : CODE);
    assert.equal(method, "eth_call", "Profile discovery only uses read-only source methods");
    assert.equal(params[1], "0x2a", "Every graph observation uses the same pinned block");
    const target = params[0].to.toLowerCase();
    const abis = target === CORE ? [launchLifecycleAbi] : target === REGISTRY ? [lifecycleRegistryAbi]
      : target === ADAPTER ? [poolMarketAdapterV1Abi, lifecycleAdapterAbi] : target === graph.locker ? [lifecycleV4LockerAbi]
        : target === graph.collectorFactory ? [poolFeeCollectorFactoryV1Abi] : target === graph.hookDeployer ? [poolHookDeployerV1Abi] : [];
    let call, abi;
    for (const candidate of abis) { try { call = decodeFunctionData({ abi: candidate, data: params[0].data }); abi = candidate; break; } catch {} }
    assert.ok(call, "Unexpected graph read");
    const key = `${target}:${call.functionName}`;
    if (state.failures[key]) throw state.failures[key];
    if (target === REGISTRY && call.functionName === "requireEligible") {
      // Model the registry's own live checks (LaunchImplementationRegistryV2.sol:285-296).
      const approvedAdapter = state.values[`${REGISTRY}:adapter`] ?? adapterRegistration;
      const approvedProfile = state.values[`${REGISTRY}:profile`] ?? registration;
      const implementation = approvedAdapter.implementation.toLowerCase();
      const internalFailure = state.failures[`${implementation}:core`] ?? state.failures[`${implementation}:dependencyDigest`];
      if (internalFailure !== undefined) throw internalFailure;
      const implementationCode = state.codes[implementation] ?? CODE;
      if (!approvedAdapter.enabled || !approvedProfile.enabled || approvedProfile.adapterId.toLowerCase() !== call.args[0].toLowerCase() ||
        call.args[1].toLowerCase() !== id.toLowerCase() || approvedAdapter.configVersion !== call.args[2] ||
        implementationCode === "0x" || keccak256(implementationCode).toLowerCase() !== approvedAdapter.codeHash.toLowerCase() ||
        (approvedAdapter.capabilities & call.args[3]) !== call.args[3] || (approvedProfile.capabilities & call.args[3]) !== call.args[3] ||
        (state.values[`${implementation}:core`] ?? CORE).toLowerCase() !== CORE ||
        (state.values[`${implementation}:dependencyDigest`] ?? digest).toLowerCase() !== approvedProfile.dependencyDigest.toLowerCase()) throw new Error("IneligibleImplementation");
    }
    let result;
    if (Object.hasOwn(state.values, key)) result = state.values[key];
    else if (target === CORE) result = { registry: REGISTRY }[call.functionName];
    else if (target === REGISTRY) result = { core: CORE, profileIds: [id], profile: registration,
      adapter: adapterRegistration,
      profileTopology: { hookTopology: 2, configVersion: 5, hookDeployer: graph.hookDeployer, hookCreationCodeHash: graph.hookCreationCodeHash },
      profileEnvelope: envelope, developerTerms: [ADAPTER, envelope.beneficiary, 500, envelope.termsDigest, true], protocolMaximumDeveloperFeeBps: 1000,
      requireEligible: ADAPTER }[call.functionName];
    else if (target === ADAPTER) result = { PROFILE_ID: id, CONFIG_SCHEMA: registration.configSchema,
      CONFIG_VERSION: 5, implementationRegistry: REGISTRY, poolManager: graph.manager, hookRoot: graph.hookRoot, oracleFactory: graph.oracleFactory,
      locker: graph.locker, collectorFactory: graph.collectorFactory, hookDeployer: graph.hookDeployer }[call.functionName];
    else if (target === graph.locker) result = { launcher: ADAPTER, poolManager: graph.manager }[call.functionName];
    else if (target === graph.collectorFactory) result = { collectorDeployer: graph.collectorDeployer }[call.functionName];
    else if (target === graph.hookDeployer) result = { creationCodeHash: graph.hookCreationCodeHash, codeChunk0: graph.codeChunk0, codeChunk1: graph.codeChunk1 }[call.functionName];
    assert.notEqual(result, undefined, "Fixture must supply a complete ABI observation, never a fallback");
    if (call.functionName === "requireEligible") {
      if (state.reorgAfterEligibility) state.reorg = true;
      if (state.driftAfterEligibility) state.chainDrift = true;
    }
    return encodeFunctionResult({ abi, functionName: call.functionName, result });
  } };
  return client;
}

test("reviewed graph rounds remain fully certified and duplicate profile IDs preserve ordered results with bounded reads", async () => {
  const source = boundProfileClient();
  let active = 0, peak = 0;
  const client = { supportsReadBatching: true, async request(args) {
    active += 1; peak = Math.max(peak, active);
    await nextTurn();
    try { return await source.request(args); } finally { active -= 1; }
  } };
  const rows = await readLifecycleProfiles({ client, orchestrator: CORE, profileIds: Array(16).fill(source.id) });
  assert.equal(rows.length, 16);
  assert.ok(rows.every((row) => row.admitted), rows[0].reason);
  assert.ok(peak > 1 && peak <= 8, `Observed read concurrency ${peak}`);
  for (const target of [CORE, source.graph.manager, source.graph.oracleFactory, source.graph.locker,
    source.graph.collectorFactory, source.graph.collectorDeployer, source.graph.hookDeployer, source.graph.codeChunk0]) {
    assert.equal(source.captured.filter((row) => row.method === "eth_getCode" && row.params[0].toLowerCase() === target).length, 1);
  }
});

test("standalone clients without read batching retain serial transport compatibility", async () => {
  const source = boundProfileClient();
  let active = 0;
  const client = { async request(args) {
    active += 1;
    try {
      assert.equal(active, 1, "The transport cannot serve concurrent independent requests");
      await nextTurn();
      return await source.request(args);
    } finally { active -= 1; }
  } };
  const [profile] = await readLifecycleProfiles({ client, orchestrator: CORE, profileIds: [source.id] });
  assert.equal(profile.id, source.id);
  assert.equal(profile.admitted, true, profile.reason);
});

test("frozen graph evidence and eligibility do not wait for unrelated adapter metadata", async () => {
  const source = boundProfileClient();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const client = { supportsReadBatching: true, async request(args) {
    if (args.method === "eth_call" && args.params[0].to === ADAPTER &&
      decodeFunctionData({ abi: poolMarketAdapterV1Abi, data: args.params[0].data }).functionName === "PROFILE_ID") await gate;
    return source.request(args);
  } };
  const pending = readLifecycleProfiles({ client, orchestrator: CORE, profileIds: [source.id] });
  await nextTurn();
  const chunkBeforeMetadata = source.captured.some((row) => row.method === "eth_getCode" && row.params[0] === source.graph.codeChunk0);
  const eligibilityBeforeMetadata = source.captured.some((row) => row.method === "eth_call" && row.params[0].to === REGISTRY &&
    decodeFunctionData({ abi: lifecycleRegistryAbi, data: row.params[0].data }).functionName === "requireEligible");
  release();
  const [profile] = await pending;
  assert.equal(chunkBeforeMetadata, true, "Frozen chunk evidence has no dependency on the adapter PROFILE_ID response");
  assert.equal(eligibilityBeforeMetadata, true, "Eligibility and graph certification both remain required, but are independent reads");
  assert.equal(profile.admitted, true, profile.reason);
});

test("pinned profile metadata overlaps chain identity, but malformed chain evidence rejects the invocation", async () => {
  for (const chainValue of ["0x1237", "not-a-chain"]) {
    const source = boundProfileClient();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const client = { supportsReadBatching: true, async request(args) {
      if (args.method === "eth_chainId") { await gate; return chainValue; }
      return source.request(args);
    } };
    const pending = readLifecycleProfiles({ client, orchestrator: CORE, profileIds: [source.id] }, block);
    const result = pending.then((profiles) => ({ profiles }), (error) => ({ error }));
    await nextTurn();
    const callsBeforeChain = source.captured.filter((row) => row.method === "eth_call").map((row) =>
      decodeFunctionData({ abi: row.params[0].to === CORE ? launchLifecycleAbi : lifecycleRegistryAbi, data: row.params[0].data }).functionName);
    release();
    const settled = await result;
    assert.ok(callsBeforeChain.includes("profileEnvelope"), "Pinned profile observations have no chain-response dependency");
    assert.equal(callsBeforeChain.includes("requireEligible"), false, "Chain-dependent certification cannot authorize from missing chain evidence");
    if (chainValue === "0x1237") assert.equal(settled.profiles[0].admitted, true, settled.profiles[0].reason);
    else assert.equal(settled.error.code, "INVALID_RPC_RESPONSE", "Provider chain failures are not swallowed into an individual profile reason");
  }
});

test("chain failures and registry authority failures remain invocation errors during overlapped discovery", async () => {
  for (const supportsReadBatching of [false, true]) {
    for (const failedRead of ["chain", "registry"]) {
      const source = boundProfileClient();
      const failure = new Error(`Required ${failedRead} source read failed`);
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const client = { supportsReadBatching, async request(args) {
        if (args.method === "eth_chainId") {
          if (failedRead === "chain") throw failure;
          if (supportsReadBatching) await gate;
        }
        if (failedRead === "registry" && args.method === "eth_call" && args.params[0].to === CORE) throw failure;
        return source.request(args);
      } };
      const pending = readLifecycleProfiles({ client, orchestrator: CORE, profileIds: [source.id] }, block);
      const rejection = assert.rejects(pending, (error) => error === failure);
      await nextTurn();
      release();
      await rejection;
      await nextTurn();
      assert.equal((await readLifecycleProfiles({ client: source, orchestrator: CORE, profileIds: [source.id] }, block))[0].admitted, true);
    }
  }
});

test("changed reviewed runtime, authority, terms, eligibility and creation chunks fail actual profile admission", async () => {
  const source = boundProfileClient();
  const read = async () => (await readLifecycleProfiles({ client: source, orchestrator: CORE, profileIds: [source.id] }))[0];
  assert.equal((await read()).admitted, true);
  const mutations = [
    { apply: () => { source.state.codes[source.graph.manager] = "0x600260005560026000f3"; }, reason: /runtime.*graph hash/ },
    { apply: () => { source.state.values[`${ADAPTER}:core`] = address(0xff); }, reason: /IneligibleImplementation/ },
    { apply: () => { source.state.codes[ADAPTER] = "0x"; }, reason: /IneligibleImplementation/ },
    { apply: () => { source.state.codes[ADAPTER] = "0x600260005560026000f3"; }, reason: /IneligibleImplementation/ },
    { apply: () => { source.state.values[`${ADAPTER}:dependencyDigest`] = hash(0xff); }, reason: /IneligibleImplementation/ },
    { apply: () => { source.state.values[`${REGISTRY}:adapter`] = { implementation: ADAPTER, codeHash: keccak256(CODE), capabilities: LIFECYCLE_REQUIRED_CAPABILITIES, configVersion: 5, enabled: false }; }, reason: /IneligibleImplementation/ },
    { apply: () => { source.state.values[`${source.graph.locker}:launcher`] = address(0xff); }, reason: /locker authority/ },
    { apply: () => { source.state.values[`${REGISTRY}:developerTerms`] = [ADAPTER, source.envelope.beneficiary, 499, source.envelope.termsDigest, true]; }, reason: /developer terms/ },
    { apply: () => { source.state.values[`${REGISTRY}:requireEligible`] = address(0xff); }, reason: /refuses this profile/ },
    { apply: () => { source.state.codes[source.graph.codeChunk0] = CODE; }, reason: /STOP-prefixed bytecode/ },
    { apply: () => { source.state.values[`${source.graph.hookDeployer}:codeChunk0`] = address(0xfe); }, reason: /STOP-prefixed bytecode/ },
  ];
  for (const mutation of mutations) {
    source.state.codes = {}; source.state.values = {};
    mutation.apply();
    const row = await read();
    assert.equal(row.admitted, false);
    assert.match(row.reason, mutation.reason);
  }
});

test("partial reviewed-graph read failures remain refusal evidence and do not poison a later invocation", async () => {
  const source = boundProfileClient(), key = `${ADAPTER}:oracleFactory`;
  source.state.failures[key] = new Error("Pinned reviewed oracle dependency could not be read");
  const options = { client: source, orchestrator: CORE, profileIds: [source.id] };
  const [failed] = await readLifecycleProfiles(options);
  assert.equal(failed.admitted, false);
  assert.match(failed.reason, /oracle dependency could not be read/);
  delete source.state.failures[key];
  assert.equal((await readLifecycleProfiles(options))[0].admitted, true);
});

test("standalone profile certification never reuses final chain or canonical block checks", async () => {
  for (const supportsReadBatching of [false, true]) {
    for (const [flag, code] of [["reorgAfterEligibility", "STATE_REORGED"], ["driftAfterEligibility", "CHAIN_MISMATCH"]]) {
      const source = boundProfileClient();
      source.supportsReadBatching = supportsReadBatching;
      source.state[flag] = true;
      await assert.rejects(readLifecycleProfiles({ client: source, orchestrator: CORE, profileIds: [source.id] }), { code });
    }
    const source = boundProfileClient();
    source.supportsReadBatching = supportsReadBatching;
    source.state.values[`${REGISTRY}:core`] = address(0xff);
    await assert.rejects(readLifecycleProfiles({ client: source, orchestrator: CORE, profileIds: [source.id] }), { code: "REGISTRY_BINDING" });
  }
});

test("fixed read identity separates source, block hash/number, caller and complete call context", async () => {
  const fromA = address(1), fromB = address(2), captured = [];
  const source = { revision: 0n, async request(args) {
    captured.push(args);
    const call = args.params[0];
    const value = this.revision + (call.from === fromA ? 11n : call.from === fromB ? 22n : 33n) + BigInt(call.value ?? "0x0") + BigInt(call.gas ?? "0x0");
    return encodeFunctionResult({ abi: echoAbi, functionName: "echo", result: value });
  } };
  await withLifecycleReadClient(source, async (client) => {
    const same = () => readLifecycleContract(client, CORE, echoAbi, "echo", [], block, fromA);
    const results = await Promise.all([same(), same(), readLifecycleContract(client, CORE, echoAbi, "echo", [], block, fromB), readLifecycleContract(client, CORE, echoAbi, "echo", [], block)]);
    assert.deepEqual(results, [11n, 11n, 22n, 33n]);
    assert.equal(captured.length, 3);
    const data = encodeFunctionData({ abi: echoAbi, functionName: "echo" });
    for (const fields of [{ from: fromA, value: "0x1" }, { from: fromA, gas: "0x2" }]) {
      const params = [{ to: CORE, data, ...fields }, "0x2a"];
      const first = await lifecyclePinnedRpc(client, "eth_call", params, block);
      assert.equal(await lifecyclePinnedRpc(client, "eth_call", params, block), first);
    }
    assert.equal(captured.length, 5);
    source.revision = 100n;
    assert.equal(await readLifecycleContract(client, CORE, echoAbi, "echo", [], { ...block, hash: hash(43) }, fromA), 111n);
    assert.equal(await readLifecycleContract(client, CORE, echoAbi, "echo", [], { ...block, number: 43n }, fromA), 111n);
    assert.equal(await same(), 11n);
    assert.equal(captured.length, 7);
  });
  assert.equal(await withLifecycleReadClient(source, (client) => readLifecycleContract(client, CORE, echoAbi, "echo", [], block, fromA)), 111n);
  const other = { async request() { return encodeFunctionResult({ abi: echoAbi, functionName: "echo", result: 999n }); } };
  assert.equal(await withLifecycleReadClient(other, (client) => readLifecycleContract(client, CORE, echoAbi, "echo", [], block, fromA)), 999n);
});

test("rejected fixed reads preserve the original error and are not retained as reusable authority", async () => {
  const failure = new Error("One pinned observation is unavailable");
  const source = { calls: 0, async request() {
    this.calls += 1;
    if (this.calls === 1) throw failure;
    return encodeFunctionResult({ abi: echoAbi, functionName: "echo", result: 44n });
  } };
  await withLifecycleReadClient(source, async (client) => {
    await assert.rejects(readLifecycleContract(client, CORE, echoAbi, "echo", [], block), (error) => error === failure);
    assert.equal(await readLifecycleContract(client, CORE, echoAbi, "echo", [], block), 44n);
    assert.equal(source.calls, 2);
  });
});

test("live, provider and stateful RPC requests plus non-view eth_call remain uncached", async () => {
  const captured = [];
  const source = { async request(args) {
    captured.push(args);
    if (args.method === "eth_call") return encodeFunctionResult({ abi: echoAbi, functionName: "change", result: BigInt(captured.length) });
    if (args.method === "eth_chainId") return "0x1";
    if (args.method === "eth_getBlockByNumber") return { number: "0x2a", hash: block.hash, timestamp: "0x64", gasLimit: toHex(block.gasLimit) };
    return "0x0";
  } };
  await withLifecycleReadClient(source, async (client) => {
    for (const [method, params] of [["eth_chainId", []], ["eth_getBlockByNumber", ["latest", false]], ["eth_accounts", []],
      ["eth_getTransactionCount", [address(1), "pending"]], ["eth_estimateGas", [{ from: address(1), to: CORE, data: "0x" }, "latest"]],
      ["eth_simulateV1", [{ blockStateCalls: [] }, "0x2a"]], ["evm_snapshot", []]]) {
      await lifecycleRpc(client, method, params); await lifecycleRpc(client, method, params);
      assert.equal(captured.filter((row) => row.method === method).length, 2);
    }
    await assertLifecycleBlock(client, block, 1n); await assertLifecycleBlock(client, block, 1n);
    assert.equal(captured.filter((row) => row.method === "eth_getBlockByNumber" && row.params[0] === "0x2a").length, 2);
    const first = await readLifecycleContract(client, CORE, echoAbi, "change", [], block);
    const second = await readLifecycleContract(client, CORE, echoAbi, "change", [], block);
    assert.notEqual(first, second);
  });
});

test("settled invocations discard late observations instead of installing them for a later caller", async () => {
  const gate = nextTurn();
  const failure = new Error("Required parallel observation failed");
  const source = { supportsReadBatching: true, calls: 0, async request(args) {
    this.calls += 1;
    if (args.method === "eth_chainId") throw failure;
    const result = encodeFunctionResult({ abi: echoAbi, functionName: "echo", result: BigInt(this.calls) });
    await gate;
    return result;
  } };
  let obsoleteClient;
  const pending = withLifecycleReadClient(source, async (client) => {
    obsoleteClient = client;
    await Promise.all([readLifecycleContract(client, CORE, echoAbi, "echo", [], block), lifecycleRpc(client, "eth_chainId")]);
  });
  await assert.rejects(pending, (error) => error === failure);
  await nextTurn();
  await assert.rejects(readLifecycleContract(obsoleteClient, CORE, echoAbi, "echo", [], block), { code: "READ_SCOPE_CLOSED" });
  assert.equal(await withLifecycleReadClient(source, (client) => readLifecycleContract(client, CORE, echoAbi, "echo", [], block)), 3n);
});

test("a rejected read releases its bounded slot without rejecting an unrelated queued caller", async () => {
  // Node 20 has no Promise.withResolvers; this gate requires an externally released executor.
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const failure = new Error("First independent observation failed");
  const called = [];
  let active = 0, peak = 0;
  const source = { supportsReadBatching: true, async request(args) {
    called.push(args.params[0].to);
    active += 1; peak = Math.max(peak, active);
    try {
      if (args.params[0].to === address(100)) throw failure;
      await gate;
      return encodeFunctionResult({ abi: echoAbi, functionName: "echo", result: BigInt(args.params[0].to) });
    } finally { active -= 1; }
  } };
  const pending = withLifecycleReadClient(source, (client) => Promise.allSettled(
    Array.from({ length: 9 }, (_, index) => readLifecycleContract(client, address(100 + index), echoAbi, "echo", [], block)),
  ));
  await nextTurn();
  const startedBeforeRelease = called.length;
  release();
  const results = await pending;
  assert.equal(startedBeforeRelease, 9, "The ninth read starts after the failed slot settles, without waiting for unrelated reads");
  assert.ok(peak <= 8);
  assert.equal(results[0].status, "rejected"); assert.equal(results[0].reason, failure);
  for (const [index, result] of results.slice(1).entries()) {
    assert.equal(result.status, "fulfilled"); assert.equal(result.value, BigInt(101 + index));
  }
});

test("required V4 fee-limit read failure still rejects profile certification", async () => {
  const client = boundProfileClient();
  const failure = new Error("V4 fee limits unavailable");
  client.state.failures[`${REGISTRY}:protocolMaximumDeveloperFeeBps`] = failure;
  await assert.rejects(
    readLifecycleProfiles({ client, orchestrator: CORE, profileIds: [client.id] }, block),
    (error) => error === failure,
  );
});

test("opt-in timing exposes pending profile/RPC work without leaking source data or changing admission", async () => {
  const source = boundProfileClient();
  const events = [];
  source.onDiagnostic = (event) => events.push(event);
  const [profile] = await readLifecycleProfiles({ client: source, orchestrator: CORE, profileIds: [source.id] });
  assert.equal(profile.admitted, true);
  assert.equal(events[0].stage, "profile.certification");
  assert.equal(events[0].phase, "start");
  const completion = events.find((event) => event.stage === "profile.certification" && event.phase === "success");
  assert.ok(Number.isFinite(completion.durationMs) && completion.durationMs >= 0);
  const starts = events.filter((event) => event.stage === "rpc" && event.phase === "start");
  for (const start of starts) {
    assert.ok(Number.isFinite(start.queueMs) && start.queueMs >= 0);
    assert.ok(events.some((event) => event.phase === "success" && event.requestId === start.requestId));
  }
  const allowed = ["stage", "phase", "durationMs", "queueMs", "requestId", "method"];
  assert.ok(events.every((event) => Object.keys(event).every((key) => allowed.includes(key))));
  const serialized = JSON.stringify(events);
  for (const privateValue of [CORE, ADAPTER, source.id, CODE]) assert.equal(serialized.includes(privateValue), false);
});

test("throwing or asynchronously rejecting diagnostic observers cannot reject a valid plan profile", async () => {
  for (const onDiagnostic of [
    () => { throw new Error("Observer failed"); },
    async () => { throw new Error("Observer failed asynchronously"); },
  ]) {
    const source = boundProfileClient();
    source.onDiagnostic = onDiagnostic;
    const [profile] = await readLifecycleProfiles({ client: source, orchestrator: CORE, profileIds: [source.id] });
    assert.equal(profile.admitted, true);
    await nextTurn();
  }
});

test("diagnostics report failures but do not serialize rejected RPC payloads", async () => {
  const source = boundProfileClient();
  const events = [];
  source.onDiagnostic = (event) => events.push(event);
  const privateFailure = "credential-bearing provider payload";
  source.state.failures[`${ADAPTER}:oracleFactory`] = new Error(privateFailure);
  const [profile] = await readLifecycleProfiles({ client: source, orchestrator: CORE, profileIds: [source.id] });
  assert.equal(profile.admitted, false);
  assert.ok(events.some((event) => event.stage === "rpc" && event.phase === "failure"));
  assert.equal(JSON.stringify(events).includes(privateFailure), false);
});

async function progressClient() {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/launch-lifecycle-v1.json", import.meta.url), "utf8"));
  const plan = parseLaunchPlan(JSON.stringify(fixture.plan)), token = address(0xfa);
  const planned = { plan, planHash: hashLaunchPlan(plan), launchId: hashLaunchIdentity(plan), predictedToken: token,
    account: plan.creator, mode: "staged", confirmations: 2 };
  const empty = { launchId: zeroHash, planHash: zeroHash, creator: zeroAddress, nonce: 0n, mode: 0, phase: 0,
    token: zeroAddress, feeHub: zeroAddress, rewards: zeroAddress, preparedMarkets: 0, marketCount: 0, buyCount: 0,
    positionCount: 0, deadline: 0n };
  const state = { pendingNonce: 7n, reorg: false, chainDrift: false };
  const captured = [];
  return { planned, state, captured, async request({ method, params = [] }) {
    captured.push({ method, params });
    if (method === "eth_chainId") return toHex(state.chainDrift ? plan.chainId + 1n : plan.chainId);
    if (method === "eth_getBlockByNumber") {
      const number = params[0] === "latest" ? block.number : BigInt(params[0]);
      return { number: toHex(number), hash: hash(state.reorg ? number + 100n : number), timestamp: "0x64", gasLimit: toHex(block.gasLimit) };
    }
    if (method === "eth_getTransactionCount") {
      if (params[1] === "pending") {
        if (state.reorgAfterNonce) state.reorg = true;
        if (state.driftAfterNonce) state.chainDrift = true;
        return toHex(state.pendingNonce);
      }
      return "0x7";
    }
    assert.equal(method, "eth_call", "Canonical progress uses only read-only source methods");
    const call = decodeFunctionData({ abi: launchLifecycleAbi, data: params[0].data });
    assert.ok(["readLaunchProgress", "predictToken"].includes(call.functionName));
    return encodeFunctionResult({ abi: launchLifecycleAbi, functionName: call.functionName,
      result: call.functionName === "predictToken" ? token : empty });
  } };
}

test("confirmed block acquisition overlaps live chain identity without advancing progress before validation", async () => {
  for (const wrongChain of [false, true]) {
    const source = await progressClient();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const client = { supportsReadBatching: true, async request(args) {
      if (args.method === "eth_getBlockByNumber" && args.params[0] === "0x29") await gate;
      if (wrongChain && args.method === "eth_chainId") {
        source.captured.push(args);
        return toHex(source.planned.plan.chainId + 1n);
      }
      return source.request(args);
    } };
    const pending = readLaunchProgress({ client, planned: source.planned }, block);
    const result = pending.then((progress) => ({ progress }), (error) => ({ error }));
    await nextTurn();
    const chainBeforeBlock = source.captured.some((row) => row.method === "eth_chainId");
    const progressBeforeBlock = source.captured.some((row) => row.method === "eth_call" || row.method === "eth_getTransactionCount");
    release();
    const settled = await result;
    assert.equal(chainBeforeBlock, true);
    assert.equal(progressBeforeBlock, false, "Unvalidated chain/block observations cannot authorize canonical progress or nonce reads");
    if (wrongChain) assert.equal(settled.error.code, "CHAIN_MISMATCH");
    else {
      assert.equal(settled.progress.confirmedBlockNumber, 41n);
      assert.equal(settled.progress.confirmedBlockHash, hash(41));
      assert.equal(settled.progress.confirmationSafe, true);
    }
  }
});

test("overlapped confirmed-block and chain failures preserve source errors and cannot leak late rejections", async () => {
  for (const supportsReadBatching of [false, true]) {
    for (const failedMethod of ["eth_getBlockByNumber", "eth_chainId"]) {
      const source = await progressClient();
      const failure = new Error(`Required ${failedMethod} evidence unavailable`);
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const client = { supportsReadBatching, async request(args) {
        if (args.method === failedMethod) throw failure;
        if (supportsReadBatching) await gate;
        return source.request(args);
      } };
      const rejection = assert.rejects(readLaunchProgress({ client, planned: source.planned }, block), (error) => error === failure);
      await nextTurn();
      release();
      await rejection;
      await nextTurn();
    }
  }
});

test("serial and batching progress retain pending-nonce uncertainty and final chain/canonical refusal", async () => {
  for (const supportsReadBatching of [false, true]) {
    const source = await progressClient();
    source.supportsReadBatching = supportsReadBatching;
    source.state.pendingNonce = 8n;
    const progress = await readLaunchProgress({ client: source, planned: source.planned });
    assert.equal(progress.confirmedAccountNonce, 7n);
    assert.equal(progress.headAccountNonce, 7n);
    assert.equal(progress.pendingAccountNonce, 8n);
    assert.equal(progress.confirmationSafe, false, "No receipt reference is required to detect pending account activity");
    for (const [flag, code] of [["reorgAfterNonce", "STATE_REORGED"], ["driftAfterNonce", "CHAIN_MISMATCH"]]) {
      const changed = await progressClient();
      changed.supportsReadBatching = supportsReadBatching;
      changed.state[flag] = true;
      await assert.rejects(readLaunchProgress({ client: changed, planned: changed.planned }), { code });
    }
  }
});
