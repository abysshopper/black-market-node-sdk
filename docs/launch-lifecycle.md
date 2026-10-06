# Launch lifecycle API

`@black-market/sdk/lifecycle` is the browser-safe launch API; its exports are also available from `@black-market/sdk`. Supply the exact chain, core, creator and registry domain. Planning, salt preparation, reads and unsigned builders never sign, publish metadata or write to the source chain. A successful controlled-local simulation is not production deployment approval.

The canonical authorities are the registry/certification/adapter/config contracts under
`contracts/src/launch/lifecycle/v2`, typed hook deployers, and `contracts/src/launch/fees/v3`
in the protocol repository. Plan identity is `LaunchPlanV1`. Pool-bound V4 uses **config 5**,
canonical Abyss uses **config 1**, and generic current shared-V4 support uses **config 4**.

## Unreleased certification and dependency-round reductions

The public API, deployment authority and protocol admission rules are unchanged. With an
actually batching source, selected-profile certification no longer waits for registry
authority before reading the selected registrations, or for adapter registration before
reading topology and applicable V4 envelope/terms. Eligibility overlaps graph certification.
Private profile certification uses the registry's pinned `requireEligible` result and
requires its returned implementation to match the registration. This covers discovery
and standalone bound-hook metadata. Three duplicate implementation RPCs (`eth_getCode`,
`core`, `dependencyDigest`) were removed: the registry already checks enabled records,
exact profile/version/capability agreement, live runtime hash, core and live digest.
The existing local V4 graph-digest comparison uses `registration.dependencyDigest`,
whose equality to the live implementation digest is established by that same call.

Abyss certification no longer re-reads `factory`, `CONFIG_SCHEMA`, `CONFIG_VERSION` or
factory code. The registry certifies those fixed bindings before storing a profile;
current eligibility pins the approved runtime and rechecks its live graph digest.
SDK-side schema/version/topology and canonical chain/factory/variant checks still use
the returned registration, including factory/venue agreement and no hook. A changed
runtime or factory graph must fail authoritative eligibility, not an optional duplicate
getter. Market resolution and both exact planning/simulation passes remain required.

Source reasons in the reviewed protocol repository:

- `contracts/src/launch/lifecycle/v2/LaunchImplementationRegistryV2.sol:285-296`
  implements current eligibility; `:88-97` certifies Abyss before storing it and
  `:153-174` prevents profile rebinding.
- `contracts/src/launch/lifecycle/v2/LaunchCertificationV2.sol:79-102` certifies
  Abyss schema/version/capabilities, factory/code/canonical identity and graph digest.
- `contracts/src/launch/lifecycle/v1/AbyssMarketAdapterV1.sol:75-76,150-167`
  makes the core/factory immutable and binds the live graph code/initcode hashes.

V4 metadata, reviewed dependency code/getters, creation chunks and shared-root
provenance remain independent pinned reads. Chunk addresses come from the frozen
envelope only for scheduling; live deployer getters must still match them, including
STOP prefixes, size/hash bounds, constructor creation hash, graph digest, runtime
provenance and callback permissions.

Planning reads swap-input admission and existing escrow balances alongside profile
certification. A market's resolution uses its certified implementation while exact
capability eligibility, selected-oracle validation and any bound-hook evidence settle.
Their results must all agree before the resolved identity can authorize simulation.

For batching-capable Nitro sources, the isolated ArbOS probe, NodeInterface poster
quote and permissive exact-calldata measurement overlap. Probe isolation and its balance
override do not enter the real execution sequence. Exact-gas validated replay waits for
matching native metering, the poster budget and successful measurement. The redundant
probe-only chain/hash recheck was removed: successful admission and simulation refusal
still perform the enclosing live chain/canonical-block assertion. Natural child-block
fees, uint64 gas bounds, real payer affordability, EIP-150 envelope discovery and
postconditions are unchanged. Non-batching sources retain sequential measurement.

No process-wide or cross-review cache, new read authority, public scope API, admission
skip or write was introduced. Both opening-buy planning passes still choose fresh heads,
retain live chain/pending/receipt observations and execute their own native proofs and
validated replay. Only identical, complete pinned wire reads inside one invocation reuse
observations.

Offline regressions cover concurrent retained dependency responses, changed runtime,
authority, graph digest and capability refusal through contract-modeled eligibility,
canonical registry identity mismatch, build-next refusal after graph drift, V4
expected-address evidence with mismatched live getters, overlapped measurement without
premature replay, failed native evidence, serial/batched plan and fee equality, and
retained final canonical checks. Obsolete duplicate-getter tests were removed. Final
build, tests and end-to-end browser/HTTP latency measurement are pending with the
integrating verification owner; these changes alone do not claim a sub-ten-second review.

## 0.6.2 opt-in internal timing

