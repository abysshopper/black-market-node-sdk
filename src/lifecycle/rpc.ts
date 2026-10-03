import { decodeFunctionResult, encodeFunctionData, isHex, toHex, type Abi, type Address, type Hex } from "viem";
import { LifecyclePlanningError, type LifecycleBlock, type LifecycleLimitContext, type LifecycleLimitSource, type LifecycleLimits, type LifecycleRpcClient, type ResolvedLifecycleLimits } from "./types.js";

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
export async function assertLifecycleBlock(client: LifecycleRpcClient, block: LifecycleBlock): Promise<void> {
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
export async function resolveLifecycleLimits(context: LifecycleLimitContext, source?: LifecycleLimitSource): Promise<{ limits: ResolvedLifecycleLimits; configuration: LifecycleLimits }> {
  let configuration: LifecycleLimits = {};
  let sourceError: string | undefined;
  try { configuration = typeof source === "function" ? await source(context) : source ?? {}; }
  catch (failure) { sourceError = failure instanceof Error ? failure.message : String(failure); }
  const headroomBps = configuration.headroomBps ?? 1500;
  if (!Number.isSafeInteger(headroomBps) || headroomBps < 0 || headroomBps > 10000) throw new LifecyclePlanningError("INVALID_LIMITS", "Headroom must be between zero and 10000 basis points");
  const ceilings = [context.block.gasLimit, configuration.chainGasLimit, configuration.rpcGasLimit, configuration.accountGasLimit].filter((limit): limit is bigint => limit !== undefined);
  if (ceilings.some((limit) => typeof limit !== "bigint" || limit <= 0n)) throw new LifecyclePlanningError("INVALID_LIMITS", "Execution gas caps must be positive exact bigint values");
  if (configuration.maxCalldataBytes !== undefined && (!Number.isSafeInteger(configuration.maxCalldataBytes) || configuration.maxCalldataBytes <= 0)) throw new LifecyclePlanningError("INVALID_LIMITS", "Calldata cap must be a positive byte count");
  if (configuration.maxSimulationGas !== undefined && configuration.maxSimulationGas <= 0n) throw new LifecyclePlanningError("INVALID_LIMITS", "Simulation aggregate gas cap must be positive");
  const unknownExecutionConstraints = [
    ...(configuration.chainGasLimit === undefined ? ["Chain per-transaction execution cap is unknown; block gas limit is not an equivalent on every chain"] : []),
    ...(configuration.rpcGasLimit === undefined ? ["RPC transaction execution cap is unknown"] : []),
    ...(configuration.accountGasLimit === undefined ? ["Current account/wallet transaction execution cap is unknown"] : []),
    ...(configuration.maxCalldataBytes === undefined ? ["Applicable chain/account/RPC calldata byte cap is unknown"] : []),
    ...(configuration.chainId !== context.chainId ? ["Current limit chain provenance is missing or mismatched"] : []),
    ...(configuration.account?.toLowerCase() !== context.account.toLowerCase() ? ["Current limit account provenance is missing or mismatched"] : []),
    ...(configuration.orchestrator?.toLowerCase() !== context.orchestrator.toLowerCase() ? ["Current limit orchestrator provenance is missing or mismatched"] : []),
    ...(configuration.observedBlockNumber !== context.block.number || configuration.observedBlockHash?.toLowerCase() !== context.block.hash.toLowerCase() ? ["Current limit block provenance is missing, stale, or mismatched"] : []),
    ...(sourceError === undefined ? [] : [`Current limit source failed: ${sourceError}`]),
  ];
  return {
    configuration,
    limits: {
      executionGasCeiling: ceilings.reduce((minimum, limit) => limit < minimum ? limit : minimum), headroomBps,
      maxCalldataBytes: configuration.maxCalldataBytes, maxSimulationGas: configuration.maxSimulationGas,
      blockGasLimit: context.block.gasLimit, chainGasLimit: configuration.chainGasLimit,
      rpcGasLimit: configuration.rpcGasLimit, accountGasLimit: configuration.accountGasLimit,
      admissionKnown: unknownExecutionConstraints.length === 0, unknownExecutionConstraints,
      unknownConstraints: [
        ...unknownExecutionConstraints,
        ...(configuration.estimateDataFee === undefined ? ["Chain-specific data fee is unavailable"] : []),
      ],
    },
  };
}
