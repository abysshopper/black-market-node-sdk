import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { encodeAbiParameters, keccak256 } from "viem";

const sdkPath = process.env.SDK_SOURCE_TEST === "1" ? "../src/lifecycle/index.ts" : "../dist/lifecycle/index.js";
const { adapterRegistrationV1Components, buildNextTransaction, hashLaunchIdentity, hashLaunchPlan, launchLifecycleAbi, lifecycleAdapterAbi, lifecycleDirectoryAbi, lifecycleErc20Abi, lifecycleFundingEscrowAbi, lifecycleMarketComponents, LifecyclePhase, lifecycleRegistryAbi, launchProgressV1Components, marketIdentityV1Components, parseLaunchPlan, planLaunch, preparedMarketV1Components, profileRegistrationV1Components, readLaunchProgress, simulateLaunchPlan } = await import(sdkPath);
const fixture = JSON.parse(await readFile(new URL("./fixtures/launch-lifecycle-v1.json", import.meta.url), "utf8"));
// Deterministic fake-RPC consumer fixtures for the observed corrective
// behaviors: injected chain state only, no network, no mocked SDK echoes.
// Contract answers are encoded with the frozen public ABI exactly as a chain
// node would answer.
const HEAD_NUMBER = 900n;
const HEAD_HASH = "0x" + "ab".repeat(32);
const OBSERVED_HASH = "0x" + "cd".repeat(32);
const FOREIGN_HASH = "0x" + "ef".repeat(32);
const TX_HASH = "0x" + "01".repeat(32);
const REGISTRY = "0x0000000000000000000000000000000000000001";
const ESCROW = "0x0000000000000000000000000000000000000002";
const TOKEN = "0x0000000000000000000000000000000000000003";
const ADAPTER = "0x0000000000000000000000000000000000000004";
const CODE = "0x6001800101";
const HEADROOM = 1500;


function hex(value) {
  return typeof value === "bigint" ? `0x${value.toString(16)}` : value;
}
function word(value) {
  return "0x" + BigInt(value).toString(16).padStart(64, "0");
}

function blockObject(number = HEAD_NUMBER, hash = HEAD_HASH) {
  return { number: hex(number), hash, timestamp: hex(1_900_000_000n), gasLimit: hex(30_000_000n), baseFeePerGas: hex(7n) };
}

function emptyProgress() {
  return { launchId: "0x" + "0".repeat(64), planHash: "0x" + "0".repeat(64), creator: "0x0000000000000000000000000000000000000000", nonce: 0n, mode: 0, phase: 0, token: "0x0000000000000000000000000000000000000000", feeHub: "0x0000000000000000000000000000000000000000", rewards: "0x0000000000000000000000000000000000000000", preparedMarkets: 0, marketCount: 0, buyCount: 0, positionCount: 0, deadline: 0n };
}

function startedProgress(plan, { phase = LifecyclePhase.Preparing, prepared = 0, mode = 1 } = {}) {
  return { launchId: hashLaunchIdentity(plan), planHash: hashLaunchPlan(plan), creator: plan.creator, nonce: plan.nonce, mode, phase, token: TOKEN, feeHub: "0x0000000000000000000000000000000000000005", rewards: "0x0000000000000000000000000000000000000006", preparedMarkets: prepared, marketCount: plan.markets.length, buyCount: plan.buys.length, positionCount: 0, deadline: plan.deadline };
}

function progressTuple(progress) {
  return encodeAbiParameters([{ type: "tuple", components: [...launchProgressV1Components] }], [progress]);
}

