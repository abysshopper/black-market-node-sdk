import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { concatHex, encodeAbiParameters, keccak256, parseAbiParameters, stringToHex, toHex, zeroAddress, zeroHash } from "viem";

const sdkPath = process.env.SDK_SOURCE_TEST === "1" ? "../src/lifecycle/index.ts" : "../dist/lifecycle/index.js";
const {
  decodePoolBoundV4LifecycleMarketConfig, decodeV4LifecycleMarketConfig, encodePoolBoundHookParameters,
  encodePoolBoundV4LifecycleMarketConfig, hashLaunchPlan, hashPoolBoundV4MarketCommitment,
  hasLifecycleV4HookPermissions, minePoolBoundHookSalt, parseLaunchPlan, planLaunch, poolBoundHookInitCodeHash, predictPoolBoundHookAddress,
  getKnownLifecycleDeployment, getKnownLifecycleProfile, KnownLifecycleProfile, poolBoundV4LifecycleConfigSchema,
  poolHookDeployerV1Abi, poolHookDeployerConfigV6Abi, V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA_V5, V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA_V6,
} = await import(sdkPath);
const { deriveKnownPoolBoundHookDeployment } = await import(sdkPath.replace("index.", "calibration."));
const fixture = JSON.parse(await readFile(new URL("./fixtures/launch-lifecycle-v1.json", import.meta.url), "utf8"));
const config = {
  ...decodeV4LifecycleMarketConfig(fixture.plan.markets[0].config), version: 6, profileId: toHex(31n, { size: 32 }),
  minimumHookFeePips: 1250, feeSensitivityPipsSecondsPerTick: 7654321,
  hookSalt: toHex(123456789012345678901234567890n, { size: 32 }),
};
const market = {
  ...parseLaunchPlan(JSON.stringify(fixture.plan)).markets[0], adapterId: toHex(41n, { size: 32 }),
  profileId: config.profileId, configVersion: 6,
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
  sqrtPriceX96: config.sqrtPriceX96, hookFeePips: config.hookFeePips,
  minimumHookFeePips: config.minimumHookFeePips, feeSensitivityPipsSecondsPerTick: config.feeSensitivityPipsSecondsPerTick, feeMode: config.feeMode,
  protocolFeeDenominator: config.protocolFeeDenominator, treasury: config.treasury,
  externalLiquidityDisabled: config.externalLiquidityDisabled, oracleConfigId: config.oracleConfigId,
  marketCommitment: hashPoolBoundV4MarketCommitment(context), expectedPositionCount: config.positions.length,
};

function literalV6(config) {
  return encodeAbiParameters(parseAbiParameters("(uint16,uint24,int24,uint160,uint24,uint24,uint32,uint8,uint8,address,bool,bytes32,bytes32,bytes32,bytes32,address,uint16,(int24,int24,uint128,bytes32,uint256)[])"), [[
    config.version, config.lpFeePips, config.tickSpacing, config.sqrtPriceX96, config.hookFeePips,
    config.minimumHookFeePips, config.feeSensitivityPipsSecondsPerTick,
    config.feeMode, config.protocolFeeDenominator, config.treasury, config.externalLiquidityDisabled,
    config.oracleConfigId, config.hookSalt, config.profileId, config.termsDigest, config.developerBeneficiary, config.developerFeeBps,
    config.positions.map((p) => [p.tickLower, p.tickUpper, p.liquidity, p.salt, p.maxTokenAmount]),
  ]]);
}
function literalV5(selected) {
  return encodeAbiParameters(parseAbiParameters("(uint16,uint24,int24,uint160,uint24,uint8,uint8,address,bool,bytes32,bytes32,bytes32,bytes32,address,uint16,(int24,int24,uint128,bytes32,uint256)[])"), [[
    selected.version, selected.lpFeePips, selected.tickSpacing, selected.sqrtPriceX96, selected.hookFeePips,
    selected.feeMode, selected.protocolFeeDenominator, selected.treasury, selected.externalLiquidityDisabled,
    selected.oracleConfigId, selected.hookSalt, selected.profileId, selected.termsDigest, selected.developerBeneficiary, selected.developerFeeBps,
    selected.positions.map((position) => [position.tickLower, position.tickUpper, position.liquidity, position.salt, position.maxTokenAmount]),
  ]]);
}

