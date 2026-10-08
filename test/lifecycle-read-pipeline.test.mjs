import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { concatHex, decodeFunctionData, encodeAbiParameters, encodeFunctionData, encodeFunctionResult, keccak256, parseAbi, parseAbiParameters, stringToHex, toHex, zeroAddress, zeroHash } from "viem";

const sourceTests = process.env.SDK_SOURCE_TEST === "1";
const sdkPath = sourceTests ? "../src/lifecycle/index.ts" : "../dist/lifecycle/index.js";
const rpcPath = sourceTests ? "../src/lifecycle/rpc.ts" : "../dist/lifecycle/rpc.js";
const { decodePoolBoundV4LifecycleMarketConfig, encodePoolBoundV4LifecycleMarketConfig, fixedFeePoolHookV1Abi, fixedFeePoolHookConfigV6Abi,
  hashLaunchBounds, hashLaunchDependencies, hashLaunchIdentity, hashLaunchPlan, hashLifecycleProfile, launchLifecycleAbi,
  lifecycleAdapterAbi, lifecycleFundingEscrowAbi, lifecycleOracleFactoryAbi, lifecycleRegistryAbi, lifecycleV4LockerAbi,
  poolFeeCollectorFactoryV1Abi, poolFeeCollectorFactoryConfigV6Abi, poolHookDeployerV1Abi, poolHookDeployerConfigV6Abi, poolMarketAdapterV1Abi, parseLaunchPlan, planLaunch,
  prepareAndPlanLifecycleLaunch, minePoolBoundHookSalt, readLaunchProgress, readPoolBoundHookDeployment, buildPoolBoundHookDeploymentTransaction, LIFECYCLE_MULTI_POSITION_CAPABILITY,
  LIFECYCLE_REQUIRED_CAPABILITIES, readLifecycleProfiles, V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA_V5, V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA_V6 } = await import(sdkPath);
const { assertLifecycleBlock, lifecyclePinnedRpc, lifecycleRpc, readLifecycleContract, withLifecycleReadClient } = await import(rpcPath);
const address = (value) => toHex(BigInt(value), { size: 20 });
const hash = (value) => toHex(BigInt(value), { size: 32 });
const CORE = address(0xf0), REGISTRY = address(0xf1), ADAPTER = address(0xf2);
const CODE = "0x600160005560016000f3", CHUNK = `0x00${CODE.slice(2)}`;
const block = { number: 42n, hash: hash(42), timestamp: 100n, gasLimit: 30_000_000n };
const echoAbi = parseAbi(["function echo() view returns (uint256)", "function change() returns (uint256)"]);

// Complete version-selected observations exercise the real graph certification path.
// These are offline RPC fixtures, not deployment or simulation evidence.
function boundProfileClient({ configVersion = 6, secondChunk = false, extraCapabilities = 0n, pinnedTags = ["0x2a"] } = {}) {
  const deployerAbi = configVersion === 5 ? poolHookDeployerV1Abi : poolHookDeployerConfigV6Abi;
  const collectorAbi = configVersion === 5 ? poolFeeCollectorFactoryV1Abi : poolFeeCollectorFactoryConfigV6Abi;
  const hookAbi = configVersion === 5 ? fixedFeePoolHookV1Abi : fixedFeePoolHookConfigV6Abi;
  const codeHash = keccak256(CODE);
  const chunk0 = secondChunk ? `0x00${"60".repeat(24575)}` : CHUNK;
  const chunk1 = secondChunk ? CHUNK : "0x";
  const creationCode = concatHex([`0x${chunk0.slice(4)}`, secondChunk ? `0x${chunk1.slice(4)}` : "0x"]);
  const capabilities = LIFECYCLE_REQUIRED_CAPABILITIES | extraCapabilities;
  const bounds = { minimumTickSpacing: 1, maximumTickSpacing: 200, maximumPositions: 32, maximumOracleCardinality: 4096, feeModeFlags: 3 };
  const graph = { manager: address(0xf3), hookRoot: zeroAddress, oracleFactory: address(0xf4), locker: address(0xf5), collectorFactory: address(0xf6),
    collectorDeployer: address(0xf7), hookDeployer: address(0xf8), coreCodeHash: codeHash, managerCodeHash: codeHash,
    hookRuntimeCodeHash: zeroHash, oracleFactoryCodeHash: codeHash, lockerCodeHash: codeHash, collectorFactoryCodeHash: codeHash,
    collectorDeployerCodeHash: codeHash, hookDeployerCodeHash: codeHash, hookCreationCodeHash: keccak256(creationCode),
    codeChunk0: address(0xf9), codeChunk0Hash: keccak256(chunk0), codeChunk1: secondChunk ? address(0xfc) : zeroAddress,
    codeChunk1Hash: secondChunk ? keccak256(chunk1) : zeroHash, sharedHookSalt: zeroHash };
  const envelope = { artifactDigest: hash(1), reviewManifestDigest: hash(2), configBoundsDigest: hashLaunchBounds(bounds), termsDigest: hash(3),
    topology: 2, configVersion, economicVersion: 3, capabilities, flags: 0n, callbackFlags: 0x1afc,
    callbackMask: 0x3fff, protocolTreasury: address(0xda), protocolFeeDenominator: 5, beneficiary: address(0xdb), maximumDeveloperFeeBps: 500, bounds, graph };
  const id = hashLifecycleProfile(envelope), adapterId = hash(4);
  const digest = hashLaunchDependencies({ chainId: 4663n, core: CORE, registry: REGISTRY, registrar: ADAPTER, graph });
  const registration = { adapterId, configSchema: configVersion === 5 ? V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA_V5 : V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA_V6, dependencyDigest: digest, venue: graph.manager,
    factory: zeroAddress, hook: zeroAddress, capabilities, enabled: true };
  const adapterRegistration = { implementation: ADAPTER, codeHash, capabilities, configVersion, enabled: true };
  const state = { codes: {}, values: {}, failures: {}, reorg: false, chainDrift: false };
  const captured = [];
  const client = { state, captured, id, adapterId, registration, adapterRegistration, graph, envelope, creationCode, configVersion, deployerAbi, collectorAbi, hookAbi, async request({ method, params = [] }) {
    captured.push({ method, params });
    if (method === "eth_chainId") return toHex(state.chainDrift ? 4664n : 4663n);
    if (method === "eth_getBlockByNumber") return { number: "0x2a", hash: state.reorg && params[0] !== "latest" ? hash(43) : block.hash,
      timestamp: "0x64", gasLimit: toHex(block.gasLimit) };
    if (method === "eth_getCode") return state.codes[params[0].toLowerCase()] ?? (params[0].toLowerCase() === graph.codeChunk0 ? chunk0 : params[0].toLowerCase() === graph.codeChunk1 ? chunk1 : CODE);
    assert.equal(method, "eth_call", "Profile discovery only uses read-only source methods");
    assert.ok(pinnedTags.includes(params[1]), "Every graph observation uses an SDK-owned pinned block");
    const target = params[0].to.toLowerCase();
    const abis = target === CORE ? [launchLifecycleAbi] : target === REGISTRY ? [lifecycleRegistryAbi]
      : target === ADAPTER ? [poolMarketAdapterV1Abi, lifecycleAdapterAbi] : target === graph.locker ? [lifecycleV4LockerAbi]
        : target === graph.collectorFactory ? [collectorAbi] : target === graph.hookDeployer ? [deployerAbi] : [];
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
        call.args[0].toLowerCase() !== adapterId.toLowerCase() || call.args[1].toLowerCase() !== id.toLowerCase() || approvedAdapter.configVersion !== call.args[2] ||
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
      profileTopology: { hookTopology: 2, configVersion, hookDeployer: graph.hookDeployer, hookCreationCodeHash: graph.hookCreationCodeHash },
      profileEnvelope: envelope, developerTerms: [ADAPTER, envelope.beneficiary, 500, envelope.termsDigest, true], protocolMaximumDeveloperFeeBps: 1000,
      requireEligible: ADAPTER }[call.functionName];
    else if (target === ADAPTER) result = { PROFILE_ID: id, CONFIG_SCHEMA: registration.configSchema,
      CONFIG_VERSION: configVersion, implementationRegistry: REGISTRY, poolManager: graph.manager, hookRoot: graph.hookRoot, oracleFactory: graph.oracleFactory,
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

test("profile discovery selects exact config5 or config6 schemas and refuses crossed or unknown registrations", async () => {
  for (const configVersion of [5, 6]) {
    const source = boundProfileClient({ configVersion });
    const [profile] = await readLifecycleProfiles({ client: source, orchestrator: CORE, profileIds: [source.id] });
    assert.equal(profile.admitted, true, profile.reason);
    assert.equal(profile.topology.configVersion, configVersion);
    assert.equal(profile.adapter.configVersion, configVersion);
    assert.equal(profile.envelope.configVersion, configVersion);
    for (const schema of [configVersion === 5 ? V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA_V6 : V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA_V5, hash(0xbad)]) {
      const changed = boundProfileClient({ configVersion });
      changed.state.values[`${REGISTRY}:profile`] = { ...changed.registration, configSchema: schema };
      const [refused] = await readLifecycleProfiles({ client: changed, orchestrator: CORE, profileIds: [changed.id] });
      assert.equal(refused.admitted, false);
      assert.equal(refused.registration.configSchema, schema);
      assert.equal(refused.adapter.configVersion, configVersion);
    }
  }
});

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
    { apply: () => { source.state.codes[source.graph.manager] = "0x600260005560026000f3"; } },
    { apply: () => { source.state.values[`${ADAPTER}:core`] = address(0xff); } },
    { apply: () => { source.state.codes[ADAPTER] = "0x"; } },
    { apply: () => { source.state.codes[ADAPTER] = "0x600260005560026000f3"; } },
    { apply: () => { source.state.values[`${ADAPTER}:dependencyDigest`] = hash(0xff); } },
    { apply: () => { source.state.values[`${REGISTRY}:adapter`] = { implementation: ADAPTER, codeHash: keccak256(CODE), capabilities: LIFECYCLE_REQUIRED_CAPABILITIES, configVersion: 6, enabled: false }; } },
    { apply: () => { source.state.values[`${source.graph.locker}:launcher`] = address(0xff); } },
    { apply: () => { source.state.values[`${REGISTRY}:developerTerms`] = [ADAPTER, source.envelope.beneficiary, 499, source.envelope.termsDigest, true]; } },
    { apply: () => { source.state.values[`${REGISTRY}:requireEligible`] = address(0xff); } },
    { apply: () => { source.state.codes[source.graph.codeChunk0] = CODE; } },
    { apply: () => { source.state.values[`${source.graph.hookDeployer}:codeChunk0`] = address(0xfe); } },
  ];
  for (const mutation of mutations) {
    source.state.codes = {}; source.state.values = {};
    mutation.apply();
    const row = await read();
    assert.equal(row.admitted, false);
    assert.ok(row.reason);
  }
});

