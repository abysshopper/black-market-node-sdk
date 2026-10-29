# Launch SDK reference

Use the [launch guide](launch-lifecycle.md) for the end-to-end flow and the
[runner reference](../examples/README.md) for environment and recovery artifacts.
This page covers SDK **0.16.0** addresses, limits, wire formats, fees, and diagnostics.

## Deployed infrastructure

Robinhood Chain mainnet is **4663**. Resolve the graph with `getAddresses(4663)`;
`robinhoodLaunchApplication` contains the launch constants. Do not copy an old core
address from a saved example. The current core was created at block **82,880,313**;
start historical log queries there, in chunks of at most **10M blocks**.

| SDK field / export | Address |
| --- | --- |
| `launchOrchestrator` / `UFG_ORCHESTRATOR_ADDRESS` | `0x91560876033d568d25CDe98C78c33ff8FC43962c` |
| `launchImplementationRegistry` | `0xB2B0f9F36617810D67b8fC175153Aa10024C1358` |
| `launchFeeOwnerRegistry` | `0x64b5ca1f21B8E84305b0e4D847924dca39Eb1fcb` |
| `UFG_LAUNCH_PROXY_ADDRESS` | `0xf6673d859DE03eB74A0b01696Edb97f941dFD0CA` |
| `UFG_TREASURY_FACTORY_ADDRESS` | `0x26Aa5D52134c8E6c4C01E9fb53A7568c0C64901F` |
| `UFG_UPSTREAM_FACTORY_ADDRESS` | `0xA170b5A58C111334A7237F2Ea2c428ec5022f68E` |
| Known deployment `launchLens` | `0xcb4bb3caca71fe52eace8170cf83e901418646f8` |
| `RAETO_PAYOUT_REGISTRY_ADDRESS` | `0xBEC2C0e91612090F82df6743F31CDF18B4386b50` |

`getKnownLifecycleDeployment`, `getKnownLifecycleProfile`, and
`listKnownLifecycleProfiles` are pure selectors keyed by chain/core. Unknown
identities return no preset. Use `readLifecycleProfiles` for live admission;
its `offset` / `limit` are bigint, defaulting to `0n` / `100n`.
Registry enumeration uses `profileCount`, `profileIds`, `adapterCount`, `adapterIds`;
selected registration/topology/eligibility use `profile`, `adapter`, `profileTopology`, `requireEligible`.

Local chain **31337** and workbench **46631** have zero launch addresses until configured.
Set `LAUNCH_ORCHESTRATOR`, `LAUNCH_IMPLEMENTATION_REGISTRY`, and
`LAUNCH_FEE_OWNER_REGISTRY` from one deployment. Address overrides are read once on
import: bare names, then `VITE_`, then `NEXT_PUBLIC_`. Client factories prefer explicit
`rpcUrl`, then `RPC_URL`, then the chain endpoint; always select the intended chain.

## Check protocol limits

These are structural maxima, not a guarantee that activation fits gas.

| Item | Limit |
| --- | --- |
| Markets | 1–16 |
| Positions | At most 32 total; each profile can impose a smaller per-market bound |
| Ordered opening buys | At most 64 |
| Funding output assets | At most 8, unique ascending addresses |
| Fee assets | 1–8, unique ascending addresses; each policy sums to 10,000 bps |
| V4 markets sharing a quote | One across all V4 hooks, fees, and topologies |
| Individual market `config` | At most 16,384 bytes (16 KiB) |
| Individual swap-funding `data` | At most 16,384 bytes (16 KiB) |
| Whole transaction calldata | Optional `limits.maxCalldataBytes`; no default overall byte cap |
| ERC20 supply without rewards | Positive uint256 |
| ERC20 supply with rewards | Positive, at most `10^77` raw units |
| ERC404 supply | Positive uint96 |
| Token name / symbol / metadata URI | 1–128 / 1–32 / 0–2,048 UTF-8 bytes |
| Initial executor bounty | 0–1,000 bps; UFG requires 0 |
| Gas-envelope caps | Positive uint64 bigint |
| Gas headroom | `headroomBps`: 0–10,000; default 1,500 |
| Robinhood simulation-used gas | `maxSimulationGas`: optional aggregate policy ceiling; no SDK-invented default |