Initialize a lifecycle read client with optional `onDiagnostic(event)` to observe internal
planning, profile certification, simulation context, Nitro probe, poster estimate, measurement,
exact replay and envelope-discovery stages. Each stage reports start and completion/failure.
RPC events distinguish queue admission, actual request start, settlement and invocation-local
read reuse; `queueMs` is separate from request `durationMs`. `requestId` is a local numeric
sequence, not a network or wallet identifier. Associate each client with your own local operation
label when several reviews run concurrently.

```ts
const client = {
  supportsReadBatching: true, // Only with an actually batching transport.
  request: (args) => publicClient.request(args),
  onDiagnostic: (event) => { console.debug("[launch-sdk]", event); },
};
```

The SDK never enables console output or telemetry itself. Without a listener there are no
diagnostic clocks or event allocations. Events omit RPC URLs, parameters/results, accounts,
addresses, signatures, calldata and raw errors; RPC method names are allowlisted. Synchronous
listener throws and asynchronous listener rejections are isolated from financial behavior.
Successful timing settlement means the function returned, not that the returned plan/profile
was admitted: inspect its normal typed admission result.

Independent domain/progress reads now overlap after token prediction. Simulation context
reads, Nitro/poster work and final chain/canonical observations also overlap where their inputs
are independent, still within the existing transport-opted-in read bound. Serial transports,
exact state/identity guards and both measurement and validated execution are retained.
No total-launch latency claim is made from these scheduling changes.

Verification: typecheck and the built offline suite passed **126 tests: 125 passing and one
opt-in real-AMM skip**. Diagnostics regressions cover timing events, payload omission and
throwing/rejecting observers without changing valid profile admission.

## 0.6.1 read-pipeline changes

Existing standalone calls, deployment targets, economic commitments and admission
requirements remain compatible. Invalid plan shapes are still refused before RPC work.
The optional `LifecycleRpcClient.supportsReadBatching` transport hint enables independent
getter dependency rounds with at most eight SDK-issued requests outstanding per invocation.
Set it to `true` only when the supplied transport batches concurrent requests; the SDK
does not select or configure a transport. Other clients retain serial requests, avoiding
the measured concurrent-unbatched RPC regression. With batching enabled, initial head
and chain reads overlap. Failed reads release their slots without rejecting unrelated
queued callers or automatically retrying.

A vanilla one-pool, one-quote, one-range plan selects only its committed profile IDs.
Abyss-only profile selection no longer requests the V4-only
`protocolMaximumDeveloperFeeBps` getter. A required V4 fee-limit read still fails the
operation if unavailable. V4 oracle/deployer/terms work, extra token/position capabilities
and swap-funding checks remain conditional on the actual committed plan. There is no
weakened single-pool mode: adapter eligibility, live code hashes, authority/dependency
bindings, schema/topology and applicable frozen terms remain mandatory.

Identical fixed-state reads share observations only within one planning invocation.
Identity includes the original source client, pinned block number/hash and complete
request parameters, including caller, target, calldata, value and gas context. Rejected
reads are not retained. State changes, another caller/source/block or a subsequent public
planning invocation cannot reuse those observations; mutated plans and obsolete
completions are refused. There is no global cache or new public read-scope option.

Chain checks, latest/head/pending observations, receipt reads and canonical block rechecks
remain live. Wallet/provider preflight, non-view execution calls and stateful/fork RPC
are not cached. Nitro metering probes, discovery and exact validated replay remain
separate proofs. A protected opening-buy minimum changes the committed calldata and
still requires a second full plan and stateful simulation against a fresh latest snapshot.

Raw `request({method,params})` clients remain valid. JSON-RPC HTTP batching is optional
and transport-owned; concurrent reads allow a configured batch scheduler to combine
independent messages without changing `msg.sender` or the pinned state. No API planner
service, transport fallback, signature or broadcast is introduced. The existing Node 20
minimum and ES2022 target are unchanged; shipped scheduling does not require
`Promise.withResolvers`.

Verification on 2026-10-06: `pnpm typecheck` and `pnpm test` passed, including the build,
with **123 tests: 122 passing, one opt-in real-AMM test skipped and zero failures**.
Offline regressions exercise the vanilla
Abyss path without V4 fee metadata, mandatory V4 read failures, bounded overlap and
duplicate reads, exact combined funding, changed code/authority/terms, partial failures,
chain drift/reorgs, source/caller/call-context separation, failed-slot release and
obsolete results. These offline checks are not real-wallet or on-chain execution evidence.

A live read-only comparison against installed 0.6.0 measured **one selected canonical
Abyss profile certification only**, not whole planning, simulation or launch execution.
Both versions used Node 24.11.1, viem 2.56.3 and identical pinned chain 4663 state at
block 81455627, hash
`0x66f20d4c04b1c2357e9cd711c984a83fc8913ab208449ff1a0c8289bf2854036`.
Five runs per version and transport alternated version order; returned profiles were
deep-equal, and the chain and canonical block were independently rechecked.