function literalConstructorV1(selected) {
  return encodeAbiParameters(parseAbiParameters("(address,address,address,address,address,address,address,uint24,int24,uint160,uint24,uint8,uint8,address,bool,bytes32,bytes32,uint32)"), [[
    selected.poolManager, selected.registrar, selected.oracleFactory, selected.core, selected.liquidityLocker,
    selected.token, selected.quoteCurrency, selected.lpFeePips, selected.tickSpacing, selected.sqrtPriceX96,
    selected.hookFeePips, selected.feeMode, selected.protocolFeeDenominator, selected.treasury,
    selected.externalLiquidityDisabled, selected.oracleConfigId, selected.marketCommitment, selected.expectedPositionCount,
  ]]);
}

const configV5 = { ...decodeV4LifecycleMarketConfig(fixture.plan.markets[0].config), version: 5, hookSalt: config.hookSalt };


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
  const encoded = literalV6(config);
  assert.equal(encodePoolBoundV4LifecycleMarketConfig(config), encoded);
  const decoded = decodePoolBoundV4LifecycleMarketConfig(encoded);
  assert.deepEqual({ ...decoded, treasury: decoded.treasury.toLowerCase() }, { ...config, treasury: config.treasury.toLowerCase() });
  for (const version of [0, 1, 2, 3, 4, 5, 7]) {
    assert.throws(() => encodePoolBoundV4LifecycleMarketConfig({ ...config, version }));
    assert.throws(() => decodePoolBoundV4LifecycleMarketConfig(literalV6({ ...config, version })));
  }
  assert.throws(() => decodeV4LifecycleMarketConfig(encoded));
});

test("config5 retains its independently encoded deployed schema without coercion or fee-policy defaults", () => {
  const encoded = literalV5(configV5);
  assert.equal(V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA_V5, "0xeeb0ebf0529d94130b027b0418bc739cef490ea121c2200cb56e2fb1da20ec6c");
  assert.equal(V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA_V6, keccak256(stringToHex("(uint16,uint24,int24,uint160,uint24,uint24,uint32,uint8,uint8,address,bool,bytes32,bytes32,bytes32,bytes32,address,uint16,(int24,int24,uint128,bytes32,uint256)[])")));
  assert.notEqual(V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA_V6, V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA_V5);
  assert.equal(poolBoundV4LifecycleConfigSchema(5), V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA_V5);
  assert.equal(poolBoundV4LifecycleConfigSchema(6), V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA_V6);
  assert.throws(() => poolBoundV4LifecycleConfigSchema(7), { code: "UNSUPPORTED_CONFIG_VERSION" });
  assert.equal(encodePoolBoundV4LifecycleMarketConfig(configV5), encoded);
  const decoded = decodePoolBoundV4LifecycleMarketConfig(encoded, 5);
  assert.deepEqual({ ...decoded, treasury: decoded.treasury.toLowerCase() }, { ...configV5, treasury: configV5.treasury.toLowerCase() });
  assert.equal(Object.hasOwn(decoded, "minimumHookFeePips"), false);
  assert.equal(Object.hasOwn(decoded, "feeSensitivityPipsSecondsPerTick"), false);
  for (const field of ["minimumHookFeePips", "feeSensitivityPipsSecondsPerTick"]) {
    for (const value of [undefined, 0, 1234]) assert.throws(() => encodePoolBoundV4LifecycleMarketConfig({ ...configV5, [field]: value }), { code: "UNSUPPORTED_CONFIG_VERSION" });
  }
  for (const [bytes, version] of [[encoded, 6], [literalV6(config), 5]]) {
    assert.throws(() => decodePoolBoundV4LifecycleMarketConfig(bytes, version), { code: "INVALID_BOUND_MARKET" });
  }
  assert.throws(() => decodePoolBoundV4LifecycleMarketConfig(literalV5({ ...configV5, version: 6 })));
  for (const bytes of [encoded, literalV6(config)]) {
    assert.throws(() => decodePoolBoundV4LifecycleMarketConfig(concatHex([bytes, zeroHash])), { code: "INVALID_BOUND_MARKET" });
  }
});