test("partial reviewed-graph read failures remain refusal evidence and do not poison a later invocation", async () => {
  const source = boundProfileClient(), key = `${ADAPTER}:oracleFactory`;
  source.state.failures[key] = new Error("Pinned reviewed oracle dependency could not be read");
  const options = { client: source, orchestrator: CORE, profileIds: [source.id] };
  const [failed] = await readLifecycleProfiles(options);
  assert.equal(failed.admitted, false);
  assert.ok(failed.reason);
  assert.equal(failed.reason.includes(source.state.failures[key].message), false);
  delete source.state.failures[key];
  assert.equal((await readLifecycleProfiles(options))[0].admitted, true);
});

test("failed graph certificates are evicted within their still-open invocation", async () => {
  const source = boundProfileClient();
  const key = `${ADAPTER}:oracleFactory`;
  await withLifecycleReadClient(source, async (client) => {
    source.state.failures[key] = new Error("One pinned dependency read failed");
    const options = { client, orchestrator: CORE, profileIds: [source.id] };
    const [failed] = await readLifecycleProfiles(options, block);
    assert.equal(failed.admitted, false);
    assert.ok(failed.reason);
    assert.equal(failed.reason.includes(source.state.failures[key].message), false);
    delete source.state.failures[key];
    const [recovered] = await readLifecycleProfiles(options, block);
    assert.equal(recovered.admitted, true, recovered.reason);
  });
});

test("certification cannot inherit another chain, source or core/registry graph at the same pin", async () => {
  const source = boundProfileClient();
  const otherCore = address(0xee), otherRegistry = address(0xef);
  const transport = { async request(args) {
    if (args.method === "eth_call" && args.params[0].to.toLowerCase() === otherCore) {
      return encodeFunctionResult({ abi: launchLifecycleAbi, functionName: "registry", result: otherRegistry });
    }
    if (args.method === "eth_call" && args.params[0].to.toLowerCase() === otherRegistry) {
      const call = decodeFunctionData({ abi: lifecycleRegistryAbi, data: args.params[0].data });
      if (call.functionName === "core") return encodeFunctionResult({ abi: lifecycleRegistryAbi, functionName: "core", result: otherCore });
      return source.request({ ...args, params: [{ ...args.params[0], to: REGISTRY }, args.params[1]] });
    }
    return source.request(args);
  } };
  await withLifecycleReadClient(transport, async (client) => {
    const options = { client, orchestrator: CORE, profileIds: [source.id] };
    assert.equal((await readLifecycleProfiles(options, block))[0].admitted, true);
    source.state.chainDrift = true;
    const [wrongChain] = await readLifecycleProfiles(options, block);
    assert.equal(wrongChain.admitted, false);
    assert.ok(wrongChain.reason);
    source.state.chainDrift = false;
    const [wrongCore] = await readLifecycleProfiles({ ...options, orchestrator: otherCore }, block);
    assert.equal(wrongCore.admitted, false);
    assert.ok(wrongCore.reason);
    const differentSource = boundProfileClient();
    differentSource.state.codes[differentSource.graph.manager] = "0x6000";
    const [wrongSource] = await readLifecycleProfiles({ client: differentSource, orchestrator: CORE, profileIds: [source.id] }, block);
    assert.equal(wrongSource.admitted, false);
    assert.ok(wrongSource.reason);
  });
});

