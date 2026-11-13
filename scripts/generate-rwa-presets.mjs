// Read-only capture: node --experimental-transform-types scripts/generate-rwa-presets.mjs --readback /path/to/black-market
// Offline regeneration: node --experimental-transform-types scripts/generate-rwa-presets.mjs
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { concatHex, createPublicClient, decodeAbiParameters, encodeAbiParameters, encodeFunctionData, getAddress, http, keccak256, parseAbi, stringToHex, zeroHash } from 'viem';
import { adapterRegistrationV1Components, encodeLaunchEnvelope, hashLaunchBounds, hashLaunchDependencies, hashLifecycleProfile, launchEnvelopeV2Components, profileRegistrationV1Components, profileTopologyV1Components } from '../src/lifecycle/schema.ts';
import { fixedFeePoolHookV1CreationCode } from '../src/lifecycle/deployments/fixed-fee-pool-hook-v1-20261008.ts';
import { dynamicFeePoolHookV1CreationCode } from '../src/lifecycle/deployments/dynamic-fee-pool-hook-v1-20261011.ts';
// Source modules retain package-facing .js suffixes. Resolve their .ts sources so
// regeneration works from a clean checkout without building generated presets first.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.startsWith(new URL('../src/', import.meta.url).href)) {
    return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
  }
  return nextResolve(specifier, context);
} });
const { poolBoundV4LifecycleMarketComponentsV6 } = await import('../src/lifecycle/markets.ts');
const { poolFeeCollectorFactoryConfigV6Abi } = await import('../src/lifecycle/abi.ts');
const { RWA_FIXED_PROFILE_ID, RWA_DYNAMIC_PROFILE_ID, RWA_FIXED_ADAPTER_ID, RWA_DYNAMIC_ADAPTER_ID, RWA_ASSET_REGISTRY_ADDRESS, RWA_QUOTE_ASSET, encodeRwaLaunchTail } = await import('../src/lifecycle/rwa.ts');

