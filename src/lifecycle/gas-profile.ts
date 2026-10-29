import { toHex, type Address } from "viem";
import { decodeAbyssLifecycleMarketConfig, decodePoolBoundV4LifecycleMarketConfig } from "./markets.js";
import { computeLifecycleOpeningBuys, hasProfiledOpeningMath } from "./opening-buys.js";
import { hmmV2ForwardingReserve } from "./presets.js";
import { lifecyclePinnedRpc, lifecycleSourceClient, nitroPosterGasBound, readLifecycleGasPrice, readNitroPrices, registerLifecycleFinalCheck, resolveLifecycleLimits, rpcQuantity } from "./rpc.js";
import { LifecycleFundingKind, LifecycleRewardMode, LifecycleTokenKind, type LaunchPlanV1 } from "./schema.js";
import { isAutoCompoundProfile } from "./auto-compound.js";
import { buildLifecycleCommand, LIFECYCLE_CAPACITY_PADDING_BPS, preparationCalldataGas, preparationGasEstimate } from "./transactions.js";
import { UFG_LAUNCH_PROXY_ADDRESS, isUfgProfile, ufgPlanPrincipal, type UfgLaunchConfig } from "./ufg-config.js";
import { LifecyclePlanningError, type LifecycleBlock, type LifecycleLaunchGasBounds, type LifecycleLimitSource, type LifecycleOpeningBuyQuote, type LifecyclePlanningAssessment, type LifecycleRpcClient, type LifecycleTransaction, type PlannedLaunch } from "./types.js";
import { isHmmProfile } from "./hmm.js";

export const LIFECYCLE_GAS_PROFILE_VERSION = "robinhood-4663-capacity-v4";
export type NextTransactionEnvelope = Readonly<{ gas: bigint; gasPrice: bigint }>;
const ceil = (value: bigint, divisor: bigint) => (value + divisor - 1n) / divisor;
const approval = (transaction: LifecycleTransaction) => transaction.kind === "approve" || transaction.kind === "approve-reset";
type MarketGas = { abyss: boolean; hmm: boolean; ufgHook: boolean; positions: number };

function marketGas(plan: LaunchPlanV1): MarketGas[] {
  return plan.markets.map((market) => {
    const abyss = market.configVersion === 1;
    const config = abyss ? decodeAbyssLifecycleMarketConfig(market.config) : decodePoolBoundV4LifecycleMarketConfig(market.config, 6);
    return { abyss, hmm: isHmmProfile(market.profileId), ufgHook: isUfgProfile(market.profileId), positions: config.positions.length };
  });
}

function utf8Bytes(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index += 1; }
    else bytes += 3;
  }
  return bytes;
}

function tokenCreationGas(token: LaunchPlanV1["token"]): bigint {
  return (token.kind === LifecycleTokenKind.ERC404 ? 2_500_000n : 0n) +
    (token.rewardMode === LifecycleRewardMode.Staking ? 2_500_000n : token.rewardMode === LifecycleRewardMode.Dividends ? 500_000n : 0n) +
    25_000n * BigInt(Math.ceil(utf8Bytes(token.name) / 32) + Math.ceil(utf8Bytes(token.symbol) / 32) + Math.ceil(utf8Bytes(token.metadataURI) / 32));
}

// Max observed compute: native Abyss atomic21,584,262; V4 fixed20,833,003;
// HMM26,395,772; UFG27,941,420 (historical-receipts.json,195 transactions).
// fork-matrix.json: Abyss activation8 positions11.08M/32 positions39.72M;
// fork-v4-matrix.json: dynamic V4 eight positions5,906,285.
// Native mixed HMM8/Abyss8/HMM8 activation23,883,893 (0xf05e…fe98).
const activationCosts = {
  call: 1_500_000n,
  // Restore the per-market allowances from capacity-v2 (29e1445).
  // Issue #21 motivates conservative breadth policy pending native calibration.
  // Its empty activation revert does not establish the exact failure cause.
  // These restored allowances are not a measured successful gas bound.
  abyss: { market: 1_000_000n, position: 1_250_000n },
  v4: { market: 500_000n, position: 500_000n },
  hmm: 1_000_000n,
  ufg: 250_000n,
  // Fork Abyss32: 64 buys78.44M minimum versus one buy47.49M;
  // max observed marginal is below0.5M/buy. ERC404 pairs add below0.1M/NFT.
  buy: 500_000n,
  nft: 100_000n,
} as const;

