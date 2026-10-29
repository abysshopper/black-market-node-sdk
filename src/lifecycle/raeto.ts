import { encodeAbiParameters, type Hex } from "viem";
import { decodePoolBoundV4LifecycleMarketConfig } from "./markets.js";
import type { LaunchPlanV1 } from "./schema.js";
import { LifecyclePlanningError } from "./types.js";

export const RAETO_FIXED_PROFILE_ID: Hex = "0x9161833b162e7ca8160b11c64aedb307561e19a9136fd32f99cd797aab6da3ca";
export const RAETO_DYNAMIC_PROFILE_ID: Hex = "0x08387d00ee4f75f860810cc8fb434087328592c2f39ea3321109e589039f80e1";
export const RAETO_FIXED_ADAPTER_ID: Hex = "0x911d7ecefe56489d329235e3484829717dc00400d4181902f0f2de45f9338615";
export const RAETO_DYNAMIC_ADAPTER_ID: Hex = "0x8ab9c8c9b8fd4c8bbf12b780d9474463fa0fa52e3b450f0d5f68fd067dc1674d";
export const RAETO_PAYOUT_REGISTRY_ADDRESS = "0xBEC2C0e91612090F82df6743F31CDF18B4386b50";
/** The deployed collectors accept this menu, not the wider range in later source. */
export const RAETO_SHARE_BPS_OPTIONS = Object.freeze([500, 1000, 2500, 5000, 7500] as const);
export const RAETO_QUOTE_ASSETS = Object.freeze([
  "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
] as const);
export type RaetoLaunchConfigV1 = { shareBps: number };

export function isRaetoProfile(profileId: Hex): boolean {
  const id = profileId.toLowerCase();
  return id === RAETO_FIXED_PROFILE_ID || id === RAETO_DYNAMIC_PROFILE_ID;
}

export function validateRaetoLaunchConfig(config: RaetoLaunchConfigV1): void {
  if (!RAETO_SHARE_BPS_OPTIONS.some((share) => share === config.shareBps)) {
    throw new LifecyclePlanningError("INVALID_RAETO_CONFIG", "Raeto shareBps must be one of 500, 1000, 2500, 5000 or 7500");
  }
}

/** Exactly abi.encode(RaetoLaunchConfigV1): one static uint16 word. */
export function encodeRaetoLaunchTail(config: RaetoLaunchConfigV1): Hex {
  validateRaetoLaunchConfig(config);
  return encodeAbiParameters([{ type: "uint16" }], [config.shareBps]);
}

export function decodeRaetoLaunchTail(encoded: Hex): RaetoLaunchConfigV1 {
  if (!/^0x[0-9a-fA-F]{64}$/.test(encoded)) throw new LifecyclePlanningError("INVALID_RAETO_CONFIG", "Raeto tail must be exactly one ABI word");
  const share = BigInt(encoded);
  if (share > 65535n) throw new LifecyclePlanningError("INVALID_RAETO_CONFIG", "Raeto tail must contain a canonical uint16");
  const config = { shareBps: Number(share) };
  validateRaetoLaunchConfig(config);
  return config;
}

/** Raeto uses the normal lifecycle creator/funding route, not the UFG proxy. */
export function validateRaetoLaunchPlan(plan: LaunchPlanV1): void {
  try {
    if (plan.markets.length === 0) throw new Error("A Raeto plan requires at least one market");
    for (const market of plan.markets) {
      if (!isRaetoProfile(market.profileId) || market.configVersion !== 6 ||
        !RAETO_QUOTE_ASSETS.some((quote) => quote.toLowerCase() === market.quoteAsset.toLowerCase()) ||
        market.adapterId.toLowerCase() !== (market.profileId.toLowerCase() === RAETO_FIXED_PROFILE_ID ? RAETO_FIXED_ADAPTER_ID : RAETO_DYNAMIC_ADAPTER_ID)) {
        throw new Error("Every Raeto market requires its Raeto config6 profile/adapter and a WETH or USDG quote");
      }
      const config = decodePoolBoundV4LifecycleMarketConfig(market.config, 6);
      if (config.profileId.toLowerCase() !== market.profileId.toLowerCase()) throw new Error("Raeto config profile differs from its market");
    }
  } catch (error) {
    throw new LifecyclePlanningError("INVALID_RAETO_PLAN", error instanceof Error ? error.message : "Invalid Raeto launch plan");
  }
}
