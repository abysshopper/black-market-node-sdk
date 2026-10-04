import { decodeEventLog, encodeFunctionData, isAddress, zeroAddress, type Address, type Hex } from "viem";
import { launchLifecycleAbi, lifecycleFeeHubAbi, lifecycleFeeHubFactoryAbi, lifecycleRegistryAbi } from "./abi.js";
import { assertLifecycleBlock, lifecycleRpc, readLifecycleBlock, readLifecycleContract, rpcQuantity } from "./rpc.js";
import type { SourceTermsV3 } from "./schema.js";
import { LifecyclePlanningError, type LifecycleBlock, type LifecycleRpcClient } from "./types.js";

export type LifecycleUnsignedTransaction = { chainId: number; from: Address; to: Address; data: Hex; value: bigint };
export type LifecycleAuthorOptions = { client: LifecycleRpcClient; registry: Address; authorId: Address };
export type LifecycleAuthor = {
  registry: Address; core: Address; factory: Address; authorId: Address; payout: Address; known: boolean;
  hubCount: bigint; chainId: bigint; blockNumber: bigint; blockHash: Hex;
};
export type AuthorHubsPage = LifecycleAuthor & { hubs: readonly Address[]; offset: bigint; nextOffset: bigint; total: bigint; cursorComplete: boolean };
export type DeveloperFees = LifecycleAuthor & {
  hub: Address; assets: readonly Address[];
  balances: readonly { asset: Address; supported: boolean; claimable: bigint; reserved: bigint }[];
  sources: readonly { source: Address; assets: readonly Address[]; terms: SourceTermsV3 }[];
};
export type DeveloperClaimTransaction = LifecycleUnsignedTransaction & {
  claim: { kind: "direct"; registry: Address; factory: Address; authorId: Address; hub: Address; asset: Address }
    | { kind: "page"; registry: Address; factory: Address; authorId: Address; offset: bigint; limit: bigint; assets: readonly Address[] };
};
export type DeveloperClaimResult = { hub: Address; asset: Address; amount: bigint; status: 0 | 1 | 2 | 3; outcome: "paid" | "zero" | "unsupported" | "failed"; errorSelector: Hex; payout?: Address };
export type DeveloperClaimReceipt = {
  executionSucceeded: boolean; outcome: "observed" | "unobserved" | "reverted";
  results: readonly DeveloperClaimResult[]; retryableResults: readonly DeveloperClaimResult[];
  cursorComplete: boolean; paymentsSucceeded: boolean; offset?: bigint; nextOffset?: bigint; total?: bigint; reason?: string;
};
export type DeveloperClaimReceiptInput = {
  status: "success" | "reverted" | "0x1" | "0x0" | number | bigint;
  from: Address; to: Address | null; transactionHash?: Hex;
  logs: readonly { address: Address; data: Hex; topics: readonly Hex[]; removed?: boolean }[];
};

