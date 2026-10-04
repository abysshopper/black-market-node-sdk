# Versioned launch lifecycle API

`@black-market/sdk/lifecycle` is the browser-safe, opt-in API for the new lifecycle stack. The same exports are available from `@black-market/sdk`. It does not select or change any legacy deployment address, Unified Launcher request, default route, or fee-only V1 deployment. Supply the exact chain, orchestrator, creator and immutable adapter/profile IDs from a reviewed deployment. No SDK planning operation signs, publishes metadata, or broadcasts a transaction on that source chain.

The architecture is defined in the sibling application repository's [launch ADR](../../black-market/docs/adr-launch-architecture.md) and [multi-market design](../../black-market/docs/multi-market-launch-design.md). Solidity `LaunchTypesV1.sol` and `ILaunchLifecycleV1.sol` are the wire authority. A source implementation or successful local simulation is not production deployment approval.

Quote and external fee assets and direct ERC20/native-wrap funding are permissionless:
the planner checks deployed contract code, not administrator approval. Deployment quote
metadata is not an allowlist. Only ERC20 inputs to swap conversions use the registry's
`fundingInputAllowed` admission; target/spender and codehash checks remain mandatory.
Exact transfers, balances, budgets and native-wrap bindings remain enforced.

## Public operations

| Operation | Observable contract |
| --- | --- |
| `planLaunch({ client, account, plan, mode, limits, fork?, receipts?, confirmations? })` | Validates the complete domain, current funding and registry admissions, reads canonical state, attempts the exact atomic sequence first, and returns the explicitly selected execution graph with current stateful admission evidence. |
| `simulateLaunchPlan({ client, planned, limits?, fork? })` | Re-reads canonical state and simulates only the remaining work, not a previously cached list of transactions. It never changes the selected mode or economics. |
| `buildNextTransaction({ client, planned, limits?, fork?, receipts?, confirmations?, action? })` | Reads canonical confirmed progress and account nonces again, refreshes limits and remaining-sequence proof, then returns one executable transaction. `action: "cancel"` builds creator cancellation without invoking disabled adapters. Terminal launches return `undefined`. |
| `readLaunchProgress({ client, planned, receipts?, confirmations? })` | Returns confirmation-bound canonical progress, latest-head progress, account nonce/confirmation safety, canonical receipt status and prepared market identity/live state. It does not advance a local step counter. |
| `readLifecycleProfiles({ client, orchestrator, profileIds? })` | Reads immutable profile/adapter approval and current availability; omitted IDs use bounded registry enumeration. |
| `predictLifecycleToken({ client, plan })` | Reads the exact lifecycle token prediction from the explicit orchestrator. |
| `preparePoolBoundLifecyclePlan({ client, plan, signal?, onProgress? })` | Finalizes config-3 salts offchain against the certified typed factory, then rereads exact final deployment metadata, token-factory binding and resolved identity. Does not sign or deploy. |
| `readPoolBoundHookDeployment({ client, plan, marketIndex })` | Reads and verifies the exact factory/initcode/salt/predicted-hook tuple, including unmined draft salts. |
| `buildPoolBoundHookDeploymentTransaction({ client, plan, marketIndex })` | Builds optional permissionless typed `deploy(parameters, salt)` calldata for a finalized bound market; it does not register or initialize a pool. |

`client` can be a viem public client or a raw `request({ method, params })` JSON-RPC client. Transport, wallet, signing and durable application storage remain caller-owned. `PlannedLaunch` contains live limit callbacks and bigint values; persist the economic plan with `serializeLaunchPlan`, plus the explicit mode, confirmation policy and receipt references, rather than serializing the entire planning object.

### Commitment and exact integer representation

`LaunchPlanV1` contains:

