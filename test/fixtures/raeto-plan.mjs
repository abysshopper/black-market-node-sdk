import { encodeAbiParameters, keccak256, toHex, zeroHash } from 'viem';
import * as sdk from '../../dist/lifecycle/index.js';

export const identity = { chainId: 4663n, orchestrator: '0x91560876033d568d25CDe98C78c33ff8FC43962c' };
export const keys = [sdk.KnownLifecycleProfile.V4RaetoFixedPool, sdk.KnownLifecycleProfile.V4RaetoDynamicPool];
export const testToken = '0x0000000000000000000000000000000000000010';
export function makeRaetoPlan(key, { shareBps = 500, quote = sdk.RAETO_QUOTE_ASSETS[0], token = testToken } = {}) {
  const preset = sdk.getKnownLifecycleProfile({ ...identity, key });
  const envelope = preset.profile.envelope;
  const supply = 1_000_000n * 10n ** 18n;
  const creator = '0x00000000000000000000000000000000000000a0';
  const config = { version: 6, lpFeePips: 0, tickSpacing: 60, sqrtPriceX96: 1n << 96n,
    hookFeePips: 10000, minimumHookFeePips: 1000, feeSensitivityPipsSecondsPerTick: 7654321, feeMode: 1,
    protocolFeeDenominator: envelope.protocolFeeDenominator, treasury: envelope.protocolTreasury,
    externalLiquidityDisabled: false,
    oracleConfigId: keccak256(encodeAbiParameters([{ type: 'uint24' }, { type: 'uint16' }], [1, 4096])),
    hookSalt: zeroHash, profileId: preset.profile.id, termsDigest: envelope.termsDigest,
    developerBeneficiary: envelope.beneficiary, developerFeeBps: 0,
    positions: [{ tickLower: BigInt(token) < BigInt(quote) ? 0 : -887220, tickUpper: BigInt(token) < BigInt(quote) ? 887220 : 0,
      liquidity: 10n ** 20n, salt: zeroHash, maxTokenAmount: supply }], raetoLaunchConfig: { shareBps } };
  const market = { adapterId: preset.profile.registration.adapterId, profileId: preset.profile.id,
    quoteAsset: quote, tokenBudget: supply, configVersion: 6, config: sdk.encodePoolBoundV4LifecycleMarketConfig(config) };
  const plan = { ...identity, creator, nonce: BigInt(2026102900 + keys.indexOf(key)),
    token: { kind: 0, rewardMode: 0, name: 'Raeto SDK planning', symbol: 'RAETO', supply, nftUnit: 0n,
      metadataURI: '', salt: toHex(20261029n, { size: 32 }), inventoryRecipient: creator, burnOnCancel: true },
    funding: [], feeAssets: [
      { asset: token, ownerBps: 0, rewardsBps: 0, burnBps: 10000 },
      { asset: quote, ownerBps: 10000, rewardsBps: 0, burnBps: 0 },
    ].sort((a, b) => BigInt(a.asset) < BigInt(b.asset) ? -1 : 1),
    markets: [market], buys: [], deadline: 2000000000n, executorFeeBps: 0 };
  return { plan, config, preset };
}
