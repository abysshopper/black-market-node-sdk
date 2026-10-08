import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { decodeFunctionData, encodeAbiParameters, encodeErrorResult, encodeEventTopics, encodeFunctionData, encodeFunctionResult, keccak256, parseAbi, stringToHex, toHex, zeroAddress, zeroHash } from "viem";

const sdkPath = process.env.SDK_SOURCE_TEST === "1" ? "../src/lifecycle/index.ts" : "../dist/lifecycle/index.js";
const { ABYSS_LIFECYCLE_CONFIG_SCHEMA, abyssLifecycleAdapterAbi, buildNextTransaction, decodeAbyssLifecycleMarketConfig, encodeAbyssLifecycleMarketConfig, fixedFeePoolHookV1Abi, getKnownLifecycleDeployment, getKnownLifecycleProfile, hashLaunchIdentity, hashLaunchPlan, KnownLifecycleProfile, launchLifecycleAbi, lifecycleAdapterAbi, lifecycleDirectoryAbi, lifecycleErc20Abi, lifecycleFundingEscrowAbi, lifecycleRegistryAbi, LifecyclePhase, LIFECYCLE_REQUIRED_CAPABILITIES, LIFECYCLE_MULTI_POSITION_CAPABILITY, planLaunch, prepareAndPlanLifecycleLaunch, readLifecycleProfiles, simulateLaunchPlan } = await import(sdkPath);
const { prepareLaunchSimulation, simulateLaunchTransactions } = await import(sdkPath.replace("index.", "simulation."));
const { readLifecycleBlock, withLifecycleReadClient } = await import(sdkPath.replace("index.", "rpc."));
const address = (n) => toHex(BigInt(n), { size: 20 });
const ACCOUNT = address(0xa0), CORE = address(0xf0), REGISTRY = address(0xf1), ESCROW = address(0xf2), ADAPTER = address(0xf3), FACTORY = address(0xf4), TOKEN = address(0x10);
const CODE = "0x600160005560016000f3";
const HASH = toHex(42n, { size: 32 }), FOREIGN_HASH = toHex(43n, { size: 32 }), DIGEST = keccak256(CODE);
const diagnosticJson = (value) => JSON.stringify(value, (_key, field) => typeof field === "bigint" ? field.toString() : field);
const ARB_SYS = address(0x64), GAS_INFO = address(0x6c), NODE_INTERFACE = address(0xc8);
const arbSysAbi = parseAbi(["function arbOSVersion() view returns (uint256)"]);
const gasInfoAbi = parseAbi(["function getMaxTxGasLimit() view returns (uint256)", "function getMaxBlockGasLimit() view returns (uint64)"]);
const nodeInterfaceAbi = parseAbi(["function gasEstimateL1Component(address to, bool contractCreation, bytes data) payable returns (uint64 gasEstimateForL1, uint256 baseFee, uint256 l1BaseFeeEstimate)"]);

// ABI-complete injected RPC observations exercise public SDK consumers. These are
// offline behavioral fixtures, not live Nitro execution or deployment evidence.
function makePlan({ chainId = 31337n, markets = 1, nativeFunding = false } = {}) {
  const profileId = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "uint8" }], [keccak256(stringToHex("BLACK_MARKET_ABYSS_CANONICAL_PROFILE_V1")), chainId, FACTORY, 3]));
  const quotes = Array.from({ length: markets }, (_, index) => address(0x20 + index));
  return {
    chainId, orchestrator: CORE, creator: ACCOUNT, nonce: 7n,
    token: { kind: 0, rewardMode: 0, name: "Admission", symbol: "ADM", supply: 100n * BigInt(markets), nftUnit: 0n, metadataURI: "", salt: toHex(7n, { size: 32 }), inventoryRecipient: ACCOUNT, burnOnCancel: false },
    funding: quotes.map((asset) => ({ asset, amount: 10n, kind: nativeFunding ? 1 : 0, inputAsset: asset, inputAmount: 10n, target: zeroAddress, data: "0x" })),
    feeAssets: [TOKEN, ...quotes].map((asset) => ({ asset, ownerBps: 10000, rewardsBps: 0, burnBps: 0 })),
    markets: quotes.map((quoteAsset) => ({ adapterId: toHex(1n, { size: 32 }), profileId, quoteAsset, tokenBudget: 100n, configVersion: 1,
      config: encodeAbyssLifecycleMarketConfig({ profile: 3, fee: 3000, oracleConfigId: toHex(9n, { size: 32 }), openingSqrtPriceX96: 1n << 96n, positions: [{ tickLower: 60, tickUpper: 120, liquidity: 1n, tokenAmountMaximum: 100n }] }) })),
    buys: quotes.map((_, marketIndex) => ({ marketIndex, quoteAmountIn: 10n, minTokenOut: 5n, recipient: ACCOUNT, sqrtPriceLimitX96: (1n << 96n) - 1n })),
    deadline: 1000n, executorFeeBps: 0,
  };
}
function progress(plan, phase = LifecyclePhase.None, prepared = 0) {
  if (phase === LifecyclePhase.None) return { launchId: zeroHash, planHash: zeroHash, creator: zeroAddress, nonce: 0n, mode: 0, phase, token: zeroAddress, feeHub: zeroAddress, rewards: zeroAddress, preparedMarkets: 0, marketCount: 0, buyCount: 0, positionCount: 0, deadline: 0n };
  return { launchId: hashLaunchIdentity(plan), planHash: hashLaunchPlan(plan), creator: ACCOUNT, nonce: plan.nonce, mode: 1, phase, token: TOKEN, feeHub: address(0xf6), rewards: zeroAddress, preparedMarkets: prepared, marketCount: plan.markets.length, buyCount: plan.buys.length, positionCount: prepared, deadline: plan.deadline };
}
function identity(plan, index) {
  const fields = { venue: 1, manager: zeroAddress, factory: FACTORY, pool: address(0x100 + index), poolId: zeroHash, profileId: plan.markets[index].profileId, currency0: TOKEN, currency1: plan.markets[index].quoteAsset, fee: 3000, tickSpacing: 60, hook: zeroAddress, openingSqrtPriceX96: 1n << 96n };
  const canonicalId = keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "uint8" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }], [plan.chainId, fields.venue, fields.manager, fields.factory, fields.pool, fields.poolId, fields.profileId]));
  return { ...fields, canonicalId };
}
function event(name, args) {
  const inputs = launchLifecycleAbi.find((entry) => entry.type === "event" && entry.name === name).inputs;
  return { address: CORE, topics: encodeEventTopics({ abi: launchLifecycleAbi, eventName: name, args }), data: encodeAbiParameters(inputs.filter((input) => !input.indexed), inputs.filter((input) => !input.indexed).map((input) => args[input.name])) };
}
function clientFor(plan, settings = {}) {
  const known = getKnownLifecycleDeployment({ chainId: plan.chainId, orchestrator: plan.orchestrator });
  const CORE = plan.orchestrator.toLowerCase(), ESCROW = known?.fundingEscrow.toLowerCase() ?? address(0xf2);
  const log = (name, args) => ({ ...event(name, args), address: CORE });
  const state = { balance: 10n ** 24n, allowance: 10n, phase: LifecyclePhase.None, txCompute: 32_000_000n, blockCompute: 32_000_000n, rawVersion: 105n, poster: 0n, gasPrice: 2n, ...settings };
  const captured = [];
  let reorged = false, chainShifted = false;
  const capabilities = LIFECYCLE_REQUIRED_CAPABILITIES | LIFECYCLE_MULTI_POSITION_CAPABILITY;
  const registration = { adapterId: plan.markets[0].adapterId, configSchema: ABYSS_LIFECYCLE_CONFIG_SCHEMA, dependencyDigest: DIGEST, venue: FACTORY, factory: FACTORY, hook: zeroAddress, capabilities, enabled: true };
  const adapterRegistration = { implementation: ADAPTER, codeHash: DIGEST, capabilities, configVersion: 1, enabled: true };
  const decode = (data, abi) => decodeFunctionData({ abi, data });
  const output = (abi, functionName, result) => encodeFunctionResult({ abi, functionName, result });
  const client = { state, captured, async request({ method, params = [] }) {
    captured.push({ method, params });
    if (["eth_sendTransaction", "eth_sendRawTransaction", "evm_snapshot", "anvil_reset"].includes(method)) assert.fail("Source and submission admission must remain read-only");
    if (method === "eth_chainId") return toHex(chainShifted ? plan.chainId + 1n : plan.chainId);
    if (method === "eth_getBlockByNumber") return { number: toHex(42n), hash: reorged ? FOREIGN_HASH : HASH, timestamp: "0x64", gasLimit: toHex(state.headerGas ?? (plan.chainId === 4663n ? 1n << 50n : 30_000_000n)), baseFeePerGas: toHex(state.baseFeePerGas ?? state.gasPrice / 2n) };
    if (method === "eth_getCode") return typeof state.codeFor === "function" ? state.codeFor(params[0]) : params[0].toLowerCase() === ACCOUNT.toLowerCase() ? state.accountCode ?? "0x" : CODE;
    if (method === "eth_getBalance") return toHex(state.balance);
    if (method === "eth_getTransactionCount") return "0x0";
    if (method === "eth_gasPrice") return toHex(state.gasPrice);
    if (method === "eth_call") {
      assert.equal(params[1], "0x2a", "All authority and fee reads must stay pinned");
      const { to, data } = params[0];
      const target = to.toLowerCase();
      if (known && target === known.tokenFactory.toLowerCase()) return encodeAbiParameters([{ type: "address" }], [TOKEN]);
      if (target === ARB_SYS) {
        if (state.getterFailure) throw new Error("Historical ArbOS state unavailable");
        return state.versionResponse ?? output(arbSysAbi, "arbOSVersion", state.rawVersion);
      }
      if (target === GAS_INFO) {
        const call = decode(data, gasInfoAbi);
        return state.getterResponse ?? output(gasInfoAbi, call.functionName, call.functionName === "getMaxTxGasLimit" ? state.txCompute : state.blockCompute);
      }
      if (target === NODE_INTERFACE) {
        const call = decode(data, nodeInterfaceAbi);
        assert.equal(call.args[1], false);
        if (state.posterError) throw state.posterError;
        state.posterRequests ??= [];
        state.posterRequests.push({ request: params[0], args: call.args });
        return state.posterResponse ?? output(nodeInterfaceAbi, "gasEstimateL1Component", [state.poster, state.gasPrice, state.poster === 0n ? 0n : 3n]);
      }
      const abis = target === CORE ? [launchLifecycleAbi] : target === REGISTRY ? [lifecycleRegistryAbi] : target === address(0xf7) ? [lifecycleDirectoryAbi] : target === ESCROW ? [lifecycleFundingEscrowAbi] : target === ADAPTER ? [abyssLifecycleAdapterAbi, lifecycleAdapterAbi] : [lifecycleErc20Abi];
      let abi, call;
      for (const candidate of abis) { try { call = decode(data, candidate); abi = candidate; break; } catch {} }
      assert.ok(call, `Unexpected contract calldata ${target} ${data.slice(0, 10)}`);
      switch (call.functionName) {
        case "hashPlan": return output(abi, call.functionName, hashLaunchPlan(plan));
        case "launchIdOf": return output(abi, call.functionName, hashLaunchIdentity(plan));
        case "predictToken": return output(abi, call.functionName, TOKEN);
        case "tokenFactory": return output(abi, call.functionName, ADAPTER);
        case "fundingEscrow": return output(abi, call.functionName, ESCROW);
        case "registry": return output(abi, call.functionName, REGISTRY);
        case "core": return output(abi, call.functionName, state.authorities?.[target] ?? CORE);
        case "readLaunchProgress": return output(abi, call.functionName, progress(plan, state.phase, state.prepared ?? 0));
        case "directory": return output(abi, call.functionName, address(0xf7));
        case "market": return output(abi, call.functionName, [ADAPTER, { identity: identity(plan, call.args[1]), feeSource: address(0xf6),
          custody: address(0xf8), mintExecutor: ADAPTER, buyExecutor: ADAPTER, exclusions: [], positionCount: 1 }]);
        case "readMarket": return output(abi, call.functionName, { sqrtPriceX96: 1n << 96n, tick: 0, liquidity: 1n, publicTrading: false, oracleReadyAt: 0n });
        case "wrappedNative": return output(abi, call.functionName, plan.markets[0].quoteAsset);
        case "balanceOf": return output(abi, call.functionName, state.tokenBalance ?? 1000n);
        case "allowance": return output(abi, call.functionName, state.allowance);
        case "profile": return output(abi, call.functionName, { ...registration, ...state.profileOverrides });
        case "adapter": return output(abi, call.functionName, { ...adapterRegistration, ...state.adapterOverrides });
        case "profileTopology": return output(abi, call.functionName, { hookTopology: 0, configVersion: 1, hookDeployer: zeroAddress, hookCreationCodeHash: zeroHash });
        case "protocolMaximumDeveloperFeeBps":
          if (state.developerCapUnavailable) throw new Error("V4 developer-fee limits unavailable");
          return output(abi, call.functionName, 1000);
        case "fundingTarget": return output(abi, call.functionName, [address(0xfb), DIGEST, true]);
        case "fundingInputAllowed": return output(abi, call.functionName, true);
        case "requireEligible": {
          // LaunchImplementationRegistryV2.sol:285-296 checks these inside the
          // pinned on-chain call, not through separate client-side RPC probes.
          const approvedAdapter = { ...adapterRegistration, ...state.adapterOverrides };
          const approvedProfile = { ...registration, ...state.profileOverrides };
          const implementationCode = typeof state.codeFor === "function" ? state.codeFor(approvedAdapter.implementation) : CODE;
          if (!approvedAdapter.enabled || !approvedProfile.enabled || approvedProfile.adapterId.toLowerCase() !== call.args[0].toLowerCase() ||
            approvedAdapter.configVersion !== call.args[2] || implementationCode === "0x" || keccak256(implementationCode).toLowerCase() !== approvedAdapter.codeHash.toLowerCase() ||
            (approvedAdapter.capabilities & call.args[3]) !== call.args[3] || (approvedProfile.capabilities & call.args[3]) !== call.args[3] ||
            (state.authorities?.[approvedAdapter.implementation.toLowerCase()] ?? CORE).toLowerCase() !== CORE ||
            (state.graphDigest ?? DIGEST).toLowerCase() !== approvedProfile.dependencyDigest.toLowerCase()) throw new Error("IneligibleImplementation");
          return output(abi, call.functionName, approvedAdapter.implementation);
        }
        case "resolve": return output(abi, call.functionName, identity(plan, plan.markets.findIndex((market) => market.quoteAsset.toLowerCase() === call.args[2].quoteAsset.toLowerCase())));
        case "escrowBalance": return output(abi, call.functionName, 1000n);
        default: assert.fail(`Unexpected read ${call.functionName}`);
      }
    }
    if (method === "eth_simulateV1") {
      assert.equal(params[1], "0x2a");
      const request = params[0];
      if (request.blockStateCalls[0].calls[0].to === ARB_SYS) {
        assert.equal(request.validation, true);
        assert.equal(request.blockStateCalls.length, 1);
        assert.equal(request.blockStateCalls[0].calls.length, 3);
        assert.equal(BigInt(request.blockStateCalls[0].stateOverrides[ACCOUNT].balance), (1n << 256n) - 1n);
        if (state.probeError) throw state.probeError;
        if (state.probeFailure) throw new Error("Generic EVM lacks ArbOS metering");
        const values = [state.rawVersion, state.txCompute, state.blockCompute];
        return [{ calls: values.map((value, index) => ({ status: state.probeRevert ? "0x0" : "0x1", gasUsed: "0x5208", returnData: state.probeResponse ?? toHex(value + (state.probeMismatch === index ? 1n : 0n), { size: 32 }) })) }];
      }
      assert.ok(request.blockStateCalls.every((block) => block.stateOverrides === undefined), "Capability probe balance must never leak into actual execution proof");
      if (state.simulationUnavailable) throw new Error("Native sequential simulation unsupported");
      if (request.validation && state.replayThrow) throw Object.assign(new Error("execution failed"), { code: -32000 });
      let phase = state.phase, prepared = state.prepared ?? 0, allowance = state.allowance, stopped = false;
      const blocks = request.blockStateCalls.map((block) => {
        if (stopped) return { calls: [{ status: "0x0", gasUsed: "0x0", returnData: "0x", error: { message: "Prior dependent execution failed", data: state.downstreamFailureData } }] };
        assert.equal(block.calls.length, 1, "Actual dependent state is carried between ordered blocks");
        assert.equal(block.blockOverrides.baseFeePerGas, undefined, "Exact execution cannot fabricate fee-bearing block state");
        const tx = block.calls[0];
        // Independent fee-bearing refusal: recommendations are advisory, but
        // this natural child fee is an actual native validation requirement.
        if (request.validation && BigInt(tx.gasPrice) < (state.childBaseFee ?? state.baseFeePerGas ?? state.gasPrice / 2n)) {
          stopped = true;
          return { calls: [{ status: "0x0", gasUsed: "0x0", returnData: "0x",
            error: { code: -32000, message: "gas price below natural child base fee", data: "0x" } }] };
        }
        const abi = tx.to.toLowerCase() === CORE ? launchLifecycleAbi : lifecycleErc20Abi;
        const { functionName, args = [] } = decode(tx.data, abi);
        const used = typeof state.gasFor === "function" ? state.gasFor(functionName, args, request.validation, tx) : state.computeUsed ?? 1_000_000n;
        const fullUsed = used + (request.validation && plan.chainId === 4663n ? state.actualPoster ?? state.poster : 0n);
        const requiredEnvelope = fullUsed + (!request.validation && plan.chainId === 4663n && state.measurementPosterHold ? state.actualPoster ?? state.poster : 0n);
        const gas = BigInt(tx.gas);
        const failure = state.failureFor?.(functionName, args, request.validation, tx);
        if (failure !== undefined) {
          stopped = true;
          return { calls: [{ status: "0x0", gasUsed: toHex(failure.gasUsed ?? fullUsed), returnData: failure.returnData ?? "0x", error: failure.error }] };
        }
        const exhausted = requiredEnvelope > gas || plan.chainId === 4663n && used > (state.txCompute < state.blockCompute ? state.txCompute : state.blockCompute);
        if (state.replayFail && request.validation || state.prepareFailureData && functionName === "prepareMarkets" ||
          state.failActivation && ["launchAtomic", "activateLaunch"].includes(functionName) || exhausted) {
          stopped = true;
          const explicitRefusal = state.replayFail && request.validation || state.prepareFailureData && functionName === "prepareMarkets" ||
            state.failActivation && ["launchAtomic", "activateLaunch"].includes(functionName);
          return { calls: [{ status: "0x0", gasUsed: toHex(requiredEnvelope > gas ? gas : fullUsed),
            returnData: explicitRefusal ? functionName === "prepareMarkets" ? state.prepareFailureData ?? "0xdead" : "0xdead" : "0x",
            error: explicitRefusal ? { message: "Committed execution reverted" } : { code: state.nativeGasCode ?? -32015, message: "out of gas", data: "0x" } }] };
        }
        const executingPlan = args[0] ?? plan;
        if (["beginLaunch", "launchAtomic"].includes(functionName)) {
          const totals = new Map();
          for (const funding of executingPlan.funding) if (funding.kind === 0 || funding.kind === 2 && funding.inputAsset !== zeroAddress) {
            const key = funding.inputAsset.toLowerCase();
            totals.set(key, (totals.get(key) ?? 0n) + funding.inputAmount);
          }
          if ([...totals.values()].some((amount) => amount > (state.tokenBalance ?? 1000n))) {
            stopped = true;
            return { calls: [{ status: "0x0", gasUsed: toHex(fullUsed), returnData: "0x",
              error: { code: 3, message: "Committed funding transfer reverted", data: encodeErrorResult({ abi: parseAbi(["error InvalidFunding()"]), errorName: "InvalidFunding" }) } }] };
          }
        }
        let returnData = "0x", logs = [];
        if (functionName === "approve") { allowance = args[1]; returnData = output(abi, functionName, true); }
        else if (functionName === "beginLaunch") { assert.equal(phase, LifecyclePhase.None); assert.ok(allowance >= 10n || plan.funding[0].kind === 1); phase = LifecyclePhase.Preparing; returnData = output(launchLifecycleAbi, functionName, progress(executingPlan, phase)); }
        else if (functionName === "prepareMarkets") {
          assert.equal(phase, LifecyclePhase.Preparing); assert.equal(args[1], prepared);
          for (let index = args[1]; index < args[1] + args[2]; index++) logs.push(log("MarketPrepared", { launchId: hashLaunchIdentity(executingPlan), marketIndex: index, canonicalId: identity(executingPlan, index).canonicalId, adapter: ADAPTER, feeSource: address(0xf6), positionCount: decodeAbyssLifecycleMarketConfig(executingPlan.markets[index].config).positions.length }));
          prepared += args[2]; if (prepared === plan.markets.length) phase = LifecyclePhase.Ready;
        } else if (["launchAtomic", "activateLaunch"].includes(functionName)) {
          if (functionName === "activateLaunch") { assert.equal(phase, LifecyclePhase.Ready); assert.equal(prepared, plan.markets.length); }
          else { assert.equal(phase, LifecyclePhase.None); assert.ok(allowance >= 10n || plan.funding[0].kind === 1); }
          phase = LifecyclePhase.Active;
          const positionCount = executingPlan.markets.reduce((total, market) => total + decodeAbyssLifecycleMarketConfig(market.config).positions.length, 0);
          const receiptPositions = state.receiptPositionCount ?? positionCount;
          const tokenOut = typeof state.tokenOut === "function" ? state.tokenOut(executingPlan, request.validation) : executingPlan.buys.map(() => state.badOutput ? 4n : 7n);
          const quoteSpent = state.quoteSpent ?? executingPlan.buys.map(() => 8n);
          returnData = output(launchLifecycleAbi, functionName, { launchId: hashLaunchIdentity(executingPlan), planHash: hashLaunchPlan(executingPlan), token: TOKEN, feeHub: address(0xf6), rewards: zeroAddress, marketCount: executingPlan.markets.length, positionCount: receiptPositions, quoteSpent, tokenOut });
          logs = [log("LaunchActivated", { launchId: hashLaunchIdentity(executingPlan), planHash: hashLaunchPlan(executingPlan), token: TOKEN, marketCount: state.eventMarketCount ?? executingPlan.markets.length, positionCount: state.eventPositionCount ?? positionCount })];
        } else if (functionName === "cancelLaunch") { assert.ok([LifecyclePhase.Preparing, LifecyclePhase.Ready].includes(phase)); phase = LifecyclePhase.Cancelled; logs = [log("LaunchCancelled", { launchId: hashLaunchIdentity(plan), creator: ACCOUNT, inventoryBurned: false })]; }
        else assert.fail(`Unexpected execution ${functionName}`);
        return { calls: [{ status: "0x1", gasUsed: toHex(fullUsed), maxUsedGas: toHex(fullUsed), returnData, logs }] };
      });
      if (state.reorg && request.validation) reorged = true;
      if (state.sourceChainDrift && request.validation) chainShifted = true;
      return state.incompleteReplay && request.validation ? blocks.slice(0, -1) : blocks;
    }
    assert.fail(`Unexpected RPC method ${method}`);
  } };
  return client;
}

