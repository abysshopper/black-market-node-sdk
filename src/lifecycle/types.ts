import type { Address, Hash, Hex } from "viem";
import type { UfgLaunchConfig } from "./ufg-config.js";
import type {
  AdapterRegistrationV1, AssetFundingV1, LaunchExecutionMode, LaunchPlanV1, LaunchProgressV1,
  MarketLiveStateV1, PreparedMarketV1, ProfileRegistrationV1, ProfileTopologyV1, LaunchEnvelopeV2, LifecycleDeveloperTerms,
} from "./schema.js";

/** Local opt-in timing only: never contains request arguments, addresses, results or errors. */
export type LifecycleDiagnosticStage =
  | "plan" | "plan.context" | "plan.domain" | "plan.progress" | "plan.inputs" | "rpc"
  | "profile.certification" | "session-cache";
export type LifecycleDiagnosticEvent = {
  stage: LifecycleDiagnosticStage;
  phase: "queued" | "start" | "success" | "failure" | "reuse";
  durationMs?: number;
  queueMs?: number;
  requestId?: number;
  method?: string;
  /** Static session hits/misses and invocation-local static reuse; counts only. */
  hits?: number;
  misses?: number;
  reuses?: number;
};
export type LifecycleDiagnosticListener = (event: LifecycleDiagnosticEvent) => void | Promise<void>;

/** viem public clients or a raw JSON-RPC client; neither selects a transport. */
export type LifecycleRpcClient = {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  /** Opt in to bounded parallel reads only when the supplied transport batches concurrent requests. */
  supportsReadBatching?: boolean;
  /** Optional local observer. Listener failures cannot change planning or sending. */
  onDiagnostic?: LifecycleDiagnosticListener;
  /** Caller-owned, opt-in static observations; create with createLifecycleSessionCache(). */
  sessionCache?: LifecycleSessionCache;
};
export type LifecycleBlock = { number: bigint; hash: Hash; timestamp: bigint; gasLimit: bigint; baseFeePerGas?: bigint };
/** A session retains pinned static reads and deployment metadata observations. */
export type LifecycleSessionCache = {
  readonly block: Readonly<Pick<LifecycleBlock, "number" | "hash">> | undefined;
  /** Call on wallet/chain changes and after every confirmed transaction. */
  invalidate(): void;
};
export type LifecycleLimitContext = { client: LifecycleRpcClient; account: Address; orchestrator: Address; block: LifecycleBlock; chainId: bigint };
export type LifecycleLimits = {
  /** Optional tightening caps on the complete transaction gas envelope, including Nitro poster gas. */
  headroomBps?: number; chainGasLimit?: bigint; rpcGasLimit?: bigint; accountGasLimit?: bigint;
  maxCalldataBytes?: number;
  chainId?: bigint; orchestrator?: Address; account?: Address; observedBlockNumber?: bigint; observedBlockHash?: Hash;
  /** External data fee not already charged in gas, called with exact calldata and the pinned block.
   * Nitro poster fees are already included in gas, bounded locally from same-review ArbGasInfo prices. */
  estimateDataFee?: (transaction: LifecycleTransaction, context: LifecycleLimitContext) => Promise<bigint>;
};
export type LifecycleLimitSource = LifecycleLimits | ((context: LifecycleLimitContext) => Promise<LifecycleLimits>);
export type ResolvedLifecycleLimits = {
  /** Fixed native transaction ceiling, including poster gas; caller caps may refuse but never resize it. */
  executionGasCeiling: bigint; transactionGasCeiling?: bigint; protocol: "evm" | "nitro";
  headroomBps: number; maxCalldataBytes?: number;
  blockGasLimit: bigint; chainGasLimit?: bigint; rpcGasLimit?: bigint; accountGasLimit?: bigint;
  unknownExecutionConstraints: readonly string[]; unknownConstraints: readonly string[];
};
export type LifecycleTransactionKind = "approve-reset" | "approve" | "atomic" | "begin" | "prepare" | "activate" | "cancel";
export type LifecyclePostcondition =
  | { kind: "allowance"; asset: Address; spender: Address; minimum: bigint; exact?: bigint }
  | { kind: "launch"; phase: "Preparing" | "Ready" | "Active" | "Cancelled"; preparedMarkets: number };
