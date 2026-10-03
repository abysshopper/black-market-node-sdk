import { encodeAbiParameters, encodeFunctionData, keccak256, toHex, zeroAddress, type Address, type Hex } from "viem";
import { launchLifecycleAbi, lifecycleAdapterAbi, lifecycleErc20Abi, lifecycleFundingEscrowAbi, lifecycleRegistryAbi } from "./abi.js";
import { hashLaunchIdentity, hashLaunchPlan, LifecycleFundingKind, LifecycleMode, LifecyclePhase, LifecycleRewardMode, LifecycleTokenKind, LIFECYCLE_ERC404_CAPABILITY, LIFECYCLE_MAX_REWARD_ERC20_SUPPLY, LIFECYCLE_MAX_ERC404_SUPPLY, LIFECYCLE_REQUIRED_CAPABILITIES, marketIdentityV1Components, type LaunchPlanV1, type MarketIdentityV1 } from "./schema.js";
import { readLaunchProgress, readLifecycleProfiles, validateLifecycleMarketIdentity } from "./progress.js";
import { assertLifecycleBlock, lifecycleRpc, readLifecycleBlock, readLifecycleContract, resolveLifecycleLimits, rpcHex, rpcQuantity } from "./rpc.js";
import { simulateLaunchTransactions } from "./simulation.js";
import { LifecyclePlanningError, type BuildNextTransactionOptions, type CanonicalLaunchProgress, type LifecycleBlock, type LifecycleFundingPrerequisite, type LifecycleProfile, type LifecycleRpcClient, type LifecycleSimulation, type LifecycleTransaction, type PlannedLaunch, type PlanLaunchOptions, type SimulateLaunchPlanOptions } from "./types.js";

function validatePlanShape(plan: LaunchPlanV1): void {
  // Encoding checks all exact integer widths, addresses, byte strings and tuple fields.
  hashLaunchPlan(plan);
  if (plan.markets.length === 0 || plan.markets.length > 16 || plan.buys.length > 64 || plan.funding.length > 8 || plan.feeAssets.length === 0 || plan.feeAssets.length > 8 || plan.token.supply <= 0n || plan.token.inventoryRecipient === zeroAddress || plan.executorFeeBps >= 10000) throw new LifecyclePlanningError("INVALID_PLAN", "Plan exceeds lifecycle bounds or lacks positive token economics");
  if ((plan.token.kind === LifecycleTokenKind.ERC404 && plan.token.supply > LIFECYCLE_MAX_ERC404_SUPPLY) || (plan.token.kind === LifecycleTokenKind.ERC20 && plan.token.rewardMode !== LifecycleRewardMode.None && plan.token.supply > LIFECYCLE_MAX_REWARD_ERC20_SUPPLY)) throw new LifecyclePlanningError("INVALID_TOKEN_SUPPLY", "Reward-enabled ERC20 supply must not exceed 10^77; ERC404 supply must fit uint96; reward-free ERC20 retains uint256");
  const encoder = new TextEncoder();
  if (encoder.encode(plan.token.name).length === 0 || encoder.encode(plan.token.name).length > 128 || encoder.encode(plan.token.symbol).length === 0 || encoder.encode(plan.token.symbol).length > 32 || encoder.encode(plan.token.metadataURI).length > 2048) throw new LifecyclePlanningError("INVALID_PLAN", "Token metadata exceeds the committed byte bounds");
  let previous = 0n;
  for (const policy of plan.feeAssets) {
    if (BigInt(policy.asset) <= previous || policy.ownerBps + policy.rewardsBps + policy.burnBps !== 10000) throw new LifecyclePlanningError("INVALID_FEE_POLICY", "Fee assets must be unique ascending addresses with fractions summing to 10000");
    previous = BigInt(policy.asset);
  }
  previous = 0n;
  for (const funding of plan.funding) {
    if (BigInt(funding.asset) <= previous || funding.amount <= 0n || funding.inputAmount <= 0n) throw new LifecyclePlanningError("INVALID_FUNDING", "Funding output assets must be positive, unique and ascending");
    if (funding.kind !== LifecycleFundingKind.Swap && (funding.inputAsset.toLowerCase() !== funding.asset.toLowerCase() || funding.inputAmount !== funding.amount || funding.target !== zeroAddress || funding.data !== "0x")) throw new LifecyclePlanningError("INVALID_FUNDING", "ERC20 and native-wrap funding must use the exact output asset/amount and no target call");
    previous = BigInt(funding.asset);
  }
  if (plan.markets.reduce((sum, market) => sum + market.tokenBudget, 0n) > plan.token.supply) throw new LifecyclePlanningError("INVALID_TOKEN_BUDGET", "Market token budgets exceed committed supply");
  for (const buy of plan.buys) {
    if (buy.marketIndex >= plan.markets.length || buy.quoteAmountIn <= 0n || buy.minTokenOut <= 0n || buy.recipient === zeroAddress || buy.recipient.toLowerCase() === plan.orchestrator.toLowerCase()) throw new LifecyclePlanningError("INVALID_BUY", "Every ordered buy requires a committed market, positive budget/minimum, and external recipient");
  }
  for (const market of plan.markets) {
    if (market.tokenBudget <= 0n || market.config === "0x" || (market.config.length - 2) / 2 > 16384) throw new LifecyclePlanningError("INVALID_MARKET", "Each market needs a positive token budget and bounded versioned config");
    const required = plan.buys.filter((buy) => plan.markets[buy.marketIndex]?.quoteAsset.toLowerCase() === market.quoteAsset.toLowerCase()).reduce((sum, buy) => sum + buy.quoteAmountIn, 0n);
    const funding = plan.funding.find((item) => item.asset.toLowerCase() === market.quoteAsset.toLowerCase());
    if (required > (funding?.amount ?? 0n)) throw new LifecyclePlanningError("INVALID_FUNDING", "Quote funding does not cover all ordered buys for its asset");
  }
}

