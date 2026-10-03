# Versioned launch lifecycle API

`@black-market/sdk/lifecycle` is the browser-safe, opt-in API for the new lifecycle stack. The same exports are available from `@black-market/sdk`. It does not select or change any legacy deployment address, Unified Launcher request, default route, or fee-only V1 deployment. Supply the exact chain, orchestrator, creator and immutable adapter/profile IDs from a reviewed deployment. No SDK planning operation signs, publishes metadata, or broadcasts a transaction on that source chain.

The architecture is defined in the sibling application repository's [launch ADR](../../black-market/docs/adr-launch-architecture.md) and [multi-market design](../../black-market/docs/multi-market-launch-design.md). Solidity `LaunchTypesV1.sol` and `ILaunchLifecycleV1.sol` are the wire authority. A source implementation or successful local simulation is not production deployment approval.

## Public operations

| Operation | Observable contract |
| --- | --- |
| `planLaunch({ client, account, plan, mode, limits, fork?, receipts?, confirmations? })` | Validates the complete domain, current funding and registry admissions, reads canonical state, attempts the exact atomic sequence first, and returns the explicitly selected execution graph with current stateful admission evidence. |
| `simulateLaunchPlan({ client, planned, limits?, fork? })` | Re-reads canonical state and simulates only the remaining work, not a previously cached list of transactions. It never changes the selected mode or economics. |
| `buildNextTransaction({ client, planned, limits?, fork?, receipts?, confirmations?, action? })` | Reads canonical confirmed progress and account nonces again, refreshes limits and remaining-sequence proof, then returns one executable transaction. `action: "cancel"` builds creator cancellation without invoking disabled adapters. Terminal launches return `undefined`. |
| `readLaunchProgress({ client, planned, receipts?, confirmations? })` | Returns confirmation-bound canonical progress, latest-head progress, account nonce/confirmation safety, canonical receipt status and prepared market identity/live state. It does not advance a local step counter. |
| `readLifecycleProfiles({ client, orchestrator, profileIds? })` | Reads immutable profile/adapter approval and current availability; omitted IDs use bounded registry enumeration. |
| `predictLifecycleToken({ client, plan })` | Reads the exact lifecycle token prediction from the explicit orchestrator. |

`client` can be a viem public client or a raw `request({ method, params })` JSON-RPC client. Transport, wallet, signing and durable application storage remain caller-owned. `PlannedLaunch` contains live limit callbacks and bigint values; persist the economic plan with `serializeLaunchPlan`, plus the explicit mode, confirmation policy and receipt references, rather than serializing the entire planning object.

### Commitment and exact integer representation

`LaunchPlanV1` contains:

- Domain: `chainId`, `orchestrator`, `creator`, `nonce`.
- Token: ERC20/ERC404 kind, None/Staking/Dividends rewards, name/symbol, supply, NFT unit/metadata, deterministic salt, inventory recipient and burn-on-cancel policy.
- Funding: sorted output assets, amounts, ERC20/NativeWrap/Swap kind, input asset/amount, allowlisted target and exact calldata.
- Sorted fee assets: per-asset owner/rewards/burn basis points, each summing to 10,000. Only the predicted launch token can have a burn share.
- Ordered markets: immutable adapter/profile IDs, quote asset, explicit token budget, config version and exact opaque venue bytes.
- Ordered buys: market index, quote input, minimum token output, recipient and square-root price limit. Repeated market indices retain their original ordering.
- Deadline and executor fee basis points.

The ABI component exports and `launchLifecycleAbi` describe the exact Solidity tuple; this is not the old `LaunchRequestV3`. All uint256/uint160/uint128 values use bigint in memory and decimal strings in portable JSON. The guarded parser rejects lossy JSON numbers and out-of-width values. Mode and preparation batching are execution metadata and do not appear in the economic tuple.

```ts
import {
  encodeLaunchPlan, hashLaunchIdentity, hashLaunchPlan,
  parseLaunchPlan, serializeLaunchPlan,
} from "@black-market/sdk/lifecycle";

const plan = parseLaunchPlan(savedEconomicPlanJson);
const encoded = encodeLaunchPlan(plan);
const planHash = hashLaunchPlan(plan);
const launchId = hashLaunchIdentity(plan);
const durableEconomicPlanJson = serializeLaunchPlan(plan);
```

