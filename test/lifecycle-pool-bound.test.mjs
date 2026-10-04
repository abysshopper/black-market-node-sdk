import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { concatHex, encodeAbiParameters, keccak256, parseAbiParameters, stringToHex, toHex, zeroAddress, zeroHash } from "viem";

const sdkPath = process.env.SDK_SOURCE_TEST === "1" ? "../src/lifecycle/index.ts" : "../dist/lifecycle/index.js";
const {
  decodePoolBoundV4LifecycleMarketConfig, decodeV4LifecycleMarketConfig, encodePoolBoundHookParameters,
  encodePoolBoundV4LifecycleMarketConfig, hashLaunchPlan, hashPoolBoundV4MarketCommitment,
  minePoolBoundHookSalt, parseLaunchPlan, planLaunch, poolBoundHookInitCodeHash,
} = await import(sdkPath);
const fixture = JSON.parse(await readFile(new URL("./fixtures/launch-lifecycle-v1.json", import.meta.url), "utf8"));
const config = {
  ...decodeV4LifecycleMarketConfig(fixture.plan.markets[0].config), version: 5, profileId: toHex(31n, { size: 32 }),
  hookSalt: toHex(123456789012345678901234567890n, { size: 32 }),
};
const market = {
  ...parseLaunchPlan(JSON.stringify(fixture.plan)).markets[0], adapterId: toHex(41n, { size: 32 }),
  profileId: config.profileId, configVersion: 5,
  config: encodePoolBoundV4LifecycleMarketConfig(config),
};
const context = {
  chainId: 31337n, core: "0x00000000000000000000000000000000000000f0",
  registrar: "0x00000000000000000000000000000000000000f1",
  token: "0x0000000000000000000000000000000000000010", market,
};
const parameters = {
  poolManager: "0x00000000000000000000000000000000000000f2", registrar: context.registrar,
  oracleFactory: "0x00000000000000000000000000000000000000f3", core: context.core,
  liquidityLocker: "0x00000000000000000000000000000000000000f4", token: context.token,
  quoteCurrency: market.quoteAsset, lpFeePips: config.lpFeePips, tickSpacing: config.tickSpacing,
  sqrtPriceX96: config.sqrtPriceX96, hookFeePips: config.hookFeePips, feeMode: config.feeMode,
  protocolFeeDenominator: config.protocolFeeDenominator, treasury: config.treasury,
  externalLiquidityDisabled: config.externalLiquidityDisabled, oracleConfigId: config.oracleConfigId,
  marketCommitment: hashPoolBoundV4MarketCommitment(context), expectedPositionCount: config.positions.length,
};

function literalV5(config) {
  return encodeAbiParameters(parseAbiParameters("(uint16,uint24,int24,uint160,uint24,uint8,uint8,address,bool,bytes32,bytes32,bytes32,bytes32,address,uint16,(int24,int24,uint128,bytes32,uint256)[])"), [[
    config.version, config.lpFeePips, config.tickSpacing, config.sqrtPriceX96, config.hookFeePips,
    config.feeMode, config.protocolFeeDenominator, config.treasury, config.externalLiquidityDisabled,
    config.oracleConfigId, config.hookSalt, config.profileId, config.termsDigest, config.developerBeneficiary, config.developerFeeBps,
    config.positions.map((p) => [p.tickLower, p.tickUpper, p.liquidity, p.salt, p.maxTokenAmount]),
  ]]);
}

// Reference CREATE2 preimage is literal EIP-1014, independent of the SDK predictor/miner.
function referencePrediction(deployer, initCodeHash, salt) {
  const hash = keccak256(concatHex(["0xff", deployer, toHex(salt, { size: 32 }), initCodeHash]));
  return `0x${hash.slice(-40)}`;
}
function referenceWinner(deployer, initCodeHash, start = 0n) {
  for (let salt = start; salt < start + 1_000_000n; salt += 1n) {
    const predictedHook = referencePrediction(deployer, initCodeHash, salt);
    if ((BigInt(predictedHook) & 0x3fffn) === 0x1afcn) return { salt, predictedHook };
  }
  throw new Error("Independent reference search did not find a hook salt");
}