test("lagging RPC fee recommendations cannot authorize an underpriced launch envelope", async () => {
  const plan = makePlan();
  const client = clientFor(plan, { gasPrice: 2n, baseFeePerGas: 5n });
  const planned = await planLaunch({ client, plan, account: ACCOUNT, mode: "staged" });
  assert.equal(planned.simulation.admitted, true);
  for (const transaction of planned.transactions) {
    assert.equal(transaction.gasPrice, 10n);
    assert.equal(transaction.estimate.executionFee, transaction.gas * 10n);
  }
  const replayed = client.captured.filter((call) => call.method === "eth_simulateV1")
    .flatMap((call) => call.params[0].blockStateCalls)
    .flatMap((block) => block.calls);
  assert.ok(replayed.every((call) => BigInt(call.gasPrice) === 10n));
});
const review = (client, plan, extra = {}) => planLaunch({ client, plan, account: ACCOUNT, mode: "atomic", ...extra });
const economicRequests = (client) => client.captured.filter((row) => row.method === "eth_simulateV1" && row.params[0].blockStateCalls[0].calls[0].to !== ARB_SYS);
const capabilityRequests = (client) => client.captured.filter((row) => row.method === "eth_simulateV1" && row.params[0].blockStateCalls[0].calls[0].to === ARB_SYS);

test("a vanilla Abyss launch does not depend on V4 fee metadata or weaken native protocol proof", async () => {
  const plan = makePlan({ chainId: 4663n, nativeFunding: true });
  const planned = await review(clientFor(plan, { developerCapUnavailable: true }), plan);
  assert.equal(planned.simulation.admitted, true, planned.simulation.reason);
  assert.equal(planned.simulation.executionProof, "proved");
  assert.equal(planned.simulation.limits.protocol, "nitro");
  assert.equal(planned.profiles[0].venueKind, "abyss");
  assert.deepEqual(planned.transactions.map((transaction) => transaction.kind), ["atomic"]);
  await assert.rejects(review(clientFor(plan, {
    developerCapUnavailable: true,
    authorities: { [ADAPTER.toLowerCase()]: address(0xbad) },
  }), plan), { code: "TOKEN_FACTORY_BINDING" });
});

test("missing optional policy admits the exact approval/launch sequence without certifying unknown caps", async () => {
  const plan = makePlan(), client = clientFor(plan, { allowance: 0n });
  const planned = await review(client, plan);
  assert.equal(planned.simulation.admitted, true, planned.simulation.reason);
  assert.equal(planned.simulation.executionProof, "proved"); assert.equal(planned.simulation.protocolFit, "proved"); assert.equal(planned.simulation.transportPreflight, "not-requested");
  assert.deepEqual(planned.transactions.map((tx) => tx.kind), ["approve", "atomic"]);
  assert.equal(planned.transactions[1].estimate.gasLimit, 1_150_000n);
  assert.equal(planned.transactions[1].estimate.dataFeeIncludedInGas, false);
  assert.equal(planned.transactions[1].estimate.totalFee, undefined);
  const next = await buildNextTransaction({ client, planned });
  assert.equal(next.kind, "approve"); assert.equal(next.admission.blockHash, HASH); assert.equal(next.admission.transportPreflight, "not-requested");
});

test("continuing build-next owns one fresh progress snapshot and never reuses completed review authority", async () => {
  const plan = makePlan({ chainId: 4663n }), source = clientFor(plan, { allowance: 0n });
  const planned = await review(source, plan);
  assert.equal(planned.simulation.admitted, true, planned.simulation.reason);
  const client = { supportsReadBatching: true, request: (args) => source.request(args) };
  for (const { allowance, gasPrice, kind } of [
    { allowance: 0n, gasPrice: 3n, kind: "approve" },
    { allowance: 10n, gasPrice: 7n, kind: "atomic" },
  ]) {
    source.state.allowance = allowance;
    source.state.gasPrice = gasPrice;
    source.captured.length = 0;
    const next = await buildNextTransaction({ client, planned });
    assert.equal(next.kind, kind);
    assert.equal(next.gasPrice, gasPrice, "Each build obtains fresh fees, not the completed review's envelope");
    const coreReads = source.captured.filter((row) => row.method === "eth_call" && row.params[0].to === CORE)
      .map((row) => decodeFunctionData({ abi: launchLifecycleAbi, data: row.params[0].data }).functionName);
    assert.equal(coreReads.filter((name) => name === "readLaunchProgress").length, 1, "The same private invocation must not reread canonical progress");
    assert.equal(coreReads.filter((name) => name === "predictToken").length, 1, "Only the exact same pinned prediction is shared internally");
    assert.equal(source.captured.filter((row) => row.method === "eth_getBlockByNumber" && row.params[0] === "latest").length, 1);
    assert.equal(source.captured.filter((row) => row.method === "eth_getTransactionCount").length, 2, "Confirmed and pending nonce remain real fresh observations");
    assert.equal(capabilityRequests(source).length, 1);
    assert.deepEqual(economicRequests(source).map((row) => row.params[0].validation), [false, true], "Every build measures and replays its complete sequence");
  }
});

test("build-next ignores caller progress and keeps nonce and receipt gates before economic planning", async () => {
  const plan = makePlan(), planned = await review(clientFor(plan), plan);
  const callerProgress = { ...planned.progress, confirmationSafe: true, receipts: [], pendingAccountNonce: 0n };
  for (const gate of ["nonce", "receipt"]) {
    const source = clientFor(plan);
    const client = { supportsReadBatching: true, request(args) {
      if (gate === "nonce" && args.method === "eth_getTransactionCount" && args.params[1] === "pending") return Promise.resolve("0x1");
      if (["eth_getTransactionReceipt", "eth_getTransactionByHash"].includes(args.method)) return Promise.resolve(null);
      return source.request(args);
    } };
    const receipts = gate === "receipt" ? [{ transactionHash: FOREIGN_HASH }] : [];
    await assert.rejects(buildNextTransaction({ client, planned: { ...planned, progress: callerProgress }, receipts }),
      { code: gate === "nonce" ? "UNCONFIRMED_STATE" : "RECEIPT_PENDING" });
    assert.equal(economicRequests(source).length, 0);
    assert.equal(source.captured.some((row) => row.method === "eth_call" && row.params[0].to === REGISTRY), false, "An unsafe canonical snapshot cannot start profile admission");
  }
});

test("private continuing build-next preserves stored commitment and deployment bindings", async () => {
  const plan = makePlan(), planned = await review(clientFor(plan), plan);
  for (const { change, code } of [
    { change: { planHash: FOREIGN_HASH }, code: "PLAN_MUTATED" },
    { change: { launchId: FOREIGN_HASH }, code: "PLAN_MUTATED" },
    { change: { predictedToken: address(1) }, code: "TOKEN_IDENTITY" },
    { change: { account: address(1) }, code: "ACCOUNT_MISMATCH" },
    { change: { tokenFactory: address(1) }, code: "TOKEN_FACTORY_BINDING" },
    { change: { tokenFactoryCodeHash: FOREIGN_HASH }, code: "TOKEN_FACTORY_BINDING" },
    { change: { hookDeployments: [{ marketIndex: 0, deployer: ADAPTER, initCodeHash: DIGEST, salt: HASH, predictedHook: address(1) }] }, code: "HOOK_DEPLOYMENT_CHANGED" },
  ]) {
    const source = clientFor(plan), submissionClient = submissionFor(plan);
    await assert.rejects(buildNextTransaction({ client: source, planned: { ...planned, ...change }, submissionClient }), { code });
    assert.equal(submissionClient.captured.length, 0, "Changed stored authority cannot even reach submission preflight");
  }
  for (const { settings, code } of [
    { settings: { reorg: true }, code: "STATE_REORGED" },
    { settings: { sourceChainDrift: true }, code: "CHAIN_MISMATCH" },
  ]) {
    const submissionClient = submissionFor(plan);
    await assert.rejects(buildNextTransaction({ client: clientFor(plan, settings), planned, submissionClient }), { code });
    assert.equal(submissionClient.captured.length, 0, "The complete new economic proof retains its final canonical guards");
  }
});

test("supplied caps only tighten and missing provenance is not a mandatory backend dependency", async () => {
  const plan = makePlan();
  const tightened = await review(clientFor(plan), plan, { limits: { rpcGasLimit: 1_100_000n } });
  assert.equal(tightened.simulation.admitted, false); assert.equal(tightened.simulation.protocolFit, "failed");
  const calldata = await review(clientFor(plan), plan, { limits: { maxCalldataBytes: 4 } });
  assert.equal(calldata.simulation.admitted, false); assert.match(calldata.simulation.reason, /calldata/);
  const known = await review(clientFor(plan), plan, { limits: { chainGasLimit: 2_000_000n, accountGasLimit: 2_000_000n, headroomBps: 0 } });
  assert.equal(known.simulation.admitted, true); assert.equal(known.transactions[0].gas, 1_000_000n);
});

test("malformed supplied policy and supplied context failures never become unknown optional policy", async () => {
  const plan = makePlan();
  for (const limits of [null, [], () => null, () => undefined, { rpcGasLimit: 16000000 }, { chainGasLimit: -1n }, { accountGasLimit: 1n << 64n }, { maxSimulationGas: "1" }, { maxCalldataBytes: 1.5 }, { headroomBps: true }, { headroomBps: null }, { headroomBps: 10001 }]) {
    await assert.rejects(review(clientFor(plan), plan, { limits }), { code: "INVALID_LIMITS" });
  }
  await assert.rejects(review(clientFor(plan), plan, { limits: async () => { throw new Error("Policy backend unavailable"); } }), { code: "LIMIT_SOURCE_FAILED" });
  for (const limits of [{ chainId: 1n }, { account: address(1) }, { orchestrator: address(1) }, { observedBlockNumber: 41n }, { observedBlockHash: FOREIGN_HASH }, { observedBlockHash: "0x" }]) {
    await assert.rejects(review(clientFor(plan), plan, { limits }), { code: "LIMIT_CONTEXT_MISMATCH" });
  }
  const current = ({ chainId, account, orchestrator, block }) => ({ chainId, account, orchestrator, observedBlockNumber: block.number, observedBlockHash: block.hash });
  assert.equal((await review(clientFor(plan), plan, { limits: current })).simulation.admitted, true);
});



test("prepared simulation refuses refreshed policy provenance and preserves the original source context", async () => {
  const plan = makePlan();
  for (const changed of [{ chainId: 1n }, { account: address(1) }, { orchestrator: address(1) }, { observedBlockNumber: 41n }, { observedBlockHash: FOREIGN_HASH }]) {
    const source = clientFor(plan);
    const client = { supportsReadBatching: true, request(args) {
      if (args.method === "eth_simulateV1") assert.fail("Mismatched policy cannot authorize native or economic execution");
      return source.request(args);
    } };
    let domainPolicy = true;
    const limits = async (context) => {
      assert.equal(context.client, client);
      assert.equal(context.account, ACCOUNT);
      assert.equal(context.orchestrator, CORE);
      assert.equal(context.chainId, plan.chainId);
      assert.equal(context.block.number, 42n);
      assert.equal(context.block.hash, HASH);
      const policy = domainPolicy ? {} : changed;
      domainPolicy = false;
      return policy;
    };
    await assert.rejects(review(client, plan, { limits }), { code: "LIMIT_CONTEXT_MISMATCH" });
  }
});

test("batch-prepared context retains smart-account refusal and final chain/reorg protection", async () => {
  for (const chainId of [31337n, 4663n]) {
    const plan = makePlan({ chainId });
    for (const [settings, code] of [[{ sourceChainDrift: true }, "CHAIN_MISMATCH"], [{ reorg: true }, "STATE_REORGED"]]) {
      const client = clientFor(plan, settings);
      client.supportsReadBatching = true;
      await assert.rejects(review(client, plan), { code });
    }
    const client = clientFor(plan, { accountCode: CODE });
    client.supportsReadBatching = true;
    const planned = await review(client, plan);
    assert.equal(planned.simulation.admitted, false);
    assert.equal(planned.simulation.confidence, "provisional");
    assert.equal(planned.simulation.executionProof, "unavailable");
    assert.match(planned.simulation.reason, /smart-account/);
  }
});

test("prepared native continuation reuses only positive capability while proving every whole candidate", async () => {
  for (const supportsReadBatching of [false, true]) {
    const plan = makePlan({ chainId: 4663n }), source = clientFor(plan);
    source.supportsReadBatching = supportsReadBatching;
    const planned = await review(source, plan);
    source.captured.length = 0;
    await withLifecycleReadClient(source, async (client) => {
      const block = await readLifecycleBlock(client), prepared = prepareLaunchSimulation({ client, planned }, block);
      try {
        source.state.probeFailure = true;
        const unavailable = await prepared(planned.transactions);
        assert.equal(unavailable.executionProof, "unavailable");
        assert.equal(capabilityRequests(source).length, 1);
        assert.equal(economicRequests(source).length, 0);
        source.state.probeFailure = false;
        assert.equal((await prepared(planned.transactions)).admitted, true);
        assert.equal((await prepared(planned.transactions)).admitted, true);
        assert.equal(capabilityRequests(source).length, 2, "A failed probe is not cached; the one positive proof is then reused");
        assert.equal(economicRequests(source).length, 4, "Both eligible candidates retain complete measurement and exact replay");
        assert.equal(source.captured.filter((row) => row.method === "eth_gasPrice").length, 1);
        assert.equal(source.captured.filter((row) => row.method === "eth_getCode" && row.params[0] === ACCOUNT).length, 1);
        assert.equal(source.captured.filter((row) => row.method === "eth_getBlockByNumber" && row.params[0] === "0x2a").length, 3,
          "Unavailable and both eligible candidates retain their own end guards");
      } finally { prepared.close(); }
    });
  }
});

test("prepared continuation refuses every source, account, plan, pin, header, policy and fork mutation", async () => {
  const changes = [
    ["client", ({ options, plan }) => { options.client = clientFor(plan); }],
    ["source request", ({ source }) => { const request = source.request; source.request = (args) => request(args); }],
    ["source batching", ({ source }) => { source.supportsReadBatching = !source.supportsReadBatching; }],
    ["planned object", ({ options }) => { options.planned = { ...options.planned }; }],
    ["plan object", ({ planned }) => { planned.plan = { ...planned.plan }; }],
    ["account", ({ planned }) => { planned.account = address(1); }],
    ["core", ({ plan }) => { plan.orchestrator = address(1); }],
    ["chain", ({ planned }) => { planned.chainId += 1n; }],
    ["plan hash", ({ planned }) => { planned.planHash = FOREIGN_HASH; }],
    ["launch identity", ({ planned }) => { planned.launchId = FOREIGN_HASH; }],
    ["predicted token", ({ planned }) => { planned.predictedToken = address(1); }],
    ["economics", ({ plan }) => { plan.buys[0].minTokenOut += 1n; }, "PLAN_MUTATED"],
    ["block number", ({ block }) => { block.number += 1n; }],
    ["block hash", ({ block }) => { block.hash = FOREIGN_HASH; }],
    ["child timestamp", ({ block }) => { block.timestamp += 1n; }],
    ["header gas", ({ block }) => { block.gasLimit += 1n; }],
    ["fee assumptions", ({ block }) => { block.baseFeePerGas += 1n; }],
    ["policy source", ({ options }) => { options.limits = {}; }],
    ["stored policy", ({ planned }) => { planned.limits = {}; }],
    ["returned policy", ({ policy }) => { policy.headroomBps = 1000; }],
    ["fork identity", ({ options }) => { options.fork = { ...options.fork }; }],
    ["fork context", ({ fork }) => { fork.expectedChainId = 1n; }],
    ["fork client request", ({ fork }) => { fork.client.request = () => assert.fail("Changed fork cannot execute"); }],
  ];
  for (const [name, mutate, code = "LIMIT_CONTEXT_MISMATCH"] of changes) {
    const plan = makePlan({ chainId: 4663n }), source = clientFor(plan);
    source.supportsReadBatching = true;
    const planned = await review(source, plan);
    source.captured.length = 0;
    await withLifecycleReadClient(source, async (client) => {
      const block = await readLifecycleBlock(client), policy = {};
      const fork = { client: { request() { assert.fail("Native proof cannot use a generic fork"); } } };
      const options = { client, planned, fork, limits: async (context) => {
        assert.equal(context.client, source);
        return policy;
      } };
      const prepared = prepareLaunchSimulation(options, block);
      try {
        assert.equal((await prepared(planned.transactions)).admitted, true, name);
        const observed = source.captured.length;
        mutate({ options, source, plan, planned, block, policy, fork });
        await assert.rejects(prepared(planned.transactions), { code }, name);
        assert.equal(source.captured.length, observed, `${name} mutation cannot dispatch another proof`);
        await assert.rejects(prepared(planned.transactions), { code: "INVALID_SIMULATION" }, "Mutation permanently invalidates this continuation");
      } finally { prepared.close(); }
    });
  }
});

