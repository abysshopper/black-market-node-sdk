import { encodeFunctionData, keccak256, toHex, zeroAddress, type Address, type Hex } from "viem";
import { ABYSS_FEE_TIERS } from "../abyss.js";
import { assertLaunchTopologyCoverage, getTickAtSqrtRatio } from "../launch.js";
import { launchLifecycleAbi, lifecycleAdapterAbi, lifecycleErc20Abi } from "./abi.js";
import { hashLaunchIdentity, hashLaunchPlan, LifecycleFundingKind, LifecyclePhase, LifecycleRewardMode, LifecycleTokenKind, LIFECYCLE_MAX_ERC404_SUPPLY, LIFECYCLE_MAX_REWARD_ERC20_SUPPLY, parseLaunchPlan, serializeLaunchPlan, type LaunchPlanV1, type MarketConfigV1 } from "./schema.js";
import { readLaunchProgress, readLifecycleExecutionProgress, readLifecycleHeadProgress, readLifecycleProfiles, readLifecycleTokenAtBlock, readPoolBoundHookDeployment } from "./progress.js";
import { decodeAbyssLifecycleMarketConfig, decodePoolBoundV4LifecycleMarketConfig, decodeV4LifecycleMarketConfig, encodePoolBoundV4LifecycleMarketConfig, isPoolBoundV4ConfigVersion, type AbyssLifecycleMarketConfig, type V4LifecycleMarketConfig, type V4PoolBoundLifecycleMarketConfig } from "./markets.js";
import { lifecyclePinnedRpc, lifecycleStaticRpc, lifecycleStage, nitroPosterGasBound, readLifecycleChainId, readLifecycleContract, readNitroPrices, registerLifecycleFinalCheck, resolveLifecycleLimits, rpcHex, rpcQuantity, withLifecycleReadClient } from "./rpc.js";
import { LifecyclePlanningError, type BuildNextTransactionOptions, type CanonicalLaunchProgress, type LifecycleBlock, type LifecycleConstructionProfile, type LifecycleFundingPrerequisite, type LifecyclePoolBoundHookDeployment, type LifecycleProfile, type LifecycleRpcClient, type LifecyclePlanningAssessment, type LifecycleTransaction, type PlannedLaunch, type PlanLaunchOptions, type PrepareAndPlanLifecycleLaunchOptions, type ResolvedLifecycleLimits } from "./types.js";
import { deriveKnownPoolBoundHookDeployment, validateBuySlippageBps } from "./calibration.js";
import { getKnownLifecycleDeployment, getKnownLifecycleProfile } from "./presets.js";
import { buildLifecycleCommand, packPreparationBatches, type LifecycleCommand } from "./transactions.js";
import { assertLifecycleMarketAllocation, assertLifecycleSupplyAllocation } from "./allocations.js";
import { assertUfgLaunchAccount, hashUfgLaunchConfig, ufgPlanPrincipal, UFG_LAUNCH_PROXY_ADDRESS } from "./ufg-config.js";
import { buildUfgCancelTransaction, validateUfgLaunchPlan } from "./ufg.js";
import { readLifecyclePlanningBlock } from "./snapshot.js";
import { mineLifecycleHooks } from "./mining.js";
import { computeLifecycleOpeningBuys, hasProfiledOpeningMath } from "./opening-buys.js";
import { assessLifecycleTransactions, deriveLifecycleLaunchCapacity, type NextTransactionEnvelope, type ProfiledLaunchCapacity } from "./gas-profile.js";
import type { LifecycleOpeningBuyQuote } from "./types.js";
import { isRaetoProfile, RAETO_QUOTE_ASSETS } from "./raeto.js";

type ValidatedPlanShape = {
  commitment: Hex;
  ufgConfigHash?: Hex;
  marketConfigs: (AbyssLifecycleMarketConfig | V4LifecycleMarketConfig | V4PoolBoundLifecycleMarketConfig)[];
};
type PlanReadContext = {
  block?: LifecycleBlock;
  openingBuys?: readonly LifecycleOpeningBuyQuote[];
};
const defaultPlanReadContext: PlanReadContext = {};

function observedFields<T extends object>(value: T): () => boolean {
  const keys = Object.keys(value) as (keyof T)[];
  const values = keys.map((key) => value[key]);
  return () => keys.length === Object.keys(value).length && keys.every((key, index) => value[key] === values[index]);
}

async function selectLaunchMode(requested: "atomic" | "staged", plan: LaunchPlanV1, capacity: ProfiledLaunchCapacity | undefined,
  limits: ResolvedLifecycleLimits, client: LifecycleRpcClient, block: LifecycleBlock): Promise<"atomic" | "staged"> {
  if (requested !== "atomic" || plan.markets.length !== 1 ||
    capacity?.atomic === undefined || capacity.bounds.atomicComputeGasUpperBound === undefined) return "staged";
  const poster = limits.protocol === "nitro" ? nitroPosterGasBound(capacity.atomic, await readNitroPrices(client, block)).posterGas : 0n;
  return capacity.bounds.atomicComputeGasUpperBound + poster <= limits.executionGasCeiling ? "atomic" : "staged";
}

async function preparationBatches(plan: LaunchPlanV1, prepared: number, ufg: PlanLaunchOptions["ufg"], limits: ResolvedLifecycleLimits,
  client: LifecycleRpcClient, block: LifecycleBlock): Promise<number[]> {
  if (prepared === plan.markets.length) return prepared === 0 ? [] : [prepared];
  const route = ufg === undefined ? undefined : { account: ufgPlanPrincipal(plan), config: ufg.config };
  const sample = buildLifecycleCommand(plan, { kind: "prepare", first: prepared, count: 1 }, route);
  const poster = limits.protocol === "nitro" ? nitroPosterGasBound(sample, await readNitroPrices(client, block)).posterGas : 0n;
  return packPreparationBatches(plan, prepared, limits.executionGasCeiling - poster, limits.headroomBps);
}