test("config5 economic hashing commits its actual wire tuple and normalizes only the salt", () => {
  const selected = { ...market, profileId: configV5.profileId, configVersion: 5, config: literalV5(configV5) };
  const expected = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint256,address,address,address,bytes32,bytes32,address,uint256,uint32,bytes32"), [
    keccak256(stringToHex("black-market.pool-bound-market-economics.v1")), context.chainId, context.core,
    context.registrar, context.token, selected.adapterId, selected.profileId, selected.quoteAsset,
    selected.tokenBudget, 5, keccak256(literalV5({ ...configV5, hookSalt: zeroHash })),
  ]));
  assert.equal(hashPoolBoundV4MarketCommitment({ ...context, market: selected }), expected);
  assert.equal(hashPoolBoundV4MarketCommitment({ ...context, market: { ...selected, config: literalV5({ ...configV5, hookSalt: zeroHash }) } }), expected);
  assert.notEqual(hashPoolBoundV4MarketCommitment({ ...context, market: { ...selected, config: literalV5({ ...configV5, hookFeePips: configV5.hookFeePips + 1 }) } }), expected);
  assert.throws(() => hashPoolBoundV4MarketCommitment({ ...context, market: { ...selected, configVersion: 6 } }), { code: "INVALID_BOUND_MARKET" });
});

