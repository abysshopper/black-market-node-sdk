import { decodeFunctionResult, encodeFunctionData, isAddress, isHex, parseAbi, toHex, type Abi, type Address, type Hex } from "viem";
import { LifecyclePlanningError, type LifecycleBlock, type LifecycleLimitContext, type LifecycleLimitSource, type LifecycleLimits, type LifecycleRpcClient, type LifecycleTransaction, type ResolvedLifecycleLimits } from "./types.js";
import { lifecycleRegistryAbi } from "./abi.js";
import type { ProfileTopologyV1 } from "./schema.js";

export async function lifecycleRpc(client: LifecycleRpcClient, method: string, params: readonly unknown[] = []): Promise<unknown> {
  return client.request({ method, params });
}
export function rpcObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new LifecyclePlanningError("INVALID_RPC_RESPONSE", `${label} must be an object`);
  // The object guard establishes the RPC record boundary; fields remain untrusted unknowns.
  const record = value as Record<string, unknown>;
  return record;
}
export function rpcHex(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !isHex(value)) throw new LifecyclePlanningError("INVALID_RPC_RESPONSE", `${label} must be hex`);
  return value;
}
export function rpcQuantity(value: unknown, label: string): bigint {
  const hex = rpcHex(value, label);
  if (!/^0x[0-9a-fA-F]+$/.test(hex)) throw new LifecyclePlanningError("INVALID_RPC_RESPONSE", `${label} must be a quantity`);
  return BigInt(hex);
}
export async function readLifecycleBlock(client: LifecycleRpcClient, tag: Hex | "latest" = "latest"): Promise<LifecycleBlock> {
  const value = rpcObject(await lifecycleRpc(client, "eth_getBlockByNumber", [tag, false]), "block");
  const hash = rpcHex(value.hash, "block hash");
  if (hash.length !== 66) throw new LifecyclePlanningError("INVALID_RPC_RESPONSE", "Block hash must have 32 bytes");
  return {
    number: rpcQuantity(value.number, "block number"), hash,
    timestamp: rpcQuantity(value.timestamp, "block timestamp"), gasLimit: rpcQuantity(value.gasLimit, "block gas limit"),
    baseFeePerGas: value.baseFeePerGas === undefined || value.baseFeePerGas === null ? undefined : rpcQuantity(value.baseFeePerGas, "base fee"),
  };
}
export async function assertLifecycleBlock(client: LifecycleRpcClient, block: LifecycleBlock, expectedChainId?: bigint): Promise<void> {
  if (expectedChainId !== undefined && rpcQuantity(await lifecycleRpc(client, "eth_chainId"), "chain ID") !== expectedChainId) throw new LifecyclePlanningError("CHAIN_MISMATCH", "Source RPC chain changed during the pinned operation");
  const current = await readLifecycleBlock(client, toHex(block.number));
  if (current.hash.toLowerCase() !== block.hash.toLowerCase()) throw new LifecyclePlanningError("STATE_REORGED", "Pinned launch state changed during the operation; read canonical progress again");
}
export async function readLifecycleContract<T>(client: LifecycleRpcClient, to: Address, abi: Abi, functionName: string, args: readonly unknown[], block: LifecycleBlock, from?: Address): Promise<T> {
  const data = encodeFunctionData({ abi, functionName, args });
  const result = rpcHex(await lifecycleRpc(client, "eth_call", [{ to, from, data }, toHex(block.number)]), functionName);
  // ABI decoding validates scalar widths and tuple layout; T names that exact frozen ABI result.
  const decoded = decodeFunctionResult({ abi, functionName, data: result }) as T;
  return decoded;
}

/** A reviewed registry must supply topology; missing selectors never certify a profile. */
export async function readLifecycleProfileTopology(client: LifecycleRpcClient, registry: Address, profileId: Hex, block: LifecycleBlock): Promise<ProfileTopologyV1> {
  const topology = await readLifecycleContract<{ hookTopology: number; configVersion: number; hookDeployer: Address; hookCreationCodeHash: Hex }>(client, registry, lifecycleRegistryAbi, "profileTopology", [profileId], block);
  if (topology.hookTopology !== 0 && topology.hookTopology !== 1 && topology.hookTopology !== 2) throw new LifecyclePlanningError("INVALID_RPC_RESPONSE", "Registry returned an unsupported hook topology");
  return { ...topology, hookTopology: topology.hookTopology };
}
export const nitroArbSys = "0x0000000000000000000000000000000000000064";
export const nitroGasInfo = "0x000000000000000000000000000000000000006c";
export const nitroNodeInterface = "0x00000000000000000000000000000000000000c8";
export const nitroArbSysAbi = parseAbi(["function arbOSVersion() view returns (uint256)"]);
export const nitroGasInfoAbi = parseAbi(["function getMaxTxGasLimit() view returns (uint256)", "function getMaxBlockGasLimit() view returns (uint64)"]);
const nitroNodeInterfaceAbi = parseAbi(["function gasEstimateL1Component(address to, bool contractCreation, bytes data) payable returns (uint64 gasEstimateForL1, uint256 baseFee, uint256 l1BaseFeeEstimate)"]);
const maxUint64 = (1n << 64n) - 1n;