/** Preserve Raeto's outer quote/profile binding even on known-preset recovery. */
function validateRaetoMarketContext(market: MarketConfigV1, config?: V4LifecycleMarketConfig | V4PoolBoundLifecycleMarketConfig): void {
  if (!isRaetoProfile(market.profileId)) return;
  if (market.configVersion !== 6 || !RAETO_QUOTE_ASSETS.some((quote) => quote.toLowerCase() === market.quoteAsset.toLowerCase())) {
    throw new LifecyclePlanningError("INVALID_RAETO_CONFIG", "Raeto requires config6 and a WETH or USDG quote");
  }
  // Normal planning supplies its already decoded config. Continuation must also
  // reject malformed fee/share tails before reading or building its next command.
  const decoded = config ?? decodePoolBoundV4LifecycleMarketConfig(market.config, 6);
  if (decoded.version !== 6 || decoded.profileId.toLowerCase() !== market.profileId.toLowerCase()) {
    throw new LifecyclePlanningError("INVALID_RAETO_CONFIG", "Raeto config must bind its market's Raeto profile");
  }
}

function validatePlanShape(plan: LaunchPlanV1): ValidatedPlanShape {
  // Encoding checks all exact integer widths, addresses, byte strings and tuple fields.
  const commitment = hashLaunchPlan(plan);
  if (plan.markets.length === 0 || plan.markets.length > 16 || plan.buys.length > 64 || plan.funding.length > 8 || plan.feeAssets.length === 0 || plan.feeAssets.length > 8 || plan.token.supply <= 0n || plan.token.inventoryRecipient === zeroAddress || plan.token.inventoryRecipient.toLowerCase() === plan.orchestrator.toLowerCase() || plan.executorFeeBps > 1000) throw new LifecyclePlanningError("INVALID_PLAN", "Plan exceeds lifecycle bounds or lacks positive token economics");
  if ((plan.token.kind === LifecycleTokenKind.ERC404 && plan.token.supply > LIFECYCLE_MAX_ERC404_SUPPLY) || (plan.token.kind === LifecycleTokenKind.ERC20 && plan.token.rewardMode !== LifecycleRewardMode.None && plan.token.supply > LIFECYCLE_MAX_REWARD_ERC20_SUPPLY)) throw new LifecyclePlanningError("INVALID_TOKEN_SUPPLY", "Reward-enabled ERC20 supply must not exceed 10^77; ERC404 supply must fit uint96; reward-free ERC20 retains uint256");
  const encoder = new TextEncoder();
  if (encoder.encode(plan.token.name).length === 0 || encoder.encode(plan.token.name).length > 128 || encoder.encode(plan.token.symbol).length === 0 || encoder.encode(plan.token.symbol).length > 32 || encoder.encode(plan.token.metadataURI).length > 2048) throw new LifecyclePlanningError("INVALID_PLAN", "Token metadata exceeds the committed byte bounds");
  let previous = 0n;
  for (const policy of plan.feeAssets) {
    if (BigInt(policy.asset) <= previous || policy.ownerBps + policy.rewardsBps + policy.burnBps !== 10000) throw new LifecyclePlanningError("INVALID_FEE_POLICY", "Fee assets must be unique ascending addresses with fractions summing to 10000");
    previous = BigInt(policy.asset);
  }
  if (plan.feeAssets.some((policy) => policy.rewardsBps !== 0) !== (plan.token.rewardMode !== LifecycleRewardMode.None)) throw new LifecyclePlanningError("INVALID_FEE_POLICY", "Reward-enabled tokens require a rewards share; reward-free tokens cannot commit rewards shares");
  previous = 0n;
  for (const funding of plan.funding) {
    if (BigInt(funding.asset) <= previous || funding.amount <= 0n || funding.inputAmount <= 0n) throw new LifecyclePlanningError("INVALID_FUNDING", "Funding output assets must be positive, unique and ascending");
    if (funding.kind !== LifecycleFundingKind.Swap && (funding.inputAsset.toLowerCase() !== funding.asset.toLowerCase() || funding.inputAmount !== funding.amount || funding.target !== zeroAddress || funding.data !== "0x")) throw new LifecyclePlanningError("INVALID_FUNDING", "ERC20 and native-wrap funding must use the exact output asset/amount and no target call");
    if (funding.kind === LifecycleFundingKind.Swap && (funding.inputAsset.toLowerCase() === funding.asset.toLowerCase() || funding.data === "0x" || (funding.data.length - 2) / 2 > 16384)) throw new LifecyclePlanningError("INVALID_FUNDING", "Conversion funding must change assets and commit bounded nonempty calldata");
    previous = BigInt(funding.asset);
  }
  for (const buy of plan.buys) {
    if (buy.marketIndex >= plan.markets.length || buy.quoteAmountIn <= 0n || buy.minTokenOut <= 0n || buy.recipient === zeroAddress || buy.recipient.toLowerCase() === plan.orchestrator.toLowerCase()) throw new LifecyclePlanningError("INVALID_BUY", "Every ordered buy requires a committed market, positive budget/minimum, and external recipient");
  }
  const v4Quotes = new Set<string>();
  let positionCount = 0;
  const marketConfigs: ValidatedPlanShape["marketConfigs"] = [];
  for (const market of plan.markets) {
    if (market.tokenBudget <= 0n || market.config === "0x" || (market.config.length - 2) / 2 > 16384) throw new LifecyclePlanningError("INVALID_MARKET", "Each market needs a positive token budget and bounded versioned config");
    let config: V4LifecycleMarketConfig | V4PoolBoundLifecycleMarketConfig | undefined;
    if (market.configVersion !== 1 && market.configVersion !== 4 && !isPoolBoundV4ConfigVersion(market.configVersion)) throw new LifecyclePlanningError("UNSUPPORTED_CONFIG_VERSION", "Encode reviewed SharedV4 version 4 or pool-bound version 5/6 only on its exact matching deployment");
    if (market.configVersion === 4) config = decodeV4LifecycleMarketConfig(market.config);
    else if (isPoolBoundV4ConfigVersion(market.configVersion)) config = decodePoolBoundV4LifecycleMarketConfig(market.config, market.configVersion);
    validateRaetoMarketContext(market, config);
    if (config !== undefined) {
      if (config.profileId.toLowerCase() !== market.profileId.toLowerCase()) throw new LifecyclePlanningError("PROFILE_TERMS_MISMATCH", "Inner config profile differs from the committed market profile");
      const quote = market.quoteAsset.toLowerCase();
      if (v4Quotes.has(quote)) throw new LifecyclePlanningError("DUPLICATE_V4_QUOTE", "Only one V4 market per quote asset is allowed across shared and pool-bound offerings; put multiple positions in that market");
      v4Quotes.add(quote);
      if (config.lpFeePips >= 1000000 || (config.version === 6 ? config.hookFeePips > 1000000 : config.hookFeePips >= 1000000) || config.feeMode > 1 || config.tickSpacing < 1 || config.tickSpacing > 32767 || config.sqrtPriceX96 < 4295128739n || config.sqrtPriceX96 >= 1461446703485210103287273052203988822378723970342n || (config.protocolFeeDenominator !== 0 && (config.protocolFeeDenominator < 4 || config.protocolFeeDenominator > 10 || config.treasury === zeroAddress))) throw new LifecyclePlanningError("INVALID_MARKET", "V4 market violates lifecycle fee, price, treasury or position bounds");
      positionCount += assertLifecycleMarketAllocation(market, config.positions);
      marketConfigs.push(config);
    }
    else {
      const abyss = decodeAbyssLifecycleMarketConfig(market.config);
      positionCount += assertLifecycleMarketAllocation(market, abyss.positions);
      marketConfigs.push(abyss);
    }
    if (positionCount > 32) throw new LifecyclePlanningError("INVALID_POSITION_COUNT", "A launch commits at most 32 total positions across every venue");
  }
  assertLifecycleSupplyAllocation(plan);
  for (const market of plan.markets) {
    const required = plan.buys.filter((buy) => plan.markets[buy.marketIndex]?.quoteAsset.toLowerCase() === market.quoteAsset.toLowerCase()).reduce((sum, buy) => sum + buy.quoteAmountIn, 0n);
    const funding = plan.funding.find((item) => item.asset.toLowerCase() === market.quoteAsset.toLowerCase());
    if (required > (funding?.amount ?? 0n)) throw new LifecyclePlanningError("INVALID_FUNDING", "Quote funding does not cover all ordered buys for its asset");
  }
  return { commitment, marketConfigs };
}

