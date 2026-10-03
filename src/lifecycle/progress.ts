import { decodeFunctionData, encodeAbiParameters, keccak256, stringToHex, toHex, zeroAddress, type Address, type Hash, type Hex } from "viem";
import { launchLifecycleAbi, lifecycleAdapterAbi, lifecycleDirectoryAbi, lifecycleErc20Abi, lifecycleRegistryAbi } from "./abi.js";
import { hashLaunchIdentity, hashLaunchPlan, launchProgressV1Components, LifecycleMode, LifecyclePhase, LifecycleVenue, LIFECYCLE_REQUIRED_CAPABILITIES, type AdapterRegistrationV1, type LaunchPlanV1, type LaunchProgressV1, type MarketIdentityV1, type MarketLiveStateV1, type PreparedMarketV1, type ProfileRegistrationV1 } from "./schema.js";
import { assertLifecycleBlock, lifecycleRpc, readLifecycleBlock, readLifecycleContract, rpcHex, rpcObject, rpcQuantity } from "./rpc.js";
import { LifecyclePlanningError, type CanonicalLaunchProgress, type LifecycleBlock, type LifecycleMarketProgress, type LifecycleProfile, type LifecycleReceiptReference, type LifecycleReceiptStatus, type LifecycleRpcClient, type ReadLaunchProgressOptions } from "./types.js";

export const ABYSS_LIFECYCLE_CONFIG_SCHEMA = keccak256(stringToHex("(uint8,uint24,bytes32,uint160,(int24,int24,uint128,uint256)[])"));
export const V4_LIFECYCLE_CONFIG_SCHEMA = keccak256(stringToHex("(uint16,uint24,int24,uint160,uint24,uint8,uint8,address,bool,(int24,int24,uint128,bytes32,uint256)[])"));

export async function predictLifecycleToken(options: { client: LifecycleRpcClient; plan: LaunchPlanV1 }): Promise<Address> {
  const block = await readLifecycleBlock(options.client);
  const token = await readLifecycleContract<Address>(options.client, options.plan.orchestrator, launchLifecycleAbi, "predictToken", [options.plan], block);
  await assertLifecycleBlock(options.client, block);
  return token;
}

export async function readLifecycleProfiles(options: { client: LifecycleRpcClient; orchestrator: Address; profileIds?: readonly Hex[]; offset?: bigint; limit?: bigint }, pinnedBlock?: LifecycleBlock): Promise<LifecycleProfile[]> {
  const block = pinnedBlock ?? await readLifecycleBlock(options.client);
  const registry = await readLifecycleContract<Address>(options.client, options.orchestrator, launchLifecycleAbi, "registry", [], block);
  if ((await readLifecycleContract<Address>(options.client, registry, lifecycleRegistryAbi, "core", [], block)).toLowerCase() !== options.orchestrator.toLowerCase()) throw new LifecyclePlanningError("REGISTRY_BINDING", "Registry is not bound to the selected lifecycle orchestrator");
  const ids = options.profileIds ?? await readLifecycleContract<readonly Hex[]>(options.client, registry, lifecycleRegistryAbi, "profileIds", [options.offset ?? 0n, options.limit ?? 100n], block);
  const profiles: LifecycleProfile[] = [];
  for (const id of ids) {
    const registration = await readLifecycleContract<ProfileRegistrationV1>(options.client, registry, lifecycleRegistryAbi, "profile", [id], block);
    const adapter = await readLifecycleContract<AdapterRegistrationV1>(options.client, registry, lifecycleRegistryAbi, "adapter", [registration.adapterId], block);
    let admitted = registration.enabled && adapter.enabled && (registration.capabilities & LIFECYCLE_REQUIRED_CAPABILITIES) === LIFECYCLE_REQUIRED_CAPABILITIES && (adapter.capabilities & LIFECYCLE_REQUIRED_CAPABILITIES) === LIFECYCLE_REQUIRED_CAPABILITIES;
    let reason: string | undefined = admitted ? undefined : "Profile or implementation is retired, unregistered, or lacks lifecycle capabilities";
    if (admitted) {
      const code = rpcHex(await lifecycleRpc(options.client, "eth_getCode", [adapter.implementation, toHex(block.number)]), "adapter bytecode");
      if (code === "0x" || keccak256(code).toLowerCase() !== adapter.codeHash.toLowerCase()) { admitted = false; reason = "Adapter code hash differs from immutable registry approval"; }
      else if ((await readLifecycleContract<Address>(options.client, adapter.implementation, lifecycleAdapterAbi, "core", [], block)).toLowerCase() !== options.orchestrator.toLowerCase()) { admitted = false; reason = "Adapter authority differs from selected orchestrator"; }
    }
    const schema = registration.configSchema.toLowerCase();
    const venueKind = schema === V4_LIFECYCLE_CONFIG_SCHEMA.toLowerCase() ? "uniswap-v4" : schema === ABYSS_LIFECYCLE_CONFIG_SCHEMA.toLowerCase() ? "abyss" : "unknown";
    profiles.push({ id, registration, adapter, admitted, reason, venueKind });
  }
  if (pinnedBlock === undefined) await assertLifecycleBlock(options.client, block);
  return profiles;
}

