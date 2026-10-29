# Lifecycle gas, capacity, execution evidence and RPC budgets

Version **0.16.0**, model **`robinhood-4663-capacity-v4`**, separates the native transaction ceiling, conservative capacity bounds, exact opening-curve quotes and actual transaction receipts. A ready assessment is not execution proof.

## One native ceiling, not component-sized gas

Every launch command (begin, prepare, activate, atomic and cancel) uses the chain's native total transaction ceiling. On Robinhood4663 this is `ROBINHOOD_NATIVE_TRANSACTION_GAS_LIMIT = 32_000_000n`, also exposed as `getKnownLifecycleDeployment({ chainId, orchestrator }).nativeTransactionGasLimit`. The32M includes poster gas. Other chains retain their resolved generic ceiling.

Unused gas is refunded. The payer must still reserve `value + gasLimit * gasPrice` upfront. The SDK never shrinks the ceiling to accommodate a tight balance, adds poster gas to32M, or retries with a smaller envelope. Approvals/reset approvals are not launch steps: their returned `gas`, `gasPrice` and estimates are omitted for wallet preparation.

A reviewed launch gas differing from the ceiling is stale and refuses with `STALE_REVIEWED_GAS`; re-review rather than silently rewriting it. A caller complete-envelope cap below the ceiling refuses too. `fixedFinalEnvelope`, `LifecycleFinalEnvelope`, stored compute-sizing hints and unvalidated gas-sizing retries are removed.

## Capacity selects the mode, not the gas limit

`computeLifecycleLaunchGasBounds({ plan, predictedToken, ufg?, headroomBps? })` returns conservative `atomicComputeGasUpperBound` and `activationComputeGasUpperBound`, excluding poster gas, or undefined for unknown coverage. The v4 model covers Raeto fixed/dynamic and current auto-compounding static/dynamic in addition to the existing Abyss, V4, HMM and UFG templates. It accounts for token/reward creation, actual UFG proxy/treasury route, measured market/position work, ordered buys, NFT minting and HMM forwarding overhead. UFG route overhead is independent of market profile names.

An atomic request is a preference. Multiple markets or conversion funding always select staged; one non-conversion market can remain atomic only when its conservative bound plus poster allocation fits. Explicit staged remains staged. Review and persist returned `planned.mode`, not the requested mode. No positions, markets or buys are dropped, and the gas envelope is never resized.

Preparation greedily packs contiguous markets using measured per-template/per-position costs, full calldata processing and padding. Activation cannot split. An activation bound plus poster allocation above 32M refuses before begin with `ACTIVATION_GAS_LIMIT`; an unknown profile refuses with `UNKNOWN_GAS_PROFILE`. A conservative refusal is not proof the actual transaction would overflow, but there is no simulation or execution fallback.

## What planning does, and does not prove

Planning and build-next read one pinned input/progress snapshot, compute exact local opening-buy outputs, check deterministic capacity and check affordability. They **never execute launch calldata**, including for conversion funding. The real router enforces its committed conversion floor/deadline when the user submits the transaction.

| Command | Planning/build-next behavior |
| --- | --- |
| Approval/reset | Discover allowance; wallet owns gas preparation. |
| Begin | Check inputs, complete activation capacity and full-ceiling affordability. |
| Prepare markets/hooks | Pack deterministic contiguous batches and check their budgets. |
| Activate and opening buys | Check unsplittable activation capacity and exact local ordered-buy floors. |
| Atomic launch | Require one non-conversion market with known capacity headroom. |
| Cancel | Build from canonical progress; no new profile capacity requirement. |

Check `planned.assessment.ready`, `code`, `reason`, optional `capacityConstraint`,
`assessment.estimate` and `assessment.gasProfile`. The gas profile contains
`version`, capacity `bounds` and exact local `initialBuys`, never invented
`gasUsed`. Launch commands use the native ceiling; approvals omit gas/fees.
Only actual included receipts and canonical Active/public-market state establish
execution. The owned fork harness below exercises the real contracts separately;
it is never selected as a planning backend.

## Retained empirical evidence