`hashLaunchPlan` is `keccak256(abi.encode(keccak256(bytes("BLACK_MARKET_LAUNCH_PLAN_V1")), plan))`. `hashLaunchIdentity` is `keccak256(abi.encode(chainId, orchestrator, creator, nonce))`. Prediction depends on this identity plus token configuration, not the economic plan hash: the predicted address can therefore be included literally in sorted fee policies without a circular dependency. A creator nonce binds one economic plan; changing economics after begin is rejected.

ABI bounds are 1–16 markets, 1–8 fee assets, at most 8 funding outputs, at most 64 ordered buys, and at most 32 total launch positions. These bounds are not a gas guarantee. Reward-free ERC20 retains the full positive uint256 supply domain; staking/dividend ERC20 supply is at most `10^77`, and ERC404 supply must fit uint96. The exports `LIFECYCLE_MAX_ERC20_SUPPLY`, `LIFECYCLE_MAX_REWARD_ERC20_SUPPLY` and `LIFECYCLE_MAX_ERC404_SUPPLY` expose those exact domains; the reward cap prevents share/supply precision loss in the bounded reward accounting model. The tuple and hashes are unchanged by these semantic limits.

### Venue configuration

Use `encodeV4LifecycleMarketConfig` / `decodeV4LifecycleMarketConfig` and `encodeAbyssLifecycleMarketConfig` / `decodeAbyssLifecycleMarketConfig`. Their types and ABI components match the ordinary-call lifecycle adapters, not legacy complete-launch adapters.

- V4 config version is 1. It commits LP/hook fee fields, tick spacing, opening square-root price, treasury, external-liquidity policy and ordered positions. Each position commits ticks, liquidity, salt and maximum launch-token amount. The frozen fee-only V4 root has no oracle: `readMarket().oracleReadyAt` is always `0` for V4, while canonical Abyss pools disclose their pool-genesis timestamp at preparation.
- Abyss config commits profile 0–3, fee, oracle configuration ID, opening square-root price and ordered positions with ticks, liquidity and token maxima.
- Select only an approved immutable profile whose schema, capabilities and dependencies match the deployed implementation. Runtime code hashes, core authority and pending eligibility are checked again before the next transaction.
- Position ranges must require **zero quote deposit** at the committed opening price in the actual token orientation. Quote funding is for ordered buys, never two-sided initial LP seeding.
- Canonical pool identity includes chain, venue, manager/factory, pool/pool ID and profile. A V4 market is the full PoolKey, not only its currency pair. Duplicate canonical markets are rejected by actual stateful execution.

## Explicit atomic versus staged consent

Every `planLaunch` call requires `mode: "atomic" | "staged"`. For an unstarted plan the SDK tries exact approval/funding plus atomic launch before constructing the requested staged graph. `atomicAttempt` preserves that evidence separately from `simulation`.

- **Atomic:** all token construction, empty-pool preparation, minting/permanent locking, all ordered buys and public activation are one core transaction after any required approvals. An over-cap or failed atomic attempt is returned as unadmitted. The SDK never silently changes it to staged.
- **Staged:** approvals, `beginLaunch`, contiguous ordered `prepareMarkets` batches, then exactly one `activateLaunch`. Only empty infrastructure preparation can be split. The SDK reduces preparation batch size when that preparation transaction cannot fit.
- **Activation is indivisible:** it mints/locks all positions, executes all committed buys and opens every market atomically. If activation itself cannot fit, staging is also unadmitted. No buy, market or minimum output is omitted to manufacture success.

Public `beginLaunch` accepts Staged only. Both canonical venues support atomic and staged execution; the capability mask is identical for every mode (TOKEN_ONLY|EMPTY_PREPARE|PERMANENT_CUSTODY|CANONICAL_FEES, plus ERC404 for ERC404 tokens). The retired POOL_GATE bit is never requested: preactivation protection on both venues is the launch token's transfer restrictions plus the adapter's activation-time canonical opening-state verification. A prepared pool whose committed opening price or sealed liquidity was manipulated (including zero-liquidity price moves or dust seeding before activation) fails verification: the launch stays Ready and cancellable instead of activating a manipulated market. A failed activation leaves the committed launch Ready; its pools remain at their verified canonical opening state and its unspent external funding remains cancellable. Preparation gas and deployed contracts cannot be undone.

