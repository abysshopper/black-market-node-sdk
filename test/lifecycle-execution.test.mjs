import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, keccak256, parseAbi, stringToHex, toHex, zeroAddress, zeroHash } from "viem";

const sdkPath = process.env.SDK_SOURCE_TEST === "1" ? "../src/lifecycle/index.ts" : "../dist/lifecycle/index.js";
const { ABYSS_LIFECYCLE_CONFIG_SCHEMA, abyssLifecycleAdapterAbi, buildNextTransaction, encodeAbyssLifecycleMarketConfig, hashLaunchIdentity, hashLaunchPlan, launchLifecycleAbi, lifecycleAdapterAbi, lifecycleErc20Abi, lifecycleFundingEscrowAbi, lifecycleRegistryAbi, LifecyclePhase, LIFECYCLE_REQUIRED_CAPABILITIES, planLaunch, readLifecycleProfiles, simulateLaunchPlan } = await import(sdkPath);
const address = (n) => toHex(BigInt(n), { size: 20 });
const ACCOUNT = address(0xa0), CORE = address(0xf0), REGISTRY = address(0xf1), ESCROW = address(0xf2), ADAPTER = address(0xf3), FACTORY = address(0xf4), TOKEN = address(0x10);
const CODE = "0x600160005560016000f3";
const HASH = toHex(42n, { size: 32 }), FOREIGN_HASH = toHex(43n, { size: 32 }), DIGEST = keccak256(CODE);
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
    token: { kind: 0, rewardMode: 0, name: "Admission", symbol: "ADM", supply: 1000n, nftUnit: 0n, metadataURI: "", salt: toHex(7n, { size: 32 }), inventoryRecipient: ACCOUNT, burnOnCancel: false },
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
  const state = { balance: 10n ** 24n, allowance: 10n, phase: LifecyclePhase.None, txCompute: 32_000_000n, blockCompute: 32_000_000n, rawVersion: 105n, poster: 0n, gasPrice: 2n, ...settings };
  const captured = [];
  let reorged = false, chainShifted = false;
  const registration = { adapterId: plan.markets[0].adapterId, configSchema: ABYSS_LIFECYCLE_CONFIG_SCHEMA, dependencyDigest: DIGEST, venue: FACTORY, factory: FACTORY, hook: zeroAddress, capabilities: LIFECYCLE_REQUIRED_CAPABILITIES, enabled: true };
  const adapterRegistration = { implementation: ADAPTER, codeHash: DIGEST, capabilities: LIFECYCLE_REQUIRED_CAPABILITIES, configVersion: 1, enabled: true };
  const decode = (data, abi) => decodeFunctionData({ abi, data });
  const output = (abi, functionName, result) => encodeFunctionResult({ abi, functionName, result });
  const client = { state, captured, async request({ method, params = [] }) {
    captured.push({ method, params });
    if (["eth_sendTransaction", "eth_sendRawTransaction", "evm_snapshot", "anvil_reset"].includes(method)) assert.fail("Source and submission admission must remain read-only");
    if (method === "eth_chainId") return toHex(chainShifted ? plan.chainId + 1n : plan.chainId);
    if (method === "eth_getBlockByNumber") return { number: toHex(42n), hash: reorged ? FOREIGN_HASH : HASH, timestamp: "0x64", gasLimit: toHex(state.headerGas ?? (plan.chainId === 4663n ? 1n << 50n : 30_000_000n)), baseFeePerGas: toHex(state.gasPrice) };
    if (method === "eth_getCode") return typeof state.codeFor === "function" ? state.codeFor(params[0]) : params[0].toLowerCase() === ACCOUNT.toLowerCase() ? state.accountCode ?? "0x" : CODE;
    if (method === "eth_getBalance") return toHex(state.balance);
    if (method === "eth_getTransactionCount") return "0x0";
    if (method === "eth_gasPrice") return toHex(state.gasPrice);
    if (method === "eth_call") {
      assert.equal(params[1], "0x2a", "All authority and fee reads must stay pinned");
      const { to, data } = params[0];
      const target = to.toLowerCase();
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
        assert.ok(captured.some((row) => row.method === "eth_simulateV1" && row.params[0].blockStateCalls.some((block) => block.calls.some((tx) => tx.to === ARB_SYS))), "Native metering probe precedes poster budgeting");
        state.posterRequests ??= [];
        state.posterRequests.push({ request: params[0], args: call.args });
        return state.posterResponse ?? output(nodeInterfaceAbi, "gasEstimateL1Component", [state.poster, state.gasPrice, state.poster === 0n ? 0n : 3n]);
      }
      const abis = target === CORE ? [launchLifecycleAbi] : target === REGISTRY ? [lifecycleRegistryAbi] : target === ESCROW ? [lifecycleFundingEscrowAbi] : target === ADAPTER ? [abyssLifecycleAdapterAbi, lifecycleAdapterAbi] : [lifecycleErc20Abi];
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
        case "readLaunchProgress": return output(abi, call.functionName, progress(plan, state.phase));
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
        if (state.probeFailure) throw new Error("Generic EVM lacks ArbOS metering");
        const values = [state.rawVersion, state.txCompute, state.blockCompute];
        return [{ calls: values.map((value, index) => ({ status: "0x1", gasUsed: "0x5208", returnData: state.probeResponse ?? toHex(value + (state.probeMismatch === index ? 1n : 0n), { size: 32 }) })) }];
      }
      assert.ok(request.blockStateCalls.every((block) => block.stateOverrides === undefined), "Capability probe balance must never leak into actual execution proof");
      if (state.simulationUnavailable) throw new Error("Native sequential simulation unsupported");
      if (request.validation && state.replayThrow) throw new Error("Actual economic execution reverted");
      let phase = state.phase, prepared = 0, allowance = state.allowance, stopped = false;
      const blocks = request.blockStateCalls.map((block) => {
        if (stopped) return { calls: [{ status: "0x0", gasUsed: "0x0", returnData: "0x", error: { message: "Prior dependent execution failed" } }] };
        assert.equal(block.calls.length, 1, "Actual dependent state is carried between ordered blocks");
        assert.equal(block.blockOverrides.baseFeePerGas, undefined, "Exact execution cannot fabricate fee-bearing block state");
        const tx = block.calls[0];
        const abi = tx.to.toLowerCase() === CORE ? launchLifecycleAbi : lifecycleErc20Abi;
        const { functionName, args = [] } = decode(tx.data, abi);
        const used = typeof state.gasFor === "function" ? state.gasFor(functionName, args, request.validation, tx) : state.computeUsed ?? 1_000_000n;
        const fullUsed = used + (request.validation && plan.chainId === 4663n ? state.actualPoster ?? state.poster : 0n);
        const gas = BigInt(tx.gas);
        if (state.replayFail && request.validation || state.failActivation && ["launchAtomic", "activateLaunch"].includes(functionName) || fullUsed > gas || plan.chainId === 4663n && used > (state.txCompute < state.blockCompute ? state.txCompute : state.blockCompute)) {
          stopped = true;
          return { calls: [{ status: "0x0", gasUsed: toHex(fullUsed > gas ? gas : fullUsed), returnData: "0xdead", error: { message: "Committed execution reverted" } }] };
        }
        let returnData = "0x", logs = [];
        if (functionName === "approve") { allowance = args[1]; returnData = output(abi, functionName, true); }
        else if (functionName === "beginLaunch") { assert.equal(phase, LifecyclePhase.None); assert.ok(allowance >= 10n || plan.funding[0].kind === 1); phase = LifecyclePhase.Preparing; returnData = output(launchLifecycleAbi, functionName, progress(plan, phase)); }
        else if (functionName === "prepareMarkets") {
          assert.equal(phase, LifecyclePhase.Preparing); assert.equal(args[1], prepared);
          for (let index = args[1]; index < args[1] + args[2]; index++) logs.push(event("MarketPrepared", { launchId: hashLaunchIdentity(plan), marketIndex: index, canonicalId: identity(plan, index).canonicalId, adapter: ADAPTER, feeSource: address(0xf6), positionCount: 1 }));
          prepared += args[2]; if (prepared === plan.markets.length) phase = LifecyclePhase.Ready;
        } else if (["launchAtomic", "activateLaunch"].includes(functionName)) {
          if (functionName === "activateLaunch") { assert.equal(phase, LifecyclePhase.Ready); assert.equal(prepared, plan.markets.length); }
          else { assert.equal(phase, LifecyclePhase.None); assert.ok(allowance >= 10n || plan.funding[0].kind === 1); }
          phase = LifecyclePhase.Active;
          returnData = output(launchLifecycleAbi, functionName, { launchId: hashLaunchIdentity(plan), planHash: hashLaunchPlan(plan), token: TOKEN, feeHub: address(0xf6), rewards: zeroAddress, marketCount: plan.markets.length, positionCount: plan.markets.length, quoteSpent: plan.buys.map(() => 8n), tokenOut: plan.buys.map(() => state.badOutput ? 4n : 7n) });
          logs = [event("LaunchActivated", { launchId: hashLaunchIdentity(plan), planHash: hashLaunchPlan(plan), token: TOKEN, marketCount: plan.markets.length, positionCount: plan.markets.length })];
        } else if (functionName === "cancelLaunch") { assert.equal(phase, LifecyclePhase.Preparing); phase = LifecyclePhase.Cancelled; logs = [event("LaunchCancelled", { launchId: hashLaunchIdentity(plan), creator: ACCOUNT, inventoryBurned: false })]; }
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
const review = (client, plan, extra = {}) => planLaunch({ client, plan, account: ACCOUNT, mode: "atomic", ...extra });

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
  assert.ok(planned.simulation.limits.unknownExecutionConstraints.some((message) => /Independent chain/.test(message)));
  assert.deepEqual(planned.transactions.map((tx) => tx.kind), ["approve", "atomic"]);
  assert.equal(planned.transactions[1].estimate.gasLimit, 1_150_000n);
  assert.equal(planned.transactions[1].estimate.dataFeeIncludedInGas, false);
  assert.equal(planned.transactions[1].estimate.totalFee, undefined);
  const next = await buildNextTransaction({ client, planned });
  assert.equal(next.kind, "approve"); assert.equal(next.admission.blockHash, HASH); assert.equal(next.admission.transportPreflight, "not-requested");
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

test("batched review prepares fresh fees while funding is outstanding without starting economic execution", async () => {
  const plan = makePlan({ chainId: 4663n }), source = clientFor(plan, { allowance: 1n, gasPrice: 7n, poster: 200_000n });
  let releaseFunding;
  const fundingGate = new Promise((resolve) => { releaseFunding = resolve; });
  let fundingPending = false, feesPrepared = false;
  const client = { supportsReadBatching: true, async request(args) {
    if (args.method === "eth_simulateV1") assert.equal(fundingPending, false, "No native proof or economic execution may precede input admission");
    const response = await source.request(args);
    if (args.method === "eth_gasPrice") feesPrepared = true;
    if (args.method === "eth_call" && args.params[0].to === plan.funding[0].inputAsset &&
      decodeFunctionData({ abi: lifecycleErc20Abi, data: args.params[0].data }).functionName === "allowance") {
      fundingPending = true;
      await fundingGate;
      fundingPending = false;
    }
    return response;
  } };
  const pending = review(client, plan);
  await nextTurn();
  const overlapped = fundingPending && feesPrepared;
  releaseFunding();
  const planned = await pending;
  assert.equal(overlapped, true, "Fresh fee context must settle without waiting for independent funding");
  assert.equal(planned.simulation.admitted, true, planned.simulation.reason);
  const serial = await review(clientFor(plan, { allowance: 1n, gasPrice: 7n, poster: 200_000n }), plan);
  assert.deepEqual(planned, serial, "Overlap preserves the exact plan, zero-first approvals, native proof and gas/fee replay");
});

test("input refusal or failure discards a late rejected context without economic execution", async () => {
  for (const throwInput of [false, true]) {
    const plan = makePlan(), source = clientFor(plan, { tokenBalance: 0n });
    const inputFailure = new Error("Pinned funding allowance unavailable");
    let rejectFees, feesStarted = false;
    const feeGate = new Promise((_, reject) => { rejectFees = reject; });
    const client = { supportsReadBatching: true, request(args) {
      if (args.method === "eth_simulateV1") assert.fail("Refused inputs must never reach simulation");
      if (args.method === "eth_gasPrice") { feesStarted = true; return feeGate; }
      if (throwInput && args.method === "eth_call" && args.params[0].to === plan.funding[0].inputAsset &&
        decodeFunctionData({ abi: lifecycleErc20Abi, data: args.params[0].data }).functionName === "allowance") return Promise.reject(inputFailure);
      return source.request(args);
    } };
    try {
      if (throwInput) await assert.rejects(review(client, plan), (failure) => failure === inputFailure);
      else {
        const planned = await review(client, plan);
        assert.equal(planned.simulation.admitted, false);
        assert.match(planned.simulation.reason, /combined funding requirements/);
      }
      assert.equal(feesStarted, true);
    } finally {
      rejectFees(new Error("Late gas-price source failure"));
      await nextTurn();
    }
  }
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

test("batched Nitro measurement overlaps isolated probe and poster evidence but exact replay waits for both", async () => {
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
  const replayBeforePoster = started.has("replay");
  releasePoster();
  const planned = await pending;
  assert.deepEqual([...beforeProbe].sort(), ["measurement", "poster", "probe"]);
  assert.equal(replayBeforePoster, false, "Exact replay needs verified metering and the complete poster budget");
  assert.equal(planned.simulation.admitted, true, planned.simulation.reason);
  assert.equal(started.has("replay"), true);
  const reference = await review(clientFor(plan, { poster: 200_000n }), plan);
  assert.deepEqual(planned, reference, "Scheduling cannot change exact committed calldata, proof outcomes, gas or fee envelopes");
  assert.equal(source.captured.filter((row) => row.method === "eth_simulateV1").length, 3);
  assert.equal(source.captured.filter((row) => row.method === "eth_getBlockByNumber" && row.params[0] === "0x2a").length, 1,
    "The complete native sequence retains its outer canonical recheck, not a redundant probe-only round");
});

test("overlapped cap measurement never admits failed native evidence or unavailable execution", async () => {
  const plan = makePlan({ chainId: 4663n });
  for (const settings of [{ probeFailure: true }, { probeMismatch: 1 }, { posterResponse: "0x" }, { simulationUnavailable: true }]) {
    const client = clientFor(plan, settings);
    client.supportsReadBatching = true;
    const planned = await review(client, plan);
    assert.equal(planned.simulation.admitted, false);
    assert.equal(planned.simulation.executionProof, "unavailable");
    assert.match(planned.simulation.reason, /Native Nitro compute\/poster proof unavailable|Stateful sequential RPC simulation unavailable/);
    assert.equal(client.captured.some((row) => row.method === "eth_simulateV1" && row.params[0].validation &&
      row.params[0].blockStateCalls[0].calls[0].to !== ARB_SYS), false, "A permissive measurement is not exact execution proof");
    assert.equal(client.captured.some((row) => row.method === "eth_getBlockByNumber" && row.params[0] === "0x2a"), true);
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
  assert.equal(failed.simulation.admitted, false); assert.equal(failed.simulation.executionProof, "failed");
  assert.match(failed.simulation.reason, /validated|Validated/);
});

test("exact replay, postconditions, canonical block and account protections remain mandatory", async () => {
  const plan = makePlan();
  for (const settings of [{ replayThrow: true }, { replayFail: true }, { incompleteReplay: true }, { badOutput: true }]) {
    const planned = await review(clientFor(plan, settings), plan);
    assert.equal(planned.simulation.admitted, false); assert.equal(planned.simulation.executionProof, "failed");
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
  assert.equal(simulations.length, 6, "Atomic and staged each retain their native probe, discovery and exact validated replay");
  assert.ok(simulations.some((row) => !row.params[0].validation));
  assert.ok(client.captured.filter((row) => row.method === "eth_chainId").length >= 6);
  assert.equal(client.captured.filter((row) => row.method === "eth_getBlockByNumber" && row.params[0] === "0x2a").length, 2,
    "Atomic and staged simulations each retain their final canonical hash check");
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

  for (const names of [["hashPlan", "launchIdOf"], ["balanceOf", "allowance"]]) {
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
    { blocked: `${REGISTRY}:adapter`, expected: [`${REGISTRY}:profileTopology`] },
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
    if (!admitted) assert.match(profile.reason, /IneligibleImplementation/);
  }
});

test("certified Abyss discovery still rejects mismatched canonical registry identities", async () => {
  const plan = makePlan({ chainId: 4663n });
  for (const profileOverrides of [{ factory: address(0xff) }, { venue: address(0xff) }, { hook: address(0xff) }]) {
    const client = clientFor(plan, { profileOverrides });
    const [profile] = await readLifecycleProfiles({ client, orchestrator: CORE, profileIds: [plan.markets[0].profileId] });
    assert.equal(profile.admitted, false);
    assert.match(profile.reason, /canonical factory\/variant\/schema binding/);
  }
});

test("a changed live graph digest invalidates an admitted plan before build-next", async () => {
  const plan = makePlan({ chainId: 4663n }), client = clientFor(plan);
  const baseline = await review(client, plan);
  assert.equal(baseline.simulation.admitted, true, baseline.simulation.reason);
  client.state.graphDigest = FOREIGN_HASH;
  const changed = await review(client, plan);
  assert.equal(changed.simulation.admitted, false);
  assert.match(changed.simulation.reason, /IneligibleImplementation/);
  await assert.rejects(buildNextTransaction({ client, planned: baseline }), { code: "PLAN_NOT_ADMITTED" });
});

test("conversion input admission does not wait for independent profile certification", async () => {
  const plan = makePlan();
  plan.funding = plan.funding.map((funding) => ({ ...funding, kind: 2, inputAsset: address(0x30), inputAmount: 20n, target: address(0xfc), data: "0x1234" }));
  const source = clientFor(plan);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let inputRead = false;
  const client = { supportsReadBatching: true, async request(args) {
    if (args.method === "eth_call" && args.params[0].to === REGISTRY &&
      decodeFunctionData({ abi: lifecycleRegistryAbi, data: args.params[0].data }).functionName === "requireEligible") await gate;
    if (args.method === "eth_call" && args.params[0].to === REGISTRY &&
      decodeFunctionData({ abi: lifecycleRegistryAbi, data: args.params[0].data }).functionName === "fundingInputAllowed") inputRead = true;
    return source.request(args);
  } };
  const pending = review(client, plan);
  await nextTurn();
  const inputBeforeCertification = inputRead;
  release();
  const planned = await pending;
  assert.equal(inputBeforeCertification, true);
  assert.equal(planned.simulation.admitted, true, planned.simulation.reason);
  assert.deepEqual(planned.transactions.map((transaction) => transaction.kind), ["approve-reset", "approve", "atomic"]);
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
  assert.match(insufficient.simulation.reason, /combined funding requirements/);
});

test("fresh invocations cannot reuse superseded code, registry or escrow authority", async () => {
  const plan = makePlan(), client = clientFor(plan);
  const baseline = await review(client, plan);
  assert.equal(baseline.simulation.admitted, true);
  client.state.codeFor = (target) => target.toLowerCase() === ADAPTER ? "0x600260005560026000f3" : target.toLowerCase() === ACCOUNT ? "0x" : CODE;
  const changed = await review(client, plan);
  assert.equal(changed.simulation.admitted, false);
  assert.match(changed.simulation.reason, /IneligibleImplementation/);
  delete client.state.codeFor;
  client.state.authorities = { [REGISTRY]: address(0xff) };
  await assert.rejects(review(client, plan), { code: "REGISTRY_BINDING" });
  client.state.authorities = { [ESCROW]: address(0xff) };
  await assert.rejects(review(client, plan), { code: "FUNDING_BINDING" });
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
  assert.match(rows[1].reason, /pinned topology is unavailable/);
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
