import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { setImmediate as nextTurn } from "node:timers/promises";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, encodeFunctionResult, keccak256, parseAbi, stringToHex, toHex, zeroAddress, zeroHash } from "viem";
import { MULTICALL3, MULTICALL3_CODE, emulateMulticall3 } from "./fixtures/multicall3.mjs";

const sdkPath = process.env.SDK_SOURCE_TEST === "1" ? "../src/lifecycle/index.ts" : "../dist/lifecycle/index.js";
const { ABYSS_LIFECYCLE_CONFIG_SCHEMA, abyssLifecycleAdapterAbi, buildNextTransaction, createLifecycleSessionCache,
  decodeAbyssLifecycleMarketConfig, decodePoolBoundV4LifecycleMarketConfig, encodeAbyssLifecycleMarketConfig, encodePoolBoundV4LifecycleMarketConfig,
  getKnownLifecycleDeployment, getKnownLifecycleProfile, hashLaunchIdentity, hashLaunchPlan, KnownLifecycleProfile,
  launchLifecycleAbi, lifecycleAdapterAbi, lifecycleDirectoryAbi, lifecycleErc20Abi, lifecycleFundingEscrowAbi,
  lifecycleRegistryAbi, LifecyclePhase, LIFECYCLE_REQUIRED_CAPABILITIES, LIFECYCLE_MULTI_POSITION_CAPABILITY,
  planLaunch, prepareAndPlanLifecycleLaunch, readLifecycleProfiles, readLaunchProgress, hookSaltMinerAbi,
  minePoolBoundHookSalt, computeLifecycleLaunchGasBounds, packPreparationBatches, preparationGasEstimate, LIFECYCLE_CAPACITY_PADDING_BPS,
  buildUfgFeeAssetPolicies, UFG_LAUNCH_PROXY_ADDRESS, UFG_ORCHESTRATOR_ADDRESS, ufgLaunchNonce,
  ufgLaunchProxyV1Abi, ROBINHOOD_NATIVE_TRANSACTION_GAS_LIMIT } = await import(sdkPath);
const { ABYSS_FEE_TIERS, deriveLaunchPoolRecipe, deriveLaunchPositionRanges } = await import(sdkPath.replace("lifecycle/index.", "index."));
const address = (n) => toHex(BigInt(n), { size: 20 });
const ACCOUNT = address(0xa0), CORE = address(0xf0), REGISTRY = address(0xf1), ESCROW = address(0xf2), ADAPTER = address(0xf3), FACTORY = address(0xf4), TOKEN = address(0x10);
const CODE = "0x600160005560016000f3";
const HASH = toHex(42n, { size: 32 }), FOREIGN_HASH = toHex(43n, { size: 32 }), DIGEST = keccak256(CODE);
const GAS_INFO = address(0x6c);
const gasInfoAbi = parseAbi(["function getPricesInWei() view returns (uint256,uint256,uint256,uint256,uint256,uint256)"]);