async function readFunding(client: LifecycleRpcClient, plan: LaunchPlanV1, block: LifecycleBlock): Promise<{ prerequisites: LifecycleFundingPrerequisite[]; approvals: LifecycleTransaction[]; reasons: string[]; nativeValue: bigint }> {
  const escrow = await readLifecycleContract<Address>(client, plan.orchestrator, launchLifecycleAbi, "fundingEscrow", [], block);
  if ((await readLifecycleContract<Address>(client, escrow, lifecycleFundingEscrowAbi, "core", [], block)).toLowerCase() !== plan.orchestrator.toLowerCase()) throw new LifecyclePlanningError("FUNDING_BINDING", "Funding escrow authority differs from the committed orchestrator");
  const registry = await readLifecycleContract<Address>(client, plan.orchestrator, launchLifecycleAbi, "registry", [], block);
  const nativeBalance = rpcQuantity(await lifecycleRpc(client, "eth_getBalance", [plan.creator, toHex(block.number)]), "creator native balance");
  const totals = new Map<string, { asset: Address; amount: bigint; balance: bigint; allowance: bigint }>();
  const prerequisites: LifecycleFundingPrerequisite[] = [];
  const approvals: LifecycleTransaction[] = [];
  const reasons: string[] = [];
  let nativeValue = 0n;
  for (const funding of plan.funding) {
    const native = funding.kind === LifecycleFundingKind.NativeWrap || (funding.kind === LifecycleFundingKind.Swap && funding.inputAsset === zeroAddress);
    let inputBalance = nativeBalance;
    let allowance: bigint | undefined;
    if (native) nativeValue += funding.inputAmount;
    else {
      const key = funding.inputAsset.toLowerCase();
      let total = totals.get(key);
      if (total === undefined) {
        inputBalance = await readLifecycleContract<bigint>(client, funding.inputAsset, lifecycleErc20Abi, "balanceOf", [plan.creator], block);
        allowance = await readLifecycleContract<bigint>(client, funding.inputAsset, lifecycleErc20Abi, "allowance", [plan.creator, escrow], block);
        total = { asset: funding.inputAsset, amount: 0n, balance: inputBalance, allowance };
        totals.set(key, total);
      }
      total.amount += funding.inputAmount;
      inputBalance = total.balance; allowance = total.allowance;
    }
    if (funding.kind === LifecycleFundingKind.NativeWrap) {
      const wrapped = await readLifecycleContract<Address>(client, escrow, lifecycleFundingEscrowAbi, "wrappedNative", [], block);
      if (wrapped === zeroAddress || wrapped.toLowerCase() !== funding.asset.toLowerCase()) reasons.push("Committed native-wrap output is not the escrow's supported wrapped native asset");
    }
    if (funding.kind === LifecycleFundingKind.Swap) {
      const [spender, codeHash, enabled] = await readLifecycleContract<readonly [Address, Hex, boolean]>(client, registry, lifecycleRegistryAbi, "fundingTarget", [funding.target], block);
      const code = rpcHex(await lifecycleRpc(client, "eth_getCode", [funding.target, toHex(block.number)]), "funding target code");
      if (!enabled || spender === zeroAddress || code === "0x" || keccak256(code).toLowerCase() !== codeHash.toLowerCase()) reasons.push("Committed funding conversion target is not currently allowlisted with its immutable code hash");
    }
    prerequisites.push({ funding, inputBalance, requiredInput: funding.inputAmount, allowance, spender: escrow, nativeValue: native ? funding.inputAmount : 0n, conversion: funding.kind === LifecycleFundingKind.NativeWrap ? "native-wrap" : funding.kind === LifecycleFundingKind.Swap ? "allowlisted-swap" : "none" });
  }
  if (nativeBalance < nativeValue) reasons.push("Creator native balance does not cover committed native funding inputs");
  for (const total of totals.values()) {
    if (total.balance < total.amount) reasons.push(`Creator balance is below combined funding requirements for ${total.asset}`);
    if (total.allowance >= total.amount) continue;
    if (total.allowance > 0n) approvals.push({ id: `approve-reset:${total.asset}`, kind: "approve-reset", chainId: Number(plan.chainId), from: plan.creator, to: total.asset, data: encodeFunctionData({ abi: lifecycleErc20Abi, functionName: "approve", args: [escrow, 0n] }), value: 0n, dependencies: [], postconditions: [{ kind: "allowance", asset: total.asset, spender: escrow, minimum: 0n, exact: 0n }] });
    approvals.push({ id: `approve:${total.asset}`, kind: "approve", chainId: Number(plan.chainId), from: plan.creator, to: total.asset, data: encodeFunctionData({ abi: lifecycleErc20Abi, functionName: "approve", args: [escrow, total.amount] }), value: 0n, dependencies: [], postconditions: [{ kind: "allowance", asset: total.asset, spender: escrow, minimum: total.amount }] });
  }
  return { prerequisites, approvals, reasons, nativeValue };
}