test("every observed registration, adapter, topology and envelope scalar is re-proved at a changed pin", async () => {
  const template = boundProfileClient();
  const topology = { hookTopology: 2, configVersion: 6, hookDeployer: template.graph.hookDeployer, hookCreationCodeHash: template.graph.hookCreationCodeHash };
  const changeScalar = (value) => typeof value === "boolean" ? !value : typeof value === "bigint" ? value ^ LIFECYCLE_MULTI_POSITION_CAPABILITY
    : typeof value === "number" ? value + 1 : value.length === 42 ? address(0xbeef) : hash(0xbeef);
  const cases = [
    ...Object.keys(template.registration).map((field) => [`profile.${field}`, (source) => {
      source.state.values[`${REGISTRY}:profile`] = { ...source.registration, [field]: changeScalar(source.registration[field]) };
    }]),
    ...Object.keys(template.adapterRegistration).map((field) => [`adapter.${field}`, (source) => {
      source.state.values[`${REGISTRY}:adapter`] = { ...source.adapterRegistration, [field]: changeScalar(source.adapterRegistration[field]) };
    }]),
    ...Object.keys(topology).map((field) => [`topology.${field}`, (source) => {
      source.state.values[`${REGISTRY}:profileTopology`] = { ...topology, [field]: field === "hookTopology" ? 1 : changeScalar(topology[field]) };
    }]),
    ...Object.keys(template.envelope).filter((field) => field !== "bounds" && field !== "graph").map((field) => [`envelope.${field}`, (source) => {
      source.state.values[`${REGISTRY}:profileEnvelope`] = { ...source.envelope,
        [field]: field === "protocolTreasury" ? zeroAddress : field === "protocolFeeDenominator" ? 1 : field === "topology" ? 1 : changeScalar(source.envelope[field]) };
    }]),
    ...Object.keys(template.envelope.bounds).map((field) => [`bounds.${field}`, (source) => {
      source.state.values[`${REGISTRY}:profileEnvelope`] = { ...source.envelope, bounds: { ...source.envelope.bounds, [field]: changeScalar(source.envelope.bounds[field]) } };
    }]),
    ...Object.keys(template.graph).map((field) => [`graph.${field}`, (source) => {
      source.state.values[`${REGISTRY}:profileEnvelope`] = { ...source.envelope, graph: { ...source.graph, [field]: changeScalar(source.graph[field]) } };
    }]),
  ];
  for (const [label, change] of cases) {
    const source = boundProfileClient({ pinnedTags: ["0x2a", "0x2b"] });
    await withLifecycleReadClient(source, async (client) => {
      const options = { client, orchestrator: CORE, profileIds: [source.id] };
      assert.equal((await readLifecycleProfiles(options, block))[0].admitted, true, label);
      change(source);
      // Same height/different hash and different height/same hash are distinct
      // observations, neither a renewable certificate for the original pin.
      for (const next of [{ ...block, hash: hash(999) }, { ...block, number: 43n }]) {
        const [changed] = await readLifecycleProfiles(options, next);
        assert.equal(changed.admitted, false, `${label} cannot inherit earlier certification`);
        assert.ok(changed.reason, `${label} must retain its real refusal`);
      }
    });
  }
});