async function readFunding(client: LifecycleRpcClient, plan: LaunchPlanV1, block: LifecycleBlock, account = plan.creator, ufg = false): Promise<{ prerequisites: LifecycleFundingPrerequisite[]; approvals: LifecycleTransaction[] }> {
  if (plan.funding.length === 0) return { prerequisites: [], approvals: [] };
  const preset = getKnownLifecycleDeployment({ chainId: plan.chainId, orchestrator: plan.orchestrator });
  const escrow = ufg ? UFG_LAUNCH_PROXY_ADDRESS : preset?.fundingEscrow ?? await readLifecycleContract<Address>(client, plan.orchestrator, launchLifecycleAbi, "fundingEscrow", [], block);
  // Only allowance observations construct approval commands. Core execution
  // enforces input/output asset, funding target, balance and conversion predicates.
  const prerequisites = await Promise.all(plan.funding.map(async (funding): Promise<LifecycleFundingPrerequisite> => {
    const native = funding.kind === LifecycleFundingKind.NativeWrap || funding.kind === LifecycleFundingKind.Swap && funding.inputAsset === zeroAddress;
    const [inputBalance, allowance] = native
      ? [rpcQuantity(await lifecyclePinnedRpc(client, "eth_getBalance", [account, toHex(block.number)], block), "creator native balance"), undefined] as const
      : await Promise.all([
        readLifecycleContract<bigint>(client, funding.inputAsset, lifecycleErc20Abi, "balanceOf", [account], block),
        readLifecycleContract<bigint>(client, funding.inputAsset, lifecycleErc20Abi, "allowance", [account, escrow], block),
      ]);
    return { funding, inputBalance, requiredInput: funding.inputAmount, allowance, spender: escrow, nativeValue: native ? funding.inputAmount : 0n, conversion: funding.kind === LifecycleFundingKind.NativeWrap ? "native-wrap" : funding.kind === LifecycleFundingKind.Swap ? "allowlisted-swap" : "none" };
  }));
  const totals = new Map<string, { asset: Address; amount: bigint; allowance: bigint }>();
  for (const prerequisite of prerequisites) {
    if (prerequisite.allowance === undefined) continue;
    const { funding } = prerequisite;
    const key = funding.inputAsset.toLowerCase();
    const total = totals.get(key) ?? { asset: funding.inputAsset, amount: 0n, allowance: prerequisite.allowance };
    total.amount += funding.inputAmount;
    totals.set(key, total);
  }
  const approvals: LifecycleTransaction[] = [];
  for (const total of totals.values()) {
    if (total.allowance >= total.amount) continue;
    if (total.allowance > 0n) approvals.push({ id: `approve-reset:${total.asset}`, kind: "approve-reset", chainId: Number(plan.chainId), from: account, to: total.asset, data: encodeFunctionData({ abi: lifecycleErc20Abi, functionName: "approve", args: [escrow, 0n] }), value: 0n, dependencies: [], postconditions: [{ kind: "allowance", asset: total.asset, spender: escrow, minimum: 0n, exact: 0n }] });
    approvals.push({ id: `approve:${total.asset}`, kind: "approve", chainId: Number(plan.chainId), from: account, to: total.asset, data: encodeFunctionData({ abi: lifecycleErc20Abi, functionName: "approve", args: [escrow, total.amount] }), value: 0n, dependencies: [], postconditions: [{ kind: "allowance", asset: total.asset, spender: escrow, minimum: total.amount }] });
  }
  return { prerequisites, approvals };
}

async function readPlanMetadata(client: LifecycleRpcClient, plan: LaunchPlanV1, token: Address, block: LifecycleBlock): Promise<{ profiles: (LifecycleProfile | LifecycleConstructionProfile)[]; hookDeployments: LifecyclePoolBoundHookDeployment[]; reasons: string[] }> {
  const ids = [...new Set(plan.markets.map((market) => market.profileId.toLowerCase() as Hex))];
  const known = ids.map((profileId) => getKnownLifecycleProfile({ chainId: plan.chainId, orchestrator: plan.orchestrator, profileId }));
  const unknownIds = ids.filter((_id, index) => known[index] === undefined);
  const live = unknownIds.length === 0 ? [] : await readLifecycleProfiles({ client, orchestrator: plan.orchestrator, profileIds: unknownIds }, block);
  const profiles = ids.map((id, index): LifecycleProfile | LifecycleConstructionProfile => {
    const preset = known[index];
    if (preset !== undefined) {
      if (!preset.supported) throw new LifecyclePlanningError("UNSUPPORTED_CONFIG_VERSION", preset.unavailableReason ?? "Historical preset does not support the current launch ABI");
      return { ...preset.profile, metadataSource: "preset" };
    }
    const profile = live.find((candidate) => candidate.id.toLowerCase() === id);
    if (profile === undefined) throw new LifecyclePlanningError("PROFILE_NOT_FOUND", "Unlisted profile discovery omitted the committed profile");
    return profile;
  });
  const hookDeployments = (await Promise.all(plan.markets.map(async (market, marketIndex): Promise<LifecyclePoolBoundHookDeployment | undefined> => {
    if (!isPoolBoundV4ConfigVersion(market.configVersion)) return undefined;
    const known = deriveKnownPoolBoundHookDeployment({ plan, token, marketIndex });
    return { marketIndex, ...(known?.deployment ?? await readPoolBoundHookDeployment({ client, plan, marketIndex }, block)) };
  }))).filter((deployment): deployment is LifecyclePoolBoundHookDeployment => deployment !== undefined);
  return { profiles, hookDeployments, reasons: live.filter((profile) => !profile.admitted).map((profile) => profile.reason ?? "Unlisted lifecycle profile is unavailable") };
}