- Domain: `chainId`, `orchestrator`, `creator`, `nonce`.
- Token: ERC20/ERC404 kind, None/Staking/Dividends rewards, name/symbol, supply, NFT unit/metadata, deterministic salt, inventory recipient and burn-on-cancel policy.
- Funding: sorted output assets, amounts, ERC20/NativeWrap/Swap kind, input asset/amount, allowlisted target and exact calldata.
- Sorted fee assets: per-asset owner/rewards/burn basis points, each summing to 10,000. Only the predicted launch token can have a burn share.
- Ordered markets: immutable adapter/profile IDs, quote asset, explicit token budget, config version and exact opaque venue bytes.
- Ordered buys: market index, quote input, minimum token output, recipient and square-root price limit. Repeated market indices retain their original ordering.
- Deadline and initial executor fee basis points, bounded to 0–1,000 (0–10%).

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

New V2 fee hubs allow the current registered fee owner to call `setExecutorFeeBps(uint16)`
using `lifecycleFeeHubAbi`; `executorFeeBps()` reads the current rate and
`MAX_EXECUTOR_FEE_BPS()` returns 1,000. `ExecutorFeeUpdated` records old/new rates.
Owner/rewards/burn fractions stay fixed. The current rate applies to all freshly collected
fees, including earlier accrual, and authority follows accepted fee ownership. Previously
reserved owner credits are unaffected. Each all-source `claimAndSplit()` snapshots one
rate; callbacks cannot update it. Preview is not a minimum-payment guarantee, and no
delay or extra harvest argument is introduced. Existing immutable hubs are not upgraded.

New V2 harvests always reserve owner allocations. Use
`lifecycleFeeHubAbi` with `claimableOwnerFees(owner, asset)` to read credits and send
`claimOwnerFees(asset, recipient)` as the credited owner to withdraw them. Withdrawal
does not harvest or charge a bounty; accepted ownership changes do not transfer old credits.

Use `lifecycleDividendAbi` on a new lifecycle ERC20/ERC404 dividend token to read
`dividendBountyBps()` and send `setDividendBountyBps(uint16)` as the current registered
fee owner. The independent setting starts at zero and is capped at 1,000 bps.
`DividendBountyUpdated` records changes. Third-party `claimFor(beneficiary)` and
`claimRange(beneficiary, start, count)` pay the caller `floor(gross * bps / 10_000)`
per asset and the beneficiary the remainder. Self-claims receive the full amount;
zero does not disable third-party payout. One current-rate snapshot applies to all
assets and already accrued dividends, without a minimum-payment guarantee.
`earned` and `pendingRewards` are gross; claim returns, `RewardPaid` and
`lifetimeRewardsPaid` are net beneficiary receipts. `RewardClaimBountyPaid` records
the separate caller payment. `lifecycleRewardsAbi` also supports staking vault claims,
which have no payout bounty. These opt-in ABIs do not relabel legacy reward modules.

### Venue configuration

Shared V4 retains `encodeV4LifecycleMarketConfig` / `decodeV4LifecycleMarketConfig`; bound V4 uses `encodePoolBoundV4LifecycleMarketConfig` / `decodePoolBoundV4LifecycleMarketConfig`. Abyss retains `encodeAbyssLifecycleMarketConfig` / `decodeAbyssLifecycleMarketConfig`. These ordinary-call lifecycle codecs are distinct from legacy complete-launch and fee-only V1 adapters.