export function validateLifecycleMarketIdentity(identity: MarketIdentityV1, plan: LaunchPlanV1, token: Address, marketIndex: number): void {
  const market = plan.markets[marketIndex];
  if (market === undefined) throw new LifecyclePlanningError("MARKET_IDENTITY", "Market index is outside the economic plan");
  const [currency0, currency1] = BigInt(token) < BigInt(market.quoteAsset) ? [token, market.quoteAsset] : [market.quoteAsset, token];
  const expectedCanonicalId = keccak256(encodeAbiParameters([
    { type: "uint256" }, { type: "uint8" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" },
  ], [plan.chainId, identity.venue, identity.manager, identity.factory, identity.pool, identity.poolId, identity.profileId]));
  if (identity.canonicalId.toLowerCase() !== expectedCanonicalId.toLowerCase() || identity.profileId.toLowerCase() !== market.profileId.toLowerCase() || identity.currency0.toLowerCase() !== currency0?.toLowerCase() || identity.currency1.toLowerCase() !== currency1?.toLowerCase() || identity.openingSqrtPriceX96 === 0n || identity.tickSpacing <= 0) throw new LifecyclePlanningError("MARKET_IDENTITY", "Venue identity does not match canonical chain, plan, currencies and opening price");
  if (identity.venue === LifecycleVenue.UniswapV4) {
    const expectedPoolId = keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }], [identity.currency0, identity.currency1, identity.fee, identity.tickSpacing, identity.hook]));
    if (identity.pool !== zeroAddress || identity.poolId.toLowerCase() !== expectedPoolId.toLowerCase() || identity.hook === zeroAddress) throw new LifecyclePlanningError("MARKET_IDENTITY", "V4 full PoolKey identity differs from its canonical pool ID");
  } else if (identity.venue !== LifecycleVenue.Abyss || identity.pool === zeroAddress || identity.factory === zeroAddress) throw new LifecyclePlanningError("MARKET_IDENTITY", "Abyss canonical factory/pool identity is missing");
}