function orderedTransactions(plan: LaunchPlanV1, mode: "atomic" | "staged", progress: CanonicalLaunchProgress, approvals: readonly LifecycleTransaction[], batches: readonly number[], ufg?: PlanLaunchOptions["ufg"], capacity?: ProfiledLaunchCapacity): LifecycleTransaction[] {
  if (progress.canonical.phase === LifecyclePhase.Active || progress.canonical.phase === LifecyclePhase.Cancelled) return [];
  const prepared = progress.canonical.preparedMarkets, route = ufg === undefined ? undefined : { account: ufgPlanPrincipal(plan), config: ufg.config };
  const compiled: LifecycleTransaction[] = [];
  if (mode === "atomic") compiled.push(capacity?.atomic ?? buildLifecycleCommand(plan, { kind: "atomic" }, route));
  else {
    compiled.push(buildLifecycleCommand(plan, { kind: "begin" }, route));
    let first = 0;
    for (const count of batches) { compiled.push(buildLifecycleCommand(plan, { kind: "prepare", first, count }, route)); first += count; }
    compiled.push(capacity?.activation ?? buildLifecycleCommand(plan, { kind: "activate" }, route));
  }
  const commands = compiled.filter((transaction) =>
    (transaction.kind !== "begin" && transaction.kind !== "atomic" || progress.canonical.phase === LifecyclePhase.None) &&
    (transaction.kind !== "prepare" || (transaction.marketStart ?? 0) >= prepared));
  const transactions = progress.canonical.phase === LifecyclePhase.None ? [...approvals, ...commands] : commands;
  return transactions.map((transaction, index) => ({ ...transaction, calldataBytes: (transaction.data.length - 2) / 2, dependencies: index === 0 ? [] : [transactions[index - 1]!.id] }));
}

function attachEstimates(transactions: readonly LifecycleTransaction[], assessment: LifecyclePlanningAssessment): LifecycleTransaction[] {
  return transactions.map((transaction, index) => {
    if (index !== 0) return transaction;
    if (transaction.kind === "approve" || transaction.kind === "approve-reset") return { ...transaction, assessment };
    const estimate = assessment.estimate;
    return { ...transaction, calldataBytes: (transaction.data.length - 2) / 2, gas: estimate?.gasLimit, gasPrice: estimate?.gasPrice, estimate, assessment };
  });
}
type ReviewedNextTransaction = Pick<LifecycleTransaction, "id" | "kind" | "chainId" | "from" | "to" | "data" | "value"> & Partial<NextTransactionEnvelope>;
const reviewedTransactionKinds = ["approve-reset", "approve", "atomic", "begin", "prepare", "activate", "cancel"] as const;

function readReviewedNextTransaction(transaction: LifecycleTransaction | undefined): ReviewedNextTransaction | undefined {
  if (transaction === undefined) return undefined;
  const walletApproval = transaction?.kind === "approve" || transaction?.kind === "approve-reset";
  if (transaction === null || typeof transaction !== "object" || typeof transaction.id !== "string" ||
    !reviewedTransactionKinds.includes(transaction.kind) ||
    !Number.isSafeInteger(transaction.chainId) || transaction.chainId <= 0 ||
    typeof transaction.from !== "string" || !/^0x[\da-fA-F]{40}$/.test(transaction.from) ||
    typeof transaction.to !== "string" || !/^0x[\da-fA-F]{40}$/.test(transaction.to) ||
    typeof transaction.data !== "string" || !/^0x(?:[\da-fA-F]{2})*$/.test(transaction.data) ||
    typeof transaction.value !== "bigint" || transaction.value < 0n || transaction.value >= 1n << 256n ||
    !walletApproval && (typeof transaction.gas !== "bigint" || transaction.gas <= 0n || transaction.gas >= 1n << 64n ||
    typeof transaction.gasPrice !== "bigint" || transaction.gasPrice < 0n || transaction.gasPrice >= 1n << 256n)) {
    throw new LifecyclePlanningError("INVALID_REVIEWED_TRANSACTION", "Reviewed transaction must contain a well-formed exact chain/account/target/calldata/value and uint64 gas/uint256 price envelope");
  }
  return transaction as ReviewedNextTransaction;
}

function matchesReviewedNextTransaction(next: LifecycleTransaction | ReviewedNextTransaction | undefined, reviewed: ReviewedNextTransaction): boolean {
  return next !== undefined && next.id === reviewed.id && next.kind === reviewed.kind && next.chainId === reviewed.chainId &&
    next.from.toLowerCase() === reviewed.from.toLowerCase() && next.to.toLowerCase() === reviewed.to.toLowerCase() &&
    next.data.toLowerCase() === reviewed.data.toLowerCase() && next.value === reviewed.value;
}