test("prepared continuation closes with its invocation owner and rejects explicit close or concurrent consumption", async () => {
  const plan = makePlan({ chainId: 4663n }), source = clientFor(plan);
  const planned = await review(source, plan);
  const escaped = await withLifecycleReadClient(source, async (client) => {
    const prepared = prepareLaunchSimulation({ client, planned }, await readLifecycleBlock(client));
    assert.equal((await prepared(planned.transactions)).admitted, true);
    return prepared;
  });
  const observed = source.captured.length;
  await assert.rejects(escaped(planned.transactions), { code: "READ_SCOPE_CLOSED" });
  assert.equal(source.captured.length, observed);
  escaped.close();
  await withLifecycleReadClient(source, async (client) => {
    const prepared = prepareLaunchSimulation({ client, planned }, await readLifecycleBlock(client));
    prepared.close();
    await assert.rejects(prepared(planned.transactions), { code: "INVALID_SIMULATION" });
  });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const client = { supportsReadBatching: true, request(args) { return args.method === "eth_gasPrice" ? gate : source.request(args); } };
  await withLifecycleReadClient(client, async (scoped) => {
    const prepared = prepareLaunchSimulation({ client: scoped, planned }, await readLifecycleBlock(scoped));
    const first = prepared(planned.transactions);
    await assert.rejects(prepared(planned.transactions), { code: "INVALID_SIMULATION" });
    release("0x2");
    await assert.rejects(first, { code: "INVALID_SIMULATION" });
    prepared.close();
  });
});

test("candidate mutation during native measurement refuses without replaying a changed sequence", async () => {
  const plan = makePlan({ chainId: 4663n }), source = clientFor(plan);
  const planned = await review(source, plan);
  source.captured.length = 0;
  let release, entered;
  const gate = new Promise((resolve) => { release = resolve; }), measured = new Promise((resolve) => { entered = resolve; });
  const client = { supportsReadBatching: true, async request(args) {
    const result = await source.request(args);
    if (args.method === "eth_simulateV1" && !args.params[0].validation) { entered(); await gate; }
    return result;
  } };
  await withLifecycleReadClient(client, async (scoped) => {
    const prepared = prepareLaunchSimulation({ client: scoped, planned }, await readLifecycleBlock(scoped));
    try {
      const pending = prepared(planned.transactions);
      await measured;
      planned.transactions[0].value += 1n;
      release();
      await assert.rejects(pending, { code: "INVALID_SIMULATION" });
      assert.equal(economicRequests(source).length, 1, "A changed economic candidate cannot reach validated replay");
    } finally { release(); prepared.close(); }
  });
});

test("matching reused capability never bypasses a later canonical chain or hash end guard", async () => {
  for (const [change, code] of [["sourceChainDrift", "CHAIN_MISMATCH"], ["reorg", "STATE_REORGED"]]) {
    const plan = makePlan({ chainId: 4663n }), source = clientFor(plan);
    const planned = await review(source, plan);
    source.captured.length = 0;
    await withLifecycleReadClient(source, async (client) => {
      const prepared = prepareLaunchSimulation({ client, planned }, await readLifecycleBlock(client));
      try {
        assert.equal((await prepared(planned.transactions)).admitted, true);
        source.state[change] = true;
        await assert.rejects(prepared(planned.transactions), { code });
        assert.equal(capabilityRequests(source).length, 1);
        assert.equal(economicRequests(source).length, 4);
      } finally { prepared.close(); }
    });
  }
});

test("standalone native calls always refresh capability, fees and account code", async () => {
  const plan = makePlan({ chainId: 4663n }), source = clientFor(plan);
  const planned = await review(source, plan);
  source.captured.length = 0;
  const first = await simulateLaunchTransactions({ client: source, planned }, planned.transactions);
  source.state.gasPrice = 7n;
  const second = await simulateLaunchTransactions({ client: source, planned }, planned.transactions);
  assert.equal(first.steps[0].estimate.gasPrice, 2n);
  assert.equal(second.steps[0].estimate.gasPrice, 7n);
  assert.equal(capabilityRequests(source).length, 2);
  assert.equal(economicRequests(source).length, 4);
  source.state.accountCode = CODE;
  const smart = await simulateLaunchTransactions({ client: source, planned }, planned.transactions);
  assert.equal(smart.executionProof, "unavailable");
  assert.match(smart.reason, /smart-account/);
  assert.equal(capabilityRequests(source).length, 2, "A fresh smart-account refusal does not request native execution");
  assert.equal(source.captured.filter((row) => row.method === "eth_getCode" && row.params[0] === ACCOUNT).length, 3);
});

test("policy and pinned getter aborts preserve identity and cannot start native proof", async () => {
  for (const stage of ["policy", "getter"]) {
    const plan = makePlan({ chainId: 4663n }), source = clientFor(plan);
    const planned = await review(source, plan);
    source.captured.length = 0;
    const aborted = Object.assign(new Error("Pinned context cancelled"), { name: "AbortError" });
    const transport = { supportsReadBatching: true, request(args) {
      if (stage === "getter" && args.method === "eth_call" && args.params[0].to === ARB_SYS) return Promise.reject(aborted);
      return source.request(args);
    } };
    await withLifecycleReadClient(transport, async (client) => {
      const limits = stage === "policy" ? async () => { throw aborted; } : undefined;
      const prepared = prepareLaunchSimulation({ client, planned, limits }, await readLifecycleBlock(client));
      try { await assert.rejects(prepared(planned.transactions), (failure) => failure === aborted); }
      finally { prepared.close(); }
    });
    await nextTurn();
    assert.equal(capabilityRequests(source).length, 0);
    assert.equal(economicRequests(source).length, 0);
  }
});

test("policy mutation before pending context settles cannot dispatch native capability or economic work", async () => {
  const plan = makePlan({ chainId: 4663n }), source = clientFor(plan);
  const planned = await review(source, plan);
  source.captured.length = 0;
  const limits = { headroomBps: 1500 };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const transport = { supportsReadBatching: true, request(args) {
    return args.method === "eth_gasPrice" ? gate : source.request(args);
  } };
  await withLifecycleReadClient(transport, async (client) => {
    const prepared = prepareLaunchSimulation({ client, planned, limits }, await readLifecycleBlock(client));
    const pending = prepared(planned.transactions);
    await nextTurn();
    limits.headroomBps = 1000;
    release("0x2");
    try { await assert.rejects(pending, { code: "LIMIT_CONTEXT_MISMATCH" }); }
    finally { prepared.close(); }
  });
  assert.equal(capabilityRequests(source).length, 0);
  assert.equal(economicRequests(source).length, 0);
});

test("combined no-bound preparation performs exactly one fresh genuine planning pass", async () => {
  for (const mode of ["atomic", "staged"]) {
    const plan = makePlan({ chainId: 4663n }), reference = clientFor(plan), combined = clientFor(plan);
    reference.supportsReadBatching = combined.supportsReadBatching = true;
    const expected = await planLaunch({ client: reference, plan, account: ACCOUNT, mode });
    let progressUpdates = 0;
    const actual = await prepareAndPlanLifecycleLaunch({ client: combined, plan, account: ACCOUNT, mode, onProgress() { progressUpdates += 1; } });
    assert.equal(actual.simulation.admitted, true, actual.simulation.reason);
    assert.deepEqual(actual, expected, "No-bound delegation preserves canonical economics, requested mode, progress and exact admission");
    assert.deepEqual(combined.captured, reference.captured, "No mining snapshots, metadata repetitions or additional proofs may precede plain planning");
    assert.equal(progressUpdates, 0, "A plan without bound-hook mining has no mining progress");
    assert.equal(capabilityRequests(combined).length, 1);
    assert.equal(economicRequests(combined).length, 2);
  }
});

test("Nitro huge header never replaces changing pinned compute getters or ArbOS50 detection", async () => {
  const plan = makePlan({ chainId: 4663n });
  const client = clientFor(plan, { computeUsed: 10_000_001n });
  const first = await review(client, plan);
  assert.equal(first.simulation.admitted, true); assert.equal(first.simulation.limits.blockGasLimit, 1n << 50n);
  assert.equal(first.simulation.limits.arbOSVersion, 50n); assert.equal(first.simulation.limits.executionGasCeiling, 32_000_000n);
  assert.equal(first.transactions[0].gas, 11_500_002n);
  client.state.txCompute = 11_000_000n;
  const changed = await simulateLaunchPlan({ client, planned: first });
  assert.equal(changed.admitted, false); assert.equal(changed.limits.executionGasCeiling, 11_000_000n);
  for (const settings of [{ rawVersion: 104n }, { getterFailure: true }, { getterResponse: "0x" }, { versionResponse: toHex(105n, { size: 64 }) }, { txCompute: 0n }, { txCompute: 1n << 64n }]) {
    await assert.rejects(review(clientFor(plan, settings), plan), { code: "NITRO_LIMITS_UNAVAILABLE" });
  }
  const blockBound = await review(clientFor(plan, { blockCompute: 900_000n }), plan);
  assert.equal(blockBound.simulation.admitted, false); assert.equal(blockBound.simulation.limits.executionGasCeiling, 900_000n);
});

test("native Nitro probe must match all pinned values and cannot fund real execution", async () => {
  const plan = makePlan({ chainId: 4663n });
  for (const settings of [{ probeMismatch: 0 }, { probeMismatch: 1 }, { probeMismatch: 2 }, { probeResponse: "0x" }, { probeFailure: true }, { simulationUnavailable: true }]) {
    const client = clientFor(plan, settings);
    const planned = await review(client, plan, { fork: { client: { request() { assert.fail("Generic Nitro fork must not receive writes"); } } } });
    assert.equal(planned.simulation.admitted, false); assert.equal(planned.simulation.executionProof, "unavailable"); assert.equal(planned.simulation.protocolFit, "unknown");
    assert.match(planned.simulation.reason, /Nitro|ArbOS/);
  }
  const poor = await review(clientFor(plan, { balance: 1n }), plan);
  assert.equal(poor.simulation.admitted, false); assert.match(poor.simulation.reason, /balance/);
});

test("Nitro economic dispatch waits for successful capability and every poster prerequisite", async () => {
  const plan = makePlan({ chainId: 4663n, nativeFunding: true });
  const source = clientFor(plan, { poster: 200_000n });
  let releaseProbe, releasePoster;
  const probeGate = new Promise((resolve) => { releaseProbe = resolve; });
  const posterGate = new Promise((resolve) => { releasePoster = resolve; });
  const started = new Set();
  const client = { supportsReadBatching: true, async request(args) {
    const response = await source.request(args);
    if (args.method === "eth_simulateV1") {
      const request = args.params[0];
      if (request.blockStateCalls[0].calls[0].to === ARB_SYS) {
        started.add("probe");
        await probeGate;
      } else started.add(request.validation ? "replay" : "measurement");
    } else if (args.method === "eth_call" && args.params[0].to === NODE_INTERFACE) {
      started.add("poster");
      await posterGate;
    }
    return response;
  } };
  const pending = review(client, plan);
  await nextTurn();
  const beforeProbe = new Set(started);
  releaseProbe();
  await nextTurn();
  const measurementBeforePoster = started.has("measurement");
  const replayBeforePoster = started.has("replay");
  releasePoster();
  const planned = await pending;
  assert.deepEqual([...beforeProbe].sort(), ["poster", "probe"]);
  assert.equal(replayBeforePoster, false, "Exact replay needs verified metering and the complete poster budget");
  assert.equal(measurementBeforePoster, false, "Measurement also needs the complete poster envelope before dispatch");
  assert.equal(planned.simulation.admitted, true, planned.simulation.reason);
  assert.equal(started.has("replay"), true);
  const reference = await review(clientFor(plan, { poster: 200_000n }), plan);
  assert.deepEqual(planned, reference, "Scheduling cannot change exact committed calldata, proof outcomes, gas or fee envelopes");
  assert.equal(source.captured.filter((row) => row.method === "eth_simulateV1").length, 3);
  assert.equal(source.captured.filter((row) => row.method === "eth_getBlockByNumber" && row.params[0] === "0x2a").length, 1,
    "The complete native sequence retains its outer canonical recheck, not a redundant probe-only round");
});

test("failed Nitro HTTP, capability, and poster prerequisites never enqueue economic execution", async () => {
  const plan = makePlan({ chainId: 4663n });
  for (const supportsReadBatching of [false, true]) {
    for (const settings of [{ probeFailure: true }, { probeMismatch: 1 }, { probeRevert: true },
      { probeError: Object.assign(new Error("RPC HTTP request failed"), { status: 429 }) },
      { posterResponse: "0x" }, { posterError: Object.assign(new Error("execution reverted"), { code: 3 }) },
      { posterError: Object.assign(new Error("RPC HTTP request failed"), { status: 503 }) }]) {
      const client = clientFor(plan, settings);
      client.supportsReadBatching = supportsReadBatching;
      const planned = await review(client, plan);
      assert.equal(planned.simulation.admitted, false);
      assert.equal(planned.simulation.executionProof, "unavailable");
      assert.match(planned.simulation.reason, /Native Nitro compute\/poster proof unavailable/);
      await nextTurn();
      assert.equal(client.captured.some((row) => row.method === "eth_simulateV1" &&
        row.params[0].blockStateCalls[0].calls[0].to !== ARB_SYS), false, "A failed prerequisite cannot queue even permissive economic work");
      assert.equal(client.captured.some((row) => row.method === "eth_getBlockByNumber" && row.params[0] === "0x2a"), true);
    }
  }
});

test("complete Nitro measurement envelope separates poster budget from the unchanged compute ceiling", async () => {
  const plan = makePlan({ chainId: 4663n, nativeFunding: true });
  const client = clientFor(plan, { computeUsed: 27_000_000n, poster: 6_000_000n, measurementPosterHold: true });
  const planned = await review(client, plan);
  assert.equal(planned.simulation.admitted, true, planned.simulation.reason);
  assert.equal(planned.simulation.limits.executionGasCeiling, 32_000_000n);
  assert.equal(planned.transactions[0].gas, 37_950_000n);
  const [measurement, replay] = economicRequests(client).map((row) => row.params[0]);
  assert.equal(measurement.validation, false);
  assert.equal(BigInt(measurement.blockStateCalls[0].calls[0].gas), 38_900_000n, "Initial discovery allocates fixed32M compute plus buffered6M poster gas");
  assert.equal(replay.validation, true);
  assert.equal(BigInt(replay.blockStateCalls[0].calls[0].gas), planned.transactions[0].gas);
  assert.equal(capabilityRequests(client).length, 1);
  for (const request of [measurement, replay]) {
    assert.equal(request.blockStateCalls[0].stateOverrides, undefined);
    assert.equal(request.blockStateCalls[0].blockOverrides.baseFeePerGas, undefined);
    assert.equal(request.blockStateCalls[0].calls[0].from, ACCOUNT);
    assert.equal(request.blockStateCalls[0].calls[0].value, "0xa");
    assert.equal(request.blockStateCalls[0].calls[0].gasPrice, "0x2");
  }
  const headroom = await review(clientFor(plan, { computeUsed: 28_000_000n, poster: 6_000_000n, measurementPosterHold: true }), plan);
  assert.equal(headroom.simulation.admitted, false);
  assert.equal(headroom.simulation.protocolFit, "failed", "Poster gas cannot raise the independent compute/headroom ceiling");
  const bounded = clientFor(plan, { computeUsed: 27_000_000n, poster: 6_000_000n, measurementPosterHold: true });
  const capped = await review(bounded, plan, { limits: { accountGasLimit: 32_000_000n } });
  assert.equal(capped.simulation.admitted, false);
  assert.equal(BigInt(economicRequests(bounded)[0].params[0].blockStateCalls[0].calls[0].gas), 32_000_000n, "Known total caps tighten the complete envelope");
  assert.equal(economicRequests(bounded).length, 1, "Failed measurement cannot be bypassed by exact replay");
});

test("complete Nitro envelope still enforces aggregate and uint64 caps before economic dispatch", async () => {
  const plan = makePlan({ chainId: 4663n, markets: 2 });
  const aggregate = clientFor(plan, { poster: 2_000_000n });
  const refused = await review(aggregate, plan, { mode: "staged", limits: { maxSimulationGas: 100_000_000n } });
  assert.equal(refused.simulation.admitted, false);
  assert.equal(refused.simulation.confidence, "provisional");
  assert.equal(refused.simulation.executionProof, "unavailable");
  assert.equal(refused.simulation.protocolFit, "unknown");
  assert.equal(refused.simulation.limits.maxSimulationGas, 100_000_000n);
  assert.deepEqual(refused.transactions.map((transaction) => transaction.kind), ["begin", "prepare", "activate"]);
  assert.equal(capabilityRequests(aggregate).length, 1);
  assert.equal(economicRequests(aggregate).length, 0, "Three complete34.3M envelopes cannot fit a100M aggregate request");
  const probeCapped = clientFor(plan);
  const noCapability = await review(probeCapped, plan, { limits: { maxSimulationGas: 299_999n } });
  assert.equal(noCapability.simulation.admitted, false);
  assert.equal(noCapability.simulation.confidence, "provisional");
  assert.equal(noCapability.simulation.executionProof, "unavailable");
  assert.equal(noCapability.simulation.limits.maxSimulationGas, 299_999n);
  assert.equal(capabilityRequests(probeCapped).length, 0);
  assert.equal(economicRequests(probeCapped).length, 0);
  assert.equal(probeCapped.state.posterRequests?.length ?? 0, 0, "A known impossible discovery budget cannot queue parallel poster quotes");
  const overflow = clientFor(plan, { poster: (1n << 64n) - 1n });
  await assert.rejects(review(overflow, plan), { code: "INVALID_GAS_ENVELOPE" });
  assert.equal(economicRequests(overflow).length, 0);
});