const capture = process.argv.includes('--readback');
const root = process.argv.slice(2).find((arg) => arg !== '--readback');
if (capture && !root) throw new Error('Pass the read-only protocol checkout path');
const evidenceUrl = new URL('../test/fixtures/rwa-registry-readback.json', import.meta.url);
const registry = '0xB2B0f9F36617810D67b8fC175153Aa10024C1358';
const orchestrator = '0x91560876033d568d25CDe98C78c33ff8FC43962c';
const run = 'contracts/deployments/launch/rwa-reward/20261113T170429Z';
// registry/registry.json from the successful 20261113T170429Z registry deployment.
const assetRegistryCodeHash = '0xaaa52c8cc8a0e3fd27ce756cc6b4e70c51423e9b597b11f32d3e49f8b1fc890d';
const assetRegistryImplementation = '0x6e95829569EDbbd1C018e0E6B635f0210BE57aF4';
const assetRegistryImplementationCodeHash = '0x5a52a5715d93ce80eacb061890f222782d9d17c49e54951c97cde2c3a7a11d24';
const eip1967 = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
// Registry-listed AAPL/GME/TSLA and unlisted WETH for pinned decodeAndValidate parity checks.
const AAPL = '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9', GME = '0x1b0E319c6A659F002271B69dB8A7df2F911c153E', TSLA = '0x322F0929c4625eD5bAd873c95208D54E1c003b2d';
const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
const specs = [
  { variant: 'fixed', directory: 'rwa-reward-fixed', profileId: RWA_FIXED_PROFILE_ID, adapterId: RWA_FIXED_ADAPTER_ID, adapter: '0x56bf798a2ea3935e2f16abc48d2e20d7b156800e', collectorFactory: '0x5a34f50e945220774b3210e05c0c3a3f6132955d', collectorDeployer: '0x9488807200eba120d242f328374e1aa9a17bb185', locker: '0x5249ca601e8e695efecf9375aafa531141d7e2f0', hookDeployer: '0x6adeaa3d9fa1e3a5f04d2c0deb21bf438ce9af9a', creationCode: fixedFeePoolHookV1CreationCode, transactionHash: '0xeea3456cd41b8b86dd17bbace3dfd9d96c04212beb5e1c7f421602176930cb17' },
  { variant: 'dynamic', directory: 'rwa-reward-dynamic', profileId: RWA_DYNAMIC_PROFILE_ID, adapterId: RWA_DYNAMIC_ADAPTER_ID, adapter: '0xf06a5ec32f0bba89e4ca16e8aecd56c9f125a157', collectorFactory: '0x7f999eb2127dd6c4702cbb716518efffb318d7d0', collectorDeployer: '0x4b60a9d76c9184cc519ca3c5e3a371705b93a329', locker: '0xfff8409ce0d9030ea30ab9b0c027b5fa0114a949', hookDeployer: '0xcb4bcaef4816f75efa547a9f0f94d6116819848b', creationCode: dynamicFeePoolHookV1CreationCode, transactionHash: '0xce4c0d0ad3e25f2f82abfc3e28bf6aedbe7da8282360d07beb131d62b641a592' },
];
const components = { profileEnvelope: launchEnvelopeV2Components, adapter: adapterRegistrationV1Components, profile: profileRegistrationV1Components, profileTopology: profileTopologyV1Components };
const registryAbi = Object.entries(components).map(([name, fields]) => ({ type: 'function', name, stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'tuple', components: fields }] }));
const adapterAbi = parseAbi([
  'function PROFILE_ID() view returns (bytes32)', 'function CONFIG_SCHEMA() view returns (bytes32)',
  'function CONFIG_VERSION() view returns (uint32)', 'function dependencyDigest() view returns (bytes32)',
  ...['core', 'implementationRegistry', 'poolManager', 'oracleFactory', 'locker', 'collectorFactory', 'hookDeployer'].map((name) => `function ${name}() view returns (address)`),
]);
const factoryAbi = [...poolFeeCollectorFactoryConfigV6Abi, ...parseAbi([
  ...['assetRegistry', 'usdg', 'collectorDeployer', 'implementationRegistry'].map((name) => `function ${name}() view returns (address)`),
  'error InvalidRwaConfiguration()',
])];
const json = (value) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n';
const equalHex = (actual, expected) => assert.equal(actual.toLowerCase(), expected.toLowerCase());
const decode = (raw) => Object.fromEntries(Object.entries(components).map(([name, fields]) => [name, decodeAbiParameters([{ type: 'tuple', components: fields }], raw[name])[0]]));
// Encoded without SDK validation so invalid terms reach the deployed decoder.
const rawTail = (terms) => encodeAbiParameters([{ type: 'tuple', components: [{ name: 'shareBps', type: 'uint16' }, { name: 'premiumBps', type: 'uint16' }, { name: 'maxPriceAge', type: 'uint32' }, { name: 'basket', type: 'address[]' }, { name: 'weightsBps', type: 'uint16[]' }] }], [terms]);
const termCases = [
  { name: 'one stock, default age', accepted: true, terms: { shareBps: 2500, premiumBps: 50, maxPriceAge: 0, basket: [AAPL], weightsBps: [10000] } },
  { name: 'three stocks, zero share, any age', accepted: true, terms: { shareBps: 0, premiumBps: 0, maxPriceAge: 0xffffffff, basket: [GME, TSLA, AAPL], weightsBps: [5000, 0, 5000] } },
  { name: 'full share, maximum premium', accepted: true, terms: { shareBps: 10000, premiumBps: 100, maxPriceAge: 3600, basket: [GME, TSLA], weightsBps: [1, 9999] } },
  { name: 'share above 10000', accepted: false, terms: { shareBps: 10001, premiumBps: 0, maxPriceAge: 0, basket: [AAPL], weightsBps: [10000] } },
  { name: 'premium above 100', accepted: false, terms: { shareBps: 1000, premiumBps: 101, maxPriceAge: 0, basket: [AAPL], weightsBps: [10000] } },
  { name: 'weights below 10000', accepted: false, terms: { shareBps: 1000, premiumBps: 0, maxPriceAge: 0, basket: [AAPL, TSLA], weightsBps: [5000, 4999] } },
  { name: 'descending basket', accepted: false, terms: { shareBps: 1000, premiumBps: 0, maxPriceAge: 0, basket: [AAPL, TSLA], weightsBps: [5000, 5000] } },
  { name: 'unlisted stock', accepted: false, terms: { shareBps: 1000, premiumBps: 0, maxPriceAge: 0, basket: [WETH], weightsBps: [10000] } },
  { name: 'USDG in basket', accepted: false, terms: { shareBps: 1000, premiumBps: 0, maxPriceAge: 0, basket: [RWA_QUOTE_ASSET], weightsBps: [10000] } },
  { name: 'empty basket', accepted: false, terms: { shareBps: 1000, premiumBps: 0, maxPriceAge: 0, basket: [], weightsBps: [] } },
];
let evidence;
if (capture) {
  const registryRecord = JSON.parse(await readFile(resolve(root, run, 'registry/registry.json'), 'utf8'));
  equalHex(registryRecord.registry, RWA_ASSET_REGISTRY_ADDRESS);
  equalHex(registryRecord.registryCodehash, assetRegistryCodeHash);
  equalHex(registryRecord.implementation, assetRegistryImplementation);
  equalHex(registryRecord.implementationCodehash, assetRegistryImplementationCodeHash);
  equalHex(registryRecord.quoteAsset, RWA_QUOTE_ASSET);
  const client = createPublicClient({ transport: http('https://rpc.mainnet.chain.robinhood.com/') });
  assert.equal(await client.getChainId(), 4663);
  const block = await client.getBlock(), blockNumber = block.number;
  const assetRegistry = {
    codeHash: keccak256(await client.getCode({ address: RWA_ASSET_REGISTRY_ADDRESS, blockNumber })),
    implementationSlot: await client.getStorageAt({ address: RWA_ASSET_REGISTRY_ADDRESS, slot: eip1967, blockNumber }),
    implementationCodeHash: keccak256(await client.getCode({ address: assetRegistryImplementation, blockNumber })),
    listedAssets: await client.readContract({ address: RWA_ASSET_REGISTRY_ADDRESS, abi: parseAbi(['function listedAssets() view returns (address[])']), functionName: 'listedAssets', blockNumber }),
    quoteAsset: await client.readContract({ address: RWA_ASSET_REGISTRY_ADDRESS, abi: parseAbi(['function quoteAsset() view returns (address)']), functionName: 'quoteAsset', blockNumber }),
  };
  const profiles = [];
  for (const spec of specs) {
    const path = `${run}/${spec.directory}`;
    const load = async (file) => JSON.parse(await readFile(resolve(root, path, file), 'utf8'));
    const [admission, result, config, terms, broadcast, identity] = await Promise.all([
      load('admission.json'), load('admission-result.json'), load('config.json'), load('terms.json'),
      load('forge-broadcast/AdmitPoolHookTemplateV1.s.sol/4663/admit-latest.json'), load('hook-byte-identity.json'),
    ]);
    const raw = Object.fromEntries(await Promise.all(Object.keys(components).map(async (name) => {
      const { data } = await client.call({ to: registry, data: encodeFunctionData({ abi: registryAbi, functionName: name, args: [name === 'adapter' ? spec.adapterId : spec.profileId] }), blockNumber });
      return [name, data];
    })));
    const { profileEnvelope: envelope } = decode(raw);
    const chunks = await Promise.all([envelope.graph.codeChunk0, envelope.graph.codeChunk1].map(async (address) => ({ address, runtime: await client.getCode({ address, blockNumber }) })));
    const adapterMetadata = Object.fromEntries(await Promise.all(['PROFILE_ID', 'CONFIG_SCHEMA', 'CONFIG_VERSION', 'core', 'implementationRegistry', 'poolManager', 'oracleFactory', 'locker', 'collectorFactory', 'hookDeployer', 'dependencyDigest'].map(async (name) => [name, await client.readContract({ address: spec.adapter, abi: adapterAbi, functionName: name, blockNumber })])));
    const factoryMetadata = Object.fromEntries(await Promise.all(['assetRegistry', 'usdg', 'collectorDeployer', 'implementationRegistry'].map(async (name) => [name, await client.readContract({ address: spec.collectorFactory, abi: factoryAbi, functionName: name, blockNumber })])));
    const codeHashes = Object.fromEntries(await Promise.all(Object.entries({ adapter: spec.adapter, core: orchestrator, manager: envelope.graph.manager, oracleFactory: envelope.graph.oracleFactory, locker: spec.locker, collectorFactory: spec.collectorFactory, collectorDeployer: spec.collectorDeployer, hookDeployer: spec.hookDeployer, registry }).map(async ([name, address]) => [name, keccak256(await client.getCode({ address, blockNumber }))])));
    const receipt = await client.getTransactionReceipt({ hash: spec.transactionHash });
    const preserved = broadcast.receipts.find(({ transactionHash }) => transactionHash === spec.transactionHash);
    assert.equal(receipt.status, 'success');
    equalHex(receipt.blockHash, preserved.blockHash);
    assert.equal(receipt.blockNumber, BigInt(preserved.blockNumber));
    equalHex(result.admissionBytes, admission.admissionBytes);
    equalHex(keccak256(stringToHex((await readFile(resolve(root, path, 'terms.json'), 'utf8')).trim())), config.termsDigest);
    const verificationPath = `${path}/verification/RwaRewardCollectorDeployerV1-${spec.collectorDeployer.toLowerCase()}`;
    const output = JSON.parse(await readFile(resolve(root, verificationPath, 'standard-output.json'), 'utf8'));
    const confirmed = JSON.parse(await readFile(resolve(root, verificationPath, 'etherscan-confirmation.json'), 'utf8'));
    assert.equal(confirmed.classification, 'FULL_VERIFIED');
    equalHex(confirmed.address, spec.collectorDeployer);
    const collectorAbi = output.contracts['src/launch/rwa/RwaRewardCollectorV1.sol'].RwaRewardCollectorV1.abi;
    const assetRegistryAbi = output.contracts['src/launch/rwa/RwaAssetRegistryV1.sol'].RwaAssetRegistryV1.abi;
    // Real, pinned eth_call against each deployed factory. Later local source is NOT authoritative.
    const token = '0x0000000000000000000000000000000000000010';
    const marketConfig = { version: 6, lpFeePips: 0, tickSpacing: 60, sqrtPriceX96: 1n << 96n,
      hookFeePips: 10000, minimumHookFeePips: 1000, feeSensitivityPipsSecondsPerTick: 7654321, feeMode: 1,
      protocolFeeDenominator: envelope.protocolFeeDenominator, treasury: envelope.protocolTreasury,
      externalLiquidityDisabled: false, oracleConfigId: keccak256(encodeAbiParameters([{ type: 'uint24' }, { type: 'uint16' }], [1, 4096])),
      hookSalt: zeroHash, profileId: spec.profileId, termsDigest: envelope.termsDigest, developerBeneficiary: envelope.beneficiary, developerFeeBps: 0,
      positions: [{ tickLower: 0, tickUpper: 887220, liquidity: 10n ** 20n, salt: zeroHash, maxTokenAmount: 10n ** 24n }] };
    const prefix = encodeAbiParameters([{ type: 'tuple', components: poolBoundV4LifecycleMarketComponentsV6 }], [marketConfig]);
    const market = { adapterId: spec.adapterId, profileId: spec.profileId, quoteAsset: RWA_QUOTE_ASSET, tokenBudget: 10n ** 24n, configVersion: 6, config: prefix };
    const checks = [];
    for (const { name, accepted, terms } of termCases) {
      const tail = rawTail(terms);
      const args = [spec.adapter, token, { ...market, config: concatHex([prefix, tail]) }];
      if (accepted) {
        const data = encodeFunctionData({ abi: factoryAbi, functionName: 'decodeAndValidate', args });
        const call = await client.call({ to: spec.collectorFactory, data, blockNumber });
        assert.ok(call.data && call.data.length > 2, name);
        checks.push({ name, terms, tail, accepted: true, result: call.data });
      } else {
        let rejection;
        try { await client.readContract({ address: spec.collectorFactory, abi: factoryAbi, functionName: 'decodeAndValidate', args, blockNumber }); }
        catch (error) { rejection = error.walk((cause) => cause.name === 'ContractFunctionRevertedError').data; }
        assert.equal(rejection?.errorName, 'InvalidRwaConfiguration', name);
        checks.push({ name, terms, tail, accepted: false, error: rejection.errorName });
      }
    }
    profiles.push({ variant: spec.variant, profileId: spec.profileId, adapterId: spec.adapterId, raw, chunks, adapterMetadata, factoryMetadata, codeHashes, config, terms, hookByteIdentity: identity, collectorAbi, assetRegistryAbi,
      termChecks: { token, market, checks }, abiProvenance: { path: `${verificationPath}/standard-output.json`, classification: confirmed.classification },
      admission: { path, envelopeBytes: admission.envelopeBytes, registrationBytes: admission.registrationBytes, envelopeHash: admission.envelopeHash, admissionBytes: result.admissionBytes, nonce: admission.nonce, deadline: admission.deadline, authorizationDigest: admission.authorizationDigest, payloadHash: result.payloadHash, transactionHash: spec.transactionHash, blockNumber: Number(receipt.blockNumber), blockHash: receipt.blockHash } });
  }
  evidence = { chainId: 4663, orchestrator, registry, sourceCommit: 'fde23bb', goLiveRecordCommit: '9af36c6', blockNumber: Number(blockNumber), blockHash: block.hash, assetRegistry, profiles };
} else evidence = JSON.parse(await readFile(evidenceUrl, 'utf8'));