function assertReviewedTransactionUnchanged(options: BuildNextTransactionOptions, reviewed: ReviewedNextTransaction | undefined, next: LifecycleTransaction): void {
  if (options.planned.ufg !== undefined) assertUfgLaunchAccount(options.planned.plan, options.planned.account);
  if (options.planned.account.toLowerCase() !== next.from.toLowerCase() || options.planned.ufg === undefined && options.planned.plan.creator.toLowerCase() !== next.from.toLowerCase()) {
    throw new LifecyclePlanningError("ACCOUNT_MISMATCH", "Execution account changed while preparing the reviewed transaction");
  }
  if (options.planned.chainId !== BigInt(next.chainId) || options.planned.plan.chainId !== BigInt(next.chainId)) {
    throw new LifecyclePlanningError("CHAIN_MISMATCH", "Execution chain changed while preparing the reviewed transaction");
  }
  const current = readReviewedNextTransaction(options.reviewedTransaction);
  if (reviewed === undefined ? current !== undefined : current === undefined || !matchesReviewedNextTransaction(current, reviewed) || !matchesReviewedNextTransaction(next, reviewed) ||
    reviewed.kind !== "approve" && reviewed.kind !== "approve-reset" &&
    (current.gas !== reviewed.gas || current.gasPrice !== reviewed.gasPrice || next.gas !== reviewed.gas || next.gasPrice !== reviewed.gasPrice)) {
    throw new LifecyclePlanningError("REVIEWED_TRANSACTION_CHANGED", "Reviewed transaction changed while preparing it");
  }
}

async function readTokenFactoryBinding(client: LifecycleRpcClient, orchestrator: Address, block: LifecycleBlock): Promise<Pick<PlannedLaunch, "tokenFactory" | "tokenFactoryCodeHash">> {
  const tokenFactory = await readLifecycleContract<Address>(client, orchestrator, launchLifecycleAbi, "tokenFactory", [], block);
  const [codeValue, authority] = await Promise.all([
    lifecycleStaticRpc(client, "eth_getCode", [tokenFactory, toHex(block.number)], block),
    readLifecycleContract<Address>(client, tokenFactory, lifecycleAdapterAbi, "core", [], block),
  ]);
  const code = rpcHex(codeValue, "token factory code");
  if (tokenFactory === zeroAddress || code === "0x" || authority.toLowerCase() !== orchestrator.toLowerCase()) throw new LifecyclePlanningError("TOKEN_FACTORY_BINDING", "Token factory is not live and bound to the exact lifecycle core");
  return { tokenFactory, tokenFactoryCodeHash: keccak256(code) };
}


function assertPlanningActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw Object.assign(new Error("Lifecycle launch planning cancelled"), { name: "AbortError" });
}

function validatePlanningIntent(options: PlanLaunchOptions): ValidatedPlanShape {
  const { plan, account, mode } = options;
  assertPlanningActive(options.signal);
  if (mode !== "atomic" && mode !== "staged") throw new LifecyclePlanningError("EXPLICIT_MODE_REQUIRED", "Choose an atomic preference or explicit staged mode");
  if (options.ufg !== undefined) assertUfgLaunchAccount(plan, account);
  else if (account.toLowerCase() !== plan.creator.toLowerCase()) throw new LifecyclePlanningError("ACCOUNT_MISMATCH", "Execution account must be the committed creator/payer/refund account");
  if (plan.chainId > BigInt(Number.MAX_SAFE_INTEGER) || plan.chainId <= 0n) throw new LifecyclePlanningError("CHAIN_MISMATCH", "Chain ID must be a positive exact JavaScript integer");
  const shape = validatePlanShape(plan);
  return options.ufg === undefined ? shape : { ...shape, ufgConfigHash: hashUfgLaunchConfig(options.ufg.config) };
}

function validatePlanTopology(options: PlanLaunchOptions, marketConfigs: ValidatedPlanShape["marketConfigs"], token: Address): void {
  for (const [marketIndex, config] of marketConfigs.entries()) {
    try {
      let tickSpacing: number;
      let openingSqrtPriceX96: bigint;
      if ("version" in config) {
        tickSpacing = config.tickSpacing;
        openingSqrtPriceX96 = config.sqrtPriceX96;
      } else {
        const tier = ABYSS_FEE_TIERS.find(({ feePips }) => feePips === config.fee);
        if (tier === undefined) throw new LifecyclePlanningError("INVALID_MARKET", "Abyss market fee must select a canonical tick-spacing tier");
        tickSpacing = tier.tickSpacing;
        openingSqrtPriceX96 = config.openingSqrtPriceX96;
      }
      assertLaunchTopologyCoverage({ positions: config.positions, openingTick: getTickAtSqrtRatio(openingSqrtPriceX96), tickSpacing,
        launchedTokenIsQuote: BigInt(token) < BigInt(options.plan.markets[marketIndex]!.quoteAsset),
        allowInteriorGaps: options.allowTopologyGaps === true });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const code = error.message.slice(0, error.message.indexOf(":"));
      if (code === "MISSING_PERMANENT_TAIL" && options.allowMissingPermanentTail === true) continue;
      if (code === "TOPOLOGY_OPENING_GAP" || code === "TOPOLOGY_INTERIOR_GAP" ||
        code === "MISSING_PERMANENT_TAIL" || code === "TOPOLOGY_OFF_GRID_TICK") {
        throw new LifecyclePlanningError(code, `Market ${marketIndex}: ${error.message}`);
      }
      throw error;
    }
  }
}

function assertFinalPlan(planned: PlannedLaunch, signal?: AbortSignal): void {
  assertPlanningActive(signal);
  if (hashLaunchPlan(planned.plan).toLowerCase() !== planned.planHash.toLowerCase() || hashLaunchIdentity(planned.plan).toLowerCase() !== planned.launchId.toLowerCase()) throw new LifecyclePlanningError("PLAN_MUTATED", "Economic plan changed during asynchronous planning; previous reads and simulation are invalid");
  if (planned.ufg !== undefined && hashUfgLaunchConfig(planned.ufg.config) !== planned.ufg.configHash) throw new LifecyclePlanningError("PLAN_MUTATED", "UFG treasury config changed during asynchronous planning");
}


/** One owner mines constructor-bound salts and protects ordered buys with exact
 * local curve math. Launch calldata is never executed during planning. */
