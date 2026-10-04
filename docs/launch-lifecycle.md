# Reviewed launch lifecycle API

`@black-market/sdk/lifecycle` is the browser-safe launch API; its exports are also available from `@black-market/sdk`. Supply the exact chain, core, creator and reviewed registry domain. Planning, salt preparation, reads and unsigned builders never sign, publish metadata or write to the source chain. A successful controlled-local simulation is not production deployment approval.

The canonical authorities are the reviewed registry/certification/adapter/config contracts under `contracts/src/launch/lifecycle/v2`, the reviewed typed hook deployers, and `contracts/src/launch/fees/v3` in the sibling protocol repository. Plan identity remains `LaunchPlanV1`; shared V4 now accepts **config 4 only**, bound V4 **config 5 only**, and Abyss keeps its canonical schema. Old Atomic/Unified request encoders, template catalogs and old V4 profile/adapter constants have been removed. Immutable old contracts/pools and unrelated DEX/lending functions are not upgraded or rebound.

The clean pool-only deployment uses `DeployPoolLaunchV1`, `PoolHookDeployerV1`,
`PoolMarketAdapterV1`, `PoolFeeCollectorFactoryV1` and `LaunchCertificationV2`.
Registry V2 has no legacy certification child or unsigned admission endpoint.
Use `profileEnvelope`, `profileId` and signed `registerProfile`; envelope/bounds/graph
types and encoding helpers now use `Launch` names without the `Reviewed` prefix.
There are no old-name aliases. The admission EIP-712 domain is `Black Market Launch Registry`,
version `2`; regenerate author consent after cutover. Existing profile/dependency hash
preimages and config tuples remain unchanged. Old deployment evidence is not new-graph proof.

## Public operations

| Operation | Contract |
| --- | --- |
| `readLifecycleProfiles({client, orchestrator, profileIds?, offset?, limit?})` | Bounded registry discovery, schema/topology dispatch, reviewed graph/terms certification and current registry admission. Default offset/limit is 0/100; explicit IDs can select a reviewed deployment's identities. |
| `predictLifecycleToken({client, plan})` | Exact prediction from the explicit core. |
| `preparePoolBoundLifecyclePlan({client, plan, signal?, onProgress?})` | Finalizes current config-5 salts offchain, then rechecks frozen plan, token-factory binding and exact deployment metadata. Does not deploy. |
| `readPoolBoundHookDeployment({client, plan, marketIndex})` | Verifies typed factory, code chunks, constructor, normalized economics, initcode, salt, CREATE2 prediction and recorded provenance of existing code. Works with draft salts; permission bits are additionally required for executable predeployment. |
| `buildPoolBoundHookDeploymentTransaction({client, plan, marketIndex})` | Optional permissionless typed `deploy(parameters,salt)` calldata. Does not create a token, register/initialize a pool, bind a collector or activate a launch. |
| `planLaunch({client, account, plan, mode, limits?, fork?, receipts?, confirmations?})` | Validates domain/funding/admission and canonical progress, records the exact atomic attempt, and reviews only the explicitly selected mode. |
| `simulateLaunchPlan({client, planned, limits?, fork?, receipts?, confirmations?})` | Rereads canonical state and proves remaining work. Preserves receipt evidence, economics and selected mode. |
| `readLaunchProgress({client, planned, receipts?, confirmations?})` | Confirmation-bound canonical state, latest head, receipt/replacement/reorg status, account-nonce safety and actual prepared market/live state. |
| `buildNextTransaction({client, planned, limits?, fork?, receipts?, confirmations?, action?})` | Rereads progress, constraints and stateful proof before returning one admitted transaction. `action: "cancel"` uses the stored commitment without requiring fresh adapter/profile admission. Terminal launches return `undefined`. |

Clients may be viem public clients or raw `request({method,params})` RPC clients. Transport, wallet, signing and durable storage are application-owned. `PlannedLaunch` contains bigint values and live limit callbacks: persist `serializeLaunchPlan(plan)`, explicit execution mode, confirmation policy and receipt references, not the entire object.

## Commitment and integer representation