test("only a strict known impossible discovery lower bound bypasses native capability and poster work", async () => {
  for (const supportsReadBatching of [false, true]) {
    const plan = makePlan({ chainId: 4663n, markets: 2 });
    for (const [limits, poster, admitted, capability, economic, discoveryGas] of [
      [{ maxSimulationGas: 95_999_999n }, 2_000_000n, false, 0, 0],
      [{ maxSimulationGas: 96_000_000n }, 0n, true, 1, 2, 32_000_000n],
      [{ maxSimulationGas: 96_000_000n }, 2_000_000n, false, 1, 0],
      [{ maxSimulationGas: 59_999_999n, accountGasLimit: 20_000_000n }, 2_000_000n, false, 0, 0],
      [{ maxSimulationGas: 60_000_000n, accountGasLimit: 20_000_000n }, 2_000_000n, true, 1, 2, 20_000_000n],
      [{ maxSimulationGas: 96_000_000n, accountGasLimit: 40_000_000n }, 0n, true, 1, 2, 32_000_000n],
      [{}, 2_000_000n, true, 1, 2, 34_300_000n],
    ]) {
      const client = clientFor(plan, { poster });
      client.supportsReadBatching = supportsReadBatching;
      const planned = await review(client, plan, { mode: "staged", limits });
      assert.equal(planned.simulation.admitted, admitted, planned.simulation.reason);
      assert.equal(capabilityRequests(client).length, capability);
      assert.equal(economicRequests(client).length, economic);
      assert.equal(client.state.posterRequests?.length ?? 0, capability === 0 ? 0 : 3);
      assert.deepEqual(planned.transactions.map((transaction) => transaction.kind), ["begin", "prepare", "activate"]);
      assert.equal(planned.simulation.limits.maxSimulationGas, limits.maxSimulationGas);
      if (!admitted) {
        assert.equal(planned.simulation.confidence, "provisional");
        assert.equal(planned.simulation.executionProof, "unavailable");
        assert.equal(planned.simulation.protocolFit, "unknown");
        assert.equal(planned.simulation.backend, "unavailable");
        assert.deepEqual(planned.simulation.steps, []);
        assert.equal(planned.simulation.failedTransactionId, undefined);
      } else {
        const measurement = economicRequests(client)[0].params[0];
        assert.equal(measurement.validation, false);
        assert.ok(measurement.blockStateCalls.every((block) => BigInt(block.calls[0].gas) === discoveryGas));
        assert.equal(planned.simulation.executionProof, "proved");
        assert.equal(planned.simulation.protocolFit, "proved");
      }
    }
  }
});

test("known impossible discovery still observes context and final canonical chain/hash guards", async () => {
  const plan = makePlan({ chainId: 4663n, markets: 2 }), seed = clientFor(plan);
  const planned = await review(seed, plan, { mode: "staged" });
  const block = await readLifecycleBlock(seed);
  for (const [change, code] of [["chain", "CHAIN_MISMATCH"], ["hash", "STATE_REORGED"], ["policy", "LIMIT_CONTEXT_MISMATCH"]]) {
    const source = clientFor(plan), limits = { maxSimulationGas: 95_999_999n };
    let chains = 0;
    const client = { supportsReadBatching: true, async request(args) {
      const value = await source.request(args);
      if (args.method === "eth_chainId" && ++chains > 1 && change === "chain") return toHex(plan.chainId + 1n);
      if (args.method === "eth_getBlockByNumber" && args.params[0] === "0x2a" && change === "hash") return { ...value, hash: FOREIGN_HASH };
      if (args.method === "eth_gasPrice" && change === "policy") limits.maxSimulationGas = 96_000_000n;
      return value;
    } };
    await assert.rejects(simulateLaunchTransactions({ client, planned, limits }, planned.transactions, block), { code });
    assert.equal(capabilityRequests(source).length, 0);
    assert.equal(economicRequests(source).length, 0);
    assert.equal(source.state.posterRequests?.length ?? 0, 0);
    assert.equal(source.captured.filter((row) => row.method === "eth_gasPrice").length, 1);
    assert.equal(source.captured.filter((row) => row.method === "eth_getCode" && row.params[0] === ACCOUNT).length, 1);
    if (change !== "policy") {
      assert.equal(chains, 2);
      assert.equal(source.captured.filter((row) => row.method === "eth_getBlockByNumber" && row.params[0] === "0x2a").length, 1);
    }
  }
});

test("source and malformed exact-replay failures cannot retry into admission", async () => {
  for (const chainId of [31337n, 4663n]) {
    for (const failure of [Object.assign(new Error("RPC HTTP request failed"), { status: 429 }),
      Object.assign(new Error("RPC HTTP request failed"), { statusCode: 503, code: 3, details: "execution failed" }),
      Object.assign(new Error("out of gas: private HTTP failure"), { status: 503, code: -32015, data: "0x" }),
      Object.assign(new Error("execution failed upstream connection"), { code: -32002 }),
      new Error("Connection reset while reading native proof")]) {
      const plan = makePlan({ chainId }), source = clientFor(plan);
      let failed = false;
      const client = { supportsReadBatching: true, async request(args) {
        if (args.method === "eth_simulateV1" && args.params[0].validation &&
          args.params[0].blockStateCalls[0].calls[0].to !== ARB_SYS && !failed) {
          failed = true;
          source.captured.push(args);
          throw failure;
        }
        return source.request(args);
      } };
      const planned = await review(client, plan);
      assert.equal(planned.simulation.admitted, false);
      assert.equal(planned.simulation.confidence, "provisional");
      assert.equal(planned.simulation.executionProof, "unavailable");
      assert.equal(diagnosticJson(planned.simulation).includes(failure.message), false);
      assert.equal(economicRequests(source).length, 2, "A source failure is not permission for another economic RPC");
    }
    const plan = makePlan({ chainId }), incomplete = clientFor(plan, { incompleteReplay: true });
    const malformed = await review(incomplete, plan);
    assert.equal(malformed.simulation.executionProof, "unavailable");
    assert.equal(economicRequests(incomplete).length, 2);
  }
});

test("native cancellation propagates through capability, poster, measurement, replay and discovery without later economic dispatch", async () => {
  for (const stage of ["capability", "poster", "measurement", "replay", "envelope"]) {
    const plan = makePlan({ chainId: 4663n });
    const source = clientFor(plan, { gasFor: (_name, _args, validation) => validation ? 1_500_000n : 1_000_000n });
    const aborted = Object.assign(new Error("Source read cancelled"), { name: "AbortError" });
    let economic = 0;
    const client = { supportsReadBatching: true, async request(args) {
      let current;
      if (args.method === "eth_call" && args.params[0].to === NODE_INTERFACE) current = "poster";
      if (args.method === "eth_simulateV1") current = args.params[0].blockStateCalls[0].calls[0].to === ARB_SYS ? "capability" :
        ++economic === 1 ? "measurement" : economic === 2 ? "replay" : "envelope";
      if (current === stage) {
        source.captured.push(args);
        throw aborted;
      }
      return source.request(args);
    } };
    await assert.rejects(review(client, plan), (failure) => failure === aborted);
    await nextTurn();
    assert.equal(economic, stage === "capability" || stage === "poster" ? 0 : stage === "measurement" ? 1 : stage === "replay" ? 2 : 3);
  }
});

test("thrown native execution refusal retains unknown failure location and never repeats an identical ceiling", async () => {
  const plan = makePlan({ chainId: 4663n });
  const source = clientFor(plan, { replayThrow: true });
  const unavailableLocation = await review(source, plan);
  assert.equal(unavailableLocation.simulation.admitted, false);
  assert.equal(unavailableLocation.simulation.executionProof, "unavailable");
  assert.equal(unavailableLocation.simulation.confidence, "provisional");
  assert.equal(economicRequests(source).length, 2, "Thrown opaque failure cannot authorize an envelope retry");
  assert.equal(unavailableLocation.simulation.failedTransactionId, undefined, "A thrown native error contains no first failed call evidence");
  const ceiling = clientFor(plan, { computeUsed: 32_000_000n, replayThrow: true });
  const refused = await review(ceiling, plan, { limits: { headroomBps: 0 } });
  assert.equal(refused.simulation.admitted, false);
  assert.equal(refused.simulation.failedTransactionId, undefined);
  assert.equal(economicRequests(ceiling).length, 2, "A failed exact32M replay cannot benefit from another identical32M request");
});

test("failed legal-envelope replay retains its actual prefix, first failure and native selector after returned or thrown buffered refusal", async () => {
  for (const buffered of ["returned", "thrown"]) {
    for (const [functionName, kind, prefixLength, data] of [
      ["beginLaunch", "begin", 1, "0x78ca98e3"],
      ["prepareMarkets", "prepare", 2, { data: encodeErrorResult({ abi: fixedFeePoolHookV1Abi, errorName: "InvalidConfiguration" }) }],
      ["activateLaunch", "activate", 3, "0x"],
    ]) {
      const plan = makePlan({ chainId: 4663n, markets: 4 });
      const finalError = { code: 3, message: `Primary ${kind} replay refusal`, data };
      const source = clientFor(plan, { computeUsed: 400_000n, downstreamFailureData: "0x9a36fd9c",
        failureFor(name, _args, validation, transaction) {
          if (!validation) return undefined;
          const gas = BigInt(transaction.gas);
          if (gas < 32_000_000n) {
            if (buffered === "thrown") throw Object.assign(new Error("out of gas"), { code: -32015, data: "0x" });
            if (name === "prepareMarkets") return { gasUsed: gas, error: { code: -32015, message: "out of gas", data: "0x" } };
          } else if (name === functionName) return { error: finalError };
          return undefined;
        },
      });
      const planned = await review(source, plan, { mode: "staged" });
      assert.equal(planned.simulation.admitted, false);
      assert.equal(planned.simulation.confidence, "stateful");
      assert.equal(planned.simulation.executionProof, "failed");
      assert.equal(planned.simulation.protocolFit, "unknown");
      assert.equal(planned.preparationBatchSize, 4, "A begin/activation root or diagnosed preparation invariant cannot justify another partition");
      assert.deepEqual(planned.simulation.steps.map((step) => step.transactionId), planned.transactions.slice(0, prefixLength).map((transaction) => transaction.id));
      assert.deepEqual(planned.simulation.steps.map((step) => step.success), Array.from({ length: prefixLength }, (_, index) => index < prefixLength - 1));
      const failed = planned.simulation.steps.at(-1);
      assert.equal(planned.transactions[prefixLength - 1].kind, kind);
      assert.equal(planned.simulation.failedTransactionId, failed.transactionId);
      assert.equal(failed.returnData, "0x", "Error-data selectors must not be rewritten as native return bytes");
      assert.equal(failed.nativeErrorCode, 3);
      assert.equal(failed.nativeErrorKind, "execution-reverted");
      assert.equal(failed.nativeErrorDataBytes, kind === "activate" ? 0 : 4);
      assert.equal(diagnosticJson(planned.simulation).includes(finalError.message), false, "Provider messages are not public diagnostics");
      assert.equal(failed.gasUsed, 400_000n);
      assert.equal(failed.gasLimit, 32_000_000n);
      for (const step of planned.simulation.steps) {
        assert.equal(step.estimate.gasLimit, 32_000_000n);
        assert.equal(step.estimate.executionFee, 64_000_000n);
        assert.equal(step.estimate.dataFee, 0n);
        assert.equal(step.estimate.totalFee, 64_000_000n);
      }
      assert.equal(capabilityRequests(source).length, 1);
      const requests = economicRequests(source).map((row) => row.params[0]);
      assert.deepEqual(requests.map((request) => request.validation), [false, true, true]);
      assert.deepEqual(requests.map((request) => request.blockStateCalls.length), [3, 3, 3], "Each replay must submit the original complete economic sequence");
      for (const request of requests) {
        assert.deepEqual(request.blockStateCalls.map((block) => decodeFunctionData({ abi: launchLifecycleAbi, data: block.calls[0].data }).functionName), ["beginLaunch", "prepareMarkets", "activateLaunch"]);
        assert.ok(request.blockStateCalls.every((block) => block.stateOverrides === undefined && block.blockOverrides.baseFeePerGas === undefined));
      }
      if (kind === "activate") assert.match(planned.simulation.reason, /indivisible/);
      else assert.doesNotMatch(planned.simulation.reason, /indivisible/, "Indivisibility must follow the actual first failed transaction, not the previous replay");
      assert.equal(planned.simulation.failureCategory, kind === "activate" ? "opaque" : "semantic");
    }
  }
});

test("a no-results legal-envelope error cannot borrow the buffered preparation failure location", async () => {
  for (const [failure, executionProof, confidence] of [
    [Object.assign(new Error("execution failed at ceiling"), { code: -32000 }), "unavailable", "provisional"],
    [Object.assign(new Error("execution reverted at ceiling"), { code: 3 }), "unavailable", "provisional"],
    [Object.assign(new Error("Native source request failed"), { status: 429 }), "unavailable", "provisional"],
    [Object.assign(new Error("Native RPC returned no results"), { code: -38013 }), "unavailable", "provisional"],
  ]) {
    const plan = makePlan({ chainId: 4663n, markets: 4 });
    const source = clientFor(plan, { computeUsed: 400_000n,
      failureFor(name, _args, validation, transaction) {
        if (!validation) return undefined;
        const gas = BigInt(transaction.gas);
        if (gas === 32_000_000n) throw failure;
        if (name === "prepareMarkets") return { gasUsed: gas, error: { code: -32015, message: "out of gas", data: "0x" } };
        return undefined;
      },
    });
    const planned = await review(source, plan, { mode: "staged" });
    assert.equal(planned.simulation.admitted, false);
    assert.equal(planned.simulation.executionProof, executionProof);
    assert.equal(planned.simulation.confidence, confidence);
    assert.equal(planned.simulation.failedTransactionId, undefined);
    assert.ok(planned.simulation.steps.every((step) => step.success && step.estimate === undefined));
    assert.equal(planned.simulation.limits.maxSimulationGas, undefined, "A provider error does not establish an aggregate gas ceiling");
    assert.equal(planned.preparationBatchSize, 4);
    assert.equal(economicRequests(source).length, 3, "No returned failure location exists to authorize more schedule discovery");
    assert.equal(capabilityRequests(source).length, 1);
  }
});

test("nonzero Nitro poster envelope may exceed compute cutoff and affordability never double-charges", async () => {
  const plan = makePlan({ chainId: 4663n, nativeFunding: true });
  // ceil(27M*1.15)+ceil(2M*1.15)=33.35M, above the actual32M compute cap.
  const gas = 33_350_000n, balance = gas * 2n + 10n;
  const client = clientFor(plan, { computeUsed: 27_000_000n, poster: 2_000_000n, actualPoster: 1_900_000n, balance });
  const planned = await review(client, plan);
  assert.equal(planned.simulation.admitted, true, planned.simulation.reason);
  const tx = planned.transactions[0];
  assert.equal(tx.gas, gas); assert.ok(tx.gas > planned.simulation.limits.executionGasCeiling);
  assert.equal(tx.estimate.posterGas, 2_300_000n); assert.equal(tx.estimate.posterFee, 4_600_000n);
  assert.equal(tx.estimate.dataFeeIncludedInGas, true); assert.equal(tx.estimate.dataFee, 0n); assert.equal(tx.estimate.totalFee, gas * 2n);
  assert.ok(client.state.posterRequests.every(({ request, args }) => request.from === ACCOUNT && args[0].toLowerCase() === CORE && args[2] === tx.data && request.value === "0xa"));
  const next = await buildNextTransaction({ client, planned }); assert.equal(next.gas, gas);
  const poor = await review(clientFor(plan, { computeUsed: 27_000_000n, poster: 2_000_000n, balance: balance - 1n }), plan);
  assert.equal(poor.simulation.admitted, false); assert.equal(poor.simulation.executionProof, "proved"); assert.equal(poor.simulation.protocolFit, "proved");
  const capped = await review(clientFor(plan, { computeUsed: 27_000_000n, poster: 2_000_000n }), plan, { limits: { accountGasLimit: 33_000_000n } });
  assert.equal(capped.simulation.admitted, false); assert.equal(capped.simulation.protocolFit, "failed");
  await assert.rejects(review(clientFor(plan), plan, { limits: { estimateDataFee: async () => 1n } }), { code: "INVALID_LIMITS" });
});

test("poster quote is not exact compute proof and malformed poster observations fail closed", async () => {
  const plan = makePlan({ chainId: 4663n });
  for (const settings of [{ posterResponse: "0x" }, { posterResponse: toHex(0n, { size: 96 }) }]) {
    const planned = await review(clientFor(plan, settings), plan);
    assert.equal(planned.simulation.admitted, false); assert.equal(planned.simulation.protocolFit, "unknown");
  }
  const failed = await review(clientFor(plan, { poster: 100_000_000n, replayThrow: true }), plan);
  assert.equal(failed.simulation.admitted, false); assert.equal(failed.simulation.executionProof, "unavailable");
  assert.equal(failed.simulation.failureCategory, "opaque");
});

test("exact replay, postconditions, canonical block and account protections remain mandatory", async () => {
  const plan = makePlan();
  for (const settings of [{ replayThrow: true }, { replayFail: true }, { incompleteReplay: true }, { badOutput: true }]) {
    const planned = await review(clientFor(plan, settings), plan);
    assert.equal(planned.simulation.admitted, false);
    assert.equal(planned.simulation.executionProof, settings.incompleteReplay || settings.replayThrow ? "unavailable" : "failed");
    await assert.rejects(buildNextTransaction({ client: clientFor(plan, settings), planned }), { code: "PLAN_NOT_ADMITTED" });
  }
  await assert.rejects(review(clientFor(plan, { reorg: true }), plan), { code: "STATE_REORGED" });
  for (const chainId of [31337n, 4663n]) {
    const boundPlan = makePlan({ chainId });
    await assert.rejects(review(clientFor(boundPlan, { sourceChainDrift: true }), boundPlan), { code: "CHAIN_MISMATCH" });
  }
  const smart = await review(clientFor(plan, { accountCode: CODE }), plan);
  assert.equal(smart.simulation.admitted, false); assert.equal(smart.simulation.executionProof, "unavailable"); assert.match(smart.simulation.reason, /smart-account/);
  const dataFee = async () => 5n;
  const gasFee = 1_150_000n * 2n;
  assert.equal((await review(clientFor(plan, { balance: gasFee + 5n }), plan, { limits: { estimateDataFee: dataFee } })).simulation.admitted, true);
  assert.equal((await review(clientFor(plan, { balance: gasFee + 4n }), plan, { limits: { estimateDataFee: dataFee } })).simulation.admitted, false);
  await assert.rejects(review(clientFor(plan), plan, { limits: { estimateDataFee: async () => "5" } }), { code: "INVALID_DATA_FEE" });
});