test("mutable public profile observations cannot replace a private certified graph", async () => {
  const source = boundProfileClient();
  await withLifecycleReadClient(source, async (client) => {
    const options = { client, orchestrator: CORE, profileIds: [source.id] };
    const [observed] = await readLifecycleProfiles(options, block);
    const original = structuredClone(observed);
    observed.registration.enabled = false;
    observed.adapter.codeHash = zeroHash;
    observed.topology.hookDeployer = address(0xbeef);
    observed.envelope.graph.codeChunk0Hash = zeroHash;
    observed.envelope.bounds.maximumPositions = 0;
    observed.developerTerms.enabled = false;
    const [freshDto] = await readLifecycleProfiles(options, block);
    assert.deepEqual(freshDto, original);
    assert.notEqual(freshDto, observed);
  });
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
  assert.equal(JSON.stringify(profile, (_key, value) => typeof value === "bigint" ? value.toString() : value).includes(privateFailure), false, "Profile DTO refusal reasons also exclude private provider messages");
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

// A complete two-bound, two-chunk read fixture. Admission deliberately refuses
// its smart account; these tests prove read/mining boundaries, not EVM execution.
async function boundPlanningClient(supportsReadBatching = true, configVersion = 6) {
  const source = boundProfileClient({ configVersion, secondChunk: true, extraCapabilities: LIFECYCLE_MULTI_POSITION_CAPABILITY,
    pinnedTags: ["0x2a", "0x2b", "0x2c"] });
  const fixture = JSON.parse(await readFile(new URL("./fixtures/launch-lifecycle-v1.json", import.meta.url), "utf8"));
  const original = parseLaunchPlan(JSON.stringify(fixture.plan));
  const TOKEN = address(0x10), FACTORY = address(0xfb), ESCROW = address(0xfd), quotes = [address(0x20), address(0x30)];
  const oracleConfigId = hash(55);
  const config = { version: configVersion, lpFeePips: 3000, tickSpacing: 60, sqrtPriceX96: 1n << 96n, hookFeePips: 10000,
    ...(configVersion === 6 ? { minimumHookFeePips: 1000, feeSensitivityPipsSecondsPerTick: 7654321 } : {}),
    feeMode: 0, protocolFeeDenominator: source.envelope.protocolFeeDenominator, treasury: source.envelope.protocolTreasury,
    externalLiquidityDisabled: true, oracleConfigId, hookSalt: zeroHash, profileId: source.id,
    termsDigest: source.envelope.termsDigest, developerBeneficiary: source.envelope.beneficiary, developerFeeBps: 0,
    positions: [0, 1].map((index) => ({ tickLower: index * 60, tickUpper: (index + 1) * 60, liquidity: 1000n,
      salt: hash(index + 1), maxTokenAmount: 1000n })) };
  const plan = { ...original, chainId: 4663n, orchestrator: CORE, token: { ...original.token, kind: 0, rewardMode: 0, supply: 4000n },
    funding: [], buys: [], deadline: 1000n,
    feeAssets: [TOKEN, ...quotes].map((asset) => ({ asset, ownerBps: 10000, rewardsBps: 0, burnBps: 0 })),
    markets: quotes.map((quoteAsset) => ({ adapterId: source.adapterId, profileId: source.id, quoteAsset,
      tokenBudget: 2000n, configVersion, config: encodePoolBoundV4LifecycleMarketConfig(config) })) };
  const constructorWire = parseAbiParameters(configVersion === 5
    ? "(address,address,address,address,address,address,address,uint24,int24,uint160,uint24,uint8,uint8,address,bool,bytes32,bytes32,uint32)"
    : "(address,address,address,address,address,address,address,uint24,int24,uint160,uint24,uint24,uint32,uint8,uint8,address,bool,bytes32,bytes32,uint32)");
  const constructorBytes = (parameters) => encodeAbiParameters(constructorWire, [[
    parameters.poolManager, parameters.registrar, parameters.oracleFactory, parameters.core, parameters.liquidityLocker,
    parameters.token, parameters.quoteCurrency, parameters.lpFeePips, parameters.tickSpacing, parameters.sqrtPriceX96,
    parameters.hookFeePips, ...(configVersion === 6 ? [parameters.minimumHookFeePips, parameters.feeSensitivityPipsSecondsPerTick] : []),
    parameters.feeMode, parameters.protocolFeeDenominator, parameters.treasury,
    parameters.externalLiquidityDisabled, parameters.oracleConfigId, parameters.marketCommitment, parameters.expectedPositionCount,
  ]]);
  const initHash = (parameters) => keccak256(concatHex([source.creationCode, constructorBytes(parameters)]));
  const prediction = (parameters, salt) => `0x${keccak256(concatHex(["0xff", source.graph.hookDeployer, salt, initHash(parameters)])).slice(-40)}`;
  const observedHooks = new Map();
  function economics(market) {
    const selected = decodePoolBoundV4LifecycleMarketConfig(market.config);
    const commitment = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint256,address,address,address,bytes32,bytes32,address,uint256,uint32,bytes32"), [
      keccak256(stringToHex("black-market.pool-bound-market-economics.v1")), plan.chainId, CORE, ADAPTER, TOKEN,
      market.adapterId, market.profileId, market.quoteAsset, market.tokenBudget, market.configVersion,
      keccak256(encodePoolBoundV4LifecycleMarketConfig({ ...selected, hookSalt: zeroHash })),
    ]));
    const parameters = { poolManager: source.graph.manager, registrar: ADAPTER, oracleFactory: source.graph.oracleFactory,
      core: CORE, liquidityLocker: source.graph.locker, token: TOKEN, quoteCurrency: market.quoteAsset,
      lpFeePips: selected.lpFeePips, tickSpacing: selected.tickSpacing, sqrtPriceX96: selected.sqrtPriceX96,
      hookFeePips: selected.hookFeePips,
      ...(configVersion === 6 ? { minimumHookFeePips: selected.minimumHookFeePips, feeSensitivityPipsSecondsPerTick: selected.feeSensitivityPipsSecondsPerTick } : {}),
      feeMode: selected.feeMode, protocolFeeDenominator: selected.protocolFeeDenominator,
      treasury: selected.treasury, externalLiquidityDisabled: selected.externalLiquidityDisabled,
      oracleConfigId: selected.oracleConfigId, marketCommitment: commitment, expectedPositionCount: selected.positions.length };
    const predictedHook = prediction(parameters, selected.hookSalt);
    const poolId = keccak256(encodeAbiParameters(parseAbiParameters("address,address,uint24,int24,address"),
      [TOKEN, market.quoteAsset, selected.lpFeePips, selected.tickSpacing, predictedHook]));
    const canonicalId = keccak256(encodeAbiParameters(parseAbiParameters("uint256,uint8,address,address,address,bytes32,bytes32"),
      [plan.chainId, 0, source.graph.manager, zeroAddress, zeroAddress, poolId, market.profileId]));
    const identity = { venue: 0, canonicalId, manager: source.graph.manager, factory: zeroAddress, pool: zeroAddress,
      hook: predictedHook, poolId, profileId: market.profileId, currency0: TOKEN, currency1: market.quoteAsset,
      fee: selected.lpFeePips, tickSpacing: selected.tickSpacing, openingSqrtPriceX96: selected.sqrtPriceX96 };
    const row = { parameters, salt: selected.hookSalt, initCodeHash: initHash(parameters), predictedHook, identity };
    observedHooks.set(predictedHook.toLowerCase(), row);
    return row;
  }
  const nitroAbi = parseAbi(["function arbOSVersion() view returns (uint256)", "function getMaxTxGasLimit() view returns (uint256)", "function getMaxBlockGasLimit() view returns (uint64)"]);
  const readAbi = [...launchLifecycleAbi, ...lifecycleAdapterAbi, ...lifecycleFundingEscrowAbi, ...lifecycleRegistryAbi,
    ...lifecycleOracleFactoryAbi, ...source.collectorAbi, ...source.deployerAbi, ...poolMarketAdapterV1Abi,
    ...lifecycleV4LockerAbi, ...source.hookAbi, ...nitroAbi];
  const emptyProgress = { launchId: zeroHash, planHash: zeroHash, creator: zeroAddress, nonce: 0n, mode: 0, phase: 0,
    token: zeroAddress, feeHub: zeroAddress, rewards: zeroAddress, preparedMarkets: 0, marketCount: 0, buyCount: 0,
    positionCount: 0, deadline: 0n };
  const state = { latestReads: 0, active: 0, peak: 0, fixedHead: undefined, afterFinalSnapshot: undefined };
  const captured = [];
  const client = { source, state, captured, plan, economics, prediction, supportsReadBatching, async request({ method, params = [] }) {
    const row = { method, params };
    captured.push(row);
    state.active += 1; state.peak = Math.max(state.peak, state.active);
    try {
      if (supportsReadBatching) await nextTurn();
      if (method === "eth_getBlockByNumber") {
        const number = params[0] === "latest" ? state.fixedHead ?? BigInt(41 + ++state.latestReads) : BigInt(params[0]);
        if (params[0] === "latest" && state.latestReads === 2) state.afterFinalSnapshot?.();
        return { number: toHex(number), hash: source.state.reorg && params[0] !== "latest" ? hash(number + 100n) : hash(number),
          timestamp: toHex(100n + number - 42n), gasLimit: toHex(block.gasLimit), baseFeePerGas: "0x1" };
      }
      if (method === "eth_chainId") return toHex(source.state.chainDrift ? 4664n : 4663n);
      if (method === "eth_getTransactionCount") return params[1] === "pending" && state.pendingNonce ? "0x1" : "0x0";
      if (method === "eth_getBalance") return toHex(10n ** 20n);
      if (method === "eth_gasPrice") { state.onGasPrice?.(); return "0x2"; }
      if (method === "eth_getCode") {
        const target = params[0].toLowerCase();
        if (target === plan.creator.toLowerCase()) return "0x6000";
        if (target === FACTORY) return state.factoryCode ?? CODE;
        if (quotes.includes(target)) return CODE;
        if (observedHooks.has(target)) return state.existingHooks ? CODE : "0x";
        return source.request({ method, params });
      }
      assert.equal(method, "eth_call", "Read-only fixture must never submit or pretend to execute an economic simulation");
      const call = decodeFunctionData({ abi: readAbi, data: params[0].data });
      row.functionName = call.functionName;
      row.target = params[0].to.toLowerCase();
      state.onCall?.(row, call);
      let result;
      if (row.target === CORE) {
        if (call.functionName === "predictToken") result = state.changedToken ? address(0x11) : TOKEN;
        else if (call.functionName === "tokenFactory") result = FACTORY;
        else if (call.functionName === "hashPlan") result = hashLaunchPlan(call.args[0]);
        else if (call.functionName === "launchIdOf") result = hashLaunchIdentity(call.args[0]);
        else if (call.functionName === "readLaunchProgress") result = emptyProgress;
        else if (call.functionName === "fundingEscrow") result = ESCROW;
      } else if ((row.target === FACTORY || row.target === ESCROW) && call.functionName === "core") result = CORE;
      else if (row.target === source.graph.oracleFactory && call.functionName === "oracleConfigs") result = state.invalidOracle ? [0, 0] : [1, 4096];
      else if (row.target === source.graph.collectorFactory && call.functionName === "poolBoundHookParameters") {
        const bound = economics(call.args[2]);
        const parameters = state.changedFeeParameter
          ? { ...bound.parameters, [state.changedFeeParameter]: bound.parameters[state.changedFeeParameter] + 1 }
          : state.changedConstructor ? { ...bound.parameters, core: REGISTRY } : bound.parameters;
        result = [parameters, bound.salt];
      } else if (row.target === ADAPTER && call.functionName === "hookDeploymentMetadata") {
        const bound = economics(call.args[1]);
        result = [source.graph.hookDeployer, bound.initCodeHash, bound.salt, state.changedPrediction ? address(0x1afc) : bound.predictedHook];
      } else if (row.target === source.graph.hookDeployer && call.functionName === "initCodeHash") result = state.changedInitHash ? hash(999) : initHash(call.args[0]);
      else if (row.target === source.graph.hookDeployer && call.functionName === "predict") result = prediction(call.args[0], call.args[1]);
      else if (row.target === source.graph.hookDeployer && call.functionName === "deployedCodeHash") result = state.badProvenance ? zeroHash : keccak256(CODE);
      else if (row.target === ADAPTER && call.functionName === "resolve") {
        const bound = economics(call.args[2]);
        result = state.changedResolution ? { ...bound.identity, hook: address(0x1afc) } : bound.identity;
      } else if (observedHooks.has(row.target)) {
        const bound = observedHooks.get(row.target);
        result = { ...bound.parameters, registrar: ADAPTER, liquidityLocker: source.graph.locker,
          ...(state.changedFeeGetter ? { [state.changedFeeGetter]: bound.parameters[state.changedFeeGetter] + 1 } : {}),
          REQUIRED_HOOK_FLAGS: 0x1afcn, ALL_HOOK_MASK: 0x3fffn, boundPoolId: bound.identity.poolId,
          deploymentConfigHash: keccak256(constructorBytes(bound.parameters)), marketCommitment: bound.parameters.marketCommitment,
          openingSqrtPriceX96: bound.parameters.sqrtPriceX96, expectedPositionCount: bound.parameters.expectedPositionCount }[call.functionName];
      } else if (row.target === address(0x64)) result = 105n;
      else if (row.target === address(0x6c)) result = call.functionName === "getMaxTxGasLimit" ? 32_000_000n : 64_000_000n;
      if (result !== undefined) return encodeFunctionResult({ abi: readAbi, functionName: call.functionName, result });
      return source.request({ method, params });
    } finally { state.active -= 1; }
  } };
  return client;
}