/** Conservative empirical template budgets, never gas-limit sizing or execution evidence. */
function capacityBasis(plan: LaunchPlanV1, transaction: LifecycleTransaction, markets: readonly MarketGas[], quotes: readonly LifecycleOpeningBuyQuote[], ufgRoute: boolean): bigint {
  const atomic = transaction.kind === "atomic";
  let gas = atomic ? 22_000_000n + tokenCreationGas(plan.token) + (ufgRoute ? 6_500_000n : 0n)
    : activationCosts.call + (ufgRoute ? activationCosts.ufg : 0n);
  for (const market of markets) {
    if (atomic) gas += (market.hmm ? 7_000_000n : market.ufgHook ? 1_000_000n : market.abyss ? 500_000n : 0n) +
      (market.abyss ? 1_500_000n : 600_000n) * BigInt(market.positions - 1);
    else {
      const cost = market.abyss ? activationCosts.abyss : activationCosts.v4;
      gas += cost.market + cost.position * BigInt(market.positions) + (market.hmm ? activationCosts.hmm : market.ufgHook ? activationCosts.ufg : 0n);
    }
  }
  gas += activationCosts.buy * BigInt(quotes.length);
  if (plan.token.kind === LifecycleTokenKind.ERC404) for (const quote of quotes) gas += activationCosts.nft * ceil(quote.tokenOut, plan.token.nftUnit);
  return gas + 24n * BigInt((transaction.data.length - 2) / 2) + 100_000n * BigInt(plan.feeAssets.length);
}

type CapacityOptions = { plan: LaunchPlanV1; predictedToken: Address; ufg?: { config: UfgLaunchConfig }; headroomBps?: number };
export type ProfiledLaunchCapacity = {
  bounds: LifecycleLaunchGasBounds; initialBuys: readonly LifecycleOpeningBuyQuote[]; headroomBps: number;
  atomic?: LifecycleTransaction; activation: LifecycleTransaction;
};

/** No quote-token allowlist: costs and exact curve math belong to the release template. */
export function deriveLifecycleLaunchCapacity(options: CapacityOptions, openingBuys?: readonly LifecycleOpeningBuyQuote[]): ProfiledLaunchCapacity | undefined {
  const { plan, ufg } = options;
  if (!hasProfiledOpeningMath(plan) || (plan.creator.toLowerCase() === UFG_LAUNCH_PROXY_ADDRESS.toLowerCase()) !== (ufg !== undefined)) return undefined;
  // Auto-compounding templates have no measured gas yet; never invent their budgets.
  if (plan.markets.some((market) => isAutoCompoundProfile(market.profileId))) return undefined;
  const headroomBps = options.headroomBps ?? 1500;
  if (!Number.isSafeInteger(headroomBps) || headroomBps < 0 || headroomBps > 10000) throw new LifecyclePlanningError("INVALID_LIMITS", "Headroom must be between zero and 10000 basis points");
  const initialBuys = openingBuys ?? computeLifecycleOpeningBuys(options);
  const route = ufg === undefined ? undefined : { account: ufgPlanPrincipal(plan), config: ufg.config };
  const atomic = plan.markets.length === 1 && !plan.funding.some((funding) => funding.kind === LifecycleFundingKind.Swap)
    ? buildLifecycleCommand(plan, { kind: "atomic" }, route) : undefined;
  const activation = buildLifecycleCommand(plan, { kind: "activate" }, route);
  const markets = marketGas(plan), reserve = hmmV2ForwardingReserve(plan);
  const bound = (transaction: LifecycleTransaction) => {
    const basis = capacityBasis(plan, transaction, markets, initialBuys, ufg !== undefined);
    const buffered = ceil(basis * BigInt(10000 + Math.max(LIFECYCLE_CAPACITY_PADDING_BPS, headroomBps)), 10000n);
    return buffered > basis + reserve ? buffered : basis + reserve;
  };
  return { bounds: { ...(atomic === undefined ? {} : { atomicComputeGasUpperBound: bound(atomic) }), activationComputeGasUpperBound: bound(activation) }, initialBuys, headroomBps, atomic, activation };
}

/** Pure release-template budgets with headroom, excluding poster allocation.
 * Missing coverage refuses planning; there is no execution fallback. */
export function computeLifecycleLaunchGasBounds(options: CapacityOptions): LifecycleLaunchGasBounds | undefined {
  return deriveLifecycleLaunchCapacity(options)?.bounds;
}

export type LifecycleBudgetOptions = { client: LifecycleRpcClient; planned: PlannedLaunch; limits?: LifecycleLimitSource; signal?: AbortSignal };

