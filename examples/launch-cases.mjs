import { AbyssPoolProfile, TokenKind } from "../dist/index.js";

const none = Object.freeze({ ownerBps: 0, rewardsBps: 0, burnBps: 0 });
const split = (ownerBps, rewardsBps, burnBps) => Object.freeze({ ownerBps, rewardsBps, burnBps });

/**
 * All current 1%-fee launch template/profile combinations. Each case is runnable
 * through either active route. Lighthouse is QuoteOracle; dual templates are
 * Beacon-only by their registered template policy, so their V4 companion pool
 * is Beacon rather than Lighthouse.
 */
const BASE_LAUNCH_CASES = [
  { id: "standard-lighthouse", template: "standard", profile: AbyssPoolProfile.QuoteOracle, launched: none, paired: split(10_000, 0, 0) },
  { id: "standard-beacon", template: "standard", profile: AbyssPoolProfile.StandardOracle, launched: split(10_000, 0, 0), paired: split(10_000, 0, 0) },
  { id: "quote-staking-owner", template: "quote-staking", profile: AbyssPoolProfile.QuoteOracle, launched: none, paired: split(8_000, 2_000, 0) },
  { id: "quote-staking-rewards", template: "quote-staking", profile: AbyssPoolProfile.QuoteOracle, launched: none, paired: split(2_000, 8_000, 0) },
  { id: "quote-dividends-owner", template: "quote-dividends", profile: AbyssPoolProfile.QuoteOracle, launched: none, paired: split(2_000, 8_000, 0) },
  { id: "quote-dividends-even", template: "quote-dividends", profile: AbyssPoolProfile.QuoteOracle, launched: none, paired: split(5_000, 5_000, 0) },
  { id: "dual-staking-balanced", template: "dual-staking", profile: AbyssPoolProfile.StandardOracle, launched: split(1_000, 6_000, 3_000), paired: split(3_000, 7_000, 0) },
  { id: "dual-staking-burn", template: "dual-staking", profile: AbyssPoolProfile.StandardOracle, launched: split(0, 6_000, 4_000), paired: split(1_000, 9_000, 0) },
  { id: "dual-dividends-balanced", template: "dual-dividends", profile: AbyssPoolProfile.StandardOracle, launched: split(0, 7_000, 3_000), paired: split(2_000, 8_000, 0) },
  { id: "dual-dividends-owner", template: "dual-dividends", profile: AbyssPoolProfile.StandardOracle, launched: split(1_500, 8_500, 0), paired: split(5_000, 5_000, 0) },
  { id: "fee-burn-lighthouse", template: "fee-burn", profile: AbyssPoolProfile.QuoteOracle, launched: split(0, 0, 10_000), paired: none },
];
const HOLDER_DIVIDEND_CAPABILITY_TEMPLATES = new Set(["standard", "quote-staking", "dual-staking", "fee-burn"]);
export const LAUNCH_CASES = Object.freeze(BASE_LAUNCH_CASES.flatMap((launchCase) => {
  const tokenKinds = HOLDER_DIVIDEND_CAPABILITY_TEMPLATES.has(launchCase.template)
    ? [TokenKind.Burnable, TokenKind.HolderDividend]
    : [TokenKind.HolderDividend];
  return tokenKinds.map((tokenKind) => ({ ...launchCase, id: `${launchCase.id}-${tokenKind === TokenKind.Burnable ? "burnable" : "dividend"}`, tokenKind }));
}));
export function getLaunchCase(id) {
  const launchCase = LAUNCH_CASES.find((candidate) => candidate.id === id);
  if (!launchCase) throw new Error(`Unknown launch case: ${id}`);
  return launchCase;
}