async function validatePendingInputs(client: LifecycleRpcClient, planned: PlannedLaunch, progress: CanonicalLaunchProgress, block: LifecycleBlock): Promise<{ profiles: LifecycleProfile[]; reasons: string[] }> {
  const { plan } = planned;
  const profiles = await readLifecycleProfiles({ client, orchestrator: plan.orchestrator, profileIds: [...new Set(plan.markets.map((market) => market.profileId))] }, block);
  const registry = await readLifecycleContract<Address>(client, plan.orchestrator, launchLifecycleAbi, "registry", [], block);
  const reasons = profiles.filter((profile) => !profile.admitted).map((profile) => profile.reason ?? "Implementation/profile is unavailable");
  if (block.timestamp > plan.deadline) reasons.push("The immutable launch deadline has expired; cancellation remains available");
  const assets = new Set< Address >();
  for (const policy of plan.feeAssets) if (policy.asset.toLowerCase() !== planned.predictedToken.toLowerCase()) assets.add(policy.asset);
  for (const market of plan.markets) assets.add(market.quoteAsset);
  for (const funding of plan.funding) { assets.add(funding.asset); if (funding.kind !== LifecycleFundingKind.NativeWrap && funding.inputAsset !== zeroAddress) assets.add(funding.inputAsset); }
  for (const asset of assets) if (!await readLifecycleContract<boolean>(client, registry, lifecycleRegistryAbi, "assetAllowed", [asset], block)) reasons.push(`Asset ${asset} is not currently admitted`);
  const required = LIFECYCLE_REQUIRED_CAPABILITIES | (plan.token.kind === LifecycleTokenKind.ERC404 ? LIFECYCLE_ERC404_CAPABILITY : 0n);
  const identities = new Set<string>();
  for (let index = 0; index < plan.markets.length; index += 1) {
    const market = plan.markets[index];
    if (market === undefined) throw new LifecyclePlanningError("INVALID_PLAN", "Market missing from ordered plan");
    const profile = profiles.find((item) => item.id.toLowerCase() === market.profileId.toLowerCase());
    if (profile === undefined || !profile.admitted) continue;
    try {
      const adapter = await readLifecycleContract<Address>(client, registry, lifecycleRegistryAbi, "requireEligible", [market.adapterId, market.profileId, market.configVersion, required], block);
      const identity = await readLifecycleContract<MarketIdentityV1>(client, adapter, lifecycleAdapterAbi, "resolve", [planned.launchId, planned.predictedToken, market], block);
      validateLifecycleMarketIdentity(identity, plan, planned.predictedToken, index);
      if (identity.factory.toLowerCase() !== profile.registration.factory.toLowerCase() || identity.hook.toLowerCase() !== profile.registration.hook.toLowerCase() || (identity.venue === 0 && identity.manager.toLowerCase() !== profile.registration.venue.toLowerCase()) || (identity.venue === 1 && identity.factory.toLowerCase() !== profile.registration.venue.toLowerCase())) throw new LifecyclePlanningError("MARKET_IDENTITY", "Canonical venue dependencies differ from immutable profile approval");
      if (identities.has(identity.canonicalId.toLowerCase())) throw new LifecyclePlanningError("DUPLICATE_MARKET", "Two committed markets resolve to the same canonical pool");
      identities.add(identity.canonicalId.toLowerCase());
      const prepared = progress.markets.find((item) => item.index === index);
      if (prepared !== undefined) {
        const resolvedHash = keccak256(encodeAbiParameters([{ type: "tuple", components: marketIdentityV1Components }], [identity]));
        const preparedHash = keccak256(encodeAbiParameters([{ type: "tuple", components: marketIdentityV1Components }], [prepared.prepared.identity]));
        if (resolvedHash !== preparedHash || prepared.live === undefined || prepared.live.publicTrading || prepared.live.liquidity !== 0n || prepared.live.sqrtPriceX96 !== identity.openingSqrtPriceX96) throw new LifecyclePlanningError("OPENING_CHANGED", "Prepared market is not at its committed empty canonical opening state");
        await readLifecycleContract<undefined>(client, adapter, lifecycleAdapterAbi, "validatePrepared", [planned.launchId, index, planned.predictedToken, market, prepared.prepared.identity], block);
      }
    } catch (failure) { reasons.push(failure instanceof Error ? failure.message : String(failure)); }
  }
  if (progress.canonical.phase !== LifecyclePhase.None) {
    for (const funding of plan.funding) {
      const balance = await readLifecycleContract<bigint>(client, plan.orchestrator, launchLifecycleAbi, "escrowBalance", [planned.launchId, funding.asset], block);
      const needed = plan.buys.filter((buy) => plan.markets[buy.marketIndex]?.quoteAsset.toLowerCase() === funding.asset.toLowerCase()).reduce((sum, buy) => sum + buy.quoteAmountIn, 0n);
      if (balance < needed) reasons.push(`Launch-isolated ${funding.asset} escrow cannot cover every committed buy`);
    }
  }
  return { profiles, reasons };
}