/** Checks pinned inputs and deterministic capacity only. Never executes launch calldata. */
export async function assessLifecycleTransactions(options: LifecycleBudgetOptions, transactions: readonly LifecycleTransaction[], block: LifecycleBlock,
  reviewed?: NextTransactionEnvelope, openingBuys?: readonly LifecycleOpeningBuyQuote[], capacity?: ProfiledLaunchCapacity): Promise<LifecyclePlanningAssessment> {
  const { client, planned } = options, plan = planned.plan;
  const context = { client, account: planned.account, orchestrator: plan.orchestrator, block, chainId: planned.chainId };
  const observed = await resolveLifecycleLimits(context, options.limits === undefined ? planned.limits : options.limits);
  const [recommendation, balanceValue, prices] = await Promise.all([
    readLifecycleGasPrice(client, block, planned.chainId),
    lifecyclePinnedRpc(client, "eth_getBalance", [planned.account, toHex(block.number)], block),
    observed.limits.protocol === "nitro" ? readNitroPrices(client, block) : undefined,
  ]);
  options.signal?.throwIfAborted(); observed.assertCurrent(); registerLifecycleFinalCheck(client, observed.assertCurrent);
  const { limits } = observed, baseFee = block.baseFeePerGas ?? 0n, gasLimit = limits.executionGasCeiling;
  const requiredGasPrice = limits.protocol === "nitro" && recommendation > baseFee ? recommendation : baseFee;
  const gasPrice = reviewed?.gasPrice ?? (recommendation > baseFee * 2n ? recommendation : baseFee * 2n);
  if (reviewed !== undefined && reviewed.gas !== gasLimit) throw new LifecyclePlanningError("STALE_REVIEWED_GAS", "Reviewed gas differs from the native transaction ceiling. Refresh the review before continuing.");
  const cancelOnly = transactions.every((transaction) => transaction.kind === "cancel");
  const currentCapacity = cancelOnly ? undefined : capacity?.headroomBps === limits.headroomBps ? capacity
    : deriveLifecycleLaunchCapacity({ plan, predictedToken: planned.predictedToken, ufg: planned.ufg, headroomBps: limits.headroomBps }, openingBuys);
  const immediate = transactions[0], launch = transactions.find((transaction) => !approval(transaction));
  const poster = (transaction: LifecycleTransaction) => prices === undefined ? 0n : nitroPosterGasBound(transaction, prices).posterGas;
  const assessment: LifecyclePlanningAssessment = { ready: true, blockNumber: block.number, blockHash: block.hash,
    account: planned.account, chainId: planned.chainId, limits,
    ...(currentCapacity === undefined ? {} : { gasProfile: { version: LIFECYCLE_GAS_PROFILE_VERSION, bounds: currentCapacity.bounds, initialBuys: currentCapacity.initialBuys } }) };
  const refuse = (code: string, reason: string, failureCategory: LifecyclePlanningAssessment["failureCategory"], capacityConstraint?: LifecyclePlanningAssessment["capacityConstraint"], failedTransactionId?: string): LifecyclePlanningAssessment =>
    ({ ...assessment, ready: false, code, reason, failureCategory, capacityConstraint, failedTransactionId });
  if (!cancelOnly && currentCapacity === undefined) return refuse("UNKNOWN_GAS_PROFILE", "Gas budgets are unavailable for this launch profile. Use a supported profile or update the SDK.", "capacity");
  if (!cancelOnly && currentCapacity!.bounds.activationComputeGasUpperBound + poster(currentCapacity!.activation) > gasLimit) {
    return refuse("ACTIVATION_GAS_LIMIT", "Too many positions or pools for one activation. Reduce them to fit the native transaction ceiling.", "capacity", "activation", "activate");
  }
  for (const transaction of transactions) {
    if (transaction.kind === "atomic" && (currentCapacity?.bounds.atomicComputeGasUpperBound === undefined || currentCapacity.bounds.atomicComputeGasUpperBound + poster(transaction) > gasLimit))
      return refuse("STAGED_EXECUTION_REQUIRED", "This launch requires staged execution. Refresh the review before continuing.", "capacity", "gas-envelope", transaction.id);
    if (transaction.kind === "prepare" && ceil((preparationGasEstimate(plan, transaction.marketStart!, transaction.marketCount!) + preparationCalldataGas(transaction.data)) * BigInt(10000 + Math.max(LIFECYCLE_CAPACITY_PADDING_BPS, limits.headroomBps)), 10000n) + poster(transaction) > gasLimit)
      return refuse("PREPARATION_GAS_LIMIT", "This preparation batch exceeds the gas budget. Refresh the review to split it.", "capacity", "preparation", transaction.id);
    if (limits.maxCalldataBytes !== undefined && (transaction.data.length - 2) / 2 > limits.maxCalldataBytes)
      return refuse("CALLDATA_LIMIT", "The launch exceeds the transaction data limit. Reduce its positions or pools.", "capacity", "calldata", transaction.id);
  }
  if (launch !== undefined && limits.transactionGasCeiling !== undefined && gasLimit > limits.transactionGasCeiling)
    return refuse("GAS_POLICY_LIMIT", "The configured gas limit is below the chain's native transaction ceiling.", "capacity", "gas-envelope", launch.id);
  if (reviewed !== undefined && gasPrice < requiredGasPrice) return refuse("REVIEWED_FEE_TOO_LOW", "The reviewed gas price is below the current required fee. Refresh the review before continuing.", "semantic", undefined, immediate?.id);
  const quotes = currentCapacity?.initialBuys ?? [];
  if (quotes.some((quote) => quote.tokenOut < plan.buys[quote.buyIndex]!.minTokenOut))
    return refuse("BUY_MINIMUM_NOT_MET", "An opening buy is below its minimum output. Refresh the review before continuing.", "semantic");
  if (block.timestamp > plan.deadline && !cancelOnly) return refuse("PLAN_EXPIRED", "The launch deadline has passed. Cancel an unfinished launch to recover its funds.", "semantic");
  const inputs = new Map<string, { required: bigint; balance: bigint }>();
  for (const prerequisite of planned.prerequisites) {
    if (prerequisite.allowance === undefined) continue;
    const key = prerequisite.funding.inputAsset.toLowerCase(), total = inputs.get(key) ?? { required: 0n, balance: prerequisite.inputBalance };
    total.required += prerequisite.requiredInput; inputs.set(key, total);
  }
  if ([...inputs.values()].some((input) => input.required > input.balance)) return refuse("INSUFFICIENT_FUNDING_BALANCE", "There are not enough tokens to fund this launch. Add funds or reduce the purchase.", "affordability");
  const balance = rpcQuantity(balanceValue, "creator native balance");
  if (gasPrice >= 1n << 256n || launch !== undefined && launch.value + gasLimit * gasPrice >= 1n << 256n) throw new LifecyclePlanningError("INVALID_GAS_ENVELOPE", "Transaction value and native-ceiling fee must fit uint256");
  if (launch !== undefined && launch.value + gasLimit * gasPrice > balance) return refuse("INSUFFICIENT_NATIVE_BALANCE", "There is not enough native currency for the launch amount and gas budget. Add funds or reduce the purchase.", "affordability", undefined, launch.id);
  if (immediate !== undefined && !approval(immediate)) {
    const source = lifecycleSourceClient(client);
    const dataFee = limits.protocol === "nitro" ? 0n : observed.configuration.estimateDataFee === undefined ? undefined
      : await observed.configuration.estimateDataFee({ ...immediate, gas: gasLimit, gasPrice }, source === client ? context : { ...context, client: source });
    if (dataFee !== undefined && (typeof dataFee !== "bigint" || dataFee < 0n || dataFee >= 1n << 256n)) throw new LifecyclePlanningError("INVALID_DATA_FEE", "Data-fee estimate must be a nonnegative uint256 amount");
    const executionFee = gasLimit * gasPrice, required = immediate.value + executionFee + (dataFee ?? 0n);
    if (required >= 1n << 256n) throw new LifecyclePlanningError("INVALID_GAS_ENVELOPE", "Transaction value and gas/data fee budget must fit uint256");
    if (required > balance) return refuse("INSUFFICIENT_NATIVE_BALANCE", "There is not enough native currency for the launch amount and gas budget. Add funds or reduce the purchase.", "affordability", undefined, immediate.id);
    const posterGas = prices === undefined ? undefined : poster(immediate);
    assessment.estimate = { gasLimit, gasPrice, executionFee, dataFee, totalFee: dataFee === undefined ? undefined : executionFee + dataFee,
      posterGas, posterFee: posterGas === undefined ? undefined : posterGas * gasPrice, dataFeeIncludedInGas: limits.protocol === "nitro",
      feeConfidence: dataFee === undefined ? "native-ceiling-only" : "native-ceiling-and-data" };
  }
  options.signal?.throwIfAborted(); observed.assertCurrent();
  return assessment;
}
