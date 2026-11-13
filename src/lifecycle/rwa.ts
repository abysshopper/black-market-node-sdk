import { decodeAbiParameters, encodeAbiParameters, getAddress, isAddress, type Address, type Hex } from "viem";
import { decodePoolBoundV4LifecycleMarketConfig } from "./markets.js";
import { LifecycleRewardMode, type LaunchPlanV1, type MarketConfigV1 } from "./schema.js";
import { LifecyclePlanningError } from "./types.js";

export const RWA_FIXED_PROFILE_ID: Hex = "0x3b170b03f1ff1c808970f43827df234cde866d73608b6e3e3937601ae7c8676b";
export const RWA_DYNAMIC_PROFILE_ID: Hex = "0xab6c24038ff6ec16a300aa268dc4116f1649ae07c272dfc7e814c6f198515043";
export const RWA_FIXED_ADAPTER_ID: Hex = "0x0f13f4a8553a4dece69888deb425b04ff169d41132f3e2097034aff00f584dd6";
export const RWA_DYNAMIC_ADAPTER_ID: Hex = "0x46a5f7c611f6584cc99cffcdeb55183d6c3dcafe5fc6fcce85995be82639bbe1";
/** Upgradeable stock registry (ERC1967 proxy) the deployed RWA collectors read. */
export const RWA_ASSET_REGISTRY_ADDRESS: Address = "0x40356d61871C7Af760903FDD6ceb9344D7c3F328";
/** USDG is the only quote the deployed RWA collector factories accept. */
export const RWA_QUOTE_ASSET: Address = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
export const RWA_MAX_BASKET = 6;
export const RWA_MAX_PREMIUM_BPS = 100;
/** `maxPriceAge` value that disables the stock-feed age check (the USDG feed keeps its window). */
export const RWA_ANY_PRICE_AGE = 0xffffffff;

/**
 * Exactly `RwaLaunchConfigV1`. `basket` is 1-6 strictly ascending listed stock tokens with
 * `weightsBps[i]` for `basket[i]` summing to 10,000. `shareBps` 0-10,000 (0 = off),
 * `premiumBps` 0-100, `maxPriceAge` 0 = registry defaults or `RWA_ANY_PRICE_AGE`.
 */
export type RwaLaunchConfigV1 = {
  shareBps: number;
  premiumBps: number;
  maxPriceAge: number;
  basket: readonly Address[];
  weightsBps: readonly number[];
};

const rwaLaunchConfigComponents = [
  { name: "shareBps", type: "uint16" }, { name: "premiumBps", type: "uint16" }, { name: "maxPriceAge", type: "uint32" },
  { name: "basket", type: "address[]" }, { name: "weightsBps", type: "uint16[]" },
] as const;

const invalid = (reason: string) => new LifecyclePlanningError("INVALID_RWA_CONFIG", reason);
const uint = (value: number, max: number) => Number.isInteger(value) && value >= 0 && value <= max;

export function isRwaProfile(profileId: Hex): boolean {
  const id = profileId.toLowerCase();
  return id === RWA_FIXED_PROFILE_ID || id === RWA_DYNAMIC_PROFILE_ID;
}

/** Static terms only; registry listing is checked on-chain when the launch begins. */
export function validateRwaLaunchConfig(config: RwaLaunchConfigV1): void {
  if (!uint(config.shareBps, 10000)) throw invalid("RWA shareBps must be an integer from 0 to 10000");
  if (!uint(config.premiumBps, RWA_MAX_PREMIUM_BPS)) throw invalid("RWA premiumBps must be an integer from 0 to 100");
  if (!uint(config.maxPriceAge, RWA_ANY_PRICE_AGE)) throw invalid("RWA maxPriceAge must be a uint32");
  const count = config.basket.length;
  if (count === 0 || count > RWA_MAX_BASKET) throw invalid("An RWA basket holds 1 to 6 stock tokens");
  if (config.weightsBps.length !== count) throw invalid("RWA weightsBps needs exactly one weight per basket stock");
  let previous = 0n, total = 0;
  for (const [index, asset] of config.basket.entries()) {
    if (!isAddress(asset, { strict: false }) || BigInt(asset) <= previous) throw invalid("RWA basket stocks must be unique ascending addresses");
    if (asset.toLowerCase() === RWA_QUOTE_ASSET.toLowerCase()) throw invalid("USDG cannot be an RWA basket stock");
    const weight = config.weightsBps[index]!;
    if (!uint(weight, 10000)) throw invalid("RWA weights must be integer basis points");
    previous = BigInt(asset);
    total += weight;
  }
  if (total !== 10000) throw invalid("RWA weightsBps must sum to exactly 10000");
}

