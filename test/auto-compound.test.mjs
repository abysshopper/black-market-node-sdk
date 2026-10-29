import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { concatHex, decodeFunctionData, encodeAbiParameters, keccak256, toHex, zeroHash } from 'viem';
import * as sdk from '../dist/lifecycle/index.js';
import { deriveKnownPoolBoundHookDeployment } from '../dist/lifecycle/calibration.js';
import { identity, keys, makeAutoCompoundPlan, testToken } from './fixtures/auto-compound-plan.mjs';

const evidence = JSON.parse(await readFile(new URL('./fixtures/auto-compound-registry-readback.json', import.meta.url), 'utf8'));
const prefix = (config) => encodeAbiParameters([{ type: 'tuple', components: sdk.poolBoundV4LifecycleMarketComponentsV6 }], [config]);
const tail = (share, version = sdk.AUTO_COMPOUND_CONFIG_VERSION) => encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [version, BigInt(share)]);
const upper = (value) => `0x${value.slice(2).toUpperCase()}`;

for (const compoundShareBps of [0, 1, 5000, 9999, 10000]) test(`auto-compound tail round-trips ${compoundShareBps} bps in exactly 64 bytes`, () => {
  const config = { compoundShareBps };
  const encoded = sdk.encodeAutoCompoundTail(config);
  assert.equal(encoded.length, 2 + 64 * 2);
  assert.equal(encoded, tail(compoundShareBps));
  assert.deepEqual(sdk.decodeAutoCompoundTail(encoded), config);
  assert.deepEqual(sdk.decodeAutoCompoundTail(upper(encoded)), config);
});
for (const compoundShareBps of [-1, 10001, 65535, 0.5, NaN, Infinity, '5000', undefined]) test(`auto-compound encoder rejects share ${compoundShareBps}`, () => {
  assert.throws(() => sdk.encodeAutoCompoundTail({ compoundShareBps }), { code: 'INVALID_AUTO_COMPOUND_CONFIG' });
});
test('auto-compound decoder rejects wrong versions, malformed lengths and noncanonical uint16 padding', () => {
  const valid = sdk.encodeAutoCompoundTail({ compoundShareBps: 5000 });
  for (const encoded of ['0x', valid.slice(0, -2), concatHex([valid, '0x00']), concatHex([valid, zeroHash]), tail(5000, zeroHash), tail(10001), tail(65536), tail((1n << 255n) + 5000n)]) {
    assert.throws(() => sdk.decodeAutoCompoundTail(encoded));
  }
});

