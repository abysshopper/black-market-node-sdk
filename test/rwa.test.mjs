import assert from 'node:assert/strict';
import test from 'node:test';
import { concatHex, decodeFunctionData, encodeAbiParameters, getAddress, keccak256, toHex, zeroHash } from 'viem';
import * as sdk from '../dist/lifecycle/index.js';
import { deriveKnownPoolBoundHookDeployment } from '../dist/lifecycle/calibration.js';
import { evidence, identity, keys, listedStocks, makeRwaPlan, rwaTerms, testToken } from './fixtures/rwa-plan.mjs';

const prefix = (config) => encodeAbiParameters([{ type: 'tuple', components: sdk.poolBoundV4LifecycleMarketComponentsV6 }], [config]);
const termsComponents = [{ name: 'shareBps', type: 'uint16' }, { name: 'premiumBps', type: 'uint16' }, { name: 'maxPriceAge', type: 'uint32' }, { name: 'basket', type: 'address[]' }, { name: 'weightsBps', type: 'uint16[]' }];
// Encodes without SDK validation so invalid terms can reach the decoders.
const rawTail = (terms) => encodeAbiParameters([{ type: 'tuple', components: termsComponents }], [terms]);
const upper = (value) => `0x${value.slice(2).toUpperCase()}`;
const noRpc = { request: async () => { throw new Error('Invalid RWA launches must reject before RPC'); } };
const [a, b, c] = listedStocks;

test('RWA deployment constants are checksummed and bound to the deployed collector factories', () => {
  assert.equal(getAddress(sdk.RWA_ASSET_REGISTRY_ADDRESS), sdk.RWA_ASSET_REGISTRY_ADDRESS);
  assert.equal(getAddress(sdk.RWA_QUOTE_ASSET), sdk.RWA_QUOTE_ASSET);
  assert.equal(sdk.RWA_QUOTE_ASSET, sdk.RAETO_QUOTE_ASSETS[1]);
  for (const profile of evidence.profiles) {
    assert.equal(profile.factoryMetadata.assetRegistry.toLowerCase(), sdk.RWA_ASSET_REGISTRY_ADDRESS.toLowerCase());
    assert.equal(profile.factoryMetadata.usdg.toLowerCase(), sdk.RWA_QUOTE_ASSET.toLowerCase());
  }
  assert.equal(sdk.isRwaProfile(zeroHash), false);
  assert.ok(listedStocks.length >= sdk.RWA_MAX_BASKET);
});

for (const profile of evidence.profiles) test(`${profile.variant}: SDK codec matches every pinned deployed decodeAndValidate verdict`, () => {
  for (const check of profile.termChecks.checks) {
    if (check.accepted) {
      const terms = { ...check.terms, basket: check.terms.basket.map((asset) => getAddress(asset)) };
      assert.equal(sdk.encodeRwaLaunchTail(terms), check.tail, check.name);
      assert.deepEqual(sdk.decodeRwaLaunchTail(check.tail), terms, check.name);
    } else if (check.name !== 'unlisted stock') {
      // Listing is live registry state, enforced on-chain at begin; every static violation refuses locally.
      assert.throws(() => sdk.encodeRwaLaunchTail(check.terms), { code: 'INVALID_RWA_CONFIG' }, check.name);
      assert.throws(() => sdk.decodeRwaLaunchTail(check.tail), { code: 'INVALID_RWA_CONFIG' }, check.name);
    }
  }
});

for (let size = 1; size <= sdk.RWA_MAX_BASKET; size += 1) test(`RWA tail round-trips a ${size}-stock basket as abi.encode(RwaLaunchConfigV1)`, () => {
  const terms = { ...rwaTerms(size), maxPriceAge: sdk.RWA_ANY_PRICE_AGE };
  const tail = sdk.encodeRwaLaunchTail(terms);
  assert.equal(tail, rawTail(terms));
  // The deployed deployer stages at most 20 words: offset, 5 head words, two length words and 2n items.
  assert.equal((tail.length - 2) / 64, 8 + 2 * size);
  assert.deepEqual(sdk.decodeRwaLaunchTail(tail), terms);
  assert.deepEqual(sdk.decodeRwaLaunchTail(upper(tail)), terms);
});