/** Exactly abi.encode(RwaLaunchConfigV1), including the leading tuple offset word. */
export function encodeRwaLaunchTail(config: RwaLaunchConfigV1): Hex {
  validateRwaLaunchConfig(config);
  return encodeAbiParameters([{ type: "tuple", components: rwaLaunchConfigComponents }], [{
    shareBps: config.shareBps, premiumBps: config.premiumBps, maxPriceAge: config.maxPriceAge,
    basket: config.basket.map((asset) => getAddress(asset)), weightsBps: [...config.weightsBps],
  }]);
}

export function decodeRwaLaunchTail(encoded: Hex): RwaLaunchConfigV1 {
  let decoded;
  try {
    decoded = decodeAbiParameters([{ type: "tuple", components: rwaLaunchConfigComponents }], encoded)[0];
  } catch {
    throw invalid("RWA tail must be abi.encode(RwaLaunchConfigV1)");
  }
  const config: RwaLaunchConfigV1 = {
    shareBps: decoded.shareBps, premiumBps: decoded.premiumBps, maxPriceAge: decoded.maxPriceAge,
    basket: [...decoded.basket], weightsBps: [...decoded.weightsBps],
  };
  if (encodeRwaLaunchTail(config).toLowerCase() !== encoded.toLowerCase()) throw invalid("RWA tail is not canonical");
  return config;
}

/** Outer market binding: config6, the variant's adapter and the USDG quote. */
export function validateRwaMarketContext(market: MarketConfigV1): void {
  if (!isRwaProfile(market.profileId)) return;
  const adapterId = market.profileId.toLowerCase() === RWA_FIXED_PROFILE_ID ? RWA_FIXED_ADAPTER_ID : RWA_DYNAMIC_ADAPTER_ID;
  if (market.configVersion !== 6 || market.adapterId.toLowerCase() !== adapterId || market.quoteAsset.toLowerCase() !== RWA_QUOTE_ASSET.toLowerCase()) {
    throw invalid("RWA markets require config6, their RWA adapter and a USDG quote");
  }
}

/**
 * Plan checks for the collector-construction invariants that would otherwise fail at market
 * preparation, after begin: each RWA market's outer binding, a Dividends launch token, and
 * every basket stock committed as a hub fee asset with a 0/10000/0 owner/rewards/burn policy.
 * No-op for plans without RWA markets.
 */
export function validateRwaLaunchPlan(plan: LaunchPlanV1): void {
  const policies = new Map(plan.feeAssets.map((policy) => [policy.asset.toLowerCase(), policy]));
  for (const market of plan.markets) {
    if (!isRwaProfile(market.profileId)) continue;
    validateRwaMarketContext(market);
    const config = decodePoolBoundV4LifecycleMarketConfig(market.config, 6);
    if (config.version !== 6 || config.rwaLaunchConfig === undefined) throw invalid("RWA markets require an RWA tail");
    if (plan.token.rewardMode !== LifecycleRewardMode.Dividends) throw invalid("RWA launches require a Dividends launch token");
    for (const asset of config.rwaLaunchConfig.basket) {
      const policy = policies.get(asset.toLowerCase());
      if (policy === undefined || policy.ownerBps !== 0 || policy.rewardsBps !== 10000 || policy.burnBps !== 0) {
        throw invalid("Every RWA basket stock must be a fee asset with a 0/10000/0 owner/rewards/burn policy");
      }
    }
  }
}