assert.equal(evidence.chainId, 4663);
assert.ok(evidence.blockNumber > 0 && Number.isSafeInteger(evidence.blockNumber));
equalHex(evidence.registry, registry);
equalHex(evidence.orchestrator, orchestrator);
equalHex(evidence.assetRegistry.codeHash, assetRegistryCodeHash);
equalHex(`0x${evidence.assetRegistry.implementationSlot.slice(-40)}`, assetRegistryImplementation);
equalHex(evidence.assetRegistry.implementationCodeHash, assetRegistryImplementationCodeHash);
equalHex(evidence.assetRegistry.quoteAsset, RWA_QUOTE_ASSET);
assert.equal(evidence.profiles.length, specs.length);
const literal = (value, indent = 0) => {
  if (typeof value === 'bigint') return `${value}n`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  return `Object.freeze({\n${Object.entries(value).map(([key, item]) => `${' '.repeat(indent + 2)}${key}: ${literal(item, indent + 2)},`).join('\n')}\n${' '.repeat(indent)}})`;
};
const outputs = [];
for (const spec of specs) {
  const observed = evidence.profiles.find(({ variant }) => variant === spec.variant);
  const { profileEnvelope: envelope, adapter, profile: registration, profileTopology: topology } = decode(observed.raw);
  equalHex(observed.profileId, spec.profileId);
  equalHex(hashLifecycleProfile(envelope), spec.profileId);
  equalHex(observed.adapterId, spec.adapterId);
  equalHex(registration.adapterId, spec.adapterId);
  equalHex(adapter.implementation, spec.adapter);
  assert.equal(registration.enabled, true);
  assert.equal(adapter.enabled, true);
  for (const value of [adapter, topology, envelope]) assert.equal(value.configVersion, 6);
  assert.equal(topology.hookTopology, 2);
  assert.equal(envelope.maximumDeveloperFeeBps, 0);
  assert.equal(envelope.bounds.feeModeFlags, 2);
  equalHex(hashLaunchBounds(envelope.bounds), envelope.configBoundsDigest);
  equalHex(hashLaunchDependencies({ chainId: 4663n, core: orchestrator, registry, registrar: spec.adapter, graph: envelope.graph }), registration.dependencyDigest);
  for (const name of ['hookDeployer', 'locker', 'collectorFactory', 'collectorDeployer']) equalHex(envelope.graph[name], spec[name]);
  equalHex(topology.hookDeployer, spec.hookDeployer);
  equalHex(topology.hookCreationCodeHash, keccak256(spec.creationCode));
  equalHex(envelope.graph.hookCreationCodeHash, keccak256(spec.creationCode));
  const creationCode = concatHex(observed.chunks.map(({ address, runtime }, index) => {
    assert.equal(runtime.slice(0, 4), '0x00');
    equalHex(keccak256(runtime), envelope.graph[`codeChunk${index}Hash`]);
    equalHex(address, envelope.graph[`codeChunk${index}`]);
    return `0x${runtime.slice(4)}`;
  }));
  equalHex(creationCode, spec.creationCode);
  equalHex(adapter.codeHash, observed.codeHashes.adapter);
  equalHex(observed.codeHashes.registry, observed.config.registryCodehash);
  for (const name of ['core', 'manager', 'oracleFactory', 'locker', 'collectorFactory', 'collectorDeployer', 'hookDeployer']) equalHex(observed.codeHashes[name], envelope.graph[`${name}CodeHash`]);
  for (const name of ['artifactDigest', 'reviewManifestDigest', 'termsDigest', 'beneficiary']) equalHex(envelope[name], observed.config[name]);
  equalHex(observed.terms.artifactDigest, envelope.artifactDigest);
  equalHex(observed.terms.rwaAssetRegistry, RWA_ASSET_REGISTRY_ADDRESS);
  equalHex(observed.terms.rwaAssetRegistryCodehash, assetRegistryCodeHash);
  equalHex(observed.terms.usdg, RWA_QUOTE_ASSET);
  assert.equal(observed.hookByteIdentity.byteIdentical, true);
  equalHex(observed.hookByteIdentity.creationCodeHash, keccak256(spec.creationCode));
  const metadata = observed.adapterMetadata;
  for (const [name, expected] of Object.entries({ PROFILE_ID: spec.profileId, CONFIG_SCHEMA: registration.configSchema, core: orchestrator, implementationRegistry: registry, poolManager: envelope.graph.manager, oracleFactory: envelope.graph.oracleFactory, locker: spec.locker, collectorFactory: spec.collectorFactory, hookDeployer: spec.hookDeployer, dependencyDigest: registration.dependencyDigest })) equalHex(metadata[name], expected);
  assert.equal(metadata.CONFIG_VERSION, 6);
  for (const [name, expected] of Object.entries({ assetRegistry: RWA_ASSET_REGISTRY_ADDRESS, usdg: RWA_QUOTE_ASSET, collectorDeployer: spec.collectorDeployer, implementationRegistry: registry })) equalHex(observed.factoryMetadata[name], expected);
  // The SDK codec must produce the exact accepted tails and refuse every rejected one.
  assert.deepEqual(observed.termChecks.checks.map(({ name, accepted }) => [name, accepted]), termCases.map(({ name, accepted }) => [name, accepted]));
  for (const check of observed.termChecks.checks) {
    if (check.accepted) equalHex(encodeRwaLaunchTail({ ...check.terms, basket: check.terms.basket.map((asset) => getAddress(asset)) }), check.tail);
    else {
      assert.equal(check.error, 'InvalidRwaConfiguration');
      // Listing is a live registry fact the SDK does not pin; every static violation must refuse locally.
      if (check.name !== 'unlisted stock') assert.throws(() => encodeRwaLaunchTail(check.terms), { code: 'INVALID_RWA_CONFIG' });
    }
  }
  for (const [name, fields] of Object.entries(components)) equalHex(encodeAbiParameters([{ type: 'tuple', components: fields }], [decode(observed.raw)[name]]), observed.raw[name]);
  equalHex(encodeLaunchEnvelope(envelope), observed.admission.envelopeBytes);
  equalHex(observed.raw.profile, observed.admission.registrationBytes);
  equalHex(keccak256(concatHex([observed.raw.profile, observed.admission.envelopeBytes])), observed.admission.envelopeHash);
  equalHex(observed.admission.admissionBytes, concatHex([
    encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [registry, spec.profileId]), observed.raw.profile, observed.admission.envelopeBytes,
    encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }], [BigInt(observed.admission.nonce), BigInt(observed.admission.deadline), observed.admission.authorizationDigest]),
  ]));
  equalHex(keccak256(observed.admission.admissionBytes), observed.admission.payloadHash);
  const prefix = `rwa${spec.variant[0].toUpperCase()}${spec.variant.slice(1)}`;
  outputs.push([new URL(`../src/lifecycle/deployments/rwa-${spec.variant}-pool-v1-20261113.ts`, import.meta.url), `import type { LaunchEnvelopeV2, AdapterRegistrationV1, ProfileRegistrationV1, ProfileTopologyV1 } from "../schema.js";\n\n// Generated by scripts/generate-rwa-presets.mjs from admission and registry readback.\n// Robinhood block ${evidence.blockNumber}, ${evidence.blockHash}; admission ${spec.transactionHash}.\nexport const ${prefix}Envelope = ${literal(envelope)} satisfies LaunchEnvelopeV2;\nexport const ${prefix}Adapter = ${literal(adapter)} satisfies AdapterRegistrationV1;\nexport const ${prefix}Registration = ${literal(registration)} satisfies ProfileRegistrationV1;\nexport const ${prefix}Topology = ${literal(topology)} satisfies ProfileTopologyV1;\n`]);
}
assert.deepEqual(evidence.profiles[0].collectorAbi, evidence.profiles[1].collectorAbi);
assert.deepEqual(evidence.profiles[0].assetRegistryAbi, evidence.profiles[1].assetRegistryAbi);
const pick = (abi, names) => {
  const picked = abi.filter((entry) => names.includes(entry.name));
  assert.deepEqual([...new Set(picked.map(({ name }) => name))].sort(), [...names].sort());
  return picked;
};
const collectorNames = ['basket', 'weightBps', 'earmarked', 'totalEarmarked', 'pendingStock', 'shareBps', 'premiumBps', 'maxPriceAge', 'launchToken', 'quoteAsset', 'poolId', 'hub', 'registry',
  'maxFill', 'fill', 'forward', 'setShareBps', 'setPremiumBps', 'setMaxPriceAge', 'setWeights',
  'RwaFeesEarmarked', 'RwaAssetEarmarked', 'RwaFilled', 'RwaStockForwarded', 'RwaStockForwardSkipped', 'RwaShareUpdated', 'RwaPremiumUpdated', 'RwaMaxPriceAgeUpdated', 'RwaWeightsUpdated', 'RwaTermsInitialized',
  'Unauthorized', 'InvalidShare', 'InvalidPremium', 'InvalidWeights', 'UnsupportedAsset', 'InvalidRecipient', 'ZeroFill', 'InsufficientEarmark', 'SlippageExceeded', 'InexactTransfer'];