async function transactionMatchesLaunch(transaction: Record<string, unknown>, options: ReadLaunchProgressOptions, block: LifecycleBlock): Promise<boolean> {
  const { planned } = options;
  const from = rpcHex(transaction.from, "receipt transaction account");
  if (from.toLowerCase() !== planned.account.toLowerCase()) throw new LifecyclePlanningError("RECEIPT_ACCOUNT", "Receipt transaction belongs to a different account");
  if (transaction.chainId !== undefined && rpcQuantity(transaction.chainId, "receipt transaction chain") !== planned.plan.chainId) throw new LifecyclePlanningError("RECEIPT_CHAIN", "Receipt transaction belongs to a different chain");
  const to = transaction.to === null ? zeroAddress : rpcHex(transaction.to, "receipt transaction target");
  const input = rpcHex(transaction.input ?? transaction.data, "receipt transaction calldata");
  if (to.toLowerCase() === planned.plan.orchestrator.toLowerCase()) {
    try {
      const decoded = decodeFunctionData({ abi: launchLifecycleAbi, data: input });
      if (!["launchAtomic", "beginLaunch", "prepareMarkets", "activateLaunch", "cancelLaunch"].includes(decoded.functionName) || !Array.isArray(decoded.args)) return false;
      // Decoded plan layout is validated by the exact ABI, not trusted raw RPC JSON.
      const plan = decoded.args[0] as LaunchPlanV1;
      return hashLaunchPlan(plan).toLowerCase() === planned.planHash.toLowerCase();
    } catch { return false; }
  }
  const fundingAsset = planned.plan.funding.some((funding) => funding.inputAsset.toLowerCase() === to.toLowerCase());
  if (!fundingAsset) return false;
  let spender: Address;
  try {
    const decoded = decodeFunctionData({ abi: lifecycleErc20Abi, data: input });
    if (decoded.functionName !== "approve" || rpcQuantity(transaction.value ?? "0x0", "approval native value") !== 0n) return false;
    spender = decoded.args[0];
  } catch { return false; }
  const escrow = await readLifecycleContract<Address>(options.client, planned.plan.orchestrator, launchLifecycleAbi, "fundingEscrow", [], block);
  return spender.toLowerCase() === escrow.toLowerCase();
}

async function readReceipt(reference: LifecycleReceiptReference, options: ReadLaunchProgressOptions, block: LifecycleBlock): Promise<LifecycleReceiptStatus> {
  const effectiveHash = reference.replacementHash ?? reference.transactionHash;
  const base = { transactionHash: reference.transactionHash, effectiveHash, replaced: reference.replacementHash !== undefined && reference.replacementHash.toLowerCase() !== reference.transactionHash.toLowerCase() };
  const observedNumber = reference.observedBlockNumber;
  if (observedNumber !== undefined && reference.observedBlockHash !== undefined) {
    const observed = await lifecycleRpc(options.client, "eth_getBlockByNumber", [toHex(observedNumber), false]);
    if (observed === null || rpcHex(rpcObject(observed, "observed receipt block").hash, "observed receipt block hash").toLowerCase() !== reference.observedBlockHash.toLowerCase()) return { ...base, status: "reorged", blockNumber: observedNumber, blockHash: reference.observedBlockHash };
  }
  const receiptValue = await lifecycleRpc(options.client, "eth_getTransactionReceipt", [effectiveHash]);
  const transactionValue = await lifecycleRpc(options.client, "eth_getTransactionByHash", [effectiveHash]);
  if (receiptValue === null) {
    // An absent receipt with an unchanged canonical observed block is not a
    // reorg: the transaction is simply not (yet) mined. A missing/changed
    // canonical block above already reported the real reorg.
    if (reference.observedBlockHash !== undefined) return { ...base, status: "pending", blockNumber: observedNumber, blockHash: reference.observedBlockHash };
    return { ...base, status: "pending" };
  }
  if (transactionValue === null) throw new LifecyclePlanningError("INVALID_RPC_RESPONSE", "Receipt exists without its canonical transaction");
  const transaction = rpcObject(transactionValue, "receipt transaction");
  const receiptBlock = await readLifecycleBlock(options.client, toHex(rpcQuantity(rpcObject(receiptValue, "receipt").blockNumber, "receipt block number")));
  const matches = await transactionMatchesLaunch(transaction, options, receiptBlock);
  if (!matches && !base.replaced) throw new LifecyclePlanningError("RECEIPT_IDENTITY", "Receipt calldata does not belong to the exact committed launch");
  const receipt = rpcObject(receiptValue, "receipt");
  const blockNumber = rpcQuantity(receipt.blockNumber, "receipt block number");
  const blockHash = rpcHex(receipt.blockHash, "receipt block hash");
  const canonicalBlockValue = await lifecycleRpc(options.client, "eth_getBlockByNumber", [toHex(blockNumber), false]);
  if (canonicalBlockValue === null || rpcHex(rpcObject(canonicalBlockValue, "receipt canonical block").hash, "receipt canonical hash").toLowerCase() !== blockHash.toLowerCase()) return { ...base, status: "reorged", blockNumber, blockHash };
  const confirmations = block.number >= blockNumber ? block.number - blockNumber + 1n : 0n;
  const required = reference.confirmations ?? 1;
  if (!Number.isSafeInteger(required) || required < 1) throw new LifecyclePlanningError("INVALID_CONFIRMATIONS", "Receipt confirmations must be a positive integer");
  if (confirmations < BigInt(required)) return { ...base, status: "unconfirmed", blockNumber, blockHash, confirmations };
  if (!matches) return { ...base, status: "replacement-cancelled", blockNumber, blockHash, confirmations };
  if (rpcQuantity(receipt.status, "receipt status") !== 1n) return { ...base, status: "reverted", blockNumber, blockHash, confirmations };
  return { ...base, status: "confirmed", blockNumber, blockHash, confirmations };
}