/** A poster quote is an envelope budget, never an execution/compute proof. */
export async function readNitroPosterGas(transaction: LifecycleTransaction, context: LifecycleLimitContext): Promise<{ posterGas: bigint; baseFee: bigint; l1BaseFeeEstimate: bigint }> {
  const data = encodeFunctionData({ abi: nitroNodeInterfaceAbi, functionName: "gasEstimateL1Component", args: [transaction.to, false, transaction.data] });
  const result = rpcHex(await lifecycleRpc(context.client, "eth_call", [{ from: transaction.from, to: nitroNodeInterface, data, value: toHex(transaction.value) }, toHex(context.block.number)]), "Nitro poster estimate");
  if (result.length !== 194) throw new LifecyclePlanningError("INVALID_RPC_RESPONSE", "Nitro poster estimate must contain exactly three ABI words");
  const [posterGas, baseFee, l1BaseFeeEstimate] = decodeFunctionResult({ abi: nitroNodeInterfaceAbi, functionName: "gasEstimateL1Component", data: result });
  if (posterGas < 0n || posterGas > maxUint64 || baseFee <= 0n || l1BaseFeeEstimate < 0n) throw new LifecyclePlanningError("INVALID_RPC_RESPONSE", "Nitro poster estimate has invalid gas or fee values");
  return { posterGas, baseFee, l1BaseFeeEstimate };
}

async function readNitroScalar(context: LifecycleLimitContext, to: Address, abi: Abi, functionName: string): Promise<bigint> {
  const data = encodeFunctionData({ abi, functionName });
  const result = rpcHex(await lifecycleRpc(context.client, "eth_call", [{ to, data }, toHex(context.block.number)]), functionName);
  if (result.length !== 66) throw new LifecyclePlanningError("INVALID_RPC_RESPONSE", `${functionName} must return exactly one ABI word`);
  return decodeFunctionResult({ abi, functionName, data: result }) as bigint;
}