The economic tuple contains chain/core/creator/nonce; ERC20/ERC404 token and token-global reward configuration; sorted funding outputs and fee assets; ordered markets; ordered initial buys; deadline; and initial executor fee. Each market commits exact adapter/profile/quote/budget/version/config bytes. Each buy commits market index, quote input, minimum token output, recipient and Q64.96 price limit; repeated indices keep their order.

`hashLaunchPlan` is `keccak256(abi.encode(keccak256(bytes("BLACK_MARKET_LAUNCH_PLAN_V1")),plan))`. `hashLaunchIdentity` is `keccak256(abi.encode(chainId,orchestrator,creator,nonce))`. Token prediction depends on that identity and token configuration, not the economic plan hash, so the predicted token can appear in sorted fee assets without circularity. Economics cannot change after begin. Mode/batching are execution metadata outside the tuple.

Use bigint for uint256/uint160/uint128 values and decimal strings in portable JSON. `parseLaunchPlan` rejects lossy JSON numbers and out-of-width values. Amounts are base units, liquidity is uint128, and `1n << 96n` is raw-unit price ratio 1, not a display-unit price. The pure helpers `deriveLaunchPoolRecipe`, `estimateLaunchInitialBuy` and `deriveLaunchBuySqrtPriceLimitX96` do not prove fees, market admission or execution; derive actual minimum outputs from stateful simulation and review the resulting final commitment again.

Bounds: 1–16 markets, 1–8 fee assets, at most 8 funding outputs, 64 ordered buys and 32 total positions. None guarantees gas feasibility. Reward-free ERC20 allows the positive uint256 supply domain; reward-enabled ERC20 is capped at `10^77`; ERC404 supply fits uint96. Current exported supply bounds preserve these exact numerical domains.

```ts
import { parseLaunchPlan, serializeLaunchPlan, encodeLaunchPlan, hashLaunchPlan, hashLaunchIdentity } from "@black-market/sdk/lifecycle";
const plan = parseLaunchPlan(savedPlanJson);
const bytes = encodeLaunchPlan(plan);
const commitment = hashLaunchPlan(plan);
const identity = hashLaunchIdentity(plan);
const portable = serializeLaunchPlan(plan);
```

## Registry-driven profile selection and frozen consent

The exact canonical registry getters are `profileCount`, `profileIds(offset,limit)`, `adapterCount`, `adapterIds(offset,limit)`, `profile`, `adapter`, `profileTopology` and `requireEligible`. There is no SDK template-ID allowlist and no invented `profiles()`/`isProfileEligible()` ABI. Schema plus certified topology dispatches supported implementations; an unsupported schema is reported separately from invalid/unsupported positions.

`LifecycleProfile` contains `registration`, `adapter`, unchanged `topology`, `venueKind`, `admitted` and optional refusal `reason`. Reviewed V4 adds:

- `envelope?: LaunchEnvelopeV2`: artifact/review/bounds/terms digests; topology, config/economic versions, capabilities, flags/callbacks, treasury policy, stable beneficiary/maximum rate, numerical bounds and the exact dependency graph.
- `developerTerms?: {adapter, beneficiary, maximumDeveloperFeeBps, termsDigest, enabled}`.
- `protocolMaximumDeveloperFeeBps?: number`.

The profile identity uses domain `black-market.reviewed-launch-profile.v2` and commits the four review/economic digests, topology/config/economic versions, stable beneficiary, maximum rate and capabilities. It deliberately excludes instance addresses. `hashLifecycleProfile`, `encode/decodeLaunchEnvelope`, `encode/decode/hashLaunchBounds` and `hashLaunchDependencies` expose exact canonical encodings/domains. Graph dependency hashing includes chain/core/registry/registrar, live runtime commitments and exact code-chunk provenance; only the shared deployment salt is outside that economic dependency digest.

Profile certification checks reviewed capabilities/bounds, adapter/core/graph runtime hashes, manager/oracle/locker/collector dependencies, typed hook deployer and STOP-prefixed creation-code chunks. Shared roots additionally require exact constructor/salt prediction and the deployer's recorded runtime. Bound roots require exact immutable constructor/key/economic commitment and recorded runtime when deployed. Address bits `0x1afc` under mask `0x3fff` are necessary but never sufficient. Runtime/initcode portability bounds remain 24,576/49,152 bytes; no compiler/code-size relaxation is assumed.