| Transport | Version | Median / p95 (ms) | RPC messages | HTTP envelopes | Peak outstanding |
| --- | --- | --- | --- | --- | --- |
| Unbatched, default serial | 0.6.0 | 1496.10 / 1677.93 | 15 | 15 | 1 |
| Unbatched, default serial | 0.6.1 | 1402.10 / 1414.52 | 14 | 14 | 1 |
| Batched, explicit opt-in | 0.6.0 | 1503.38 / 1541.41 | 15 | 15 | 1 |
| Batched, explicit opt-in | 0.6.1 | 1005.11 / 1219.87 | 14 | 10 | 3 |

These scoped measurements do not establish end-to-end launch latency or a general
provider guarantee. An earlier unbatched concurrency trial regressed from a 1150.64 ms
baseline median to 3870.97 ms; explicit transport opt-in and default serial scheduling
remove that scheduling choice for existing clients. For reproduction, keep the selected
profile, pinned state, source, retry/batching settings and runtime equal; count RPC
messages separately from HTTP envelopes and retain failures as failures. Do not log RPC
URLs, accounts, calldata or provider messages, or substitute full-registry/complex-only
timing for the selected-profile path.

## 0.6.0 admission changes

Optional caller policy no longer substitutes for, or gates, actual sequential execution proof.
Results distinguish `executionProof`, `protocolFit`, and `transportPreflight`. Robinhood
admission reads pinned Nitro compute limits and poster budgets, then requires native exact
validated replay. `buildNextTransaction` optionally preflights the immediate next envelope
through `submissionClient`. Deployment addresses, lifecycle plan/schema domains, profile
capabilities and explicit atomic/staged behavior are unchanged.


## Deployed infrastructure

Robinhood mainnet (`4663`) selects the mined `pool-launch-v1` deployment captured at block
`80548181` in `contracts/deployments/launch/pool-launch-v1/20261005T053747Z-b5a7b88/manifest.json`.
The manifest records successful receipts and canonical runtime evidence. The graph has two
adapters and five admitted profiles: one fixed pool-bound V4 profile and four canonical Abyss
variants. It does not deploy a shared V4 root.

| SDK field | Mainnet address |
| --- | --- |
| `launchOrchestrator` | `0xb75CBD17b9aecb7305B4DFcDa69595F783341c0E` |
| `launchImplementationRegistry` | `0xaa8a410709B79cBA6F118F1be1FF568877A3B8Ee` |
| `launchFeeOwnerRegistry` | `0x15778Aad08e12D458B2848F035860e2a8c2a0725` |

`getAddresses(4663)` exposes this graph; `robinhoodLaunchApplication` exposes the mined
launch constants. Launch addresses on `31337` and `46631` remain zero unless configured.
Address overrides are evaluated once on import: bare names win, then `VITE_`, then
`NEXT_PUBLIC_`. Configure `LAUNCH_ORCHESTRATOR`, `LAUNCH_IMPLEMENTATION_REGISTRY`, and
`LAUNCH_FEE_OWNER_REGISTRY` from the same deployment evidence.

Canonical Abyss defaults are retained. DEX overrides apply on `31337` and `46631`, not
mainnet. Lending mainnet defaults use `contracts/deployments/robinhood/replacement-infrastructure.json`;
the workbench's existing lending endpoints follow that replacement. Lending overrides apply
on `31337` (all three prefixes) and `46631` (`VITE_`/`NEXT_PUBLIC_`); liquidation-executor
overrides use all three prefixes on every chain. Workbench chain RPC configuration reads
`VITE_RPC_URL`, then `NEXT_PUBLIC_RPC_URL`, then `RPC_URL`; client factories prefer their explicit
`rpcUrl`, then `RPC_URL`, then the chain endpoint. Select the chain explicitly in applications.

Registry V2 has one `LaunchCertificationV2` child. V4 uses `profileEnvelope`, `profileId`, and
signed six-argument `registerProfile`. Admin-only `registerAbyssProfile(uint8,registration)`
independently certifies config-1 variants without an author envelope or royalty allocation.
The admission EIP-712 domain is `Black Market Launch Registry`, version `2`.

`LaunchBoundsV2` has five members: minimum/maximum tick spacing, maximum positions,
maximum oracle cardinality, and fee-mode flags. Creators select valid LP/hook rates below
1,000,000 pips, a registered oracle configuration, and per-pool external-liquidity policy.
Author royalty ceilings are separate. Robinhood P1 `(1,4096)`, P2 `(6,4096)`, and P3 `(17,4096)`
can use the same admitted profile; the selected oracle is checked at the pinned block.
With `externalLiquidityDisabled=false`, third-party LP add/remove is allowed after opening.
Permanent launch custody and pre-opening protection still apply.