test("config5 consumers prepare, hash, mine and predeploy V1 without requesting V2 fee getters", async () => {
  for (const batching of [false, true]) {
    const client = await boundPlanningClient(batching, 5);
    const draftHash = hashLaunchPlan(client.plan);
    const planned = await prepareAndPlanLifecycleLaunch({ client, plan: client.plan, account: client.plan.creator, mode: "staged" });
    assert.equal(hashLaunchPlan(client.plan), draftHash);
    assert.equal(planned.hookDeployments.length, 2);
    assert.equal(planned.simulation.admitted, false, "A read fixture must not claim an EVM execution proof");
    for (const deployment of planned.hookDeployments) {
      const market = planned.plan.markets[deployment.marketIndex];
      const config = decodePoolBoundV4LifecycleMarketConfig(market.config, 5);
      const expected = client.economics(market);
      assert.equal(market.configVersion, 5);
      assert.equal(config.version, 5);
      assert.equal(Object.hasOwn(config, "minimumHookFeePips"), false);
      assert.equal(deployment.initCodeHash, expected.initCodeHash);
      assert.equal(deployment.predictedHook.toLowerCase(), expected.predictedHook);
      assert.equal(BigInt(deployment.predictedHook) & 0x3fffn, 0x1afcn);
    }
    client.state.existingHooks = true;
    client.state.fixedHead = 43n;
    const options = { client, plan: planned.plan, marketIndex: 0 };
    const transaction = await buildPoolBoundHookDeploymentTransaction(options);
    const decoded = decodeFunctionData({ abi: poolHookDeployerV1Abi, data: transaction.data });
    assert.equal(decoded.functionName, "deploy");
    assert.equal(Object.keys(decoded.args[0]).length, 18);
    assert.equal(Object.hasOwn(decoded.args[0], "minimumHookFeePips"), false);
    assert.equal(Object.hasOwn(decoded.args[0], "feeSensitivityPipsSecondsPerTick"), false);
    assert.equal(decoded.args[1], transaction.deployment.salt);
    const referenceDeployer = parseAbi(["function deploy((address poolManager,address registrar,address oracleFactory,address core,address liquidityLocker,address token,address quoteCurrency,uint24 lpFeePips,int24 tickSpacing,uint160 sqrtPriceX96,uint24 hookFeePips,uint8 feeMode,uint8 protocolFeeDenominator,address treasury,bool externalLiquidityDisabled,bytes32 oracleConfigId,bytes32 marketCommitment,uint32 expectedPositionCount) parameters,bytes32 salt) returns (address hook)"]);
    const expected = client.economics(planned.plan.markets[0]);
    assert.equal(transaction.data, encodeFunctionData({ abi: referenceDeployer, functionName: "deploy", args: [expected.parameters, transaction.deployment.salt] }),
      "V1 deploy calldata uses the independently declared historical constructor selector and tuple");
    assert.equal(client.captured.some((row) => row.functionName === "minimumHookFeePips" || row.functionName === "feeSensitivityPipsSecondsPerTick"), false);
    client.state.changedConstructor = true;
    await assert.rejects(readPoolBoundHookDeployment(options), { code: "HOOK_DEPLOYMENT_CHANGED" });
  }
});

