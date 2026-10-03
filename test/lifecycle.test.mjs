import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { decodeFunctionData, getAbiItem, toFunctionSelector, toEventSelector } from "viem";

const sdkPath = process.env.SDK_SOURCE_TEST === "1" ? "../src/lifecycle/index.ts" : "../dist/lifecycle/index.js";
const { createControlledLifecycleFork, encodeLaunchPlan, hashLaunchIdentity, hashLaunchPlan, launchLifecycleAbi, LifecycleRewardMode, LifecycleTokenKind, LIFECYCLE_MAX_REWARD_ERC20_SUPPLY, LIFECYCLE_MAX_ERC404_SUPPLY, parseLaunchPlan, planLaunch, serializeLaunchPlan } = await import(sdkPath);
const fixture = JSON.parse(await readFile(new URL("./fixtures/launch-lifecycle-v1.json", import.meta.url), "utf8"));
const plan = parseLaunchPlan(JSON.stringify(fixture.plan));

test("portable economic commitment preserves large integers, Unicode, ordered buys and both venue configs", () => {
  assert.equal(encodeLaunchPlan(plan), fixture.encodedPlan);
  assert.equal(hashLaunchPlan(plan), fixture.planHash);
  assert.equal(hashLaunchIdentity(plan), fixture.launchId);
  assert.deepEqual(parseLaunchPlan(serializeLaunchPlan(plan)), plan);
  assert.equal(plan.nonce, 6277101735386680763835789423207666416102355444464034512913n);
});

test("cross-chain/core/account/nonce identities cannot replay the same commitment", () => {
  for (const changed of [
    { ...plan, chainId: plan.chainId + 1n },
    { ...plan, orchestrator: "0x00000000000000000000000000000000000000f1" },
    { ...plan, creator: "0x00000000000000000000000000000000000000a1" },
    { ...plan, nonce: plan.nonce + 1n },
  ]) {
    assert.notEqual(hashLaunchPlan(changed), fixture.planHash);
    assert.notEqual(hashLaunchIdentity(changed), fixture.launchId);
  }
});

test("every economic category changes the plan commitment without changing its identity namespace", () => {
  const changes = [
    { ...plan, token: { ...plan.token, nftUnit: plan.token.nftUnit + 1n } },
    { ...plan, token: { ...plan.token, inventoryRecipient: "0x00000000000000000000000000000000000000a1" } },
    { ...plan, token: { ...plan.token, burnOnCancel: false } },
    { ...plan, funding: plan.funding.map((item, index) => index === 0 ? { ...item, inputAmount: item.inputAmount + 1n } : item) },
    { ...plan, feeAssets: plan.feeAssets.map((item, index) => index === 0 ? { ...item, ownerBps: 7000, burnBps: 3000 } : item) },
    { ...plan, markets: plan.markets.map((item, index) => index === 0 ? { ...item, tokenBudget: item.tokenBudget + 1n } : item) },
    { ...plan, markets: plan.markets.map((item, index) => index === 0 ? { ...item, configVersion: 2 } : item) },
    { ...plan, buys: [...plan.buys].reverse() },
    { ...plan, buys: plan.buys.map((item, index) => index === 0 ? { ...item, minTokenOut: item.minTokenOut + 1n } : item) },
    { ...plan, deadline: plan.deadline + 1n },
    { ...plan, executorFeeBps: plan.executorFeeBps + 1 },
  ];
  for (const changed of changes) {
    assert.notEqual(hashLaunchPlan(changed), fixture.planHash);
    assert.equal(hashLaunchIdentity(changed), fixture.launchId);
  }
});

test("portable parser rejects lossy integers and out-of-width economics before transaction construction", () => {
  for (const changed of [
    { ...fixture.plan, nonce: Number(fixture.plan.nonce) },
    { ...fixture.plan, nonce: "-1" },
    { ...fixture.plan, chainId: "0x7a69" },
    { ...fixture.plan, executorFeeBps: 65536 },
    { ...fixture.plan, token: { ...fixture.plan.token, kind: 2 } },
    { ...fixture.plan, token: { ...fixture.plan.token, supply: (2n ** 256n).toString() } },
    { ...fixture.plan, buys: fixture.plan.buys.map((item, index) => index === 0 ? { ...item, sqrtPriceLimitX96: (2n ** 160n).toString() } : item) },
  ]) assert.throws(() => parseLaunchPlan(JSON.stringify(changed)));
});

test("supplies within ABI uint256 but outside the token/reward precision domain are rejected explicitly", async () => {
  const client = { request: async () => { throw new Error("No RPC is configured for an invalid economic plan"); } };
  for (const token of [
    ...[LifecycleRewardMode.Staking, LifecycleRewardMode.Dividends].map((rewardMode) => ({ ...plan.token, kind: LifecycleTokenKind.ERC20, rewardMode, nftUnit: 0n, supply: LIFECYCLE_MAX_REWARD_ERC20_SUPPLY + 1n })),
    { ...plan.token, kind: LifecycleTokenKind.ERC404, supply: LIFECYCLE_MAX_ERC404_SUPPLY + 1n },
  ]) await assert.rejects(planLaunch({ client, plan: { ...plan, token }, account: plan.creator, mode: "atomic" }), { code: "INVALID_TOKEN_SUPPLY" });
});

test("controlled fork setup refuses a production write endpoint or the source RPC itself", () => {
  assert.throws(() => createControlledLifecycleFork({ sourceRpcUrl: "https://chain.example", forkRpcUrl: "https://another-chain.example", allowTransactions: true }), { code: "UNSAFE_FORK" });
  assert.throws(() => createControlledLifecycleFork({ sourceRpcUrl: "http://127.0.0.1:8545", forkRpcUrl: "http://127.0.0.1:8545", allowTransactions: true }), { code: "UNSAFE_FORK" });
  assert.throws(() => createControlledLifecycleFork({ sourceRpcUrl: "http://127.0.0.1:8545", forkRpcUrl: "http://localhost:8545", allowTransactions: true }), { code: "UNSAFE_FORK" });
});

const artifactDirectory = process.env.LIFECYCLE_ARTIFACT_DIR;
test("public lifecycle calldata and receipt events match the independently compiled Solidity ABI", { skip: artifactDirectory === undefined }, async () => {
  const artifact = JSON.parse(await readFile(`${artifactDirectory}/LaunchOrchestratorV1.sol/LaunchOrchestratorV1.json`, "utf8"));
  for (const name of ["hashPlan", "launchIdOf", "predictToken", "launchAtomic", "beginLaunch", "prepareMarkets", "activateLaunch", "cancelLaunch", "readLaunchProgress"]) {
    assert.equal(toFunctionSelector(getAbiItem({ abi: launchLifecycleAbi, name })), toFunctionSelector(getAbiItem({ abi: artifact.abi, name })));
  }
  for (const name of ["LaunchBegun", "MarketPrepared", "LaunchReady", "InitialBuyExecuted", "LaunchActivated", "LaunchCancelled", "AssetRefunded"]) {
    assert.equal(toEventSelector(getAbiItem({ abi: launchLifecycleAbi, name })), toEventSelector(getAbiItem({ abi: artifact.abi, name })));
  }
  const { encodeFunctionData } = await import("viem");
  for (const name of ["launchAtomic", "activateLaunch", "cancelLaunch"]) {
    const data = encodeFunctionData({ abi: artifact.abi, functionName: name, args: [plan] });
    const decoded = decodeFunctionData({ abi: launchLifecycleAbi, data });
    assert.equal(decoded.functionName, name);
    assert.equal(hashLaunchPlan(decoded.args[0]), fixture.planHash);
  }
});