- **Shared V4 remains fully supported:** `V4_LIFECYCLE_PROFILE_ID = keccak256("black-market.v4-lifecycle-market.v3")`, outer `configVersion: 2`, inner `version: 2`, `V4MarketConfigV2`. It selects the certified reusable `SharedLaunchFeeHookV2` root. The `.v3` profile suffix is not config version 3.
- **Pool-bound V4 is additive:** `V4_POOL_BOUND_LIFECYCLE_PROFILE_ID = keccak256("black-market.v4-pool-bound-lifecycle-market.v1")`, `V4_POOL_BOUND_LIFECYCLE_ADAPTER_ID = keccak256("black-market.adapter.v4-pool-bound-lifecycle.v1")`, outer `configVersion: 3`, inner `version: 3`, `V4MarketConfigV3`. It adds `hookSalt` immediately before positions; no shared tuple is reinterpreted. The certified profile's zero `hook` means an exact factory-derived root, not arbitrary caller-supplied code.
- Both schemas commit LP/hook fees, spacing, opening square-root price, fee mode/treasury denominator, treasury, external-liquidity policy and canonical `oracleConfigId`. Positions retain ticks, liquidity, salt and maximum launch-token amount. Retired lifecycle profiles/configs are rejected; fee-only V1 deployments remain separate and unchanged.
- Abyss config commits profile 0–3, fee, oracle configuration ID, opening square-root price and ordered positions with ticks, liquidity and token maxima.
- Select only an approved immutable profile whose schema, capabilities and dependencies match the deployed implementation. Runtime code hashes, core authority and pending eligibility are checked again before the next transaction.
- Position ranges must require **zero quote deposit** at the committed opening price in the actual token orientation. Quote funding is for ordered buys, never two-sided initial LP seeding.
- At most one V4 market per quote is allowed across shared/bound offerings, fees and salts. Put all ranges for that quote in one market's positions. Different quotes may select different offerings; an Abyss market may share a V4 market's quote. Full canonical market identity and duplicate checks still apply.

Exact shared V4 config ABI:

```text
(uint16,uint24,int24,uint160,uint24,uint8,uint8,address,bool,bytes32,(int24,int24,uint128,bytes32,uint256)[])
```

Supply the factory's admitted oracle identity, not an invented zero ID:

```ts
const config = encodeV4LifecycleMarketConfig({
  ...reviewedV4Config,
  version: 2,
  oracleConfigId: admittedCanonicalOracleConfigId,
});
// Commit this as a market with configVersion: 2 and the approved V2 profile ID.
```

Exact bound V4 config ABI:

```text
(uint16,uint24,int24,uint160,uint24,uint8,uint8,address,bool,bytes32,bytes32,(int24,int24,uint128,bytes32,uint256)[])
```

### Select, freeze and finalize a bound market

Start with a complete reviewed economic plan: exact chain/core/creator/nonce and token configuration, sorted fee policies including the predicted token, funding, budgets, positions and all ordered buys. Amounts are integer base units (`1_000_000n` is one token only for six decimals), liquidity is uint128 and price is integer Q64.96 (`1n << 96n` represents raw-unit ratio 1). Do not insert display-unit floats or assume a price/tick range is valid in both token orientations.

This callable helper replaces one reviewed market with the bound offering. `reviewedConfig` is a valid shared config with the same reviewed economics and position list, not a guessed price or liquidity allocation:

```ts
import { zeroHash } from "viem";
import {
  encodePoolBoundV4LifecycleMarketConfig, preparePoolBoundLifecyclePlan,
  V4_POOL_BOUND_LIFECYCLE_ADAPTER_ID, V4_POOL_BOUND_LIFECYCLE_PROFILE_ID,
  type LaunchPlanV1, type LifecycleRpcClient, type V4LifecycleMarketConfig,
} from "@black-market/sdk/lifecycle";

async function finalizeBoundMarket(
  client: LifecycleRpcClient, draft: LaunchPlanV1, marketIndex: number,
  reviewedConfig: V4LifecycleMarketConfig, signal?: AbortSignal,
) {
  if (!draft.markets[marketIndex]) throw new Error("Market index outside plan");
  const selected: LaunchPlanV1 = {
    ...draft,
    markets: draft.markets.map((market, index) => index !== marketIndex ? market : {
      ...market,
      adapterId: V4_POOL_BOUND_LIFECYCLE_ADAPTER_ID,
      profileId: V4_POOL_BOUND_LIFECYCLE_PROFILE_ID,
      configVersion: 3,
      config: encodePoolBoundV4LifecycleMarketConfig({
        ...reviewedConfig, version: 3, hookSalt: zeroHash,
      }),
    }),
  };
  return preparePoolBoundLifecyclePlan({
    client, plan: selected, signal,
    onProgress: ({ marketIndex, attempts, salt, predictedHook }) => {
      console.log(marketIndex, attempts.toString(), salt, predictedHook);
    },
  });
}
```