const invalidTerms = {
  'share above 10000': { shareBps: 10001 }, 'negative share': { shareBps: -1 }, 'fractional share': { shareBps: 0.5 },
  'premium above 100': { premiumBps: 101 }, 'age above uint32': { maxPriceAge: 2 ** 32 }, 'negative age': { maxPriceAge: -1 },
  'empty basket': { basket: [], weightsBps: [] },
  'seven stocks': { basket: listedStocks.slice(0, 7), weightsBps: [4000, 1000, 1000, 1000, 1000, 1000, 1000] },
  'descending basket': { basket: [b, a], weightsBps: [5000, 5000] },
  'duplicate stock': { basket: [a, a], weightsBps: [5000, 5000] },
  'USDG stock': { basket: [sdk.RWA_QUOTE_ASSET], weightsBps: [10000] },
  'zero address': { basket: ['0x0000000000000000000000000000000000000000'], weightsBps: [10000] },
  'missing weight': { basket: [a, b], weightsBps: [10000] },
  'weights below 10000': { basket: [a, b], weightsBps: [5000, 4999] },
  'weights above 10000': { basket: [a, b], weightsBps: [5000, 5001] },
  'weight above uint16': { basket: [a, b], weightsBps: [70000, -60000] },
};
for (const [name, changes] of Object.entries(invalidTerms)) test(`RWA rejects ${name}`, () => {
  const terms = { ...rwaTerms(), ...changes };
  assert.throws(() => sdk.validateRwaLaunchConfig(terms), { code: 'INVALID_RWA_CONFIG' });
  assert.throws(() => sdk.encodeRwaLaunchTail(terms), { code: 'INVALID_RWA_CONFIG' });
});

test('RWA decoder rejects truncated, extended and noncanonical tails', () => {
  const tail = sdk.encodeRwaLaunchTail(rwaTerms());
  const shifted = concatHex([encodeAbiParameters([{ type: 'uint256' }], [64n]), zeroHash, `0x${tail.slice(66)}`]);
  for (const encoded of ['0x', tail.slice(0, -64), concatHex([tail, zeroHash]), concatHex([tail, '0x00']), shifted]) {
    assert.throws(() => sdk.decodeRwaLaunchTail(encoded), { code: 'INVALID_RWA_CONFIG' });
  }
});

