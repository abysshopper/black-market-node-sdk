import { readFile } from 'node:fs/promises';
import { encodeAbiParameters, keccak256, toHex, zeroHash } from 'viem';
import * as sdk from '../../dist/lifecycle/index.js';

export const identity = { chainId: 4663n, orchestrator: '0x91560876033d568d25CDe98C78c33ff8FC43962c' };
export const keys = [sdk.KnownLifecycleProfile.V4RwaFixedPool, sdk.KnownLifecycleProfile.V4RwaDynamicPool];
export const testToken = '0x0000000000000000000000000000000000000010';
export const evidence = JSON.parse(await readFile(new URL('./rwa-registry-readback.json', import.meta.url), 'utf8'));
/** Registry-listed stocks at the pinned readback block, ascending. */
export const listedStocks = [...evidence.assetRegistry.listedAssets].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
export const rwaTerms = (size = 2) => {
  const basket = listedStocks.slice(0, size);
  return { shareBps: 2500, premiumBps: 50, maxPriceAge: 0, basket,
    weightsBps: basket.map((_, i) => Math.floor(10000 / size) + (i === 0 ? 10000 % size : 0)) };
};

/** Dividends launch: token fees to the owner, USDG split, every basket stock 100% to holders. */
export function makeRwaPlan(key, { terms = rwaTerms(), token = testToken } = {}) {
  const preset = sdk.getKnownLifecycleProfile({ ...identity, key });
  const envelope = preset.profile.envelope;
  const quote = sdk.RWA_QUOTE_ASSET;
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
      liquidity: 10n ** 20n, salt: zeroHash, maxTokenAmount: supply }], rwaLaunchConfig: terms };
  const market = { adapterId: preset.profile.registration.adapterId, profileId: preset.profile.id,
    quoteAsset: quote, tokenBudget: supply, configVersion: 6, config: sdk.encodePoolBoundV4LifecycleMarketConfig(config) };
  const plan = { ...identity, creator, nonce: BigInt(2026111300 + keys.indexOf(key)),
    token: { kind: 0, rewardMode: sdk.LifecycleRewardMode.Dividends, name: 'RWA SDK planning', symbol: 'RWA', supply, nftUnit: 0n,
      metadataURI: '', salt: toHex(20261113n, { size: 32 }), inventoryRecipient: creator, burnOnCancel: true },
    funding: [], feeAssets: [
      { asset: token, ownerBps: 10000, rewardsBps: 0, burnBps: 0 },
      { asset: quote, ownerBps: 5000, rewardsBps: 5000, burnBps: 0 },
      ...terms.basket.map((asset) => ({ asset, ownerBps: 0, rewardsBps: 10000, burnBps: 0 })),
    ].sort((a, b) => BigInt(a.asset) < BigInt(b.asset) ? -1 : 1),
    markets: [market], buys: [], deadline: 2000000000n, executorFeeBps: 0 };
  return { plan, config, preset };
}