// ABI-complete injected observations, not live execution or deployment evidence.
function makePlan({ chainId = 31337n, markets = 1, nativeFunding = false, token0 = true } = {}) {
  const profileId = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "uint8" }], [keccak256(stringToHex("BLACK_MARKET_ABYSS_CANONICAL_PROFILE_V1")), chainId, FACTORY, 3]));
  const quotes = Array.from({ length: markets }, (_, index) => address((token0 ? 0x20 : 0x05) + index));
  return {
    chainId, orchestrator: CORE, creator: ACCOUNT, nonce: 7n,
    token: { kind: 0, rewardMode: 0, name: "Planning", symbol: "PLAN", supply: 100n * BigInt(markets), nftUnit: 0n, metadataURI: "", salt: toHex(7n, { size: 32 }), inventoryRecipient: ACCOUNT, burnOnCancel: false },
    funding: quotes.map((asset) => ({ asset, amount: 10n, kind: nativeFunding ? 1 : 0, inputAsset: asset, inputAmount: 10n, target: zeroAddress, data: "0x" })),
    feeAssets: [TOKEN, ...quotes].sort((left, right) => BigInt(left) < BigInt(right) ? -1 : 1).map((asset) => ({ asset, ownerBps: 10000, rewardsBps: 0, burnBps: 0 })),
    markets: quotes.map((quoteAsset) => ({ adapterId: toHex(1n, { size: 32 }), profileId, quoteAsset, tokenBudget: 100n, configVersion: 1,
      config: encodeAbyssLifecycleMarketConfig({ profile: 3, fee: 3000, oracleConfigId: toHex(9n, { size: 32 }), openingSqrtPriceX96: 1n << 96n,
        positions: [{ tickLower: token0 ? 0 : -887220, tickUpper: token0 ? 887220 : 0, liquidity: 1n, tokenAmountMaximum: 100n }] }) })),
    buys: quotes.map((_, marketIndex) => ({ marketIndex, quoteAmountIn: 10n, minTokenOut: 5n, recipient: ACCOUNT, sqrtPriceLimitX96: token0 ? 1461446703485210103287273052203988822378723970341n : 4295128740n })),
    deadline: 1000n, executorFeeBps: 0,
  };
}
function knownAbyssPlan(options = {}) {
  const plan = makePlan({ ...options, chainId: 4663n });
  plan.orchestrator = "0x91560876033d568d25CDe98C78c33ff8FC43962c";
  const preset = getKnownLifecycleProfile({ ...plan, key: KnownLifecycleProfile.Abyss3 });
  plan.markets = plan.markets.map((market) => {
    const config = decodeAbyssLifecycleMarketConfig(market.config);
    return { ...market, adapterId: preset.profile.registration.adapterId, profileId: preset.profile.id,
      config: encodeAbyssLifecycleMarketConfig({ ...config, positions: config.positions.map((position) => ({ ...position, liquidity: 100n })) }) };
  });
  return plan;
}
function progress(plan, phase = LifecyclePhase.None, prepared = 0) {
  if (phase === LifecyclePhase.None) return { launchId: zeroHash, planHash: zeroHash, creator: zeroAddress, nonce: 0n, mode: 0, phase, token: zeroAddress, feeHub: zeroAddress, rewards: zeroAddress, preparedMarkets: 0, marketCount: 0, buyCount: 0, positionCount: 0, deadline: 0n };
  return { launchId: hashLaunchIdentity(plan), planHash: hashLaunchPlan(plan), creator: plan.creator, nonce: plan.nonce, mode: 1, phase, token: TOKEN, feeHub: address(0xf6), rewards: zeroAddress, preparedMarkets: prepared, marketCount: plan.markets.length, buyCount: plan.buys.length, positionCount: prepared, deadline: plan.deadline };
}
function identity(plan, index) {
  const [currency0, currency1] = BigInt(TOKEN) < BigInt(plan.markets[index].quoteAsset) ? [TOKEN, plan.markets[index].quoteAsset] : [plan.markets[index].quoteAsset, TOKEN];
  const config = plan.markets[index].configVersion === 1 ? decodeAbyssLifecycleMarketConfig(plan.markets[index].config) : decodePoolBoundV4LifecycleMarketConfig(plan.markets[index].config, plan.markets[index].configVersion);
  const fields = { venue: plan.markets[index].configVersion === 1 ? 1 : 2, manager: zeroAddress, factory: FACTORY, pool: address(0x100 + index), poolId: zeroHash, profileId: plan.markets[index].profileId, currency0, currency1, fee: config.fee ?? config.lpFeePips, tickSpacing: config.tickSpacing ?? ABYSS_FEE_TIERS.find(({ feePips }) => feePips === config.fee).tickSpacing, hook: zeroAddress, openingSqrtPriceX96: config.openingSqrtPriceX96 ?? config.sqrtPriceX96 };
  const canonicalId = keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "uint8" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }], [plan.chainId, fields.venue, fields.manager, fields.factory, fields.pool, fields.poolId, fields.profileId]));
  return { ...fields, canonicalId };
}
function clientFor(plan, settings = {}) {
  const known = getKnownLifecycleDeployment(plan);
  const core = plan.orchestrator.toLowerCase(), escrow = known?.fundingEscrow.toLowerCase() ?? ESCROW;
  const state = { balance: 10n ** 24n, tokenBalance: 10n ** 30n, allowance: 10n ** 30n, phase: LifecyclePhase.None, gasPrice: 2n, ...settings };
  const captured = [];
  const capabilities = LIFECYCLE_REQUIRED_CAPABILITIES | LIFECYCLE_MULTI_POSITION_CAPABILITY;
  const registration = { adapterId: plan.markets[0].adapterId, configSchema: ABYSS_LIFECYCLE_CONFIG_SCHEMA, dependencyDigest: DIGEST, venue: FACTORY, factory: FACTORY, hook: zeroAddress, capabilities, enabled: true };
  const adapterRegistration = { implementation: ADAPTER, codeHash: DIGEST, capabilities, configVersion: 1, enabled: true };
  const output = (abi, functionName, result) => encodeFunctionResult({ abi, functionName, result });
  const client = { state, captured, async request({ method, params = [], fixtureSubcall = false }) {
    if (!fixtureSubcall) captured.push({ method, params });
    if (["eth_simulateV1", "eth_estimateGas", "eth_getTransactionCount", "eth_sendTransaction", "eth_sendRawTransaction", "evm_snapshot", "anvil_reset"].includes(method)) assert.fail(`Planning must not dispatch ${method}`);
    if (method === "eth_getCode" && params[0].toLowerCase() === MULTICALL3) return state.multicallCode ?? MULTICALL3_CODE;
    if (method === "eth_call" && params[0].to.toLowerCase() === MULTICALL3) return emulateMulticall3(client, params);
    if (method === "eth_chainId") return toHex(plan.chainId);
    if (method === "eth_getBlockByNumber") {
      const number = params[0] === "latest" ? state.headNumber ?? 42n : BigInt(params[0]);
      return { number: toHex(number), hash: number === 42n ? state.blockHash ?? HASH : toHex(number, { size: 32 }),
        timestamp: toHex(100n + number - 42n), gasLimit: toHex(state.headerGas ?? (plan.chainId === 4663n ? 1n << 50n : 30_000_000n)), baseFeePerGas: toHex(state.baseFeePerGas ?? state.gasPrice / 2n) };
    }
    if (method === "eth_getCode") return typeof state.codeFor === "function" ? state.codeFor(params[0]) : CODE;
    if (method === "eth_getBalance") return toHex(state.balance);
    if (method === "eth_gasPrice") return toHex(state.gasPrice);
    assert.equal(method, "eth_call");
    assert.ok((state.allowedTags ?? ["0x2a"]).includes(params[1]), "Every read uses an explicit L2 pin");
    const { to, data } = params[0], target = to.toLowerCase();
    if (known && target === known.tokenFactory.toLowerCase()) return encodeAbiParameters([{ type: "address" }], [state.predictedToken ?? TOKEN]);
    if (known?.hookSaltMiner !== undefined && target === known.hookSaltMiner.toLowerCase()) {
      const { args } = decodeFunctionData({ abi: hookSaltMinerAbi, data });
      const mined = await Promise.all(args[0].map((search) => minePoolBoundHookSalt(search)));
      return output(hookSaltMinerAbi, "findMany", [mined.map((result) => result.salt), mined.map((result) => result.predictedHook), mined.map(() => true)]);
    }
    if (target === GAS_INFO) {
      if (state.posterError) throw state.posterError;
      const value = state.posterResponse ?? [0n, state.posterPricePerByte ?? 0n, 0n, state.gasPrice, 0n, state.gasPrice];
      (state.priceRequests ??= []).push(value);
      return typeof value === "string" ? value : output(gasInfoAbi, "getPricesInWei", value);
    }
    const abis = target === UFG_LAUNCH_PROXY_ADDRESS.toLowerCase() ? [ufgLaunchProxyV1Abi] : target === core ? [launchLifecycleAbi] : target === REGISTRY ? [lifecycleRegistryAbi] : target === address(0xf7) ? [lifecycleDirectoryAbi] : target === escrow ? [lifecycleFundingEscrowAbi] : target === ADAPTER ? [abyssLifecycleAdapterAbi, lifecycleAdapterAbi] : [lifecycleErc20Abi];
    let abi, call;
    for (const candidate of abis) { try { call = decodeFunctionData({ abi: candidate, data }); abi = candidate; break; } catch {} }
    assert.ok(call, `Unexpected contract calldata ${target} ${data.slice(0, 10)}`);
    switch (call.functionName) {
      case "predictToken": return output(abi, call.functionName, state.predictedToken ?? TOKEN);
      case "tokenFactory": return output(abi, call.functionName, ADAPTER);
      case "fundingEscrow": return output(abi, call.functionName, escrow);
      case "registry": return output(abi, call.functionName, REGISTRY);
      case "core": return output(abi, call.functionName, state.authorities?.[target] ?? core);
      case "readLaunchProgress": return output(abi, call.functionName, progress(state.committedPlan ?? plan, state.phase, state.prepared ?? 0));
      case "directory": return output(abi, call.functionName, address(0xf7));
      case "market": return output(abi, call.functionName, [ADAPTER, { identity: identity(plan, call.args[1]), feeSource: address(0xf6), custody: address(0xf8), mintExecutor: ADAPTER, buyExecutor: ADAPTER, exclusions: [], positionCount: 1 }]);
      case "readMarket": return output(abi, call.functionName, { sqrtPriceX96: 1n << 96n, tick: 0, liquidity: 1n, publicTrading: false, oracleReadyAt: 0n });
      case "wrappedNative": return output(abi, call.functionName, plan.markets[0].quoteAsset);
      case "balanceOf": return output(abi, call.functionName, state.tokenBalance);
      case "allowance": return output(abi, call.functionName, state.allowance);
      case "profile": return output(abi, call.functionName, { ...registration, ...state.profileOverrides });
      case "adapter": return output(abi, call.functionName, { ...adapterRegistration, ...state.adapterOverrides });
      case "profileTopology": return output(abi, call.functionName, { hookTopology: 0, configVersion: 1, hookDeployer: zeroAddress, hookCreationCodeHash: zeroHash });
      case "requireEligible": {
        const adapter = { ...adapterRegistration, ...state.adapterOverrides }, profile = { ...registration, ...state.profileOverrides };
        const implementationCode = typeof state.codeFor === "function" ? state.codeFor(adapter.implementation) : CODE;
        if (!adapter.enabled || !profile.enabled || profile.adapterId.toLowerCase() !== call.args[0].toLowerCase() || adapter.configVersion !== call.args[2] || implementationCode === "0x" || keccak256(implementationCode).toLowerCase() !== adapter.codeHash.toLowerCase() || (adapter.capabilities & call.args[3]) !== call.args[3] || (profile.capabilities & call.args[3]) !== call.args[3] || (state.authorities?.[adapter.implementation.toLowerCase()] ?? core).toLowerCase() !== core || (state.graphDigest ?? DIGEST).toLowerCase() !== profile.dependencyDigest.toLowerCase()) throw new Error("IneligibleImplementation");
        return output(abi, call.functionName, adapter.implementation);
      }
      case "resolve": return output(abi, call.functionName, identity(plan, plan.markets.findIndex((market) => market.quoteAsset.toLowerCase() === call.args[2].quoteAsset.toLowerCase())));
      default: assert.fail(`Unexpected read ${call.functionName}`);
    }
  } };
  return client;
}
const review = (client, plan, options = {}) => planLaunch({ client, plan, account: ACCOUNT, mode: "atomic", ...options });
const economicRequests = (client) => client.captured.filter((row) => row.method === "eth_simulateV1");
function ufgConfigFor(plan) { return { treasuryShareBps: 10000, exitFeeBps: 100, reserveAssets: [...new Set(plan.markets.map((market) => market.quoteAsset))].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1) }; }
function makeUfgPlan() {
  const plan = knownAbyssPlan();
  plan.orchestrator = UFG_ORCHESTRATOR_ADDRESS; plan.creator = UFG_LAUNCH_PROXY_ADDRESS; plan.nonce = ufgLaunchNonce(ACCOUNT, 7n);
  const preset = getKnownLifecycleProfile({ ...plan, key: KnownLifecycleProfile.Abyss3 });
  plan.markets[0].adapterId = preset.profile.registration.adapterId; plan.markets[0].profileId = preset.profile.id;
  plan.feeAssets = buildUfgFeeAssetPolicies(TOKEN, ufgConfigFor(plan).reserveAssets);
  return plan;
}
function rpcBudgetPlan() { const plan = knownAbyssPlan({ nativeFunding: true }); return { plan, account: ACCOUNT, mode: "staged" }; }
const rpcBudgetClient = (plan) => clientFor(plan, { allowedTags: ["0x2a", "0x28"] });