The deployed pool stack uses `FixedFeePoolHookV1`, `PoolHookDeployerV1`,
`PoolMarketAdapterV1`, and `PoolFeeCollectorFactoryV1`. The complete `fixedFeePoolHookV1Abi`
includes the exact **one-tuple, 18-field constructor**, callbacks, events, and errors from the
mined artifact. Its fixed scalar fee calculation does not imply a scalar-argument constructor.
Generic shared contracts are `FixedFeeSharedHookV1`, `SharedHookDeployerV1`, and
`SharedMarketAdapterV1`; they require their own admitted deployment graph.
Other current ABI exports include `sharedMarketAdapterV1Abi`, `sharedHookDeployerV1Abi`,
`poolMarketAdapterV1Abi`, `poolHookDeployerV1Abi`, and `poolFeeCollectorFactoryV1Abi`.
Validation uses `validateV4LifecycleMarket`; the collector factory getter is
`dependencyDigest(address)`. Identity domains are `black-market.launch-profile.v2`,
`black-market.v4-dependencies.v2`, and `black-market.pool-bound-market-economics.v1`.

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
| `buildNextTransaction({client, planned, submissionClient?, limits?, fork?, receipts?, confirmations?, action?})` | Rereads progress, constraints and stateful proof before returning one admitted transaction. Optional `submissionClient` adds read-only exact immediate envelope preflight. `action: "cancel"` uses the stored commitment without requiring fresh adapter/profile admission. Terminal launches return `undefined`. |

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

The profile identity uses domain `black-market.launch-profile.v2` and commits the four review/economic digests, topology/config/economic versions, stable beneficiary, maximum author rate and capabilities. It deliberately excludes instance addresses. `hashLifecycleProfile`, `encode/decodeLaunchEnvelope`, `encode/decode/hashLaunchBounds` and `hashLaunchDependencies` expose exact canonical encodings/domains. Graph dependency hashing includes chain/core/registry/registrar, live runtime commitments and exact code-chunk provenance; only the shared deployment salt is outside that economic dependency digest.

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

Both preserve LP/hook fees, tick spacing, opening price, fee mode/denominator/treasury, external-liquidity policy, and canonical oracle identity. Then come `profileId`, `termsDigest`, `developerBeneficiary`, and explicit `developerFeeBps`, followed by positions. Version 5 inserts `hookSalt` immediately before `profileId`. Every developer rate, including zero, is creator-selected. Copy terms from the selected profile's envelope. Inner/outer profile IDs must match; author identity is not the live payout. The creator rate cannot exceed either reviewed maximum or protocol ceiling.

```ts
const profile = profiles.find((row) => row.id === selectedProfileId);
if (!profile?.admitted || !profile.envelope || !profile.developerTerms) throw new Error("Selected profile is not reviewed/admitted");
const config = encodePoolBoundV4LifecycleMarketConfig({
  version: 5, hookSalt: zeroHash, lpFeePips, tickSpacing, sqrtPriceX96, hookFeePips, feeMode,
  protocolFeeDenominator: profile.envelope.protocolFeeDenominator,
  treasury: profile.envelope.protocolTreasury,
  externalLiquidityDisabled: creatorSelectedExternalLiquidityDisabled,
  oracleConfigId: creatorSelectedOracleConfigId,
  profileId: profile.id, termsDigest: profile.developerTerms.termsDigest,
  developerBeneficiary: profile.developerTerms.beneficiary,
  developerFeeBps: creatorSelectedRate, positions,
});
```

`validateV4LifecycleMarket` checks profile/terms/topology/version, explicit author-rate ceilings and exact envelope bounds. Registry/adapter validation remains the execution authority. Positions must require **zero quote deposit** at the committed opening price in actual token orientation. Quotes fund ordered buys, not two-sided initial LP. At most one V4 market per quote is allowed across all templates/topologies/fees/salts; put that quote's positions into one market. Abyss may use the same quote.

`validateV4LifecycleOracle({client,envelope,oracleConfigId,block})` checks the selected registered
oracle against the certified factory and `maximumOracleCardinality`. Profile discovery does
not choose an oracle or query a profile-pinned oracle ID.

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

The collector supplies canonical normalized economic commitment and constructor metadata. `hashPoolBoundV4MarketCommitment` uses domain `black-market.pool-bound-market-economics.v1`: chain, core, registrar, predicted token, adapter/profile/quote/budget/version and encoded config hash with **only hookSalt zeroed**. Developer identity/digest/rate remain committed. The 18-word constructor freezes manager, registrar, oracle factory, core, locker, token/quote, fees/spacing/price/policy, economic commitment and position count. Salt is used verbatim by CREATE2, not as a constructor argument.

Mining is cancellable/nonblocking; `abort()` raises `AbortError` and does not cancel an onchain launch. Persist the returned finalized plan, not the draft. A salt-only change preserves normalized economics but changes final plan hash. Other changes invalidate initcode/mining; concurrent mutation is refused. Normal next-step review rechecks token factory and the captured `hookDeployments` baseline. Predeployment is permissionless, but code presence or self-reported getters alone cannot be adopted as provenance. It does not register/initialize/seal/open a market and does not eliminate real code-deposit/setup gas.