export type LifecycleTransaction = {
  id: string; kind: LifecycleTransactionKind; chainId: number; from: Address; to: Address; data: Hex; value: bigint;
  dependencies: readonly string[]; postconditions: readonly LifecyclePostcondition[];
  marketStart?: number; marketCount?: number; gas?: bigint; gasPrice?: bigint;
  /** Exact encoded byte count; populated on SDK-built commands, including approvals. */
  calldataBytes?: number;
  /** Only the immediate command receives current planning checks and fees.
   * Launch gas is the native ceiling; approvals leave gas to the wallet. */
  assessment?: LifecyclePlanningAssessment;
  estimate?: LifecycleTransactionEstimate;
};
export type LifecycleTransactionEstimate = {
  gasLimit: bigint; gasPrice: bigint; executionFee: bigint; dataFee?: bigint; totalFee?: bigint;
  /** Estimated poster allocation within gasLimit, never a measured or additional fee. */
  posterGas?: bigint; posterFee?: bigint; dataFeeIncludedInGas: boolean;
  feeConfidence: "native-ceiling-and-data" | "native-ceiling-only";
};
export type LifecycleFailureCategory = "semantic" | "capacity" | "affordability";
export type LifecycleCapacityConstraint = "gas-envelope" | "calldata" | "activation" | "preparation";
export type LifecycleOpeningBuyQuote = {
  buyIndex: number; marketIndex: number; quoteAmountIn: bigint; quoteSpent: bigint;
  tokenOut: bigint; sqrtPriceAfterX96: bigint;
};
/** Versioned compute budgets with headroom, never transaction gas-limit sizing.
 * Atomic budget is absent for launches with more than one market. */