`robinhood-4663-capacity-v4` extends the retained release-template budgets with [Raeto and auto-compounding measurements](#raeto-and-auto-compounding-v4-evidence). These are empirical capacity bounds, not gas-limit sizing, a promise about arbitrary upgrades/future ArbOS rules, or native execution proof. Currency admission is separate: only Raeto imposes its deployed WETH/USDG quote allowlist.

Research retained176 lifecycle receipts, including75 successful current-template atomic/activation observations with opening buys. Isolated forks extend depth, buys and combinations; failed CREATE2 cases were not counted as successful coverage. One Abyss and one fixed-V4 historical native/fork calibration matched compute exactly (19,272,603 and18,130,251 gas), while minimum successful envelopes were higher (20,527,230 and19,356,279). These two calibrations do not establish general Anvil/Nitro equivalence. Compute and poster components remain separate. Profiles are empirical capacity bounds, never transaction gas sizing or proof about arbitrary upgrades/future ArbOS rules.

## Raeto and auto-compounding v4 evidence

`test/integration/template-gas.fork.mjs` owns an explicitly supplied loopback
Anvil on **8571** and accepts only its unlocked default development account.
It never loads a key or sends to mainnet. Each case snapshots/reverts the fork
and executes real SDK-produced calldata against the admitted deployment graph.
The matrix retains full portable plans and receipts' transaction hashes,
block numbers, `gasUsed`, characterization envelopes, calldata sizes,
Anvil minimum-gas estimates and separate 32M `eth_call` fit results in
`test/fixtures/template-gas-matrix.json`. Separate read-only SDK planning/build-next
assessments, referencing those retained real executions without replaying them,
are in `test/fixtures/template-gas-smoke.json`.
The creator/token identity may repeat across **isolated, reverted** cases, and
identical CREATE2 preimages reuse the SDK's deterministic mined salt. This avoids
unnecessary new empty-slot archive queries without retaining any launch state
between experiments. Complete plans identify the exact identity used in every
observation. The harness verifies the source pin and Anvil version and always
skips any scenario already recorded. The final missing-case selection covers
boundary depths/buys/market counts rather than repeating a redundant Cartesian
interior. Earlier valid observations remain in the evidence unchanged.

The source block/hash and Anvil version are recorded per run. Public RPC pruning,
rate limits and archive backend failures are not execution failures; the final
missing cases use a configured Alchemy archive. Its credential-bearing URL is
never logged or committed; evidence identifies the provider only as `alchemy`.
The synthetic economics ($5,000 FDV, WETH $3,000 / USDG $1) are explicit test
fixtures, not a live pricing recommendation.
Single-position recipes and adjacent 8-position distributions use SDK helpers;
an explicit adjacent 32-band fixture reaches the templates' structural maximum
without changing the public distribution catalogue's 2–16-position API.
Two-market cases divide at most 32 **total** positions between WETH and USDG.
Raeto cannot have a third V4 market because those are its only allowed quotes.

Anvil does not implement ArbOS precompiles. The harness reads
`ArbGasInfo.getPricesInWei` from the real native chain through the configured
archive at the fork's source pin. For read-only LaunchLens planning snapshots,
an `eth_call`-only ArbSys override maps `arbBlockNumber()` / `arbBlockHash(uint256)`
to Anvil's actual `NUMBER` / `BLOCKHASH` environment; it does not invent balances,
progress, addresses or protocol results. No deployed launch code/storage is
overridden and no measured launch is replayed by that smoke. All launch execution
uses the ordinary fork contracts.
USDG fixture funding is an ordinary deployed-token transfer from the fork's
real PoolManager balance, using fork-only impersonation; protocol code/storage
is not replaced. Characterization uses 100M gas to measure without assuming fit,
and separately calls the exact launch at 32M. The read-only profiled smoke checks
the SDK's actual 32M next-command envelope without re-executing a retained case.
**Anvil compute and successful local 32M calls are not native ArbOS/poster proof.**

The committed run contains **84 real launches / 186 successful launch
transactions** at Robinhood block **101,180,179**
(`0xe778e5d89ca2cab5843eedeb8c27b10f5463313d4b95b8971986ac72e297933c`):
59 retained observations plus 25 approved missing boundary cases. No retained
case was replayed. Depths are 1/8/32 total positions, one/two markets and
0/1/4 ordered buys, with both Raeto quotes and both auto-compound fee modes.

Observed peak EVM `gasUsed`, in millions (preparation columns distinguish batch size):

| Template | Cases | Atomic max | Prepare 1 market max | Prepare 2 markets max | Activation max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Raeto fixed | 42 | 41.664 | 11.222 | 17.831 | 22.228 |
| Raeto dynamic | 22 | 41.694 | 11.186 | 17.804 | 22.332 |
| Auto-compound static | 10 | 41.285 | 10.694 | 16.874 | 22.403 |
| Auto-compound dynamic | 10 | 41.369 | 10.753 | 16.992 | 22.445 |

The 32-position atomic extremes exceed 32M and select staged; their
activations fit. All measured one/eight-position atomic cases fit, including
several buys. `test/template-gas.test.mjs` requires every transaction's observed
gas **and** Anvil forwarding estimate to fit its model bound, at least 5%
observed-gas margin, and a bound below 32M whenever the observation fit that
ceiling. Begin uses the native 32M budget rather than a fabricated estimate.

V4 template coefficients below are compute basis, before at least **25%**
padding (or larger requested headroom), calldata processing and applicable
token/reward/NFT/fee-asset work. Existing offerings' coefficients are unchanged.

| Component | Raeto fixed/dynamic | Auto-compound static/dynamic |
| --- | --- | --- |
| One-market atomic base | 18,000,000 | 18,000,000 |
| Atomic extra position | 600,000 | 600,000 |
| Activation call base | 1,500,000 | 1,500,000 |
| Activation per market | 500,000 | 750,000 |
| Activation per position | 500,000 | 500,000 |
| Preparation per market | 9,300,000 | 8,900,000 |
| Preparation extra position | 70,000 | 70,000 |
| Each opening buy | 500,000 + 25,000 × that market's positions | Same |

The per-buy position term matters: at 32 positions the measured marginal
exceeds 1M gas per buy, so inheriting the ordinary flat 0.5M would understate
larger buy sequences. Full calldata contributes 24 gas/byte and fee assets
100,000 each before padding. `computeLifecycleLaunchGasBounds` remains the
consumer API; coefficients are not transaction gas limits.

Auto-compounding's `_attemptCompound` exits for `Opening` before its 80k
low-gas guard whenever `_openingCompletedAt == 0`. The orchestrator executes all
ordered `_buy` calls before `_openMarkets`; opening completion is the terminal
market boundary. The harness checks exact quote spend/token outputs against
`InitialBuyExecuted`, every opening deferral, no `CompoundExecuted`, and
opening-completed event ordering. Therefore launch activation needs no
post-opening compounding forwarding reserve; HMM's separate reserve stays intact.
These launch constants are **not** gas limits for post-opening swaps.

```sh
# In each terminal, source the existing credential environment without printing it:
source ~/.config/robinhood-archive-rpc.env
export ROBINHOOD_ARCHIVE_RPC_URL
# Terminal 1; stop Anvil when finished:
anvil --fork-url "$ROBINHOOD_ARCHIVE_RPC_URL" \
  --fork-block-number 101180179 --chain-id 4663 --port 8571 --host 127.0.0.1 \
  --hardfork cancun --gas-limit 120000000 --quiet
# Terminal 2, in the worktree (source/export the environment here too):
pnpm build
TEMPLATE_FORK_RPC_URL=http://127.0.0.1:8571 \
  node test/integration/template-gas.fork.mjs
# Read-only assessment of retained executed plans; no launch replay:
TEMPLATE_FORK_RPC_URL=http://127.0.0.1:8571 \
  node test/integration/template-gas.fork.mjs --smoke
```

## Exact ordered opening-buy math

`computeLifecycleOpeningBuys({ plan, predictedToken })` follows all liquidity bands, prior buys, initialized zero-net ticks, bitmap boundaries, both currency directions, LP/opening-hook fees, partial fills and integer output floors. HMM opening work occurs after initial buys. Auto-compounding defers until opening completes, after all initial buys; Raeto reuses the ordinary fixed/dynamic fee curve. V4's zero price-limit sentinel resolves locally to the contract-defined directional limit without changing calldata; Abyss still rejects zero.

Covered `buySlippageBps` protection uses `floor(tokenOut * (10000 - bps) / 10000)`. A zero floor rejects, never becomes1. Independent parity matched token output, quote spent and final square-root price across97 native/fork cases, including both directions, overlapping bands and gaps. Portable historical vectors and focused rounding/sentinel cases live under `test/fixtures/lifecycle-opening-buys.json` and `test/lifecycle-opening-buys.test.mjs`. These conditional curve quotes do not prove conversion, funding or wallet submission.

## One same-review Nitro price observation

The initial L2-pinned aggregate includes `ArbGasInfo.getPricesInWei`. There are no per-transaction `NodeInterface.gasEstimateL1Component` calls or separate4663 `eth_gasPrice` calls. Tuple element1 supplies L1 per-byte price; element5 supplies L2 price. Fresh gas price is max(L2 price, twice header base fee). A held price must meet max(L2 price, header base fee), but is not bumped to the fresh recommendation.

For empty-access-list EOA legacy calldata of `D` bytes:

```text
N = D + 384
B = N + 8 * floor(N / 1024) + 64
posterFeeBound = B * l1PricePerByte
posterGas = 2 * ceil(posterFeeBound / l2GasPrice)
```

The local serialization/Brotli bound and2x allocation are conservative, not an observation of the eventual compressed signature or a promise about future L1 prices. Poster stays inside32M. `dataFeeIncludedInGas` is true, `dataFee` is zero and `totalFee = gasLimit * gasPrice`; never add poster fee again.

## 0.15.0 caller migration

- Wallet nonce is absent from unsigned `LifecycleTransaction`; `LaunchPlanV1.nonce` remains its domain identity. Let the wallet assign send nonce. Learn actual nonce from wallet/transaction, retain optional exact `LifecycleReceiptReference.nonce`, and advance the wallet-owned queue locally. A supplied nonce mismatch refuses receipt attribution. Portable journals use decimal strings, not JSON numbers.
- Progress has no confirmed/head/pending account nonce gates. Unrelated pending transactions are queued by the wallet, not an SDK confirmation-safety refusal. Planning/build-next make no `eth_getTransactionCount`; unknown reload recovery may need one host-owned read.
- `BuildNextTransactionOptions.submissionClient` and proof `transportPreflight` are removed. Keep wallet account/provider-chain checks and never automatically replay an ambiguous write.
- Retain each bound client; chain identity is read at most once per client object. Recreate the client after wallet/chain changes. Cache invalidation does not repoint an existing client to another chain.
- Persist selected `planned.mode`. Handle approval envelopes without gas/fees, `STALE_REVIEWED_GAS`, actionable activation capacity refusal, optional `simulation.estimate` and capacity-only `gasProfile.bounds`. Remove `gasProfile.estimates` and `computeGasRequired` usage.
- Economic review schema v2 separates `local-exact-curve` from `simulated-execution`; consume `initialBuy.reviewedBuys`, not assumed receipt fields. `transactionGasEstimate` is removed; unsigned compilation and preparation packing remain available.

## Observed recording-transport budgets

The same historical, already-protected plans and explicit 200M aggregate policy use deterministic recording-transport block/state/execution responses, without requesting buy recalibration. This is RPC counting, not live admission. Both commitments remain unchanged. Counts exclude wallet preparation/send, polling and supplied receipt/transaction/canonicality reads, which vary with confirmation policy.

| Case | Version | Prepare/review | Each build-next | Prepare + first build | Prepare + all builds |
| --- | --- | ---: | ---: | ---: | ---: |
| Conversion historical plan (`0xf05…fe98fe98`, four builds) | 0.14.1 | 12 | 8 | 20 | 44 |
| Same conversion plan | 0.15.0 | 7 | 3 | 10 | 19 |
| Direct NativeWrap historical plan (`0x4cbc…85231`, three builds) | 0.14.1 | 12 | 8 | 20 | 36 |
| Same direct plan | 0.15.0 | 5 | 2 | 7 | 11 |

The conversion case retains six native simulation RPCs across review/builds because its historical currencies are outside capacity coverage: one session capability, one full review and four next-step proofs. The covered direct case drops six simulation RPCs to zero. Both cases have one total chain read and zero account-nonce, separate gas-price or per-transaction poster-oracle reads. Cold costs include session attestations/capability; warm counts are not cold totals. These are SDK-only figures, not whole-application telemetry.