function identityTuple(plan, market) {
  // Exact canonical V4 identity per the frozen ABI: pool must be zero and the
  // PoolKey-derived poolId/canonicalId must satisfy the SDK's identity rules.
  const hook = "0x0000000000000000000000000000000000001afc";
  const currency0 = BigInt(TOKEN) < BigInt(market.quoteAsset) ? TOKEN : market.quoteAsset;
  const currency1 = BigInt(TOKEN) < BigInt(market.quoteAsset) ? market.quoteAsset : TOKEN;
  const fee = 3000;
  const tickSpacing = 60;
  const poolId = keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }], [currency0, currency1, fee, tickSpacing, hook]));
  const canonicalId = keccak256(encodeAbiParameters([
    { type: "uint256" }, { type: "uint8" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" },
  ], [plan.chainId, 0, ADAPTER, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", poolId, market.profileId]));
  return { venue: 0, canonicalId, manager: ADAPTER, factory: "0x0000000000000000000000000000000000000000", pool: "0x0000000000000000000000000000000000000000", poolId, profileId: market.profileId, currency0, currency1, fee, tickSpacing, hook, openingSqrtPriceX96: 2n ** 96n };
}

function profileAnswer() {
  return encodeAbiParameters([{ type: "tuple", components: [...profileRegistrationV1Components] }], [{
    adapterId: "0x" + "0d".repeat(32), configSchema: "0x" + "0e".repeat(32), dependencyDigest: "0x" + "0f".repeat(32),
    venue: ADAPTER, factory: ADAPTER, hook: ADAPTER, capabilities: 123n, enabled: true,
  }]);
}
function padAddress(address) {
  return "0x" + address.slice(2).toLowerCase().padStart(64, "0");
}

function padBool(value) {
  return "0x" + (value ? "1" : "0").padStart(64, "0");
}
function adapterAnswer(configVersion) {
  return encodeAbiParameters([{ type: "tuple", components: [...adapterRegistrationV1Components] }], [{ implementation: ADAPTER, codeHash: keccak256(CODE), capabilities: 123n, configVersion, enabled: true }]);
}

/** Deterministic canonical-state consumer. Scenario hooks override exactly one
 * observation each. */
function scenarioClient({ progress = emptyProgress(), headProgress = null, receipt = () => null, observedBlock = () => ({ number: HEAD_NUMBER - 1n, hash: OBSERVED_HASH }), simulate = () => { throw new Error("eth_simulateV1 is not supported"); }, txCount = () => 10n } = {}) {
  const plan = parseLaunchPlan(JSON.stringify(fixture.plan));
  const clients = {
    plan,
    captured: [],
    async request({ method, params = [] }) {
      clients.captured.push({ method, params });
      const data = params[0]?.data;
      const selector = typeof data === "string" ? data.slice(0, 10) : "";
      switch (method) {
        case "eth_chainId": return "0x7a69";
        case "eth_getBlockByNumber": {
          const tag = params[0];
          if (tag === "latest") return blockObject();
          const number = BigInt(tag);
          if (number === HEAD_NUMBER) return blockObject();
          if (number === HEAD_NUMBER - 1n) { const observed = observedBlock(); return observed === null ? null : blockObject(observed.number, observed.hash); }
          return null;
        }
        case "eth_getTransactionCount": return hex(txCount());
        case "eth_getBalance": return hex(10n ** 21n);
        case "eth_getCode": return params[0].toLowerCase() === plan.creator.toLowerCase() ? "0x" : CODE;
        case "eth_gasPrice": return hex(2n);
        case "eth_call": {
          const target = params[0].to.toLowerCase();
          if (selectorOf(launchLifecycleAbi, "readLaunchProgress") === selector) {
            // The SDK reads head first, then the confirmed canonical block.
            const reads = clients.captured.filter((row) => row.method === "eth_call" && row.params?.[0]?.data?.slice(0, 10) === selector).length;
            return progressTuple(reads <= 1 ? headProgress ?? progress : progress);
          }
          if (selectorOf(launchLifecycleAbi, "hashPlan") === selector) return hashLaunchPlan(plan);
          if (selectorOf(launchLifecycleAbi, "predictToken") === selector) return padAddress(TOKEN);
          if (selectorOf(launchLifecycleAbi, "launchIdOf") === selector) return hashLaunchIdentity(plan);
          if (selectorOf(launchLifecycleAbi, "tokenFactory") === selector) return padAddress(ADAPTER);
          if (selectorOf(launchLifecycleAbi, "fundingEscrow") === selector) return padAddress(ESCROW);
          if (selectorOf(launchLifecycleAbi, "registry") === selector) return padAddress(REGISTRY);
          if (target === ESCROW.toLowerCase() && selectorOf(lifecycleFundingEscrowAbi, "wrappedNative") === selector) return padAddress("0x0000000000000000000000000000000000000030");
          if (selectorOf(launchLifecycleAbi, "directory") === selector) return padAddress(REGISTRY);
          if (target === ESCROW.toLowerCase() && selectorOf(lifecycleRegistryAbi, "core") === selector) return padAddress(plan.orchestrator);
          if (selectorOf(lifecycleErc20Abi, "balanceOf") === selector) return word(10n ** 21n);
          if (selectorOf(lifecycleErc20Abi, "allowance") === selector) return word(10n ** 21n);
          if (selectorOf(lifecycleRegistryAbi, "core") === selector) return padAddress(plan.orchestrator);
          if (selectorOf(lifecycleRegistryAbi, "fundingInputAllowed") === selector) return padBool(true);
          if (selectorOf(lifecycleRegistryAbi, "requireEligible") === selector) return padAddress(ADAPTER);
          if (selectorOf(lifecycleRegistryAbi, "protocolMaximumDeveloperFeeBps") === selector) return word(1000n);
          if (selectorOf(lifecycleRegistryAbi, "profileIds") === selector) {
            const ids = plan.markets.map((market) => market.profileId.slice(2)).join("");
            return "0x" + (plan.markets.length * 32).toString(16).padStart(64, "0") + ids;
          }
          if (selectorOf(lifecycleRegistryAbi, "profile") === selector) return profileAnswer();
          if (selectorOf(lifecycleRegistryAbi, "adapter") === selector) {
            const market = plan.markets.find((item) => data.toLowerCase().endsWith(item.adapterId.slice(2).toLowerCase())) ?? plan.markets[0];
            return adapterAnswer(market.configVersion);
          }
          if (selectorOf(lifecycleAdapterAbi, "core") === selector) return padAddress(plan.orchestrator);
          if (selectorOf(lifecycleAdapterAbi, "resolve") === selector) {
            // resolve(launchId, token, market): the committed market tuple is
            // ABI-encoded inline; identify it by its unique profileId word.
            const market = plan.markets.find((item) => data.toLowerCase().includes(item.profileId.slice(2).toLowerCase())) ?? plan.markets[0];
            return encodeAbiParameters([{ type: "tuple", components: [...marketIdentityV1Components] }], [identityTuple(plan, market)]);
          }
          if (selector === directoryMarketSelector()) {
            // market(bytes32 launchId, uint32 marketIndex): the index is the second argument word.
            const index = Number(BigInt("0x" + data.slice(10 + 64, 10 + 128)));
            const market = plan.markets[index] ?? plan.markets[0];
            const prepared = { identity: identityTuple(plan, market), feeSource: "0x0000000000000000000000000000000000000007", custody: "0x0000000000000000000000000000000000000008", mintExecutor: "0x0000000000000000000000000000000000000009", buyExecutor: "0x000000000000000000000000000000000000000a", exclusions: [], positionCount: 0 };
            return encodeAbiParameters([{ type: "address" }, { type: "tuple", components: [...preparedMarketV1Components] }], [ADAPTER, prepared]);
          }
          throw new Error(`unexpected eth_call selector ${selector} to ${params[0].to}`);
        }
        case "eth_getTransactionReceipt": return receipt();
        case "eth_getTransactionByHash": return null;
        case "eth_simulateV1": return simulate(params);
        default: throw new Error(`unexpected RPC method ${method}`);
      }
    },
  };
  return clients;
}

function selectorOf(abi, functionName) {
  const item = [...abi].find((entry) => entry.type === "function" && entry.name === functionName);
  if (item === undefined) throw new Error(`no ABI function ${functionName}`);
  return keccak256(Buffer.from(`${functionName}(${item.inputs.map(canonicalType).join(",")})`)).slice(0, 10);
}

function directoryMarketSelector() {
  return selectorOf(lifecycleDirectoryAbi, "market");
}

function canonicalType(input) {
  if (input.type.startsWith("tuple")) return `(${input.components.map(canonicalType).join(",")})${input.type.slice(5)}`;
  return input.type;
}

function minimalPlanned(plan) {
  const simulation = { backend: "unavailable", confidence: "provisional", admitted: false, blockNumber: HEAD_NUMBER, blockHash: HEAD_HASH, account: plan.creator, chainId: plan.chainId, limits: { executionGasCeiling: 30_000_000n, headroomBps: HEADROOM, blockGasLimit: 30_000_000n, admissionKnown: true, unknownExecutionConstraints: [], unknownConstraints: [] }, steps: [] };
  return {
    plan, planHash: hashLaunchPlan(plan), launchId: hashLaunchIdentity(plan), predictedToken: TOKEN, tokenFactory: ADAPTER, tokenFactoryCodeHash: keccak256(CODE), hookDeployments: [],
    account: plan.creator, chainId: plan.chainId, mode: "staged", confirmations: 1,
    transactions: [], prerequisites: [], profiles: [], simulation, atomicAttempt: simulation,
    progress: null, preparationBatchSize: plan.markets.length,
  };
}


/** F4: absent receipt with the SAME canonical observed block is pending, never reorged. */
test("absent receipt with an unchanged observed block stays pending and blocks further work", async () => {
  const client = scenarioClient({ receipt: () => null });
  const plan = parseLaunchPlan(JSON.stringify(fixture.plan));
  const reference = { transactionHash: TX_HASH, observedBlockNumber: HEAD_NUMBER - 1n, observedBlockHash: OBSERVED_HASH, confirmations: 2 };
  const progress = await readLaunchProgress({ client, planned: minimalPlanned(plan), receipts: [reference], confirmations: 2 });
  assert.equal(progress.receipts[0].status, "pending", "an unchanged observed block with an absent receipt is pending, not reorged");
  assert.equal(progress.receipts[0].blockHash, OBSERVED_HASH);
  await assert.rejects(
    buildNextTransaction({ client, planned: minimalPlanned(plan), action: "continue", receipts: [reference], confirmations: 2 }),
    { code: "RECEIPT_PENDING" },
  );
});

/** F4 counterpart: a genuinely changed canonical observed block is still a reorg. */
test("absent receipt under a changed canonical observed block remains a real reorg", async () => {
  const client = scenarioClient({ receipt: () => null, observedBlock: () => ({ number: HEAD_NUMBER - 1n, hash: FOREIGN_HASH }) });
  const plan = parseLaunchPlan(JSON.stringify(fixture.plan));
  const reference = { transactionHash: TX_HASH, observedBlockNumber: HEAD_NUMBER - 1n, observedBlockHash: OBSERVED_HASH, confirmations: 2 };
  const progress = await readLaunchProgress({ client, planned: minimalPlanned(plan), receipts: [reference], confirmations: 2 });
  assert.equal(progress.receipts[0].status, "reorged", "a changed canonical observed block is a real reorg");
  assert.equal(progress.receipts[0].blockHash, OBSERVED_HASH);
});

/** F3: confirmed canonical terminal phase returns no work before any other gate. */
test("confirmed terminal canonical phase returns no work without consulting the creator nonce", async () => {
  const plan = parseLaunchPlan(JSON.stringify(fixture.plan));
  for (const { label, phase, mode, selected } of [{ label: "Active", phase: 4, mode: 0, selected: "atomic" }, { label: "Cancelled", phase: 5, mode: 1, selected: "staged" }]) {
    const client = scenarioClient({
      progress: startedProgress(plan, { phase, prepared: plan.markets.length, mode }),
      // A drifting creator nonce is the previously-first, unrelated gate: the
      // terminal no-work answer must be returned before UNCONFIRMED_STATE.
      txCount: () => 11n,
    });
    const planned = { ...minimalPlanned(plan), mode: selected };
    const next = await buildNextTransaction({ client, planned, action: "continue" });
    assert.equal(next, undefined, `${label} is terminal; no transaction remains`);
  }
});

/** F3: head-only activation is not terminal: confirmation gate still applies. */
test("head-only activation is not terminal and still waits for confirmation depth", async () => {
  const plan = parseLaunchPlan(JSON.stringify(fixture.plan));
  const client = scenarioClient({
    progress: startedProgress(plan, { phase: LifecyclePhase.Preparing, prepared: 0, mode: 1 }),
    headProgress: startedProgress(plan, { phase: 4, prepared: plan.markets.length, mode: 1 }),
  });
  await assert.rejects(
    buildNextTransaction({ client, planned: minimalPlanned(plan), action: "continue", confirmations: 2 }),
    { code: "UNCONFIRMED_STATE" },
  );
});

/** F5: resimulation inherits the submitted receipt evidence and confirmation depth. */
test("simulateLaunchPlan inherits submitted pending receipt evidence instead of dropping it", async () => {
  const client = scenarioClient({ receipt: () => null });
  const plan = parseLaunchPlan(JSON.stringify(fixture.plan));
  const receipts = [{ transactionHash: TX_HASH, observedBlockNumber: HEAD_NUMBER - 1n, observedBlockHash: OBSERVED_HASH, confirmations: 2 }];
  const evidence = await readLaunchProgress({ client, planned: minimalPlanned(plan), receipts, confirmations: 2 });
  assert.equal(evidence.receipts[0].status, "pending");
  const resimulated = await simulateLaunchPlan({ client, planned: minimalPlanned(plan), receipts, confirmations: 2 });
  assert.equal(resimulated.admitted, false, "resimulation must not silently drop the submitted pending receipt evidence");
  assert.match(resimulated.reason ?? "", /receipt confirmation/i);
});
