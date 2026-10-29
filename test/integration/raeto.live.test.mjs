// Read-only: node --test test/integration/raeto.live.test.mjs (after pnpm build).
// No wallet, key, state override or chain writes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { concatHex, createPublicClient, encodeAbiParameters, http, keccak256, parseAbi } from 'viem';
import * as sdk from '../../dist/lifecycle/index.js';
import { deriveKnownPoolBoundHookDeployment } from '../../dist/lifecycle/calibration.js';
import { keys, makeRaetoPlan } from '../fixtures/raeto-plan.mjs';

const client = createPublicClient({ transport: http('https://rpc.mainnet.chain.robinhood.com/') });
assert.equal(await client.getChainId(), 4663);
const factoryAbi = [...sdk.poolFeeCollectorFactoryConfigV6Abi, ...parseAbi(['error InvalidRaetoConfiguration()'])];
for (const key of keys) for (const quote of sdk.RAETO_QUOTE_ASSETS) test(`${key} / ${quote}: deployed factory agrees with the SDK and five-share menu`, async () => {
  const block = await client.getBlock();
  const draft = makeRaetoPlan(key, { quote });
  const token = await client.readContract({ address: draft.plan.orchestrator, abi: sdk.launchLifecycleAbi, functionName: 'predictToken', args: [draft.plan], blockNumber: block.number });
  const { config, plan, preset } = makeRaetoPlan(key, { quote, token });
  const known = deriveKnownPoolBoundHookDeployment({ plan, marketIndex: 0, token });
  const mined = await sdk.minePoolBoundHookSalt({ deployer: known.deployment.deployer, initCodeHash: known.deployment.initCodeHash });
  const finalized = { ...config, hookSalt: mined.salt };
  const market = { ...plan.markets[0], config: sdk.encodePoolBoundV4LifecycleMarketConfig(finalized) };
  const address = preset.profile.envelope.graph.collectorFactory;
  const args = [preset.boundHook.registrar, token, market];
  const [metadata, parameters, adapterMetadata, factoryCode, adapterCode] = await Promise.all([
    client.readContract({ address, abi: factoryAbi, functionName: 'poolBoundDeploymentMetadata', args, blockNumber: block.number }),
    client.readContract({ address, abi: factoryAbi, functionName: 'poolBoundHookParameters', args, blockNumber: block.number }),
    client.readContract({ address: preset.boundHook.registrar, abi: sdk.poolMarketAdapterV1Abi, functionName: 'hookDeploymentMetadata', args: [token, market], blockNumber: block.number }),
    client.getCode({ address, blockNumber: block.number }), client.getCode({ address: preset.boundHook.registrar, blockNumber: block.number }),
  ]);
  assert.equal(keccak256(factoryCode), preset.profile.envelope.graph.collectorFactoryCodeHash);
  assert.equal(keccak256(adapterCode), preset.profile.adapter.codeHash);
  assert.deepEqual(metadata, [known.deployment.deployer, known.deployment.initCodeHash, mined.salt, mined.predictedHook]);
  assert.deepEqual(adapterMetadata, metadata);
  assert.equal(sdk.encodePoolBoundHookParameters(parameters[0], 6), sdk.encodePoolBoundHookParameters(known.parameters, 6));
  assert.equal(parameters[1], mined.salt);
  const { minimumHookFeePips, feeSensitivityPipsSecondsPerTick, hookSalt, raetoLaunchConfig, ...shared } = finalized;
  for (const shareBps of sdk.RAETO_SHARE_BPS_OPTIONS) {
    const changedMarket = { ...market, config: sdk.encodePoolBoundV4LifecycleMarketConfig({ ...finalized, raetoLaunchConfig: { shareBps } }) };
    const args = [preset.boundHook.registrar, token, changedMarket];
    const [decoded, changed] = await Promise.all([
      client.readContract({ address, abi: factoryAbi, functionName: 'decodeAndValidate', args, blockNumber: block.number }),
      client.readContract({ address, abi: factoryAbi, functionName: 'poolBoundDeploymentMetadata', args, blockNumber: block.number }),
    ]);
    assert.deepEqual(decoded, shared);
    assert.equal(changed[1], metadata[1], 'Raeto shares are collector state, not hook-constructor economics');
  }
  const prefix = (config) => encodeAbiParameters([{ type: 'tuple', components: sdk.poolBoundV4LifecycleMarketComponentsV6 }], [config]);
  for (const shareBps of [0, 499, 1234, 8000, 10000]) {
    const invalid = concatHex([prefix(finalized), encodeAbiParameters([{ type: 'uint16' }], [shareBps])]);
    await assert.rejects(client.readContract({ address, abi: factoryAbi, functionName: 'decodeAndValidate', args: [preset.boundHook.registrar, token, { ...market, config: invalid }], blockNumber: block.number }),
      (error) => error.walk((cause) => cause.name === 'ContractFunctionRevertedError').data?.errorName === 'InvalidRaetoConfiguration');
  }
  for (const config of [{ ...finalized, feeMode: 0 }, { ...finalized, lpFeePips: 1 }, { ...finalized, developerFeeBps: 1 }]) {
    await assert.rejects(client.readContract({ address, abi: factoryAbi, functionName: 'decodeAndValidate', args: [preset.boundHook.registrar, token, { ...market, config: concatHex([prefix(config), sdk.encodeRaetoLaunchTail({ shareBps: 500 })]) }], blockNumber: block.number }));
  }
  await assert.rejects(client.readContract({ address, abi: factoryAbi, functionName: 'decodeAndValidate', args: [preset.boundHook.registrar, token, { ...market, quoteAsset: token }], blockNumber: block.number }));
  console.log(JSON.stringify({ key, quote, blockNumber: block.number.toString(), blockHash: block.hash, token, predictedHook: mined.predictedHook,
    initCodeHash: known.deployment.initCodeHash, acceptedShares: sdk.RAETO_SHARE_BPS_OPTIONS, rejectedShares: [0, 499, 1234, 8000, 10000] }));
});
