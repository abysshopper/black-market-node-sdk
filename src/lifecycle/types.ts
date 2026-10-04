import type { Address, Hash, Hex } from "viem";
import type {
  AdapterRegistrationV1, AssetFundingV1, LaunchExecutionMode, LaunchPlanV1, LaunchProgressV1,
  MarketLiveStateV1, PreparedMarketV1, ProfileRegistrationV1, ProfileTopologyV1,
} from "./schema.js";

/** viem public clients or a raw JSON-RPC client; neither selects a transport. */
export type LifecycleRpcClient = {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
};
export type LifecycleBlock = { number: bigint; hash: Hash; timestamp: bigint; gasLimit: bigint; baseFeePerGas?: bigint };
export type LifecycleLimitContext = { client: LifecycleRpcClient; account: Address; orchestrator: Address; block: LifecycleBlock; chainId: bigint };
export type LifecycleLimits = {
  headroomBps?: number; chainGasLimit?: bigint; rpcGasLimit?: bigint; accountGasLimit?: bigint;
  maxCalldataBytes?: number; maxSimulationGas?: bigint;
  chainId?: bigint; orchestrator?: Address; account?: Address; observedBlockNumber?: bigint; observedBlockHash?: Hash;
  /** Chain-specific L1/data-fee oracle, called with exact calldata and the pinned block. */
  estimateDataFee?: (transaction: LifecycleTransaction, context: LifecycleLimitContext) => Promise<bigint>;
};
export type LifecycleLimitSource = LifecycleLimits | ((context: LifecycleLimitContext) => Promise<LifecycleLimits>);
export type ResolvedLifecycleLimits = {
  executionGasCeiling: bigint; headroomBps: number; maxCalldataBytes?: number; maxSimulationGas?: bigint;
  blockGasLimit: bigint; chainGasLimit?: bigint; rpcGasLimit?: bigint; accountGasLimit?: bigint;
  admissionKnown: boolean; unknownExecutionConstraints: readonly string[]; unknownConstraints: readonly string[];
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
  /** Exact current-state execution admission, not a wallet batch or future guarantee. */
  admission?: LifecycleAdmission;
  estimate?: LifecycleTransactionEstimate;
};
export type LifecycleTransactionEstimate = {
  gasUsed: bigint; gasLimit: bigint; gasPrice: bigint; executionFee: bigint; dataFee?: bigint; totalFee?: bigint;
  feeConfidence: "execution-and-data" | "execution-only";
};
export type LifecycleAdmission = {
  admitted: boolean; confidence: "stateful" | "provisional";
  reason?: string; limits: ResolvedLifecycleLimits;
};
export type LifecycleSimulationStep = {
  transactionId: string; success: boolean; gasUsed?: bigint; gasLimit?: bigint; gasRequired?: bigint;
  returnData?: Hex; error?: string; estimate?: LifecycleTransactionEstimate;
};
export type LifecycleSimulation = {
  backend: "eth_simulateV1" | "controlled-fork" | "unavailable";
  confidence: "stateful" | "provisional"; admitted: boolean;
  blockNumber: bigint; blockHash: Hash; account: Address; chainId: bigint;
  steps: readonly LifecycleSimulationStep[]; limits: ResolvedLifecycleLimits;
  reason?: string; failedTransactionId?: string;
};
export type LifecycleFundingPrerequisite = {
  funding: AssetFundingV1; inputBalance: bigint; requiredInput: bigint;
  allowance?: bigint; spender: Address; nativeValue: bigint; conversion: "none" | "native-wrap" | "allowlisted-swap";
};
export type LifecycleProfile = {
  id: Hex; registration: ProfileRegistrationV1; adapter: AdapterRegistrationV1; topology: ProfileTopologyV1;
  venueKind: "uniswap-v4" | "abyss" | "unknown";
  admitted: boolean; reason?: string;
};
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
  profiles: readonly LifecycleProfile[]; simulation: LifecycleSimulation;
  /** Exact CREATE2 metadata captured from the final committed bound markets. */
  hookDeployments: readonly LifecyclePoolBoundHookDeployment[];
  atomicAttempt: LifecycleSimulation; progress: CanonicalLaunchProgress;
  preparationBatchSize: number; limits?: LifecycleLimitSource;
};
export type PlanLaunchOptions = {
  client: LifecycleRpcClient; account: Address; plan: LaunchPlanV1; mode: LaunchExecutionMode;
  limits?: LifecycleLimitSource; fork?: ControlledLifecycleFork; receipts?: readonly LifecycleReceiptReference[];
  confirmations?: number;
};
export type SimulateLaunchPlanOptions = {
  client: LifecycleRpcClient; planned: PlannedLaunch; limits?: LifecycleLimitSource; fork?: ControlledLifecycleFork;
  /** Submitted receipt evidence and confirmation depth are inherited from the
   * stored plan when omitted, exactly as build-next consumes them; resimulation
   * never silently drops submitted-transaction context. */
  receipts?: readonly LifecycleReceiptReference[]; confirmations?: number;
};
export type ReadLaunchProgressOptions = {
  client: LifecycleRpcClient; planned: Pick<PlannedLaunch, "plan" | "planHash" | "launchId" | "predictedToken" | "account" | "mode" | "confirmations">;
  receipts?: readonly LifecycleReceiptReference[]; confirmations?: number;
};
export type BuildNextTransactionOptions = ReadLaunchProgressOptions & {
  planned: PlannedLaunch; action?: "continue" | "cancel"; limits?: LifecycleLimitSource; fork?: ControlledLifecycleFork;
};
export class LifecyclePlanningError extends Error {
  readonly code: string;
  readonly simulation?: LifecycleSimulation;
  constructor(code: string, message: string, simulation?: LifecycleSimulation) {
    super(message); this.name = "LifecyclePlanningError"; this.code = code; this.simulation = simulation;
  }
}