function requireAddress(address: Address, label: string): void {
  if (!isAddress(address) || address.toLowerCase() === zeroAddress) throw new LifecyclePlanningError("INVALID_AUTHOR_ADDRESS", `${label} must be a nonzero address`);
}
function validateAssets(assets: readonly Address[]): void {
  if (assets.length > 8) throw new LifecyclePlanningError("INVALID_CLAIM_ASSETS", "Claims accept at most eight explicit assets");
  let previous = 0n;
  for (const asset of assets) {
    requireAddress(asset, "Claim asset");
    if (BigInt(asset) <= previous) throw new LifecyclePlanningError("INVALID_CLAIM_ASSETS", "Explicit assets must be sorted, unique and nonzero");
    previous = BigInt(asset);
  }
}
function requirePage(offset: bigint, limit: bigint, maximum: bigint): void {
  if (offset < 0n || offset >= 1n << 256n || limit < 1n || limit > maximum) throw new LifecyclePlanningError("INVALID_AUTHOR_PAGE", `Page offset must be uint256 and limit must be 1..${maximum}`);
}
async function readAuthorContext(options: LifecycleAuthorOptions, block: LifecycleBlock): Promise<LifecycleAuthor> {
  const { client, registry, authorId } = options;
  requireAddress(registry, "Implementation registry"); requireAddress(authorId, "Stable author identity");
  const chainId = rpcQuantity(await lifecycleRpc(client, "eth_chainId"), "author chain ID");
  const core = await readLifecycleContract<Address>(client, registry, lifecycleRegistryAbi, "core", [], block);
  requireAddress(core, "Registry core");
  if ((await readLifecycleContract<Address>(client, core, launchLifecycleAbi, "registry", [], block)).toLowerCase() !== registry.toLowerCase()) throw new LifecyclePlanningError("REGISTRY_BINDING", "Selected core does not bind this implementation registry");
  const factory = await readLifecycleContract<Address>(client, core, launchLifecycleAbi, "feeFactory", [], block);
  requireAddress(factory, "Canonical fee factory");
  if ((await readLifecycleContract<Address>(client, factory, lifecycleFeeHubFactoryAbi, "implementationRegistry", [], block)).toLowerCase() !== registry.toLowerCase() ||
    (await readLifecycleContract<Address>(client, factory, lifecycleFeeHubFactoryAbi, "deploymentAuthority", [], block)).toLowerCase() !== core.toLowerCase()) throw new LifecyclePlanningError("FEE_FACTORY_BINDING", "Canonical fee factory differs from the selected registry/core domain");
  const payout = await readLifecycleContract<Address>(client, registry, lifecycleRegistryAbi, "authorPayout", [authorId], block);
  const hubCount = await readLifecycleContract<bigint>(client, registry, lifecycleRegistryAbi, "authorHubCount", [authorId], block);
  return { registry, core, factory, authorId, payout, known: payout.toLowerCase() !== zeroAddress, hubCount, chainId, blockNumber: block.number, blockHash: block.hash };
}
async function requireCanonicalHub(client: LifecycleRpcClient, author: LifecycleAuthor, hub: Address, block: LifecycleBlock): Promise<void> {
  requireAddress(hub, "Developer fee hub");
  // Membership is checked through registry.core -> core.feeFactory, before ANY hub self-report.
  if (!await readLifecycleContract<boolean>(client, author.factory, lifecycleFeeHubFactoryAbi, "isHub", [hub], block)) throw new LifecyclePlanningError("UNAUTHENTICATED_HUB", "Hub is not a member of this registry core's canonical V3 factory");
  if (await readLifecycleContract<number>(client, hub, lifecycleFeeHubAbi, "economicVersion", [], block) !== 3 ||
    (await readLifecycleContract<Address>(client, hub, lifecycleFeeHubAbi, "implementationRegistry", [], block)).toLowerCase() !== author.registry.toLowerCase() ||
    (await readLifecycleContract<Address>(client, hub, lifecycleFeeHubAbi, "configurator", [], block)).toLowerCase() !== author.core.toLowerCase()) throw new LifecyclePlanningError("FEE_HUB_BINDING", "Canonical hub does not implement the selected V3 economic domain");
}
function unsignedTransaction(options: { account: Address; chainId: bigint }, author: LifecycleAuthor, to: Address, data: Hex): LifecycleUnsignedTransaction {
  requireAddress(options.account, "Transaction account");
  if (options.chainId !== author.chainId || options.chainId <= 0n || options.chainId > BigInt(Number.MAX_SAFE_INTEGER)) throw new LifecyclePlanningError("CHAIN_MISMATCH", "Unsigned transaction chain must exactly match the selected author domain");
  return { chainId: Number(options.chainId), from: options.account, to, data, value: 0n };
}