test("October8 config6 preset derives and mines its actual V2 constructor without relabeling config5", async () => {
  const identity = { chainId: 4663n, orchestrator: "0x91560876033d568d25CDe98C78c33ff8FC43962c" };
  const preset = getKnownLifecycleProfile({ ...identity, key: KnownLifecycleProfile.V4FixedFeePool });
  const deployment = getKnownLifecycleDeployment(identity);
  const selectedConfig = { ...config, profileId: preset.profile.id, treasury: preset.profile.envelope.protocolTreasury,
    protocolFeeDenominator: preset.profile.envelope.protocolFeeDenominator, termsDigest: preset.profile.envelope.termsDigest,
    developerBeneficiary: preset.profile.envelope.beneficiary, developerFeeBps: 0, hookSalt: zeroHash };
  const selectedMarket = { ...market, configVersion: 6, adapterId: preset.profile.registration.adapterId, profileId: preset.profile.id,
    tokenBudget: selectedConfig.positions.reduce((sum, position) => sum + position.maxTokenAmount, 0n), config: literalV6(selectedConfig) };
  const original = parseLaunchPlan(JSON.stringify(fixture.plan));
  const plan = { ...original, ...identity, token: { ...original.token, supply: selectedMarket.tokenBudget }, markets: [selectedMarket] };
  const known = deriveKnownPoolBoundHookDeployment({ plan, marketIndex: 0, token: context.token });
  assert.equal(known.configVersion, 6);
  assert.equal(known.deployment.deployer, preset.boundHook.deployer);
  assert.equal(known.parameters.registrar, preset.profile.adapter.implementation);
  assert.equal(known.parameters.core, deployment.orchestrator);
  assert.equal(known.parameters.minimumHookFeePips, selectedConfig.minimumHookFeePips);
  assert.equal(known.parameters.feeSensitivityPipsSecondsPerTick, selectedConfig.feeSensitivityPipsSecondsPerTick);
  const p = known.parameters;
  const constructor = encodeAbiParameters(parseAbiParameters("(address,address,address,address,address,address,address,uint24,int24,uint160,uint24,uint24,uint32,uint8,uint8,address,bool,bytes32,bytes32,uint32)"), [[
    p.poolManager, p.registrar, p.oracleFactory, p.core, p.liquidityLocker, p.token, p.quoteCurrency, p.lpFeePips,
    p.tickSpacing, p.sqrtPriceX96, p.hookFeePips, p.minimumHookFeePips, p.feeSensitivityPipsSecondsPerTick,
    p.feeMode, p.protocolFeeDenominator, p.treasury, p.externalLiquidityDisabled, p.oracleConfigId, p.marketCommitment, p.expectedPositionCount,
  ]]);
  assert.equal((constructor.length - 2) / 2, 20 * 32);
  assert.equal(encodePoolBoundHookParameters(known.parameters, 6), constructor);
  const initCodeHash = keccak256(concatHex([preset.boundHook.creationCode, constructor]));
  assert.equal(known.deployment.initCodeHash, initCodeHash);
  assert.equal(poolBoundHookInitCodeHash(preset.boundHook.creationCode, known.parameters, 6), initCodeHash);
  const expected = referenceWinner(preset.boundHook.deployer, initCodeHash);
  const mined = await minePoolBoundHookSalt({ deployer: preset.boundHook.deployer, initCodeHash });
  assert.equal(mined.salt, toHex(expected.salt, { size: 32 }));
  assert.equal(mined.predictedHook.toLowerCase(), expected.predictedHook);
  const finalized = { ...plan, markets: [{ ...selectedMarket, config: literalV6({ ...selectedConfig, hookSalt: mined.salt }) }] };
  const final = deriveKnownPoolBoundHookDeployment({ plan: finalized, marketIndex: 0, token: context.token });
  assert.equal(final.deployment.initCodeHash, initCodeHash);
  assert.deepEqual(final.deployment, { deployer: preset.boundHook.deployer, initCodeHash, ...mined });
  assert.throws(() => encodePoolBoundHookParameters(known.parameters), { code: "UNSUPPORTED_CONFIG_VERSION" });
  assert.throws(() => encodePoolBoundHookParameters(known.parameters, 5), { code: "UNSUPPORTED_CONFIG_VERSION" });
  const { minimumHookFeePips, feeSensitivityPipsSecondsPerTick, ...v1 } = selectedConfig;
  const wrong = { ...plan, markets: [{ ...selectedMarket, configVersion: 5, config: literalV5({ ...v1, version: 5 }) }] };
  assert.throws(() => deriveKnownPoolBoundHookDeployment({ plan: wrong, marketIndex: 0, token: context.token }), { code: "INVALID_BOUND_MARKET" });
  assert.throws(() => deriveKnownPoolBoundHookDeployment({ plan: { ...plan, markets: [{ ...selectedMarket, adapterId: zeroHash }] }, marketIndex: 0, token: context.token }), { code: "INVALID_BOUND_MARKET" });
  assert.equal(poolHookDeployerV1Abi.find((item) => item.name === "deploy").inputs[0].components.length, 18);
  assert.equal(poolHookDeployerConfigV6Abi.find((item) => item.name === "deploy").inputs[0].components.length, 20);
});

