import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { decodeFunctionData, zeroHash } from "viem";

const sdkPath = process.env.SDK_SOURCE_TEST === "1" ? "../src/index.ts" : "../dist/index.js";
const sdk = await import(sdkPath);
const fixture = JSON.parse(await readFile(new URL("./fixtures/launch-lifecycle-v1.json", import.meta.url), "utf8"));
const identity = { chainId: 4663n, orchestrator: "0x91560876033d568d25CDe98C78c33ff8FC43962c" };

function allocatedPlan() {
  const original = sdk.parseLaunchPlan(JSON.stringify(fixture.plan));
  const v4 = sdk.getKnownLifecycleProfile({ ...identity, key: sdk.KnownLifecycleProfile.V4FixedFeePool });
  const abyss = sdk.getKnownLifecycleProfile({ ...identity, key: sdk.KnownLifecycleProfile.Abyss3 });
  const budget = 1_000_003n;
  const ranges = sdk.deriveLaunchPositionRanges({ launchSqrtPriceX96: 1n << 96n, launchedTokenIsQuote: true,
    tokenBudget: budget, tickSpacing: 60, venue: "uniswap-v4", distributionPreset: "smooth-ramp", positionCount: 5 });
  const envelope = v4.profile.envelope;
  const config = { version: 6, lpFeePips: 3000, hookFeePips: 10000, minimumHookFeePips: 1000,
    feeSensitivityPipsSecondsPerTick: 7654321, tickSpacing: 60, sqrtPriceX96: ranges.launchSqrtPriceX96,
    feeMode: 0, protocolFeeDenominator: envelope.protocolFeeDenominator, treasury: envelope.protocolTreasury,
    externalLiquidityDisabled: true, oracleConfigId: sdk.LAUNCH_ORACLE_CONFIG_ID, hookSalt: zeroHash,
    profileId: v4.profile.id, termsDigest: envelope.termsDigest, developerBeneficiary: envelope.beneficiary,
    developerFeeBps: 0, positions: ranges.positions.map((position) => ({ tickLower: position.tickLower,
      tickUpper: position.tickUpper, liquidity: position.liquidity, maxTokenAmount: position.maxTokenAmount, salt: zeroHash })) };
  const markets = [
    { ...original.markets[0], adapterId: v4.profile.registration.adapterId, profileId: v4.profile.id,
      tokenBudget: budget, configVersion: 6, config: sdk.encodePoolBoundV4LifecycleMarketConfig(config) },
    { ...original.markets[1], adapterId: abyss.profile.registration.adapterId, profileId: abyss.profile.id,
      tokenBudget: budget, configVersion: 1, config: sdk.encodeAbyssLifecycleMarketConfig({ profile: 3, fee: 3000,
        oracleConfigId: sdk.LAUNCH_ORACLE_CONFIG_ID, openingSqrtPriceX96: ranges.launchSqrtPriceX96,
        positions: ranges.positions.map((position) => ({ tickLower: position.tickLower, tickUpper: position.tickUpper,
          liquidity: position.liquidity, tokenAmountMaximum: position.maxTokenAmount })) }) },
  ];
  return { ...original, ...identity, token: { ...original.token, kind: 0, rewardMode: 0, nftUnit: 0n, supply: budget * 2n },
    feeAssets: original.feeAssets.map((policy) => ({ ...policy, ownerBps: 10000, rewardsBps: 0, burnBps: 0 })),
    funding: [], buys: [], markets };
}

test("mainnet defaults select fresh frozen construction and recipes compile the entire intended supply", () => {
  const plan = allocatedPlan();
  assert.equal(sdk.getAddresses(4663).launchOrchestrator, plan.orchestrator);
  const deployment = sdk.getKnownLifecycleDeployment(identity);
  assert.equal(sdk.getAddresses(4663).launchImplementationRegistry, deployment.registry);
  assert.equal(sdk.getAddresses(4663).launchFeeOwnerRegistry, "0x64b5ca1f21B8E84305b0e4D847924dca39Eb1fcb");
  assert.equal(plan.markets.reduce((sum, market) => sum + market.tokenBudget, 0n), plan.token.supply);
  for (const mode of ["atomic", "staged"]) {
    const transactions = sdk.buildLaunchTransactions({ plan, mode, ...(mode === "staged" ? { preparationBatches: [1, 1] } : {}) });
    assert.deepEqual(transactions.map((tx) => tx.kind), mode === "atomic" ? ["atomic"] : ["begin", "prepare", "prepare", "activate"]);
    for (const transaction of transactions) {
      const decoded = decodeFunctionData({ abi: sdk.launchLifecycleAbi, data: transaction.data });
      assert.equal(sdk.hashLaunchPlan(decoded.args[0]), sdk.hashLaunchPlan(plan));
      assert.equal(transaction.calldataBytes, (transaction.data.length - 2) / 2);
      assert.equal(transaction.to, identity.orchestrator);
    }
  }
  assert.throws(() => sdk.buildLaunchTransactions({ plan }), { code: "EXPLICIT_MODE_REQUIRED" });
});

test("planner and pure compiler reject both underallocation and overallocation for supply and every venue", async () => {
  const original = allocatedPlan();
  const client = { request() { assert.fail("Allocation refusal must precede every provider call"); } };
  const invalid = [];
  for (const delta of [-1n, 1n]) {
    invalid.push({ ...original, token: { ...original.token, supply: original.token.supply + delta } });
    for (const marketIndex of [0, 1]) {
      const markets = original.markets.map((market) => ({ ...market }));
      const market = markets[marketIndex];
      if (market.configVersion === 6) {
        const config = sdk.decodePoolBoundV4LifecycleMarketConfig(market.config, 6);
        market.config = sdk.encodePoolBoundV4LifecycleMarketConfig({ ...config, positions: config.positions.map((p, i) => i === 0 ? { ...p, maxTokenAmount: p.maxTokenAmount + delta } : p) });
      } else {
        const config = sdk.decodeAbyssLifecycleMarketConfig(market.config);
        market.config = sdk.encodeAbyssLifecycleMarketConfig({ ...config, positions: config.positions.map((p, i) => i === 0 ? { ...p, tokenAmountMaximum: p.tokenAmountMaximum + delta } : p) });
      }
      invalid.push({ ...original, markets });
    }
  }
  for (const plan of invalid) {
    for (const mode of ["atomic", "staged"]) {
      assert.throws(() => sdk.buildLaunchTransactions({ plan, mode }), { code: "INVALID_TOKEN_BUDGET" });
      await assert.rejects(sdk.planLaunch({ client, plan, account: plan.creator, mode }), { code: "INVALID_TOKEN_BUDGET" });
    }
  }
});
