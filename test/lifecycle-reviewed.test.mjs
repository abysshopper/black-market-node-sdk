import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { encodeAbiParameters, keccak256, parseAbiParameters, stringToHex, toHex, zeroAddress, zeroHash } from "viem";
const sdkPath = process.env.SDK_SOURCE_TEST === "1" ? "../src/lifecycle/index.ts" : "../dist/lifecycle/index.js";
const { decodeV4LifecycleMarketConfig, encodeV4LifecycleMarketConfig, hashLifecycleProfile, hashLaunchBounds, validateReviewedV4LifecycleMarket, planLaunch, parseLaunchPlan } = await import(sdkPath);
const fixture = JSON.parse(await readFile(new URL("./fixtures/launch-lifecycle-v1.json", import.meta.url), "utf8"));
const original = decodeV4LifecycleMarketConfig(fixture.plan.markets[0].config);
const address = (n) => toHex(BigInt(n), { size: 20 });
const bounds = { maximumHookFeePips: 20000, maximumLpFeePips: 10000, minimumTickSpacing: 1, maximumTickSpacing: 200,
  maximumPositions: 32, maximumOracleCardinality: 4096, feeModeFlags: 3, externalLiquidityDisabled: true, oracleConfigId: original.oracleConfigId };
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
  registration: { adapterId: market.adapterId }, adapter: { implementation: address(1), configVersion: 4 },
  topology: { hookTopology: 1, configVersion: 4 }, admitted: true, venueKind: "uniswap-v4" };
const context = { market, config, profile, token: address(10) };

test("reviewed profile identity commits author consent and economic versions, not graph instance addresses", () => {
  const expected = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,bytes32,bytes32,bytes32,bytes32,uint8,uint32,uint32,address,uint16,uint64"), [
    keccak256(stringToHex("black-market.reviewed-launch-profile.v2")), envelope.artifactDigest, envelope.reviewManifestDigest,
    envelope.configBoundsDigest, envelope.termsDigest, envelope.topology, envelope.configVersion, envelope.economicVersion,
    envelope.beneficiary, envelope.maximumDeveloperFeeBps, envelope.capabilities,
  ]));
  assert.equal(profileId, expected);
  assert.equal(hashLifecycleProfile({ ...envelope, graph: { ...graph, manager: address(200) } }), expected);
  assert.notEqual(hashLifecycleProfile({ ...envelope, termsDigest: toHex(99n, { size: 32 }) }), expected);
  assert.notEqual(hashLifecycleProfile({ ...envelope, beneficiary: address(201) }), expected);
});

test("explicit developer rate obeys both ceilings and zero never removes stable frozen terms", () => {
  validateReviewedV4LifecycleMarket({ ...context, config: { ...config, developerFeeBps: 0 } });
  validateReviewedV4LifecycleMarket({ ...context, config: { ...config, developerFeeBps: 400 } });
  assert.throws(() => validateReviewedV4LifecycleMarket({ ...context, config: { ...config, developerFeeBps: 401 } }), { code: "DEVELOPER_FEE_CEILING" });
  assert.throws(() => validateReviewedV4LifecycleMarket({ ...context, config: { ...config, developerFeeBps: undefined } }), { code: "DEVELOPER_FEE_CEILING" });
  assert.throws(() => validateReviewedV4LifecycleMarket({ ...context, config: { ...config, developerFeeBps: 0, developerBeneficiary: zeroAddress } }), { code: "REVIEWED_TERMS_MISMATCH" });
  assert.throws(() => validateReviewedV4LifecycleMarket({ ...context, config: { ...config, termsDigest: zeroHash } }), { code: "REVIEWED_TERMS_MISMATCH" });
});

test("market cannot rebind profile, topology, treasury policy or out-of-mask fee modes", () => {
  assert.throws(() => validateReviewedV4LifecycleMarket({ ...context, config: { ...config, profileId: zeroHash } }), { code: "REVIEWED_TERMS_MISMATCH" });
  assert.throws(() => validateReviewedV4LifecycleMarket({ ...context, profile: { ...profile, topology: { hookTopology: 2, configVersion: 5 } } }), { code: "REVIEWED_TERMS_MISMATCH" });
  assert.throws(() => validateReviewedV4LifecycleMarket({ ...context, config: { ...config, treasury: address(200) } }), { code: "REVIEWED_BOUNDS_MISMATCH" });
  assert.throws(() => validateReviewedV4LifecycleMarket({ ...context, config: { ...config, feeMode: 32 } }), { code: "REVIEWED_BOUNDS_MISMATCH" });
  assert.throws(() => validateReviewedV4LifecycleMarket({ ...context, config: { ...config, lpFeePips: 10001 } }), { code: "REVIEWED_BOUNDS_MISMATCH" });
});

test("planner refuses retired V4 wire versions before any RPC or simulation", async () => {
  const rpc = { request() { throw new Error("Retired economics must never reach a provider"); } };
  for (const configVersion of [2, 3]) {
    const plan = parseLaunchPlan(JSON.stringify(fixture.plan));
    plan.markets[0].configVersion = configVersion;
    await assert.rejects(planLaunch({ client: rpc, plan, account: plan.creator, mode: "atomic" }), { code: "UNSUPPORTED_CONFIG_VERSION" });
  }
});