An `AbortController` supplies `signal`; call `abort()` to stop local mining (`AbortError`), not to cancel an onchain launch. Finalize before begin, persist the **returned** plan with `serializeLaunchPlan`, and review its returned `deployments`. Do not mutate the draft while mining. Freeze domain/token/positions/budgets/policy before this step: economic changes alter constructor/initcode commitment and invalidate the mined result. A salt-only change preserves token prediction and normalized market commitment, but the final plan hash commits the actual salt. After begin, the stored economic plan is immutable.

The helper verifies the certified registry topology, adapter/core/dependency code hashes, typed factory and its STOP-prefixed creation-code chunks, constructor tuple and locally reconstructed initcode hash/CREATE2 address against source-chain reads. The 18-word constructor freezes manager, registrar, oracle factory, core, owning locker, predicted token, quote, fees/spacing/opening price, policy, market commitment and position count. `hookSalt` is used verbatim with that factory and initcode; it is not a constructor argument. Required address bits are `0x1afc` under mask `0x3fff`, separately from topology certification. No onchain salt search exists. Shared deployment already mines its salt offchain too; moving mining is not a new gas saving.

Use the finalized plan through the normal reviewed-write path:

```ts
import {
  buildNextTransaction, buildPoolBoundHookDeploymentTransaction,
  planLaunch, readLaunchProgress,
} from "@black-market/sdk/lifecycle";

const stopMining = new AbortController();
const finalized = await finalizeBoundMarket(
  client, draft, marketIndex, reviewedConfig, stopMining.signal,
);
// Optional: obtain calldata for a not-yet-deployed exact hook. No broadcast here.
const predeploy = await buildPoolBoundHookDeploymentTransaction({
  client, plan: finalized.plan, marketIndex,
});
console.log(predeploy.to, predeploy.data, predeploy.value, predeploy.deployment);
// Application separately reviews/admits/signs any predeploy transaction.
// Omit predeploy entirely to let adapter preparation deploy the hook.
const planned = await planLaunch({
  client, account: finalized.plan.creator, plan: finalized.plan,
  mode: "staged", limits, fork,
});
const progress = await readLaunchProgress({ client, planned, receipts });
const next = await buildNextTransaction({ client, planned, limits, fork, receipts });
// Submit next using the exact wallet envelope shown below; then reread progress.
```

`PlannedLaunch.hookDeployments` retains the reviewed factory/initcode/salt/address baseline; normal next-step construction checks it and the token factory address/runtime hash again. A changed binding is a refusal, not automatic adoption of a new factory. Optional predeployment is permissionless and may precede token creation, but only the exact typed factory's nonzero `deployedCodeHash(hook)` matching live code, exact constructor/key/commitment and still-unregistered/uninitialized/empty binding can be adopted during preparation. Self-reported getters or code presence alone are insufficient. Predeploying does not bind a collector, initialize a pool, seal custody or activate anything; setup gas/code deposit remains real cost.

Each bound root is one immutable token/quote/fee PoolKey. All of that market's positions share it, foreign IDs/keys are rejected and different quotes get different roots. The current captured stack has three adapters/six profiles: shared V4, bound V4 and four Abyss profiles. It retains the shared root and adds the bound typed deployer/chunks, owning locker and adapter using the common collector factory; it does not deploy a per-launch bound root at stack deployment. Offerings are explicit `sharedV4`, `poolBoundV4`, `abyss`.


