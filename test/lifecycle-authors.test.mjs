import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, encodeFunctionResult, parseAbi, parseAbiParameters, toHex } from "viem";
const sdkPath = process.env.SDK_SOURCE_TEST === "1" ? "../src/lifecycle/index.ts" : "../dist/lifecycle/index.js";
const { buildClaimDeveloperFeesTransaction, buildClaimDeveloperFeesPageTransaction, buildSetAuthorPayoutTransaction, decodeDeveloperClaimReceipt, readAuthorHubs, readDeveloperFees } = await import(sdkPath);
const address = (n) => toHex(BigInt(n), { size: 20 });
const registry = address(1), core = address(2), factory = address(3), hub = address(4), authorId = address(5), oldPayout = address(6), newPayout = address(7), admin = address(8), asset = address(9), caller = address(10);
const chainId = 31337n;
const readAbi = parseAbi([
  "function core() view returns (address)", "function registry() view returns (address)", "function feeFactory() view returns (address)",
  "function implementationRegistry() view returns (address)", "function deploymentAuthority() view returns (address)",
  "function authorPayout(address) view returns (address)", "function authorHubCount(address) view returns (uint256)", "function admin() view returns (address)",
  "function isHub(address) view returns (bool)", "function economicVersion() view returns (uint16)", "function configurator() view returns (address)",
  "function assets() view returns (address[])", "function claimDeveloperFees(address authorId,address asset) returns (uint256)",
  "function claimDeveloperFeesPage(address authorId,uint256 offset,uint256 limit,address[] assets) returns (uint256,uint256,(address,address,uint256,uint8,bytes4)[])",
  "function setAuthorPayout(address authorId,address payout)",
]);
const eventAbi = parseAbi([
  "event DeveloperFeesClaimed(address indexed authorId,address indexed asset,address indexed payout,uint256 amount)",
  "event DeveloperClaimResult(address indexed authorId,address indexed hub,address indexed asset,uint256 amount,uint8 status,bytes4 errorSelector)",
  "event DeveloperClaimPage(address indexed authorId,uint256 offset,uint256 nextOffset,uint256 total)",
]);
function contextClient(member = true) {
  let payout = oldPayout;
  let hubReads = 0;
  return {
    get hubReads() { return hubReads; }, set payout(value) { payout = value; },
    async request({ method, params = [] }) {
      if (method === "eth_chainId") return toHex(chainId);
      if (method === "eth_getBlockByNumber") return { number: "0x64", hash: toHex(100n, { size: 32 }), timestamp: "0x65", gasLimit: "0x1e84800" };
      if (method !== "eth_call") throw new Error(`Unexpected RPC: ${method}`);
      const to = params[0].to.toLowerCase();
      const { functionName } = decodeFunctionData({ abi: readAbi, data: params[0].data });
      let result;
      if (to === registry) {
        result = { core, authorPayout: payout, authorHubCount: 1n, admin }[functionName];
      } else if (to === core) result = { registry, feeFactory: factory }[functionName];
      else if (to === factory) result = { implementationRegistry: registry, deploymentAuthority: core, isHub: member }[functionName];
      else if (to === hub) { hubReads += 1; result = { economicVersion: 3, implementationRegistry: registry, configurator: core, assets: [asset] }[functionName]; }
      if (result === undefined) throw new Error(`Unexpected ${functionName} on ${to}`);
      return encodeFunctionResult({ abi: readAbi, functionName, result });
    },
  };
}
const options = { registry, authorId, hub, asset, account: caller, chainId };
function directTransaction() {
  return { chainId: Number(chainId), from: caller, to: hub, value: 0n,
    data: encodeFunctionData({ abi: readAbi, functionName: "claimDeveloperFees", args: [authorId, asset] }),
    claim: { kind: "direct", registry, factory, authorId, hub, asset } };
}
function pageTransaction(assets, total = 1n) {
  return { chainId: Number(chainId), from: caller, to: factory, value: 0n,
    data: encodeFunctionData({ abi: readAbi, functionName: "claimDeveloperFeesPage", args: [authorId, 0n, 1n, assets] }),
    claim: { kind: "page", registry, factory, authorId, offset: 0n, limit: 1n, assets } };
}
function receipt(transaction, logs = [], status = "0x1") { return { from: transaction.from, to: transaction.to, status, logs }; }
function resultLog(asset, amount, status, errorSelector = "0x00000000") {
  return { address: factory, topics: encodeEventTopics({ abi: eventAbi, eventName: "DeveloperClaimResult", args: { authorId, hub, asset } }),
    data: encodeAbiParameters(parseAbiParameters("uint256,uint8,bytes4"), [amount, status, errorSelector]) };
}
function pageLog(nextOffset, total) {
  return { address: factory, topics: encodeEventTopics({ abi: eventAbi, eventName: "DeveloperClaimPage", args: { authorId } }),
    data: encodeAbiParameters(parseAbiParameters("uint256,uint256,uint256"), [0n, nextOffset, total]) };
}

test("attacker hub self-reports cannot replace membership in registry.core's canonical factory", async () => {
  const client = contextClient(false);
  await assert.rejects(readDeveloperFees({ client, registry, authorId, hub }), { code: "UNAUTHENTICATED_HUB" });
  assert.equal(client.hubReads, 0, "Untrusted hub getters are never queried before authentication");
});