export async function readLifecycleAuthor(options: LifecycleAuthorOptions, pinnedBlock?: LifecycleBlock): Promise<LifecycleAuthor> {
  const block = pinnedBlock ?? await readLifecycleBlock(options.client);
  const author = await readAuthorContext(options, block);
  if (pinnedBlock === undefined) await assertLifecycleBlock(options.client, block);
  return author;
}
export async function readAuthorHubs(options: LifecycleAuthorOptions & { offset?: bigint; limit?: bigint }, pinnedBlock?: LifecycleBlock): Promise<AuthorHubsPage> {
  const offset = options.offset ?? 0n; const limit = options.limit ?? 100n;
  requirePage(offset, limit, 100n);
  const block = pinnedBlock ?? await readLifecycleBlock(options.client);
  const author = await readAuthorContext(options, block);
  if (offset > author.hubCount) throw new LifecyclePlanningError("INVALID_AUTHOR_PAGE", "Author discovery offset exceeds the registered hub count");
  const [hubs, nextOffset, total] = await readLifecycleContract<readonly [readonly Address[], bigint, bigint]>(options.client, options.registry, lifecycleRegistryAbi, "authorHubs", [options.authorId, offset, limit], block);
  if (total !== author.hubCount || nextOffset !== offset + BigInt(hubs.length) || nextOffset > total || BigInt(hubs.length) > limit) throw new LifecyclePlanningError("INVALID_AUTHOR_PAGE", "Registry returned an inconsistent discovery cursor");
  for (const hub of hubs) await requireCanonicalHub(options.client, author, hub, block);
  if (pinnedBlock === undefined) await assertLifecycleBlock(options.client, block);
  return { ...author, hubs, offset, nextOffset, total, cursorComplete: nextOffset === total };
}
export async function readDeveloperFees(options: LifecycleAuthorOptions & { hub: Address; assets?: readonly Address[] }, pinnedBlock?: LifecycleBlock): Promise<DeveloperFees> {
  const explicitAssets = options.assets ?? [];
  validateAssets(explicitAssets);
  const block = pinnedBlock ?? await readLifecycleBlock(options.client);
  const author = await readAuthorContext(options, block);
  await requireCanonicalHub(options.client, author, options.hub, block);
  const assets = await readLifecycleContract<readonly Address[]>(options.client, options.hub, lifecycleFeeHubAbi, "assets", [], block);
  const selected = explicitAssets.length === 0 ? assets : explicitAssets;
  const balances: { asset: Address; supported: boolean; claimable: bigint; reserved: bigint }[] = [];
  for (const asset of selected) {
    const supported = assets.some((actual) => actual.toLowerCase() === asset.toLowerCase());
    const claimable = supported ? await readLifecycleContract<bigint>(options.client, options.hub, lifecycleFeeHubAbi, "claimableDeveloperFees", [options.authorId, asset], block) : 0n;
    const reserved = supported ? await readLifecycleContract<bigint>(options.client, options.hub, lifecycleFeeHubAbi, "reservedDeveloperFees", [asset], block) : 0n;
    balances.push({ asset, supported, claimable, reserved });
  }
  const sources: { source: Address; assets: readonly Address[]; terms: SourceTermsV3 }[] = [];
  for (const source of await readLifecycleContract<readonly Address[]>(options.client, options.hub, lifecycleFeeHubAbi, "sources", [], block)) {
    sources.push({ source, assets: await readLifecycleContract<readonly Address[]>(options.client, options.hub, lifecycleFeeHubAbi, "sourceAssets", [source], block),
      terms: await readLifecycleContract<SourceTermsV3>(options.client, options.hub, lifecycleFeeHubAbi, "sourceTerms", [source], block) });
  }
  if (pinnedBlock === undefined) await assertLifecycleBlock(options.client, block);
  return { ...author, hub: options.hub, assets, balances, sources };
}
export async function buildSetAuthorPayoutTransaction(options: LifecycleAuthorOptions & { payout: Address; account: Address; chainId: bigint }): Promise<LifecycleUnsignedTransaction> {
  requireAddress(options.payout, "New payout/controller");
  const block = await readLifecycleBlock(options.client);
  const author = await readAuthorContext(options, block);
  if (!author.known) throw new LifecyclePlanningError("UNKNOWN_AUTHOR", "Cannot set a payout for an unknown stable author identity");
  const admin = await readLifecycleContract<Address>(options.client, options.registry, lifecycleRegistryAbi, "admin", [], block);
  if (![author.payout, admin].some((address) => address.toLowerCase() === options.account.toLowerCase())) throw new LifecyclePlanningError("AUTHOR_AUTHORIZATION", "Only the registry admin or current live payout/controller may change routing");
  const transaction = unsignedTransaction(options, author, options.registry, encodeFunctionData({ abi: lifecycleRegistryAbi, functionName: "setAuthorPayout", args: [options.authorId, options.payout] }));
  await assertLifecycleBlock(options.client, block);
  return transaction;
}
export async function buildClaimDeveloperFeesTransaction(options: LifecycleAuthorOptions & { hub: Address; asset: Address; account: Address; chainId: bigint }): Promise<DeveloperClaimTransaction> {
  requireAddress(options.asset, "Developer fee asset");
  const block = await readLifecycleBlock(options.client);
  const author = await readAuthorContext(options, block);
  await requireCanonicalHub(options.client, author, options.hub, block);
  const assets = await readLifecycleContract<readonly Address[]>(options.client, options.hub, lifecycleFeeHubAbi, "assets", [], block);
  if (!assets.some((asset) => asset.toLowerCase() === options.asset.toLowerCase())) throw new LifecyclePlanningError("UNSUPPORTED_ASSET", "Direct developer claims require an asset supported by this canonical hub");
  const transaction = unsignedTransaction(options, author, options.hub, encodeFunctionData({ abi: lifecycleFeeHubAbi, functionName: "claimDeveloperFees", args: [options.authorId, options.asset] }));
  await assertLifecycleBlock(options.client, block);
  return { ...transaction, claim: { kind: "direct", registry: options.registry, factory: author.factory, authorId: options.authorId, hub: options.hub, asset: options.asset } };
}
export async function buildClaimDeveloperFeesPageTransaction(options: LifecycleAuthorOptions & { offset: bigint; limit: bigint; assets?: readonly Address[]; account: Address; chainId: bigint }): Promise<DeveloperClaimTransaction> {
  const assets = [...options.assets ?? []];
  validateAssets(assets); requirePage(options.offset, options.limit, 10n);
  const block = await readLifecycleBlock(options.client);
  const page = await readAuthorHubs(options, block);
  const transaction = unsignedTransaction(options, page, page.factory, encodeFunctionData({ abi: lifecycleFeeHubFactoryAbi, functionName: "claimDeveloperFeesPage", args: [options.authorId, options.offset, options.limit, assets] }));
  await assertLifecycleBlock(options.client, block);
  return { ...transaction, claim: { kind: "page", registry: options.registry, factory: page.factory, authorId: options.authorId, offset: options.offset, limit: options.limit, assets } };
}

