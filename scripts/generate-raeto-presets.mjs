// Read-only capture: node --experimental-transform-types scripts/generate-raeto-presets.mjs --readback /path/to/black-market
// Offline regeneration: node --experimental-transform-types scripts/generate-raeto-presets.mjs
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { concatHex, createPublicClient, decodeAbiParameters, encodeAbiParameters, encodeFunctionData, http, keccak256, parseAbi, stringToHex, zeroHash } from 'viem';
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
const { RAETO_FIXED_PROFILE_ID, RAETO_DYNAMIC_PROFILE_ID, RAETO_FIXED_ADAPTER_ID, RAETO_DYNAMIC_ADAPTER_ID, RAETO_PAYOUT_REGISTRY_ADDRESS, RAETO_SHARE_BPS_OPTIONS, RAETO_QUOTE_ASSETS } = await import('../src/lifecycle/raeto.ts');

const capture = process.argv.includes('--readback');
const root = process.argv.slice(2).find((arg) => arg !== '--readback');
if (capture && !root) throw new Error('Pass the read-only protocol checkout path');
const evidenceUrl = new URL('../test/fixtures/raeto-registry-readback.json', import.meta.url);
const registry = '0xB2B0f9F36617810D67b8fC175153Aa10024C1358';
const orchestrator = '0x91560876033d568d25CDe98C78c33ff8FC43962c';
const specs = [
  { variant: 'fixed', directory: '20261029T065911Z-raeto-fixed', profileId: RAETO_FIXED_PROFILE_ID, adapterId: RAETO_FIXED_ADAPTER_ID, adapter: '0x995Da3cB2b643A9D986f28179F62511BE8757e58', collectorFactory: '0xb2f84D9f31cBCfA75E998852B1dCcF176BeaAeDC', collectorDeployer: '0xb07558776a71C0b58779F1CAF89775d8E466c173', locker: '0x12985Fa618974b45a5de8fA40c1DE90d15E9c5c8', hookDeployer: '0xfdB07076Cab21715244Bc9699A381b4F461157ea', creationCode: fixedFeePoolHookV1CreationCode, transactionHash: '0x99089e4418bcf59fc4a2efb5dd36c95f92331a079401dcfaae36d1c94a08326a' },
  { variant: 'dynamic', directory: '20261029T070544Z-raeto-dynamic', profileId: RAETO_DYNAMIC_PROFILE_ID, adapterId: RAETO_DYNAMIC_ADAPTER_ID, adapter: '0xfc1502090D8326AB9b70aa93a01c93bEBb6f4910', collectorFactory: '0x3E201A0d72221A9F8c0AEd06EdAE850E27226166', collectorDeployer: '0x796E8899824999f6Da8740f712A709dBC65cbEd7', locker: '0xBF9005094bDa89d5a119A324d6e609A2d8217C1C', hookDeployer: '0x788B88e46BE3051633792896F3000eb2CA57F97E', creationCode: dynamicFeePoolHookV1CreationCode, transactionHash: '0x3148a6696c36bb1de00f8142b2aa6480681ded86203ffa6486a44c4e985c3b31' },
];
const components = { profileEnvelope: launchEnvelopeV2Components, adapter: adapterRegistrationV1Components, profile: profileRegistrationV1Components, profileTopology: profileTopologyV1Components };
const registryAbi = Object.entries(components).map(([name, fields]) => ({ type: 'function', name, stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'tuple', components: fields }] }));
const adapterAbi = parseAbi([
  'function PROFILE_ID() view returns (bytes32)', 'function CONFIG_SCHEMA() view returns (bytes32)',
  'function CONFIG_VERSION() view returns (uint32)', 'function dependencyDigest() view returns (bytes32)',
  ...['core', 'implementationRegistry', 'poolManager', 'oracleFactory', 'locker', 'collectorFactory', 'hookDeployer'].map((name) => `function ${name}() view returns (address)`),
]);
const factoryAbi = [...poolFeeCollectorFactoryConfigV6Abi, ...parseAbi([
  ...['payoutRegistry', 'weth', 'usdg', 'collectorDeployer', 'implementationRegistry'].map((name) => `function ${name}() view returns (address)`),
  'error InvalidRaetoConfiguration()',
])];
const json = (value) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n';
const equalHex = (actual, expected) => assert.equal(actual.toLowerCase(), expected.toLowerCase());
const decode = (raw) => Object.fromEntries(Object.entries(components).map(([name, fields]) => [name, decodeAbiParameters([{ type: 'tuple', components: fields }], raw[name])[0]]));
let evidence;
if (capture) {
  const client = createPublicClient({ transport: http('https://rpc.mainnet.chain.robinhood.com/') });
  assert.equal(await client.getChainId(), 4663);
  const block = await client.getBlock(), blockNumber = block.number;
  const profiles = [];
  for (const spec of specs) {
    const path = `contracts/deployments/launch/raeto/${spec.directory}`;
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
    const factoryMetadata = Object.fromEntries(await Promise.all(['payoutRegistry', 'weth', 'usdg', 'collectorDeployer', 'implementationRegistry'].map(async (name) => [name, await client.readContract({ address: spec.collectorFactory, abi: factoryAbi, functionName: name, blockNumber })])));
    const codeHashes = Object.fromEntries(await Promise.all(Object.entries({ adapter: spec.adapter, core: orchestrator, manager: envelope.graph.manager, oracleFactory: envelope.graph.oracleFactory, locker: spec.locker, collectorFactory: spec.collectorFactory, collectorDeployer: spec.collectorDeployer, hookDeployer: spec.hookDeployer, registry, payoutRegistry: RAETO_PAYOUT_REGISTRY_ADDRESS }).map(async ([name, address]) => [name, keccak256(await client.getCode({ address, blockNumber }))])));
    const receipt = await client.getTransactionReceipt({ hash: spec.transactionHash });
    const preserved = broadcast.receipts.find(({ transactionHash }) => transactionHash === spec.transactionHash);
    assert.equal(receipt.status, 'success');
    equalHex(receipt.blockHash, preserved.blockHash);
    assert.equal(receipt.blockNumber, BigInt(preserved.blockNumber));
    equalHex(result.admissionBytes, admission.admissionBytes);
    equalHex(keccak256(stringToHex((await readFile(resolve(root, path, 'terms.json'), 'utf8')).trim())), config.termsDigest);
    const verificationPath = `${path}/verification/RaetoFeeCollectorDeployerV1-${spec.collectorDeployer.toLowerCase()}`;
    const output = JSON.parse(await readFile(resolve(root, verificationPath, 'standard-output.json'), 'utf8'));
    const confirmed = JSON.parse(await readFile(resolve(root, verificationPath, 'etherscan-confirmation.json'), 'utf8'));
    assert.equal(confirmed.classification, 'FULL_VERIFIED');
    equalHex(confirmed.address, spec.collectorDeployer);
    const collectorAbi = output.contracts['src/launch/raeto/RaetoFeeCollectorV1.sol'].RaetoFeeCollectorV1.abi;
    // Real, pinned eth_call against each deployed factory. Later local source is NOT authoritative.
    const token = '0x0000000000000000000000000000000000000010';
    const marketConfig = { version: 6, lpFeePips: 0, tickSpacing: 60, sqrtPriceX96: 1n << 96n,
      hookFeePips: 10000, minimumHookFeePips: 1000, feeSensitivityPipsSecondsPerTick: 7654321, feeMode: 1,
      protocolFeeDenominator: envelope.protocolFeeDenominator, treasury: envelope.protocolTreasury,
      externalLiquidityDisabled: false, oracleConfigId: keccak256(encodeAbiParameters([{ type: 'uint24' }, { type: 'uint16' }], [1, 4096])),
      hookSalt: zeroHash, profileId: spec.profileId, termsDigest: envelope.termsDigest, developerBeneficiary: envelope.beneficiary, developerFeeBps: 0,
      positions: [{ tickLower: 0, tickUpper: 887220, liquidity: 10n ** 20n, salt: zeroHash, maxTokenAmount: 10n ** 24n }] };
    const prefix = encodeAbiParameters([{ type: 'tuple', components: poolBoundV4LifecycleMarketComponentsV6 }], [marketConfig]);
    const market = { adapterId: spec.adapterId, profileId: spec.profileId, quoteAsset: RAETO_QUOTE_ASSETS[0], tokenBudget: 10n ** 24n, configVersion: 6, config: prefix };
    const shareChecks = [];
    for (const shareBps of [...RAETO_SHARE_BPS_OPTIONS, 0, 499, 1234, 8000, 10000]) {
      const config = concatHex([prefix, encodeAbiParameters([{ type: 'uint16' }], [shareBps])]);
      const args = [spec.adapter, token, { ...market, config }];
      if (RAETO_SHARE_BPS_OPTIONS.includes(shareBps)) {
        const data = encodeFunctionData({ abi: factoryAbi, functionName: 'decodeAndValidate', args });
        const result = await client.call({ to: spec.collectorFactory, data, blockNumber });
        assert.ok(result.data && result.data.length > 2);
        shareChecks.push({ shareBps, accepted: true, result: result.data });
      } else {
        let rejection;
        try { await client.readContract({ address: spec.collectorFactory, abi: factoryAbi, functionName: 'decodeAndValidate', args, blockNumber }); }
        catch (error) { rejection = error.walk((cause) => cause.name === 'ContractFunctionRevertedError').data; }
        assert.equal(rejection?.errorName, 'InvalidRaetoConfiguration');
        shareChecks.push({ shareBps, accepted: false, error: rejection.errorName });
      }
    }
    profiles.push({ variant: spec.variant, profileId: spec.profileId, adapterId: spec.adapterId, raw, chunks, adapterMetadata, factoryMetadata, codeHashes, config, terms, hookByteIdentity: identity, collectorAbi,
      shareChecks: { token, market, checks: shareChecks }, abiProvenance: { path: `${verificationPath}/standard-output.json`, classification: confirmed.classification },
      admission: { path, envelopeBytes: admission.envelopeBytes, registrationBytes: admission.registrationBytes, envelopeHash: admission.envelopeHash, admissionBytes: result.admissionBytes, nonce: admission.nonce, deadline: admission.deadline, authorizationDigest: admission.authorizationDigest, payloadHash: result.payloadHash, transactionHash: spec.transactionHash, blockNumber: Number(receipt.blockNumber), blockHash: receipt.blockHash } });
  }
  evidence = { chainId: 4663, orchestrator, registry, sourceCommit: 'a39c958', goLiveRecordCommit: '02e5cf3', blockNumber: Number(blockNumber), blockHash: block.hash, profiles };
} else evidence = JSON.parse(await readFile(evidenceUrl, 'utf8'));