function tazeShape() {
  const plan = knownAbyssPlan({ markets: 3 });
  const unit = 10n ** 18n;
  plan.token = { ...plan.token, rewardMode: 2, supply: 1_000_000_000n * unit, burnOnCancel: true };
  plan.feeAssets = plan.feeAssets.map((policy) => ({ ...policy, ownerBps: 8000, rewardsBps: 2000 }));
  plan.deadline = 253402300799n; plan.executorFeeBps = 10;
  const budgets = [700_000_000n, 150_000_000n, 150_000_000n].map((amount) => amount * unit);
  plan.markets = plan.markets.map((market, index) => {
    const ranges = deriveLaunchPositionRanges({ launchSqrtPriceX96: 1n << 96n, launchedTokenIsQuote: true, tokenBudget: budgets[index], tickSpacing: 60,
      venue: index === 0 ? "abyss" : "uniswap-v4", distributionPreset: "staircase", positionCount: 8, positionGaps: "adjacent" });
    const positions = ranges.positions.map((position) => ({ tickLower: position.tickLower, tickUpper: position.tickUpper, liquidity: position.liquidity, tokenAmountMaximum: position.maxTokenAmount }));
    if (index === 0) return { ...market, tokenBudget: budgets[index], config: encodeAbyssLifecycleMarketConfig({ ...decodeAbyssLifecycleMarketConfig(market.config), positions }) };
    const preset = getKnownLifecycleProfile({ ...plan, key: KnownLifecycleProfile.V4DynamicFeePool }), envelope = preset.profile.envelope;
    return { ...market, adapterId: preset.profile.registration.adapterId, profileId: preset.profile.id, tokenBudget: budgets[index], configVersion: preset.profile.adapter.configVersion,
      config: encodePoolBoundV4LifecycleMarketConfig({ version: preset.profile.adapter.configVersion, lpFeePips: 0, tickSpacing: 60, sqrtPriceX96: 1n << 96n,
        hookFeePips: 100000, minimumHookFeePips: 10000, feeSensitivityPipsSecondsPerTick: 6000, feeMode: 1,
        protocolFeeDenominator: envelope.protocolFeeDenominator, treasury: envelope.protocolTreasury, externalLiquidityDisabled: false,
        oracleConfigId: toHex(9n, { size: 32 }), profileId: preset.profile.id, termsDigest: envelope.termsDigest, developerBeneficiary: envelope.beneficiary, developerFeeBps: 0, hookSalt: zeroHash,
        positions: positions.map(({ tokenAmountMaximum, ...position }) => ({ ...position, salt: zeroHash, maxTokenAmount: tokenAmountMaximum })) }) };
  });
  plan.buys = plan.buys.map((buy, index) => ({ ...buy, quoteAmountIn: index === 1 ? 900000000000000n : unit, minTokenOut: 1n }));
  plan.funding = plan.funding.map((funding, index) => ({ ...funding, amount: plan.buys[index].quoteAmountIn, kind: index === 1 ? 1 : 2, inputAsset: index === 1 ? funding.asset : zeroAddress,
    inputAmount: [4200000000000000n, 900000000000000n, 900000000000000n][index], target: index === 1 ? zeroAddress : address(0xfb), data: index === 1 ? "0x" : "0x1234" }));
  return plan;
}

test("TAZE three-market24-position holders-earn conversion is staged with deterministic2/1 chunks and zero simulations", async () => {
  const plan = tazeShape(), client = clientFor(plan);
  const planned = await prepareAndPlanLifecycleLaunch({ client, plan, account: ACCOUNT, mode: "atomic", buySlippageBps: 50 });
  assert.equal(planned.mode, "staged"); assert.equal(planned.assessment.ready, true, planned.assessment.reason);
  assert.deepEqual(planned.transactions.filter((transaction) => transaction.kind === "prepare").map((transaction) => [transaction.marketStart, transaction.marketCount]), [[0, 2], [2, 1]]);
  assert.equal(planned.transactions.some((transaction) => transaction.kind === "atomic"), false);
  assert.ok(planned.plan.buys.every((buy) => buy.minTokenOut > 0n));
  assert.equal(planned.transactions[0].gas, 32_000_000n);
  assert.equal(Object.hasOwn(planned, "simulation"), false); assert.equal(Object.hasOwn(planned.assessment, "executionProof"), false);
  client.state.committedPlan = planned.plan;
  client.state.phase = LifecyclePhase.Preparing;
  const prepare = await buildNextTransaction({ client, planned });
  assert.equal(prepare.kind, "prepare"); assert.equal(prepare.marketCount, 2); assert.equal(prepare.gas, 32_000_000n);
  client.state.prepared = 2;
  assert.equal((await buildNextTransaction({ client, planned })).marketCount, 1);
  assert.equal(economicRequests(client).length, 0);
  assert.equal(client.captured.filter((call) => call.method === "eth_chainId").length, 1);
});

test("atomic is restricted to a single non-conversion market with known headroom", async () => {
  for (const [markets, conversion, requested, expected] of [[1, false, "atomic", "atomic"], [1, true, "atomic", "staged"], [2, false, "atomic", "staged"], [1, false, "staged", "staged"]]) {
    const plan = knownAbyssPlan({ markets });
    if (conversion) plan.funding[0] = { ...plan.funding[0], kind: 2, inputAsset: zeroAddress, target: address(0xfb), data: "0x1234" };
    const client = clientFor(plan), planned = await review(client, plan, { mode: requested });
    assert.equal(planned.assessment.ready, true, planned.assessment.reason); assert.equal(planned.mode, expected);
    assert.equal(planned.transactions[0].kind, expected === "atomic" ? "atomic" : "begin");
    assert.equal(planned.transactions[0].gas, ROBINHOOD_NATIVE_TRANSACTION_GAS_LIMIT);
    assert.equal(economicRequests(client).length, 0);
  }
});