/** Reads confirmation-bound canonical state and receipt provenance; local step counters are never used. */
export async function readLaunchProgress(options: ReadLaunchProgressOptions, pinnedBlock?: LifecycleBlock): Promise<CanonicalLaunchProgress> {
  const { client, planned } = options;
  const block = pinnedBlock ?? await readLifecycleBlock(client);
  const confirmationDepth = options.confirmations ?? planned.confirmations;
  if (!Number.isSafeInteger(confirmationDepth) || confirmationDepth < 1) throw new LifecyclePlanningError("INVALID_CONFIRMATIONS", "Confirmation depth must be a positive integer");
  const confirmedNumber = block.number >= BigInt(confirmationDepth - 1) ? block.number - BigInt(confirmationDepth - 1) : 0n;
  const confirmedBlock = confirmedNumber === block.number ? block : await readLifecycleBlock(client, toHex(confirmedNumber));
  const chainId = rpcQuantity(await lifecycleRpc(client, "eth_chainId"), "chain ID");
  if (chainId !== planned.plan.chainId) throw new LifecyclePlanningError("CHAIN_MISMATCH", "RPC chain differs from the committed launch");
  if (planned.account.toLowerCase() !== planned.plan.creator.toLowerCase()) throw new LifecyclePlanningError("ACCOUNT_MISMATCH", "Execution account must be the committed creator/payer/refund account");
  if (hashLaunchPlan(planned.plan).toLowerCase() !== planned.planHash.toLowerCase() || hashLaunchIdentity(planned.plan).toLowerCase() !== planned.launchId.toLowerCase()) throw new LifecyclePlanningError("PLAN_MUTATED", "Stored economic plan no longer matches its commitment");
  const head = await readLifecycleContract<LaunchProgressV1>(client, planned.plan.orchestrator, launchLifecycleAbi, "readLaunchProgress", [planned.launchId], block, planned.account);
  const canonical = confirmedNumber === block.number ? head : await readLifecycleContract<LaunchProgressV1>(client, planned.plan.orchestrator, launchLifecycleAbi, "readLaunchProgress", [planned.launchId], confirmedBlock, planned.account);
  const token = await readLifecycleContract<Address>(client, planned.plan.orchestrator, launchLifecycleAbi, "predictToken", [planned.plan], block);
  if (token.toLowerCase() !== planned.predictedToken.toLowerCase()) throw new LifecyclePlanningError("TOKEN_IDENTITY", "Predicted token changed for the committed token configuration");
  for (const progress of [canonical, head]) if (progress.phase !== LifecyclePhase.None) {
    if (progress.planHash.toLowerCase() !== planned.planHash.toLowerCase() || progress.launchId.toLowerCase() !== planned.launchId.toLowerCase() || progress.creator.toLowerCase() !== planned.account.toLowerCase() || progress.nonce !== planned.plan.nonce || progress.token.toLowerCase() !== token.toLowerCase() || progress.marketCount !== planned.plan.markets.length || progress.buyCount !== planned.plan.buys.length || progress.deadline !== planned.plan.deadline) throw new LifecyclePlanningError("PLAN_REPLAY", "This creator nonce is already bound to a different economic launch");
    if (progress.mode !== (planned.mode === "atomic" ? LifecycleMode.Atomic : LifecycleMode.Staged)) throw new LifecyclePlanningError("MODE_MISMATCH", "Execution mode differs from the already recorded launch");
    if (progress.preparedMarkets > progress.marketCount || progress.phase === LifecyclePhase.Activating || (progress.phase === LifecyclePhase.Ready && progress.preparedMarkets !== progress.marketCount)) throw new LifecyclePlanningError("INVALID_PROGRESS", "Canonical progress violates the committed ordered state machine");
  }
  const confirmedAccountNonce = rpcQuantity(await lifecycleRpc(client, "eth_getTransactionCount", [planned.account, toHex(confirmedBlock.number)]), "confirmed account nonce");
  const headAccountNonce = confirmedNumber === block.number ? confirmedAccountNonce : rpcQuantity(await lifecycleRpc(client, "eth_getTransactionCount", [planned.account, toHex(block.number)]), "head account nonce");
  const pendingAccountNonce = rpcQuantity(await lifecycleRpc(client, "eth_getTransactionCount", [planned.account, "pending"]), "pending account nonce");
  const progressParameters = [{ type: "tuple", components: launchProgressV1Components }] as const;
  const confirmationSafe = confirmedAccountNonce === headAccountNonce && pendingAccountNonce === headAccountNonce && keccak256(encodeAbiParameters(progressParameters, [canonical])) === keccak256(encodeAbiParameters(progressParameters, [head]));
  const receipts: LifecycleReceiptStatus[] = [];
  for (const reference of options.receipts ?? []) receipts.push(await readReceipt({ ...reference, confirmations: Math.max(reference.confirmations ?? 1, confirmationDepth) }, options, block));
  const markets: LifecycleMarketProgress[] = [];
  if (canonical.preparedMarkets > 0) {
    const directory = await readLifecycleContract<Address>(client, planned.plan.orchestrator, launchLifecycleAbi, "directory", [], confirmedBlock);
    for (let index = 0; index < canonical.preparedMarkets; index += 1) {
      const [adapter, prepared] = await readLifecycleContract<readonly [Address, PreparedMarketV1]>(client, directory, lifecycleDirectoryAbi, "market", [planned.launchId, index], confirmedBlock);
      validateLifecycleMarketIdentity(prepared.identity, planned.plan, token, index);
      try {
        const live = await readLifecycleContract<MarketLiveStateV1>(client, adapter, lifecycleAdapterAbi, "readMarket", [planned.launchId, index], confirmedBlock);
        markets.push({ index, prepared, live });
      } catch (failure) {
        markets.push({ index, prepared, error: failure instanceof Error ? failure.message : String(failure) });
      }
    }
  }
  if (pinnedBlock === undefined) await assertLifecycleBlock(client, block);
  if (confirmedNumber !== block.number) await assertLifecycleBlock(client, confirmedBlock);
  return { canonical, head, confirmationDepth, confirmedBlockNumber: confirmedBlock.number, confirmedBlockHash: confirmedBlock.hash, confirmedAccountNonce, headAccountNonce, pendingAccountNonce, confirmationSafe, token, planHash: planned.planHash, launchId: planned.launchId, chainId, blockNumber: block.number, blockHash: block.hash, markets, receipts };
}
