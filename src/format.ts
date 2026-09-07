/** Ray = 1e27 (Aave interest rates). */
export const RAY = 10n ** 27n;
export const WAD = 10n ** 18n;
export const BPS = 10_000n;

export function rayToPercent(ray: bigint, digits = 2): number {
  if (ray === 0n) return 0;
  // (ray / 1e27) * 100
  const scaled = (ray * 10_000n) / RAY; // bps-ish * 100
  return Number(scaled) / 100 / 100;
}

/** Convert Aave liquidity/variable borrow rate (ray) to APY % display number. */
export function rayAprToApyPercent(ray: bigint): number {
  // Simple APR display (not compounded) — matches most Aave UI rate tooltips at a glance.
  return Number((ray * 10_000n) / RAY) / 100;
}

export function formatHealthFactor(hfRayOrWad: bigint): string {
  if (hfRayOrWad === 0n) return "—";
  // getUserAccountData returns HF in wad (1e18)
  const value = Number(hfRayOrWad) / 1e18;
  if (!Number.isFinite(value) || value > 1e6) return "∞";
  return value.toFixed(2);
}

export function healthFactorStatus(hfWad: bigint): "safe" | "watch" | "danger" | "none" {
  if (hfWad === 0n) return "none";
  const value = Number(hfWad) / 1e18;
  if (!Number.isFinite(value) || value > 1e6) return "safe";
  if (value < 1.05) return "danger";
  if (value < 1.5) return "watch";
  return "safe";
}

/** Parse a decimal health factor ("1.25") to wad. */
export function parseHealthFactorToWad(raw: string): bigint | undefined {
  const cleaned = raw.trim();
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const [whole, frac = ""] = cleaned.split(".");
  const fracPadded = (frac + "0".repeat(18)).slice(0, 18);
  return BigInt(whole || "0") * WAD + BigInt(fracPadded || "0");
}

export function parseAmountToUnits(amount: string, decimals: number): bigint {
  const cleaned = amount.trim();
  if (!cleaned || cleaned === ".") return 0n;
  const [whole, frac = ""] = cleaned.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const wholePart = BigInt(whole || "0") * 10n ** BigInt(decimals);
  const fracPart = BigInt(fracPadded || "0");
  return wholePart + fracPart;
}

export function formatUnitsDisplay(value: bigint, decimals: number, digits = 4): string {
  if (value === 0n) return "0";
  const neg = value < 0n;
  const v = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = v % base;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, digits).replace(/0+$/, "");
  const body = fracStr ? `${whole}.${fracStr}` : whole.toString();
  return neg ? `-${body}` : body;
}

export function utilizationFromReserve(availableLiquidity: bigint, totalDebt: bigint): number {
  const total = availableLiquidity + totalDebt;
  if (total === 0n) return 0;
  return Number((totalDebt * 10_000n) / total) / 100;
}