The shared lifecycle root is `SharedLaunchFeeHookV2`, deployed by
`SharedLaunchFeeHookDeployerV2`. The bound root is independent `PoolBoundLaunchFeeHookV1`,
deployed by `PoolBoundLaunchFeeHookDeployerV1`. Both reuse `fees/v2/V4FeeCollectorV2`
and `launch/fees/v2/V4FeeLiquidityLockerV2` custody (each adapter owns its locker instance).
Independent fee-only V1 roots/deployers/collectors and old hooks remain unchanged.
Both lifecycle roots bind manager, adapter registrar and the canonical Abyss factory
as oracle authority; registration snapshots `oracleConfigs(id)` once, requiring
movement bound **1..887272** and cap **2..4096**.

The root exposes `observeTruncated(fullPoolId, secondsAgos)`,
`increaseObservationCardinalityNext(fullPoolId, requested)` and
`oracleInitializedAt(fullPoolId)`. It reuses the real unchanged `TruncatedOracle`,
with per-full-PoolId packed state/observations on shared V4 and exact-bound-ID indexed
selectors on bound V4, pre-swap and pre-active-liquidity sampling once per block
(even on zero/wrong-currency fee returns) and quote-normalized clamping.
Permissionless growth is capped, monotonic and lazy: populated/prepared
cardinality starts at **1**, never automatic 4096 history. `readMarket().oracleReadyAt`
reports actual genesis, **not maturity**: atomic history starts in that transaction,
staged history only in preparation, and pre-genesis requests fail. Neither venue adds
a swap gate. V4 additions are custody-only until the registrar completes `completePoolOpening`;
afterwards the committed `externalLiquidityDisabled` policy applies unchanged, so `false`
still permits external liquidity. `openingCompletedAt` is distinct from oracle genesis.
Token restrictions, canonical opening-state continuity and exact delta/fee/treasury/ERC6909
liability/permanent-custody semantics remain enforced.
Fees, pull owner credits, rewards and custody selectors are reused, not a new fee ABI.
The lending `UniswapV4PriceFeed` is unchanged: exact key, maturity, depth and recency
checks remain necessary; oracle genesis does not prove lending readiness.


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

### Reviewed controlled-local policy versus live chain facts

The current captured manifest copies input `limitsProvenance` into
`executionLimits.provenance`. Review that record with every numeric ceiling.
The controlled chain-31337 Anvil policy sets block/chain-transaction/RPC/account
ceilings to **32,000,000** gas and separately chooses **1,000 bps** headroom.
It models a controlled Cancun EVM, not full Nitro or proven live RPC/account admission.