test("pool-bound config commits salt before reviewed identity/terms and refuses other wire versions", () => {
  const encoded = literalV5(config);
  assert.equal(encodePoolBoundV4LifecycleMarketConfig(config), encoded);
  const decoded = decodePoolBoundV4LifecycleMarketConfig(encoded);
  assert.deepEqual({ ...decoded, treasury: decoded.treasury.toLowerCase() }, { ...config, treasury: config.treasury.toLowerCase() });
  for (const version of [0, 1, 2, 3, 4, 6]) {
    assert.throws(() => encodePoolBoundV4LifecycleMarketConfig({ ...config, version }));
    assert.throws(() => decodePoolBoundV4LifecycleMarketConfig(literalV5({ ...config, version })));
  }
  assert.throws(() => decodeV4LifecycleMarketConfig(encoded));
});

test("bound economic commitment matches the independently encoded domain and normalizes only hookSalt", () => {
  const configHash = keccak256(literalV5({ ...config, hookSalt: zeroHash }));
  const expected = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint256,address,address,address,bytes32,bytes32,address,uint256,uint32,bytes32"), [
    keccak256(stringToHex("black-market.reviewed-pool-bound-market-economics.v1")), context.chainId, context.core,
    context.registrar, context.token, market.adapterId, market.profileId, market.quoteAsset,
    market.tokenBudget, market.configVersion, configHash,
  ]));
  assert.equal(hashPoolBoundV4MarketCommitment(context), expected);
  const salted = { ...market, config: literalV5({ ...config, hookSalt: toHex(999n, { size: 32 }) }) };
  assert.equal(hashPoolBoundV4MarketCommitment({ ...context, market: salted }), expected);
  const plan = parseLaunchPlan(JSON.stringify(fixture.plan));
  assert.notEqual(hashLaunchPlan({ ...plan, markets: [market] }), hashLaunchPlan({ ...plan, markets: [salted] }), "The signed launch still commits its real hook salt");
  const economicChanges = [
    { ...config, lpFeePips: config.lpFeePips + 1 }, { ...config, tickSpacing: config.tickSpacing + 1 },
    { ...config, sqrtPriceX96: config.sqrtPriceX96 + 1n }, { ...config, hookFeePips: config.hookFeePips + 1 },
    { ...config, feeMode: 1 - config.feeMode }, { ...config, protocolFeeDenominator: 7 },
    { ...config, treasury: context.registrar }, { ...config, externalLiquidityDisabled: !config.externalLiquidityDisabled },
    { ...config, oracleConfigId: toHex(55n, { size: 32 }) },
    { ...config, termsDigest: toHex(22n, { size: 32 }) }, { ...config, developerBeneficiary: context.core },
    { ...config, developerFeeBps: config.developerFeeBps + 1 },
    ...["tickLower", "tickUpper", "liquidity", "salt", "maxTokenAmount"].map((field) => ({
      ...config, positions: config.positions.map((p, i) => i ? p : { ...p, [field]: field === "salt" ? toHex(99n, { size: 32 }) : p[field] + (typeof p[field] === "bigint" ? 1n : 1) }),
    })),
    { ...config, positions: [...config.positions, { ...config.positions[0], salt: toHex(101n, { size: 32 }) }] },
  ];
  for (const changed of economicChanges) assert.notEqual(hashPoolBoundV4MarketCommitment({ ...context, market: { ...market, config: literalV5(changed) } }), expected, "Every market economic field and every position invalidates previous mining");
  for (const changed of [
    { ...context, chainId: context.chainId + 1n }, { ...context, core: context.registrar },
    { ...context, registrar: context.core }, { ...context, token: context.core },
    { ...context, market: { ...market, adapterId: zeroHash } },
    { ...context, market: { ...market, quoteAsset: context.core } },
    { ...context, market: { ...market, tokenBudget: market.tokenBudget + 1n } },
  ]) assert.notEqual(hashPoolBoundV4MarketCommitment(changed), expected);
  assert.throws(() => hashPoolBoundV4MarketCommitment({ ...context, market: { ...market, profileId: fixture.plan.markets[0].profileId } }), { code: "INVALID_BOUND_MARKET" });
});