test("bound economic commitment matches the independently encoded domain and normalizes only hookSalt", () => {
  const configHash = keccak256(literalV6({ ...config, hookSalt: zeroHash }));
  const expected = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint256,address,address,address,bytes32,bytes32,address,uint256,uint32,bytes32"), [
    keccak256(stringToHex("black-market.pool-bound-market-economics.v1")), context.chainId, context.core,
    context.registrar, context.token, market.adapterId, market.profileId, market.quoteAsset,
    market.tokenBudget, market.configVersion, configHash,
  ]));
  assert.equal(hashPoolBoundV4MarketCommitment(context), expected);
  const salted = { ...market, config: literalV6({ ...config, hookSalt: toHex(999n, { size: 32 }) }) };
  assert.equal(hashPoolBoundV4MarketCommitment({ ...context, market: salted }), expected);
  const plan = parseLaunchPlan(JSON.stringify(fixture.plan));
  assert.notEqual(hashLaunchPlan({ ...plan, markets: [market] }), hashLaunchPlan({ ...plan, markets: [salted] }), "The signed launch still commits its real hook salt");
  const economicChanges = [
    { ...config, lpFeePips: config.lpFeePips + 1 }, { ...config, tickSpacing: config.tickSpacing + 1 },
    { ...config, sqrtPriceX96: config.sqrtPriceX96 + 1n }, { ...config, hookFeePips: config.hookFeePips + 1 },
    { ...config, minimumHookFeePips: config.minimumHookFeePips + 1 },
    { ...config, feeSensitivityPipsSecondsPerTick: config.feeSensitivityPipsSecondsPerTick + 1 },
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
  for (const changed of economicChanges) {
    const changedMarket = { ...market, config: literalV6(changed) };
    assert.notEqual(hashPoolBoundV4MarketCommitment({ ...context, market: changedMarket }), expected, "Every market economic field and every position invalidates previous mining");
    assert.notEqual(hashLaunchPlan({ ...plan, markets: [changedMarket] }), hashLaunchPlan({ ...plan, markets: [market] }), "Signed launch calldata binds every economic field");
  }
  for (const changed of [
    { ...context, chainId: context.chainId + 1n }, { ...context, core: context.registrar },
    { ...context, registrar: context.core }, { ...context, token: context.core },
    { ...context, market: { ...market, adapterId: zeroHash } },
    { ...context, market: { ...market, quoteAsset: context.core } },
    { ...context, market: { ...market, tokenBudget: market.tokenBudget + 1n } },
  ]) assert.notEqual(hashPoolBoundV4MarketCommitment(changed), expected);
  assert.throws(() => hashPoolBoundV4MarketCommitment({ ...context, market: { ...market, profileId: fixture.plan.markets[0].profileId } }), { code: "INVALID_BOUND_MARKET" });
});

test("V2 constructor parameters bind the creation hash without collector, hub or planHash cycles", () => {
  const expected = encodeAbiParameters(parseAbiParameters("(address,address,address,address,address,address,address,uint24,int24,uint160,uint24,uint24,uint32,uint8,uint8,address,bool,bytes32,bytes32,uint32)"), [[
    parameters.poolManager, parameters.registrar, parameters.oracleFactory, parameters.core, parameters.liquidityLocker,
    parameters.token, parameters.quoteCurrency, parameters.lpFeePips, parameters.tickSpacing, parameters.sqrtPriceX96,
    parameters.hookFeePips, parameters.minimumHookFeePips, parameters.feeSensitivityPipsSecondsPerTick,
    parameters.feeMode, parameters.protocolFeeDenominator, parameters.treasury,
    parameters.externalLiquidityDisabled, parameters.oracleConfigId, parameters.marketCommitment, parameters.expectedPositionCount,
  ]]);
  assert.equal(encodePoolBoundHookParameters(parameters, 6), expected);
  const creationCode = "0x600060005560016000f3";
  assert.equal(poolBoundHookInitCodeHash(creationCode, parameters, 6), keccak256(concatHex([creationCode, expected])));
  for (const changed of [
    { ...parameters, token: context.core }, { ...parameters, marketCommitment: zeroHash },
    { ...parameters, expectedPositionCount: parameters.expectedPositionCount + 1 },
    { ...parameters, minimumHookFeePips: parameters.minimumHookFeePips + 1 },
    { ...parameters, feeSensitivityPipsSecondsPerTick: parameters.feeSensitivityPipsSecondsPerTick + 1 },
  ]) {
    const originalHash = poolBoundHookInitCodeHash(creationCode, parameters, 6);
    const changedHash = poolBoundHookInitCodeHash(creationCode, changed, 6);
    assert.notEqual(changedHash, originalHash);
    const identity = { deployer: context.registrar, salt: config.hookSalt };
    assert.notEqual(predictPoolBoundHookAddress({ ...identity, initCodeHash: changedHash }), predictPoolBoundHookAddress({ ...identity, initCodeHash: originalHash }));
  }
});