for (const key of keys) {
  test(`${key}: presets reproduce preserved admission, dependency graph and ordinary hook bytes`, () => {
    const { preset } = makeRwaPlan(key);
    const { profile, boundHook } = preset;
    const snapshot = evidence.profiles.find(({ profileId }) => profileId === profile.id);
    const ordinary = sdk.getKnownLifecycleProfile({ ...identity, key: key === keys[0] ? sdk.KnownLifecycleProfile.V4FixedFeePool : sdk.KnownLifecycleProfile.V4DynamicFeePool });
    assert.equal(preset.supported, true);
    assert.equal(sdk.hashLifecycleProfile(profile.envelope), profile.id);
    assert.equal(sdk.encodeLaunchEnvelope(profile.envelope), snapshot.admission.envelopeBytes);
    assert.equal(boundHook.creationCode, ordinary.boundHook.creationCode);
    assert.equal(concatHex(snapshot.chunks.map(({ runtime }) => `0x${runtime.slice(4)}`)), boundHook.creationCode);
    for (const [name, value, components] of [
      ['profile', profile.registration, sdk.profileRegistrationV1Components], ['adapter', profile.adapter, sdk.adapterRegistrationV1Components],
      ['profileTopology', profile.topology, sdk.profileTopologyV1Components],
    ]) assert.equal(encodeAbiParameters([{ type: 'tuple', components }], [value]), snapshot.raw[name]);
    assert.equal(keccak256(snapshot.admission.admissionBytes), snapshot.admission.payloadHash);
    assert.equal(sdk.hashLaunchDependencies({ chainId: identity.chainId, core: identity.orchestrator, registry: evidence.registry, registrar: boundHook.registrar, graph: profile.envelope.graph }), profile.registration.dependencyDigest);
    assert.equal(profile.registration.adapterId, key === keys[0] ? sdk.RWA_FIXED_ADAPTER_ID : sdk.RWA_DYNAMIC_ADAPTER_ID);
    assert.equal(sdk.getKnownLifecycleProfile({ ...identity, profileId: upper(profile.id) }), preset);
    assert.equal(sdk.isRwaProfile(upper(profile.id)), true);
    assert.ok(sdk.listKnownLifecycleProfiles(identity).includes(preset));
    for (const value of [preset, profile, profile.envelope, profile.envelope.graph, profile.adapter, profile.registration, profile.topology, boundHook]) assert.ok(Object.isFrozen(value));
  });

  for (const size of [1, sdk.RWA_MAX_BASKET]) test(`${key}: a valid ${size}-stock market validates, round-trips and plans its terms`, () => {
    const { plan, config, preset } = makeRwaPlan(key, { terms: rwaTerms(size) });
    assert.equal(plan.markets[0].config, concatHex([prefix(config), rawTail(config.rwaLaunchConfig)]));
    assert.deepEqual(sdk.decodePoolBoundV4LifecycleMarketConfig(plan.markets[0].config, 6), config);
    sdk.validateV4LifecycleMarket({ market: plan.markets[0], config, token: testToken, profile: preset.profile });
    sdk.validateRwaLaunchPlan(plan);
    sdk.validateRwaLaunchPlan({ ...plan, markets: plan.markets.map((market) => ({ ...market, profileId: upper(market.profileId), adapterId: upper(market.adapterId), quoteAsset: upper(market.quoteAsset) })) });
  });

  for (const changes of [{ feeMode: 0 }, { lpFeePips: 1 }, { developerFeeBps: 1 }, { rwaLaunchConfig: undefined }, { rwaLaunchConfig: { ...rwaTerms(), premiumBps: 101 } },
    { raetoLaunchConfig: { shareBps: 500 } }, { hmmLaunchConfig: {} }, { ufgLaunchConfig: {} }, { autoCompoundConfig: {} }]) {
    test(`${key}: invalid economics/tail ${JSON.stringify(changes)} refuses locally`, () => {
      const { plan, config, preset } = makeRwaPlan(key);
      const invalid = { ...config, ...changes };
      // A foreign Raeto tail is refused by the Raeto guard that runs first.
      const code = changes.raetoLaunchConfig ? 'INVALID_RAETO_CONFIG' : 'INVALID_RWA_CONFIG';
      assert.throws(() => sdk.encodePoolBoundV4LifecycleMarketConfig(invalid), { code });
      assert.throws(() => sdk.validateV4LifecycleMarket({ market: plan.markets[0], config: invalid, token: testToken, profile: preset.profile }), { code });
    });
  }

  test(`${key}: launches that would only fail at preparation refuse before begin and before RPC`, async () => {
    const { plan, config } = makeRwaPlan(key, { terms: rwaTerms(3) });
    const withFees = (feeAssets) => ({ ...plan, feeAssets });
    const stockPolicy = (asset, policy) => plan.feeAssets.map((entry) => entry.asset === asset ? { ...entry, ...policy } : entry);
    const rawMarket = (changes) => ({ ...plan.markets[0], config: concatHex([prefix({ ...config, ...changes }), rawTail({ ...config.rwaLaunchConfig, ...changes.rwaLaunchConfig })]) });
    const unsafe = [
      // Staking reward mode still commits rewards shares; only Dividends tokens can stream stock.
      { ...plan, token: { ...plan.token, rewardMode: sdk.LifecycleRewardMode.Staking } },
      withFees(plan.feeAssets.filter(({ asset }) => asset !== c)),
      withFees(stockPolicy(b, { ownerBps: 5000, rewardsBps: 5000 })),
      withFees(stockPolicy(a, { ownerBps: 0, rewardsBps: 9000, burnBps: 1000 })),
      { ...plan, markets: [{ ...plan.markets[0], quoteAsset: sdk.RAETO_QUOTE_ASSETS[0] }] },
      { ...plan, markets: [{ ...plan.markets[0], adapterId: key === keys[0] ? sdk.RWA_DYNAMIC_ADAPTER_ID : sdk.RWA_FIXED_ADAPTER_ID }] },
      { ...plan, markets: [rawMarket({ feeMode: 0 })] },
      { ...plan, markets: [rawMarket({ rwaLaunchConfig: { weightsBps: [3334, 3333, 3332] } })] },
    ];
    for (const candidate of unsafe) {
      assert.throws(() => sdk.validateRwaLaunchPlan(candidate), { code: 'INVALID_RWA_CONFIG' });
      for (const mode of ['atomic', 'staged']) {
        const options = { client: noRpc, plan: candidate, mode, account: plan.creator };
        await assert.rejects(sdk.planLaunch(options), { code: 'INVALID_RWA_CONFIG' });
        const planned = { plan: candidate, account: plan.creator, chainId: plan.chainId, mode,
          planHash: sdk.hashLaunchPlan(candidate), launchId: sdk.hashLaunchIdentity(candidate), predictedToken: testToken };
        await assert.rejects(sdk.buildNextTransaction({ client: noRpc, planned }), { code: 'INVALID_RWA_CONFIG' });
      }
    }
  });

  test(`${key}: term changes bind the plan but not the deployed hook's prefix-only commitment`, () => {
    const { config, plan } = makeRwaPlan(key);
    const changed = (updates) => ({ ...plan, markets: [{ ...plan.markets[0], config: sdk.encodePoolBoundV4LifecycleMarketConfig({ ...config, ...updates }) }] });
    const original = deriveKnownPoolBoundHookDeployment({ plan, marketIndex: 0, token: testToken });
    const termsChanged = changed({ rwaLaunchConfig: { ...config.rwaLaunchConfig, shareBps: 10000, weightsBps: [1, 9999] } });
    const saltChanged = changed({ hookSalt: toHex(1234n, { size: 32 }) });
    for (const changedPlan of [termsChanged, saltChanged]) assert.equal(deriveKnownPoolBoundHookDeployment({ plan: changedPlan, marketIndex: 0, token: testToken }).deployment.initCodeHash, original.deployment.initCodeHash);
    assert.notEqual(sdk.hashLaunchPlan(termsChanged), sdk.hashLaunchPlan(plan));
    assert.deepEqual(sdk.parseLaunchPlan(sdk.serializeLaunchPlan(plan)), plan);
    for (const mode of ['atomic', 'staged']) for (const tx of sdk.buildLaunchTransactions({ plan, mode })) assert.equal(decodeFunctionData({ abi: sdk.launchLifecycleAbi, data: tx.data }).args[0].markets[0].config, plan.markets[0].config);
  });
}