Use `LIFECYCLE_MAX_ERC404_SUPPLY` and `LIFECYCLE_MAX_REWARD_ERC20_SUPPLY` for the
exported supply bounds. Market token budgets equal total minted supply; position
maxima equal each market budget. Any unused mint remainder burns before buys.

## Encode plans and profile commitments

`@black-market/sdk/lifecycle` is the browser-safe lifecycle subpath. General pricing
helpers such as `deriveLaunchPoolRecipe` come from `@black-market/sdk`.
Use `serializeLaunchPlan` / `parseLaunchPlan` for decimal-string bigint JSON.
`encodeLaunchPlan` encodes `LaunchPlanV1`; `hashLaunchPlan` commits the full economics.
`hashLaunchIdentity` commits chain/core/creator/nonce. Mode and prepare batching are
execution metadata outside the plan tuple; retain them alongside the exact plan.

| Commitment helpers | Meaning |
| --- | --- |
| `encodeLaunchEnvelope`, `decodeLaunchEnvelope` | `LaunchEnvelopeV2`: digests, versions, capabilities, treasury, author, bounds, graph |
| `encodeLaunchBounds`, `decodeLaunchBounds`, `hashLaunchBounds` | Five bounds: spacing min/max, position max, oracle cardinality max, fee-mode flags |
| `hashLifecycleProfile` | Stable profile identity; excludes deployed instance addresses |
| `hashLaunchDependencies` | Chain/core/registry/registrar and exact dependency graph/runtime commitments |
| `hashPoolBoundV4MarketCommitment` | Per-pool constructor economics; canonical prefix with zero hook salt |

The registry admission EIP-712 domain is `Black Market Launch Registry`, version `2`.
Profile/dependency/market domains are `black-market.launch-profile.v2`,
`black-market.v4-dependencies.v2`, and `black-market.pool-bound-market-economics.v1`.
Profile retirement prevents new/pending source binding; it does not rewrite active
fee terms or disable stable-author credits.

## Choose a market codec

| Market | Outer / inner version | Encode / decode |
| --- | --- | --- |
| Canonical Abyss | `configVersion: 1`; canonical profile 0–3 | `encodeAbyssLifecycleMarketConfig`, `decodeAbyssLifecycleMarketConfig` |
| Shared V4 | `configVersion: 4`, `version: 4` | `encodeV4LifecycleMarketConfig`, `decodeV4LifecycleMarketConfig` |
| Historical pool-bound V4 | `configVersion: 5`, `version: 5`; matching historical graph required | `encodePoolBoundV4LifecycleMarketConfig`, `decodePoolBoundV4LifecycleMarketConfig` |
| Current pool-bound V4 | `configVersion: 6`, `version: 6` | Same explicit pool-bound codecs |

Shared config4 support does not imply a shipped mainnet shared-V4 offering.
Abyss config commits profile/fee/oracle/opening price and ordered tick/liquidity/token-max positions.
V4 positions also carry salt. All initial positions require zero quote deposit.

## Pool-bound V4, version 6

Match `V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA_V6`; historical version 5 uses
`V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA_V5`. Config6 inserts `minimumHookFeePips`
(uint24) and `feeSensitivityPipsSecondsPerTick` (uint32) immediately after
`hookFeePips` (maximum). `hookSalt` precedes `profileId`. Copy treasury, protocol
fee denominator, stable beneficiary, and terms digest from the selected profile.
Choose `developerFeeBps` explicitly, including zero, within both profile/protocol ceilings.
`externalLiquidityDisabled: false` permits third-party liquidity after opening;
launch liquidity stays permanently locked.

`validatePoolBoundHookFees` requires integer `0 <= minimum <= maximum <= 1,000,000`
pips and sensitivity `0..4,294,967,295` fee-pips × seconds/tick.
The fixed hook charges `floor(amount × hookFeePips / 1,000,000)`; storing minimum
and sensitivity does not make it dynamic. The Dynamic Fee Hook uses positive
quote-per-base tick velocity: `minimum + floor(positiveTickChange × sensitivity /
elapsedSeconds)`, capped at maximum. Quiet/falling prices, zero elapsed time, or
zero sensitivity use minimum. Dynamic requires LP fee **0**, developer fee **0**.