Registry `authorizationDigest`, `beneficiaryNonces` and `registerProfile` ABIs expose canonical reviewed admission/author consent. Admission does not make a template name an SDK allowlist or bypass current `requireEligible`. Profile retirement prevents new/pending source binding; it does not rewrite frozen active source terms or disable stable-author fee claims.

## Current venue codecs

### Shared V4, version 4

`encodeV4LifecycleMarketConfig` / `decodeV4LifecycleMarketConfig` accept only inner version 4. Market `configVersion` is 4. Exact schema:

```text
(uint16,uint24,int24,uint160,uint24,uint8,uint8,address,bool,bytes32,bytes32,bytes32,address,uint16,(int24,int24,uint128,bytes32,uint256)[])
```

### Pool-bound V4, version 5

`encodePoolBoundV4LifecycleMarketConfig` / `decodePoolBoundV4LifecycleMarketConfig` accept only inner version 5. Market `configVersion` is 5. Exact schema:

```text
(uint16,uint24,int24,uint160,uint24,uint8,uint8,address,bool,bytes32,bytes32,bytes32,bytes32,address,uint16,(int24,int24,uint128,bytes32,uint256)[])
```

Both preserve LP/hook fees, tick spacing, opening price, fee mode/denominator/treasury, external-liquidity policy and canonical oracle identity. Then come `profileId`, `termsDigest`, `developerBeneficiary` and explicit `developerFeeBps`, followed by positions. Version 5 inserts `hookSalt` immediately before `profileId`. There is no conversion from config 2/3 and no SDK default developer rate, including when the chosen rate is zero. Copy terms from the selected profile, not another shared/bound template's envelope. Inner/outer profile IDs must match; author identity is not the live payout. The creator rate cannot exceed either reviewed maximum or protocol ceiling.

```ts
const profile = profiles.find((row) => row.id === selectedProfileId);
if (!profile?.admitted || !profile.envelope || !profile.developerTerms) throw new Error("Selected profile is not reviewed/admitted");
const config = encodeV4LifecycleMarketConfig({
  version: 4, lpFeePips, tickSpacing, sqrtPriceX96, hookFeePips, feeMode,
  protocolFeeDenominator: profile.envelope.protocolFeeDenominator,
  treasury: profile.envelope.protocolTreasury,
  externalLiquidityDisabled: profile.envelope.bounds.externalLiquidityDisabled,
  oracleConfigId: profile.envelope.bounds.oracleConfigId,
  profileId: profile.id, termsDigest: profile.developerTerms.termsDigest,
  developerBeneficiary: profile.developerTerms.beneficiary,
  developerFeeBps: creatorSelectedRate, positions,
});
```

`validateReviewedV4LifecycleMarket` checks profile/terms/topology/version, explicit rate ceilings and exact envelope bounds. Registry/adapter validation remains the execution authority. Positions must require **zero quote deposit** at the committed opening price in actual token orientation. Quotes fund ordered buys, not two-sided initial LP. At most one V4 market per quote is allowed across all templates/topologies/fees/salts; put that quote's positions into one market. Abyss may use the same quote.

Abyss retains `encodeAbyssLifecycleMarketConfig` / `decodeAbyssLifecycleMarketConfig`: canonical pool profile, fee, oracle ID, opening price and ordered tick/liquidity/token-max positions. Quote/fee assets and direct ERC20/native-wrap funding are permissionless subject to actual code, transfers/balances/budgets and canonical bindings. Quote catalog metadata is not admission. Only swap-conversion inputs/targets use registry funding admission.

## Freeze and finalize bound economics

Freeze chain/core/creator/nonce, token identity, sorted fee policies, all funding/budgets/positions/terms and ordered buys before mining. Create config 5 with the chosen bound profile's exact terms and a draft salt; never implicitly reinterpret a shared config.

```ts
const stop = new AbortController();
const finalized = await preparePoolBoundLifecyclePlan({
  client, plan: draft, signal: stop.signal,
  onProgress: ({marketIndex, attempts, predictedHook}) => console.log(marketIndex, attempts.toString(), predictedHook),
});
const saved = serializeLaunchPlan(finalized.plan);
const boundIndex = finalized.plan.markets.findIndex((market) => market.configVersion === 5);
const optionalPredeploy = await buildPoolBoundHookDeploymentTransaction({client, plan: finalized.plan, marketIndex: boundIndex});
// Inspect only; separately admit/authenticate/sign any optional predeployment.
```