function orderedTransactions(plan: LaunchPlanV1, mode: "atomic" | "staged", progress: CanonicalLaunchProgress, approvals: readonly LifecycleTransaction[], nativeValue: bigint, batchSize: number): LifecycleTransaction[] {
  const transactions: LifecycleTransaction[] = [];
  if (progress.canonical.phase === LifecyclePhase.Active || progress.canonical.phase === LifecyclePhase.Cancelled) return transactions;
  const base = { chainId: Number(plan.chainId), from: plan.creator, to: plan.orchestrator, dependencies: [] as string[] };
  if (progress.canonical.phase === LifecyclePhase.None) {
    transactions.push(...approvals);
    if (mode === "atomic") {
      transactions.push({ ...base, id: "atomic", kind: "atomic", data: encodeFunctionData({ abi: launchLifecycleAbi, functionName: "launchAtomic", args: [plan] }), value: nativeValue, postconditions: [{ kind: "launch", phase: "Active", preparedMarkets: plan.markets.length }] });
    } else {
      transactions.push({ ...base, id: "begin", kind: "begin", data: encodeFunctionData({ abi: launchLifecycleAbi, functionName: "beginLaunch", args: [plan, LifecycleMode.Staged] }), value: nativeValue, postconditions: [{ kind: "launch", phase: "Preparing", preparedMarkets: 0 }] });
    }
  }
  if (mode === "staged") {
    for (let first = progress.canonical.preparedMarkets; first < plan.markets.length; first += batchSize) {
      const count = Math.min(batchSize, plan.markets.length - first);
      const completed = first + count;
      transactions.push({ ...base, id: `prepare:${first}:${count}`, kind: "prepare", data: encodeFunctionData({ abi: launchLifecycleAbi, functionName: "prepareMarkets", args: [plan, first, count] }), value: 0n, marketStart: first, marketCount: count, postconditions: [{ kind: "launch", phase: completed === plan.markets.length ? "Ready" : "Preparing", preparedMarkets: completed }] });
    }
    transactions.push({ ...base, id: "activate", kind: "activate", data: encodeFunctionData({ abi: launchLifecycleAbi, functionName: "activateLaunch", args: [plan] }), value: 0n, postconditions: [{ kind: "launch", phase: "Active", preparedMarkets: plan.markets.length }] });
  }
  return transactions.map((transaction, index) => ({ ...transaction, dependencies: index === 0 ? [] : [transactions[index - 1]?.id ?? ""] }));
}