function submissionFor(plan, { chain = plan.chainId, estimate = 1_000_000n, failure, drift = false } = {}) {
  const captured = [];
  return { captured, async request({ method, params = [] }) {
    captured.push({ method, params });
    if (method === "eth_chainId") return toHex(drift && captured.length > 1 ? 1n : chain);
    assert.equal(method, "eth_estimateGas", "Submission transport only receives read-only exact immediate estimation");
    if (failure) throw new Error("Wallet RPC rejects exact gas envelope");
    return typeof estimate === "bigint" ? toHex(estimate) : estimate;
  } };
}
test("reviewed native envelope survives the observed upward advisory drift at exact affordable gas and price", async () => {
  const plan = makePlan({ chainId: 4663n, nativeFunding: true });
  plan.funding[0].amount = plan.funding[0].inputAmount = 100_000_000_000_000n;
  plan.buys[0].quoteAmountIn = 100_000_000_000_000n;
  const client = clientFor(plan, { computeUsed: 20_846_324n, gasPrice: 40_040_000n, baseFeePerGas: 20_020_000n });
  const planned = await review(client, plan);
  const reviewedTransaction = await buildNextTransaction({ client, planned });
  assert.equal(reviewedTransaction.gas, 23_973_273n);
  assert.equal(reviewedTransaction.gasPrice, 40_040_000n);
  assert.equal(reviewedTransaction.value, 100_000_000_000_000n);
  client.state.gasPrice = 40_180_000n;
  client.state.baseFeePerGas = 20_090_000n;
  client.state.childBaseFee = 20_091_000n;
  client.state.balance = reviewedTransaction.value + 23_973_273n * 40_040_000n;
  client.captured.length = 0;
  const submissionClient = submissionFor(plan, { estimate: 20_846_324n });
  const next = await buildNextTransaction({ client, planned, reviewedTransaction, submissionClient });
  assert.equal(next.gas, 23_973_273n);
  assert.equal(next.gasPrice, 40_040_000n, "Neither a fresh recommendation nor twice the fresh base fee replaces the reviewed price");
  assert.equal(next.estimate.executionFee, 23_973_273n * 40_040_000n);
  assert.equal(next.admission.admitted, true);
  assert.equal(next.admission.executionProof, "proved");
  assert.equal(next.admission.protocolFit, "proved");
  assert.equal(next.admission.transportPreflight, "passed");
  assert.equal(next.admission.blockHash, HASH);
  const economic = economicRequests(client).map((row) => row.params[0]);
  assert.deepEqual(economic.map((request) => request.validation), [false, true]);
  assert.equal(BigInt(economic[1].blockStateCalls[0].calls[0].gas), 23_973_273n);
  for (const request of economic) for (const block of request.blockStateCalls) {
    assert.equal(BigInt(block.calls[0].gasPrice), 40_040_000n);
    assert.equal(block.blockOverrides.baseFeePerGas, undefined);
    assert.equal(block.stateOverrides, undefined);
  }
  assert.equal(capabilityRequests(client).length, 1);
  assert.equal(client.captured.filter((row) => row.method === "eth_gasPrice").length, 1);
  assert.equal(client.captured.filter((row) => row.method === "eth_getBalance").length, 1);
  assert.deepEqual(submissionClient.captured[1].params, [{ from: ACCOUNT, to: CORE, data: reviewedTransaction.data,
    value: toHex(100_000_000_000_000n), gas: toHex(23_973_273n), gasPrice: toHex(40_040_000n) }, "latest"]);
  await assert.rejects(buildNextTransaction({ client, planned, submissionClient: submissionFor(plan) }), { code: "PLAN_NOT_ADMITTED" },
    "An ordinary new envelope at the larger recommendation is not affordable at the held exact balance");
});

test("reviewed atomic, approval, staged preparation, activation and cancellation all retain fresh complete proof", async () => {
  const vectors = [
    { mode: "atomic", settings: {}, kind: "atomic", sequence: ["launchAtomic"] },
    { mode: "atomic", settings: { allowance: 0n }, kind: "approve", sequence: ["approve", "launchAtomic"] },
    { mode: "staged", settings: { allowance: 1n }, kind: "approve-reset", sequence: ["approve", "approve", "beginLaunch", "prepareMarkets", "activateLaunch"] },
    { mode: "staged", settings: {}, kind: "begin", sequence: ["beginLaunch", "prepareMarkets", "activateLaunch"] },
    { mode: "staged", settings: { phase: LifecyclePhase.Preparing }, kind: "prepare", sequence: ["prepareMarkets", "activateLaunch"] },
    { mode: "staged", settings: { phase: LifecyclePhase.Preparing, prepared: 1 }, markets: 2, kind: "prepare", sequence: ["prepareMarkets", "activateLaunch"] },
    { mode: "staged", settings: { phase: LifecyclePhase.Ready, prepared: 2 }, markets: 2, kind: "activate", sequence: ["activateLaunch"] },
    { mode: "staged", settings: { phase: LifecyclePhase.Preparing }, action: "cancel", kind: "cancel", sequence: ["cancelLaunch"] },
    { mode: "staged", settings: { phase: LifecyclePhase.Ready, prepared: 2 }, markets: 2, action: "cancel", kind: "cancel", sequence: ["cancelLaunch"] },
  ];
  for (const chainId of [31337n, 4663n]) for (const vector of vectors) {
    const plan = makePlan({ chainId, markets: vector.markets ?? 1 });
    const client = clientFor(plan, { poster: chainId === 4663n ? 200_000n : 0n, ...vector.settings });
    const planned = await review(client, plan, { mode: vector.mode });
    const reviewedTransaction = await buildNextTransaction({ client, planned, action: vector.action });
    client.state.gasPrice = 3n;
    client.captured.length = 0;
    const submissionClient = submissionFor(plan);
    const next = await buildNextTransaction({ client, planned, reviewedTransaction, action: vector.action, submissionClient });
    assert.equal(next.kind, vector.kind);
    assert.equal(next.gas, reviewedTransaction.gas);
    assert.equal(next.gasPrice, 2n);
    assert.equal(next.data, reviewedTransaction.data);
    assert.equal(next.value, reviewedTransaction.value);
    assert.equal(next.estimate.gasLimit, reviewedTransaction.gas);
    assert.equal(next.estimate.gasPrice, 2n);
    assert.equal(next.admission.transportPreflight, "passed");
    const replay = economicRequests(client).find((row) => row.params[0].validation).params[0];
    assert.deepEqual(replay.blockStateCalls.map((block) => decodeFunctionData({
      abi: block.calls[0].to === CORE ? launchLifecycleAbi : lifecycleErc20Abi, data: block.calls[0].data,
    }).functionName), vector.sequence);
    assert.equal(BigInt(replay.blockStateCalls[0].calls[0].gas), reviewedTransaction.gas);
    assert.ok(replay.blockStateCalls.every((block) => BigInt(block.calls[0].gasPrice) === 2n &&
      block.stateOverrides === undefined && block.blockOverrides.baseFeePerGas === undefined));
    if (vector.action === "cancel") assert.equal(client.captured.some((row) => row.method === "eth_call" && row.params[0].to === REGISTRY), false);
  }
});

test("reviewed semantic mutation and stale approval or staged step cannot select executable calldata", async () => {
  const plan = makePlan({ chainId: 4663n }), planned = await review(clientFor(plan), plan);
  const reviewedTransaction = planned.transactions[0];
  const changedData = encodeFunctionData({ abi: launchLifecycleAbi, functionName: "launchAtomic",
    args: [{ ...plan, buys: [{ ...plan.buys[0], minTokenOut: 6n }] }] });
  assert.equal(decodeFunctionData({ abi: launchLifecycleAbi, data: changedData }).args[0].buys[0].minTokenOut, 6n);
  assert.notEqual(changedData, reviewedTransaction.data, "A changed minimum output must change the actual committed calldata");
  for (const mutation of [
    { id: "begin" }, { kind: "begin" }, { chainId: 1 }, { from: address(1) }, { to: address(1) },
    { data: changedData }, { value: 1n },
  ]) {
    const source = clientFor(plan), submissionClient = submissionFor(plan);
    await assert.rejects(buildNextTransaction({ client: source, planned, reviewedTransaction: { ...reviewedTransaction, ...mutation }, submissionClient }),
      { code: "REVIEWED_TRANSACTION_MISMATCH" }, `Changed reviewed ${Object.keys(mutation)[0]} must refuse before economic proof`);
    assert.equal(economicRequests(source).length, 0, "Mismatched semantics cannot be consumed by native economic proof");
    assert.equal(submissionClient.captured.length, 0);
  }
  const approvalSource = clientFor(plan, { allowance: 0n });
  const approving = await review(approvalSource, plan);
  approvalSource.state.allowance = 10n;
  await assert.rejects(buildNextTransaction({ client: approvalSource, planned: approving, reviewedTransaction: approving.transactions[0] }),
    { code: "REVIEWED_TRANSACTION_MISMATCH" });
  const staged = await review(clientFor(plan), plan, { mode: "staged" });
  await assert.rejects(buildNextTransaction({ client: clientFor(plan, { phase: LifecyclePhase.Preparing }), planned: staged,
    reviewedTransaction: staged.transactions[0] }), { code: "REVIEWED_TRANSACTION_MISMATCH" });
});

test("reviewed malformed values and fees refuse before source or submission RPC work", async () => {
  const plan = makePlan(), planned = await review(clientFor(plan), plan);
  const valid = planned.transactions[0];
  for (const reviewedTransaction of [
    null, [], { ...valid, id: 1 }, { ...valid, kind: "unknown" }, { ...valid, chainId: 1.5 },
    { ...valid, from: "0x" }, { ...valid, to: zeroHash }, { ...valid, data: "0x0" },
    { ...valid, value: "0" }, { ...valid, value: -1n }, { ...valid, value: 1n << 256n },
    { ...valid, gas: undefined }, { ...valid, gas: 1_150_000 }, { ...valid, gas: 0n }, { ...valid, gas: -1n }, { ...valid, gas: 1n << 64n },
    { ...valid, gasPrice: undefined }, { ...valid, gasPrice: "2" }, { ...valid, gasPrice: -1n }, { ...valid, gasPrice: 1n << 256n },
  ]) {
    const source = clientFor(plan), submissionClient = submissionFor(plan);
    await assert.rejects(buildNextTransaction({ client: source, planned, reviewedTransaction, submissionClient }), { code: "INVALID_REVIEWED_TRANSACTION" });
    assert.equal(source.captured.length, 0);
    assert.equal(submissionClient.captured.length, 0);
  }
});

test("fresh execution may consume reviewed padding without increasing gas or price", async () => {
  const plan = makePlan({ chainId: 4663n, nativeFunding: true });
  for (const mode of ["atomic", "staged"]) {
    const planned = await review(clientFor(plan, { poster: 200_000n }), plan, { mode });
    const reviewedTransaction = planned.transactions[0];
    for (const vector of [
      { settings: { computeUsed: 1_000_153n } },
      { settings: { poster: 200_001n } },
      { settings: { actualPoster: 210_000n } },
      { settings: {}, limits: { headroomBps: 2000 } },
    ]) {
      const source = clientFor(plan, { poster: 200_000n, ...vector.settings });
      const next = await buildNextTransaction({ client: source, planned, reviewedTransaction,
        limits: vector.limits, submissionClient: submissionFor(plan) });
      assert.equal(next.admission.executionProof, "proved");
      assert.equal(next.admission.protocolFit, "proved");
      assert.equal(next.admission.transportPreflight, "passed");
      assert.equal(next.gas, reviewedTransaction.gas);
      assert.equal(next.gasPrice, reviewedTransaction.gasPrice);
      assert.equal(next.data, reviewedTransaction.data);
      assert.equal(next.value, reviewedTransaction.value);
      assert.ok(next.estimate.gasUsed <= next.gas);
      const replay = economicRequests(source).find((row) => row.params[0].validation);
      assert.equal(BigInt(replay.params[0].blockStateCalls[0].calls[0].gas), reviewedTransaction.gas);
    }
  }
});

test("held envelopes still enforce actual compute, poster, transaction ceilings and real balance", async () => {
  const plan = makePlan({ chainId: 4663n, nativeFunding: true });
  const planned = await review(clientFor(plan, { poster: 200_000n }), plan);
  const reviewedTransaction = planned.transactions[0];
  for (const vector of [
    { settings: {}, limits: { accountGasLimit: reviewedTransaction.gas - 1n }, constraint: "gas-envelope" },
    { settings: { txCompute: 999_999n }, constraint: "compute" },
    { settings: { balance: 2_760_009n }, category: "affordability" },
    { settings: { actualPoster: 380_001n }, category: "capacity", replay: true },
  ]) {
    const source = clientFor(plan, { poster: 200_000n, ...vector.settings }), submissionClient = submissionFor(plan);
    await assert.rejects(buildNextTransaction({ client: source, planned, reviewedTransaction, limits: vector.limits, submissionClient }), (failure) => {
      assert.equal(failure.code, "PLAN_NOT_ADMITTED");
      assert.equal(failure.simulation.admitted, false);
      if (vector.constraint) assert.equal(failure.simulation.capacityConstraint, vector.constraint);
      if (vector.category) assert.equal(failure.simulation.failureCategory, vector.category);
      return true;
    });
    if (vector.replay) {
      const requests = economicRequests(source);
      assert.deepEqual(requests.map((row) => row.params[0].validation), [false, true]);
      assert.equal(BigInt(requests[1].params[0].blockStateCalls[0].calls[0].gas), reviewedTransaction.gas,
        "An exhausted held envelope is never enlarged or retried");
    }
    assert.equal(submissionClient.captured.length, 0);
  }
});

test("below-natural-base held fees and exact native gas exhaustion cannot silently increase a reviewed envelope", async () => {
  const plan = makePlan({ chainId: 4663n }), planned = await review(clientFor(plan), plan);
  const reviewedTransaction = planned.transactions[0];
  for (const settings of [
    { gasPrice: 4n, baseFeePerGas: 3n, childBaseFee: 3n },
    { gasFor: (_name, _args, validation) => validation ? 1_500_000n : 1_000_000n },
  ]) {
    const source = clientFor(plan, settings), submissionClient = submissionFor(plan);
    await assert.rejects(buildNextTransaction({ client: source, planned, reviewedTransaction, submissionClient }), { code: "PLAN_NOT_ADMITTED" });
    const economic = economicRequests(source);
    assert.deepEqual(economic.map((row) => row.params[0].validation), [false, true], "No retry can increase the failed immediate held gas");
    assert.equal(BigInt(economic[1].params[0].blockStateCalls[0].calls[0].gas), reviewedTransaction.gas);
    assert.equal(BigInt(economic[1].params[0].blockStateCalls[0].calls[0].gasPrice), 2n);
    assert.equal(submissionClient.captured.length, 0);
  }
});

test("future native envelope discovery preserves the held immediate gas and exact price through the entire sequence", async () => {
  const plan = makePlan({ chainId: 4663n });
  const planned = await review(clientFor(plan), plan, { mode: "staged" });
  const reviewedTransaction = planned.transactions[0];
  const source = clientFor(plan, { gasPrice: 3n, gasFor: (name, _args, validation) =>
    validation && name === "prepareMarkets" ? 1_500_000n : 1_000_000n });
  const next = await buildNextTransaction({ client: source, planned, reviewedTransaction, submissionClient: submissionFor(plan) });
  assert.equal(next.gas, 1_150_000n);
  assert.equal(next.gasPrice, 2n);
  const replays = economicRequests(source).filter((row) => row.params[0].validation);
  assert.equal(replays.length, 2);
  for (const replay of replays) {
    const blocks = replay.params[0].blockStateCalls;
    assert.equal(blocks.length, 3);
    assert.equal(BigInt(blocks[0].calls[0].gas), 1_150_000n);
    assert.ok(blocks.every((block) => BigInt(block.calls[0].gasPrice) === 2n));
  }
  assert.equal(BigInt(replays[1].params[0].blockStateCalls[1].calls[0].gas), 32_000_000n);
});

test("reviewed input never imports cached proofs or skips source, nonce, receipt, account or reorg guards", async () => {
  const plan = makePlan({ chainId: 4663n }), planned = await review(clientFor(plan), plan);
  const reviewedTransaction = { ...planned.transactions[0], dependencies: ["fake"], postconditions: [],
    admission: { ...planned.transactions[0].admission, admitted: true }, estimate: { gasLimit: 1n, gasPrice: 99n } };
  const clean = await buildNextTransaction({ client: clientFor(plan), planned, reviewedTransaction });
  assert.deepEqual(clean.postconditions, planned.transactions[0].postconditions);
  assert.equal(clean.estimate.gasPrice, 2n);
  for (const vector of [
    { settings: { failActivation: true }, code: "PLAN_NOT_ADMITTED" },
    { settings: { simulationUnavailable: true }, code: "PLAN_NOT_ADMITTED" },
    { settings: { probeFailure: true }, code: "PLAN_NOT_ADMITTED" },
    { settings: { posterResponse: "0x" }, code: "PLAN_NOT_ADMITTED" },
    { settings: { accountCode: CODE }, code: "PLAN_NOT_ADMITTED" },
    { settings: { reorg: true }, code: "STATE_REORGED" },
    { settings: { sourceChainDrift: true }, code: "CHAIN_MISMATCH" },
  ]) {
    const source = clientFor(plan, vector.settings), submissionClient = submissionFor(plan);
    await assert.rejects(buildNextTransaction({ client: source, planned, reviewedTransaction, submissionClient }), { code: vector.code });
    assert.equal(submissionClient.captured.length, 0);
  }
  for (const gate of ["nonce", "receipt"]) {
    const source = clientFor(plan), submissionClient = submissionFor(plan);
    const client = { request(args) {
      if (gate === "nonce" && args.method === "eth_getTransactionCount" && args.params[1] === "pending") return Promise.resolve("0x1");
      if (["eth_getTransactionReceipt", "eth_getTransactionByHash"].includes(args.method)) return Promise.resolve(null);
      return source.request(args);
    } };
    await assert.rejects(buildNextTransaction({ client, planned, reviewedTransaction, submissionClient,
      receipts: gate === "receipt" ? [{ transactionHash: FOREIGN_HASH }] : [] }), { code: gate === "nonce" ? "UNCONFIRMED_STATE" : "RECEIPT_PENDING" });
    assert.equal(economicRequests(source).length, 0);
    assert.equal(submissionClient.captured.length, 0);
  }
});

test("reviewed exact submission refusal and asynchronous reviewed mutation cannot return a signed-ready transaction", async () => {
  const plan = makePlan({ chainId: 4663n }), planned = await review(clientFor(plan), plan);
  const reviewedTransaction = planned.transactions[0];
  for (const settings of [{ chain: 1n }, { drift: true }, { estimate: reviewedTransaction.gas + 1n }, { estimate: 0n }, { estimate: "0x" }, { failure: true }]) {
    await assert.rejects(buildNextTransaction({ client: clientFor(plan), planned, reviewedTransaction, submissionClient: submissionFor(plan, settings) }),
      { code: "SUBMISSION_PREFLIGHT_FAILED" });
  }
  for (const stage of ["source", "submission"]) {
    const held = { ...reviewedTransaction }, source = clientFor(plan);
    const submission = submissionFor(plan);
    const client = { async request(args) {
      const result = await source.request(args);
      if (stage === "source" && args.method === "eth_simulateV1" && args.params[0].validation &&
        args.params[0].blockStateCalls[0].calls[0].to !== ARB_SYS) held.gasPrice = 3n;
      return result;
    } };
    const submissionClient = { async request(args) {
      const result = await submission.request(args);
      if (stage === "submission" && args.method === "eth_estimateGas") held.value = 1n;
      return result;
    } };
    await assert.rejects(buildNextTransaction({ client, planned, reviewedTransaction: held, submissionClient }), { code: "REVIEWED_TRANSACTION_CHANGED" });
    if (stage === "source") assert.equal(submission.captured.length, 0);
  }
});