test("canonical16 issue21 refuses review and build-next without execution fallback", async () => {
  const bytes = readFileSync(new URL("./fixtures/canonical16-issue21.json", import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "547b928cf2eac4b30493018486805bba0b7d72b32b4f1233c5357dd9bc10878f");
  const { parseLaunchPlan } = await import(sdkPath);
  const plan = parseLaunchPlan(JSON.stringify(JSON.parse(bytes).plan));
  const predictedToken = plan.feeAssets.find(({ asset }) => !plan.markets.some(({ quoteAsset }) => quoteAsset.toLowerCase() === asset.toLowerCase())).asset;
  const client = clientFor(plan, { predictedToken });
  const planned = await planLaunch({ client, plan, account: plan.creator, mode: "staged" });
  assert.equal(planned.assessment.ready, false);
  assert.equal(planned.assessment.code, "ACTIVATION_GAS_LIMIT");
  assert.equal(planned.assessment.capacityConstraint, "activation");
  assert.equal(planned.assessment.failedTransactionId, "activate");
  await assert.rejects(buildNextTransaction({ client, planned }), { code: "ACTIVATION_GAS_LIMIT" });
  assert.equal(economicRequests(client).length, 0);
});

test("activation over the known ceiling refuses before begin and exposes the public capacity bound", async () => {
  const plan = knownAbyssPlan(), budget = 10n ** 24n;
  plan.token.supply = budget; plan.markets[0].tokenBudget = budget; plan.buys = []; plan.funding = [];
  const positions = Array.from({ length: 32 }, (_, index) => ({ tickLower: index * 60, tickUpper: index === 31 ? 887220 : (index + 1) * 60, liquidity: 100n, tokenAmountMaximum: budget / 32n }));
  plan.markets[0].config = encodeAbyssLifecycleMarketConfig({ ...decodeAbyssLifecycleMarketConfig(plan.markets[0].config), positions });
  const bound = computeLifecycleLaunchGasBounds({ plan, predictedToken: TOKEN });
  assert.ok(bound.activationComputeGasUpperBound > 32_000_000n);
  const client = clientFor(plan), planned = await review(client, plan);
  assert.equal(planned.assessment.ready, false); assert.equal(planned.assessment.code, "ACTIVATION_GAS_LIMIT");
  assert.match(planned.assessment.reason, /Reduce/); assert.equal(planned.assessment.capacityConstraint, "activation");
  await assert.rejects(buildNextTransaction({ client, planned }), { code: "ACTIVATION_GAS_LIMIT" });
});

test("local ordered buy floors are exact, protected once, and unchanged by conversion payloads", async () => {
  for (const conversion of [false, true]) {
    const plan = knownAbyssPlan(); plan.buys = [10n, 20n].map((quoteAmountIn) => ({ ...plan.buys[0], quoteAmountIn, minTokenOut: 1n }));
    plan.funding[0].amount = plan.funding[0].inputAmount = 30n;
    if (conversion) plan.funding[0] = { ...plan.funding[0], kind: 2, inputAsset: zeroAddress, target: address(0xfb), data: "0x1234" };
    const client = clientFor(plan), planned = await prepareAndPlanLifecycleLaunch({ client, plan, account: ACCOUNT, mode: "atomic", buySlippageBps: 50 });
    assert.equal(planned.assessment.ready, true, planned.assessment.reason);
    const quotes = planned.assessment.gasProfile.initialBuys;
    assert.equal(quotes.length, 2);
    for (const quote of quotes) assert.equal(planned.plan.buys[quote.buyIndex].minTokenOut, quote.tokenOut * 9950n / 10000n);
    assert.equal(plan.buys[0].minTokenOut, 1n); assert.equal(economicRequests(client).length, 0);
  }
});

test("reviewed native gas is immutable and reviewed prices must cover the pinned floor", async () => {
  const plan = knownAbyssPlan(), source = clientFor(plan, { gasPrice: 100n, baseFeePerGas: 100n });
  const planned = await review(source, plan), held = planned.transactions[0];
  await assert.rejects(buildNextTransaction({ client: source, planned, reviewedTransaction: { ...held, gas: 31_000_000n } }), { code: "STALE_REVIEWED_GAS" });
  await assert.rejects(buildNextTransaction({ client: source, planned, reviewedTransaction: { ...held, gasPrice: 0n } }), { code: "REVIEWED_FEE_TOO_LOW" });
  const valid = await buildNextTransaction({ client: source, planned, reviewedTransaction: { ...held, gasPrice: 100n } });
  assert.equal(valid.gasPrice, 100n); assert.equal(valid.gas, 32_000_000n);
  const capped = await review(source, plan, { limits: { rpcGasLimit: 30_000_000n } });
  assert.equal(capped.assessment.code, "GAS_POLICY_LIMIT");
});

test("launch affordability uses the full native ceiling plus value, without separate poster charging", async () => {
  const plan = knownAbyssPlan({ nativeFunding: true });
  for (const [balance, ready] of [[64_000_010n, true], [64_000_009n, false]]) {
    const planned = await review(clientFor(plan, { balance }), plan, { mode: "staged" });
    assert.equal(planned.assessment.ready, ready, planned.assessment.reason);
    if (!ready) assert.equal(planned.assessment.code, "INSUFFICIENT_NATIVE_BALANCE");
  }
});

test("approval gas belongs to the wallet and fresh next construction sees changed allowance", async () => {
  const plan = knownAbyssPlan(), client = clientFor(plan, { allowance: 0n });
  const planned = await review(client, plan, { mode: "staged" });
  const approval = await buildNextTransaction({ client, planned });
  assert.equal(approval.kind, "approve"); assert.equal(approval.gas, undefined); assert.equal(approval.gasPrice, undefined);
  client.state.allowance = 10n;
  const begin = await buildNextTransaction({ client, planned });
  assert.equal(begin.kind, "begin"); assert.equal(begin.gas, 32_000_000n); assert.equal(begin.nonce, undefined);
});

test("fresh budget checks cannot be bypassed by a caller's successful assessment", async () => {
  const plan = knownAbyssPlan(), client = clientFor(plan);
  const planned = await review(client, plan, { mode: "staged" });
  planned.plan.buys[0].minTokenOut = 99n;
  await assert.rejects(buildNextTransaction({ client, planned }), { code: "PLAN_MUTATED" });
  const refusedPlan = knownAbyssPlan(); refusedPlan.buys[0].minTokenOut = 99n;
  const refused = await review(clientFor(refusedPlan), refusedPlan, { mode: "staged" });
  assert.equal(refused.assessment.code, "BUY_MINIMUM_NOT_MET");
  await assert.rejects(buildNextTransaction({ client: clientFor(refusedPlan), planned: { ...refused, assessment: { ...refused.assessment, ready: true } } }), { code: "BUY_MINIMUM_NOT_MET" });
});

test("one explicitly pinned aggregate per invocation shares prices and attests Multicall only once", async () => {
  const plan = knownAbyssPlan(), client = clientFor(plan);
  const planned = await review(client, plan, { mode: "staged" });
  assert.equal(planned.assessment.ready, true, planned.assessment.reason);
  assert.equal(client.captured.filter((call) => call.method === "eth_call" && call.params[0].to.toLowerCase() === MULTICALL3).length, 1);
  assert.equal(client.captured.filter((call) => call.method === "eth_getBlockByNumber").length, 1);
  assert.equal(client.captured.filter((call) => call.method === "eth_getBalance").length, 0);
  assert.equal(client.captured.length, 4, "One chain identity, header, Multicall attestation and aggregate");
  client.captured.length = 0; client.state.phase = LifecyclePhase.Preparing;
  assert.equal((await buildNextTransaction({ client, planned })).kind, "prepare");
  assert.equal(client.captured.filter((call) => call.method === "eth_getCode").length, 0);
  assert.equal(client.captured.filter((call) => call.method === "eth_chainId").length, 0);
  assert.equal(client.captured.length, 2);
});

test("unknown unbounded profiles never acquire invented readiness or a VM fallback", async () => {
  const plan = makePlan(), client = clientFor(plan), planned = await review(client, plan);
  assert.equal(planned.assessment.ready, false); assert.equal(planned.assessment.code, "UNKNOWN_GAS_PROFILE");
  await assert.rejects(prepareAndPlanLifecycleLaunch({ client, plan, account: ACCOUNT, mode: "staged", buySlippageBps: 50 }), { code: "OPENING_BUY_NOT_PROFILED" });
});

test("deadline boundary remains strict and expired unfinished launches retain cancellation", async () => {
  for (const deadline of [99n, 100n]) {
    const plan = knownAbyssPlan(); plan.deadline = deadline;
    const client = clientFor(plan, { phase: LifecyclePhase.Preparing }), planned = await review(client, plan, { mode: "staged" });
    assert.equal(planned.assessment.ready, deadline === 100n);
    if (deadline === 99n) assert.equal(planned.assessment.code, "PLAN_EXPIRED");
    const cancel = await buildNextTransaction({ client, planned, action: "cancel" });
    assert.equal(cancel.kind, "cancel"); assert.equal(cancel.gas, 32_000_000n); assert.equal(cancel.assessment.ready, true);
  }
});

test("caller progress and nonce extras cannot skip actual pending receipts", async () => {
  const plan = knownAbyssPlan(), client = clientFor(plan), planned = await review(client, plan, { mode: "staged" });
  const pending = { request: (args) => ["eth_getTransactionReceipt", "eth_getTransactionByHash"].includes(args.method) ? null : client.request(args) };
  await assert.rejects(buildNextTransaction({ client: pending, planned: { ...planned, progress: { ...planned.progress, confirmationSafe: true, receipts: [] } }, receipts: [{ transactionHash: FOREIGN_HASH, nonce: 7n }] }), { code: "RECEIPT_PENDING" });
  const next = await buildNextTransaction({ client, planned, reviewedTransaction: { ...planned.transactions[0], nonce: 123n } });
  assert.equal(next.nonce, undefined);
});

test("preparation batches cover every market once and each fits 32M with the evidence padding", () => {
  const plan = tazeShape();
  for (const prepared of [0, 1]) {
    const batches = packPreparationBatches(plan, prepared, 32_000_000n);
    assert.equal(batches.reduce((sum, count) => sum + count, 0), plan.markets.length);
    let start = prepared;
    for (const count of prepared > 0 ? batches.slice(1) : batches) {
      const gas = preparationGasEstimate(plan, start, count);
      assert.ok(((gas * BigInt(10000 + LIFECYCLE_CAPACITY_PADDING_BPS)) + 9999n) / 10000n <= 32_000_000n);
      start += count;
    }
  }
  assert.throws(() => packPreparationBatches(plan, 0, 2_000_000n), { code: "PREPARATION_GAS_LIMIT" });
});
test("selected Abyss profile keeps independent registry reads concurrent", async () => {
  const plan = makePlan({ chainId: 4663n });
  const abi = [...launchLifecycleAbi, ...lifecycleRegistryAbi, ...abyssLifecycleAdapterAbi, ...lifecycleAdapterAbi];
  const cases = [
    { blocked: `${REGISTRY}:core`, expected: [`${REGISTRY}:profile`] },
    { blocked: `${REGISTRY}:adapter`, expected: [`${REGISTRY}:profileTopology`, `${REGISTRY}:requireEligible`] },
    { blocked: `${REGISTRY}:profileTopology`, expected: [`${REGISTRY}:adapter`, `${REGISTRY}:requireEligible`] },
  ];
  for (const { blocked, expected } of cases) {
    const source = clientFor(plan);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const started = new Set();
    const client = { supportsReadBatching: true, async request(args) {
      if (args.method === "eth_call" || args.method === "eth_getCode") {
        const target = args.method === "eth_call" ? args.params[0].to : args.params[0];
        const name = args.method === "eth_call" ? decodeFunctionData({ abi, data: args.params[0].data }).functionName : args.method;
        const key = `${target.toLowerCase()}:${name}`;
        started.add(key);
        if (key === blocked) await gate;
      }
      return source.request(args);
    } };
    const pending = readLifecycleProfiles({ client, orchestrator: CORE, profileIds: [plan.markets[0].profileId] });
    await nextTurn();
    const observed = new Set(started);
    release();
    const [profile] = await pending;
    assert.equal(profile.admitted, true, profile.reason);
    for (const key of expected) assert.equal(observed.has(key), true, `${key} has no dependency on ${blocked}`);
    assert.equal(source.captured.some((row) => row.method === "eth_call" && row.params[0].to === REGISTRY &&
      decodeFunctionData({ abi: lifecycleRegistryAbi, data: row.params[0].data }).functionName === "protocolMaximumDeveloperFeeBps"), false);
  }
});

test("trusted registry eligibility proves live adapter state without duplicate implementation probes", async () => {
  const plan = makePlan({ chainId: 4663n });
  const cases = [
    { settings: {}, admitted: true },
    { settings: { codeFor: (target) => target.toLowerCase() === ADAPTER ? "0x" : CODE }, admitted: false },
    { settings: { codeFor: (target) => target.toLowerCase() === ADAPTER ? "0x600260005560026000f3" : CODE }, admitted: false },
    { settings: { authorities: { [ADAPTER]: address(0xff) } }, admitted: false },
    { settings: { graphDigest: FOREIGN_HASH }, admitted: false },
    { settings: { adapterOverrides: { enabled: false } }, admitted: false },
    { settings: { profileOverrides: { enabled: false } }, admitted: false },
    { settings: { adapterOverrides: { capabilities: 0n } }, admitted: false },
    { settings: { profileOverrides: { capabilities: 0n } }, admitted: false },
  ];
  for (const { settings, admitted } of cases) {
    const source = clientFor(plan, settings);
    const client = { supportsReadBatching: true, request(args) {
      if (args.method === "eth_getCode" && [ADAPTER, FACTORY].includes(args.params[0].toLowerCase())) throw new Error("Already-certified runtime probe is unavailable");
      if (args.method === "eth_call" && args.params[0].to.toLowerCase() === ADAPTER) {
        const name = decodeFunctionData({ abi: abyssLifecycleAdapterAbi, data: args.params[0].data }).functionName;
        if (["core", "dependencyDigest", "factory", "CONFIG_SCHEMA", "CONFIG_VERSION"].includes(name)) throw new Error("Already-certified adapter metadata probe is unavailable");
      }
      return source.request(args);
    } };
    const [profile] = await readLifecycleProfiles({ client, orchestrator: CORE, profileIds: [plan.markets[0].profileId] });
    assert.equal(profile.admitted, admitted, profile.reason);
    if (!admitted) assert.ok(profile.reason);
  }
});

test("certified Abyss discovery still rejects mismatched canonical registry identities", async () => {
  const plan = makePlan({ chainId: 4663n });
  for (const profileOverrides of [{ factory: address(0xff) }, { venue: address(0xff) }, { hook: address(0xff) }]) {
    const client = clientFor(plan, { profileOverrides });
    const [profile] = await readLifecycleProfiles({ client, orchestrator: CORE, profileIds: [plan.markets[0].profileId] });
    assert.equal(profile.admitted, false);
    assert.ok(profile.reason);
  }
});

test("overlapped Abyss eligibility rejects changed canonical identity or topology without retrying", async () => {
  const plan = makePlan({ chainId: 4663n });
  for (const supportsReadBatching of [false, true]) {
    for (const { settings = {}, topology, mismatch = false, malformed = false, eligibilityCalls = 1 } of [
      { settings: { profileOverrides: { configSchema: FOREIGN_HASH } }, eligibilityCalls: 0 },
      { settings: { adapterOverrides: { configVersion: 2 } } },
      { settings: { profileOverrides: { factory: address(1) } } },
      { topology: { hookTopology: 1 } },
      { topology: { configVersion: 2 } },
      { topology: { hookDeployer: ADAPTER } },
      { topology: { hookCreationCodeHash: HASH } },
      { mismatch: true },
      { malformed: true },
      {},
    ]) {
      const source = clientFor(plan, settings);
      let observedEligibility = 0;
      const client = { supportsReadBatching, async request(args) {
        if (args.method === "eth_call" && args.params[0].to === REGISTRY) {
          const call = decodeFunctionData({ abi: lifecycleRegistryAbi, data: args.params[0].data });
          if (call.functionName === "profileTopology" && topology) return encodeFunctionResult({
            abi: lifecycleRegistryAbi, functionName: call.functionName,
            result: { hookTopology: 0, configVersion: 1, hookDeployer: zeroAddress, hookCreationCodeHash: zeroHash, ...topology },
          });
          if (call.functionName === "requireEligible") {
            observedEligibility += 1;
            assert.deepEqual(call.args, [plan.markets[0].adapterId, plan.markets[0].profileId, 1, LIFECYCLE_REQUIRED_CAPABILITIES]);
            assert.equal(args.params[1], "0x2a");
            if (mismatch) return encodeFunctionResult({ abi: lifecycleRegistryAbi, functionName: call.functionName, result: address(1) });
            if (malformed) return "0x";
            throw new Error("Pinned eligibility read failed");
          }
        }
        return source.request(args);
      } };
      const [profile] = await readLifecycleProfiles({ client, orchestrator: CORE, profileIds: [plan.markets[0].profileId] });
      assert.equal(profile.admitted, false);
      assert.equal(observedEligibility, eligibilityCalls, "Early refusal is consumed once, never warmed and retried");
      assert.ok(profile.reason);
      assert.equal(profile.reason.includes("Pinned eligibility read failed"), false);
      assert.equal(economicRequests(source).length, 0);
    }
  }
});

test("an early Abyss eligibility rejection stays handled while adapter metadata is pending", async () => {
  const plan = makePlan(), source = clientFor(plan);
  const failure = new Error("Pinned eligibility temporarily unavailable");
  let release, fail = true, attempts = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const unhandled = [];
  const observeUnhandled = (error) => unhandled.push(error);
  const client = { supportsReadBatching: true, async request(args) {
    if (args.method === "eth_call" && args.params[0].to === REGISTRY) {
      const call = decodeFunctionData({ abi: lifecycleRegistryAbi, data: args.params[0].data });
      if (call.functionName === "adapter") await gate;
      if (call.functionName === "requireEligible") {
        attempts += 1;
        if (fail) throw failure;
      }
    }
    return source.request(args);
  } };
  process.on("unhandledRejection", observeUnhandled);
  try {
    const pending = readLifecycleProfiles({ client, orchestrator: CORE, profileIds: [plan.markets[0].profileId] });
    const result = pending.then((profiles) => ({ profiles }), (error) => ({ error }));
    await nextTurn();
    const attemptsBeforeMetadata = attempts;
    await nextTurn();
    release();
    const settled = await result;
    assert.equal(settled.error, undefined);
    assert.equal(attemptsBeforeMetadata, 1, "The exact eligibility observation does not await adapter metadata");
    assert.equal(attempts, 1, "Certification must consume the recorded refusal, not retry it");
    assert.equal(settled.profiles[0].admitted, false);
    assert.ok(settled.profiles[0].reason);
    assert.equal(settled.profiles[0].reason.includes(failure.message), false);
    assert.deepEqual(unhandled, []);
    fail = false;
    assert.equal((await readLifecycleProfiles({ client, orchestrator: CORE, profileIds: [plan.markets[0].profileId] }))[0].admitted, true);
    assert.equal(attempts, 2, "A separate public invocation starts its own fresh eligibility proof");
  } finally {
    release();
    process.off("unhandledRejection", observeUnhandled);
  }
});

test("late Abyss eligibility failure cannot replace metadata errors or escape its settled owner", async () => {
  const plan = makePlan();
  for (const failedMetadata of ["adapter", "profileTopology"]) {
    const source = clientFor(plan), metadataFailure = new Error(`Pinned ${failedMetadata} unavailable`);
    const eligibilityFailure = Object.assign(new Error("Eligibility read cancelled after metadata refusal"), { name: "AbortError" });
    let releaseMetadata, releaseEligibility, eligibilityStarted = false;
    const metadataGate = new Promise((resolve) => { releaseMetadata = resolve; });
    const eligibilityGate = new Promise((resolve) => { releaseEligibility = resolve; });
    const unhandled = [];
    const observeUnhandled = (error) => unhandled.push(error);
    const client = { supportsReadBatching: true, async request(args) {
      if (args.method === "eth_call" && args.params[0].to === REGISTRY) {
        const call = decodeFunctionData({ abi: lifecycleRegistryAbi, data: args.params[0].data });
        if (call.functionName === failedMetadata) {
          await metadataGate;
          throw metadataFailure;
        }
        if (call.functionName === "requireEligible") {
          eligibilityStarted = true;
          await eligibilityGate;
          throw eligibilityFailure;
        }
      }
      return source.request(args);
    } };
    process.on("unhandledRejection", observeUnhandled);
    try {
      const pending = readLifecycleProfiles({ client, orchestrator: CORE, profileIds: [plan.markets[0].profileId] });
      const result = pending.then((profiles) => ({ profiles }), (error) => ({ error }));
      await nextTurn();
      const startedBeforeRefusal = eligibilityStarted;
      releaseMetadata();
      const settled = await result;
      releaseEligibility();
      await nextTurn();
      await nextTurn();
      assert.equal(startedBeforeRefusal, true);
      if (failedMetadata === "adapter") assert.equal(settled.error, metadataFailure, "Adapter source failure remains an invocation error");
      else {
        assert.equal(settled.error, undefined);
        assert.equal(settled.profiles[0].admitted, false);
        assert.ok(settled.profiles[0].reason, "Topology refusal remains attached to the profile");
        assert.equal(settled.profiles[0].reason.includes(metadataFailure.message), false);
      }
      assert.deepEqual(unhandled, [], "Late abort stays observed even after the private read owner closes");
    } finally {
      releaseMetadata();
      releaseEligibility();
      process.off("unhandledRejection", observeUnhandled);
    }
  }
});
for (const token0 of [true, false]) {
  test(`0.01% token${token0 ? 0 : 1} recipes produce spacing-one ranges admitted by lifecycle planning`, async () => {
    const plan = knownAbyssPlan({ token0 });
    const budget = 100n * 10n ** 18n;
    plan.token.supply = budget;
    plan.markets[0].tokenBudget = budget;
    const recipe = deriveLaunchPoolRecipe({
      pairedTokenDecimals: 18, pairedTokenUsdPriceX18: 10n ** 18n,
      targetMarketCapUsdX18: 5n * 10n ** 18n, supply: budget, tokenBudget: budget,
      launchedTokenIsQuote: token0, fee: 100,
    });
    const ranges = deriveLaunchPositionRanges({
      launchSqrtPriceX96: recipe.launchSqrtPriceX96, launchedTokenIsQuote: token0,
      tokenBudget: budget, tickSpacing: 1, venue: "abyss",
      distributionPreset: "staircase", positionCount: 3, positionGaps: "adjacent",
    });
    assert.equal(ranges.boundaryTick, token0 ? 887272 : -887272);
    assert.equal(ranges.tokenAmountMaximum, budget);
    assert.equal(ranges.positions.length, 3);
    const config = { ...decodeAbyssLifecycleMarketConfig(plan.markets[0].config), fee: 100,
      openingSqrtPriceX96: recipe.launchSqrtPriceX96,
      positions: ranges.positions.map((position) => ({ tickLower: position.tickLower, tickUpper: position.tickUpper,
        liquidity: position.liquidity, tokenAmountMaximum: position.maxTokenAmount })) };
    plan.markets[0].config = encodeAbyssLifecycleMarketConfig(config);
    for (const mode of ["atomic", "staged"]) {
      const planned = await review(clientFor(plan), plan, { mode });
      assert.equal(planned.assessment.ready, true, planned.assessment.reason);
      assert.equal(planned.planHash, hashLaunchPlan(plan));
      for (const transaction of planned.transactions.filter((transaction) => transaction.to.toLowerCase() === plan.orchestrator.toLowerCase())) {
        const committed = decodeFunctionData({ abi: launchLifecycleAbi, data: transaction.data }).args[0];
        assert.equal(hashLaunchPlan(committed), hashLaunchPlan(plan));
      }
    }
    plan.markets[0].config = encodeAbyssLifecycleMarketConfig({ ...config, fee: 101 });
    await assert.rejects(review(clientFor(plan), plan), { code: "INVALID_MARKET" });
    plan.markets[0].config = encodeAbyssLifecycleMarketConfig({ ...config,
      positions: config.positions.map((position, index) => index === config.positions.length - 1
        ? { ...position, ...(token0 ? { tickUpper: 887271 } : { tickLower: -887271 }) } : position) });
    await assert.rejects(review(clientFor(plan), plan), { code: "MISSING_PERMANENT_TAIL" });
  });
}

for (const token0 of [true, false]) {
  for (const mode of ["atomic", "staged"]) {
    test(`token${token0 ? 0 : 1} ${mode} planning requires a permanent tail and preserves explicit tail opt-out through recovery`, async () => {
      const plan = knownAbyssPlan({ token0 });
      plan.buys = [];
      const config = decodeAbyssLifecycleMarketConfig(plan.markets[0].config);
      plan.markets[0].config = encodeAbyssLifecycleMarketConfig({ ...config, positions: config.positions.map((position) => ({
        ...position, tickLower: token0 ? 0 : -120, tickUpper: token0 ? 120 : 0,
      })) });
      const commitment = hashLaunchPlan(plan);
      for (const operation of [planLaunch, prepareAndPlanLifecycleLaunch]) {
        for (const allowTopologyGaps of [false, true]) {
          const client = clientFor(plan);
          await assert.rejects(operation({ client, plan, account: ACCOUNT, mode, allowTopologyGaps }), { code: "MISSING_PERMANENT_TAIL" });
          assert.equal(economicRequests(client).length, 0, "Unsafe topology cannot reach economic execution");
        }
        const client = clientFor(plan);
        const planned = await operation({ client, plan, account: ACCOUNT, mode, allowMissingPermanentTail: true });
        assert.equal(planned.assessment.ready, true, planned.assessment.reason);
        assert.equal(planned.allowMissingPermanentTail, true);
        assert.equal(planned.allowTopologyGaps, false);
        assert.equal(planned.planHash, commitment);
        assert.equal(hashLaunchPlan(plan), commitment, "Validation options never rewrite committed economics");
        const compiled = planned.transactions.filter((transaction) => transaction.to.toLowerCase() === plan.orchestrator.toLowerCase());
        for (const transaction of compiled) {
          const committed = decodeFunctionData({ abi: launchLifecycleAbi, data: transaction.data }).args[0];
          assert.equal(hashLaunchPlan(committed), commitment);
        }
        assert.ok(await buildNextTransaction({ client, planned }), "Tail opt-out remains available to fresh unfinished-work admission");
      }
    });
  }

  test(`token${token0 ? 0 : 1} planner gap and permanent-tail opt-outs are independent`, async () => {
    const plan = knownAbyssPlan({ token0 });
    plan.buys = [];
    const config = decodeAbyssLifecycleMarketConfig(plan.markets[0].config);
    const positions = token0
      ? [{ tickLower: 0, tickUpper: 60, liquidity: 1n, tokenAmountMaximum: 50n },
        { tickLower: 120, tickUpper: 887220, liquidity: 1n, tokenAmountMaximum: 50n }]
      : [{ tickLower: -60, tickUpper: 0, liquidity: 1n, tokenAmountMaximum: 50n },
        { tickLower: -887220, tickUpper: -120, liquidity: 1n, tokenAmountMaximum: 50n }];
    plan.markets[0].config = encodeAbyssLifecycleMarketConfig({ ...config, positions });
    for (const operation of [planLaunch, prepareAndPlanLifecycleLaunch]) {
      await assert.rejects(operation({ client: clientFor(plan), plan, account: ACCOUNT, mode: "atomic" }), { code: "TOPOLOGY_INTERIOR_GAP" });
      await assert.rejects(operation({ client: clientFor(plan), plan, account: ACCOUNT, mode: "atomic", allowMissingPermanentTail: true }), { code: "TOPOLOGY_INTERIOR_GAP" });
      const planned = await operation({ client: clientFor(plan), plan, account: ACCOUNT, mode: "atomic", allowTopologyGaps: true });
      assert.equal(planned.assessment.ready, true, planned.assessment.reason);
      assert.equal(planned.allowTopologyGaps, true);
      assert.equal(planned.allowMissingPermanentTail, false);
      const client = clientFor(plan);
      assert.ok(await buildNextTransaction({ client, planned }));
    }
    const finite = positions.map((position, index) => index === 1 ? { ...position,
      tickLower: token0 ? 120 : -180, tickUpper: token0 ? 180 : -120 } : position);
    plan.markets[0].config = encodeAbyssLifecycleMarketConfig({ ...config, positions: finite });
    await assert.rejects(review(clientFor(plan), plan, { allowTopologyGaps: true }), { code: "MISSING_PERMANENT_TAIL" });
    await assert.rejects(review(clientFor(plan), plan, { allowMissingPermanentTail: true }), { code: "TOPOLOGY_INTERIOR_GAP" });
    assert.equal((await review(clientFor(plan), plan, { allowTopologyGaps: true, allowMissingPermanentTail: true })).assessment.ready, true);
  });

  test(`token${token0 ? 0 : 1} neither planner opt-out bypasses opening containment or tick alignment`, async () => {
    for (const [code, ticks] of [
      ["TOPOLOGY_OPENING_GAP", token0 ? { tickLower: 60, tickUpper: 887220 } : { tickLower: -887220, tickUpper: -60 }],
      ["TOPOLOGY_OFF_GRID_TICK", token0 ? { tickLower: 0, tickUpper: 887219 } : { tickLower: -887219, tickUpper: 0 }],
    ]) {
      const plan = knownAbyssPlan({ token0 }), config = decodeAbyssLifecycleMarketConfig(plan.markets[0].config);
      plan.markets[0].config = encodeAbyssLifecycleMarketConfig({ ...config,
        positions: config.positions.map((position) => ({ ...position, ...ticks })) });
      for (const operation of [planLaunch, prepareAndPlanLifecycleLaunch]) {
        const client = clientFor(plan);
        await assert.rejects(operation({ client, plan, account: ACCOUNT, mode: "atomic",
          allowTopologyGaps: true, allowMissingPermanentTail: true }), { code });
        assert.equal(economicRequests(client).length, 0);
      }
    }
  });
}

test("a funded tail in one market cannot substitute for another market's missing tail", async () => {
  const plan = knownAbyssPlan({ markets: 2 }), market = plan.markets[1];
  const config = decodeAbyssLifecycleMarketConfig(market.config);
  market.config = encodeAbyssLifecycleMarketConfig({ ...config, positions: config.positions.map((position) => ({ ...position, tickUpper: 120 })) });
  await assert.rejects(review(clientFor(plan), plan), (error) => error.code === "MISSING_PERMANENT_TAIL" && /Market 1:/.test(error.message));
});

test("started and terminal launches recover legacy topology without creation-policy opt-outs", async () => {
  for (const phase of [LifecyclePhase.Preparing, LifecyclePhase.Ready, LifecyclePhase.Active, LifecyclePhase.Cancelled]) {
    const plan = knownAbyssPlan(), config = decodeAbyssLifecycleMarketConfig(plan.markets[0].config)
    // This immutable historical commitment has all three creation-policy faults:
    // off-grid endpoints, an opening gap, and no permanent tail.
    plan.markets[0].config = encodeAbyssLifecycleMarketConfig({ ...config, positions: config.positions.map((position) => ({
      ...position, tickLower: 61, tickUpper: 119,
    })) });
    const prepared = phase === LifecyclePhase.Ready || phase === LifecyclePhase.Active ? 1 : 0;
    const client = clientFor(plan, { phase, prepared });
    const planned = await review(client, plan, { mode: "staged" });
    assert.equal(planned.assessment.ready, true, planned.assessment.reason);
    assert.equal(planned.allowTopologyGaps, false);
    assert.equal(planned.allowMissingPermanentTail, false);
    ;
    const next = await buildNextTransaction({ client, planned });
    if (phase === LifecyclePhase.Active || phase === LifecyclePhase.Cancelled) assert.equal(next, undefined);
    else assert.equal(next.kind, phase === LifecyclePhase.Preparing ? "prepare" : "activate");
    assert.equal(planned.planHash, hashLaunchPlan(plan), "Recovery preserves the existing commitment");
  }
});
test("UFG planning rejects account/nonce mismatch, opt-in omission and treasury config mutation", async () => {
  const plan = makeUfgPlan(), ufg = { config: ufgConfigFor(plan) };
  const client = clientFor(plan);
  await assert.rejects(planLaunch({ client, plan, account: address(0xa1), mode: "atomic", ufg }), { code: "INVALID_UFG_PLAN" });
  await assert.rejects(planLaunch({ client, plan, account: ACCOUNT, mode: "atomic" }), { code: "ACCOUNT_MISMATCH" });
  const planned = await planLaunch({ client, plan, account: ACCOUNT, mode: "atomic", ufg });
  assert.equal(planned.assessment.ready, true);
  planned.ufg.config.exitFeeBps += 1;
  await assert.rejects(buildNextTransaction({ client, planned }), { code: "PLAN_MUTATED" });
});

test("UFG treasury config is bound before asynchronous domain reads", async () => {
  const plan = makeUfgPlan(), ufg = { config: ufgConfigFor(plan) }, source = clientFor(plan);
  let changed = false;
  const client = { request(args) {
    if (!changed && args.method === "eth_call") { changed = true; ufg.config.exitFeeBps += 1; }
    return source.request(args);
  } };
  await assert.rejects(planLaunch({ client, plan, account: ACCOUNT, mode: "staged", ufg }), { code: "PLAN_MUTATED" });
});
test("UFG canonical receipt attribution requires proxy target/config and proxy funding spender", async () => {
  const plan = makeUfgPlan(), ufg = { config: ufgConfigFor(plan) }, source = clientFor(plan, { allowance: 0n });
  const planned = await planLaunch({ client: source, plan, account: ACCOUNT, mode: "staged", ufg });
  const begin = planned.transactions.find((tx) => tx.kind === "begin");
  const approval = planned.transactions[0];
  for (const [name, transaction, accepted] of [
    ["proxy begin", begin, true],
    ["proxy approval", approval, true],
    ["core instead of proxy", { ...begin, to: plan.orchestrator }, false],
    ["wrong treasury config", { ...begin, data: encodeFunctionData({ abi: ufgLaunchProxyV1Abi, functionName: "beginLaunch", args: [plan, 1, { ...ufg.config, exitFeeBps: 101 }] }) }, false],
    ["escrow instead of proxy approval", { ...approval, data: encodeFunctionData({ abi: lifecycleErc20Abi, functionName: "approve", args: [getKnownLifecycleDeployment(plan).fundingEscrow, 10n] }) }, false],
  ]) {
    const client = { request(args) {
      if (args.method === "eth_getTransactionReceipt") return Promise.resolve({ blockNumber: "0x2a", blockHash: HASH, status: "0x1" });
      if (args.method === "eth_getTransactionByHash") return Promise.resolve({ from: ACCOUNT, to: transaction.to, input: transaction.data, value: toHex(transaction.value), nonce: "0x0", chainId: toHex(plan.chainId) });
      return source.request(args);
    } };
    const options = { client, planned, receipts: [{ transactionHash: FOREIGN_HASH }] };
    if (accepted) { const receipt = (await readLaunchProgress(options)).receipts[0]; assert.equal(receipt.status, "confirmed", name); assert.equal(receipt.nonce, 0n); }
    else await assert.rejects(readLaunchProgress(options), { code: "RECEIPT_IDENTITY" }, name);
  }
});
test("equal observed and inclusion blocks across receipts share one fresh canonical read", async (t) => {
  const options = rpcBudgetPlan(), source = rpcBudgetClient(options.plan);
  const planned = await planLaunch({ ...options, client: source, mode: "staged" });
  const begin = planned.transactions[0], wire = [];
  const client = { request(args) {
    wire.push(args);
    if (args.method === "eth_getTransactionReceipt") return Promise.resolve({ blockNumber: "0x28", blockHash: toHex(40n, { size: 32 }), status: "0x1" });
    if (args.method === "eth_getTransactionByHash") return Promise.resolve({ from: ACCOUNT, to: begin.to, input: begin.data, value: toHex(begin.value), nonce: "0x0", chainId: toHex(options.plan.chainId) });
    return source.request(args);
  } };
  const receipts = [1n, 2n, 3n].map((id) => ({ transactionHash: toHex(id, { size: 32 }), observedBlockNumber: 40n, observedBlockHash: toHex(40n, { size: 32 }) }));
  const progress = await readLaunchProgress({ client, planned, receipts });
  assert.ok(progress.receipts.every((receipt) => receipt.status === "confirmed"));
  assert.equal(wire.filter((row) => row.method === "eth_getBlockByNumber" && row.params[0] === "0x28").length, 1);
  assert.equal(wire.length, 11);
  t.diagnostic("three equal observed/inclusion receipts: 11 RPC methods; one shared historical header");
});

test("receipt attribution retains the actual submitted nonce and refuses mismatches or invalid exact integers", async () => {
  const options = rpcBudgetPlan(), source = rpcBudgetClient(options.plan);
  const planned = await planLaunch({ ...options, client: source, mode: "staged" }), begin = planned.transactions[0];
  const methods = [], reference = { transactionHash: toHex(1n, { size: 32 }), nonce: 7n };
  const client = { request(args) {
    methods.push(args.method);
    if (args.method === "eth_getTransactionReceipt") return Promise.resolve({ blockNumber: "0x28", blockHash: toHex(40n, { size: 32 }), status: "0x1" });
    if (args.method === "eth_getTransactionByHash") return Promise.resolve({ from: ACCOUNT, to: begin.to, input: begin.data, value: toHex(begin.value), nonce: "0x7", chainId: toHex(options.plan.chainId) });
    return source.request(args);
  } };
  const progress = await readLaunchProgress({ client, planned, receipts: [reference] });
  assert.equal(progress.receipts[0].nonce, 7n); assert.equal(progress.receipts[0].status, "confirmed");
  await assert.rejects(readLaunchProgress({ client, planned, receipts: [{ ...reference, nonce: 8n }] }), { code: "RECEIPT_NONCE" });
  for (const nonce of [-1n, 1n << 64n, 7, "7"]) {
    await assert.rejects(readLaunchProgress({ client, planned, receipts: [{ ...reference, nonce }] }), { code: "INVALID_RECEIPT_NONCE" });
  }
  assert.equal(methods.includes("eth_getTransactionCount"), false);
});

test("unknown approval receipts share identity headers but recheck inclusion after async authority reads", async () => {
  const plan = makePlan(), source = clientFor(plan, { allowedTags: ["0x2a", "0x28"] });
  const planned = await review(source, plan), wire = [];
  let authorityRead = false;
  const client = { async request(args) {
    wire.push(args);
    if (args.method === "eth_getTransactionReceipt") return { blockNumber: "0x28", blockHash: toHex(40n, { size: 32 }), status: "0x1" };
    if (args.method === "eth_getTransactionByHash") return { from: ACCOUNT, to: plan.funding[0].inputAsset,
      input: encodeFunctionData({ abi: lifecycleErc20Abi, functionName: "approve", args: [ESCROW, 10n] }), value: "0x0", nonce: "0x0", chainId: toHex(plan.chainId) };
    if (args.method === "eth_call" && args.params[1] === "0x28") authorityRead = true;
    const value = await source.request(args);
    return args.method === "eth_getBlockByNumber" && args.params[0] === "0x28" && authorityRead ? { ...value, hash: FOREIGN_HASH } : value;
  } };
  const receipts = [1n, 2n].map((id) => ({ transactionHash: toHex(id, { size: 32 }) }));
  const progress = await readLaunchProgress({ client, planned, receipts });
  assert.ok(progress.receipts.every((receipt) => receipt.status === "reorged"));
  assert.equal(wire.filter((row) => row.method === "eth_getBlockByNumber" && row.params[0] === "0x28").length, 2,
    "One shared identity pin plus one shared canonical inclusion check after all authority reads");
});

test("receipt coalescing preserves malformed-header refusal and retained observed-block reorg priority", async () => {
  const options = rpcBudgetPlan(), source = rpcBudgetClient(options.plan);
  const planned = await planLaunch({ ...options, client: source });
  for (const [malformed, observedReorg] of [[true, false], [false, false], [false, true]]) {
    const client = { async request(args) {
      if (args.method === "eth_getTransactionReceipt") return { blockNumber: "0x28", blockHash: malformed ? "0x" : toHex(40n, { size: 32 }), status: "0x1" };
      if (args.method === "eth_getTransactionByHash") return malformed
        ? { from: ACCOUNT, to: planned.transactions[0].to, input: planned.transactions[0].data, value: "0xa", nonce: "0x0", chainId: toHex(options.plan.chainId) }
        : null;
      const value = await source.request(args);
      return args.method === "eth_getBlockByNumber" && args.params[0] === "0x28"
        ? { ...value, hash: malformed ? "0x" : observedReorg ? FOREIGN_HASH : toHex(40n, { size: 32 }) } : value;
    } };
    const receipts = [{ transactionHash: FOREIGN_HASH, observedBlockNumber: 40n, observedBlockHash: toHex(40n, { size: 32 }) }];
    if (observedReorg) assert.equal((await readLaunchProgress({ client, planned, receipts })).receipts[0].status, "reorged");
    else await assert.rejects(readLaunchProgress({ client, planned, receipts }), { code: "INVALID_RPC_RESPONSE" });
  }
});
test("head-height receipts reuse the invocation's authoritative L2 header", async () => {
  const plan = knownAbyssPlan(), source = clientFor(plan);
  const planned = await planLaunch({ client: source, plan, account: ACCOUNT, mode: "staged" });
  const begin = planned.transactions[0];
  source.state.phase = LifecyclePhase.Preparing;
  const wire = [];
  const client = { request(args) {
    wire.push(args);
    if (args.method === "eth_getTransactionReceipt") return Promise.resolve({ blockNumber: "0x2a", blockHash: HASH, status: "0x1" });
    if (args.method === "eth_getTransactionByHash") return Promise.resolve({ from: ACCOUNT, to: begin.to, input: begin.data, value: toHex(begin.value), nonce: "0x0", chainId: toHex(plan.chainId) });
    return source.request(args);
  } };
  const progress = await readLaunchProgress({ client, planned, receipts: [{ transactionHash: FOREIGN_HASH }] });
  assert.equal(progress.receipts[0].status, "confirmed");
  assert.equal(wire.filter((call) => call.method === "eth_getBlockByNumber").length, 1);
  assert.equal(wire.find((call) => call.method === "eth_getBlockByNumber").params[0], "latest");
});
