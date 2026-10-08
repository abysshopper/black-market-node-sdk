import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, keccak256, parseAbiParameters, stringToHex, toHex, zeroAddress, zeroHash } from "viem";
const sdkPath = process.env.SDK_SOURCE_TEST === "1" ? "../src/lifecycle/index.ts" : "../dist/lifecycle/index.js";
const { decodeV4LifecycleMarketConfig, encodeV4LifecycleMarketConfig, encodePoolBoundV4LifecycleMarketConfig, decodeLaunchBounds, encodeLaunchBounds, hashLifecycleProfile, hashLaunchBounds, validateV4LifecycleMarket, validateV4LifecycleOracle, lifecycleOracleFactoryAbi, planLaunch, parseLaunchPlan, poolBoundV4LifecycleConfigSchema, V4_LIFECYCLE_CONFIG_SCHEMA } = await import(sdkPath);
const fixture = JSON.parse(await readFile(new URL("./fixtures/launch-lifecycle-v1.json", import.meta.url), "utf8"));
const original = decodeV4LifecycleMarketConfig(fixture.plan.markets[0].config);
const address = (n) => toHex(BigInt(n), { size: 20 });
const bounds = { minimumTickSpacing: 1, maximumTickSpacing: 200,
  maximumPositions: 32, maximumOracleCardinality: 4096, feeModeFlags: 3 };
const graph = { manager: address(100), hookRoot: address(101), oracleFactory: address(102), locker: address(103), collectorFactory: address(104),
  collectorDeployer: address(105), hookDeployer: address(106), coreCodeHash: toHex(100n, { size: 32 }), managerCodeHash: toHex(101n, { size: 32 }),
  hookRuntimeCodeHash: toHex(102n, { size: 32 }), oracleFactoryCodeHash: toHex(103n, { size: 32 }), lockerCodeHash: toHex(104n, { size: 32 }),
  collectorFactoryCodeHash: toHex(105n, { size: 32 }), collectorDeployerCodeHash: toHex(106n, { size: 32 }), hookDeployerCodeHash: toHex(107n, { size: 32 }),
  hookCreationCodeHash: toHex(108n, { size: 32 }), codeChunk0: address(107), codeChunk0Hash: toHex(109n, { size: 32 }),
  codeChunk1: zeroAddress, codeChunk1Hash: zeroHash, sharedHookSalt: zeroHash };
const envelope = { artifactDigest: toHex(1n, { size: 32 }), reviewManifestDigest: toHex(2n, { size: 32 }), configBoundsDigest: hashLaunchBounds(bounds),
  termsDigest: original.termsDigest, topology: 1, configVersion: 4, economicVersion: 3, capabilities: 123n, flags: 0n,
  callbackFlags: 0x1afc, callbackMask: 0x3fff, protocolTreasury: original.treasury, protocolFeeDenominator: original.protocolFeeDenominator,
  beneficiary: original.developerBeneficiary, maximumDeveloperFeeBps: 500, bounds, graph };
const profileId = hashLifecycleProfile(envelope);
const config = { ...original, profileId };
const market = { ...fixture.plan.markets[0], tokenBudget: BigInt(fixture.plan.markets[0].tokenBudget), profileId, config: encodeV4LifecycleMarketConfig(config) };
const profile = { id: profileId, envelope, developerTerms: { adapter: address(1), beneficiary: config.developerBeneficiary,
  maximumDeveloperFeeBps: 500, termsDigest: config.termsDigest, enabled: true }, protocolMaximumDeveloperFeeBps: 400,
  registration: { adapterId: market.adapterId, configSchema: V4_LIFECYCLE_CONFIG_SCHEMA }, adapter: { implementation: address(1), configVersion: 4 },
  topology: { hookTopology: 1, configVersion: 4 }, admitted: true, venueKind: "uniswap-v4" };
const context = { market, config, profile, token: address(10) };

test("launch bounds encode exactly the five-field admitted tuple and digest", () => {
  const expected = encodeAbiParameters(parseAbiParameters("(int24,int24,uint16,uint16,uint8)"), [[
    bounds.minimumTickSpacing, bounds.maximumTickSpacing, bounds.maximumPositions,
    bounds.maximumOracleCardinality, bounds.feeModeFlags,
  ]]);
  assert.equal(encodeLaunchBounds(bounds), expected);
  assert.deepEqual(decodeLaunchBounds(expected), bounds);
  assert.equal(hashLaunchBounds(bounds), keccak256(expected));
});

const oracleId = (move, cardinality = 4096) => keccak256(encodeAbiParameters(parseAbiParameters("uint24,uint16"), [move, cardinality]));
const oracleBlock = { number: 42n, hash: toHex(42n, { size: 32 }), timestamp: 100n, gasLimit: 30000000n };