test("combined preparation reads every unchanged draft constructor before mining and shares the sole final snapshot with admission", async () => {
  for (const batching of [false, true]) {
    const client = await boundPlanningClient(batching);
    const originalHash = hashLaunchPlan(client.plan);
    const progress = [];
    const planned = await prepareAndPlanLifecycleLaunch({ client, account: client.plan.creator, plan: client.plan, mode: "staged",
      onProgress: (event) => {
        const initialMetadata = client.captured.filter((row) => row.functionName === "hookDeploymentMetadata" && row.params[1] === "0x2a");
        assert.equal(initialMetadata.length, 2, "Every initial constructor is observed before any salt mutates");
        progress.push(event);
      } });
    assert.equal(hashLaunchPlan(client.plan), originalHash, "The caller's draft is never mutated");
    assert.notEqual(planned.planHash, originalHash);
    assert.equal(planned.progress.blockNumber, 43n);
    assert.equal(planned.simulation.blockNumber, 43n);
    assert.equal(client.state.latestReads, 2, "No immediate third admission snapshot is acquired");
    assert.equal(planned.hookDeployments.length, 2);
    assert.deepEqual(progress.filter((event) => event.attempts === 0n).map((event) => event.marketIndex), [0, 1]);
    assert.equal(planned.simulation.admitted, false, "A smart account is not converted to successful execution evidence");
    assert.ok(planned.simulation.reason);
    assert.ok(batching ? client.state.peak > 1 && client.state.peak <= 8 : client.state.peak === 1);
    const predictions = client.captured.filter((row) => row.functionName === "predictToken");
    assert.equal(predictions.length, 2, "One complete-plan prediction per initial/final snapshot");
    const firstPrediction = decodeFunctionData({ abi: launchLifecycleAbi, data: predictions[0].params[0].data });
    assert.equal(hashLaunchPlan(firstPrediction.args[0]), originalHash);
    for (const deployment of planned.hookDeployments) {
      const expected = client.economics(planned.plan.markets[deployment.marketIndex]);
      assert.equal(deployment.predictedHook.toLowerCase(), expected.predictedHook);
      assert.equal(deployment.initCodeHash, expected.initCodeHash);
      assert.equal(BigInt(deployment.predictedHook) & 0x3fffn, 0x1afcn);
    }
    for (const tag of ["0x2a", "0x2b"]) {
      for (const target of [CORE, client.source.graph.manager, client.source.graph.oracleFactory, client.source.graph.locker,
        client.source.graph.collectorFactory, client.source.graph.collectorDeployer, client.source.graph.hookDeployer,
        client.source.graph.codeChunk0, client.source.graph.codeChunk1]) {
        assert.equal(client.captured.filter((row) => row.method === "eth_getCode" && row.params[0].toLowerCase() === target && row.params[1] === tag).length, 1,
          `Exactly one certified graph observation for ${target} at ${tag}`);
      }
      assert.equal(client.captured.filter((row) => row.functionName === "oracleConfigs" && row.params[1] === tag).length, 1);
      assert.equal(client.captured.filter((row) => row.functionName === "hookDeploymentMetadata" && row.params[1] === tag).length, 2);
    }
    assert.ok(client.captured.some((row) => row.method === "eth_getBlockByNumber" && row.params[0] === "0x2b"), "Final canonical guard remains live");
    client.state.fixedHead = 43n;
    const before = client.captured.length;
    const later = await planLaunch({ client, account: planned.account, plan: planned.plan, mode: "staged" });
    assert.equal(later.planHash, planned.planHash);
    assert.ok(client.captured.slice(before).some((row) => row.method === "eth_getCode" && row.params[0].toLowerCase() === client.source.graph.codeChunk0 && row.params[1] === "0x2b"),
      "Even identical block/source data refetches in a later independent invocation");
  }
});

test("post-mining factory/token/profile/oracle/chunk/constructor/CREATE2 changes cannot inherit draft authority", async () => {
  const cases = [
    ["factory", ["TOKEN_FACTORY_BINDING"], (client) => { client.state.factoryCode = "0x"; }],
    ["token", ["HOOK_DEPLOYMENT_CHANGED"], (client) => { client.state.changedToken = true; }],
    ["eligibility", ["PROFILE_TERMS_MISMATCH"], (client) => { client.source.state.values[`${REGISTRY}:developerTerms`] = [ADAPTER, client.source.envelope.beneficiary, 500, client.source.envelope.termsDigest, false]; }],
    ["oracle", ["INVALID_ORACLE_CONFIG"], (client) => { client.state.invalidOracle = true; }],
    ["chunk", ["PROFILE_DEPENDENCY"], (client) => { client.source.state.codes[client.source.graph.codeChunk1] = "0x006000"; }],
    ["constructor", ["HOOK_DEPLOYMENT_CHANGED"], (client) => { client.state.changedConstructor = true; }],
    ...["minimumHookFeePips", "feeSensitivityPipsSecondsPerTick"].flatMap((field) => [
      [`constructor ${field}`, ["HOOK_DEPLOYMENT_CHANGED"], (client) => { client.state.changedFeeParameter = field; }],
      [`immutable ${field}`, ["HOOK_DEPLOYMENT_CHANGED"], (client) => { client.state.existingHooks = true; client.state.changedFeeGetter = field; }],
    ]),
    ["initcode", ["HOOK_DEPLOYMENT_CHANGED"], (client) => { client.state.changedInitHash = true; }],
    ["prediction", ["HOOK_DEPLOYMENT_CHANGED"], (client) => { client.state.changedPrediction = true; }],
    ["reorg", ["STATE_REORGED"], (client) => { client.source.state.reorg = true; }],
    ["chain", ["CHAIN_MISMATCH", "UNCERTIFIED_TOPOLOGY"], (client) => { client.source.state.chainDrift = true; }],
    ["existing hook provenance", ["HOOK_DEPLOYMENT_CHANGED"], (client) => { client.state.existingHooks = true; client.state.badProvenance = true; }],
  ];
  for (const [label, codes, change] of cases) {
    const client = await boundPlanningClient();
    client.state.afterFinalSnapshot = () => change(client);
    await assert.rejects(prepareAndPlanLifecycleLaunch({ client, account: client.plan.creator, plan: client.plan, mode: "staged" }),
      (error) => codes.includes(error.code), `${label} must refuse at its exact lifecycle proof boundary`);
    assert.equal(client.captured.some((row) => row.method === "eth_simulateV1"), false, `${label} cannot reach economic simulation`);
  }
});

test("combined preparation retains existing-hook immutable provenance and rejects mutation or cancellation at async boundaries", async () => {
  const existing = await boundPlanningClient();
  existing.state.existingHooks = true;
  const planned = await prepareAndPlanLifecycleLaunch({ client: existing, account: existing.plan.creator, plan: existing.plan, mode: "staged" });
  assert.equal(planned.hookDeployments.length, 2);
  assert.equal(existing.captured.filter((row) => row.functionName === "deployedCodeHash").length, 4, "Both draft and finalized existing hooks require provenance");
  for (const boundary of ["metadata", "mining", "observer-mutation", "admission"]) {
    const client = await boundPlanningClient();
    const stop = new AbortController();
    const options = { client, account: client.plan.creator, plan: client.plan, mode: "staged", signal: stop.signal };
    if (boundary === "metadata") client.state.onCall = (_row, call) => {
      if (call.functionName === "hookDeploymentMetadata") client.plan.deadline += 1n;
    };
    if (boundary === "mining") options.onProgress = () => stop.abort();
    if (boundary === "observer-mutation") options.onProgress = (event) => { if (event.attempts === 0n) client.plan.nonce += 1n; };
    if (boundary === "admission") client.state.onGasPrice = () => stop.abort();
    await assert.rejects(prepareAndPlanLifecycleLaunch(options), boundary === "metadata" || boundary === "observer-mutation" ? { code: "PLAN_MUTATED" } : { name: "AbortError" });
    assert.equal(client.captured.some((row) => row.method === "eth_simulateV1"), false, "Obsolete input cannot become economic execution authority");
    await nextTurn();
  }
});