const registryNames = ['isListed', 'listedAssets', 'assetFeed', 'quoteFor', 'assetFor', 'quoteAsset', 'quoteFeed', 'quoteMaxStaleSeconds', 'quotePegBandBps', 'owner',
  'AssetSet', 'AssetRemoved', 'QuoteFeedSet', 'NotListed', 'InvalidPrice', 'StalePrice', 'QuoteDepegged', 'OraclePaused', 'InvalidPremium'];
outputs.push([new URL('../src/lifecycle/rwa-abi.ts', import.meta.url), `// Generated from the verified RWA collector/registry ABIs by scripts/generate-rwa-presets.mjs.\n// Provenance: test/fixtures/rwa-registry-readback.json, abiProvenance.\nexport const rwaRewardCollectorV1Abi = ${JSON.stringify(pick(evidence.profiles[0].collectorAbi, collectorNames), null, 2)} as const;\n\nexport const rwaAssetRegistryV1Abi = ${JSON.stringify(pick(evidence.profiles[0].assetRegistryAbi, registryNames), null, 2)} as const;\n`]);
if (capture) await writeFile(evidenceUrl, json(evidence));
for (const [url, content] of outputs) await writeFile(url, content);
console.log(`Generated RWA fixed/dynamic presets from pinned Robinhood block ${evidence.blockNumber} (${evidence.blockHash}); ${termCases.length} deployed term checks per variant verified by eth_call`);