export async function prepareAndPlanLifecycleLaunch(options: PrepareAndPlanLifecycleLaunchOptions): Promise<PlannedLaunch> {
  const { commitment, ufgConfigHash } = validatePlanningIntent(options);
  if (options.buySlippageBps !== undefined) validateBuySlippageBps(options.buySlippageBps);
  const needsMining = options.plan.markets.some((market) => isPoolBoundV4ConfigVersion(market.configVersion));
  const needsProtection = options.buySlippageBps !== undefined && options.plan.buys.length !== 0;
  if (!needsMining && !needsProtection) return planLaunch(options);
  const draft = parseLaunchPlan(serializeLaunchPlan(options.plan));
  const assertDraft = () => {
    assertPlanningActive(options.signal);
    if (hashLaunchPlan(options.plan).toLowerCase() !== commitment.toLowerCase()) throw new LifecyclePlanningError("PLAN_MUTATED", "Economic plan changed during asynchronous preparation; previous construction is invalid");
    if ((options.ufg === undefined ? undefined : hashUfgLaunchConfig(options.ufg.config)) !== ufgConfigHash) throw new LifecyclePlanningError("PLAN_MUTATED", "UFG config changed during asynchronous preparation");
  };
  const result = await withLifecycleReadClient(options.client, async (client) => {
    const block = await readLifecyclePlanningBlock(client, draft, options.account, options.ufg !== undefined, true);
    const chainId = await readLifecycleChainId(client);
    if (chainId !== draft.chainId) throw new LifecyclePlanningError("CHAIN_MISMATCH", "RPC chain differs from the economic plan being finalized");
    const metadata = needsMining ? await Promise.all(draft.markets.map((market, marketIndex) => isPoolBoundV4ConfigVersion(market.configVersion)
      ? readPoolBoundHookDeployment({ client, plan: draft, marketIndex }, block) : undefined)) : [];
    assertDraft();
    const markets = [...draft.markets];
    const minedDeployments = await mineLifecycleHooks({ client, block,
      miner: getKnownLifecycleDeployment({ chainId, orchestrator: draft.orchestrator })?.hookSaltMiner,
      deployments: metadata.flatMap((deployment, marketIndex) => deployment === undefined ? [] : [{ marketIndex, ...deployment }]),
      signal: options.signal, onProgress: options.onProgress });
    for (const mined of minedDeployments) {
      assertDraft();
      const marketIndex = mined.marketIndex;
      const market = markets[marketIndex]!;
      if (!isPoolBoundV4ConfigVersion(market.configVersion)) throw new LifecyclePlanningError("INVALID_BOUND_MARKET", "Mined market lost its explicit pool-bound version");
      markets[marketIndex] = { ...market, config: encodePoolBoundV4LifecycleMarketConfig({ ...decodePoolBoundV4LifecycleMarketConfig(market.config, market.configVersion), hookSalt: mined.salt }) };
    }
    assertDraft();
    let plan: LaunchPlanV1 = { ...draft, markets };
    let openingBuys: PlanReadContext["openingBuys"];
    if (needsProtection) {
      if (!hasProfiledOpeningMath(plan)) throw new LifecyclePlanningError("OPENING_BUY_NOT_PROFILED", "Exact opening-buy math is unavailable for this profile. Use a supported profile or update the SDK.");
      const head = await readLifecycleHeadProgress(client, plan, options.account, block);
      if (head.phase !== LifecyclePhase.None) throw new LifecyclePlanningError("LAUNCH_ALREADY_STARTED", "Buy protection cannot replace an already committed launch plan");
      const predictedToken = await readLifecycleTokenAtBlock(client, plan, block);
      openingBuys = computeLifecycleOpeningBuys({ plan, predictedToken });
      const factor = BigInt(10000 - options.buySlippageBps!);
      plan = { ...plan, buys: plan.buys.map((buy, index) => {
        const minTokenOut = openingBuys![index]!.tokenOut * factor / 10000n;
        if (minTokenOut <= 0n) throw new LifecyclePlanningError("INVALID_BUY_OUTPUT", "Each opening buy must produce a positive protected minimum");
        return { ...buy, minTokenOut };
      }) };
    }
    const planned = await lifecycleStage(client, "plan", () => planLaunchWithReads({ ...options, plan }, client, { block, openingBuys }));
    assertDraft();
    assertFinalPlan(planned, options.signal);
    if (planned.progress.canonical.phase !== LifecyclePhase.Active && planned.progress.canonical.phase !== LifecyclePhase.Cancelled) {
      for (const mined of minedDeployments) {
        const final = planned.hookDeployments.find((deployment) => deployment.marketIndex === mined.marketIndex);
        if (final === undefined || final.deployer.toLowerCase() !== mined.deployer.toLowerCase() || final.initCodeHash.toLowerCase() !== mined.initCodeHash.toLowerCase() || final.salt.toLowerCase() !== mined.salt.toLowerCase() || final.predictedHook.toLowerCase() !== mined.predictedHook.toLowerCase()) throw new LifecyclePlanningError("HOOK_DEPLOYMENT_CHANGED", "Final exact constructor binding differs from the one locally mined candidate");
      }
    }
    if (needsProtection && !planned.assessment.ready) throw new LifecyclePlanningError(planned.assessment.code ?? "PLAN_NOT_READY", planned.assessment.reason ?? "The launch could not be prepared. Refresh the review before continuing.", planned.assessment);
    return planned;
  });
  assertDraft();
  assertFinalPlan(result, options.signal);
  return result;
}

/** Fresh pinned input and deterministic gas-budget checks. No simulation or broadcasts. */
export async function planLaunch(options: PlanLaunchOptions): Promise<PlannedLaunch> {
  const result = await withLifecycleReadClient(options.client, async (client) => {
    const planned = await lifecycleStage(client, "plan", () => planLaunchWithReads(options, client));
    assertFinalPlan(planned, options.signal);
    return planned;
  });
  assertFinalPlan(result, options.signal);
  return result;
}