function attachEstimates(transactions: readonly LifecycleTransaction[], simulation: LifecycleSimulation): LifecycleTransaction[] {
  return transactions.map((transaction) => {
    const estimate = simulation.steps.find((step) => step.transactionId === transaction.id)?.estimate;
    return { ...transaction, gas: estimate?.gasLimit, gasPrice: estimate?.gasPrice, estimate, admission: { admitted: simulation.admitted, confidence: simulation.confidence, reason: simulation.reason, limits: simulation.limits } };
  });
}

/** Exact economic commitment with explicit execution mode and current-state admission. No broadcasts. */
export async function planLaunch(options: PlanLaunchOptions): Promise<PlannedLaunch> {
  const { client, plan, account, mode } = options;
  if (mode !== "atomic" && mode !== "staged") throw new LifecyclePlanningError("EXPLICIT_MODE_REQUIRED", "Choose atomic or staged explicitly; staged is never silently substituted");
  if (account.toLowerCase() !== plan.creator.toLowerCase()) throw new LifecyclePlanningError("ACCOUNT_MISMATCH", "Execution account must be the committed creator/payer/refund account");
  if (plan.chainId > BigInt(Number.MAX_SAFE_INTEGER) || plan.chainId <= 0n) throw new LifecyclePlanningError("CHAIN_MISMATCH", "Chain ID must be a positive exact JavaScript integer");
  validatePlanShape(plan);
  const block = await readLifecycleBlock(client);
  if (rpcQuantity(await lifecycleRpc(client, "eth_chainId"), "chain ID") !== plan.chainId) throw new LifecyclePlanningError("CHAIN_MISMATCH", "RPC chain differs from the committed plan");
  const planHash = hashLaunchPlan(plan); const launchId = hashLaunchIdentity(plan);
  const remoteHash = await readLifecycleContract<Hex>(client, plan.orchestrator, launchLifecycleAbi, "hashPlan", [plan], block);
  const remoteIdentity = await readLifecycleContract<Hex>(client, plan.orchestrator, launchLifecycleAbi, "launchIdOf", [plan], block);
  if (remoteHash.toLowerCase() !== planHash.toLowerCase() || remoteIdentity.toLowerCase() !== launchId.toLowerCase()) throw new LifecyclePlanningError("ABI_DOMAIN_MISMATCH", "Selected contract does not implement the exact lifecycle V1 plan domain/schema");
  const predictedToken = await readLifecycleContract<Address>(client, plan.orchestrator, launchLifecycleAbi, "predictToken", [plan], block);
  const { limits } = await resolveLifecycleLimits({ client, account, orchestrator: plan.orchestrator, block, chainId: plan.chainId }, options.limits);
  const placeholder: LifecycleSimulation = { backend: "unavailable", confidence: "provisional", admitted: false, blockNumber: block.number, blockHash: block.hash, account, chainId: plan.chainId, limits, steps: [] };
  const identity = { plan, planHash, launchId, predictedToken, account, mode, confirmations: options.confirmations ?? 1 };
  const progress = await readLaunchProgress({ client, planned: identity, receipts: options.receipts }, block);
  let planned: PlannedLaunch = { ...identity, chainId: plan.chainId, transactions: [], prerequisites: [], profiles: [], progress, simulation: placeholder, atomicAttempt: placeholder, preparationBatchSize: plan.markets.length, limits: options.limits };
  if (!progress.confirmationSafe) {
    const waiting = { ...placeholder, confidence: "stateful" as const, reason: "Canonical confirmed progress/account nonce has not caught up with head or pending transactions; wait for the selected confirmation depth" };
    await assertLifecycleBlock(client, block);
    return { ...planned, simulation: waiting, atomicAttempt: waiting };
  }
  if (progress.receipts.some((receipt) => receipt.status === "pending" || receipt.status === "unconfirmed")) {
    // Submitted receipt evidence gates plan admission exactly as it gates
    // build-next; resimulation must not re-admit unacknowledged work.
    const waitingReceipts = { ...placeholder, confidence: "stateful" as const, reason: "Wait for canonical receipt confirmations or resolve replacement before requesting another transaction" };
    await assertLifecycleBlock(client, block);
    return { ...planned, simulation: waitingReceipts, atomicAttempt: waitingReceipts };
  }
  if (progress.canonical.phase === LifecyclePhase.Active || progress.canonical.phase === LifecyclePhase.Cancelled) {
    await assertLifecycleBlock(client, block);
    return { ...planned, simulation: { ...placeholder, confidence: "stateful", admitted: true, reason: "Canonical launch is terminal; no transaction remains" } };
  }
  const prerequisites = progress.canonical.phase === LifecyclePhase.None ? await readFunding(client, plan, block) : { prerequisites: [], approvals: [], nativeValue: 0n, reasons: [] };
  const validation = await validatePendingInputs(client, planned, progress, block);
  const reasons = [...prerequisites.reasons, ...validation.reasons];
  planned = { ...planned, prerequisites: prerequisites.prerequisites, profiles: validation.profiles };
  if (reasons.length > 0) {
    const rejected = { ...placeholder, confidence: "stateful" as const, reason: reasons.join("; ") };
    await assertLifecycleBlock(client, block);
    return { ...planned, simulation: rejected, atomicAttempt: rejected, transactions: orderedTransactions(plan, mode, progress, prerequisites.approvals, prerequisites.nativeValue, planned.preparationBatchSize) };
  }
  let atomicAttempt: LifecycleSimulation = { ...placeholder, reason: "Atomic execution cannot be evaluated from an already begun staged launch" };
  if (progress.canonical.phase === LifecyclePhase.None) {
    const atomicTransactions = orderedTransactions(plan, "atomic", progress, prerequisites.approvals, prerequisites.nativeValue, plan.markets.length);
    atomicAttempt = await simulateLaunchTransactions({ client, planned, limits: options.limits, fork: options.fork }, atomicTransactions, block);
    if (mode === "atomic") {
      const reason = atomicAttempt.admitted ? undefined : `${atomicAttempt.reason ?? "Exact atomic plan is not admitted"}; choose staged explicitly only if empty preparation can be partitioned and complete activation fits`;
      const simulation = { ...atomicAttempt, reason };
      return { ...planned, atomicAttempt, simulation, transactions: attachEstimates(atomicTransactions, simulation) };
    }
  }
  let preparationBatchSize = plan.markets.length;
  let transactions = orderedTransactions(plan, "staged", progress, prerequisites.approvals, prerequisites.nativeValue, preparationBatchSize);
  let simulation = await simulateLaunchTransactions({ client, planned, limits: options.limits, fork: options.fork }, transactions, block);
  while (!simulation.admitted && simulation.confidence === "stateful" && simulation.failedTransactionId?.startsWith("prepare:") && preparationBatchSize > 1) {
    preparationBatchSize = Math.ceil(preparationBatchSize / 2);
    transactions = orderedTransactions(plan, "staged", progress, prerequisites.approvals, prerequisites.nativeValue, preparationBatchSize);
    simulation = await simulateLaunchTransactions({ client, planned, limits: options.limits, fork: options.fork }, transactions, block);
  }
  if (!simulation.admitted && simulation.failedTransactionId === "activate") simulation = { ...simulation, reason: `${simulation.reason ?? "Final activation failed"}; final mint/lock/all-buys/public-opening is indivisible and will not be partitioned` };
  return { ...planned, atomicAttempt, simulation, preparationBatchSize, transactions: attachEstimates(transactions, simulation) };
}