```ts
const atomic = await planLaunch({ client, account, plan, mode: "atomic", limits });
if (!atomic.simulation.admitted) {
  // Present the refusal first. Call this only after separate explicit user consent.
  const staged = await planLaunch({ client, account, plan, mode: "staged", limits });
  // The economics and token prediction remain identical; staged may still be refused.
}
```

## Current execution constraints and fee confidence

An executable result requires all four applicable caps: `chainGasLimit`, `rpcGasLimit`, `accountGasLimit` and `maxCalldataBytes`. Unknown caps produce an exploratory, unadmitted result even if stateful execution succeeds. The live block gas limit alone is not a chain per-transaction limit, and historical feasibility numbers are not current RPC/account admission.

The preferred `LifecycleLimitSource` is an async callback. It must obtain the actual current constraints for the callback's source RPC, chain, account and orchestrator, and return matching `chainId`, `account`, `orchestrator`, `observedBlockNumber` and `observedBlockHash`. Missing/stale/mismatched provenance or a failed limit service prevents admission. Do not merely label cached constraints with the requested block; validate the service's returned context and provider binding.

```ts
import type { LifecycleLimitSource } from "@black-market/sdk/lifecycle";

const limits: LifecycleLimitSource = async (context) => {
  // Application/operator-owned service; its response is already checked against
  // this source RPC and the exact requested chain/account/core/block context.
  const current = await admissionService.readCurrentConstraints(context);
  return {
    chainId: current.chainId,
    account: current.account,
    orchestrator: current.orchestrator,
    observedBlockNumber: current.blockNumber,
    observedBlockHash: current.blockHash,
    chainGasLimit: current.chainTransactionGasLimit,
    rpcGasLimit: current.rpcTransactionGasLimit,
    accountGasLimit: current.accountTransactionGasLimit,
    maxCalldataBytes: current.maxCalldataBytes,
    headroomBps: current.headroomBps,
    maxSimulationGas: current.maxSimulationGas,
    estimateDataFee: current.estimateDataFee,
  };
};
```

The execution ceiling is the minimum of the live block gas limit and the three explicit transaction caps. Default headroom is 1,500 bps; an operator can choose 0–10,000 bps. The requested gas limit is the rounded-up measured/estimated requirement plus headroom, and the complete stateful sequence must pass again at those exact limits. For real fork execution, gross required gas from sequential `eth_estimateGas` is used rather than treating refund-reduced receipt gas as the executable minimum.

Each admitted transaction includes the proved `gas` and `gasPrice`. `executionFee` is the upper execution envelope `gasLimit * gasPrice`. A chain-specific `estimateDataFee` callback receives the exact transaction and pinned context; when available, `dataFee` and `totalFee` are included with `feeConfidence: "execution-and-data"`. Without it the result explicitly reports `"execution-only"`, never a fabricated all-in fee. This fee uncertainty is separate from unknown execution constraints, which prevent admission.

Re-reading limits is mandatory before each next transaction. A plan is a current-state proof, not a reservation of future block space, stable gas prices or wallet/RPC limits. Submit the returned gas/value/fee envelope, not an old cached estimate or an unrelated wallet batch estimate.

## Stateful simulation, without source-chain writes

The SDK uses actual sequential state, not independent `eth_call` estimates:

1. `eth_simulateV1` uses one actual transaction per synthetic block, preserving state across approvals, begin, ordered preparation and activation. A measurement pass is followed by the exact gas/headroom/fee-envelope pass with validation enabled. Core return tuples and canonical lifecycle events validate committed completion and ordered buy bounds.
2. If that RPC method is unavailable, an explicitly supplied **separate disposable loopback fork** can execute real snapshot-isolated transactions. It resets to the source's exact pinned block when needed, validates chain/header identity, estimates and sends the sequence, observes canonical progress/allowances, and reverts its snapshot and impersonation in cleanup.
3. With neither backend, the result is `backend: "unavailable"`, `confidence: "provisional"`, `admitted: false`; `buildNextTransaction` refuses submission. Dependent calls are not presented as stateful proof.

```ts
import { createControlledLifecycleFork } from "@black-market/sdk/lifecycle";

const fork = createControlledLifecycleFork({
  sourceRpcUrl: "http://127.0.0.1:18555",
  forkRpcUrl: "http://127.0.0.1:18556",
  allowTransactions: true,
  impersonation: "anvil",
});
const planned = await planLaunch({ client, account, plan, mode: "staged", limits, fork });
```