async function planLaunchWithReads(options: PlanLaunchOptions, client: LifecycleRpcClient, readContext: PlanReadContext = defaultPlanReadContext): Promise<PlannedLaunch> {
  const { block: pinnedBlock, openingBuys } = readContext;
  const { plan, account, ufg } = options;
  const { commitment: planHash, marketConfigs, ufgConfigHash } = validatePlanningIntent(options);
  const launchId = hashLaunchIdentity(plan);
  const [block, chainId] = await lifecycleStage(client, "plan.context", () => Promise.all([
    pinnedBlock ?? readLifecyclePlanningBlock(client, plan, account, ufg !== undefined), readLifecycleChainId(client),
  ]));
  if (chainId !== plan.chainId) throw new LifecyclePlanningError("CHAIN_MISMATCH", "RPC chain differs from the committed plan");
  assertPlanningActive(options.signal);
  const preset = getKnownLifecycleDeployment({ chainId: plan.chainId, orchestrator: plan.orchestrator });
  const [{ tokenFactory, tokenFactoryCodeHash }, { limits }, { identity, progress }] = await lifecycleStage(client, "plan.domain", () => Promise.all([
    preset ?? readTokenFactoryBinding(client, plan.orchestrator, block),
    resolveLifecycleLimits({ client, account, orchestrator: plan.orchestrator, block, chainId: plan.chainId }, options.limits),
    lifecycleStage(client, "plan.progress", async () => {
      const [predictedToken, head] = await Promise.all([
        readLifecycleTokenAtBlock(client, plan, block), readLifecycleHeadProgress(client, plan, account, block),
      ]);
      const mode = head.phase === LifecyclePhase.None ? options.mode : head.mode === 1 ? "staged" as const : "atomic" as const;
      const identity = { plan, planHash, launchId, predictedToken, account, mode, confirmations: options.confirmations ?? 1,
        ...(ufg === undefined ? {} : { ufg: { config: ufg.config, configHash: ufgConfigHash! } }) };
      if (ufg !== undefined) validateUfgLaunchPlan(plan, ufg.config, predictedToken);
      const progress = await readLaunchProgress({ client, planned: identity, receipts: options.receipts, signal: options.signal }, block);
      return { identity, progress };
    }),
  ]));
  assertPlanningActive(options.signal);
  const placeholder: LifecyclePlanningAssessment = { ready: false, blockNumber: block.number, blockHash: block.hash, account, chainId: plan.chainId, limits };
  let planned: PlannedLaunch = { ...identity, tokenFactory, tokenFactoryCodeHash, chainId: plan.chainId, transactions: [], totalCalldataBytes: 0, prerequisites: [], profiles: [], hookDeployments: [], progress, assessment: placeholder, limits: options.limits,
    allowTopologyGaps: options.allowTopologyGaps === true, allowMissingPermanentTail: options.allowMissingPermanentTail === true };
  const receiptsPending = progress.receipts.some((receipt) => receipt.status === "pending" || receipt.status === "unconfirmed");
  if (!progress.confirmationSafe || receiptsPending) {
    const hookDeployments: LifecyclePoolBoundHookDeployment[] = [];
    for (let marketIndex = 0; marketIndex < plan.markets.length; marketIndex += 1) {
      const market = plan.markets[marketIndex]!;
      if (!isPoolBoundV4ConfigVersion(market.configVersion)) continue;
      const known = deriveKnownPoolBoundHookDeployment({ plan, token: identity.predictedToken, marketIndex });
      hookDeployments.push({ marketIndex, ...(known?.deployment ?? await readPoolBoundHookDeployment({ client, plan, marketIndex }, block)) });
    }
    return { ...planned, hookDeployments, assessment: { ...placeholder,
      code: !progress.confirmationSafe ? "UNCONFIRMED_STATE" : "RECEIPT_PENDING",
      reason: !progress.confirmationSafe ? "Wait for the selected launch confirmation depth before continuing." : "Wait for the pending transaction to confirm or resolve its replacement." } };
  }
  if (progress.canonical.phase === LifecyclePhase.Active || progress.canonical.phase === LifecyclePhase.Cancelled) {
    return { ...planned, assessment: { ...placeholder, ready: true } };
  }
  if (progress.canonical.phase === LifecyclePhase.None && progress.head.phase === LifecyclePhase.None) validatePlanTopology(options, marketConfigs, identity.predictedToken);
  const [funding, metadata] = await lifecycleStage(client, "plan.inputs", () => Promise.all([
    progress.canonical.phase === LifecyclePhase.None ? readFunding(client, plan, block, ufg === undefined ? plan.creator : account, ufg !== undefined) : { prerequisites: [], approvals: [] },
    readPlanMetadata(client, plan, identity.predictedToken, block),
  ]));
  assertFinalPlan(planned, options.signal);
  const capacity = deriveLifecycleLaunchCapacity({ plan, predictedToken: identity.predictedToken, ufg, headroomBps: limits.headroomBps }, openingBuys);
  const mode = progress.canonical.phase === LifecyclePhase.None
    ? await selectLaunchMode(options.mode, plan, capacity, limits, client, block) : identity.mode;
  planned = { ...planned, mode, prerequisites: funding.prerequisites, profiles: metadata.profiles, hookDeployments: metadata.hookDeployments };
  if (metadata.reasons.length > 0) return { ...planned, assessment: { ...placeholder, code: "PROFILE_UNAVAILABLE", failureCategory: "semantic",
    reason: "The selected launch profile could not be read or is unavailable. Refresh the review before continuing." } };
  let batches: number[];
  try { batches = mode === "staged" ? await preparationBatches(plan, progress.canonical.preparedMarkets, ufg, limits, client, block) : []; }
  catch (failure) {
    if (!(failure instanceof LifecyclePlanningError) || failure.code !== "PREPARATION_GAS_LIMIT") throw failure;
    return { ...planned, assessment: { ...placeholder, code: failure.code, reason: failure.message, failureCategory: "capacity", capacityConstraint: "preparation" } };
  }
  const transactions = orderedTransactions(plan, mode, progress, funding.approvals, batches, ufg, capacity);
  const assessment = await assessLifecycleTransactions({ client, planned, limits: options.limits, signal: options.signal }, transactions, block, undefined, openingBuys, capacity);
  assertFinalPlan(planned, options.signal);
  return { ...planned, assessment, transactions: attachEstimates(transactions, assessment), totalCalldataBytes: transactions.reduce((total, transaction) => total + (transaction.data.length - 2) / 2, 0) };
}

function finalizeNextTransaction(options: BuildNextTransactionOptions, next: LifecycleTransaction, reviewed?: ReviewedNextTransaction): LifecycleTransaction {
  assertPlanningActive(options.signal);
  assertReviewedTransactionUnchanged(options, reviewed, next);
  return { ...next, dependencies: [] };
}

/** Recovery observes actual canonical receipts, then constructs and budgets only
 * the next command. No launch transaction is executed during planning. */