The reviewed collector supplies canonical normalized economic commitment and constructor metadata. `hashPoolBoundV4MarketCommitment` uses domain `black-market.reviewed-pool-bound-market-economics.v1`: chain, core, registrar, predicted token, adapter/profile/quote/budget/version and encoded config hash with **only hookSalt zeroed**. Developer identity/digest/rate remain committed. The 18-word constructor freezes manager, registrar, oracle factory, core, locker, token/quote, fees/spacing/price/policy, economic commitment and position count. Salt is used verbatim by CREATE2, not as a constructor argument.

Mining is cancellable/nonblocking; `abort()` raises `AbortError` and does not cancel an onchain launch. Persist the returned finalized plan, not the draft. A salt-only change preserves normalized economics but changes final plan hash. Other changes invalidate initcode/mining; concurrent mutation is refused. Normal next-step review rechecks token factory and the captured `hookDeployments` baseline. Predeployment is permissionless, but code presence or self-reported getters alone cannot be adopted as provenance. It does not register/initialize/seal/open a market and does not eliminate real code-deposit/setup gas.

## Explicit execution mode and indivisible activation

Every planning call requires `mode: "atomic" | "staged"`. For an unstarted launch, `atomicAttempt` records the exact approval/funding plus atomic sequence independently of the requested graph.

- Atomic: after funding prerequisites, token creation, empty infrastructure, all mint/lock/buys/public activation are one transaction.
- Staged: prerequisites, `beginLaunch(Staged)`, contiguous empty `prepareMarkets` batches, then one `activateLaunch`. Preparation batches may shrink to fit.
- Activation cannot split. If mint/lock/all buys/opening cannot fit, staged is also refused. No position/buy/minimum is omitted to manufacture success.

No automatic atomic-to-staged fallback exists. Obtain separate consent to review the same commitment as staged. Both venues use token transfer restrictions plus activation-time canonical opening-state checks, not a pool gate. Manipulated opening price or preactivation liquidity fails verification; the token stays inactive and the launch remains Ready/cancellable. Failed activation rolls back every mint, seal, buy and opening together.

## Execution constraints and stateful simulation

Admission requires current `chainGasLimit`, `rpcGasLimit`, `accountGasLimit` and `maxCalldataBytes`; block gas limit alone cannot fill missing transaction/RPC/account policy. Use a `LifecycleLimitSource` callback whose returned chain/account/core/observed block/hash match the requested pinned context and actual provider-owned policy. Static supplied facts are only current at that exact context; relabeling stale limits is not proof.

The ceiling is the minimum of block and explicit transaction caps. Headroom defaults to 1,500 bps, bounded 0–10,000. The measurement pass is followed by execution at exact returned gas/fee limits. Fork execution uses gross sequential estimates rather than refund-reduced receipt gas as an executable minimum. Transactions expose `estimate.executionFee`, optional `dataFee/totalFee` and `feeConfidence: "execution-and-data" | "execution-only"`; missing rollup/data fee is not an invented all-in estimate. Limits are refreshed before every next transaction.

Sequential backends:

1. `eth_simulateV1`: actual ordered transactions, state carried between synthetic blocks, exact gas-envelope verification, core returns/events and ordered buy bounds.
2. Explicit separate disposable loopback fork: snapshot-isolated real transactions, exact pinned chain/header identity, canonical poststate/allowances and cleanup. Source RPC stays read-only.
3. Neither: unavailable/provisional/unadmitted; no executable next transaction.

Atomic/activation simulation `steps[].returnData` encodes the actual `LaunchReceiptV1` tuple. Controlled-fork output is reconstructed from matching real activation/buy receipt logs and canonical state, never geometric estimates or echoed request minima. `tokenOut` and `quoteSpent` are parallel arrays indexed by ordered buys.