Anvil is the default reset/impersonation backend; a disposable Hardhat node can explicitly use `resetMethod: "hardhat_reset"` and `impersonation: "hardhat"`. The source endpoint can be remote and remains read-only during planning. The fork endpoint must be loopback and distinct, including localhost/IP aliases and effective port. Never pass the source client as a controlled fork client, and never use a live unlocked wallet node as a disposable simulation backend. Planning APIs do not call source `eth_sendTransaction`, resets or snapshots. Exclusive use of the disposable fork while a simulation runs is the operator's responsibility.

## Submit one confirmed step, then recover from canonical state

The SDK does not sign. A viem consumer can submit one transaction as follows:

```ts
import type { PublicClient, WalletClient } from "viem";
import {
  buildNextTransaction,
  type ControlledLifecycleFork, type LifecycleLimitSource,
  type LifecycleReceiptReference, type PlannedLaunch,
} from "@black-market/sdk/lifecycle";

async function submitNext(
  client: PublicClient,
  wallet: WalletClient,
  planned: PlannedLaunch,
  limits: LifecycleLimitSource,
  receipts: LifecycleReceiptReference[],
  fork?: ControlledLifecycleFork,
): Promise<LifecycleReceiptReference | undefined> {
  const next = await buildNextTransaction({ client, planned, limits, receipts, fork });
  if (!next) return undefined;
  let effectiveHash;
  const hash = await wallet.sendTransaction({
    account: next.from, chain: wallet.chain,
    to: next.to, data: next.data, value: next.value,
    gas: next.gas, gasPrice: next.gasPrice,
  });
  const receipt = await client.waitForTransactionReceipt({
    hash, confirmations: planned.confirmations,
    onReplaced: ({ transaction }) => { effectiveHash = transaction.hash; },
  });
  if (receipt.status !== "success") throw new Error("Step reverted; re-read canonical progress");
  return {
    transactionHash: hash,
    replacementHash: effectiveHash,
    observedBlockNumber: receipt.blockNumber,
    observedBlockHash: receipt.blockHash,
    confirmations: planned.confirmations,
  };
}
```

Persist transaction hashes immediately and update observed canonical block/hash after a receipt. If a wallet reports replacement, retain the original hash and supply the effective `replacementHash`. A same-nonce transfer to self is classified as `replacement-cancelled`, not launch completion. A receipt on a removed block is `reorged`; status-zero receipts are `reverted`. Confirmation policy applies before confirmed/reverted/replacement-cancelled classification. An unknown hash without a previously observed receipt remains pending, not an invented reorg.

`confirmations` defaults to 1 and must be positive. Progress reports `canonical` at the selected confirmation depth and `head` at latest, both anchored to hashes. `confirmationSafe` additionally requires confirmed/head account nonces to agree and no higher pending nonce. This also prevents a ref-free page reload from advancing after an unconfirmed approval or launch transaction. Waiting/unconfirmed state returns no executable plan; `buildNextTransaction` throws `UNCONFIRMED_STATE` or `RECEIPT_PENDING` rather than submitting another step.

After a reload, reconstruct `planned` using the exact persisted plan, mode, confirmation policy and receipt references. On every next-step request, the SDK checks the stored commitment, current canonical phase/prepared-market count, token identity, current code/profile/asset eligibility, canonical opening state, funding, account and current execution limits. It never trusts a cached transaction index. `simulateLaunchPlan` likewise resimulates canonical unfinished work. `readLaunchProgress` returns canonical market identity and live state; adapter read failures are surfaced as market errors and do not remove the creator's adapter-independent cancellation path. Directory/adapter ABI exports support bounded canonical position discovery and live custody/liquidity reads.

## Funding and creator cancellation

- Creator, payer and refund recipient are the same address; no alternate funding authority is silently inferred.
- ERC20 approvals name the core's immutable `fundingEscrow`, **not** the orchestrator or adapters. Required input amounts are aggregated across funding rows, and an insufficient nonzero allowance is reset before exact approval. No persistent adapter approval is created.
- NativeWrap uses the configured wrapped-native output asset with `inputAsset == asset`, `inputAmount == amount`, zero target and empty calldata. The transaction's native value is exactly the sum of native inputs; the escrow wraps them. There is no additional invented launch fee.
- Swap funding uses an explicitly registered target/code hash and exact committed input/output/calldata. Native input is represented by the zero input address only for Swap. Conversion output/input refunds and surplus remain launch-scoped; unrelated donations and other launches are not swept.
- Preparing/Ready cancellation uses the exact stored commitment, can proceed after deadline expiry or adapter/profile retirement, and does not call adapters. It refunds only unspent external funding. Native wrapping refunds the external wrapped asset, not previously spent gas or the original gas-paying native balance. Cancelled launch-token inventory remains inactive or is burned according to the commitment; it is not a funding refund.