export async function resolveLifecycleLimits(context: LifecycleLimitContext, source?: LifecycleLimitSource): Promise<{ limits: ResolvedLifecycleLimits; configuration: LifecycleLimits }> {
  let configuration: LifecycleLimits;
  try { configuration = source === undefined ? {} : typeof source === "function" ? await source(context) : source; }
  catch (failure) { throw new LifecyclePlanningError("LIMIT_SOURCE_FAILED", `Supplied execution policy could not be resolved: ${failure instanceof Error ? failure.message : String(failure)}`); }
  if (configuration === null || typeof configuration !== "object" || Array.isArray(configuration)) throw new LifecyclePlanningError("INVALID_LIMITS", "Supplied execution policy must be an object");
  const headroomBps = configuration.headroomBps === undefined ? 1500 : configuration.headroomBps;
  if (!Number.isSafeInteger(headroomBps) || headroomBps < 0 || headroomBps > 10000) throw new LifecyclePlanningError("INVALID_LIMITS", "Headroom must be between zero and 10000 basis points");
  for (const limit of [context.block.gasLimit, configuration.chainGasLimit, configuration.rpcGasLimit, configuration.accountGasLimit, configuration.maxSimulationGas]) {
    if (limit !== undefined && (typeof limit !== "bigint" || limit <= 0n || limit > maxUint64)) throw new LifecyclePlanningError("INVALID_LIMITS", "Gas caps must be positive exact uint64 bigint values");
  }
  if (configuration.maxCalldataBytes !== undefined && (!Number.isSafeInteger(configuration.maxCalldataBytes) || configuration.maxCalldataBytes <= 0)) throw new LifecyclePlanningError("INVALID_LIMITS", "Calldata cap must be a positive byte count");
  if (configuration.estimateDataFee !== undefined && typeof configuration.estimateDataFee !== "function") throw new LifecyclePlanningError("INVALID_LIMITS", "External data-fee estimator must be a function");
  if (configuration.chainId !== undefined && (typeof configuration.chainId !== "bigint" || configuration.chainId !== context.chainId) ||
    configuration.observedBlockNumber !== undefined && (typeof configuration.observedBlockNumber !== "bigint" || configuration.observedBlockNumber !== context.block.number) ||
    configuration.observedBlockHash !== undefined && (typeof configuration.observedBlockHash !== "string" || !/^0x[\da-fA-F]{64}$/.test(configuration.observedBlockHash) || configuration.observedBlockHash.toLowerCase() !== context.block.hash.toLowerCase()) ||
    configuration.account !== undefined && (typeof configuration.account !== "string" || !isAddress(configuration.account) || configuration.account.toLowerCase() !== context.account.toLowerCase()) ||
    configuration.orchestrator !== undefined && (typeof configuration.orchestrator !== "string" || !isAddress(configuration.orchestrator) || configuration.orchestrator.toLowerCase() !== context.orchestrator.toLowerCase())) {
    throw new LifecyclePlanningError("LIMIT_CONTEXT_MISMATCH", "Supplied execution policy provenance differs from the canonical chain/account/core/block context");
  }
  const protocol = context.chainId === 4663n ? "nitro" : "evm";
  let arbOSVersion: bigint | undefined; let maxTxComputeGas: bigint | undefined; let maxBlockComputeGas: bigint | undefined;
  if (protocol === "nitro") {
    try {
      const rawVersion = await readNitroScalar(context, nitroArbSys, nitroArbSysAbi, "arbOSVersion");
      // ArbSys alone adds 55 to the logical Nitro ArbOS version.
      if (typeof rawVersion !== "bigint" || rawVersion < 105n) throw new Error("ArbOS version 50 or newer is required (ArbSys raw version >= 105)");
      arbOSVersion = rawVersion - 55n;
      maxTxComputeGas = await readNitroScalar(context, nitroGasInfo, nitroGasInfoAbi, "getMaxTxGasLimit");
      maxBlockComputeGas = await readNitroScalar(context, nitroGasInfo, nitroGasInfoAbi, "getMaxBlockGasLimit");
      if ([maxTxComputeGas, maxBlockComputeGas].some((limit) => typeof limit !== "bigint" || limit <= 0n || limit > maxUint64)) throw new Error("Nitro compute getters must be positive uint64 values");
    } catch (failure) { throw new LifecyclePlanningError("NITRO_LIMITS_UNAVAILABLE", `Pinned Nitro compute limits could not be established: ${failure instanceof Error ? failure.message : String(failure)}; header gasLimit is not a fallback`); }
    if (configuration.estimateDataFee !== undefined) throw new LifecyclePlanningError("INVALID_LIMITS", "Nitro poster fees are already included in gas; an external data-fee estimator would double-charge them");
  }
  const envelopeCaps = [configuration.chainGasLimit, configuration.rpcGasLimit, configuration.accountGasLimit].filter((limit): limit is bigint => limit !== undefined);
  if (protocol === "evm") envelopeCaps.push(context.block.gasLimit);
  const transactionGasCeiling = envelopeCaps.length === 0 ? undefined : envelopeCaps.reduce((minimum, limit) => limit < minimum ? limit : minimum);
  const executionGasCeiling = maxTxComputeGas !== undefined && maxBlockComputeGas !== undefined
    ? (maxTxComputeGas < maxBlockComputeGas ? maxTxComputeGas : maxBlockComputeGas)
    : transactionGasCeiling ?? context.block.gasLimit;
  const unknownExecutionConstraints = [
    ...(protocol === "evm" && configuration.chainGasLimit === undefined ? ["Independent chain per-transaction execution cap is unknown; proof is bounded by the pinned header and validated backend"] : []),
    ...(configuration.rpcGasLimit === undefined ? ["RPC transaction gas-envelope cap is unknown"] : []),
    ...(configuration.accountGasLimit === undefined ? ["Current account/wallet transaction gas-envelope cap is unknown"] : []),
    ...(configuration.maxCalldataBytes === undefined ? ["Applicable chain/account/RPC calldata byte cap is unknown"] : []),
    ...(configuration.maxSimulationGas === undefined ? ["RPC aggregate simulation gas cap is unknown"] : []),
  ];
  return {
    configuration,
    limits: {
      protocol, executionGasCeiling, transactionGasCeiling, arbOSVersion, maxTxComputeGas, maxBlockComputeGas, headroomBps,
      maxCalldataBytes: configuration.maxCalldataBytes, maxSimulationGas: configuration.maxSimulationGas,
      blockGasLimit: context.block.gasLimit, chainGasLimit: configuration.chainGasLimit,
      rpcGasLimit: configuration.rpcGasLimit, accountGasLimit: configuration.accountGasLimit,
      unknownExecutionConstraints,
      unknownConstraints: [...unknownExecutionConstraints, ...(protocol === "evm" && configuration.estimateDataFee === undefined ? ["External chain-specific data fee is unavailable"] : [])],
    },
  };
}