for (const key of keys) {
  test(`${key}: frozen presets reproduce preserved admission and pinned chain metadata`, () => {
    const { preset } = makeAutoCompoundPlan(key);
    const { profile, boundHook } = preset;
    const snapshot = evidence.profiles.find(({ profileId }) => profileId === profile.id);
    assert.equal(preset.supported, true);
    assert.equal(sdk.hashLifecycleProfile(profile.envelope), profile.id);
    assert.equal(sdk.hashLaunchBounds(profile.envelope.bounds), profile.envelope.configBoundsDigest);
    assert.equal(keccak256(boundHook.creationCode), profile.topology.hookCreationCodeHash);
    assert.equal(sdk.encodeLaunchEnvelope(profile.envelope), snapshot.admission.envelopeBytes);
    for (const [name, value, components] of [
      ['profile', profile.registration, sdk.profileRegistrationV1Components],
      ['adapter', profile.adapter, sdk.adapterRegistrationV1Components],
      ['profileTopology', profile.topology, sdk.profileTopologyV1Components],
    ]) assert.equal(encodeAbiParameters([{ type: 'tuple', components }], [value]), snapshot.raw[name]);
    assert.equal(keccak256(concatHex([snapshot.raw.profile, snapshot.raw.profileEnvelope])), snapshot.admission.envelopeHash);
    assert.equal(keccak256(snapshot.admission.admissionBytes), snapshot.admission.payloadHash);
    assert.equal(concatHex(snapshot.chunks.map(({ runtime }) => `0x${runtime.slice(4)}`)), boundHook.creationCode);
    assert.equal(snapshot.codeHashes.module, snapshot.moduleMetadata.compoundModuleCodeHash);
    assert.equal(sdk.hashLaunchDependencies({ chainId: identity.chainId, core: identity.orchestrator,
      registry: evidence.registry, registrar: boundHook.registrar, graph: profile.envelope.graph }), profile.registration.dependencyDigest);
    assert.equal(profile.envelope.maximumDeveloperFeeBps, 0);
    assert.equal(profile.envelope.bounds.feeModeFlags, 3);
    assert.equal(Object.hasOwn(profile, 'admitted'), false);
    for (const value of [preset, profile, profile.envelope, profile.envelope.bounds, profile.envelope.graph, profile.adapter,
      profile.registration, profile.topology, profile.developerTerms, boundHook]) assert.equal(Object.isFrozen(value), true);
    assert.equal(sdk.getKnownLifecycleProfile({ ...identity, profileId: upper(profile.id) }), preset);
    assert.equal(sdk.isAutoCompoundProfile(upper(profile.id)), true);
    assert.ok(sdk.listKnownLifecycleProfiles(identity).includes(preset));
  });
  for (const feeMode of [0, 1]) test(`${key}: feeMode ${feeMode} config has a canonical typed tail`, () => {
    const { config, plan, preset } = makeAutoCompoundPlan(key, { feeMode });
    const encoded = plan.markets[0].config;
    assert.equal(encoded, concatHex([prefix(config), sdk.encodeAutoCompoundTail(config.autoCompoundConfig)]));
    assert.deepEqual(sdk.decodePoolBoundV4LifecycleMarketConfig(encoded, 6), config);
    sdk.validateV4LifecycleMarket({ market: plan.markets[0], config, token: testToken, profile: preset.profile });
    for (const malformed of [prefix(config), encoded.slice(0, -2), concatHex([encoded, zeroHash]), concatHex([prefix(config), tail(5000, zeroHash)]), concatHex([prefix(config), tail(10001)])]) {
      assert.throws(() => sdk.decodePoolBoundV4LifecycleMarketConfig(malformed, 6));
    }
    assert.throws(() => sdk.decodePoolBoundV4LifecycleMarketConfig(encoded, 5), { code: 'INVALID_BOUND_MARKET' });
    assert.throws(() => sdk.encodePoolBoundV4LifecycleMarketConfig({ ...config, autoCompoundConfig: undefined }), { code: 'INVALID_AUTO_COMPOUND_CONFIG' });
    for (const extra of [{ hmmLaunchConfig: {} }, { ufgLaunchConfig: {} }]) assert.throws(() => sdk.encodePoolBoundV4LifecycleMarketConfig({ ...config, ...extra }), { code: 'INVALID_AUTO_COMPOUND_CONFIG' });
    assert.throws(() => sdk.encodePoolBoundV4LifecycleMarketConfig({ ...config, version: 5, minimumHookFeePips: undefined, feeSensitivityPipsSecondsPerTick: undefined }), { code: 'UNSUPPORTED_CONFIG_VERSION' });
    const { minimumHookFeePips, feeSensitivityPipsSecondsPerTick, ...v5 } = config;
    assert.throws(() => sdk.encodePoolBoundV4LifecycleMarketConfig({ ...v5, version: 5 }), { code: 'INVALID_AUTO_COMPOUND_CONFIG' });
  });
  for (const [changes, code] of [[{ lpFeePips: 1 }, 'INVALID_HOOK_FEES'], [{ developerFeeBps: 1 }, 'DEVELOPER_FEE_CEILING'], [{ autoCompoundConfig: { compoundShareBps: 10001 } }, 'INVALID_AUTO_COMPOUND_CONFIG']]) {
    test(`${key}: ${code} rejects unsafe raw config before RPC or funding`, async () => {
      const { config, plan, preset } = makeAutoCompoundPlan(key);
      const invalid = { ...config, ...changes };
      assert.throws(() => sdk.encodePoolBoundV4LifecycleMarketConfig(invalid), { code });
      assert.throws(() => sdk.validateV4LifecycleMarket({ market: plan.markets[0], config: invalid, token: testToken, profile: preset.profile }), { code });
      const raw = concatHex([prefix(invalid), tail(invalid.autoCompoundConfig.compoundShareBps)]);
      const unsafe = { ...plan, markets: [{ ...plan.markets[0], config: raw }] };
      await assert.rejects(sdk.planLaunch({ plan: unsafe, mode: 'atomic', account: plan.creator,
        client: { request: async () => { throw new Error('Must reject before RPC/funding'); } } }), { code });
    });
  }
  test(`${key}: tail changes bind constructor economics while salt changes do not`, () => {
    const { config, plan } = makeAutoCompoundPlan(key);
    const context = { plan, marketIndex: 0, token: testToken };
    const original = deriveKnownPoolBoundHookDeployment(context);
    const changed = (updates) => ({ ...plan, markets: [{ ...plan.markets[0], config: sdk.encodePoolBoundV4LifecycleMarketConfig({ ...config, ...updates }) }] });
    const shareChanged = changed({ autoCompoundConfig: { compoundShareBps: 2500 } });
    const saltChanged = changed({ hookSalt: toHex(1234n, { size: 32 }) });
    assert.notEqual(deriveKnownPoolBoundHookDeployment({ ...context, plan: shareChanged }).deployment.initCodeHash, original.deployment.initCodeHash);
    assert.equal(deriveKnownPoolBoundHookDeployment({ ...context, plan: saltChanged }).deployment.initCodeHash, original.deployment.initCodeHash);
    assert.notEqual(sdk.hashLaunchPlan(shareChanged), sdk.hashLaunchPlan(plan));
    assert.deepEqual(sdk.parseLaunchPlan(sdk.serializeLaunchPlan(plan)), plan);
    for (const mode of ['atomic', 'staged']) {
      const transactions = sdk.buildLaunchTransactions({ plan, mode });
      assert.equal(transactions.length, mode === 'atomic' ? 1 : 3);
      for (const transaction of transactions) assert.equal(decodeFunctionData({ abi: sdk.launchLifecycleAbi, data: transaction.data }).args[0].markets[0].config, plan.markets[0].config);
    }
  });
}
test('auto-compound opening math uses static maximum and dynamic minimum like the corresponding ordinary hook', () => {
  for (const [key, ordinaryKey] of [[keys[0], sdk.KnownLifecycleProfile.V4FixedFeePool], [keys[1], sdk.KnownLifecycleProfile.V4DynamicFeePool]]) {
    const { plan, config } = makeAutoCompoundPlan(key);
    const preset = sdk.getKnownLifecycleProfile({ ...identity, key: ordinaryKey });
    const ordinary = { ...config, profileId: preset.profile.id, termsDigest: preset.profile.envelope.termsDigest,
      developerBeneficiary: preset.profile.envelope.beneficiary, autoCompoundConfig: undefined };
    const buys = [{ marketIndex: 0, quoteAmountIn: 10n ** 15n, minTokenOut: 1n, recipient: plan.creator, sqrtPriceLimitX96: 0n }];
    const actual = sdk.computeLifecycleOpeningBuys({ plan: { ...plan, buys }, predictedToken: testToken });
    const expected = sdk.computeLifecycleOpeningBuys({ plan: { ...plan, buys, markets: [{ ...plan.markets[0], profileId: preset.profile.id,
      adapterId: preset.profile.registration.adapterId, config: sdk.encodePoolBoundV4LifecycleMarketConfig(ordinary) }] }, predictedToken: testToken });
    assert.deepEqual(actual, expected);
    assert.ok(actual[0].tokenOut > 0n);
  }
});
test('retired auto-compound profiles are not supported or revived by typed tails', () => {
  const { config } = makeAutoCompoundPlan(keys[0]);
  assert.equal(evidence.retired.length, 2);
  for (const { profileId, registration } of evidence.retired) {
    assert.equal(registration.enabled, false);
    assert.equal(sdk.isAutoCompoundProfile(profileId), false);
    assert.equal(sdk.getKnownLifecycleProfile({ ...identity, profileId }), undefined);
    assert.throws(() => sdk.encodePoolBoundV4LifecycleMarketConfig({ ...config, profileId }), { code: 'INVALID_AUTO_COMPOUND_CONFIG' });
  }
  for (const key of [sdk.KnownLifecycleProfile.V4FixedFeePool, sdk.KnownLifecycleProfile.V4HmmFixedPool, sdk.KnownLifecycleProfile.V4UfgFixedPool]) {
    const profileId = sdk.getKnownLifecycleProfile({ ...identity, key }).profile.id;
    assert.throws(() => sdk.encodePoolBoundV4LifecycleMarketConfig({ ...config, profileId }), { code: 'INVALID_AUTO_COMPOUND_CONFIG' });
  }
});