/** Re-reads canonical state, revalidates all prerequisites, and proves the remaining sequence afresh. */
export async function buildNextTransaction(options: BuildNextTransactionOptions): Promise<LifecycleTransaction | undefined> {
  const block = await readLifecycleBlock(options.client);
  const progress = await readLaunchProgress(options, block);
  if (progress.canonical.phase === LifecyclePhase.Active || progress.canonical.phase === LifecyclePhase.Cancelled) {
    // Only the confirmed canonical terminal phase is terminal; a head-only
    // Active observation is not, and the confirmation/nonce/receipt gates below
    // remain in force for every nonterminal case.
    await assertLifecycleBlock(options.client, block);
    return undefined;
  }
  if (!progress.confirmationSafe) throw new LifecyclePlanningError("UNCONFIRMED_STATE", "Wait for confirmed canonical progress and account nonce, including untracked approvals/replacements, before constructing the next transaction");
  if (progress.receipts.some((receipt) => receipt.status === "pending" || receipt.status === "unconfirmed")) throw new LifecyclePlanningError("RECEIPT_PENDING", "Wait for canonical receipt confirmations or resolve replacement before requesting another transaction");
  if (options.action === "cancel") {
    if (progress.canonical.phase === LifecyclePhase.None) throw new LifecyclePlanningError("NOT_STARTED", "An unstarted plan has no launch escrow to cancel");
    const { planned } = options;
    const transaction: LifecycleTransaction = { id: "cancel", kind: "cancel", chainId: Number(planned.chainId), from: planned.account, to: planned.plan.orchestrator, data: encodeFunctionData({ abi: launchLifecycleAbi, functionName: "cancelLaunch", args: [planned.plan] }), value: 0n, dependencies: [], postconditions: [{ kind: "launch", phase: "Cancelled", preparedMarkets: progress.canonical.preparedMarkets }] };
    const simulation = await simulateLaunchTransactions({ client: options.client, planned, limits: options.limits ?? planned.limits, fork: options.fork }, [transaction], block);
    if (!simulation.admitted) throw new LifecyclePlanningError("CANCEL_NOT_ADMITTED", simulation.reason ?? "Cancellation could not be proved against current canonical state", simulation);
    return attachEstimates([transaction], simulation)[0];
  }
  const refreshed = await planLaunch({ client: options.client, plan: options.planned.plan, account: options.planned.account, mode: options.planned.mode, limits: options.limits ?? options.planned.limits, fork: options.fork, receipts: options.receipts, confirmations: options.confirmations ?? options.planned.confirmations });
  if (!refreshed.simulation.admitted) throw new LifecyclePlanningError("PLAN_NOT_ADMITTED", refreshed.simulation.reason ?? "Remaining exact launch sequence is not admitted", refreshed.simulation);
  const next = refreshed.transactions[0];
  if (next === undefined) return undefined;
  if (next.gas === undefined || next.gasPrice === undefined || next.gas > refreshed.simulation.limits.executionGasCeiling) throw new LifecyclePlanningError("MISSING_GAS_PROOF", "Next transaction has no current-state exact gas/headroom/fee-envelope proof");
  return { ...next, dependencies: [] };
}

/** Re-simulates only canonical unfinished work with the same submitted receipt
 * evidence and confirmation depth as build-next, never silently dropping context. */
export async function simulateLaunchPlan(options: SimulateLaunchPlanOptions): Promise<LifecycleSimulation> {
  const { client, planned } = options;
  if (hashLaunchPlan(planned.plan).toLowerCase() !== planned.planHash.toLowerCase() || hashLaunchIdentity(planned.plan).toLowerCase() !== planned.launchId.toLowerCase()) throw new LifecyclePlanningError("PLAN_MUTATED", "Stored economic plan no longer matches its commitment");
  const current = await planLaunch({
    client, plan: planned.plan, account: planned.account, mode: planned.mode,
    limits: options.limits ?? planned.limits, fork: options.fork,
    receipts: options.receipts, confirmations: options.confirmations ?? planned.confirmations,
  });
  return current.simulation;
}