test("creator min/max/sensitivity validate independently at both market and constructor boundaries", async () => {
  for (const settings of [
    { hookFeePips: 0, minimumHookFeePips: 0, feeSensitivityPipsSecondsPerTick: 0 },
    { hookFeePips: 1000000, minimumHookFeePips: 1000000, feeSensitivityPipsSecondsPerTick: 0xffffffff },
    { hookFeePips: 900000, minimumHookFeePips: 1234, feeSensitivityPipsSecondsPerTick: 0 },
    { hookFeePips: 900000, minimumHookFeePips: 0, feeSensitivityPipsSecondsPerTick: 0xffffffff },
  ]) {
    const selected = { ...config, ...settings };
    const decoded = decodePoolBoundV4LifecycleMarketConfig(encodePoolBoundV4LifecycleMarketConfig(selected));
    for (const [key, value] of Object.entries(settings)) assert.equal(decoded[key], value);
    assert.doesNotThrow(() => encodePoolBoundHookParameters({ ...parameters, ...settings }, 6));
  }
  const originalPlan = parseLaunchPlan(JSON.stringify(fixture.plan));
  const client = { request() { throw new Error("Invalid fee settings must fail before any provider call"); } };
  for (const change of [
    { minimumHookFeePips: config.hookFeePips + 1 }, { hookFeePips: 1000001 },
    ...["hookFeePips", "minimumHookFeePips", "feeSensitivityPipsSecondsPerTick"].flatMap((key) =>
      [-1, 1.5, NaN, true, undefined].map((value) => ({ [key]: value }))),
    { feeSensitivityPipsSecondsPerTick: 0x100000000 },
  ]) {
    const selected = { ...config, ...change };
    assert.throws(() => encodePoolBoundV4LifecycleMarketConfig(selected), { code: "INVALID_HOOK_FEES" });
    assert.throws(() => encodePoolBoundHookParameters({ ...parameters, ...change }, 6), { code: "INVALID_HOOK_FEES" });
    // The planner receives ABI bytes; out-of-width values are exercised above, before encoding.
    if (Object.entries(change).every(([field, value]) => Number.isInteger(value) && value >= 0 &&
      value < 2 ** (field === "feeSensitivityPipsSecondsPerTick" ? 32 : 24))) {
      const invalid = { ...originalPlan, buys: [], markets: [{ ...market, config: literalV6(selected) }] };
      await assert.rejects(planLaunch({ client, account: invalid.creator, plan: invalid, mode: "staged" }), { code: "INVALID_HOOK_FEES" });
    }
  }
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
  for (const [index, event] of progress.entries()) {
    assert.equal(event.predictedHook.toLowerCase(), referencePrediction(deployer, initCodeHash, BigInt(event.salt)));
    if (index > 0) assert.equal(event.attempts, BigInt(event.salt) + 1n, "Exact attempts include the current salt, once");
    if (index > 0) assert.ok(event.attempts > progress[index - 1].attempts && event.attempts - progress[index - 1].attempts <= 256n,
      "Every observed progress transition follows a bounded batch");
  }
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

test("immutable CREATE2 preimages preserve all permission bits, byte carries and the final uint256 counter", async () => {
  const deployer = "0x00000000000000000000000000000000000000f1";
  const initCodeHash = keccak256("0x600060005560016000f3");
  const permitted = toHex(0x1afcn, { size: 20 });
  assert.equal(hasLifecycleV4HookPermissions(permitted), true);
  for (let bit = 0n; bit < 14n; bit += 1n) assert.equal(hasLifecycleV4HookPermissions(toHex(0x1afcn ^ (1n << bit), { size: 20 })), false);
  for (const startSalt of [0xffn, (1n << 128n) - 1n]) {
    const expected = referenceWinner(deployer, initCodeHash, startSalt);
    const progress = [];
    const mined = await minePoolBoundHookSalt({ deployer, initCodeHash, startSalt, onProgress: (event) => progress.push(event) });
    assert.equal(BigInt(mined.salt), expected.salt);
    assert.equal(mined.predictedHook.toLowerCase(), expected.predictedHook);
    assert.equal(progress.at(-1).attempts, expected.salt - startSalt + 1n);
    for (const event of progress.slice(1)) assert.equal(event.attempts, BigInt(event.salt) - startSalt + 1n,
      "Batch-local Number counters never round or double-count full-width salt progress");
    assert.equal(predictPoolBoundHookAddress({ deployer, initCodeHash, salt: mined.salt }), mined.predictedHook);
  }
  const maximum = (1n << 256n) - 1n;
  const finalPrediction = referencePrediction(deployer, initCodeHash, maximum);
  const finalAttempt = minePoolBoundHookSalt({ deployer, initCodeHash, startSalt: maximum });
  if ((BigInt(finalPrediction) & 0x3fffn) === 0x1afcn) {
    const final = await finalAttempt;
    assert.equal(final.salt, toHex(maximum, { size: 32 }));
    assert.equal(final.predictedHook.toLowerCase(), finalPrediction);
  } else await assert.rejects(finalAttempt, { code: "HOOK_SALT_EXHAUSTED" });
});

test("winning callbacks still cancel and option mutation cannot replace an invocation's frozen CREATE2 inputs", async () => {
  const deployer = zeroAddress, initCodeHash = keccak256("0x00");
  const expected = referenceWinner(deployer, initCodeHash);
  const stop = new AbortController();
  await assert.rejects(minePoolBoundHookSalt({ deployer, initCodeHash, startSalt: expected.salt, signal: stop.signal,
    onProgress: (event) => { if (event.attempts > 0n) stop.abort(); } }), { name: "AbortError" });
  const options = { deployer, initCodeHash, startSalt: expected.salt, onProgress: (event) => {
    if (event.attempts === 0n) { options.deployer = context.core; options.initCodeHash = zeroHash; }
  } };
  const mined = await minePoolBoundHookSalt(options);
  assert.equal(mined.predictedHook.toLowerCase(), expected.predictedHook);
});

test("completed-batch cancellation and callback failures preserve exact progress and cannot return a deployment", async () => {
  const deployer = zeroAddress, initCodeHash = keccak256("0x00"), startSalt = (1n << 128n) - 1n;
  const controller = new AbortController();
  let last;
  await assert.rejects(minePoolBoundHookSalt({ deployer, initCodeHash, startSalt, signal: controller.signal, onProgress: (event) => {
    if (event.attempts === 0n) return;
    last = event;
    controller.abort();
  } }), { name: "AbortError" });
  assert.ok(last);
  assert.equal(last.attempts, BigInt(last.salt) - startSalt + 1n);
  assert.ok(last.attempts <= 256n);
  assert.equal(last.predictedHook.toLowerCase(), referencePrediction(deployer, initCodeHash, BigInt(last.salt)));
  for (const failAtStart of [true, false]) {
    const failure = new Error("Caller progress callback failed");
    await assert.rejects(minePoolBoundHookSalt({ deployer, initCodeHash, startSalt, onProgress: (event) => {
      assert.equal(event.attempts, event.attempts === 0n ? 0n : BigInt(event.salt) - startSalt + 1n);
      if (failAtStart || event.attempts > 0n) throw failure;
    } }), (error) => error === failure);
  }
});

test("same-quote V4 markets are rejected across shared and bound profiles before any wallet/RPC execution", async () => {
  const plan = parseLaunchPlan(JSON.stringify(fixture.plan));
  const shared = { ...plan.markets[0], tokenBudget: decodeV4LifecycleMarketConfig(plan.markets[0].config).positions.reduce((sum, position) => sum + position.maxTokenAmount, 0n) };
  const client = { request: async () => { throw new Error("Duplicate quote admission must not reach RPC execution"); } };
  for (const second of [
    { ...shared, config: fixture.plan.markets[0].config },
    { ...market, quoteAsset: shared.quoteAsset },
    { ...market, adapterId: toHex(999n, { size: 32 }), quoteAsset: shared.quoteAsset },
  ]) await assert.rejects(planLaunch({ client, plan: { ...plan, markets: [shared, second] }, account: plan.creator, mode: "staged" }), { code: "DUPLICATE_V4_QUOTE" });
});