## Explicit execution mode and indivisible activation

Every planning call requires `mode: "atomic" | "staged"`. For an unstarted launch, `atomicAttempt` records the exact approval/funding plus atomic sequence independently of the requested graph.

- Atomic: after funding prerequisites, token creation, empty infrastructure, all mint/lock/buys/public activation are one transaction.
- Staged: prerequisites, `beginLaunch(Staged)`, contiguous empty `prepareMarkets` batches, then one `activateLaunch`. Preparation batches may shrink to fit.
- Activation cannot split. If mint/lock/all buys/opening cannot fit, staged is also refused. No position/buy/minimum is omitted to manufacture success.

No automatic atomic-to-staged fallback exists. Obtain separate consent to review the same commitment as staged. Both venues use token transfer restrictions plus activation-time canonical opening-state checks, not a pool gate. Manipulated opening price or preactivation liquidity fails verification; the token stays inactive and the launch remains Ready/cancellable. Failed activation rolls back every mint, seal, buy and opening together.

## Execution constraints and stateful simulation

Optional `chainGasLimit`, `rpcGasLimit`, `accountGasLimit`, `maxCalldataBytes` and
`maxSimulationGas` tighten admission when supplied. Missing policy remains explicit in
`limits.unknownExecutionConstraints`/`unknownConstraints`; it does not reject an otherwise
proved exact sequence or invent a provider/account cap. No policy service is required.
A `LifecycleLimitSource` callback receives the canonical chain/account/core/block context.
Any supplied provenance must match it; stale/mismatched/malformed facts or a failed supplied
resolver reject rather than disappearing into optional uncertainty. Gas caps are positive
exact uint64 `bigint`; calldata is a positive safe integer byte count.
Reviewed gas envelopes are positive uint64 too; zero-metering observations cannot admit
a zero-gas transaction. Headroom calculations retain wide exact bigint intermediates.

Headroom defaults to 1,500 bps, bounded 0–10,000. Generic EVM admission uses the pinned
bounded header and supplied total-envelope restrictions plus actual validated RPC proof.
It reports an absent independent per-transaction cutoff honestly, without importing a
universal Ethereum cutoff. `executionGasCeiling` and `transactionGasCeiling` are equal on
generic EVM. The permissive measurement pass never admits a launch: replay must execute
the exact returned gas/fee envelope, every postcondition and all ordered buy bounds.
Fork discovery uses gross sequential estimates, not refund-reduced receipt gas as an
executable minimum. Explicit ceiling recovery preserves gasleft/EIP-150 validation and
carries that successfully replayed ceiling, never a smaller unproved envelope.

Sequential backends:

1. `eth_simulateV1`: ordered transactions with state carried between synthetic blocks, followed by exact validated replay.
2. Generic EVM only: explicitly separate disposable loopback fork, with snapshot-isolated real transactions, pinned chain/header identity, canonical poststate/allowances and mandatory cleanup. Source RPC stays read-only.
3. Neither: unavailable/provisional/unadmitted; disconnected dependent `eth_call` estimates cannot create an executable next transaction.

Every proof completion rechecks the planned source chain ID and pinned block hash. A
changed source transport cannot retain admission merely by returning the same fork hash.

### Nitro compute and poster accounting

For Robinhood `4663`, each pinned context reads ArbSys (`0x64`).`arbOSVersion` and ArbGasInfo
(`0x6c`).`getMaxTxGasLimit`/`getMaxBlockGasLimit`. ArbSys returns **55 + logical ArbOS version**;
the raw value must be at least 105, and `limits.arbOSVersion` reports logical version 50+.
The positive validated getter values establish `maxTxComputeGas`, `maxBlockComputeGas`
and their minimum `executionGasCeiling`. Failed reads never fall back to the huge Nitro
header or a hard-coded 32M. `limits.protocol` identifies `"nitro"` or `"evm"`.

Nitro `transactionGasCeiling`, when present, is the minimum of supplied **complete**
chain/RPC/account gas-envelope restrictions. It is independent of the compute ceiling:
an admitted transaction's `gas` may exceed `executionGasCeiling` because poster gas is
not compute. NodeInterface (`0xc8`).`gasEstimateL1Component` is read at the same pinned
block with the exact sender, destination, calldata and value, including future dependent
steps whose execution cannot yet be independently estimated. It budgets poster gas only.
The buffered compute-discovery envelope plus buffered poster budget is carried into
exact validated replay; an approximate poster quote is never subtracted from total
gas use to certify exact compute fit.