test("reviewed preparation is matched to fresh SDK-discovered batching, not stored batch authority", async () => {
  const plan = makePlan({ chainId: 4663n, markets: 4 });
  const source = clientFor(plan, { phase: LifecyclePhase.Preparing,
    gasFor: (name, args) => name === "prepareMarkets" ? BigInt(args[2]) * 18_000_000n : 400_000n });
  const planned = await review(source, plan, { mode: "staged" });
  assert.equal(planned.preparationBatchSize, 1);
  const reviewedTransaction = await buildNextTransaction({ client: source, planned });
  assert.equal(reviewedTransaction.id, "prepare:0:1");
  source.state.gasPrice = 3n;
  source.captured.length = 0;
  const next = await buildNextTransaction({ client: source, planned: { ...planned, preparationBatchSize: 4 },
    reviewedTransaction, submissionClient: submissionFor(plan, { estimate: 18_000_000n }) });
  assert.equal(next.data, reviewedTransaction.data);
  assert.equal(next.gas, 20_700_000n);
  assert.equal(next.gasPrice, 2n);
  const requests = economicRequests(source).map((row) => row.params[0]);
  assert.deepEqual(requests.map((request) => request.blockStateCalls.length), [2, 3, 5, 5]);
  const final = requests.at(-1);
  assert.equal(final.validation, true);
  assert.deepEqual(final.blockStateCalls.map((block) => decodeFunctionData({ abi: launchLifecycleAbi, data: block.calls[0].data }).functionName),
    ["prepareMarkets", "prepareMarkets", "prepareMarkets", "prepareMarkets", "activateLaunch"]);
  assert.equal(BigInt(final.blockStateCalls[0].calls[0].gas), 20_700_000n);
  assert.ok(final.blockStateCalls.every((block) => BigInt(block.calls[0].gasPrice) === 2n));
  source.state.gasFor = () => 400_000n;
  const submissionClient = submissionFor(plan);
  await assert.rejects(buildNextTransaction({ client: source, planned, reviewedTransaction, submissionClient }), { code: "REVIEWED_TRANSACTION_MISMATCH" });
  assert.equal(submissionClient.captured.length, 0, "A changed fresh preparation batch requires a new user review");
});

test("held native source failures, deployment binding changes and post-provider reorg or chain changes stay refusals", async () => {
  const plan = makePlan({ chainId: 4663n }), planned = await review(clientFor(plan), plan);
  const reviewedTransaction = planned.transactions[0];
  for (const [stage, code] of [["quote", "INVALID_RPC_RESPONSE"], ["balance", "INVALID_RPC_RESPONSE"], ["getter", "NITRO_LIMITS_UNAVAILABLE"],
    ["poster", "PLAN_NOT_ADMITTED"], ["measurement", "PLAN_NOT_ADMITTED"], ["replay", "PLAN_NOT_ADMITTED"]]) {
    const source = clientFor(plan), submissionClient = submissionFor(plan);
    const client = { request(args) {
      if (stage === "quote" && args.method === "eth_gasPrice" || stage === "balance" && args.method === "eth_getBalance") return Promise.resolve("0x");
      if (stage === "getter" && args.method === "eth_call" && args.params[0].to === GAS_INFO) return Promise.resolve("0x");
      if (stage === "poster" && args.method === "eth_call" && args.params[0].to === NODE_INTERFACE) return Promise.reject(Object.assign(new Error("Source unavailable"), { status: 503 }));
      if (args.method === "eth_simulateV1" && args.params[0].blockStateCalls[0].calls[0].to !== ARB_SYS &&
        (stage === "measurement" && !args.params[0].validation || stage === "replay" && args.params[0].validation)) {
        return Promise.reject(Object.assign(new Error("Source unavailable"), { status: 429 }));
      }
      return source.request(args);
    } };
    await assert.rejects(buildNextTransaction({ client, planned, reviewedTransaction, submissionClient }), { code });
    assert.equal(submissionClient.captured.length, 0);
  }
  for (const [change, code] of [[{ account: address(1) }, "ACCOUNT_MISMATCH"], [{ tokenFactoryCodeHash: FOREIGN_HASH }, "TOKEN_FACTORY_BINDING"],
    [{ hookDeployments: [{ marketIndex: 0, deployer: ADAPTER, initCodeHash: DIGEST, salt: HASH, predictedHook: address(1) }] }, "HOOK_DEPLOYMENT_CHANGED"]]) {
    const submissionClient = submissionFor(plan);
    await assert.rejects(buildNextTransaction({ client: clientFor(plan), planned: { ...planned, ...change }, reviewedTransaction, submissionClient }), { code });
    assert.equal(submissionClient.captured.length, 0);
  }
  for (const [changed, code] of [["eth_getBlockByNumber", "STATE_REORGED"], ["eth_chainId", "CHAIN_MISMATCH"]]) {
    const source = clientFor(plan), submissionClient = submissionFor(plan);
    const client = { async request(args) {
      const result = await source.request(args);
      if (submissionClient.captured.length === 3 && args.method === changed) return changed === "eth_chainId" ? "0x1" : { ...result, hash: FOREIGN_HASH };
      return result;
    } };
    await assert.rejects(buildNextTransaction({ client, planned, reviewedTransaction, submissionClient }), { code });
    assert.equal(submissionClient.captured.filter((row) => row.method === "eth_estimateGas").length, 1);
  }
});

test("held generic fees use the exact current envelope and full remaining-sequence affordability", async () => {
  const plan = makePlan(), planned = await review(clientFor(plan), plan, { mode: "staged" });
  const reviewedTransaction = planned.transactions[0];
  for (const balance of [6_900_015n, 6_900_014n]) {
    const source = clientFor(plan, { gasPrice: 3n, balance });
    const observed = [];
    const limits = { estimateDataFee: async (transaction, context) => {
      assert.equal(context.client, source);
      assert.equal(context.block.hash, HASH);
      assert.equal(transaction.gasPrice, 2n);
      assert.equal(transaction.gas, 1_150_000n);
      observed.push(transaction.id);
      return 5n;
    } };
    const pending = buildNextTransaction({ client: source, planned, reviewedTransaction, limits });
    if (balance === 6_900_015n) {
      const next = await pending;
      assert.equal(next.estimate.totalFee, 2_300_005n);
      assert.equal(next.gasPrice, 2n);
    } else await assert.rejects(pending, (failure) => {
      assert.equal(failure.code, "PLAN_NOT_ADMITTED");
      assert.equal(failure.simulation.executionProof, "proved");
      assert.equal(failure.simulation.failureCategory, "affordability");
      return true;
    });
    assert.deepEqual(observed, ["begin", "prepare:0:1", "activate"], "The whole unfinished sequence, not just the held first step, must be payable");
  }
});

test("current caller account and chain cannot change during held execution or submission proof", async () => {
  const plan = makePlan({ chainId: 4663n }), original = await review(clientFor(plan), plan);
  const reviewedTransaction = original.transactions[0];
  for (const stage of ["source", "submission"]) for (const [field, value, code] of [
    ["account", address(1), "ACCOUNT_MISMATCH"], ["chainId", 1n, "CHAIN_MISMATCH"],
  ]) {
    const planned = { ...original }, source = clientFor(plan), submission = submissionFor(plan);
    const client = { async request(args) {
      const result = await source.request(args);
      if (stage === "source" && args.method === "eth_simulateV1" && args.params[0].validation &&
        args.params[0].blockStateCalls[0].calls[0].to !== ARB_SYS) planned[field] = value;
      return result;
    } };
    const submissionClient = { async request(args) {
      const result = await submission.request(args);
      if (stage === "submission" && args.method === "eth_estimateGas") planned[field] = value;
      return result;
    } };
    await assert.rejects(buildNextTransaction({ client, planned, reviewedTransaction, submissionClient }), { code });
    if (stage === "source") assert.equal(submission.captured.length, 0);
  }
});

test("submission preflight estimates only exact immediate-next calldata and preserves separate scopes", async () => {
  const plan = makePlan(), client = clientFor(plan, { allowance: 0n });
  const planned = await review(client, plan);
  const submissionClient = submissionFor(plan);
  const next = await buildNextTransaction({ client, planned, submissionClient });
  assert.equal(next.kind, "approve"); assert.equal(next.admission.transportPreflight, "passed");
  assert.equal(planned.simulation.transportPreflight, "not-requested");
  assert.deepEqual(submissionClient.captured.map((row) => row.method), ["eth_chainId", "eth_estimateGas", "eth_chainId"]);
  assert.deepEqual(submissionClient.captured[1].params, [{ from: next.from, to: next.to, data: next.data, value: toHex(next.value), gas: toHex(next.gas), gasPrice: toHex(next.gasPrice) }, "latest"]);
  for (const settings of [{ chain: 1n }, { drift: true }, { estimate: next.gas + 1n }, { estimate: 0n }, { estimate: "0x" }, { failure: true }]) {
    await assert.rejects(buildNextTransaction({ client, planned, submissionClient: submissionFor(plan, settings) }), (failure) => {
      assert.equal(failure.code, "SUBMISSION_PREFLIGHT_FAILED");
      assert.equal(failure.simulation.executionProof, "proved"); assert.equal(failure.simulation.protocolFit, "proved"); assert.equal(failure.simulation.admitted, true); assert.equal(failure.simulation.transportPreflight, "failed");
      return true;
    });
  }
});

test("post-provider source header and chain guards are fresh independent reads", async () => {
  const plan = makePlan(), planned = await review(clientFor(plan), plan);
  for (const blocked of ["eth_getBlockByNumber", "eth_chainId"]) {
    const source = clientFor(plan), submissionClient = submissionFor(plan);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const started = [];
    const client = { supportsReadBatching: true, async request(args) {
      if (submissionClient.captured.length === 3) {
        started.push({ method: args.method, params: args.params });
        if (args.method === blocked) await gate;
      }
      return source.request(args);
    } };
    const pending = buildNextTransaction({ client, planned, submissionClient });
    const result = pending.then((next) => ({ next }), (error) => ({ error }));
    await nextTurn();
    const observed = [...started];
    release();
    const settled = await result;
    assert.equal(settled.error, undefined);
    assert.equal(settled.next.admission.transportPreflight, "passed");
    assert.deepEqual(observed.map((row) => row.method), ["eth_getBlockByNumber", "eth_chainId"], "Neither source guard waits for the other");
    assert.deepEqual(observed[0].params, ["0x2a", false], "The proof's original pin is rechecked after provider estimation");
    assert.deepEqual(submissionClient.captured.map((row) => row.method), ["eth_chainId", "eth_estimateGas", "eth_chainId"]);
  }
});

test("either post-provider source mismatch refuses despite successful transport estimation", async () => {
  const plan = makePlan(), planned = await review(clientFor(plan), plan);
  for (const { changed, code } of [
    { changed: "eth_getBlockByNumber", code: "STATE_REORGED" },
    { changed: "eth_chainId", code: "CHAIN_MISMATCH" },
  ]) {
    const source = clientFor(plan), submissionClient = submissionFor(plan), observed = [];
    const client = { supportsReadBatching: true, async request(args) {
      const postProvider = submissionClient.captured.length === 3;
      if (postProvider) observed.push(args.method);
      const value = await source.request(args);
      if (!postProvider || args.method !== changed) return value;
      return changed === "eth_chainId" ? "0x1" : { ...value, hash: FOREIGN_HASH };
    } };
    await assert.rejects(buildNextTransaction({ client, planned, submissionClient }), { code });
    assert.deepEqual(observed, ["eth_getBlockByNumber", "eth_chainId"]);
    assert.deepEqual(submissionClient.captured.map((row) => row.method), ["eth_chainId", "eth_estimateGas", "eth_chainId"]);
  }
});

test("cancellation retains canonical recovery and optional exact submission preflight", async () => {
  const plan = makePlan(), client = clientFor(plan, { phase: LifecyclePhase.Preparing, computeUsed: 40_000n, balance: 92_000n });
  const committed = { plan, planHash: hashLaunchPlan(plan), launchId: hashLaunchIdentity(plan), predictedToken: TOKEN, account: ACCOUNT, chainId: plan.chainId, mode: "staged", confirmations: 1 };
  const submissionClient = submissionFor(plan, { estimate: 40_000n });
  const next = await buildNextTransaction({ client, planned: committed, action: "cancel", submissionClient });
  assert.equal(next.kind, "cancel"); assert.equal(next.gas, 46_000n); assert.equal(next.admission.transportPreflight, "passed");
  assert.equal(client.captured.some((row) => row.method === "eth_call" && row.params[0].to === REGISTRY), false, "Cancellation never requires current profile admission");
  const nitroPlan = makePlan({ chainId: 4663n });
  const nitroCommitted = { ...committed, plan: nitroPlan, planHash: hashLaunchPlan(nitroPlan), launchId: hashLaunchIdentity(nitroPlan), chainId: nitroPlan.chainId };
  const nitro = clientFor(nitroPlan, { phase: LifecyclePhase.Preparing, computeUsed: 40_000n, balance: 92_000n });
  assert.equal((await buildNextTransaction({ client: nitro, planned: nitroCommitted, action: "cancel" })).gas, 46_000n, "Probe-only funding cannot reject an exactly-funded real cancellation");
});

test("definitive failed resumed replay retains every verified-prefix fee without an owned native-balance read", async () => {
  for (const chainId of [31337n, 4663n]) {
    const plan = makePlan({ chainId, markets: 2 });
    const error = { code: 3, message: "Primary resumed activation refusal", data: "0x" };
    const source = clientFor(plan, { phase: LifecyclePhase.Preparing, balance: 0n,
      failureFor(name, _args, validation) { return validation && name === "activateLaunch" ? { error } : undefined; },
    });
    let dataFeeCalls = 0;
    const limits = chainId === 4663n ? undefined : { estimateDataFee: async (transaction, context) => {
      dataFeeCalls += 1;
      assert.equal(context.client, source, "External callbacks keep the original source, not the private read owner");
      assert.equal(context.block.hash, HASH);
      assert.equal(transaction.gas, 1_150_000n);
      return 5n;
    } };
    const planned = await review(source, plan, { mode: "staged", limits });
    assert.equal(planned.simulation.admitted, false);
    assert.equal(planned.simulation.executionProof, "failed");
    assert.equal(planned.simulation.protocolFit, "unknown");
    assert.equal(planned.simulation.failedTransactionId, "activate");
    assert.deepEqual(planned.simulation.steps.map((step) => step.success), [true, false]);
    assert.equal(planned.simulation.steps.at(-1).nativeErrorCode, 3);
    assert.equal(planned.simulation.steps.at(-1).nativeErrorKind, "execution-reverted");
    assert.equal(diagnosticJson(planned.simulation).includes(error.message), false);
    for (const step of planned.simulation.steps) {
      assert.equal(step.estimate.gasUsed, 1_000_000n);
      assert.equal(step.estimate.gasLimit, 1_150_000n);
      assert.equal(step.estimate.gasPrice, 2n);
      assert.equal(step.estimate.executionFee, 2_300_000n);
      assert.equal(step.estimate.dataFee, chainId === 4663n ? 0n : 5n);
      assert.equal(step.estimate.totalFee, chainId === 4663n ? 2_300_000n : 2_300_005n);
      assert.equal(step.estimate.dataFeeIncludedInGas, chainId === 4663n);
      assert.equal(step.estimate.feeConfidence, "execution-and-data");
    }
    assert.equal(dataFeeCalls, chainId === 4663n ? 0 : 2);
    assert.equal(source.captured.filter((row) => row.method === "eth_getBalance").length, 0);
    assert.equal(economicRequests(source).length, 2);
    assert.equal(planned.simulation.blockHash, HASH);
  }
});

test("failed cancellation keeps fee estimates while healthy cancellation still requires exact real affordability", async () => {
  for (const chainId of [31337n, 4663n]) {
    const plan = makePlan({ chainId });
    const committed = { plan, planHash: hashLaunchPlan(plan), launchId: hashLaunchIdentity(plan), predictedToken: TOKEN, account: ACCOUNT, chainId, mode: "staged", confirmations: 1 };
    let dataFeeCalls = 0;
    const limits = chainId === 4663n ? undefined : { estimateDataFee: async () => { dataFeeCalls += 1; return 5n; } };
    const failed = clientFor(plan, { phase: LifecyclePhase.Preparing, computeUsed: 40_000n, balance: 0n, replayFail: true });
    await assert.rejects(buildNextTransaction({ client: failed, planned: committed, action: "cancel", limits }), (failure) => {
      assert.equal(failure.code, "CANCEL_NOT_ADMITTED");
      const simulation = failure.simulation, step = simulation.steps[0];
      assert.equal(simulation.admitted, false);
      assert.equal(simulation.executionProof, "failed");
      assert.equal(simulation.protocolFit, "unknown");
      assert.equal(simulation.failedTransactionId, "cancel");
      assert.equal(simulation.reason, step.error);
      assert.equal(simulation.blockHash, HASH);
      assert.equal(step.success, false);
      assert.equal(step.estimate.gasUsed, 40_000n);
      assert.equal(step.estimate.gasLimit, 46_000n);
      assert.equal(step.estimate.gasPrice, 2n);
      assert.equal(step.estimate.executionFee, 92_000n);
      assert.equal(step.estimate.dataFee, chainId === 4663n ? 0n : 5n);
      assert.equal(step.estimate.totalFee, chainId === 4663n ? 92_000n : 92_005n);
      assert.equal(step.estimate.posterGas, chainId === 4663n ? 0n : undefined);
      assert.equal(step.estimate.posterFee, chainId === 4663n ? 0n : undefined);
      assert.equal(step.estimate.dataFeeIncludedInGas, chainId === 4663n);
      assert.equal(step.estimate.feeConfidence, "execution-and-data");
      return true;
    });
    assert.equal(dataFeeCalls, chainId === 4663n ? 0 : 1);
    assert.equal(failed.captured.filter((row) => row.method === "eth_getBalance").length, 0);
    assert.equal(economicRequests(failed).length, 2);
    const required = chainId === 4663n ? 92_000n : 92_005n;
    const healthy = clientFor(plan, { phase: LifecyclePhase.Preparing, computeUsed: 40_000n, balance: required });
    const next = await buildNextTransaction({ client: healthy, planned: committed, action: "cancel", limits });
    assert.equal(next.kind, "cancel");
    assert.equal(next.gas, 46_000n);
    assert.equal(next.estimate.totalFee, required);
    assert.equal(healthy.captured.filter((row) => row.method === "eth_getBalance").length, 1);
    const poor = clientFor(plan, { phase: LifecyclePhase.Preparing, computeUsed: 40_000n, balance: required - 1n });
    await assert.rejects(buildNextTransaction({ client: poor, planned: committed, action: "cancel", limits }), (failure) => {
      assert.equal(failure.code, "CANCEL_NOT_ADMITTED");
      assert.equal(failure.simulation.executionProof, "proved");
      assert.equal(failure.simulation.protocolFit, "proved");
      assert.match(failure.simulation.reason, /balance/);
      return true;
    });
    assert.equal(poor.captured.filter((row) => row.method === "eth_getBalance").length, 1, "Success observations cannot bypass the real fee reserve");
  }
});

test("failed replay keeps missing-data-fee uncertainty and validates callbacks and uint256 fee envelopes", async () => {
  const plan = makePlan();
  const committed = { plan, planHash: hashLaunchPlan(plan), launchId: hashLaunchIdentity(plan), predictedToken: TOKEN, account: ACCOUNT, chainId: plan.chainId, mode: "staged", confirmations: 1 };
  const missing = clientFor(plan, { phase: LifecyclePhase.Preparing, computeUsed: 40_000n, balance: 0n, replayFail: true });
  await assert.rejects(buildNextTransaction({ client: missing, planned: committed, action: "cancel" }), (failure) => {
    assert.equal(failure.code, "CANCEL_NOT_ADMITTED");
    const estimate = failure.simulation.steps[0].estimate;
    assert.equal(estimate.executionFee, 92_000n);
    assert.equal(estimate.dataFee, undefined);
    assert.equal(estimate.totalFee, undefined);
    assert.equal(estimate.feeConfidence, "execution-only");
    return true;
  });
  assert.equal(missing.captured.filter((row) => row.method === "eth_getBalance").length, 0);
  for (const dataFee of ["5", -1n, 1n << 256n, (1n << 256n) - 1n]) {
    const client = clientFor(plan, { phase: LifecyclePhase.Preparing, computeUsed: 40_000n, balance: 0n, replayFail: true });
    let calls = 0;
    await assert.rejects(buildNextTransaction({ client, planned: committed, action: "cancel",
      limits: { estimateDataFee: async () => { calls += 1; return dataFee; } },
    }), { code: dataFee === (1n << 256n) - 1n ? "INVALID_GAS_ENVELOPE" : "INVALID_DATA_FEE" });
    assert.equal(calls, 1, "Returned failure must not discard external data-fee observation and validation");
    assert.equal(client.captured.filter((row) => row.method === "eth_getBalance").length, 0);
  }
  const overflow = clientFor(plan, { phase: LifecyclePhase.Preparing, computeUsed: 40_000n, gasPrice: (1n << 256n) - 1n, replayFail: true });
  await assert.rejects(buildNextTransaction({ client: overflow, planned: committed, action: "cancel" }), { code: "INVALID_GAS_ENVELOPE" });
  assert.equal(overflow.captured.filter((row) => row.method === "eth_getBalance").length, 0);
});