test("the eighteen constructor words bind the creation hash without collector, hub or planHash cycles", () => {
  const expected = encodeAbiParameters(parseAbiParameters("(address,address,address,address,address,address,address,uint24,int24,uint160,uint24,uint8,uint8,address,bool,bytes32,bytes32,uint32)"), [[
    parameters.poolManager, parameters.registrar, parameters.oracleFactory, parameters.core, parameters.liquidityLocker,
    parameters.token, parameters.quoteCurrency, parameters.lpFeePips, parameters.tickSpacing, parameters.sqrtPriceX96,
    parameters.hookFeePips, parameters.feeMode, parameters.protocolFeeDenominator, parameters.treasury,
    parameters.externalLiquidityDisabled, parameters.oracleConfigId, parameters.marketCommitment, parameters.expectedPositionCount,
  ]]);
  assert.equal(encodePoolBoundHookParameters(parameters), expected);
  const creationCode = "0x600060005560016000f3";
  assert.equal(poolBoundHookInitCodeHash(creationCode, parameters), keccak256(concatHex([creationCode, expected])));
  for (const changed of [{ ...parameters, token: context.core }, { ...parameters, marketCommitment: zeroHash }, { ...parameters, expectedPositionCount: parameters.expectedPositionCount + 1 }]) assert.notEqual(poolBoundHookInitCodeHash(creationCode, changed), poolBoundHookInitCodeHash(creationCode, parameters));
});

test("async mining finds the first exact permissioned EIP-1014 address and yields rendering before returning", async () => {
  const deployer = zeroAddress;
  const initCodeHash = "0xbc36789e7a1e281436464229828f817d6612f7b477d66591ff96a9e064bcc98a";
  const expected = referenceWinner(deployer, initCodeHash);
  const progress = [];
  let renderingRan = false;
  const frame = new Promise((resolve) => setTimeout(() => { renderingRan = true; resolve(); }, 0));
  const mined = await minePoolBoundHookSalt({ deployer, initCodeHash, onProgress: (event) => progress.push(event) });
  assert.equal(renderingRan, true, "A queued render/input macrotask runs during mining");
  await frame;
  assert.equal(mined.salt, toHex(expected.salt, { size: 32 }));
  assert.equal(mined.predictedHook.toLowerCase(), expected.predictedHook);
  assert.equal(progress[0].attempts, 0n);
  assert.equal(progress.at(-1).attempts, expected.salt + 1n);
  const resumed = await minePoolBoundHookSalt({ deployer, initCodeHash, startSalt: expected.salt });
  assert.deepEqual(resumed, mined, "Already-finalized mining is deterministic and preserves the exact winner");
});

test("mining cancellation and uint256 boundaries cannot return a stale winning deployment", async () => {
  const deployer = zeroAddress;
  const initCodeHash = keccak256("0x00");
  const controller = new AbortController();
  const mining = minePoolBoundHookSalt({ deployer, initCodeHash, signal: controller.signal, onProgress: () => controller.abort() });
  await assert.rejects(mining, { name: "AbortError" });
  await assert.rejects(minePoolBoundHookSalt({ deployer, initCodeHash, signal: controller.signal }), { name: "AbortError" });
  for (const startSalt of [-1n, 1n << 256n]) await assert.rejects(minePoolBoundHookSalt({ deployer, initCodeHash, startSalt }), { code: "INVALID_HOOK_SALT" });
});

test("same-quote V4 markets are rejected across shared and bound profiles before any wallet/RPC execution", async () => {
  const plan = parseLaunchPlan(JSON.stringify(fixture.plan));
  const shared = plan.markets[0];
  const client = { request: async () => { throw new Error("Duplicate quote admission must not reach RPC execution"); } };
  for (const second of [
    { ...shared, config: fixture.plan.markets[0].config },
    { ...market, quoteAsset: shared.quoteAsset },
    { ...market, adapterId: toHex(999n, { size: 32 }), quoteAsset: shared.quoteAsset },
  ]) await assert.rejects(planLaunch({ client, plan: { ...plan, markets: [shared, second] }, account: plan.creator, mode: "staged" }), { code: "DUPLICATE_V4_QUOTE" });
});