function oracleClient(configurations) {
  return { async request({ method, params }) {
    assert.equal(method, "eth_call", "Selected oracle validation must not force profile discovery or unsupported reads");
    assert.equal(params[0].to.toLowerCase(), graph.oracleFactory.toLowerCase());
    assert.equal(params[1], "0x2a", "Selected oracle reads must use the same pinned block");
    const call = decodeFunctionData({ abi: lifecycleOracleFactoryAbi, data: params[0].data });
    assert.equal(call.functionName, "oracleConfigs");
    return encodeFunctionResult({ abi: lifecycleOracleFactoryAbi, functionName: "oracleConfigs",
      result: configurations.get(call.args[0].toLowerCase()) ?? [0, 0] });
  } };
}

test("one admitted profile accepts P1/P2/P3 and either external-liquidity choice independently of fees", async () => {
  const client = oracleClient(new Map([1, 6, 17].map((move) => [oracleId(move), [move, 4096]])));
  for (const version of [4, 5, 6]) {
    const topology = { hookTopology: version === 4 ? 1 : 2, configVersion: version };
    const selectedEnvelope = { ...envelope, topology: topology.hookTopology, configVersion: version };
    const id = hashLifecycleProfile(selectedEnvelope);
    const selectedProfile = { ...profile, id, envelope: selectedEnvelope, topology, adapter: { ...profile.adapter, configVersion: version },
      registration: { ...profile.registration, configSchema: version === 4 ? V4_LIFECYCLE_CONFIG_SCHEMA : poolBoundV4LifecycleConfigSchema(version) } };
    const encode = version === 4 ? encodeV4LifecycleMarketConfig : encodePoolBoundV4LifecycleMarketConfig;
    for (const move of [1, 6, 17]) for (const externalLiquidityDisabled of [false, true]) for (const feeMode of [0, 1]) {
      const selected = { ...config, version, profileId: id, oracleConfigId: oracleId(move), externalLiquidityDisabled,
        feeMode, lpFeePips: 150000, hookFeePips: 200000,
        ...(version !== 4 ? { hookSalt: zeroHash } : {}),
        ...(version === 6 ? { minimumHookFeePips: 1234, feeSensitivityPipsSecondsPerTick: 0xffffffff } : {}) };
      validateV4LifecycleMarket({ config: selected, profile: selectedProfile, token: context.token,
        market: { ...market, profileId: id, configVersion: version, config: encode(selected) } });
      await validateV4LifecycleOracle({ client, envelope: selectedEnvelope, oracleConfigId: selected.oracleConfigId, block: oracleBlock });
    }
  }
});

test("selected oracle must be nonzero, registered and within movement/cardinality bounds", async () => {
  assert.throws(() => validateV4LifecycleMarket({ ...context, config: { ...config, oracleConfigId: zeroHash } }), { code: "INVALID_ORACLE_CONFIG" });
  for (const [move, cardinality] of [[0, 0], [887273, 4096], [1, 1], [1, 4097]]) {
    const id = oracleId(move, cardinality);
    const client = oracleClient(new Map([[id, [move, cardinality]]]));
    await assert.rejects(validateV4LifecycleOracle({ client, envelope, oracleConfigId: id, block: oracleBlock }), { code: "INVALID_ORACLE_CONFIG" });
  }
  await assert.rejects(validateV4LifecycleOracle({ client: oracleClient(new Map()), envelope, oracleConfigId: oracleId(99), block: oracleBlock }), { code: "INVALID_ORACLE_CONFIG" });
  await assert.rejects(validateV4LifecycleOracle({ client: { request() { throw new Error("Zero ID must fail before RPC"); } }, envelope, oracleConfigId: zeroHash, block: oracleBlock }), { code: "INVALID_ORACLE_CONFIG" });
  const id = oracleId(1);
  await assert.rejects(validateV4LifecycleOracle({ client: oracleClient(new Map([[id, [1, 4096]]])), envelope: { ...envelope, bounds: { ...bounds, maximumOracleCardinality: 2048 } }, oracleConfigId: id, block: oracleBlock }), { code: "INVALID_ORACLE_CONFIG" });
});