test("a definitive failed replay cannot skip final canonical chain/hash guards", async () => {
  for (const chainId of [31337n, 4663n]) {
    for (const [settings, code] of [[{ reorg: true }, "STATE_REORGED"], [{ sourceChainDrift: true }, "CHAIN_MISMATCH"]]) {
      const plan = makePlan({ chainId });
      const committed = { plan, planHash: hashLaunchPlan(plan), launchId: hashLaunchIdentity(plan), predictedToken: TOKEN, account: ACCOUNT, chainId, mode: "staged", confirmations: 1 };
      const client = clientFor(plan, { phase: LifecyclePhase.Preparing, computeUsed: 40_000n, replayFail: true, ...settings });
      await assert.rejects(buildNextTransaction({ client, planned: committed, action: "cancel" }), { code });
      assert.equal(client.captured.filter((row) => row.method === "eth_getBalance").length, 0);
      assert.equal(economicRequests(client).length, 2);
    }
  }
});

test("standalone cancellation simulation re-observes fees and account code for every invocation", async () => {
  for (const supportsReadBatching of [false, true]) {
    const plan = makePlan(), client = clientFor(plan, { phase: LifecyclePhase.Preparing, computeUsed: 40_000n });
    client.supportsReadBatching = supportsReadBatching;
    const committed = { plan, planHash: hashLaunchPlan(plan), launchId: hashLaunchIdentity(plan), predictedToken: TOKEN, account: ACCOUNT, chainId: plan.chainId, mode: "staged", confirmations: 1 };
    const first = await buildNextTransaction({ client, planned: committed, action: "cancel" });
    assert.equal(first.gasPrice, 2n);
    client.state.gasPrice = 7n;
    const refreshed = await buildNextTransaction({ client, planned: committed, action: "cancel" });
    assert.equal(refreshed.gasPrice, 7n);
    assert.equal(refreshed.estimate.executionFee, refreshed.gas * 7n);
    client.state.accountCode = CODE;
    await assert.rejects(buildNextTransaction({ client, planned: committed, action: "cancel" }), (failure) => {
      assert.equal(failure.code, "CANCEL_NOT_ADMITTED");
      assert.equal(failure.simulation.confidence, "provisional");
      assert.match(failure.simulation.reason, /smart-account/);
      return true;
    });
  }
});

test("atomic remains explicit and staged partitions only empty preparations, never complete activation", async () => {
  const plan = makePlan({ markets: 2 });
  const gasFor = (name, args) => name === "launchAtomic" ? 4_000_000n : name === "prepareMarkets" ? BigInt(args[2]) * 1_100_000n : 400_000n;
  const client = clientFor(plan, { gasFor });
  const atomic = await review(client, plan, { limits: { chainGasLimit: 2_000_000n } });
  assert.equal(atomic.simulation.admitted, false); assert.equal(atomic.mode, "atomic"); assert.deepEqual(atomic.transactions.map((tx) => tx.kind), ["atomic"]);
  const staged = await review(client, plan, { mode: "staged", limits: { chainGasLimit: 2_000_000n } });
  assert.equal(staged.simulation.admitted, true, staged.simulation.reason); assert.equal(staged.preparationBatchSize, 1);
  assert.deepEqual(staged.transactions.map((tx) => tx.kind), ["begin", "prepare", "prepare", "activate"]);
  assert.deepEqual(staged.transactions.filter((tx) => tx.kind === "prepare").map((tx) => [tx.marketStart, tx.marketCount]), [[0, 1], [1, 1]]);
  assert.equal(staged.transactions.filter((tx) => tx.kind === "activate").length, 1);
  const refused = await review(clientFor(plan, { gasFor, failActivation: true }), plan, { mode: "staged", limits: { chainGasLimit: 2_000_000n } });
  assert.equal(refused.simulation.admitted, false); assert.equal(refused.simulation.failedTransactionId, "activate"); assert.match(refused.simulation.reason, /indivisible/);
  await assert.rejects(planLaunch({ client, plan, account: ACCOUNT }), { code: "EXPLICIT_MODE_REQUIRED" });
});

test("requested staged partitions share one capability but never splice prefix state or simulate atomic", async () => {
  for (const supportsReadBatching of [false, true]) {
    const plan = makePlan({ chainId: 4663n, markets: 4 }), client = clientFor(plan, {
      nativeGasCode: supportsReadBatching ? -32015 : -32000,
      gasFor: (name, args) => name === "prepareMarkets" ? BigInt(args[2]) * 18_000_000n : 400_000n,
    });
    client.supportsReadBatching = supportsReadBatching;
    const planned = await review(client, plan, { mode: "staged" });
    assert.equal(planned.simulation.admitted, true, planned.simulation.reason);
    assert.equal(planned.preparationBatchSize, 1);
    assert.equal(Object.hasOwn(planned, "atomicAttempt"), false);
    assert.equal(capabilityRequests(client).length, 1);
    const sequences = economicRequests(client).map((row) => row.params[0]);
    assert.equal(sequences.length, 4, "Three complete candidate measurements and one exact full replay remain necessary");
    assert.deepEqual(sequences.map((request) => request.blockStateCalls.length), [3, 4, 6, 6]);
    const capabilityChild = capabilityRequests(client)[0].params[0].blockStateCalls[0].blockOverrides;
    for (const request of sequences) {
      const calls = request.blockStateCalls.map((block, index) => {
        assert.equal(block.stateOverrides, undefined);
        assert.equal(block.blockOverrides.baseFeePerGas, undefined);
        assert.equal(BigInt(block.blockOverrides.number), BigInt(capabilityChild.number) + BigInt(index));
        assert.equal(BigInt(block.blockOverrides.time), BigInt(capabilityChild.time) + BigInt(index));
        assert.equal(block.blockOverrides.gasLimit, capabilityChild.gasLimit);
        assert.equal(block.calls.length, 1);
        return decodeFunctionData({ abi: launchLifecycleAbi, data: block.calls[0].data }).functionName;
      });
      assert.equal(calls[0], "beginLaunch");
      assert.equal(calls.at(-1), "activateLaunch");
      assert.equal(calls.filter((name) => name === "activateLaunch").length, 1);
      assert.equal(calls.includes("launchAtomic"), false);
    }
    assert.equal(sequences.at(-1).validation, true);
    assert.equal(client.captured.filter((row) => row.method === "eth_getBlockByNumber" && row.params[0] === "0x2a").length, 3);
    client.captured.length = 0;
    const later = await review(client, plan, { mode: "staged" });
    assert.equal(later.simulation.admitted, true);
    assert.equal(capabilityRequests(client).length, 1, "A new review obtains fresh capability instead of inheriting proof");
  }
});

test("known preparation phase, order and constructor errors stop partition search; unknown near-cap failure stays unclassified", async () => {
  const known = ["0x78ca98e3", "0x9a36fd9c", encodeErrorResult({ abi: fixedFeePoolHookV1Abi, errorName: "InvalidConfiguration" }),
    encodeErrorResult({ abi: parseAbi(["error FeeBelowMinimum()"]), errorName: "FeeBelowMinimum" })];
  for (const prepareFailureData of known) {
    const plan = makePlan({ chainId: 4663n, markets: 4 }), client = clientFor(plan, { prepareFailureData });
    const planned = await review(client, plan, { mode: "staged" });
    assert.equal(planned.simulation.admitted, false);
    assert.equal(planned.simulation.steps.at(-1).returnData, prepareFailureData);
    assert.equal(economicRequests(client).length, 1, "Changing partition sizes cannot fix a diagnosed business/configuration refusal");
    assert.equal(planned.simulation.failureCategory, "semantic");
  }
  const plan = makePlan({ chainId: 4663n, markets: 4 }), client = clientFor(plan, {
    prepareFailureData: "0x", gasFor: (name) => name === "prepareMarkets" ? 31_900_000n : 400_000n,
  });
  const refused = await review(client, plan, { mode: "staged" });
  assert.equal(refused.simulation.admitted, false);
  assert.equal(refused.simulation.protocolFit, "unknown");
  assert.equal(refused.simulation.executionProof, "failed");
  assert.equal(refused.simulation.steps.at(-1).returnData, "0x");
  assert.equal(refused.simulation.failureCategory, "opaque");
  assert.equal(refused.preparationBatchSize, 4);
  assert.equal(economicRequests(client).length, 1, "Gas proximity alone cannot authorize schedule discovery");
  assert.equal(capabilityRequests(client).length, 1);
  assert.doesNotMatch(refused.simulation.reason, /out.of.gas|OOG|capacity/i, "Near-cap gas does not diagnose the preparation root");
});

test("actual native error.data-only first preparation invariants stop search without rewriting empty return bytes", async () => {
  const selectors = ["0x78ca98e3", "0x9a36fd9c", encodeErrorResult({ abi: fixedFeePoolHookV1Abi, errorName: "InvalidConfiguration" })];
  for (const selector of selectors) {
    for (const data of [selector, { data: selector }, { data: { data: selector } }]) {
      const plan = makePlan({ chainId: 4663n, markets: 4 });
      const error = { code: 3, message: "execution reverted", data };
      const source = clientFor(plan, { downstreamFailureData: "0x78ca98e3",
        failureFor(name) { return name === "prepareMarkets" ? { returnData: "0x", error } : undefined; },
      });
      const planned = await review(source, plan, { mode: "staged" });
      assert.equal(planned.simulation.admitted, false);
      assert.equal(planned.preparationBatchSize, 4);
      assert.equal(planned.simulation.steps.length, 2);
      assert.equal(planned.simulation.failedTransactionId, planned.transactions.find((transaction) => transaction.kind === "prepare").id);
      assert.equal(planned.simulation.steps[0].success, true);
      const failed = planned.simulation.steps[1];
      assert.equal(failed.success, false);
      assert.equal(failed.returnData, "0x");
      assert.equal(failed.nativeErrorCode, 3);
      assert.equal(failed.nativeErrorKind, "execution-reverted");
      assert.equal(failed.nativeErrorDataBytes, 4);
      assert.ok(["InvalidPhase", "InvalidPreparationOrder", "InvalidConfiguration"].includes(failed.decodedError));
      assert.equal(diagnosticJson(planned.simulation).includes(error.message), false);
      assert.equal(economicRequests(source).length, 1, "Known primary preparation invariants cannot be repaired by smaller empty ranges");
      assert.equal(capabilityRequests(source).length, 1);
      assert.equal(planned.simulation.failureCategory, "semantic");
    }
  }
});

test("a primary begin failure cannot be reclassified by a known downstream preparation selector", async () => {
  const plan = makePlan({ chainId: 4663n, markets: 4 });
  const error = { code: 3, message: "Primary begin execution reverted", data: "0x78ca98e3" };
  const source = clientFor(plan, { downstreamFailureData: "0x9a36fd9c",
    failureFor(name) { return name === "beginLaunch" ? { error } : undefined; },
  });
  const planned = await review(source, plan, { mode: "staged" });
  assert.equal(planned.simulation.failedTransactionId, "begin");
  assert.equal(planned.simulation.steps.length, 1);
  assert.equal(planned.simulation.steps[0].returnData, "0x");
  assert.equal(planned.simulation.steps[0].nativeErrorCode, 3);
  assert.equal(planned.simulation.steps[0].failureCategory, "semantic");
  assert.equal(diagnosticJson(planned.simulation).includes(error.message), false);
  assert.equal(planned.preparationBatchSize, 4);
  assert.equal(economicRequests(source).length, 1);
});

test("unknown, malformed and generic native preparation roots ignore downstream order/phase selectors", async () => {
  const genericErrors = parseAbi(["error Error(string reason)", "error Panic(uint256 code)"]);
  const roots = [
    { code: 3, message: "Primary unknown preparation revert", data: "0x" },
    { code: 3, message: "Primary unknown preparation revert", data: "0xdeadbeef" },
    { code: 3, message: "Primary unknown preparation revert", data: "0x78ca98e" },
    { code: 3, message: "Primary unknown preparation revert", data: "0x78ca98zz" },
    { code: 3, message: "Primary unknown preparation revert", data: { message: "0x78ca98e3" } },
    { code: 3, message: "0x78ca98e3", originalError: { data: "0x78ca98e3" } },
    { code: 3, message: "Primary unknown preparation revert", data: encodeErrorResult({ abi: genericErrors, errorName: "Error", args: ["0x78ca98e3"] }) },
    { code: 3, message: "Primary unknown preparation revert", data: encodeErrorResult({ abi: genericErrors, errorName: "Panic", args: [0x11n] }) },
    { code: -32015, message: "out of gas: private native context", data: "0xdeadbeef" },
    { code: -32015, message: "out of gas: private native context", data: "0x78ca98zz" },
    { code: -32016, message: "out of gas: private native context", data: "0x" },
    { code: -32015, message: "out of gas: private native context (gas limit was capped by the RPC server's global gas cap)", data: "0x" },
    "0x78ca98e3",
  ];
  for (const error of roots) {
    const plan = makePlan({ chainId: 4663n, markets: 4 });
    const source = clientFor(plan, { downstreamFailureData: "0x9a36fd9c",
      failureFor(name) { return name === "prepareMarkets" ? { error } : undefined; },
    });
    const planned = await review(source, plan, { mode: "staged" });
    assert.equal(planned.simulation.admitted, false);
    assert.equal(planned.simulation.executionProof, "failed");
    assert.equal(planned.simulation.protocolFit, "unknown");
    assert.equal(planned.preparationBatchSize, 4);
    assert.equal(planned.simulation.steps.length, 2, "Only the actual successful begin and first failed preparation belong to the returned prefix");
    assert.equal(planned.simulation.steps[1].returnData, "0x");
    assert.equal(planned.simulation.steps[1].nativeErrorCode, typeof error === "object" ? error.code : undefined);
    assert.notEqual(planned.simulation.failureCategory, "capacity");
    if (typeof error === "object") assert.equal(diagnosticJson(planned.simulation).includes(error.message), false);
    assert.equal(planned.simulation.failedTransactionId, planned.transactions.find((transaction) => transaction.kind === "prepare").id);
    assert.equal(economicRequests(source).length, 1, "An unknown primary root cannot authorize another partition");
    assert.equal(capabilityRequests(source).length, 1);
    assert.notEqual(planned.simulation.steps[1].decodedError, "InvalidPreparationOrder", "A downstream selector is never the primary diagnosis");
    const capped = typeof error === "object" && error.message.endsWith(" (gas limit was capped by the RPC server's global gas cap)");
    assert.equal(planned.simulation.steps[1].nativeGasCapped, capped);
    if (capped) {
      assert.equal(planned.simulation.failureCategory, "source");
      assert.equal(planned.simulation.steps[1].nativeErrorKind, "out-of-gas");
    }
  }
});

test("non-invariant native returnData takes precedence over known error.data without authorizing partitioning", async () => {
  for (const [returnData, expectedCategory] of [
    ["0x", "semantic"],
    ["0xdeadbeef", "opaque"],
  ]) {
    const plan = makePlan({ chainId: 4663n, markets: 4 });
    const error = { code: 3, message: "Primary preparation revert", data: encodeErrorResult({ abi: fixedFeePoolHookV1Abi, errorName: "InvalidConfiguration" }) };
    const source = clientFor(plan, { downstreamFailureData: "0x9a36fd9c",
      failureFor(name) { return name === "prepareMarkets" ? { returnData, error } : undefined; },
    });
    const planned = await review(source, plan, { mode: "staged" });
    assert.equal(planned.simulation.admitted, false);
    assert.equal(planned.simulation.backend, "eth_simulateV1");
    assert.equal(planned.simulation.confidence, "stateful");
    assert.equal(planned.simulation.executionProof, "failed");
    assert.equal(planned.simulation.protocolFit, "unknown");
    assert.equal(planned.simulation.transportPreflight, "not-requested");
    assert.equal(planned.simulation.failureCategory, expectedCategory);
    assert.equal(planned.preparationBatchSize, 4);
    assert.deepEqual(planned.transactions.filter((transaction) => transaction.kind === "prepare").map((transaction) => [transaction.marketStart, transaction.marketCount]), [[0, 4]]);
    const firstPreparation = planned.transactions.find((transaction) => transaction.kind === "prepare");
    assert.equal(planned.simulation.failedTransactionId, firstPreparation.id);
    assert.deepEqual(planned.simulation.steps.map((step) => [step.transactionId, step.success]), [["begin", true], [firstPreparation.id, false]]);
    assert.equal(planned.simulation.steps.at(-1).returnData, returnData);
    assert.equal(planned.simulation.steps.at(-1).nativeErrorCode, 3);
    assert.equal(planned.simulation.steps.at(-1).nativeErrorDataBytes, 4);
    assert.equal(diagnosticJson(planned.simulation).includes(error.message), false);
    const requests = economicRequests(source).map((row) => row.params[0]);
    assert.deepEqual(requests.map((request) => request.blockStateCalls.length), [3]);
    assert.ok(requests.every((request) => request.validation === false));
    assert.equal(capabilityRequests(source).length, 1);
  }
});

test("explicit envelope discovery preserves gasleft/EIP150 proof and carries the validated ceiling", async () => {
  const plan = makePlan();
  const client = clientFor(plan, { gasFor: (_name, _args, validation) => validation ? 1_500_000n : 1_000_000n });
  const planned = await review(client, plan);
  assert.equal(planned.simulation.admitted, true, planned.simulation.reason);
  assert.equal(planned.transactions[0].gas, 30_000_000n);
  const replays = client.captured.filter((row) => row.method === "eth_simulateV1" && row.params[0].validation);
  assert.equal(replays.length, 2);
  assert.equal(BigInt(replays[0].params[0].blockStateCalls[0].calls[0].gas), 1_150_000n);
  assert.equal(BigInt(replays[1].params[0].blockStateCalls[0].calls[0].gas), 30_000_000n);
});

test("Nitro submission preflight accepts the reviewed total envelope rather than reapplying compute as total gas", async () => {
  const plan = makePlan({ chainId: 4663n });
  const client = clientFor(plan, { computeUsed: 27_000_000n, poster: 2_000_000n });
  const planned = await review(client, plan);
  const submissionClient = submissionFor(plan, { estimate: 33_000_000n });
  const next = await buildNextTransaction({ client, planned, submissionClient });
  assert.equal(next.gas, 33_350_000n);
  assert.equal(next.admission.transportPreflight, "passed");
  assert.equal(BigInt(submissionClient.captured[1].params[0].gas), 33_350_000n);
});

test("generic EVM zero-price gas envelopes remain valid when exact validated replay accepts them", async () => {
  const plan = makePlan(), client = clientFor(plan, { gasPrice: 0n, balance: 0n });
  const planned = await review(client, plan);
  assert.equal(planned.simulation.admitted, true);
  assert.equal((await buildNextTransaction({ client, planned, submissionClient: submissionFor(plan) })).gasPrice, 0n);
});