test("independent initial bound metadata overlaps a pending factory binding but cannot authorize without it", async () => {
  const source = await boundPlanningClient(false);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const client = { supportsReadBatching: true, async request(args) {
    if (args.method === "eth_call" && args.params[0].to.toLowerCase() === CORE &&
      decodeFunctionData({ abi: launchLifecycleAbi, data: args.params[0].data }).functionName === "tokenFactory") await gate;
    return source.request(args);
  } };
  const pending = prepareAndPlanLifecycleLaunch({ client, account: source.plan.creator, plan: source.plan, mode: "staged" });
  const result = pending.then((planned) => ({ planned }), (error) => ({ error }));
  await nextTurn();
  const metadataBeforeFactory = source.captured.filter((row) => row.functionName === "hookDeploymentMetadata").length;
  source.state.factoryCode = "0x";
  release();
  const settled = await result;
  assert.equal(metadataBeforeFactory, 2, "Independently certified constructors do not wait for the factory branch");
  assert.equal(settled.error?.code, "TOKEN_FACTORY_BINDING", "Completed metadata is not authority without the real factory binding");
});

test("combined mode/account/cancellation guards refuse before any source observation", async () => {
  const client = await boundPlanningClient();
  const stop = new AbortController();
  stop.abort();
  for (const [overrides, error] of [
    [{ mode: "automatic" }, { code: "EXPLICIT_MODE_REQUIRED" }],
    [{ account: CORE }, { code: "ACCOUNT_MISMATCH" }],
    [{ signal: stop.signal }, { name: "AbortError" }],
  ]) await assert.rejects(prepareAndPlanLifecycleLaunch({ client, plan: client.plan, account: client.plan.creator, mode: "staged", ...overrides }), error);
  assert.equal(client.captured.length, 0);
});

test("bound constructor results isolate public mutation, finalized salt and each market within one owner", async () => {
  const source = await boundPlanningClient(false);
  await withLifecycleReadClient(source, async (client) => {
    const options = { client, plan: source.plan, marketIndex: 0 };
    const [first, joined] = await Promise.all([
      readPoolBoundHookDeployment(options, block), readPoolBoundHookDeployment(options, block),
    ]);
    assert.deepEqual(first, joined);
    assert.notEqual(first, joined, "Public deployment DTOs never alias cached private authority");
    const expected = structuredClone(first);
    first.deployer = address(0xbeef);
    first.salt = hash(999);
    first.initCodeHash = zeroHash;
    assert.deepEqual(await readPoolBoundHookDeployment(options, block), expected);
    const market = source.plan.markets[0];
    const config = decodePoolBoundV4LifecycleMarketConfig(market.config);
    const saltedMarket = { ...market, config: encodePoolBoundV4LifecycleMarketConfig({ ...config, hookSalt: hash(1) }) };
    const saltedPlan = { ...source.plan, markets: [saltedMarket, source.plan.markets[1]] };
    const salted = await readPoolBoundHookDeployment({ ...options, plan: saltedPlan }, block);
    assert.equal(salted.salt, hash(1));
    assert.equal(salted.initCodeHash, expected.initCodeHash, "Salt changes prediction, not constructor economics");
    assert.equal(salted.predictedHook.toLowerCase(), source.economics(saltedMarket).predictedHook);
    assert.notEqual(salted.predictedHook, expected.predictedHook);
    const second = await readPoolBoundHookDeployment({ ...options, marketIndex: 1 }, block);
    assert.equal(second.initCodeHash, source.economics(source.plan.markets[1]).initCodeHash);
    assert.notEqual(second.initCodeHash, expected.initCodeHash);
    source.state.fixedHead = block.number;
    const mined = await minePoolBoundHookSalt(expected);
    const deployedPlan = { ...source.plan, markets: [
      { ...market, config: encodePoolBoundV4LifecycleMarketConfig({ ...config, hookSalt: mined.salt }) }, source.plan.markets[1],
    ] };
    const transaction = await buildPoolBoundHookDeploymentTransaction({ ...options, plan: deployedPlan });
    const decoded = decodeFunctionData({ abi: poolHookDeployerConfigV6Abi, data: transaction.data });
    assert.equal(decoded.functionName, "deploy");
    assert.equal(decoded.args[1], transaction.deployment.salt);
    assert.equal(decoded.args[0].minimumHookFeePips, config.minimumHookFeePips);
    assert.equal(decoded.args[0].feeSensitivityPipsSecondsPerTick, config.feeSensitivityPipsSecondsPerTick);
    transaction.deployment.salt = zeroHash;
    const repeated = await buildPoolBoundHookDeploymentTransaction({ ...options, plan: deployedPlan });
    assert.equal(repeated.data, transaction.data);
    assert.notEqual(repeated.deployment.salt, transaction.deployment.salt);
  });
});

test("cached constructors distinguish all market economics and do not admit changed profile terms", async () => {
  const source = await boundPlanningClient(false);
  const market = source.plan.markets[0];
  const config = decodePoolBoundV4LifecycleMarketConfig(market.config);
  const configs = [
    ...["lpFeePips", "tickSpacing", "hookFeePips", "minimumHookFeePips", "feeSensitivityPipsSecondsPerTick", "developerFeeBps"].map((field) => ({ ...config, [field]: config[field] + 1 })),
    { ...config, sqrtPriceX96: config.sqrtPriceX96 + 1n }, { ...config, feeMode: 1 - config.feeMode },
    { ...config, externalLiquidityDisabled: !config.externalLiquidityDisabled }, { ...config, oracleConfigId: hash(56) },
    ...["tickLower", "tickUpper", "liquidity", "salt", "maxTokenAmount"].map((field) => ({
      ...config, positions: config.positions.map((position, index) => index === 0 ? { ...position,
        [field]: field === "salt" ? hash(999) : position[field] + (typeof position[field] === "bigint" ? 1n : 1) } : position),
    })),
    { ...config, positions: [...config.positions, { ...config.positions[0], salt: hash(999) }] },
  ];
  const markets = [
    ...configs.map((config) => ({ ...market, config: encodePoolBoundV4LifecycleMarketConfig(config) })),
    { ...market, tokenBudget: market.tokenBudget + 1n }, { ...market, quoteAsset: address(0x40) },
  ];
  await withLifecycleReadClient(source, async (client) => {
    const options = { client, plan: source.plan, marketIndex: 0 };
    const original = await readPoolBoundHookDeployment(options, block);
    for (const changed of markets) {
      const plan = { ...source.plan, markets: [changed, source.plan.markets[1]] };
      const deployment = await readPoolBoundHookDeployment({ ...options, plan }, block);
      const expected = source.economics(changed);
      assert.equal(deployment.initCodeHash, expected.initCodeHash);
      assert.equal(deployment.predictedHook.toLowerCase(), expected.predictedHook);
      assert.notEqual(deployment.initCodeHash, original.initCodeHash);
    }
    for (const [change, code] of [
      [{ profileId: hash(999) }, "PROFILE_TERMS_MISMATCH"],
      [{ termsDigest: hash(999) }, "PROFILE_TERMS_MISMATCH"],
      [{ developerBeneficiary: address(0xbeef) }, "PROFILE_TERMS_MISMATCH"],
      [{ developerFeeBps: 501 }, "DEVELOPER_FEE_CEILING"],
      [{ treasury: address(0xbeef) }, "PROFILE_BOUNDS_MISMATCH"],
      [{ protocolFeeDenominator: 7 }, "PROFILE_BOUNDS_MISMATCH"],
    ]) {
      const changed = { ...market, config: encodePoolBoundV4LifecycleMarketConfig({ ...config, ...change }) };
      await assert.rejects(readPoolBoundHookDeployment({ ...options,
        plan: { ...source.plan, markets: [changed, source.plan.markets[1]] } }, block), { code });
    }
    source.state.changedConstructor = true;
    for (const pin of [{ ...block, hash: hash(999) }, { ...block, number: 43n }]) {
      await assert.rejects(readPoolBoundHookDeployment(options, pin), { code: "HOOK_DEPLOYMENT_CHANGED" });
    }
  });
});