assert.equal(evidence.chainId, 4663);
assert.ok(evidence.blockNumber > 0 && Number.isSafeInteger(evidence.blockNumber));
equalHex(evidence.registry, registry);
equalHex(evidence.orchestrator, orchestrator);
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
  equalHex(observed.terms.raetoPayoutRegistry, RAETO_PAYOUT_REGISTRY_ADDRESS);
  assert.equal(observed.hookByteIdentity.byteIdentical, true);
  equalHex(observed.hookByteIdentity.creationCodeHash, keccak256(spec.creationCode));
  const metadata = observed.adapterMetadata;
  for (const [name, expected] of Object.entries({ PROFILE_ID: spec.profileId, CONFIG_SCHEMA: registration.configSchema, core: orchestrator, implementationRegistry: registry, poolManager: envelope.graph.manager, oracleFactory: envelope.graph.oracleFactory, locker: spec.locker, collectorFactory: spec.collectorFactory, hookDeployer: spec.hookDeployer, dependencyDigest: registration.dependencyDigest })) equalHex(metadata[name], expected);
  assert.equal(metadata.CONFIG_VERSION, 6);
  for (const [name, expected] of Object.entries({ payoutRegistry: RAETO_PAYOUT_REGISTRY_ADDRESS, weth: RAETO_QUOTE_ASSETS[0], usdg: RAETO_QUOTE_ASSETS[1], collectorDeployer: spec.collectorDeployer, implementationRegistry: registry })) equalHex(observed.factoryMetadata[name], expected);
  assert.deepEqual(observed.shareChecks.checks.filter(({ accepted }) => accepted).map(({ shareBps }) => shareBps), [...RAETO_SHARE_BPS_OPTIONS]);
  assert.deepEqual(observed.shareChecks.checks.filter(({ accepted }) => !accepted).map(({ shareBps, error }) => [shareBps, error]), [0, 499, 1234, 8000, 10000].map((share) => [share, 'InvalidRaetoConfiguration']));
  for (const [name, fields] of Object.entries(components)) equalHex(encodeAbiParameters([{ type: 'tuple', components: fields }], [decode(observed.raw)[name]]), observed.raw[name]);
  equalHex(encodeLaunchEnvelope(envelope), observed.admission.envelopeBytes);
  equalHex(observed.raw.profile, observed.admission.registrationBytes);
  equalHex(keccak256(concatHex([observed.raw.profile, observed.admission.envelopeBytes])), observed.admission.envelopeHash);
  equalHex(observed.admission.admissionBytes, concatHex([
    encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [registry, spec.profileId]), observed.raw.profile, observed.admission.envelopeBytes,
    encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }], [BigInt(observed.admission.nonce), BigInt(observed.admission.deadline), observed.admission.authorizationDigest]),
  ]));
  equalHex(keccak256(observed.admission.admissionBytes), observed.admission.payloadHash);
  const prefix = `raeto${spec.variant[0].toUpperCase()}${spec.variant.slice(1)}`;
  outputs.push([new URL(`../src/lifecycle/deployments/raeto-${spec.variant}-pool-v1-20261029.ts`, import.meta.url), `import type { LaunchEnvelopeV2, AdapterRegistrationV1, ProfileRegistrationV1, ProfileTopologyV1 } from "../schema.js";\n\n// Generated by scripts/generate-raeto-presets.mjs from admission and registry readback.\n// Robinhood block ${evidence.blockNumber}, ${evidence.blockHash}; admission ${spec.transactionHash}.\nexport const ${prefix}Envelope = ${literal(envelope)} satisfies LaunchEnvelopeV2;\nexport const ${prefix}Adapter = ${literal(adapter)} satisfies AdapterRegistrationV1;\nexport const ${prefix}Registration = ${literal(registration)} satisfies ProfileRegistrationV1;\nexport const ${prefix}Topology = ${literal(topology)} satisfies ProfileTopologyV1;\n`]);
}
assert.deepEqual(evidence.profiles[0].collectorAbi, evidence.profiles[1].collectorAbi);
const abiNames = ['shareBps', 'owed', 'claimRaeto', 'setShareBps', 'launchToken', 'quoteAsset', 'RaetoShareUpdated', 'RaetoFeesBooked', 'RaetoFeesClaimed'];
const collectorAbi = evidence.profiles[0].collectorAbi.filter(({ name }) => abiNames.includes(name));
assert.equal(collectorAbi.length, abiNames.length);
outputs.push([new URL('../src/lifecycle/raeto-abi.ts', import.meta.url), `// Generated from the verified RaetoFeeCollectorV1 ABI by scripts/generate-raeto-presets.mjs.\n// Provenance: test/fixtures/raeto-registry-readback.json, abiProvenance.\nexport const raetoFeeCollectorV1Abi = ${JSON.stringify(collectorAbi, null, 2)} as const;\n`]);
if (capture) await writeFile(evidenceUrl, json(evidence));
for (const [url, content] of outputs) await writeFile(url, content);
console.log(`Generated Raeto fixed/dynamic presets from pinned Robinhood block ${evidence.blockNumber} (${evidence.blockHash}); deployed share menu verified by eth_call`);