`encodePoolBoundHookParameters` requires explicit config version: config5 uses an
18-word V1 constructor; config6 uses a **20-word / 640-byte** V2 constructor.
`readPoolBoundHookDeployment` verifies the typed deployer, creation chunks, constructor,
salt, and predicted hook. `buildPoolBoundHookDeploymentTransaction` builds optional
permissionless predeployment only; it does not create/open a market.

`fixedFeePoolHookV1Abi`, `poolHookDeployerV1Abi`, and `poolFeeCollectorFactoryV1Abi`
are config5 contracts. Config6 uses `fixedFeePoolHookConfigV6Abi`,
`poolHookDeployerConfigV6Abi`, and `poolFeeCollectorFactoryConfigV6Abi`.
`validateV4LifecycleMarket` checks terms, schema, topology, and bounds;
`validateV4LifecycleOracle` checks the registered oracle against the envelope.

UFG adds a canonical dynamic tuple via `encodeUfgLaunchConfig`:
`abi.encode((uint16,uint16,address[]))`, including the leading `0x20` offset.
`decodeUfgLaunchConfig` rejects alternate encodings and extra bytes;
`hashUfgLaunchConfig` hashes the tuple. Config6 appends typed `ufgLaunchConfig`
for UFG profiles only; Abyss carries no UFG tail. Full plan hashes bind every
auxiliary tail. HMM/UFG/Raeto constructor economics hash the zero-salt prefix;
auto-compounding profiles hash the zero-salt prefix **and** their tail.

## Auto-compounding profiles

| `KnownLifecycleProfile` | Profile ID |
| --- | --- |
| `V4AutoCompoundStaticPool` | `0xdd53c2c686f822b2d17536ccf4f9db954b4976d1be80404bc74571253179fae0` |
| `V4AutoCompoundDynamicPool` | `0x46b81bfe9316fbaa90e930c6f1d5ad5e6ecfced2c886fd5520ca2bae11b92744` |

`AUTO_COMPOUND_STATIC_V1_PROFILE_ID` / `AUTO_COMPOUND_DYNAMIC_V1_PROFILE_ID`
export these identities. The presets freeze the admitted envelope, adapter,
registration, topology and exact hook creation code. The generator checks preserved
admission bytes and successful receipts against registry `profile`,
`profileTopology`, `profileEnvelope`, adapter metadata, module identity and runtime
hashes at Robinhood block **100,486,085**
(`0xa41849e3e83fb977ed2fbfc7ff71c639bdf1fc34489dc46878128c021fdb6c44`).
These are construction snapshots, not a claim of current admission.
The disabled `0x1e41…1d68` / `0x53dd…e0d7` profiles are not supported.

`AutoCompoundConfigV1` contains `compoundShareBps` (integer 0–10,000).
`encodeAutoCompoundTail` / `decodeAutoCompoundTail` encode exactly
`abi.encode(bytes32 version, uint16 compoundShareBps)` (64 bytes), where
`AUTO_COMPOUND_CONFIG_VERSION = keccak256("black-market.auto-compound.config.v1")`.
The decoder requires the exact version, length and canonical narrow-integer
padding. Config6's typed `autoCompoundConfig` selects this tail only for these
two profiles; HMM, UFG and Raeto tails cannot be combined with it.
`validateAutoCompoundConfig`, the market codec and `validateV4LifecycleMarket`
reject invalid shares; the market boundaries also require zero LP/developer fees.
Both InputToken and QuoteOnly fee modes are supported.