```ts
const cancel = await buildNextTransaction({
  client, planned, fork, receipts, action: "cancel",
});
// The stored limit callback is refreshed automatically, or supply current limits explicitly.
// Submit with the same exact from/to/data/value/gas/gasPrice treatment as a normal step.
```

Cancellation still needs current stateful execution admission and account confirmation safety; stale/missing execution constraints are not bypassed as a recovery shortcut. Active/Cancelled are terminal, and there is no creator-controlled pause after activation.

## Contract exports and fees

The opt-in subpath exports exact plan/progress/receipt/market/position/context schemas, lifecycle enums/capability bits, the full core command ABI, registry and directory read ABIs, ordinary-call adapter reads, funding escrow/ERC20 prerequisites and the no-argument fee hub read/claim ABI. The lifecycle fee policy type is `LifecycleFeeAssetPolicyV2`; its wire tuple is asset/ownerBps/rewardsBps/burnBps. The source fee-only V1 package is not changed or rebound by this API.

Fee assets and policies are immutable for the launch. Canonical sources and permanently owned positions are finalized before Active; a collector calls `claimAndSplit()` without arguments and receives only the committed share of exact newly collected fees, never existing owner/reward balances or funding donations. Reward streams can contain multiple committed ERC20 assets; reward mode is token-global and cannot differ by market. This guide does not equate a plan admission with a fee-claim execution proof.

## Independent vectors and real local proof

`test/fixtures/launch-lifecycle-v1.json`, the sibling application's `docs/fixtures/launch-lifecycle-v1.json` and the Python SDK's fixture contain identical portable bytes/hash/identity. The independent generator uses its own canonical ABI tuple, not the SDK encoder:

```sh
node examples/generate-lifecycle-commitment-fixture.mjs \
  ../black-market/docs/fixtures/launch-lifecycle-v1.json \
  test/fixtures/launch-lifecycle-v1.json \
  ../black-market-python-sdk/tests/fixtures/launch-lifecycle-v1.json
```

Build once after concurrent source changes have settled. Offline SDK tests include exact encoding/domain/economic mutations, parser and numerical bounds, unsafe fork rejection and venue codecs. Set `LIFECYCLE_ARTIFACT_DIR` to the real Foundry artifact directory to include independently compiled core function/event parity. No mock protocol or fake success fallback is used by the live tests.

From the sibling application repository, the owned local integration runner deploys the real V4/Abyss graph to disposable nodes, exports plans through Solidity, executes the actual SDK smoke and live regressions, and records public evidence:

```sh
python scripts/run_launch_lifecycle_integration.py \
  --sdk node --skip-sdk-build --explicit-staged-fallback
```

`--explicit-staged-fallback` is explicit operator consent for individually refused atomic fixture rows, not a default SDK fallback. The smoke keeps refused atomic evidence and requires admitted actual atomic and staged execution. The runner provides distinct source/fork endpoints and current operator constraints rather than rebinding deployment defaults.

For an already-owned disposable graph, the executable entrypoints are:

```sh
node examples/launch-lifecycle-smoke.mjs "$LAUNCH_LIFECYCLE_MANIFEST" "$LAUNCH_LIFECYCLE_FIXTURES"
node --test test/lifecycle-chain.test.mjs
```

Both require loopback source `LAUNCH_LIFECYCLE_RPC_URL`, distinct `LAUNCH_LIFECYCLE_FORK_RPC_URL`, manifest/fixture paths and `LAUNCH_LIFECYCLE_ALLOW_LOCAL_EXECUTION=1`. The live suite exercises canonical sequential execution, unknown/stale/dynamic admission, explicit mode consent, real token supply boundaries, receipt replacements/reorgs, confirmation-safe reload, current-state resimulation, indivisible activation including a mined gas-exhaustion failure with Ready/opening-state rollback and exact creator cancellation refunds, registry/deadline recovery, and actual native wrapping. These are local proof commands, never production broadcast instructions.