test('RWA tails cannot be attached to any other template, and other tails cannot ride RWA profiles', () => {
  const { config } = makeRwaPlan(keys[0]);
  for (const key of [sdk.KnownLifecycleProfile.V4FixedFeePool, sdk.KnownLifecycleProfile.V4DynamicFeePool, sdk.KnownLifecycleProfile.V4HmmFixedPool, sdk.KnownLifecycleProfile.V4UfgFixedPool, sdk.KnownLifecycleProfile.V4AutoCompoundStaticPool, sdk.KnownLifecycleProfile.V4RaetoFixedPool]) {
    const profileId = sdk.getKnownLifecycleProfile({ ...identity, key }).profile.id;
    assert.throws(() => sdk.encodePoolBoundV4LifecycleMarketConfig({ ...config, profileId }), { code: /INVALID_(RWA|RAETO|AUTO_COMPOUND|HMM|UFG)_CONFIG/ });
  }
});

test('Plans without RWA markets are unaffected by RWA plan checks', () => {
  const { plan } = makeRwaPlan(keys[0]);
  const fixed = sdk.getKnownLifecycleProfile({ ...identity, key: sdk.KnownLifecycleProfile.V4FixedFeePool });
  sdk.validateRwaLaunchPlan({ ...plan, token: { ...plan.token, rewardMode: sdk.LifecycleRewardMode.None }, markets: [{ ...plan.markets[0], profileId: fixed.profile.id }] });
});