Read-only chain-4663 facts at block **79595428**, hash
`0x563abc99145d922ae21aaa08e21fcc7d04e3cbe8781d89beacdd975085534f83`,
report ArbOS **116** and ArbGasInfo `getMaxTxGasLimit()` /
`getMaxBlockGasLimit()` both **32,000,000**. Live RPC execution and wallet/account
ceilings remain **unknown**; these getters cannot fill those admission fields.
Nitro splits `tx.Gas()` into L1 poster-data gas and compute gas, and ArbOS >=50
block accounting permits `PerBlock + PerTx`; the getters are neither a universal
RPC envelope nor a strict aggregate block-receipt gas limit. See
[Nitro block accounting, lines 514–547](https://github.com/OffchainLabs/nitro/blob/master/arbos/block_processor.go#L514-L547)
and [Robinhood gas and fees](https://docs.robinhood.com/chain/gas-and-fees/).
The captured **24,576 / 49,152-byte** runtime/initcode bounds are retained Ethereum
portability checks, not Robinhood's documented **96 KiB / 192 KiB** limits.
Prior 16M/16,777,216 archives are optional local stress evidence, not current
production constraints or proof that either topology is unsupported.


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
- Preparing/Ready cancellation uses the exact stored commitment, can proceed after deadline expiry or adapter/profile retirement, and does not call adapters or require renewed market/profile/funding admission. It refunds only unspent external funding. Native wrapping refunds the external wrapped asset, not previously spent gas or the original gas-paying native balance. Cancelled launch-token inventory remains inactive or is burned according to the commitment; it is not a funding refund.

```ts
const cancel = await buildNextTransaction({
  client, planned, fork, receipts, action: "cancel",
});
// The stored limit callback is refreshed automatically, or supply current limits explicitly.
// Submit with the same exact from/to/data/value/gas/gasPrice treatment as a normal step.
```

Cancellation still needs current stateful execution admission and account confirmation safety; stale/missing execution constraints are not bypassed as a recovery shortcut. Active/Cancelled are terminal, and there is no creator-controlled pause after activation.
Keep the original reviewed `planned` object or restore its exact persisted commitment
and receipts for cancellation; do not make a successful fresh `planLaunch` a prerequisite
to showing Cancel. Stop local mining independently with its abort signal. Failed bound
activation leaves Ready with inactive token and its preactivation state intact;
retry uses the same committed plan, or the creator cancels. Preparation may have
deployed/bound/initialized the empty pool, but all mints, custody sealing, ordered
buys and final opening still roll back together on a failed activation.

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

Every exported row has an explicit expected positive/negative outcome. Expected-positive
rows must actually reach `Active`; staged ERC20/ERC404 coverage uses decoded token kinds.
Expected-negative rows require numerical headroom/cap evidence for the actual indivisible
step, a failed exact-ceiling receipt, or an authenticated terminal failing trace reaching
`OutOfGas` at that ceiling. Opaque RPC/estimator reverts, advice suffixes and unrelated
funding/ABI/oracle/identity failures abort rather than passing as gas refusals. If necessary,
the smoke obtains receipt/trace evidence by replaying the same sequence on its separate
owned fork and resetting the pinned head; source state and gas caps remain unchanged.
Per-row `gasEvidence` records the measurements instead of hiding refusals in aggregates.

For an already-owned disposable graph, the executable entrypoints are:

```sh
node examples/launch-lifecycle-smoke.mjs "$LAUNCH_LIFECYCLE_MANIFEST" "$LAUNCH_LIFECYCLE_FIXTURES"
node --test test/lifecycle-chain.test.mjs
```

Both require loopback source `LAUNCH_LIFECYCLE_RPC_URL`, distinct `LAUNCH_LIFECYCLE_FORK_RPC_URL`, manifest/fixture paths and `LAUNCH_LIFECYCLE_ALLOW_LOCAL_EXECUTION=1`. The live suite exercises canonical sequential execution, unknown/stale/dynamic admission, explicit mode consent, real token supply boundaries, receipt replacements/reorgs, confirmation-safe reload, current-state resimulation, indivisible activation including a mined gas-exhaustion failure with Ready/opening-state rollback and exact creator cancellation refunds, registry/deadline recovery, and actual native wrapping. These are local proof commands, never production broadcast instructions.

### Prior shared-V2 restoration runs

The following counts and browser results are historical shared-V2 runs, not final
pool-bound SDK/Python/UI verification. Restoration evidence is recorded in the sibling repository's
[review evidence](../../black-market/docs/launch-lifecycle-v1-review.md#lifecycle-v4-oracle-restoration-evidence)
and [contract results JSON](../../black-market/contracts/evidence/lifecycle-v4-oracle-restoration/contract-proof-results.json):
147 unique named tests with final passing statuses **across those runs** (146 initial passes
plus one targeted test-ordering correction), not one all-green 147-test run.
The complete graph for that prior run is
[`launch-lifecycle-v4-oracle-proof-7`](../../black-market/contracts/deployments/local/launch-lifecycle-v4-oracle-proof-7/manifest.json).
Its [exact runner command](../../black-market/contracts/evidence/lifecycle-v4-oracle-restoration/sdk-runtime-attempt7.command.json)
exited **0**, including both SDKs, actual Chromium, non-test swaps and rollback-negative
deployment capture. The [runtime summary](../../black-market/contracts/evidence/lifecycle-v4-oracle-restoration/sdk-runtime-summary-launch-lifecycle-v4-oracle-proof-7.json)
records Node **13 plans / 19 outcomes: 5 Active (1 atomic, 4 staged), 14 refusals**,
actual-chain **19/19** and both venues' genesis/pre-genesis reads. Oversized indivisible
activations were truthful refusals under that run's local **16M** account/RPC stress envelope,
not production constraints or topology-wide refusals. That prior Node build passed; offline
**15 passed / 1 skipped** was followed by the separately passing **1/1 compiled-artifact ABI case**.
[Non-test runtime JSON](../../black-market/contracts/evidence/lifecycle-v4-oracle-restoration/sdk-non-test-oracle-launch-lifecycle-v4-oracle-proof-7.json)
records ordinary CREATE-deployed router swaps in blocks **92/93**, spot
**3930 → 4091 → 4252**, truncated **0 → 17 → 34**, cursor **0 → 1 → 2**,
permissionless capacity **1 → 4** and truthful interpolation/pre-genesis rejection.
[Focused actual browser proof](../../black-market/contracts/evidence/lifecycle-v4-oracle-restoration/sdk-ui-runtime-launch-lifecycle-v4-oracle-proof-7.command.json)
passed **2/2, exit 0, zero console/page errors** (atomic Active; staged ERC404
Ready/reload → Active with all buys/NFTs). Actual browser calldata and explicit fresh
identity comparisons are retained in the runtime summary; this is not claimed to
reuse SDK-consumed identities. That historical local portability/stress configuration used
**24,576 / 49,152 bytes**, chain transaction gas **16,777,216**, block gas **30,000,000**.
Older V1 graphs/browser passes and intermediate -5/-6 attempts remain historical,
not the final V2 graph; -6's two browser passes did not make its failed runner complete.
The [operations recipe](../../black-market/docs/launch-lifecycle-v1-operations.md#settled-oracle-restoration-proof--7)
distinguishes exact historical argv containing removed throwaway callbacks from
supported reproduction commands. That run's [final summary](../../black-market/contracts/evidence/lifecycle-v4-oracle-restoration/final-summary.json)
recorded **no proof blockers**, no production broadcast/default rebinding.

### Pool-bound canonical-policy diagnostic scope

The [canonical-32M original-topology diagnostic](../../black-market/contracts/deployments/local/pool-bound-runtime-20261003-canonical-probe-b/canonical-mixed-measurement.json) deployed/captured real AMMs and
executed **72 exact original-mode rows: 52 Active, 20 genuine atomic OutOfGas**;
**all 48 staged paths reached Active**. These were built Node executions of both
fixture origins, not actual Python executions or final browser proof. Original
heavy/mixed fixtures remain preserved, with V4-only companions additive. Exported
outcomes are measured against reviewed `executionLimits` and provenance, not a
silently reduced plan. Final rebuilt-SDK/browser and paired-gas verification are
not established by this diagnostic; no gas-saving total is claimed here.

Paired reporting covers all 12 position pairs plus original mixed pairs and must
include actual setup/CREATE2 code-deposit cost and maximum individual transaction.
Full captured graph setup shared by both rows is not a separately measured
standalone bound-only architecture cost.

### Historical synthetic multi-buy cost caveat

The completed final-c synthetic multi-buy stress measurement reports **30 pairs: 24 complete,
6 with refusals**, **50 Active / 10 atomic OutOfGas**, **329 receipts** and
**607 creations**. Actual full captured-graph setup was **121,446,084 gas**.
Successful **V4-only** bound launches added approximately **5.12–5.23 million gas
per V4 root** versus matched shared launches. Original mixed two-quote pairs
added approximately **10.82 million gas across two V4 roots** (about **5.41 million
per root**), so the V4-only range is not universal. Bound cost more in every
successful matched pair; pool-bound isolation is not a demonstrated gas saving.
The **24,564-byte** bound runtime's **4,912,800-gas** code deposit is already
included in actual preparation/atomic receipts, not an additional cost to sum again.
V4-only q1/q2/q3 plans contain 3/4/5 opening buys; mixed plans contain 4/6/8.
These preserved stress rows do not measure the product's exactly-one-opening-swap workload.

The durable [paired gas section](../../black-market/docs/launch-lifecycle-v1-operations.md#measured-sharedbound-gas-on-the-captured-graph)
retains exact setup/launch, maximum-individual-transaction and marginal comparisons.
Refused mixed atomic rows do not have invented complete-launch totals or deltas.
Full graph setup is common captured infrastructure, not a separately measured
standalone bound-only architecture cost. These paired receipts establish neither
actual Python/browser execution nor live Nitro/RPC/account ceilings; the reviewed
controlled-local 32M policy and separate headroom qualifications above still apply.

### Completed non-UI named-topology proof

The representative catalogue is **one V4 pool / exactly one committed opening swap**,
not the retained multi-buy stress matrix. Anchor/Ladder/Orbit/Rocket/Cruise/Spread/Depth/
Bundle retain **11/9/9/11/10/9/8/8** positions, full inventory allocation and mandatory
permanent tail. Shared multipool/config2 and scalar pool-bound/config3 remain selectable;
at most one V4 fee pool is admitted per launched-token/quote pair. Optional Abyss remains
a separate bonus pool, not an extra V4 LP or mandatory synthetic mixed launch.

The **actual Node SDK entrypoint** completed 61 requested fixtures / 71 observations:
**61 Active / ten authenticated terminal OOG stress refusals**, with ten explicitly
consented same-full-plan staged alternates included in Active. **All32 catalogue rows
reached Active**, and the real chain suite recorded **28 TAP passes including its parent**.
The **actual Python entrypoint**, not a Python-labelled Node fixture, also completed
all32 catalogue rows Active within its61 requested fixtures:50 Active, ten terminal OOG
stress refusals and one separate conservative SDK-policy refusal.

Each catalogue core preserves token/nonce, full budget, positions, funding and one-buy
economics across offerings; modes share the exact full plan within an offering. Every
row resolves the actual V4 adapter/PoolKey explicitly—original mixed `buys[0]` targets
Abyss. Exact per-fixture snapshot/state-root/funding restoration isolates creator balances
without top-ups or reducing original economics. Atomic refusal is never silently staged.

The receipt-gas comparison completed **16/16 pairs / 32 Active offerings**, with **96
actual launch receipts / 300 permanently custodied manager positions**. Bound marginal
cost was **5,154,553–5,185,959 gas higher per pool** in those matched one-swap rows;
code deposit is already inside atomic/prepare receipts. Full captured graph setup
**121,446,084 gas** is shared evidence, not standalone bound-only provisioning.
Permanent contracts additionally prove orientation/spacing, opening, accounting/rounding,
boundary/reversal and tail behavior; normalized ratios are not absolute USD proof.

See the [complete table, commands, actual SDK outcomes and recovery evidence](../../black-market/docs/launch-lifecycle-v1-operations.md#completed-one-opening-swap-topology-proof).
Completed Node/gas evidence remains in retry2; that runner later exited1 at Python.
Fresh Python/reorg recovery exited0 with a Python-only integration result; no single
uninterrupted both-SDK runner success is claimed. Both owned ports closed afterward.
The explicit Cancun31337 block/chain/RPC/account policy remains **32M plus separate
1,000-bps headroom**, with **24KB/48KB portability**, not Robinhood96KiB/192KiB.
No UI/browser/app execution, live broadcast or live provider/account ceiling proof occurred.
