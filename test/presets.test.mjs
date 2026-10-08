import assert from "node:assert/strict";
import test from "node:test";
import { keccak256 } from "viem";

const sdkPath = process.env.SDK_SOURCE_TEST === "1" ? "../src/lifecycle/index.ts" : "../dist/lifecycle/index.js";
const {
  KnownLifecycleHook, KnownLifecycleProfile, getKnownLifecycleDeployment,
  getKnownLifecycleProfile, listKnownLifecycleProfiles, hashLifecycleProfile,
  hashLaunchBounds, hashLaunchDependencies, encodeLaunchEnvelope,
  V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA_V5, V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA_V6,
} = await import(sdkPath);

const identity = { chainId: 4663n, orchestrator: "0x91560876033d568d25CDe98C78c33ff8FC43962c" };
const otherAddress = "0x00000000000000000000000000000000000000a1";
const otherHash = `0x${"a1".repeat(32)}`;
const upperHex = (value) => `0x${value.slice(2).toUpperCase()}`;
const select = (key) => getKnownLifecycleProfile({ ...identity, key });

function dependencies(deployment, preset, graph = preset.profile.envelope.graph) {
  return hashLaunchDependencies({ chainId: deployment.chainId, core: deployment.orchestrator,
    registry: deployment.registry, registrar: preset.boundHook.registrar, graph });
}

test("known metadata is scoped to exact chain, core and profile identity", () => {
  const deployment = getKnownLifecycleDeployment(identity);
  assert.equal(deployment.provenance.deploymentBlock, 82880546n);
  assert.equal(deployment.provenance.sourceCommit, "e174ce695c7010f50ca9211b07b9f178c990beac");
  assert.equal(getKnownLifecycleDeployment({ ...identity, orchestrator: "0xb75CBD17b9aecb7305B4DFcDa69595F783341c0E" }), undefined,
    "Historical October5 deployment is not relabeled as the current graph");
  const v4 = select(KnownLifecycleProfile.V4FixedFeePool);
  assert.equal(getKnownLifecycleDeployment({ chainId: 4663, orchestrator: identity.orchestrator.toLowerCase() }), deployment);
  assert.equal(getKnownLifecycleProfile({ chainId: 4663, orchestrator: upperHex(identity.orchestrator), profileId: upperHex(v4.profile.id) }), v4);
  for (const wrong of [
    { ...identity, chainId: 4664n },
    { ...identity, chainId: 1 },
    { ...identity, orchestrator: otherAddress },
  ]) {
    assert.equal(getKnownLifecycleDeployment(wrong), undefined);
    assert.equal(getKnownLifecycleProfile({ ...wrong, profileId: v4.profile.id }), undefined);
    assert.equal(getKnownLifecycleProfile({ ...wrong, key: KnownLifecycleProfile.V4FixedFeePool }), undefined);
    assert.deepEqual(listKnownLifecycleProfiles(wrong), []);
  }
  assert.equal(getKnownLifecycleProfile({ ...identity, profileId: otherHash }), undefined);
  assert.equal(getKnownLifecycleProfile({ ...identity, key: "unlisted-hook" }), undefined);
  assert.equal(getKnownLifecycleProfile({ ...identity, profileId: KnownLifecycleProfile.V4FixedFeePool }), undefined,
    "A convenient enum key is not a registered bytes32 profile identity");
});

test("enum-selected construction metadata distinguishes quote-oracle Abyss from pool-bound V4 without claiming admission", () => {
  const abyss = select(KnownLifecycleProfile.Abyss3);
  const v4 = select(KnownLifecycleProfile.V4FixedFeePool);
  assert.equal(abyss.profile.venueKind, "abyss");
  assert.equal(abyss.profile.topology.hookTopology, 0);
  assert.equal(abyss.boundHook, undefined);
  assert.equal(abyss.profile.envelope, undefined);
  assert.equal(v4.profile.venueKind, "uniswap-v4");
  assert.equal(v4.profile.topology.hookTopology, 2);
  assert.equal(v4.profile.topology.configVersion, 6);
  assert.notEqual(v4.profile.registration.configSchema, V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA_V5);
  assert.equal(v4.profile.registration.configSchema, V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA_V6);
  assert.equal(v4.supported, true, "Fresh config6/V2 has its own mined graph and constructor");
  assert.equal(v4.unavailableReason, undefined);
  assert.equal(abyss.supported, true);
  assert.equal(v4.boundHook.poolManager, v4.profile.registration.venue);
  assert.equal(v4.boundHook.deployer, v4.profile.topology.hookDeployer);
  assert.equal(v4.boundHook.registrar, v4.profile.adapter.implementation);
  assert.equal(v4.boundHook.oracleFactory, v4.profile.envelope.graph.oracleFactory);
  assert.equal(v4.boundHook.liquidityLocker, v4.profile.envelope.graph.locker);
  assert.equal(v4.profile.developerTerms.beneficiary, v4.profile.envelope.beneficiary);
  for (const preset of listKnownLifecycleProfiles(identity)) {
    assert.equal(Object.hasOwn(preset.profile, "admitted"), false);
    assert.equal(Object.hasOwn(preset.profile, "reason"), false);
    assert.equal(getKnownLifecycleProfile({ ...identity, profileId: preset.profile.id }), preset);
  }
});