export type LifecycleLaunchGasBounds = {
  atomicComputeGasUpperBound?: bigint; activationComputeGasUpperBound: bigint;
};
export type LifecycleGasProfile = {
  version: string; bounds: LifecycleLaunchGasBounds;
  initialBuys: readonly LifecycleOpeningBuyQuote[];
};
/** Pinned input and gas-budget checks only. No transaction is simulated or proved. */
export type LifecyclePlanningAssessment = {
  ready: boolean;
  blockNumber: bigint; blockHash: Hash; account: Address; chainId: bigint;
  limits: ResolvedLifecycleLimits;
  /** Immediate native-ceiling fee budget; absent for wallet-prepared approvals. */
  estimate?: LifecycleTransactionEstimate;
  gasProfile?: LifecycleGasProfile;
  /** Controlled SDK code and user-safe actionable reason, never raw provider errors. */
  code?: string; reason?: string; failedTransactionId?: string;
  failureCategory?: LifecycleFailureCategory; capacityConstraint?: LifecycleCapacityConstraint;
};
export type LifecycleFundingPrerequisite = {
  funding: AssetFundingV1; inputBalance: bigint; requiredInput: bigint;
  allowance?: bigint; spender: Address; nativeValue: bigint; conversion: "none" | "native-wrap" | "allowlisted-swap";
};
export type LifecycleProfile = {
  id: Hex; registration: ProfileRegistrationV1; adapter: AdapterRegistrationV1; topology: ProfileTopologyV1;
  venueKind: "uniswap-v4" | "abyss" | "unknown";
  envelope?: LaunchEnvelopeV2; developerTerms?: LifecycleDeveloperTerms; protocolMaximumDeveloperFeeBps?: number;
  admitted: boolean; reason?: string;
};
/** Release construction data only. Current registry eligibility is not asserted. */
export type LifecycleConstructionProfile = Omit<LifecycleProfile, "admitted" | "reason"> & { metadataSource: "preset" };
export type LifecycleMarketProgress = {
  index: number; prepared: PreparedMarketV1; live?: MarketLiveStateV1; error?: string;
};
export type LifecycleReceiptReference = {
  transactionHash: Hash; replacementHash?: Hash; confirmations?: number;
  observedBlockNumber?: bigint; observedBlockHash?: Hash;
  /** Actual submitted nonce from the wallet/transaction observation, never a planning guess. */
  nonce?: bigint;
};
export type LifecycleReceiptStatus = {
  transactionHash: Hash; effectiveHash: Hash; status: "pending" | "confirmed" | "reverted" | "reorged" | "unconfirmed" | "replacement-cancelled";
  blockNumber?: bigint; blockHash?: Hash; confirmations?: bigint; replaced: boolean; nonce?: bigint;
};
export type CanonicalLaunchProgress = {
  canonical: LaunchProgressV1; blockNumber: bigint; blockHash: Hash; chainId: bigint;
  head: LaunchProgressV1; confirmationDepth: number; confirmedBlockNumber: bigint; confirmedBlockHash: Hash;
  /** Confirmed launch state only; unrelated account pending transactions do not block it. */
  confirmationSafe: boolean;
  markets: readonly LifecycleMarketProgress[]; receipts: readonly LifecycleReceiptStatus[];
  token: Address; planHash: Hash; launchId: Hash;
};
export type PoolBoundHookDeployment = { deployer: Address; initCodeHash: Hex; salt: Hex; predictedHook: Address };
export type LifecyclePoolBoundHookDeployment = PoolBoundHookDeployment & { marketIndex: number };
export type PoolBoundHookSaltProgress = { attempts: bigint; salt: Hex; predictedHook: Address };
export type PoolBoundLifecyclePreparationProgress = PoolBoundHookSaltProgress & { marketIndex: number };
export type PlannedLaunch = {
  plan: LaunchPlanV1; planHash: Hash; launchId: Hash; predictedToken: Address;
  tokenFactory: Address; tokenFactoryCodeHash: Hex;
  account: Address; chainId: bigint; mode: LaunchExecutionMode; confirmations: number;
  /** Opt-in proxy routing; the committed creator remains the proxy, account is its principal. */
  ufg?: { config: UfgLaunchConfig; configHash: Hash };
  /** Only transactions[0] has fresh immediate planning checks/fees. Launch gas is
   * the native ceiling; wallet-assigned nonce and approval gas are omitted. */
  transactions: readonly LifecycleTransaction[]; prerequisites: readonly LifecycleFundingPrerequisite[];
  /** Sum of exact calldata bytes across the returned remaining commands, including approvals. */
  totalCalldataBytes: number;
  profiles: readonly (LifecycleProfile | LifecycleConstructionProfile)[]; assessment: LifecyclePlanningAssessment;
  /** Exact CREATE2 metadata captured from the final committed bound markets. */
  hookDeployments: readonly LifecyclePoolBoundHookDeployment[];
  progress: CanonicalLaunchProgress;
  limits?: LifecycleLimitSource;
  /** Unstarted-launch construction choices; never part of committed calldata. */
  allowTopologyGaps?: boolean; allowMissingPermanentTail?: boolean;
};
export type PlanLaunchOptions = {
  client: LifecycleRpcClient; account: Address; plan: LaunchPlanV1;
  /** Atomic requires one market and a known budget, including conversions, fitting with headroom.
   * All other unstarted launches are staged; started launches retain canonical mode. */
  mode: LaunchExecutionMode; limits?: LifecycleLimitSource; receipts?: readonly LifecycleReceiptReference[];
  confirmations?: number; signal?: AbortSignal;
  /** Opt in to the pinned UFG proxy; sender must match the nonce's principal namespace. */
  ufg?: { config: UfgLaunchConfig };
  /** Unstarted only: permit interior gaps; opening containment, aligned ticks and the tail remain required. */
  allowTopologyGaps?: boolean;
  /** Unstarted only: waive the funded boundary tail; all other topology checks remain required. */
  allowMissingPermanentTail?: boolean;
};
export type PrepareAndPlanLifecycleLaunchOptions = PlanLaunchOptions & {
  onProgress?: (progress: PoolBoundLifecyclePreparationProgress) => void;
  /** Protect ordered buys from exact local curve outputs, rounded down.
   * Omitted preserves committed minima; unstarted launches only. */
  buySlippageBps?: number;
};
export type BuildLaunchTransactionsOptions = {
  plan: LaunchPlanV1; mode: LaunchExecutionMode;
  /** Positive ordered preparation counts covering every market exactly. Staged only. */
  preparationBatches?: readonly number[];
};
export type ReadLaunchProgressOptions = {
  client: LifecycleRpcClient; planned: Pick<PlannedLaunch, "plan" | "planHash" | "launchId" | "predictedToken" | "account" | "mode" | "confirmations" | "ufg">;
  receipts?: readonly LifecycleReceiptReference[]; confirmations?: number;
  signal?: AbortSignal;
};
export type BuildNextTransactionOptions = ReadLaunchProgressOptions & {
  planned: PlannedLaunch; action?: "continue" | "cancel"; limits?: LifecycleLimitSource;
  /** Untrusted reviewed intent/fee. Gas differing from the native ceiling is stale;
   * never resize it, bump a held fee or assign a wallet nonce. */
  reviewedTransaction?: LifecycleTransaction;
};
export class LifecyclePlanningError extends Error {
  readonly code: string;
  readonly assessment?: LifecyclePlanningAssessment;
  constructor(code: string, message: string, assessment?: LifecyclePlanningAssessment) {
    super(message); this.name = "LifecyclePlanningError"; this.code = code; this.assessment = assessment;
  }
}