/** Receipt logs report payment facts, not pending credits or a promise that every cursor row paid. */
export function decodeDeveloperClaimReceipt(options: { receipt: DeveloperClaimReceiptInput; transaction: DeveloperClaimTransaction }): DeveloperClaimReceipt {
  const { receipt, transaction } = options; const claim = transaction.claim;
  if (receipt.from.toLowerCase() !== transaction.from.toLowerCase() || receipt.to?.toLowerCase() !== transaction.to.toLowerCase() || transaction.value !== 0n) throw new LifecyclePlanningError("CLAIM_RECEIPT_IDENTITY", "Receipt account/target differs from the unsigned claim context");
  const expectedData = claim.kind === "direct"
    ? encodeFunctionData({ abi: lifecycleFeeHubAbi, functionName: "claimDeveloperFees", args: [claim.authorId, claim.asset] })
    : encodeFunctionData({ abi: lifecycleFeeHubFactoryAbi, functionName: "claimDeveloperFeesPage", args: [claim.authorId, claim.offset, claim.limit, claim.assets] });
  if (transaction.data.toLowerCase() !== expectedData.toLowerCase() || transaction.to.toLowerCase() !== (claim.kind === "direct" ? claim.hub : claim.factory).toLowerCase()) throw new LifecyclePlanningError("CLAIM_RECEIPT_IDENTITY", "Unsigned context does not encode this exact fixed-destination claim");
  const executionSucceeded = ["success", "0x1", 1, 1n].includes(receipt.status);
  if (!executionSucceeded) {
    if (!["reverted", "0x0", 0, 0n].includes(receipt.status)) throw new LifecyclePlanningError("INVALID_CLAIM_RECEIPT", "Receipt status is not a canonical success/revert value");
    return { executionSucceeded: false, outcome: "reverted", results: [], retryableResults: [], cursorComplete: false, paymentsSucceeded: false, reason: "Claim execution reverted; no payment or cursor advancement occurred" };
  }
  const results: DeveloperClaimResult[] = [];
  let cursor: { offset: bigint; nextOffset: bigint; total: bigint } | undefined;
  const seen = new Set<string>();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== transaction.to.toLowerCase()) continue;
    if (log.removed) throw new LifecyclePlanningError("CLAIM_RECEIPT_REORGED", "Removed claim logs cannot prove payment");
    if (claim.kind === "direct") {
      let event;
      try { event = decodeEventLog({ abi: lifecycleFeeHubAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]], strict: true }); } catch { continue; }
      if (event.eventName !== "DeveloperFeesClaimed") continue;
      if (event.args.authorId.toLowerCase() !== claim.authorId.toLowerCase() || event.args.asset.toLowerCase() !== claim.asset.toLowerCase() || event.args.amount === 0n || results.length !== 0) throw new LifecyclePlanningError("INVALID_CLAIM_RECEIPT", "Direct payment event differs from the expected author/asset or is duplicated");
      results.push({ hub: claim.hub, asset: event.args.asset, amount: event.args.amount, status: 0, outcome: "paid", errorSelector: "0x00000000", payout: event.args.payout });
    } else {
      let event;
      try { event = decodeEventLog({ abi: lifecycleFeeHubFactoryAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]], strict: true }); } catch { continue; }
      if (event.eventName === "DeveloperClaimPage") {
        if (event.args.authorId.toLowerCase() !== claim.authorId.toLowerCase() || event.args.offset !== claim.offset || cursor !== undefined || event.args.nextOffset < claim.offset || event.args.nextOffset > event.args.total || event.args.nextOffset - claim.offset > claim.limit) throw new LifecyclePlanningError("INVALID_CLAIM_RECEIPT", "Page cursor differs from the bounded expected claim");
        cursor = { offset: event.args.offset, nextOffset: event.args.nextOffset, total: event.args.total };
      } else if (event.eventName === "DeveloperClaimResult") {
        const { authorId, hub, asset, amount, status, errorSelector } = event.args;
        const key = `${hub.toLowerCase()}:${asset.toLowerCase()}`;
        if (authorId.toLowerCase() !== claim.authorId.toLowerCase() || status > 3 || seen.has(key) ||
          (claim.assets.length !== 0 && !claim.assets.some((selected) => selected.toLowerCase() === asset.toLowerCase())) ||
          (status === 0 ? amount === 0n : amount !== 0n) || (status < 2 && errorSelector !== "0x00000000")) throw new LifecyclePlanningError("INVALID_CLAIM_RECEIPT", "Factory result has a mismatched author, asset, status, amount or duplicate row");
        seen.add(key);
        results.push({ hub, asset, amount, status: status as 0 | 1 | 2 | 3, outcome: (["paid", "zero", "unsupported", "failed"] as const)[status]!, errorSelector });
      }
    }
  }
  if (claim.kind === "page") {
    if (cursor === undefined) throw new LifecyclePlanningError("INVALID_CLAIM_RECEIPT", "Successful page receipt lacks the canonical cursor event");
    const hubCount = BigInt(new Set(results.map((result) => result.hub.toLowerCase())).size);
    if (hubCount !== cursor.nextOffset - cursor.offset || (claim.assets.length !== 0 && BigInt(results.length) !== hubCount * BigInt(claim.assets.length))) throw new LifecyclePlanningError("INVALID_CLAIM_RECEIPT", "Receipt rows do not account for every hub/asset in the observed cursor page");
  }
  return { executionSucceeded: true, outcome: results.length !== 0 || cursor !== undefined ? "observed" : "unobserved", results,
    retryableResults: results.filter((result) => result.status === 3), cursorComplete: cursor !== undefined && cursor.nextOffset === cursor.total,
    paymentsSucceeded: (results.length !== 0 || cursor !== undefined) && results.every((result) => result.status < 2), ...cursor,
    reason: claim.kind === "direct" && results.length === 0 ? "No direct payment event is present; zero credit is possible, but an amount is not receipt-proven" : undefined };
}