```ts
const fork = createControlledLifecycleFork({
  sourceRpcUrl: "http://127.0.0.1:18555", forkRpcUrl: "http://127.0.0.1:18556",
  allowTransactions: true, impersonation: "anvil",
});
const planned = await planLaunch({client, account: plan.creator, plan, mode: "staged", limits, fork});
```

The fork endpoint must be distinct/loopback, including localhost/IP aliases and effective port. Anvil reset/impersonation is default; disposable Hardhat may explicitly use its reset method/impersonation. Never pass the source client as a fork or use a live unlocked wallet as a disposable backend. Operators own exclusive fork access during proof. Controlled-local policy does not prove live provider/account admission or imply bound topology is a gas optimization.

## Wallet submission and canonical recovery

The SDK never signs. Before **every** approval/reset/core/predeploy/cancel signature, compare the wallet's configured chain (if any) and fresh connected `getChainId()` with the returned `next.chainId`. Failure/invalid identity is a refusal. Supply a matching explicit viem Chain descriptor; do not pass `chain: null` or disable wallet chain checks. Send exact `from/to/data/value/gas/gasPrice`, not a cached estimate or wallet batch.

Persist transaction hashes immediately. After receipt, retain `observedBlockNumber`, `observedBlockHash`, confirmation policy and, for replacements, original `transactionHash` plus effective `replacementHash`. A same-nonce self-transfer is replacement-cancelled, not launch completion. Removed observed blocks are reorged; status zero is reverted; a missing receipt at the unchanged observed block remains pending. Unknown hashes do not invent reorgs.

`confirmations` is positive and defaults to 1. Progress anchors confirmed canonical and latest head hashes, compares confirmed/head/pending account nonces, and prevents ref-free reloads from advancing unconfirmed work. Pending receipts/state return no executable envelope (`RECEIPT_PENDING`/`UNCONFIRMED_STATE`). Reload the exact plan/mode/policy/receipt references; never trust a cached step counter. Market read failures are surfaced without removing adapter-independent cancellation.

## Funding and cancellation

Creator/payer/refund recipient are the same address. ERC20 prerequisites approve immutable `fundingEscrow`, not core/adapters; amounts aggregate by input asset and insufficient nonzero allowances reset before exact approval. NativeWrap requires canonical wrapped-native binding and exact summed native value; there is no invented launch fee. Swap funding commits approved target/spender/code hash and exact input/output/calldata. Unrelated donations/other launches are not swept as refunds.

Preparing/Ready cancellation uses the stored commitment after expiry/retirement without calling adapters or requiring new profile/funding admission. It refunds unspent external funding only. Wrapped-native refunds are wrapped ERC20, not original native gas funds. Cancelled token inventory remains inactive or burns according to the plan. Cancellation still needs current execution admission and nonce/receipt safety; Active/Cancelled are terminal and there is no postactivation creator pause.

```ts
const cancel = await buildNextTransaction({client, planned, receipts, limits, fork, action: "cancel"});
// Apply identical wallet-domain/exact-envelope/receipt handling before submission.
```

## Stable author APIs and V3 fees

`developerBeneficiary`/envelope `beneficiary` is stable `authorId`. Registry `authorPayout(authorId)` is mutable live routing/controller; zero means unknown. Registry admin or current payout/controller may change a known nonzero route with `setAuthorPayout`. Retirement never changes stable identity or blocks existing active developer credits.

| Helper | Inputs / semantics |
| --- | --- |
| `readLifecycleAuthor` | `{client,registry,authorId}` → canonical core/factory, known/live payout, hub count, pinned chain/block. |
| `readAuthorHubs` | Same + `offset?:bigint,limit?:bigint` (defaults 0/100), bounded **1..100**, offset ≤ total, actual hubs/nextOffset/total/cursorComplete. |
| `readDeveloperFees` | Same + `hub,assets?` → authenticated V3 hub, actual assets, claimable/reserved balances, frozen source terms/assets. Explicit unsupported assets are flagged, not relabeled supported. |
| `buildSetAuthorPayoutTransaction` | Same + `payout,account,chainId:bigint`; requires current controller/admin and known identity. |
| `buildClaimDeveloperFeesTransaction` | Same + `hub,asset,account,chainId:bigint`; permissionless fixed-live-payout direct claim. |
| `buildClaimDeveloperFeesPageTransaction` | Same + `offset:bigint,limit:bigint,assets?,account,chainId:bigint`; factory page **1..10**. |
| `decodeDeveloperClaimReceipt` | `{receipt,transaction}` using exact unsigned claim context; validates emitter/account/target/context/cursor/status/rows. |