test("routing updates follow the current live payout, while claims commit only stable authorId", async () => {
  const client = contextClient();
  const first = await buildClaimDeveloperFeesTransaction({ ...options, client });
  const update = await buildSetAuthorPayoutTransaction({ client, registry, authorId, payout: newPayout, account: oldPayout, chainId });
  assert.deepEqual(decodeFunctionData({ abi: readAbi, data: update.data }).args.map((value) => value.toLowerCase()), [authorId, newPayout]);
  client.payout = newPayout;
  await assert.rejects(buildSetAuthorPayoutTransaction({ client, registry, authorId, payout: oldPayout, account: oldPayout, chainId }), { code: "AUTHOR_AUTHORIZATION" });
  const second = await buildClaimDeveloperFeesTransaction({ ...options, client });
  assert.equal(first.data, second.data, "Live payout changes never rewrite the stable economic beneficiary or add a caller-selected destination");
  assert.equal(second.from, caller); assert.equal(second.to, hub); assert.equal(second.value, 0n);
  await assert.rejects(buildClaimDeveloperFeesTransaction({ ...options, client, chainId: 4663n }), { code: "CHAIN_MISMATCH" });
});

test("author discovery and page claim bounds reject invalid ranges/assets before RPC", async () => {
  const client = { request() { throw new Error("Invalid input must not query RPC"); } };
  await assert.rejects(readAuthorHubs({ client, registry, authorId, limit: 101n }), { code: "INVALID_AUTHOR_PAGE" });
  await assert.rejects(buildClaimDeveloperFeesPageTransaction({ ...options, client, offset: 0n, limit: 11n }), { code: "INVALID_AUTHOR_PAGE" });
  await assert.rejects(buildClaimDeveloperFeesPageTransaction({ ...options, client, offset: 0n, limit: 1n, assets: [asset, address(1)] }), { code: "INVALID_CLAIM_ASSETS" });
});

test("page cursor completion is independent of payment success and failed rows remain retryable", () => {
  const assets = [asset, address(11), address(12), address(13)];
  const transaction = pageTransaction(assets);
  const logs = [resultLog(assets[0], 7n, 0), resultLog(assets[1], 0n, 1), resultLog(assets[2], 0n, 2, "0x12345678"), resultLog(assets[3], 0n, 3, "0x87654321"), pageLog(1n, 1n)];
  const result = decodeDeveloperClaimReceipt({ transaction, receipt: receipt(transaction, logs) });
  assert.deepEqual(result.results.map((row) => row.outcome), ["paid", "zero", "unsupported", "failed"]);
  assert.equal(result.cursorComplete, true); assert.equal(result.paymentsSucceeded, false);
  assert.deepEqual(result.retryableResults.map((row) => [row.asset.toLowerCase(), row.errorSelector]), [[assets[3], "0x87654321"]]);
  const remaining = decodeDeveloperClaimReceipt({ transaction: pageTransaction([asset]), receipt: receipt(pageTransaction([asset]), [resultLog(asset, 7n, 0), pageLog(1n, 2n)]) });
  assert.equal(remaining.cursorComplete, false); assert.equal(remaining.paymentsSucceeded, true);
});

test("direct receipts expose live payment facts and never manufacture zero from missing logs", () => {
  const transaction = directTransaction();
  const log = { address: hub, topics: encodeEventTopics({ abi: eventAbi, eventName: "DeveloperFeesClaimed", args: { authorId, asset, payout: newPayout } }), data: encodeAbiParameters(parseAbiParameters("uint256"), [9n]) };
  const paid = decodeDeveloperClaimReceipt({ transaction, receipt: receipt(transaction, [log]) });
  assert.equal(paid.results[0].amount, 9n); assert.equal(paid.results[0].payout.toLowerCase(), newPayout);
  const unknown = decodeDeveloperClaimReceipt({ transaction, receipt: receipt(transaction) });
  assert.equal(unknown.outcome, "unobserved"); assert.equal(unknown.paymentsSucceeded, false); assert.deepEqual(unknown.results, []);
  const reverted = decodeDeveloperClaimReceipt({ transaction, receipt: receipt(transaction, [log], "0x0") });
  assert.equal(reverted.outcome, "reverted"); assert.deepEqual(reverted.results, []);
  assert.throws(() => decodeDeveloperClaimReceipt({ transaction, receipt: receipt(transaction, [{ ...log, removed: true }]) }), { code: "CLAIM_RECEIPT_REORGED" });
  assert.throws(() => decodeDeveloperClaimReceipt({ transaction, receipt: { ...receipt(transaction, [log]), to: factory } }), { code: "CLAIM_RECEIPT_IDENTITY" });
});

test("page receipt cannot turn missing, duplicated or fabricated amount rows into successful progress", () => {
  const transaction = pageTransaction([asset]);
  assert.throws(() => decodeDeveloperClaimReceipt({ transaction, receipt: receipt(transaction, [pageLog(1n, 1n)]) }), { code: "INVALID_CLAIM_RECEIPT" });
  assert.throws(() => decodeDeveloperClaimReceipt({ transaction, receipt: receipt(transaction, [resultLog(asset, 0n, 0), pageLog(1n, 1n)]) }), { code: "INVALID_CLAIM_RECEIPT" });
  assert.throws(() => decodeDeveloperClaimReceipt({ transaction, receipt: receipt(transaction, [resultLog(asset, 1n, 0), resultLog(asset, 1n, 0), pageLog(1n, 1n)]) }), { code: "INVALID_CLAIM_RECEIPT" });
});