A separate pinned validated simulation probes all three ArbOS/version/getter values
against the canonical observations. Only that isolated capability probe temporarily
overrides the probe account's balance, so probe-only fees cannot reject an exactly-funded
launch. Probe funding/nonce changes, steps and fees never enter real plan measurement,
replay, postconditions or affordability, which use actual payer state. The native Nitro
`eth_simulateV1` commit-mode ArbOS charging hook removes the **actual** poster charge and
holds excess compute gas before execution. Successful exact replay and postconditions,
not the quote or permissive pass, prove fit. Missing native metering or a mismatched
probe fails closed. Generic Anvil/Hardhat forks cannot certify Nitro execution.

Transactions expose `estimate.executionFee`, optional external `dataFee`/`totalFee` and
`feeConfidence: "execution-and-data" | "execution-only"`. On Nitro, `posterGas`/`posterFee`
are the estimated buffered allocation **inside** `gasLimit`, `dataFeeIncludedInGas` is
true, `dataFee` is zero and `totalFee` equals `gasLimit * gasPrice`. Affordability counts
this complete envelope once; adding `posterFee` again would double-charge. A caller
`estimateDataFee` is therefore rejected on Nitro. On generic EVM it retains its original
semantics as a validated external fee added outside execution gas. Missing external fee
does not manufacture an all-in estimate. All observations and limits refresh for build-next.