Unsigned objects carry exact `chainId/from/to/data/value`, with no execution default. Canonical membership is anchored to **registry.core → core.feeFactory → factory.isHub** before any hub self-report; selected registry/core/factory bindings are also checked. Page assets are sorted unique nonzero addresses, at most eight; `[]` means each hub's actual assets. Page cursor completion is independent of payment success: statuses **0 paid, 1 zero, 2 unsupported, 3 failed** remain distinct; preserve retryable failed rows even when the cursor reaches total. A successful direct receipt without `DeveloperFeesClaimed` is `unobserved`, not an invented zero payment.

Choose an explicit page gas budget under the current account/RPC/chain limits, including every bounded hub/asset call plus factory overhead and EIP-150 headroom. `eth_estimateGas` success alone does not prove every row was attempted: the factory can complete the cursor while reporting failed rows under insufficient caller gas. Always decode and retry failed rows; never equate transaction success or cursor completion with payment success.

Current ordinary fee preview/building uses public `lifecycleFeeHubAbi` with **no-argument `claimAndSplit()`**. Preview via viem `simulateContract`/`eth_call`, and build unsigned calldata with `encodeFunctionData`; neither guarantees execution. V3 freezes each source's adapter/profile/terms/stable author/maximum/selected rate. For each actual collected asset: executor bounty is deducted, owner/rewards/burn policy is split with canonical dust allocation, then developer fees are floor-rounded from each source's proportional contribution to the owner share. Developer fees do not reduce rewards/burn, do not reward donations and do not spend prior reserved credits. Owner and developer allocations are reserved before external payouts. `Distributed` includes `developerAmount`; hub reserved inventory is `reservedOwnerFees + reservedDeveloperFees`, not owner reserves alone.

Current registered fee owners may update executor bounty up to 1,000 bps. Each no-arg harvest snapshots one rate for all sources, including already accrued source fees. Owner/reward/burn policy and frozen developer terms do not change; old owner credits remain with the credited owner. Owner `claimOwnerFees(asset,recipient)` withdraws reserved credits without harvesting/bounty. Developer `claimDeveloperFees(authorId,asset)` has no recipient argument and resolves live registry payout at execution.

Lifecycle dividend tokens retain independent current-owner dividend bounty up to 1,000 bps, gross previews and net beneficiary payments with separate caller bounty; self-claims get full gross. Staking claims have no dividend payout bounty. Oracle genesis/cardinality/opening state is not lending-feed maturity, depth or recency approval; unrelated lending checks remain unchanged.

## Independent vectors and local proof

`test/fixtures/launch-lifecycle-v1.json` is a portable **offline wire vector**, not a deployed launch. Its independent generator owns the literal canonical ABI tuple:

```sh
node examples/generate-lifecycle-commitment-fixture.mjs test/fixtures/launch-lifecycle-v1.json
```

After concurrent source changes settle, build/test the package and run `examples/quickstart.mjs`. Meaningful regressions cover commitment/identity/numerical domains, retired codecs, reviewed terms/rate/bounds, salt normalization/mining/cancellation, receipt recovery and author authentication/routing/page outcomes. Retired wording/selector/source-wiring tests are removed rather than re-pinned.

`examples/launch-lifecycle-smoke.mjs manifest.json sdk-plans.json` executes current Solidity-exported `plans` on explicitly authorized owned loopback fixtures, with distinct fork and reviewed controlled-local operator limits. It exercises explicit atomic/staged modes, mined typed predeployment, actual ordered buys/permanent custody, canonical recovery, no-arg V3 harvest and authenticated author page claims with actual payout balance checks. `test/lifecycle-chain.test.mjs` adds real-graph refusal/reorg/cancellation boundaries when the same fixture environment is provided. See [the current evidence index](../../black-market/docs/10-4-audit/README.md) for exercised results and limits; this guide makes no live broadcast/UI/provider-ceiling claim.