test("creator-selected LP and hook rates are independent, including 15 percent with zero author royalty", () => {
  for (const version of [4, 5, 6]) {
    const hookTopology = version === 4 ? 1 : 2;
    const admittedEnvelope = { ...envelope, topology: hookTopology, configVersion: version, maximumDeveloperFeeBps: 0 };
    const id = hashLifecycleProfile(admittedEnvelope);
    const admittedProfile = { ...profile, id, envelope: admittedEnvelope,
      developerTerms: { ...profile.developerTerms, maximumDeveloperFeeBps: 0 },
      adapter: { ...profile.adapter, configVersion: version }, topology: { hookTopology, configVersion: version },
      registration: { ...profile.registration, configSchema: version === 4 ? V4_LIFECYCLE_CONFIG_SCHEMA : poolBoundV4LifecycleConfigSchema(version) } };
    const admittedConfig = { ...config, version, profileId: id, developerFeeBps: 0,
      ...(version !== 4 ? { hookSalt: zeroHash } : {}),
      ...(version === 6 ? { minimumHookFeePips: 0, feeSensitivityPipsSecondsPerTick: 0 } : {}) };
    const encode = version === 4 ? encodeV4LifecycleMarketConfig : encodePoolBoundV4LifecycleMarketConfig;
    for (const lpFeePips of [0, 150000, 200000, 999999]) {
      for (const hookFeePips of (version === 6 ? [0, 150000, 200000, 999999, 1000000] : [0, 150000, 200000, 999999])) {
        const selected = { ...admittedConfig, lpFeePips, hookFeePips };
        validateV4LifecycleMarket({ token: context.token, config: selected, profile: admittedProfile,
          market: { ...market, profileId: id, configVersion: version, config: encode(selected) } });
      }
    }
    for (const fee of ["lpFeePips", "hookFeePips"]) {
      for (const rate of [-1, ...(version !== 6 || fee === "lpFeePips" ? [1000000] : [1000001]), 1500000, 1.5, NaN, true, undefined]) {
        assert.throws(() => validateV4LifecycleMarket({ token: context.token,
          config: { ...admittedConfig, [fee]: rate }, profile: admittedProfile,
          market: { ...market, profileId: id, configVersion: version } }), { code: version === 6 && fee === "hookFeePips" ? "INVALID_HOOK_FEES" : "PROFILE_BOUNDS_MISMATCH" });
      }
    }
    assert.throws(() => validateV4LifecycleMarket({ token: context.token,
      config: { ...admittedConfig, lpFeePips: 150000, hookFeePips: 150000, developerFeeBps: 1 }, profile: admittedProfile,
      market: { ...market, profileId: id, configVersion: version } }), { code: "DEVELOPER_FEE_CEILING" });
  }
});

test("profile identity commits author consent and economic versions, not graph instance addresses", () => {
  const expected = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,bytes32,bytes32,bytes32,bytes32,uint8,uint32,uint32,address,uint16,uint64"), [
    keccak256(stringToHex("black-market.launch-profile.v2")), envelope.artifactDigest, envelope.reviewManifestDigest,
    envelope.configBoundsDigest, envelope.termsDigest, envelope.topology, envelope.configVersion, envelope.economicVersion,
    envelope.beneficiary, envelope.maximumDeveloperFeeBps, envelope.capabilities,
  ]));
  assert.equal(profileId, expected);
  assert.equal(hashLifecycleProfile({ ...envelope, graph: { ...graph, manager: address(200) } }), expected);
  assert.notEqual(hashLifecycleProfile({ ...envelope, termsDigest: toHex(99n, { size: 32 }) }), expected);
  assert.notEqual(hashLifecycleProfile({ ...envelope, beneficiary: address(201) }), expected);
});

test("explicit developer rate obeys both ceilings and zero never removes stable frozen terms", () => {
  validateV4LifecycleMarket({ ...context, config: { ...config, developerFeeBps: 0 } });
  validateV4LifecycleMarket({ ...context, config: { ...config, developerFeeBps: 400 } });
  assert.throws(() => validateV4LifecycleMarket({ ...context, config: { ...config, developerFeeBps: 401 } }), { code: "DEVELOPER_FEE_CEILING" });
  assert.throws(() => validateV4LifecycleMarket({ ...context, config: { ...config, developerFeeBps: undefined } }), { code: "DEVELOPER_FEE_CEILING" });
  assert.throws(() => validateV4LifecycleMarket({ ...context, config: { ...config, developerFeeBps: 0, developerBeneficiary: zeroAddress } }), { code: "PROFILE_TERMS_MISMATCH" });
  assert.throws(() => validateV4LifecycleMarket({ ...context, config: { ...config, termsDigest: zeroHash } }), { code: "PROFILE_TERMS_MISMATCH" });
});

test("market cannot rebind profile, topology, treasury policy or out-of-mask fee modes", () => {
  assert.throws(() => validateV4LifecycleMarket({ ...context, config: { ...config, profileId: zeroHash } }), { code: "PROFILE_TERMS_MISMATCH" });
  assert.throws(() => validateV4LifecycleMarket({ ...context, profile: { ...profile, topology: { hookTopology: 2, configVersion: 6 } } }), { code: "PROFILE_TERMS_MISMATCH" });
  assert.throws(() => validateV4LifecycleMarket({ ...context, profile: { ...profile, registration: { ...profile.registration, configSchema: zeroHash } } }), { code: "PROFILE_TERMS_MISMATCH" });
  assert.throws(() => validateV4LifecycleMarket({ ...context, config: { ...config, treasury: address(200) } }), { code: "PROFILE_BOUNDS_MISMATCH" });
  assert.throws(() => validateV4LifecycleMarket({ ...context, config: { ...config, feeMode: 32 } }), { code: "PROFILE_BOUNDS_MISMATCH" });
});

test("planner refuses unsupported V4 config versions before any RPC or simulation", async () => {
  const rpc = { request() { throw new Error("Unsupported economics must never reach a provider"); } };
  for (const configVersion of [0, 2, 3, 7, 0xffffffff]) {
    const plan = parseLaunchPlan(JSON.stringify(fixture.plan));
    plan.markets[0].configVersion = configVersion;
    await assert.rejects(planLaunch({ client: rpc, plan, account: plan.creator, mode: "atomic" }), { code: "UNSUPPORTED_CONFIG_VERSION" });
  }
});
