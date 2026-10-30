import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { concatHex, decodeFunctionData, encodeAbiParameters, getAddress, keccak256, toHex, zeroHash } from 'viem';
import * as sdk from '../dist/lifecycle/index.js';
import { deriveKnownPoolBoundHookDeployment } from '../dist/lifecycle/calibration.js';
import { identity, keys, makeRaetoPlan, testToken } from './fixtures/raeto-plan.mjs';

const evidence = JSON.parse(await readFile(new URL('./fixtures/raeto-registry-readback.json', import.meta.url), 'utf8'));
const prefix = (config) => encodeAbiParameters([{ type: 'tuple', components: sdk.poolBoundV4LifecycleMarketComponentsV6 }], [config]);
const rawTail = (share) => encodeAbiParameters([{ type: 'uint256' }], [BigInt(share)]);
const upper = (value) => `0x${value.slice(2).toUpperCase()}`;

test('Raeto deployment constants expose the frozen deployed menu and checksummed quotes', () => {
  assert.deepEqual(sdk.RAETO_SHARE_BPS_OPTIONS, [500, 1000, 2500, 5000, 7500]);
  assert.ok(Object.isFrozen(sdk.RAETO_SHARE_BPS_OPTIONS));
  assert.ok(Object.isFrozen(sdk.RAETO_QUOTE_ASSETS));
  assert.deepEqual(sdk.RAETO_QUOTE_ASSETS.map((address) => getAddress(address)), [...sdk.RAETO_QUOTE_ASSETS]);
  assert.equal(getAddress(sdk.RAETO_PAYOUT_REGISTRY_ADDRESS), sdk.RAETO_PAYOUT_REGISTRY_ADDRESS);
  assert.equal(sdk.isRaetoProfile(zeroHash), false);
});
for (const shareBps of sdk.RAETO_SHARE_BPS_OPTIONS) test(`Raeto tail round-trips deployed share ${shareBps} in one ABI word`, () => {
  const config = { shareBps };
  sdk.validateRaetoLaunchConfig(config);
  assert.equal(sdk.encodeRaetoLaunchTail(config), rawTail(shareBps));
  assert.deepEqual(sdk.decodeRaetoLaunchTail(rawTail(shareBps)), config);
  assert.deepEqual(sdk.decodeRaetoLaunchTail(upper(rawTail(shareBps))), config);
});
for (const shareBps of [0, 499, 1234, 8000, 10000, -1, 65535, 0.5, NaN, Infinity, '500', undefined]) test(`Raeto rejects non-menu share ${shareBps}`, () => {
  assert.throws(() => sdk.validateRaetoLaunchConfig({ shareBps }), { code: 'INVALID_RAETO_CONFIG' });
  assert.throws(() => sdk.encodeRaetoLaunchTail({ shareBps }), { code: 'INVALID_RAETO_CONFIG' });
  if (Number.isInteger(shareBps) && shareBps >= 0) assert.throws(() => sdk.decodeRaetoLaunchTail(rawTail(shareBps)), { code: 'INVALID_RAETO_CONFIG' });
});
test('Raeto decoder rejects truncated, extra, nonhex and noncanonical uint16 words', () => {
  const tail = sdk.encodeRaetoLaunchTail({ shareBps: 500 });
  for (const encoded of ['0x', tail.slice(0, -2), concatHex([tail, '0x00']), concatHex([tail, zeroHash]), rawTail(65536), rawTail((1n << 255n) + 500n), `0x${'g'.repeat(64)}`]) {
    assert.throws(() => sdk.decodeRaetoLaunchTail(encoded), { code: 'INVALID_RAETO_CONFIG' });
  }
});
for (const key of keys) {
  test(`${key}: presets reproduce preserved admission, dependency graph and ordinary hook bytes`, () => {
    const { preset } = makeRaetoPlan(key);
    const { profile, boundHook } = preset;
    const snapshot = evidence.profiles.find(({ profileId }) => profileId === profile.id);
    const ordinary = sdk.getKnownLifecycleProfile({ ...identity, key: key === keys[0] ? sdk.KnownLifecycleProfile.V4FixedFeePool : sdk.KnownLifecycleProfile.V4DynamicFeePool });
    assert.equal(preset.supported, true);
    assert.equal(sdk.hashLifecycleProfile(profile.envelope), profile.id);
    assert.equal(sdk.hashLaunchBounds(profile.envelope.bounds), profile.envelope.configBoundsDigest);
    assert.equal(sdk.encodeLaunchEnvelope(profile.envelope), snapshot.admission.envelopeBytes);
    assert.equal(boundHook.creationCode, ordinary.boundHook.creationCode);
    assert.equal(keccak256(boundHook.creationCode), profile.topology.hookCreationCodeHash);
    assert.equal(concatHex(snapshot.chunks.map(({ runtime }) => `0x${runtime.slice(4)}`)), boundHook.creationCode);
    for (const [name, value, components] of [
      ['profile', profile.registration, sdk.profileRegistrationV1Components], ['adapter', profile.adapter, sdk.adapterRegistrationV1Components],
      ['profileTopology', profile.topology, sdk.profileTopologyV1Components],
    ]) assert.equal(encodeAbiParameters([{ type: 'tuple', components }], [value]), snapshot.raw[name]);
    assert.equal(keccak256(concatHex([snapshot.raw.profile, snapshot.raw.profileEnvelope])), snapshot.admission.envelopeHash);
    assert.equal(keccak256(snapshot.admission.admissionBytes), snapshot.admission.payloadHash);
    assert.equal(sdk.hashLaunchDependencies({ chainId: identity.chainId, core: identity.orchestrator, registry: evidence.registry, registrar: boundHook.registrar, graph: profile.envelope.graph }), profile.registration.dependencyDigest);
    assert.equal(profile.envelope.maximumDeveloperFeeBps, 0);
    assert.equal(profile.envelope.bounds.feeModeFlags, 2);
    assert.equal(Object.hasOwn(profile, 'admitted'), false);
    assert.equal(sdk.getKnownLifecycleProfile({ ...identity, profileId: upper(profile.id) }), preset);
    assert.equal(sdk.isRaetoProfile(upper(profile.id)), true);
    assert.ok(sdk.listKnownLifecycleProfiles(identity).includes(preset));
    for (const value of [preset, profile, profile.envelope, profile.envelope.bounds, profile.envelope.graph, profile.adapter, profile.registration, profile.topology, profile.developerTerms, boundHook]) assert.ok(Object.isFrozen(value));
    assert.deepEqual(snapshot.shareChecks.checks.filter(({ accepted }) => accepted).map(({ shareBps }) => shareBps), [...sdk.RAETO_SHARE_BPS_OPTIONS]);
    assert.deepEqual(snapshot.shareChecks.checks.filter(({ accepted }) => !accepted).map(({ shareBps }) => shareBps), [0, 499, 1234, 8000, 10000]);
  });
  for (const quote of sdk.RAETO_QUOTE_ASSETS) for (const shareBps of sdk.RAETO_SHARE_BPS_OPTIONS) test(`${key}: ${quote} / ${shareBps} validates and round-trips`, () => {
    const { plan, config, preset } = makeRaetoPlan(key, { quote, shareBps });
    const encoded = plan.markets[0].config;
    assert.equal(encoded, concatHex([prefix(config), rawTail(shareBps)]));
    assert.deepEqual(sdk.decodePoolBoundV4LifecycleMarketConfig(encoded, 6), config);
    sdk.validateV4LifecycleMarket({ market: plan.markets[0], config, token: testToken, profile: preset.profile });
    sdk.validateRaetoLaunchPlan(plan);
    sdk.validateRaetoLaunchPlan({ ...plan, markets: plan.markets.map((market) => ({ ...market, profileId: upper(market.profileId), adapterId: upper(market.adapterId), quoteAsset: upper(market.quoteAsset) })) });
  });
  for (const changes of [{ feeMode: 0 }, { lpFeePips: 1 }, { developerFeeBps: 1 }, { raetoLaunchConfig: { shareBps: 10000 } }, { raetoLaunchConfig: undefined }, { hmmLaunchConfig: {} }, { ufgLaunchConfig: {} }, { autoCompoundConfig: {} }]) {
    test(`${key}: raw invalid economics/tail ${JSON.stringify(changes)} rejects before RPC`, async () => {
      const { plan, config, preset } = makeRaetoPlan(key);
      const invalid = { ...config, ...changes };
      assert.throws(() => sdk.encodePoolBoundV4LifecycleMarketConfig(invalid), { code: 'INVALID_RAETO_CONFIG' });
      assert.throws(() => sdk.validateV4LifecycleMarket({ market: plan.markets[0], config: invalid, token: testToken, profile: preset.profile }), { code: 'INVALID_RAETO_CONFIG' });
      if (changes.hmmLaunchConfig || changes.ufgLaunchConfig || changes.autoCompoundConfig) return;
      const raw = concatHex([prefix(invalid), invalid.raetoLaunchConfig ? rawTail(invalid.raetoLaunchConfig.shareBps) : '0x']);
      const unsafe = { ...plan, markets: [{ ...plan.markets[0], config: raw }] };
      assert.throws(() => sdk.validateRaetoLaunchPlan(unsafe), { code: 'INVALID_RAETO_PLAN' });
      await assert.rejects(sdk.planLaunch({ plan: unsafe, mode: 'atomic', account: plan.creator, client: { request: async () => { throw new Error('Must reject before RPC'); } } }), { code: 'INVALID_RAETO_CONFIG' });
    });
  }
  test(`${key}: malformed or mixed wire tails cannot decode as Raeto`, () => {
    const { config, plan } = makeRaetoPlan(key);
    for (const encoded of [prefix(config), concatHex([plan.markets[0].config, '0x00']), concatHex([plan.markets[0].config, zeroHash]), concatHex([prefix(config), sdk.encodeAutoCompoundTail({ compoundShareBps: 500 })])]) {
      assert.throws(() => sdk.decodePoolBoundV4LifecycleMarketConfig(encoded, 6), { code: 'INVALID_RAETO_CONFIG' });
    }
    const { minimumHookFeePips, feeSensitivityPipsSecondsPerTick, ...v5 } = config;
    assert.throws(() => sdk.encodePoolBoundV4LifecycleMarketConfig({ ...v5, version: 5 }), { code: 'INVALID_RAETO_CONFIG' });
  });
  test(`${key}: quote allowlist and every-market plan checks reject ordinary, mismatched and malformed markets`, () => {
    const { plan, config, preset } = makeRaetoPlan(key);
    const invalidMarkets = [
      { ...plan.markets[0], quoteAsset: testToken }, { ...plan.markets[0], configVersion: 5 },
      { ...plan.markets[0], profileId: zeroHash }, { ...plan.markets[0], adapterId: zeroHash },
      { ...plan.markets[0], config: '0x' },
    ];
    for (const market of invalidMarkets) for (const markets of [[market], [plan.markets[0], market]]) assert.throws(() => sdk.validateRaetoLaunchPlan({ ...plan, markets }), { code: 'INVALID_RAETO_PLAN' });
    assert.throws(() => sdk.validateRaetoLaunchPlan({ ...plan, markets: [] }), { code: 'INVALID_RAETO_PLAN' });
    assert.throws(() => sdk.validateV4LifecycleMarket({ market: invalidMarkets[0], config, token: testToken, profile: preset.profile }), { code: 'INVALID_RAETO_CONFIG' });
  });
  test(`${key}: known-preset planning, combined preparation and continuation enforce Raeto before RPC`, async () => {
    const { plan, config } = makeRaetoPlan(key);
    const malformed = [
      { ...plan.markets[0], quoteAsset: '0x0000000000000000000000000000000000000001' },
      ...[{ feeMode: 0 }, { lpFeePips: 1 }, { developerFeeBps: 1 }, { raetoLaunchConfig: { shareBps: 10000 } }].map((changes) => {
        const invalid = { ...config, ...changes };
        return { ...plan.markets[0], config: concatHex([prefix(invalid), rawTail(invalid.raetoLaunchConfig.shareBps)]) };
      }),
    ];
    for (const market of malformed) for (const mode of ['atomic', 'staged']) {
      const unsafe = { ...plan, markets: [market] };
      const client = { request: async () => { throw new Error('Invalid Raeto economics must reject before RPC'); } };
      const options = { client, plan: unsafe, mode, account: plan.creator };
      await assert.rejects(sdk.planLaunch(options), { code: 'INVALID_RAETO_CONFIG' });
      await assert.rejects(sdk.prepareAndPlanLifecycleLaunch(options), { code: 'INVALID_RAETO_CONFIG' });
      const planned = { plan: unsafe, account: plan.creator, chainId: plan.chainId, mode,
        planHash: sdk.hashLaunchPlan(unsafe), launchId: sdk.hashLaunchIdentity(unsafe), predictedToken: testToken };
      await assert.rejects(sdk.buildNextTransaction({ client, planned }), { code: 'INVALID_RAETO_CONFIG' });
    }
  });
  test(`${key}: share changes bind the plan, but do not change the deployed hook's prefix-only commitment`, () => {
    const { config, plan } = makeRaetoPlan(key);
    const changed = (updates) => ({ ...plan, markets: [{ ...plan.markets[0], config: sdk.encodePoolBoundV4LifecycleMarketConfig({ ...config, ...updates }) }] });
    const original = deriveKnownPoolBoundHookDeployment({ plan, marketIndex: 0, token: testToken });
    const shareChanged = changed({ raetoLaunchConfig: { shareBps: 7500 } });
    const saltChanged = changed({ hookSalt: toHex(1234n, { size: 32 }) });
    for (const changedPlan of [shareChanged, saltChanged]) assert.equal(deriveKnownPoolBoundHookDeployment({ plan: changedPlan, marketIndex: 0, token: testToken }).deployment.initCodeHash, original.deployment.initCodeHash);
    assert.notEqual(sdk.hashLaunchPlan(shareChanged), sdk.hashLaunchPlan(plan));
    assert.deepEqual(sdk.parseLaunchPlan(sdk.serializeLaunchPlan(plan)), plan);
    for (const mode of ['atomic', 'staged']) for (const tx of sdk.buildLaunchTransactions({ plan, mode })) assert.equal(decodeFunctionData({ abi: sdk.launchLifecycleAbi, data: tx.data }).args[0].markets[0].config, plan.markets[0].config);
  });
}
test('Raeto tails cannot be attached to any other template', () => {
  const { config } = makeRaetoPlan(keys[0]);
  for (const key of [sdk.KnownLifecycleProfile.V4FixedFeePool, sdk.KnownLifecycleProfile.V4DynamicFeePool, sdk.KnownLifecycleProfile.V4HmmFixedPool, sdk.KnownLifecycleProfile.V4UfgFixedPool, sdk.KnownLifecycleProfile.V4AutoCompoundStaticPool]) {
    const profileId = sdk.getKnownLifecycleProfile({ ...identity, key }).profile.id;
    assert.throws(() => sdk.encodePoolBoundV4LifecycleMarketConfig({ ...config, profileId }), { code: 'INVALID_RAETO_CONFIG' });
  }
});