test("constructor proof identity binds every full-plan domain and economic field, not a market-only digest", async () => {
  const source = await boundPlanningClient(false);
  const plan = source.plan;
  const changes = [
    ...["name", "symbol", "metadataURI"].map((field) => ({ ...plan, token: { ...plan.token, [field]: `${plan.token[field]}2` } })),
    ...["supply", "nftUnit"].map((field) => ({ ...plan, token: { ...plan.token, [field]: plan.token[field] + 1n } })),
    { ...plan, token: { ...plan.token, salt: hash(999) } },
    { ...plan, token: { ...plan.token, kind: 1 - plan.token.kind } },
    { ...plan, token: { ...plan.token, rewardMode: 1 } },
    { ...plan, token: { ...plan.token, inventoryRecipient: address(0xbeef) } },
    { ...plan, token: { ...plan.token, burnOnCancel: !plan.token.burnOnCancel } },
    { ...plan, creator: address(0xbeef) }, { ...plan, nonce: plan.nonce + 1n }, { ...plan, deadline: plan.deadline + 1n },
    { ...plan, executorFeeBps: plan.executorFeeBps + 1 },
    { ...plan, funding: [{ asset: address(0x20), amount: 1n, kind: 0, inputAsset: address(0x20), inputAmount: 1n, target: zeroAddress, data: "0x" }] },
    { ...plan, buys: [{ marketIndex: 0, quoteAmountIn: 1n, minTokenOut: 1n, recipient: plan.creator, sqrtPriceLimitX96: 0n }] },
    { ...plan, feeAssets: plan.feeAssets.map((policy, index) => index === 0 ? { ...policy, ownerBps: 9999, rewardsBps: 1 } : policy) },
    { ...plan, markets: [...plan.markets].reverse() },
    { ...plan, markets: plan.markets.map((market, index) => index === 1 ? { ...market, tokenBudget: market.tokenBudget + 1n } : market) },
  ];
  await withLifecycleReadClient(source, async (client) => {
    await readPoolBoundHookDeployment({ client, plan, marketIndex: 0 }, block);
    // Prediction is complete-plan-sensitive even when the selected market and
    // its salt-normalized economic digest are unchanged. A previous constructor
    // result must not hide this newly observed mismatch.
    source.state.changedToken = true;
    for (const changed of changes) await assert.rejects(
      readPoolBoundHookDeployment({ client, plan: changed, marketIndex: 0 }, block),
      { code: "HOOK_DEPLOYMENT_CHANGED" },
    );
    assert.equal((await readPoolBoundHookDeployment({ client, plan, marketIndex: 0 }, block)).salt, zeroHash,
      "The original immutable pin/full-plan observation remains its own identity");
  });
});

test("constructor misses evict rejected or mutated proofs and hits retain fresh chain guards", async () => {
  const source = await boundPlanningClient(false);
  await withLifecycleReadClient(source, async (client) => {
    const options = { client, plan: source.plan, marketIndex: 0 };
    const failure = new Error("One constructor metadata read failed");
    source.state.onCall = (_row, call) => { if (call.functionName === "hookDeploymentMetadata") throw failure; };
    await assert.rejects(readPoolBoundHookDeployment(options, block), (error) => error === failure);
    source.state.onCall = undefined;
    const recovered = await readPoolBoundHookDeployment(options, block);
    const before = source.captured.filter((row) => row.method === "eth_chainId").length;
    source.source.state.chainDrift = true;
    await assert.rejects(readPoolBoundHookDeployment(options, block), { code: "CHAIN_MISMATCH" });
    source.source.state.chainDrift = false;
    assert.deepEqual(await readPoolBoundHookDeployment(options, block), recovered);
    assert.equal(source.captured.filter((row) => row.method === "eth_chainId").length - before, 2,
      "Both refused and successful cached-constructor reads observe the current chain");
    const candidate = { ...source.plan, deadline: source.plan.deadline + 1n };
    source.state.onCall = (_row, call) => { if (call.functionName === "predictToken") candidate.deadline += 1n; };
    await assert.rejects(readPoolBoundHookDeployment({ ...options, plan: candidate }, block), { code: "PLAN_MUTATED" });
    source.state.onCall = undefined;
    candidate.deadline -= 1n;
    assert.deepEqual(await readPoolBoundHookDeployment({ ...options, plan: candidate }, block), recovered);
  });
});

test("a retained constructor hit still rejects its own caller's mutation during fresh chain observation", async () => {
  const source = await boundPlanningClient(false);
  const plan = { ...source.plan };
  let mutate = false;
  const transport = { async request(args) {
    if (args.method === "eth_chainId" && mutate) plan.deadline += 1n;
    return source.request(args);
  } };
  await withLifecycleReadClient(transport, async (client) => {
    const options = { client, plan, marketIndex: 0 };
    const expected = await readPoolBoundHookDeployment(options, block);
    mutate = true;
    await assert.rejects(readPoolBoundHookDeployment(options, block), { code: "PLAN_MUTATED" });
    mutate = false;
    plan.deadline -= 1n;
    assert.deepEqual(await readPoolBoundHookDeployment(options, block), expected);
  });
});

test("closed owners cannot expose retained constructor hits or concurrent certificate completions", async () => {
  const source = await boundPlanningClient(false);
  let obsoleteClient;
  await withLifecycleReadClient(source, async (client) => {
    obsoleteClient = client;
    await readPoolBoundHookDeployment({ client, plan: source.plan, marketIndex: 0 }, block);
  });
  await assert.rejects(readPoolBoundHookDeployment({ client: obsoleteClient, plan: source.plan, marketIndex: 0 }, block), { code: "READ_SCOPE_CLOSED" });
  const profileSource = boundProfileClient();
  let release, markPending;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { markPending = resolve; });
  const transport = { supportsReadBatching: true, async request(args) {
    if (args.method === "eth_getCode" && args.params[0].toLowerCase() === profileSource.graph.codeChunk0) {
      markPending();
      await gate;
    }
    return profileSource.request(args);
  } };
  let late;
  const failure = new Error("Another required branch refused the invocation");
  await assert.rejects(withLifecycleReadClient(transport, async (client) => {
    late = readLifecycleProfiles({ client, orchestrator: CORE, profileIds: [profileSource.id] }, block)
      .then((profiles) => ({ profiles }), (error) => ({ error }));
    await started;
    throw failure;
  }), (error) => error === failure);
  release();
  const completion = await late;
  if (completion.error !== undefined) assert.equal(completion.error.code, "READ_SCOPE_CLOSED");
  else {
    assert.equal(completion.profiles[0].admitted, false);
    assert.ok(completion.profiles[0].reason);
  }
  assert.equal((await readLifecycleProfiles({ client: profileSource, orchestrator: CORE, profileIds: [profileSource.id] }, block))[0].admitted, true);
});