export async function buildNextTransaction(options: BuildNextTransactionOptions): Promise<LifecycleTransaction | undefined> {
  if (options.action !== "cancel") for (const market of options.planned.plan.markets) validateRaetoMarketContext(market);
  const original = options.planned, matches = observedFields(original);
  const assertInput = () => {
    if (options.planned !== original || !matches()) throw new LifecyclePlanningError("PLAN_MUTATED", "Stored launch context changed while constructing its next transaction");
    assertFinalPlan(original, options.signal);
  };
  const supplied = readReviewedNextTransaction(options.reviewedTransaction);
  const walletApproval = supplied?.kind === "approve" || supplied?.kind === "approve-reset";
  const reviewed = supplied === undefined ? undefined : Object.freeze({ id: supplied.id, kind: supplied.kind, chainId: supplied.chainId,
    from: supplied.from, to: supplied.to, data: supplied.data, value: supplied.value, ...(walletApproval ? {} : { gas: supplied.gas, gasPrice: supplied.gasPrice }) });
  const envelope = reviewed === undefined || walletApproval ? undefined : reviewed as NextTransactionEnvelope;
  const result = await withLifecycleReadClient(options.client, async (client) => {
    registerLifecycleFinalCheck(client, assertInput);
    const block = await readLifecyclePlanningBlock(client, original.plan, original.account, original.ufg !== undefined);
    const limitSource = options.limits === undefined ? original.limits : options.limits;
    const progress = await readLifecycleExecutionProgress({ ...options, client }, block);
    if (progress.canonical.phase === LifecyclePhase.Active || progress.canonical.phase === LifecyclePhase.Cancelled) return undefined;
    if (!progress.confirmationSafe) throw new LifecyclePlanningError("UNCONFIRMED_STATE", "Wait for the selected launch confirmation depth before continuing.");
    if (progress.receipts.some((receipt) => receipt.status === "pending" || receipt.status === "unconfirmed")) throw new LifecyclePlanningError("RECEIPT_PENDING", "Wait for the pending transaction to confirm or resolve its replacement.");
    assertPlanningActive(options.signal);
    const { limits } = await resolveLifecycleLimits({ client, account: original.account, orchestrator: original.plan.orchestrator, block, chainId: original.chainId }, limitSource);
    if (options.action === "cancel") {
      if (progress.canonical.phase === LifecyclePhase.None) throw new LifecyclePlanningError("NOT_STARTED", "An unstarted plan has no launch escrow to cancel");
      const planned = { ...original, progress };
      const transaction: LifecycleTransaction = planned.ufg !== undefined ? buildUfgCancelTransaction({ plan: planned.plan, preparedMarkets: progress.canonical.preparedMarkets })
        : { id: "cancel", kind: "cancel", chainId: Number(planned.chainId), from: planned.account, to: planned.plan.orchestrator, data: encodeFunctionData({ abi: launchLifecycleAbi, functionName: "cancelLaunch", args: [planned.plan] }), value: 0n, dependencies: [], postconditions: [{ kind: "launch", phase: "Cancelled", preparedMarkets: progress.canonical.preparedMarkets }] };
      if (reviewed !== undefined && !matchesReviewedNextTransaction(transaction, reviewed)) throw new LifecyclePlanningError("REVIEWED_TRANSACTION_MISMATCH", "Reviewed transaction differs from the current cancellation");
      const assessment = await assessLifecycleTransactions({ client, planned, limits: limitSource, signal: options.signal }, [transaction], block, envelope);
      if (!assessment.ready) throw new LifecyclePlanningError(assessment.code ?? "CANCEL_NOT_READY", assessment.reason ?? "Cancellation could not be prepared. Refresh before continuing.", assessment);
      return finalizeNextTransaction(options, attachEstimates([transaction], assessment)[0]!, reviewed);
    }
    const funding = progress.canonical.phase === LifecyclePhase.None
      ? await readFunding(client, original.plan, block, original.account, original.ufg !== undefined)
      : { prerequisites: [], approvals: [] };
    const planned = { ...original, progress, prerequisites: funding.prerequisites };
    const capacity = deriveLifecycleLaunchCapacity({ plan: planned.plan, predictedToken: planned.predictedToken, ufg: planned.ufg, headroomBps: limits.headroomBps });
    if (progress.canonical.phase === LifecyclePhase.None &&
      await selectLaunchMode(planned.mode, planned.plan, capacity, limits, client, block) !== planned.mode) {
      throw new LifecyclePlanningError("MODE_REVIEW_REQUIRED", "This launch requires staged execution. Refresh the review before continuing.");
    }
    let candidate = funding.approvals[0];
    if (candidate === undefined) {
      const prepared = progress.canonical.preparedMarkets;
      let command: LifecycleCommand;
      if (progress.canonical.phase === LifecyclePhase.None) command = { kind: planned.mode === "atomic" ? "atomic" : "begin" };
      else if (prepared < planned.plan.markets.length) {
        let count: number;
        if (reviewed?.kind === "prepare") {
          const span = /^prepare:(\d+):(\d+)$/.exec(reviewed.id);
          if (Number(span?.[1]) !== prepared) throw new LifecyclePlanningError("REVIEWED_TRANSACTION_MISMATCH", "Reviewed preparation does not start at the unfinished market");
          count = Number(span?.[2]);
        } else {
          const batches = await preparationBatches(planned.plan, prepared, planned.ufg, limits, client, block);
          count = batches[prepared > 0 ? 1 : 0]!;
        }
        if (!Number.isSafeInteger(count) || count <= 0 || prepared + count > planned.plan.markets.length) throw new LifecyclePlanningError("INVALID_PREPARATION_BATCHES", "Next preparation must cover a positive contiguous unfinished market span");
        command = { kind: "prepare", first: prepared, count };
      } else command = { kind: "activate" };
      candidate = buildLifecycleCommand(planned.plan, command, planned.ufg === undefined ? undefined : { account: ufgPlanPrincipal(planned.plan), config: planned.ufg.config });
    }
    if (reviewed !== undefined && !matchesReviewedNextTransaction(candidate, reviewed)) throw new LifecyclePlanningError("REVIEWED_TRANSACTION_MISMATCH", "Reviewed transaction differs from the current next step");
    const assessment = await assessLifecycleTransactions({ client, planned, limits: limitSource, signal: options.signal }, [candidate], block, envelope, undefined, capacity);
    assertFinalPlan(planned, options.signal);
    if (!assessment.ready) throw new LifecyclePlanningError(assessment.code ?? "PLAN_NOT_READY", assessment.reason ?? "The next launch step could not be prepared. Refresh before continuing.", assessment);
    return finalizeNextTransaction(options, attachEstimates([candidate], assessment)[0]!, reviewed);
  });
  assertInput();
  if (result !== undefined) assertReviewedTransactionUnchanged(options, reviewed, result);
  return result;
}

