import type { Address, Hash, Hex } from "viem";
import type {
  AdapterRegistrationV1, AssetFundingV1, LaunchExecutionMode, LaunchPlanV1, LaunchProgressV1,
  MarketLiveStateV1, PreparedMarketV1, ProfileRegistrationV1, ProfileTopologyV1, LaunchEnvelopeV2, LifecycleDeveloperTerms,
} from "./schema.js";

/** Local opt-in timing only: never contains request arguments, addresses, results or errors. */
export type LifecycleDiagnosticStage =
  | "plan" | "plan.context" | "plan.domain" | "plan.progress" | "plan.inputs" | "rpc"
  | "profile.certification" | "simulation.context" | "simulation.nitro"
  | "simulation.poster" | "simulation.measure" | "simulation.replay" | "simulation.envelope";
export type LifecycleDiagnosticEvent = {
  stage: LifecycleDiagnosticStage;
  phase: "queued" | "start" | "success" | "failure" | "reuse";
  durationMs?: number;
  queueMs?: number;
  requestId?: number;
  method?: string;
};
export type LifecycleDiagnosticListener = (event: LifecycleDiagnosticEvent) => void | Promise<void>;

/** viem public clients or a raw JSON-RPC client; neither selects a transport. */
export type LifecycleRpcClient = {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  /** Opt in to bounded parallel reads only when the supplied transport batches concurrent requests. */
  supportsReadBatching?: boolean;
  /** Optional local observer. Listener failures cannot change execution or admission. */
  onDiagnostic?: LifecycleDiagnosticListener;
};
export type LifecycleBlock = { number: bigint; hash: Hash; timestamp: bigint; gasLimit: bigint; baseFeePerGas?: bigint };
export type LifecycleLimitContext = { client: LifecycleRpcClient; account: Address; orchestrator: Address; block: LifecycleBlock; chainId: bigint };
export type LifecycleLimits = {
  /** Optional tightening caps on the complete transaction gas envelope, including Nitro poster gas. */
  headroomBps?: number; chainGasLimit?: bigint; rpcGasLimit?: bigint; accountGasLimit?: bigint;
  maxCalldataBytes?: number; maxSimulationGas?: bigint;
  chainId?: bigint; orchestrator?: Address; account?: Address; observedBlockNumber?: bigint; observedBlockHash?: Hash;
  /** External data fee not already charged in gas, called with exact calldata and the pinned block.
   * Nitro poster fees are included in gas and use the native NodeInterface instead. */
  estimateDataFee?: (transaction: LifecycleTransaction, context: LifecycleLimitContext) => Promise<bigint>;
};
export type LifecycleLimitSource = LifecycleLimits | ((context: LifecycleLimitContext) => Promise<LifecycleLimits>);
export type ResolvedLifecycleLimits = {
  /** Generic EVM gas ceiling; on Nitro this is the pinned compute ceiling, not total gas. */
  executionGasCeiling: bigint; transactionGasCeiling?: bigint; protocol: "evm" | "nitro";
  arbOSVersion?: bigint; maxTxComputeGas?: bigint; maxBlockComputeGas?: bigint;
  headroomBps: number; maxCalldataBytes?: number; maxSimulationGas?: bigint;
  blockGasLimit: bigint; chainGasLimit?: bigint; rpcGasLimit?: bigint; accountGasLimit?: bigint;
  unknownExecutionConstraints: readonly string[]; unknownConstraints: readonly string[];
};
/** Only explicitly disposable RPCs may execute snapshot-isolated simulation transactions. */
export type ControlledLifecycleFork = {
  client: LifecycleRpcClient; isolation: "disposable"; allowTransactions: true;
  expectedChainId?: bigint; expectedBlockHash?: Hash; impersonation?: "anvil" | "hardhat" | "none";
  receiptTimeoutMs?: number;
  sourceRpcUrl: string; forkRpcUrl: string; resetMethod?: "anvil_reset" | "hardhat_reset";
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
  /** Exact current-state execution admission, not a wallet batch or future guarantee. */
  admission?: LifecycleAdmission;
  estimate?: LifecycleTransactionEstimate;
};
export type LifecycleTransactionEstimate = {
  gasUsed: bigint; gasLimit: bigint; gasPrice: bigint; executionFee: bigint; dataFee?: bigint; totalFee?: bigint;
  /** Estimated poster allocation within gasLimit, never an exact compute measurement or an extra fee. */
  posterGas?: bigint; posterFee?: bigint; dataFeeIncludedInGas: boolean;
  feeConfidence: "execution-and-data" | "execution-only";
};
/** Proof scopes are independent: current execution is not guaranteed wallet submission. */
export type LifecycleProofOutcomes = {
  executionProof: "proved" | "failed" | "unavailable";
  protocolFit: "proved" | "failed" | "unknown";
  transportPreflight: "not-requested" | "passed" | "failed";
};
export type LifecycleAdmission = LifecycleProofOutcomes & {
  admitted: boolean; confidence: "stateful" | "provisional";
  blockNumber: bigint; blockHash: Hash; account: Address; chainId: bigint;
  reason?: string; limits: ResolvedLifecycleLimits;
};
export type LifecycleFailureCategory = "semantic" | "capacity" | "opaque" | "source" | "postcondition" | "affordability";
export type LifecycleCapacityConstraint = "compute" | "gas-envelope" | "calldata" | "simulation-gas";
export type LifecycleSimulationStep = {
  transactionId: string; success: boolean; gasUsed?: bigint; gasLimit?: bigint; gasRequired?: bigint;
  returnData?: Hex; error?: string; estimate?: LifecycleTransactionEstimate;
  failureCategory?: LifecycleFailureCategory; decodedError?: string;
  /** Safe failed-call facts only; native messages and error-data bytes are never copied here. */
  nativeErrorCode?: number;
  nativeErrorKind?: "out-of-gas" | "execution-reverted" | "vm-error" | "other" | "missing";
  nativeErrorDataBytes?: number;
  /** Explicit native simulator report, not inferred from gas consumption or the requested limit. */
  nativeGasCapped?: boolean;
};
export type LifecycleSimulation = LifecycleProofOutcomes & {
  backend: "eth_simulateV1" | "controlled-fork" | "unavailable";
  confidence: "stateful" | "provisional"; admitted: boolean;
  blockNumber: bigint; blockHash: Hash; account: Address; chainId: bigint;
  steps: readonly LifecycleSimulationStep[]; limits: ResolvedLifecycleLimits;
  reason?: string; failedTransactionId?: string;
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
};
export type LifecycleReceiptStatus = {
  transactionHash: Hash; effectiveHash: Hash; status: "pending" | "confirmed" | "reverted" | "reorged" | "unconfirmed" | "replacement-cancelled";
  blockNumber?: bigint; blockHash?: Hash; confirmations?: bigint; replaced: boolean;
};
export type CanonicalLaunchProgress = {
  canonical: LaunchProgressV1; blockNumber: bigint; blockHash: Hash; chainId: bigint;
  head: LaunchProgressV1; confirmationDepth: number; confirmedBlockNumber: bigint; confirmedBlockHash: Hash;
  confirmedAccountNonce: bigint; headAccountNonce: bigint; pendingAccountNonce: bigint; confirmationSafe: boolean;
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
  transactions: readonly LifecycleTransaction[]; prerequisites: readonly LifecycleFundingPrerequisite[];
  /** Sum of exact calldata bytes across the returned remaining commands, including approvals. */
  totalCalldataBytes: number;
  profiles: readonly (LifecycleProfile | LifecycleConstructionProfile)[]; simulation: LifecycleSimulation;
  /** Exact CREATE2 metadata captured from the final committed bound markets. */
  hookDeployments: readonly LifecyclePoolBoundHookDeployment[];
  progress: CanonicalLaunchProgress;
  preparationBatchSize: number; limits?: LifecycleLimitSource;
};
export type PlanLaunchOptions = {
  client: LifecycleRpcClient; account: Address; plan: LaunchPlanV1; mode: LaunchExecutionMode;
  limits?: LifecycleLimitSource; fork?: ControlledLifecycleFork; receipts?: readonly LifecycleReceiptReference[];
  confirmations?: number; signal?: AbortSignal;
};
export type PrepareAndPlanLifecycleLaunchOptions = PlanLaunchOptions & {
  onProgress?: (progress: PoolBoundLifecyclePreparationProgress) => void;
  /** Protect every ordered buy from its actual diagnostic receipt output, rounded down.
   * Omitted preserves the caller's committed minima. Only an unstarted launch may be protected. */
  buySlippageBps?: number;
};
export type BuildLaunchTransactionsOptions = {
  plan: LaunchPlanV1; mode: LaunchExecutionMode;
  /** Positive ordered preparation counts covering every market exactly. Staged only. */
  preparationBatches?: readonly number[];
};
export type SimulateLaunchPlanOptions = {
  client: LifecycleRpcClient; planned: PlannedLaunch; limits?: LifecycleLimitSource; fork?: ControlledLifecycleFork;
  /** Submitted receipt evidence and confirmation depth are inherited from the
   * stored plan when omitted, exactly as build-next consumes them; resimulation
   * never silently drops submitted-transaction context. */
  receipts?: readonly LifecycleReceiptReference[]; confirmations?: number;
  signal?: AbortSignal;
};
export type ReadLaunchProgressOptions = {
  client: LifecycleRpcClient; planned: Pick<PlannedLaunch, "plan" | "planHash" | "launchId" | "predictedToken" | "account" | "mode" | "confirmations">;
  receipts?: readonly LifecycleReceiptReference[]; confirmations?: number;
  signal?: AbortSignal;
};
export type BuildNextTransactionOptions = ReadLaunchProgressOptions & {
  planned: PlannedLaunch; action?: "continue" | "cancel"; limits?: LifecycleLimitSource; fork?: ControlledLifecycleFork;
  /** Optional active submission RPC. Only the immediate next exact transaction is estimated, read-only. */
  submissionClient?: LifecycleRpcClient;
  /** Untrusted reviewed next envelope. Fresh canonical semantics and complete
   * execution/headroom/affordability proof must accept its exact gas and gasPrice. */
  reviewedTransaction?: LifecycleTransaction;
};
export class LifecyclePlanningError extends Error {
  readonly code: string;
  readonly simulation?: LifecycleSimulation;
  constructor(code: string, message: string, simulation?: LifecycleSimulation) {
    super(message); this.name = "LifecyclePlanningError"; this.code = code; this.simulation = simulation;
  }
}