Source references: [ArbSys version encoding](https://github.com/OffchainLabs/nitro-precompile-interfaces/blob/main/ArbSys.sol),
[ArbGasInfo compute getters](https://github.com/OffchainLabs/nitro-precompile-interfaces/blob/main/ArbGasInfo.sol),
[native simulate commit mode](https://github.com/OffchainLabs/go-ethereum/blob/51d716ccf8293072077feb9764d63d73f5e4ff20/internal/ethapi/simulate.go),
[ArbOS actual poster/compute charging](https://github.com/OffchainLabs/nitro/blob/ccc5c828d9ea22f161efc784bac4d4a6559b7e59/arbos/tx_processor.go),
and [NodeInterface poster estimate](https://github.com/OffchainLabs/nitro-contracts/blob/main/src/node-interface/NodeInterface.sol).
These describe backend semantics, not evidence of a live launch executed by this SDK release.

Atomic/activation simulation `steps[].returnData` encodes the actual `LaunchReceiptV1` tuple. Controlled-fork output is reconstructed from matching real activation/buy receipt logs and canonical state, never geometric estimates or echoed request minima. `tokenOut` and `quoteSpent` are parallel arrays indexed by ordered buys.

```ts
const fork = createControlledLifecycleFork({
  sourceRpcUrl: "http://127.0.0.1:18555", forkRpcUrl: "http://127.0.0.1:18556",
  allowTransactions: true, impersonation: "anvil",
});
const planned = await planLaunch({client, account: plan.creator, plan, mode: "staged", limits, fork});
```

The fork endpoint must be distinct/loopback, including localhost/IP aliases and effective port. Anvil reset/impersonation is default; disposable Hardhat may explicitly use its reset method/impersonation. Never pass the source client as a fork or use a live unlocked wallet as a disposable backend. Operators own exclusive fork access during generic EVM proof. Controlled-local execution does not prove wallet submission acceptance and cannot certify Nitro metering or imply bound topology is a gas optimization.

## Wallet submission and canonical recovery

The SDK never signs. Before **every** approval/reset/core/predeploy/cancel signature, compare the wallet's configured chain (if any) and fresh connected `getChainId()` with the returned `next.chainId`. Failure/invalid identity is a refusal. Supply a matching explicit viem Chain descriptor; do not pass `chain: null` or disable wallet chain checks. Send exact `from/to/data/value/gas/gasPrice`, not a cached estimate or wallet batch.

Simulation and `next.admission` carry flat, independent proof outcomes:

| Field | Values | Scope |
| --- | --- | --- |
| `executionProof` | `"proved"`, `"failed"`, `"unavailable"` | Complete stateful exact-envelope execution and postconditions, never permissive measurement alone. |
| `protocolFit` | `"proved"`, `"failed"`, `"unknown"` | Applicable proven protocol and known tightening restrictions. Missing optional policy remains separately disclosed. |
| `transportPreflight` | `"not-requested"`, `"passed"`, `"failed"` | Immediate exact next-transaction acceptance estimate on the supplied submission RPC. |

`admitted` means the current exact sequence is proved to fit and affordable; it is
not guaranteed wallet submission or future execution. Admission reuses simulation
`blockNumber`, `blockHash`, `account`, `chainId` and `limits`. Plans never preflight
future dependent transactions against state that does not exist.

```ts
const planned = await planLaunch({ client, account: plan.creator, plan, mode: "atomic" });
const submissionClient = {
  request: ({ method, params }) => activeProvider.request({ method, params }),
};
const next = await buildNextTransaction({ client, planned, receipts, submissionClient });
// Freshly verify the active wallet account/connector/chain again, then review/sign next.
```

When supplied, `submissionClient` receives only read-only `eth_chainId` and
`eth_estimateGas` for the immediate next `from/to/data/value/gas/gasPrice` at `latest`.
Its positive estimate must fit the reviewed gas exactly; gas is never silently enlarged.
Chain identity is checked before and after estimation, and the source pinned hash/chain
is rechecked before returning. Success sets `next.admission.transportPreflight` to
`"passed"`. Refusal, unsupported RPC, malformed estimate, over-envelope estimate or
chain drift raises `SUBMISSION_PREFLIGHT_FAILED` without returning a transaction.
The error's `simulation` retains execution admission and its canonical context, changing
only transport outcome/reason to `"failed"`. Cancellation uses the same preflight.
Without a submission client, `"not-requested"` remains honest and no wallet RPC is implied.
Applications still own fresh active account/provider guards around asynchronous work;
a read-only preflight does not authenticate an active wallet or authorize a signature.


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

Build and run the offline unit suite with `pnpm test`, and deployed read-only discovery with
`pnpm examples`. Unit regressions cover commitment/identity/numerical domains,
reviewed terms/rate/bounds, salt normalization/mining, receipt recovery, and author
authentication/routing/page outcomes. Wire vectors remain
offline schema references; they are not a mainnet launch or an admitted deployment graph.

`examples/launch.mjs` reviews a saved plan without signatures or source-chain writes:

```sh
pnpm build
node examples/launch.mjs --plan plan.json --rpc https://rpc.mainnet.chain.robinhood.com/ --mode staged --mine
```

The saved plan must use that RPC's chain and current deployment. `--mine` finalizes bound
salts offchain; `--limits current-limits.json`, `--receipts receipts.json`, and `--confirmations N`
supply explicit execution/recovery evidence. The command never invents provider/account limits.
Without a sequential simulation backend and matching execution-limit provenance, its review
can be provisional and cannot produce an admitted next transaction.

`examples/launch-lifecycle-smoke.mjs manifest.json sdk-plans.json` executes Solidity-exported
plans only on explicitly authorized owned loopback fixtures. It exercises atomic/staged
modes, typed predeployment, ordered buys, permanent custody, canonical recovery, no-argument
V3 harvest, and authenticated author claims. `test/lifecycle-chain.test.mjs` exercises
real-graph refusals/reorg/cancellation with the same fixture environment. See
[example instructions](../examples/README.md#actual-owned-fixture-proof) for the explicit
local-execution opt-in and required files.

## Individual token creation examples

Eight independent `examples/launch-erc20-*.mjs` / `launch-erc404-*.mjs` files invoke
the shared `runLaunchExample(caseObject)` using fixed economics and no parameters or
fixture files. See the [example guide](../examples/README.md#individual-token-creation)
for the eight one-line commands and setup-once working-directory `.env`.
Node 24+ loads `.env` once, with existing process environment taking precedence.
`PRIVATE_KEY` and `LAUNCH_API_URL` are required before RPC/signing/API work; there is
no default key, guessed API or API-omission mode. Running a case deliberately authorizes
real local signing, source-chain transactions and API publication; mainnet writes are
irreversible. The official SDK chain-4663 RPC is the default.

The implementation imports public `@black-market/sdk`, resolves `getAddresses(4663)`,
derives the creator from the key and discovers the actual admitted profiles. V4 requires
bound topology/config `5`; Abyss requires exact adapter `profileId(3)` QUOTE_ORACLE/config
`1`. It verifies wrapped-native binding/decimals and registered P1 oracle `(1,4096)`.
All eight original token/reward/venue/position/mode cases retain their exact economics:
ERC20 `1_000_000e18` supply; ERC404 `10_000e18` supply / `100e18` NFT unit; selected
staking/dividends and token-only burn; one through five permanent positions and ordered
native-wrap opening buys. It saves identity/finalized salts/plans before execution and
never changes mode, drops positions/buys or overrides failed admission.
Optional `NFT_BASE_URI` provides an ERC404 base URI you actually host; its default is
empty, with real NFT units/mirror behavior but no claim of hosted NFT metadata.

The chain-4663 examples require native sequential Nitro `eth_simulateV1`; generic
Anvil/Hardhat simulation is not an ArbOS compute/poster proof. Source RPC requests
have a 120-second bound and are not retried. There are no invented default gas or
calldata caps. Explicit environment restrictions only tighten the complete envelope;
headroom defaults to 1,500 bps. SDK native pinned compute/poster reads and exact replay
remain mandatory, and build-next uses the same source RPC as the read-only submission
preflight before each local signature. Environment options are documented in the example guide.

Execution rechecks chain/creator/destination and exact finalized calldata before each
send. Exact admitted envelopes are signed locally; computed hashes and unsigned
envelopes are saved **before** the single raw broadcast, and included receipts are
saved before status/provenance assertions. One canonical confirmation is required.
Actual verification covers Active state, factory/token runtime/name/symbol/kind/rewards,
ERC404 unit/URI/mirror, opened markets, sealed V4 custody/permanent Abyss lock terms,
fee policies and ordered activation buys.

Actual SDK API metadata staging uses locally signed full-domain attribution. Only the
real activation hash is published. Genuine pending-indexer HTTP `202` is polled within
90 seconds respecting `Retry-After`; other failures are not retried. Success requires
an optimistic/final session and real indexed `/api/v1/launches/<token>?chainId=4663`
DTO with matching creator/token/hash/metadata. Missing/incompatible indexing fails
honestly without manufacturing projections, skipping API or launching another token.

Every run automatically creates fresh `launch-results/<timestamp-case-random>/`:

| Artifact | Evidence |
| --- | --- |
| `events.jsonl` | Timestamped case/stage events, RPC/API errors, admission/simulation and actual chain observations. |
| `plan.json` | Full finalized portable SDK plan saved before execution. |
| `receipts.json` | Exact signed-envelope hashes retained pre-broadcast, followed by real receipts/references. |
| `result.json` | `black-market.launch-example-result.v1`, end-to-end status, failure stage and causal evidence. |
| `published-token.json` | Actual indexed API representation. |
| `private-recovery.json` | Mode `0600`; signed raw bytes, API signature and one-time capability. Never share/commit. |

Public artifacts redact known keys/signatures/raw bytes/capabilities/auth values and
endpoint secrets while retaining public calldata/hashes/revert bytes. Configuration,
admission, broadcast, publication and interruption failures exit nonzero and preserve
evidence. No source rollback, cancellation, broadcast retry or relaunch occurs.
Inspect retained transaction hashes before deciding to run a new case after an
ambiguous send. `test/launch-example.test.mjs` covers offline signing/retention/config
boundaries only, not actual chain/API proof. The older independent whole-graph local
Solidity-exported proof remains separate.

## Real HTTP API integration

The opt-in suites use `LaunchApiClient` and actual HTTP requests—not a mocked transport.
They do not start a service or provision storage. Configure an abyss-api service with:

- `/api/v1/launch-upload-sessions` and its capability-protected read route;
- real application PostgreSQL storage with launch-upload-session migrations applied;
- an enabled request chain matching `LAUNCH_API_TEST_CHAIN_ID`;
- its current launch verifying contract matching `LAUNCH_API_TEST_ORCHESTRATOR`.

For the actual abyss-api service, that verifying contract is the configured deployment
`contracts.launchFactory` field, which must contain the current orchestrator address.
The signed attribution domain is `Abyss Launch Attribution`, version `1`. Session signature
deadlines must be future timestamps at most 15 minutes away. Metadata hashes use canonical
NFC/trimmed text, normalized URLs, fixed field order, and null absent optional values.

| Environment | Meaning |
| --- | --- |
| `LAUNCH_API_TEST_URL` | Required HTTP service root, e.g. `http://127.0.0.1:18763`; no implicit production target. |
| `LAUNCH_API_TEST_CHAIN_ID` | Defaults to `4663`; must be configured on the test service. |
| `LAUNCH_API_TEST_ORCHESTRATOR` | Defaults to `0xb75CBD17b9aecb7305B4DFcDa69595F783341c0E`; must match the service's signing domain. |
| `LAUNCH_API_TEST_PRIVATE_KEY` | Required only for the explicit signed suite; disposable EOA key, never a production key. |

```sh
# Read-only capability/error boundaries; no key and no storage writes.
LAUNCH_API_TEST_URL=http://127.0.0.1:18763 pnpm test:api

# Signed metadata-session writes, allowed only on an owned disposable loopback service.
LAUNCH_API_TEST_URL=http://127.0.0.1:18763 \
LAUNCH_API_TEST_PRIVATE_KEY="$DISPOSABLE_TEST_PRIVATE_KEY" pnpm test:api:write
```

The write suite creates metadata-only sessions, reads persisted normalized metadata,
replays the byte-identical signed body without reissuing the one-time capability, refuses a
changed authorized payload under the same idempotency key, and checks capability isolation.
It also rejects wrong signers, wrong orchestrator/chain domains, altered metadata, a changed
idempotency key, expired authorization, and invalid signatures. The private key signs EIP-712
metadata only; it need not have a balance. Unique session/key/nonces permit repeat runs.
The disposable service operator owns database cleanup; the API has no session-deletion route.

Neither suite needs an image store, indexed launch, confirmed transaction hash, or chain
write. Metadata sessions do not prove token deployment, image publication, or transaction
indexing. Image/upload/publication operations require those additional real prerequisites
and are not exercised here. Explicitly selected suites fail on missing URL/key, absent
storage/routes, an unreachable service, or incompatible signing configuration instead of
silently skipping. Ordinary `pnpm test` stays offline and does not select HTTP integration.