test("zero metering cannot admit a nonpositive reviewed gas envelope", async () => {
  for (const chainId of [31337n, 4663n]) {
    const plan = makePlan({ chainId }), client = clientFor(plan, { computeUsed: 0n });
    const planned = await review(client, plan);
    assert.equal(planned.simulation.admitted, false);
    assert.equal(planned.simulation.executionProof, "unavailable");
    assert.equal(planned.simulation.protocolFit, "failed");
    assert.match(planned.simulation.reason, /positive uint64/);
    await assert.rejects(buildNextTransaction({ client, planned }), { code: "PLAN_NOT_ADMITTED" });
  }
});

test("one plan shares exact pinned observations but retains every stateful replay and live canonical check", async () => {
  const plan = makePlan({ chainId: 4663n, markets: 2 }), client = clientFor(plan, { allowance: 0n });
  const planned = await review(client, plan, { mode: "staged" });
  assert.equal(planned.simulation.admitted, true, planned.simulation.reason);
  const getterCount = (abi, name) => client.captured.filter((row) => {
    if (row.method !== "eth_call") return false;
    try { return decodeFunctionData({ abi, data: row.params[0].data }).functionName === name; } catch { return false; }
  }).length;
  assert.equal(getterCount(launchLifecycleAbi, "predictToken"), 1);
  assert.equal(getterCount(launchLifecycleAbi, "registry"), 1);
  assert.equal(getterCount(lifecycleRegistryAbi, "requireEligible"), 1);
  for (const name of ["getMaxTxGasLimit", "getMaxBlockGasLimit"]) assert.equal(getterCount(gasInfoAbi, name), 1);
  assert.equal(getterCount(arbSysAbi, "arbOSVersion"), 1);
  assert.equal(client.captured.filter((row) => row.method === "eth_getCode" && row.params[0].toLowerCase() === ADAPTER).length, 1);
  assert.equal(client.captured.filter((row) => row.method === "eth_getBalance" && row.params[0].toLowerCase() === ACCOUNT).length, 1);
  const simulations = client.captured.filter((row) => row.method === "eth_simulateV1");
  assert.equal(simulations.length, 3, "Only requested staged mode retains one native capability, complete measurement and exact validated replay");
  assert.ok(simulations.some((row) => !row.params[0].validation));
  assert.equal(client.captured.filter((row) => row.method === "eth_getBlockByNumber" && row.params[0] === "0x2a").length, 1,
    "The requested staged simulation retains its final canonical hash check");
});

test("domain, profile certification and funding getter rounds overlap with a bounded batching-capable client", async () => {
  const plan = makePlan({ markets: 7 }), source = clientFor(plan);
  let active = 0, peak = 0;
  const rounds = [];
  const client = { supportsReadBatching: true, async request(args) {
    active += 1; peak = Math.max(peak, active);
    rounds.push({ method: args.method, active });
    await nextTurn();
    try { return await source.request(args); } finally { active -= 1; }
  } };
  const planned = await review(client, plan);
  assert.equal(planned.simulation.admitted, true, planned.simulation.reason);
  assert.ok(peak > 1, "Independent getters must start before earlier responses settle");
  assert.ok(peak <= 8, `Invocation issued ${peak} concurrent requests`);
  assert.ok(rounds.some((row) => row.method === "eth_call" && row.active > 1));

  for (const names of [["balanceOf", "allowance"]]) {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const started = [];
    const gated = { supportsReadBatching: true, async request(args) {
      if (args.method === "eth_call") {
        for (const abi of [launchLifecycleAbi, lifecycleErc20Abi, abyssLifecycleAdapterAbi]) {
          let call;
          try { call = decodeFunctionData({ abi, data: args.params[0].data }); } catch { continue; }
          if (names.includes(call.functionName)) { started.push(call.functionName); await gate; }
          break;
        }
      }
      return source.request(args);
    } };
    const pending = review(gated, plan);
    await nextTurn();
    const observed = [...started];
    release();
    assert.equal((await pending).simulation.admitted, true);
    for (const name of names) assert.ok(observed.includes(name), `${name} starts in the same independent dependency round`);
  }
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

test("a changed live graph digest invalidates an admitted plan before build-next", async () => {
  const plan = makePlan({ chainId: 4663n }), client = clientFor(plan);
  const baseline = await review(client, plan);
  assert.equal(baseline.simulation.admitted, true, baseline.simulation.reason);
  client.state.graphDigest = FOREIGN_HASH;
  const changed = await review(client, plan);
  assert.equal(changed.simulation.admitted, false);
  assert.equal(changed.simulation.failureCategory, "semantic");
  await assert.rejects(buildNextTransaction({ client, planned: baseline }), { code: "PLAN_NOT_ADMITTED" });
});


test("funding totals remain exact when parallel conversions share an input and need zero-first approval", async () => {
  const plan = makePlan({ markets: 2 });
  const inputAsset = address(0x30), target = address(0xfc);
  plan.funding = plan.funding.map((funding) => ({ ...funding, kind: 2, inputAsset, inputAmount: 20n, target, data: "0x1234" }));
  const client = clientFor(plan, { allowance: 1n });
  const planned = await review(client, plan);
  assert.equal(planned.simulation.admitted, true, planned.simulation.reason);
  assert.deepEqual(planned.transactions.map((tx) => tx.kind), ["approve-reset", "approve", "atomic"]);
  const [spender, amount] = decodeFunctionData({ abi: lifecycleErc20Abi, data: planned.transactions[1].data }).args;
  assert.equal(spender.toLowerCase(), ESCROW.toLowerCase());
  assert.equal(amount, 40n);
  assert.deepEqual(planned.prerequisites.map((row) => [row.requiredInput, row.inputBalance, row.allowance]), [[20n, 1000n, 1n], [20n, 1000n, 1n]]);
  for (const name of ["balanceOf", "allowance"]) {
    const rows = client.captured.filter((row) => row.method === "eth_call" && row.params[0].to === inputAsset && decodeFunctionData({ abi: lifecycleErc20Abi, data: row.params[0].data }).functionName === name);
    assert.equal(rows.length, 1);
  }
  client.state.tokenBalance = 39n;
  const insufficient = await review(client, plan);
  assert.equal(insufficient.simulation.admitted, false);
  assert.equal(insufficient.simulation.executionProof, "failed");
  assert.equal(insufficient.simulation.failureCategory, "semantic");
  assert.equal(insufficient.simulation.steps.at(-1).success, false, "The committed core transfer, not a balance getter, refuses insufficient combined funding");
});

test("fresh invocations cannot reuse superseded code or registry and token-factory authority", async () => {
  const plan = makePlan(), client = clientFor(plan);
  const baseline = await review(client, plan);
  assert.equal(baseline.simulation.admitted, true);
  client.state.codeFor = (target) => target.toLowerCase() === ADAPTER ? "0x600260005560026000f3" : target.toLowerCase() === ACCOUNT ? "0x" : CODE;
  const changed = await review(client, plan);
  assert.equal(changed.simulation.admitted, false);
  assert.equal(changed.simulation.failureCategory, "semantic");
  delete client.state.codeFor;
  client.state.authorities = { [REGISTRY]: address(0xff) };
  await assert.rejects(review(client, plan), { code: "REGISTRY_BINDING" });
  client.state.authorities = { [ADAPTER]: address(0xff) };
  await assert.rejects(review(client, plan), { code: "TOKEN_FACTORY_BINDING" });
});

test("a failed parallel funding observation is visible unchanged and a fresh invocation can recover", async () => {
  const plan = makePlan(), source = clientFor(plan), failure = new Error("Pinned funding allowance is unavailable");
  let fail = true;
  const client = { request(args) {
    if (args.method === "eth_call" && args.params[0].to === plan.funding[0].inputAsset && decodeFunctionData({ abi: lifecycleErc20Abi, data: args.params[0].data }).functionName === "allowance" && fail) return Promise.reject(failure);
    return source.request(args);
  } };
  await assert.rejects(review(client, plan), (error) => error === failure);
  fail = false;
  assert.equal((await review(client, plan)).simulation.admitted, true);
});

test("partial profile failure stays attached to its row without certifying it or hiding healthy profiles", async () => {
  const plan = makePlan(), source = clientFor(plan);
  const profileIds = [0, 1, 2, 3].map((variant) => keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "uint8" }], [keccak256(stringToHex("BLACK_MARKET_ABYSS_CANONICAL_PROFILE_V1")), plan.chainId, FACTORY, variant])));
  const client = { request(args) {
    if (args.method === "eth_call" && args.params[0].to === REGISTRY) {
      const call = decodeFunctionData({ abi: lifecycleRegistryAbi, data: args.params[0].data });
      if (call.functionName === "profileTopology" && call.args[0] === profileIds[1]) return Promise.reject(new Error("This pinned topology is unavailable"));
    }
    return source.request(args);
  } };
  const rows = await readLifecycleProfiles({ client, orchestrator: CORE, profileIds });
  assert.deepEqual(rows.map((row) => row.id), profileIds);
  assert.deepEqual(rows.map((row) => row.admitted), [true, false, true, true]);
  assert.ok(rows[1].reason);
  assert.equal(rows[1].reason.includes("This pinned topology is unavailable"), false);
});

test("input mutation while getters are outstanding makes the result obsolete instead of executable", async () => {
  const plan = makePlan(), source = clientFor(plan);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const client = { async request(args) {
    if (args.method === "eth_call" && args.params[0].to === plan.funding[0].inputAsset && decodeFunctionData({ abi: lifecycleErc20Abi, data: args.params[0].data }).functionName === "allowance") await gate;
    return source.request(args);
  } };
  const pending = review(client, plan);
  await nextTurn();
  plan.buys[0].minTokenOut = 6n;
  release();
  await assert.rejects(pending, { code: "PLAN_MUTATED" });
  assert.equal((await review(client, plan)).simulation.admitted, true);
});

test("an invocation-local read wrapper cannot disguise a source RPC as a disposable fork", async () => {
  const plan = makePlan(), client = clientFor(plan);
  await assert.rejects(review(client, plan, { fork: { client, isolation: "disposable", allowTransactions: true } }), { code: "UNSAFE_FORK" });
  assert.equal(client.captured.some((row) => row.method === "eth_simulateV1"), false);
});

function knownAbyssPlan() {
  const plan = makePlan({ chainId: 4663n });
  plan.orchestrator = "0x91560876033d568d25CDe98C78c33ff8FC43962c";
  const preset = getKnownLifecycleProfile({ chainId: plan.chainId, orchestrator: plan.orchestrator, key: KnownLifecycleProfile.Abyss3 });
  plan.markets = plan.markets.map((market) => ({ ...market, adapterId: preset.profile.registration.adapterId, profileId: preset.profile.id }));
  return plan;
}

test("known-preset ordered buys use exact receipt floors and prove only the final protected commitment", async () => {
  for (const mode of ["atomic", "staged"]) {
    const plan = knownAbyssPlan();
    plan.token.supply = 10n ** 27n;
    plan.markets[0].tokenBudget = plan.token.supply;
    const config = decodeAbyssLifecycleMarketConfig(plan.markets[0].config);
    plan.markets[0].config = encodeAbyssLifecycleMarketConfig({ ...config,
      positions: config.positions.map((position) => ({ ...position, tokenAmountMaximum: plan.token.supply })) });
    plan.buys = [3n, 7n].map((quoteAmountIn) => ({ ...plan.buys[0], quoteAmountIn }));
    const original = hashLaunchPlan(plan);
    const outputs = [10001n, 900719925474099300001n];
    const client = clientFor(plan, { quoteSpent: [3n, 7n], tokenOut: () => outputs });
    const planned = await prepareAndPlanLifecycleLaunch({ client, account: ACCOUNT, plan, mode, buySlippageBps: 50 });
    assert.equal(hashLaunchPlan(plan), original, "Calibration never mutates the consumer draft");
    assert.deepEqual(planned.plan.buys.map((buy) => buy.minTokenOut), [9950n, 896216325846728803500n]);
    assert.deepEqual(planned.plan.buys.map(({ minTokenOut, ...buy }) => buy), plan.buys.map(({ minTokenOut, ...buy }) => buy));
    assert.notEqual(planned.planHash, original);
    assert.equal(planned.planHash, hashLaunchPlan(planned.plan));
    assert.equal(planned.simulation.admitted, true);
    assert.equal(planned.simulation.executionProof, "proved");
    assert.equal(planned.simulation.protocolFit, "proved");
    assert.ok(planned.profiles.every((profile) => profile.metadataSource === "preset" && !Object.hasOwn(profile, "admitted")),
      "Construction metadata is not a current-state admission certificate");
    const requests = economicRequests(client).map((row) => row.params[0]);
    assert.deepEqual(requests.map((request) => request.validation), [false, false, true]);
    const committed = requests.map((request) => {
      const last = request.blockStateCalls.at(-1).calls[0];
      return decodeFunctionData({ abi: launchLifecycleAbi, data: last.data }).args[0];
    });
    assert.deepEqual(committed[0].buys.map((buy) => buy.minTokenOut), [1n, 1n]);
    assert.equal(hashLaunchPlan(committed[1]), planned.planHash);
    assert.equal(hashLaunchPlan(committed[2]), planned.planHash, "Validated replay carries the protected plan, never diagnostic minima");
    assert.equal(capabilityRequests(client).length, 1);
    const registry = getKnownLifecycleDeployment({ chainId: plan.chainId, orchestrator: plan.orchestrator }).registry;
    assert.equal(client.captured.some((row) => row.method === "eth_call" && row.params[0].to.toLowerCase() === registry.toLowerCase()), false);
  }
});

test("calibration refuses dust, failed diagnostics and protected replay failures without returning an executable diagnostic", async () => {
  for (const { settings, bps = 50, code } of [
    { settings: { tokenOut: () => [1n] }, code: "INVALID_BUY_OUTPUT" },
    { settings: { failActivation: true }, code: "LAUNCH_DIAGNOSTIC_FAILED" },
    { settings: { replayFail: true }, code: "PROTECTED_PLAN_NOT_ADMITTED" },
    { settings: { tokenOut: (_plan, validation) => validation ? [5n] : [10001n] }, code: "PROTECTED_PLAN_NOT_ADMITTED" },
  ]) {
    const plan = knownAbyssPlan(), client = clientFor(plan, settings);
    await assert.rejects(prepareAndPlanLifecycleLaunch({ client, account: ACCOUNT, plan, mode: "atomic", buySlippageBps: bps }), { code });
    assert.ok(economicRequests(client).length <= 3, "Refused calibration cannot retry or change execution mode");
    assert.ok(economicRequests(client).every((row) => row.params[0].blockStateCalls.length === 1));
  }
  for (const [bps, minimum] of [[0, 10001n], [9999, 1n]]) {
    const plan = knownAbyssPlan(), client = clientFor(plan, { tokenOut: () => [10001n] });
    const planned = await prepareAndPlanLifecycleLaunch({ client, account: ACCOUNT, plan, mode: "atomic", buySlippageBps: bps });
    assert.equal(planned.plan.buys[0].minTokenOut, minimum);
    assert.equal(planned.simulation.executionProof, "proved");
  }
});

test("activation receipts must report exactly the committed total positions, not the market count", async () => {
  for (const mode of ["atomic", "staged"]) {
    const plan = makePlan();
    const config = decodeAbyssLifecycleMarketConfig(plan.markets[0].config);
    plan.markets[0].tokenBudget = 200n;
    plan.token.supply = plan.markets[0].tokenBudget;
    plan.markets[0].config = encodeAbyssLifecycleMarketConfig({ ...config, positions: [
      ...config.positions, { ...config.positions[0], tickLower: 120, tickUpper: 180 },
    ] });
    assert.equal((await review(clientFor(plan), plan, { mode })).simulation.admitted, true);
    for (const receiptPositionCount of [0, 1, 3]) {
      const planned = await review(clientFor(plan, { receiptPositionCount }), plan, { mode });
      assert.equal(planned.simulation.admitted, false);
      assert.equal(planned.simulation.failureCategory, "postcondition");
      assert.equal(planned.simulation.executionProof, "failed");
    }
  }
});

test("activation events independently bind exact committed position and market counts", async () => {
  for (const mode of ["atomic", "staged"]) {
    const plan = makePlan();
    for (const settings of [{ eventPositionCount: 0 }, { eventPositionCount: 2 }, { eventMarketCount: 0 }, { eventMarketCount: 2 }]) {
      const planned = await review(clientFor(plan, settings), plan, { mode });
      assert.equal(planned.simulation.admitted, false);
      assert.equal(planned.simulation.failureCategory, "postcondition");
      assert.equal(planned.simulation.executionProof, "failed", "A correct return tuple cannot replace the actual activation event");
    }
  }
});

test("aborted prepared continuations close permanently and never resume a later economic phase", async () => {
  for (const stage of ["capability", "measurement", "replay"]) {
    const plan = makePlan({ chainId: 4663n }), seed = clientFor(plan);
    const planned = await review(seed, plan), source = clientFor(plan), stop = new AbortController();
    const client = { supportsReadBatching: true, async request(args) {
      const result = await source.request(args);
      if (args.method === "eth_simulateV1") {
        const current = args.params[0].blockStateCalls[0].calls[0].to === ARB_SYS ? "capability" :
          args.params[0].validation ? "replay" : "measurement";
        if (current === stage) stop.abort();
      }
      return result;
    } };
    await withLifecycleReadClient(client, async (scoped) => {
      const prepared = prepareLaunchSimulation({ client: scoped, planned, signal: stop.signal }, await readLifecycleBlock(scoped));
      try {
        await assert.rejects(prepared(planned.transactions), { name: "AbortError" });
        const observed = source.captured.length;
        await assert.rejects(prepared(planned.transactions), { code: "INVALID_SIMULATION" });
        assert.equal(source.captured.length, observed, "Closed work cannot restart after cancellation");
      } finally { prepared.close(); }
    });
    assert.equal(economicRequests(source).length, stage === "capability" ? 0 : stage === "measurement" ? 1 : 2);
  }
});

test("native prerequisite and proof catch branches expose refusal without private provider messages", async () => {
  for (const stage of ["capability", "poster", "measurement", "replay", "envelope"]) {
    const plan = makePlan({ chainId: 4663n });
    const source = clientFor(plan, { gasFor: (_name, _args, validation) => validation ? 1_500_000n : 1_000_000n });
    const sentinel = `private-provider-context-${stage}`;
    const failure = Object.assign(new Error(sentinel), { status: 503, code: -32015, data: "0x" });
    let economic = 0;
    const client = { supportsReadBatching: true, async request(args) {
      let current;
      if (args.method === "eth_call" && args.params[0].to === NODE_INTERFACE) current = "poster";
      if (args.method === "eth_simulateV1") current = args.params[0].blockStateCalls[0].calls[0].to === ARB_SYS ? "capability" :
        ++economic === 1 ? "measurement" : economic === 2 ? "replay" : "envelope";
      if (current === stage) {
        source.captured.push(args);
        throw failure;
      }
      return source.request(args);
    } };
    const planned = await review(client, plan);
    assert.equal(planned.simulation.admitted, false);
    assert.equal(planned.simulation.executionProof, "unavailable");
    assert.equal(planned.simulation.confidence, "provisional");
    assert.equal(diagnosticJson(planned.simulation).includes(sentinel), false, `${stage} cannot echo private provider messages`);
    assert.equal(economic, stage === "capability" || stage === "poster" ? 0 : stage === "measurement" ? 1 : stage === "replay" ? 2 : 3,
      "A provider failure cannot authorize another economic pass");
  }
});