`hashPoolBoundV4MarketCommitment` includes the entire canonical zero-salt config
for these profiles. Never mine against a prefix-only commitment or append a share
after mining. Use [the launch guide](launch-lifecycle.md#configure-auto-compounding)
for selection and gas behavior.

## Raeto profiles

All of the following are exported from `@black-market/sdk/lifecycle` (and the
root). These presets are supported on the known Robinhood 4663 deployment.

| Profile key / identity constant | Profile ID |
| --- | --- |
| `V4RaetoFixedPool` / `RAETO_FIXED_PROFILE_ID` | `0x9161833b162e7ca8160b11c64aedb307561e19a9136fd32f99cd797aab6da3ca` |
| `V4RaetoDynamicPool` / `RAETO_DYNAMIC_PROFILE_ID` | `0x08387d00ee4f75f860810cc8fb434087328592c2f39ea3321109e589039f80e1` |

`RAETO_FIXED_ADAPTER_ID` is
`0x911d7ecefe56489d329235e3484829717dc00400d4181902f0f2de45f9338615`;
`RAETO_DYNAMIC_ADAPTER_ID` is
`0x8ab9c8c9b8fd4c8bbf12b780d9474463fa0fa52e3b450f0d5f68fd067dc1674d`.
`isRaetoProfile(profileId)` compares IDs case-insensitively.
`RAETO_PAYOUT_REGISTRY_ADDRESS` identifies the controller-managed payout registry.
`RAETO_QUOTE_ASSETS` is the frozen checksummed `[WETH, USDG]` tuple:
`0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`,
`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`.

`RAETO_SHARE_BPS_OPTIONS` is readonly `[500, 1000, 2500, 5000, 7500]`.
`RaetoLaunchConfigV1 = { shareBps: number }`, `validateRaetoLaunchConfig`,
`encodeRaetoLaunchTail` and `decodeRaetoLaunchTail` enforce exactly that menu and
exactly `abi.encode(uint16 shareBps)` (one 32-byte word). Noncanonical uint16
padding, extra/missing bytes, zero and non-menu shares throw
`INVALID_RAETO_CONFIG`. V6 `raetoLaunchConfig` is mutually exclusive with all
other tails; Raeto requires QuoteOnly, zero LP/developer fees and allowed quotes.
`validateRaetoLaunchPlan(plan)` checks **every** market and throws
`INVALID_RAETO_PLAN`, including for wrong profiles/adapters, schemas or quotes.
It adds no UFG token/reward/proxy restrictions.

`raetoFeeCollectorV1Abi` is generated from verified standard-output and includes
`shareBps()`, `owed(address)`, `launchToken()`, `quoteAsset()`,
`setShareBps(uint16)`, `claimRaeto(address)` and the exact three Raeto events.
See [fee ownership and collection semantics](launch-lifecycle.md#configure-raeto).

`test/fixtures/raeto-registry-readback.json` preserves admission bytes/receipts,
runtime hashes, factory metadata, verified ABI provenance and real factory
`eth_call` share-menu results at **101,180,179**
(`0xe778e5d89ca2cab5843eedeb8c27b10f5463313d4b95b8971986ac72e297933c`).
The deployed source commit is `a39c958` (go-live record `02e5cf3`), **not** the
later local `80ea8c8` share-range change. The generator proves hook creation bytes
equal the SDK's existing fixed and zero-royalty dynamic bytecode.

```sh
# Offline, deterministic regeneration from saved evidence (Node 24+):
node --experimental-transform-types scripts/generate-raeto-presets.mjs
# Explicit read-only refresh, checking the preserved go-live records:
node --experimental-transform-types scripts/generate-raeto-presets.mjs \
  --readback /path/to/black-market
pnpm build
node --test test/integration/raeto.live.test.mjs
```

## Choose a fee tier

One million pips is 100%; 10,000 pips is 1%. Basis points use a 10,000 denominator.
Canonical Abyss supports these `ABYSS_FEE_TIERS`:

| Fee pips | Trading fee | Tick spacing |
| --- | --- | --- |
| 100 | 0.01% | 1 |
| 500 | 0.05% | 10 |
| 3000 | 0.30% | 60 |
| 10000 | 1% | 200 |
| 20000 | 2% | 400 |
| 50000 | 5% | 1000 |
| 100000 | 10% | 2000 |
| 150000 | 15% | 3000 |

V4 spacing is constrained by the selected profile, not this Abyss table. LP fee,
hook fee, protocol share, executor bounty, author royalty, and owner/reward/burn
splits are separate values. The example's 3000/60 is not the venue's sole fee tier.

## Account for Nitro compute and poster gas

On chain4663, `ROBINHOOD_NATIVE_TRANSACTION_GAS_LIMIT` and the deployment preset's
`nativeTransactionGasLimit` specify32M **total** gas for begin, prepare, activate,
atomic and cancel. This includes poster gas. Guard-only maximum-gas getters are
not read. Pinned ArbSys version selects capacity coverage/native capability, not
a gas size. Other chains retain their resolved generic transaction ceiling.

`transactionGasCeiling`, when set, is a caller complete-envelope restriction.
Below the native ceiling it refuses; it never shrinks a launch step. Approvals
omit gas/fees and leave preparation to the wallet. One `ArbGasInfo.getPricesInWei`
leg in the initial aggregate supplies L1 per-byte and L2 prices, with no per-tx
NodeInterface oracle. See [capacity and poster evidence](lifecycle-gas-profiles.md).

`computeLifecycleLaunchGasBounds({ plan, predictedToken, ufg? })` returns conservative
atomic/activation compute upper bounds, excluding poster, or undefined for unknown
coverage. These select modes, not gas limits. Atomic is a preference that may select
staged; persist returned `planned.mode`. A large upper bound is uncertain, not
proof of overflow. Unknown activation gets full-sequence execution before begin.
Conversion-carrying commands/consuming activation always retain exact execution.

Only an immediate launch command receives a final gas/price/estimate/admission.
Suffix execution metrics stay provisional; build-next constructs only the canonical
next command at the same native ceiling with fresh fees and required admission.
There are no sizing passes or funds-only retries. Balance must cover value plus
the entire ceiling fee even when actual execution uses less gas. Incomplete proof
cannot authorize begin; explicit aggregate policies still refuse excessive work.

On Nitro, `estimate.posterGas` / `posterFee` are buffered allocations **inside**
`gasLimit`; `dataFeeIncludedInGas` is true, `dataFee` is zero, and `totalFee` equals
`gasLimit × gasPrice`. Do not add poster fees a second time. Custom `estimateDataFee`
is rejected on Nitro; generic EVM clients can use it for an external fee.
`feeConfidence` distinguishes actual execution evidence from the conditional
`native-ceiling-and-data` budget. Fresh gas price is max(pinned price, twice base fee).
Held Nitro price must meet max(ArbGasInfo L2 price, header base fee), without an
automatic bump. Reviewed gas differing from the ceiling is stale and refuses.

Capacity-only profiles account for route, position and HMM forwarding overhead.
Staged packing retains conservative per-market grouping, but never changes the
gas assigned to a launch transaction or splits its final activation.

## Cache static reads and inspect timing

| `LifecycleRpcClient` option | Behavior |
| --- | --- |
| `supportsReadBatching: true` | Opt into at most eight concurrent SDK reads per invocation; set only when your transport batches concurrent requests. |
| `sessionCache: createLifecycleSessionCache()` | Caller-owned reuse of SDK-selected static reads at one pin; successful deployment/backend observations also survive across blocks. Without it, those observations belong to the supplied client object. |
| `onDiagnostic(event)` | Local opt-in stage/RPC timing listener; no automatic console output or telemetry. |

Call `sessionCache.invalidate()` after confirmed transactions to discard pinned
static values. Deployment/backend facts are retained for the session owner and
keyed by chain/account where applicable. Chain identity is cached by bound client
object; create a new client on a chain change rather than mutating/reusing it.
`sessionCache.block` is readonly `{ number, hash }` or undefined.
Planning pins retain the actual RPC L2 block number and header hash. EVM
`BLOCKNUMBER`/`BLOCKHASH`, including Multicall3's metadata getters, expose L1 values
on Nitro and are not L2 pin sources.
Balances, allowances, current progress, receipts, policy callbacks and required
execution proof stay fresh. Planning/build-next do not read account queue nonces;
the wallet assigns them and retains the observed submitted nonce for recovery.
Session caching does not extend admission.

One RPC L2 header supplies number, hash, timestamp, gas limit and base fee.
The initial Multicall3 call uses that explicit L2 block and includes native balance,
funding/progress, Nitro getters and `getPricesInWei`. Independent getters are aggregated with no
minimum-count threshold. Multicall3 runtime code is attested once per session.
The 4663 preset enables `launchLensAbi.snapshot` without caller configuration:
one call replaces dependent token/hook/market/funding reads inside that aggregate.
Its `launchLensCodeHash` pins the reviewed deployed runtime as frozen release
metadata, like `tokenFactoryCodeHash`, without another guard-only RPC.
The deployed preset `hookSaltMiner` replaces local mining during combined
preparation; every returned winner is verified locally.
Lens failures surface directly; planning does not retry through legacy reads.

Diagnostic events carry `stage`, `phase`, optional `durationMs`, `queueMs`,
`requestId`, allowlisted RPC `method`, and cache `hits` / `misses` / `reuses`.
Queue time is separate from request time; request IDs are local sequences.
Events omit URLs, addresses, parameters/results, signatures, calldata, and raw errors.
Listener failures cannot change planning behavior. Inspect normal admission fields
for success; a completed timing stage alone does not prove execution.

## Stable author APIs and V3 fees

`developerBeneficiary` / envelope `beneficiary` is stable `authorId`.
Registry `authorPayout(authorId)` controls the live payout/controller; zero is unknown.
Registry admin or current payout/controller can update a known payout. Every helper
authenticates membership via registry core → core fee factory → factory `isHub`.

| Helper | Inputs beyond `{ client, registry, authorId }` |
| --- | --- |
| `readLifecycleAuthor` | None; returns core/factory, payout, hub count, pinned context. |
| `readAuthorHubs` | Optional bigint `offset`, `limit` (default 0/100; limit 1–100). |
| `readDeveloperFees` | `hub`, optional `assets`; reports supported/claimable/reserved and frozen source terms. |
| `buildSetAuthorPayoutTransaction` | `payout`, `account`, bigint `chainId`; requires controller/admin. |
| `buildClaimDeveloperFeesTransaction` | `hub`, `asset`, `account`, bigint `chainId`; payout fixed by registry. |
| `buildClaimDeveloperFeesPageTransaction` | Bigint `offset`, `limit` (1–10), optional `assets`, `account`, bigint `chainId`. |
| `decodeDeveloperClaimReceipt` | `{ receipt, transaction }`, using the exact returned claim transaction context. |

Unsigned claim builders return chain/from/to/data/value; the application owns gas,
signing, submission, and receipts. Explicit page assets are sorted unique nonzero
addresses, at most eight; empty selects each hub's actual assets.
Decode each row: **0 paid, 1 zero, 2 unsupported, 3 failed**. Cursor completion is
separate from payment success. Retry failed rows with enough gas; a successful
outer receipt can contain failures. A direct claim lacking its payment event is
`unobserved`, not a reported zero payment.

Use `lifecycleFeeHubAbi` for `claimAndSplit()`, which takes **no arguments**. Harvest deducts executor
bounty, splits owner/rewards/burn with dust allocation, then reserves developer
fees from attributable owner fees. Frozen terms and policy survive fee-owner changes;
old credits stay with the credited owner. `claimOwnerFees(asset, recipient)` withdraws
owner credits without harvesting. `claimDeveloperFees(authorId, asset)` resolves live
payout and has no recipient parameter. Owners can set executor bounty up to 1,000 bps.
Dividend tokens also permit a separate owner-set dividend bounty up to 1,000 bps;
self-claims receive full gross. Staking claims have no dividend payout bounty.

## HMM fields and migration

`HmmLaunchConfig` contains `strategyShareBps` (0–10,000) and the strategy tuple.
`encodeHmmLaunchTail` / `decodeHmmLaunchTail` use **16 static words / 512 bytes**.
`validateHmmLaunchConfig` checks these 15 fields in wire order:

| Field | Unit / bound |
| --- | --- |
| `bidWidth`, `askWidth` | Tick spacings; positive int24 |
| `gap` | Tick spacings; nonnegative int24 |
| `staleAfterSeconds` | Positive uint32 seconds |
| `staleDisplacement` | Tick spacings; positive int24 |
| `minQuoteDeploy` | Raw quote uint256, including zero |
| `minQuoteHarvest` | Positive raw quote uint256 |
| `minTokenHarvest` | Positive raw token uint256, covered by both token caps |
| `resalePremiumBps` | 0–5,000 bps |
| `maxAsks` | 1–8 |
| `maxAskTokenExposure` | Raw token amount, covers asks and harvest; at most uint128 max |
| `maxAcquiredInventory` | Raw token amount, covers harvest; at most uint128 max |
| `premiumDecaySeconds` | Uint32 seconds; zero disables decay |
| `maxBidQuote` | Positive raw quote bid principal, at most uint128 max |
| `referenceDeviation` | Tick spacings; nonnegative int24 |

`defaultHmmLaunchConfig` requires `tokenBudget`, `quoteAsset`, `maxBidQuote`, and
`referenceDeviation`. Defaults: share 50%, widths 5/5, gap 1, stale 86,400 seconds /
5 spacings, resale premium 500 bps, four asks, decay off. Token harvest/exposure/
inventory defaults are budget/100,000, budget/10, and budget. WETH deploy/harvest
thresholds are 0.0005/0.005 WETH; six-decimal USDG uses 1/10 USDG. Other quotes
require explicit raw `minQuoteDeploy` / `minQuoteHarvest`; decimals must match.

**HMM V1 → V2:** rebuild unstarted plans with current profile IDs/graphs, explicit
`maxBidQuote` / `referenceDeviation`, and a newly encoded 512-byte tail; re-mine and
re-prove. Old 448-byte tails and removed V1 hook enum members have no aliases.
Submitted V1 plans and active V1 markets keep their original contracts: use matching
legacy tooling, not mutated V2 plans. The SDK does not upgrade existing markets.

## Run owned-fixture and API checks

From the checkout root, `pnpm test` runs offline tests and `pnpm examples` performs
read-only deployed discovery. The following checks require separate infrastructure;
run write-capable checks only with explicit permission on disposable services.

### Auto-compounding read-only checks

After `pnpm build`, compare both profiles and fee modes with the live collector
factory's metadata/decoder and the reference Python encoder (no signing or sends):

```sh
BLACK_MARKET_REFERENCE_ROOT=/path/to/black-market \
  node --test test/integration/auto-compound.live.test.mjs
```

The reference checkout must contain `scripts/auto_compound_config.py` and its
Python dependencies. Regenerate the frozen deployment modules offline with:

```sh
node --experimental-transform-types scripts/generate-auto-compound-presets.mjs
# Explicitly refresh readback from a new pinned L2 header plus preserved admission evidence:
node --experimental-transform-types scripts/generate-auto-compound-presets.mjs \
  --readback /path/to/black-market
```

### UFG owned-fork check

Run Anvil and the test in separate terminals; stop Anvil afterward:

```sh
anvil --fork-url https://rpc.mainnet.chain.robinhood.com/ \
  --chain-id 4663 --port 8561 --gas-limit 100000000 --silent
pnpm build
UFG_FORK_RPC_URL=http://127.0.0.1:8561 node test/integration/ufg-launch.fork.mjs
```

This executes atomic/staged UFG contracts on the owned fork and restores snapshots.
It does not certify native Nitro metering. It needs no production key.

### Owned lifecycle fixture

Provide Solidity-exported `manifest.json` and `sdk-plans.json` for an owned graph.
The manifest must set `fixtureOnly: true` and mark its `executionLimits` with the
`controlled-local-measurement` scope required by the [fixture runner](../examples/launch-lifecycle-smoke.ts).
These filenames are command inputs, not files shipped by the SDK.

```sh
LAUNCH_LIFECYCLE_RPC_URL=http://127.0.0.1:18555 \
LAUNCH_LIFECYCLE_FORK_RPC_URL=http://127.0.0.1:18556 \
LAUNCH_LIFECYCLE_ALLOW_LOCAL_EXECUTION=1 \
node examples/launch-lifecycle-smoke.ts manifest.json sdk-plans.json
```

The source and fork endpoints must be distinct owned loopback RPCs. For the chain
boundary test, also set `LAUNCH_LIFECYCLE_MANIFEST` and `LAUNCH_LIFECYCLE_FIXTURES`
to those input paths and run `node --test test/lifecycle-chain.test.mjs` with the
same environment. Do not pass a mainnet deployment manifest as a writable fixture.

### HTTP API integration

Provide an abyss-api instance with PostgreSQL session migrations applied, upload-session
routes, the selected chain enabled, and the current launch verifying contract configured.
The attribution domain is `Abyss Launch Attribution`, version `1`; signed deadlines
must be future timestamps at most 15 minutes away. The service's launch-factory
configuration must point to the selected orchestrator.

```sh
LAUNCH_API_TEST_URL=http://127.0.0.1:18763 pnpm test:api
# Writes metadata sessions on an owned disposable loopback service:
LAUNCH_API_TEST_URL=http://127.0.0.1:18763 \
LAUNCH_API_TEST_PRIVATE_KEY="$DISPOSABLE_TEST_PRIVATE_KEY" pnpm test:api:write
```

`LAUNCH_API_TEST_CHAIN_ID` defaults to 4663; `LAUNCH_API_TEST_ORCHESTRATOR` defaults
to `getAddresses(4663).launchOrchestrator`. The write suite needs an explicitly
supplied disposable key, not a funded production key. These tests do not create a
token or prove image/publication/indexing; the operator owns database cleanup.