test("consumer mutation cannot rewrite shared release construction or subsequent lookups", () => {
  const deployment = getKnownLifecycleDeployment(identity);
  const v4 = select(KnownLifecycleProfile.V4FixedFeePool);
  const before = structuredClone(deployment);
  const mutations = [
    () => { KnownLifecycleProfile.Abyss3 = KnownLifecycleProfile.V4FixedFeePool; },
    () => { KnownLifecycleHook.FixedFeePoolV1 = "unreviewed-hook"; },
    () => { deployment.orchestrator = otherAddress; },
    () => { deployment.provenance.deploymentBlock = 0n; },
    () => { deployment.profiles.reverse(); },
    () => { v4.key = KnownLifecycleProfile.Abyss3; },
    () => { v4.profile.id = otherHash; },
    () => { v4.profile.admitted = true; },
    () => { v4.profile.registration.adapterId = otherHash; },
    () => { v4.profile.adapter.implementation = otherAddress; },
    () => { v4.profile.topology.hookCreationCodeHash = otherHash; },
    () => { v4.profile.envelope.beneficiary = otherAddress; },
    () => { v4.profile.envelope.bounds.maximumPositions = 1; },
    () => { v4.profile.envelope.graph.manager = otherAddress; },
    () => { v4.profile.developerTerms.maximumDeveloperFeeBps = 2400; },
    () => { v4.boundHook.creationCode = "0x00"; },
    () => { select(KnownLifecycleProfile.Abyss3).profile.registration.venue = otherAddress; },
  ];
  for (const mutate of mutations) assert.throws(mutate, TypeError);
  assert.deepEqual(getKnownLifecycleDeployment(identity), before);
  assert.equal(getKnownLifecycleProfile({ ...identity, profileId: v4.profile.id }), v4);
});

test("reviewed bytecode, bounds, profile and deployment dependency commitments agree and detect tampering", () => {
  const deployment = getKnownLifecycleDeployment(identity);
  const v4 = select(KnownLifecycleProfile.V4FixedFeePool);
  const envelope = v4.profile.envelope;
  const creationHash = keccak256(v4.boundHook.creationCode);
  assert.equal(creationHash, "0x11c4c7b1f265ed708b7d53ab828c89d237ca821333daa808f1913986c6f8f1ab");
  assert.equal(creationHash, v4.profile.topology.hookCreationCodeHash);
  assert.equal(creationHash, envelope.graph.hookCreationCodeHash);
  assert.equal(creationHash, envelope.artifactDigest);
  assert.equal(hashLaunchBounds(envelope.bounds), envelope.configBoundsDigest);
  assert.equal(hashLifecycleProfile(envelope), v4.profile.id);
  assert.equal(dependencies(deployment, v4), v4.profile.registration.dependencyDigest);

  for (const changed of [
    { ...envelope, artifactDigest: otherHash },
    { ...envelope, configBoundsDigest: hashLaunchBounds({ ...envelope.bounds, maximumPositions: envelope.bounds.maximumPositions - 1 }) },
    { ...envelope, beneficiary: otherAddress },
    { ...envelope, configVersion: 4 },
  ]) assert.notEqual(hashLifecycleProfile(changed), v4.profile.id);
  const changedGraph = { ...envelope.graph, manager: otherAddress };
  assert.equal(hashLifecycleProfile({ ...envelope, graph: changedGraph }), v4.profile.id,
    "Profile identity excludes instance dependencies, which have their own deployment commitment");
  assert.notEqual(dependencies(deployment, v4, changedGraph), v4.profile.registration.dependencyDigest);
  assert.notEqual(dependencies({ ...deployment, chainId: deployment.chainId + 1n }, v4), v4.profile.registration.dependencyDigest);
  assert.notEqual(dependencies({ ...deployment, orchestrator: otherAddress }, v4), v4.profile.registration.dependencyDigest);
  assert.notEqual(keccak256(encodeLaunchEnvelope({ ...envelope, graph: changedGraph })), keccak256(encodeLaunchEnvelope(envelope)));

});
