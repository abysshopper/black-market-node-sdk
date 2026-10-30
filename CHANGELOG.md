# Changelog

## 0.16.1

- Allow atomic conversion funding for one known-profile market when its conservative capacity budget plus Nitro poster allocation fits the unchanged 32M native total gas envelope. Planning and fresh build-next use the same rule; explicit staged and multi-market launches remain staged.
- Bump the model to `robinhood-4663-capacity-v5`. Add an empirical 2,000,000 compute reserve for each `Swap` funding entry in atomic launches, before the existing at-least-25% padding and HMM forwarding-reserve comparison. Preserve full encoded-calldata costs; staged activation does not pay the conversion reserve because funding executes during begin. This is not a universal bound on arbitrary router code or execution proof.
- Retain unknown-profile refusal, activation/preparation limits, wallet-owned approvals/nonces, native funding value, ordered-buy slippage, full-ceiling affordability and fresh recovery checks. No runtime launch simulation, nonce read, target/token special case or fallback is introduced.

## 0.16.0

- Add supported Robinhood Raeto fixed/dynamic pool-bound templates, generated from preserved go-live records and pinned registry readback. Reuse the byte-identical ordinary fixed and zero-royalty dynamic hook creation code, with the distinct Raeto adapter/collector/locker graph.
- Export Raeto profile/adapter/payout identities, frozen WETH/USDG quote and 500/1000/2500/5000/7500-bps share menus, config validators/codecs, an exclusive all-markets plan validator and the verified collector read/write/event ABI from `@black-market/sdk/lifecycle`. Preserve the deployed five-share menu, not the wider range in later undeployed contract source.
- Add typed config6 `raetoLaunchConfig` tails (one canonical uint16 word). Reject mixed tails, wrong profiles/quotes, non-QuoteOnly mode and nonzero LP/developer fees. Bind the full tail in the plan hash while preserving the deployed prefix-only hook-constructor commitment. Raeto uses normal lifecycle funding, not the UFG proxy.
- Extend measured launch capacity and deterministic preparation costs to Raeto fixed/dynamic and the current re-admitted auto-compounding static/dynamic profiles. Bump the model to `robinhood-4663-capacity-v4`; these templates no longer refuse with `UNKNOWN_GAS_PROFILE`. Keep the 32M native total ceiling, poster allowance and all other templates' economics unchanged.
- Retain an owned pinned-fork matrix of 84 real launches / 186 successful launch transactions, full plans and 32M call-fit results at block 101,180,179. Profiled SDK planning/build-next smokes reuse executed plans read-only, without replaying any recorded launch. Deterministic tests require every observation to fit its capacity/preparation bound with margin. Anvil compute is empirical evidence, not native ArbOS execution/poster-gas proof; the read-only Lens smoke bridges missing native number/hash views to real local block metadata.
- Verify exact local opening-buy outputs against real fork receipts. Auto-compounding defers through all opening buys until opening completion, so its post-opening `CompoundOutOfGas` guard requires no launch-compounding forwarding reserve. Postlaunch swap gas is not a launch-capacity estimate.

## 0.15.1

- Remove every launch planning/build-next simulation, including aggregator-funded launches, exact proofs, buy-output diagnostics and controlled-fork execution. No `eth_simulateV1` or launch-calldata execution occurs before or between wallet transactions. Routers enforce their committed conversion output floors/deadlines on-chain.
- Stage multi-market launches conservatively, fixing the TAZE three-market/24-position holders-earn launch being incorrectly selected for one32M atomic transaction. Conversion funding mode selection is revised in0.16.1 to use a nonzero capacity reserve.
- Pack contiguous preparation batches deterministically from template/per-position costs plus headroom and poster allocation. Refuse an activation above its known budget with `ACTIVATION_GAS_LIMIT` and the actionable reduce-positions/pools reason before begin; unknown unbounded templates refuse `UNKNOWN_GAS_PROFILE`, never a simulation fallback. Exported capacity bounds remain available for builder UI limits.
- Preserve32M total native gas per launch command on4663, pinned fee floors, full-ceiling affordability, receipt/confirmation recovery and wallet-owned nonces. Approvals still leave gas to the wallet. Opening-buy protection uses only exact local ordered integer math and `buySlippageBps`.
- **Caller migration:** replace `planned.simulation` with `planned.assessment`, transaction `.admission` with `.assessment`, and `LifecyclePlanningError.simulation` with `.assessment`. Check `LifecyclePlanningAssessment.ready`; `code` and SDK-authored user-safe `reason` describe input/budget refusals, not execution proof. Consume optional `assessment.estimate` and `assessment.gasProfile.initialBuys`. `LifecycleLaunchGasBounds.atomicComputeGasUpperBound` is optional when atomic is ineligible.
- Remove `simulateLaunchPlan`, `createControlledLifecycleFork`, fork options, `maxSimulationGas`, simulation diagnostics, ArbOS/backend/account-code probes, `LifecycleSimulation`/step/proof/admission-only types and all execution evidence fields. `LifecycleTransactionEstimate` has no `gasUsed`; gas profiles contain budgets/local quotes only. Keep actual confirmed receipts distinct from a ready assessment.

## 0.15.0

- Remove wallet nonce reads from lifecycle planning/build-next and remove fixed nonces from unsigned `LifecycleTransaction` envelopes. The plan identity nonce is unchanged. Learn the submitted nonce from the wallet/transaction, retain optional exact `LifecycleReceiptReference.nonce`, and keep queue/reload recovery with the wallet. Progress no longer exposes confirmed/head/pending account nonce gates.
- Cache chain identity once per bound client object, including author paths. Recreate the client on a chain switch; planning never depends on fresh stage/final `eth_chainId`.
- Every launch command (begin, prepare, activate, atomic and cancel) uses the native total transaction ceiling: `ROBINHOOD_NATIVE_TRANSACTION_GAS_LIMIT = 32_000_000n` on4663, exposed as `getKnownLifecycleDeployment(...).nativeTransactionGasLimit`. Poster gas is included, never added. Other chains retain the resolved generic ceiling. Unused gas is refunded; admission still requires balance for value plus the full ceiling fee.
- Delete per-component transaction gas sizing, stored compute hints, unvalidated sizing and funds-only sizing retries. Approvals omit `gas`, `gasPrice` and estimates so the wallet prepares them. Remove `LifecycleFinalEnvelope`, `fixedFinalEnvelope`, `gasProfile.estimates`, `computeGasRequired` and guard-only Nitro maximum-gas getters.
- Gas profiles now provide capacity bounds only. Export `computeLifecycleLaunchGasBounds` with compute-only atomic/activation upper bounds. An atomic request is a preference and may select staged; explicit staged remains staged. Persist/review returned `planned.mode`, not the request. An oversized conservative upper bound is uncertainty, not proof of failure.
- Keep exact native execution for conversion-carrying begin/atomic and consuming activation/buys, plus full-sequence admission before begin when activation capacity is uncertain. Actual activation capacity refusal exposes `capacityConstraint: "activation"` and an actionable reduce-positions/pools reason. Never authorize begin from a successful prefix; caller aggregate policies remain enforced.
- Preserve exact integer ordered opening-buy math. Conditional `backend/confidence: "profiled"`, `executionProof: "not-run"` and `protocolFit: "profiled"` remain distinct from actual execution. `gasProfile` carries `bounds` and local `initialBuys`; the immediate fixed-ceiling budget is `simulation.estimate`, with `feeConfidence: "native-ceiling-and-data"` and no fabricated `gasUsed`.
- A reviewed launch gas differing from the resolved native ceiling refuses with `STALE_REVIEWED_GAS`; re-review rather than rewriting it. Held gas price below the pinned required floor refuses without bumping. On Nitro the floor is the greater of same-block `ArbGasInfo` L2 price and header base fee; twice base fee remains recommendation headroom, not a held-price floor.
- Read `ArbGasInfo.getPricesInWei` in the existing initial aggregate and bound EOA serialization/Brotli poster allocation locally. Remove per-transaction `gasEstimateL1Component` and separate4663 `eth_gasPrice`; `totalFee` already includes poster.
- Build only the canonical immediate command, preserving normal/UFG calldata and original/clipped preparation spans. Exact suffix proof metrics stay provisional, with no future executable estimates. Each next step refreshes its own price/admission at the native ceiling; there are no smaller-envelope affordability rescues.
- Remove `BuildNextTransactionOptions.submissionClient` and proof `transportPreflight`; the wallet owns sending-RPC preparation. Remove redundant started-stage UFG principal/config mapping guards while preserving committed config and actual begin receipt attribution.
- Retire `transactionGasEstimate`; preparation packing and unsigned command compilation remain available. Preserve launch economics, identity, deployed ABIs and calldata. See `docs/lifecycle-gas-profiles.md` for retained native/fork evidence, limits, RPC budgets and migration.

## 0.14.1

- Enable the deployed Robinhood 4663 LaunchLens through the SDK-owned `launchLens` preset. Callers configure no lens address.
- Pin `launchLensCodeHash` as frozen release metadata alongside the address, matching the existing factory/runtime identity convention without adding a guard-only RPC read.
- Preserve the original exact planning, salt verification, balances, progress and execution contracts while dependent snapshot reads and hook mining use the lens.

## 0.14.0

- Pin one RPC L2 header and batch same-block planning reads/native balances into one explicitly pinned chain4663 Multicall3 stage, even for fewer than three getters. Never derive L2 pins from EVM `BLOCKNUMBER`/`BLOCKHASH`, which expose L1 values on Nitro.
- Retain successful Multicall3 code attestation, Nitro backend capability and per-account code observations for the caller's session. Financial state, receipts, nonces and exact execution remain fresh.
- Keep one planning pin through hook mining and buy calibration. Remove final source-chain/canonical re-reads and the redundant exact-gas replay after final validated measurement.
- Estimate Nitro poster allocation only for the immediate final transaction, once. Build-next recompiles the next determined command from receipt/progress, original batch spans, allowance and nonce, then simulates only that command.
- Use the deployed HookSaltMiner `findMany` for pool-bound preparation and verify returned CREATE2 salts locally. Preserve the public local miner for deployments without a miner preset.
- Add optional `LifecycleDeploymentPreset.launchLens` and `launchLensAbi` integration for dependent reads and mining in the initial aggregate. The preset remains unset until deployment; setting its address enables the path.
- Preserve launch economics, deployed contract ABIs and committed transaction calldata.
- Diagnostic migration: remove `simulation.replay` and `simulation.envelope` from `LifecycleDiagnosticStage` listeners/exhaustive switches. Both stages are replaced by `simulation.measure`, which now includes the authoritative validated execution at the exact returned gas envelope. Buy calibration or an unvalidated sizing pass can also emit `simulation.measure`; neither is execution admission.
- Staged admission still checks the full simulated sequence for feasibility, using conservative suffix gas budgets bounded by the pinned balance. Only the immediate command receives a final exact gas/price estimate and admission. Later `simulation.steps` have `provisional: true` and no estimate; their transaction gas/price/estimate/admission stay unset until `buildNextTransaction` re-sizes and proves that command with a fresh poster quote. Never reuse a provisional `gasLimit` as a transaction estimate.
- Bound unvalidated sizing/calibration envelopes by pinned affordability too: Nitro still checks upfront funds with `validation: false`. Retain separable `LifecycleSimulationStep.computeGasRequired` so build-next combines compute with the fresh poster quote, not a previous complete observation containing an old poster charge.
- Size each discovery command against its per-transaction compute/complete ceiling and spendable balance, not an equal share of a sequence budget. Unused gas is refunded before the next call. An affordability-capped preparation failure cannot trigger an extra preparation transaction below the native ceiling.
- Only a genuine upfront-funds refusal may retry unvalidated sizing once with a shared sequence budget, before the sole exact validated pass. Contract reverts, HTTP failures, cancellations and final validation never retry; repeated funds refusals cannot select another backend.
- Sizing limitation (also present in 0.13.0): a payer may cover smaller exact staged envelopes but not the discovery ceiling margin. If the sole shared-budget retry exhausts its lower envelope, return `failureCategory: "affordability"` without claiming the transaction itself cannot execute. A top-level RPC refusal exposes no successful-prefix gas, so no prefix observations are synthesized and no extra metering calls are made.

## 0.13.0

- Finalize each lifecycle invocation with one fresh source-chain guard and one canonical check per used proof pin, including after optional submission estimation. Reuse the initial chain observation for nested hook metadata/discovery, one fee recommendation per operation, and known immutable factory predictions across construction/execution pins.
- Aggregate only caller-independent Nitro getters, known token prediction and known-core head progress on chain4663. Attest the pinned Multicall3 runtime before using it; poster quotes, funding, account state and execution simulations remain direct and pinned.
- Coalesce receipt observed/inclusion headers across references after all asynchronous receipt-identity reads. Preserve replacement attribution, confirmation depth and reorg refusal.
- Add `LifecycleFinalEnvelope` and `prepareAndPlanLifecycleLaunch({ fixedFinalEnvelope: { gas, gasPrice? } })` for one immediate atomic command without approvals. Freeze one operation fee if omitted and validate exact final protected calldata without gas rediscovery, fee increases or envelope rescue.
- Return explicit nonces with proved commands and bind supplied reviewed nonces during replay/submission estimation. Document `planned.transactions[0]` as the exact reviewed envelope, not reusable admission. Preserve fresh pending nonce/balance and final source-chain guards in the example signer even when a held nonce is supplied.
- Add per-entrypoint counting-transport budgets and exact-envelope/aggregation/canonical regressions. No signing, broadcast or publication behavior is added.
- Rewrite launch guidance around pricing, execution, publication, and recovery; split detailed SDK reference from the launch tutorial. Correct WETH wrapping, conversion deadlines, and runner resume instructions.

## 0.12.0

- Add opt-in UFG treasury launches through the pinned Robinhood proxy, including principal-namespaced nonces, exact proxy funding approvals, atomic/staged/cancel builders and proxy-aware planning, simulation and canonical recovery. Existing core launch paths and defaults are unchanged.
- Add frozen `V4UfgFixedPool` / `V4UfgDynamicPool` presets generated from registry readback at block 94,551,140. Verify and reuse the existing byte-identical fixed and zero-royalty dynamic hook creation code.
- Add `UfgLaunchConfig`, canonical dynamic-tuple codecs/hash, typed config6 `ufgLaunchConfig` tails, exact fee-asset policies and offline proxy-rule validation. Support native Abyss QUOTE/QUOTE_ORACLE and UFG quote-only V4 with zero LP fee.
- Export complete proxy, treasury-factory and upstream factory/treasury ABIs plus `readUfgTreasury`. Include independent Foundry ABI vectors, registry evidence, public-API fork integration and an unsigned configuration example.

## 0.11.0

- Size HMM V2 atomic/activation gas with one forwarding reserve (`4,250,000 + 500,000 × (HMM markets − 1)`) in addition to measured gross gas. Clamp reserve/headroom targets to legal compute and total-envelope caps instead of refusing optional padding; exact signed-envelope replay remains mandatory.
- Greedily pack staged preparations using 14.5M per HMM V2 market and 16M per other market. Split only a packed batch whose measurement fails after using at least 95% of its envelope, including CREATE-wrapped `DeploymentFailed`. Remove the misleading `PlannedLaunch.preparationBatchSize`; inspect exact transaction spans instead.
- Default Robinhood's aggregate simulation gas-used budget to 50M (`limits.maxSimulationGas`). Prove the longest estimated prefix and expose `simulation.deferredTransactionIds`; deferred commands have no gas, price, estimate or admission. Proved/admitted flags describe the prefix, not eventual activation. Build-next refreshes proof as canonical progress advances.
- Replay a reviewed immediate envelope directly at its held gas/price, without a new measurement, gas-price/poster recommendation or suffix replay. Preserve identity, deployment, nonce/receipt/confirmation, native Nitro, balance and canonical-state checks; allow at most one legal-envelope rescue for genuine OOG on newly sized envelopes.
- Refuse buy-slippage calibration when activation outputs lie beyond proof coverage; update lifecycle documentation, unsigned examples and focused offline regressions. No new signing or broadcast behavior.
- When no simulation prefix fits, report an immediate estimated per-transaction compute overflow before the RPC aggregate-budget diagnostic, with concise one-decimal-million gas estimates. Conservative estimates alone do not reject otherwise provable envelopes.

## 0.10.0

- **Breaking HMM-only cutover:** generic HMM types, helpers and profile keys now select the admitted HMM V2 release. Remove HMM V1 preset identities, creation metadata and versioned hook keys; use `KnownLifecycleHook.HmmFixedPoolV2` / `HmmDynamicPoolV2`. Non-HMM V1 APIs are unchanged.
- Encode/decode the exact 512-byte V2 launch tail. Require explicit `maxBidQuote` (positive, at most uint128 max) and `referenceDeviation` (nonnegative int24) in `defaultHmmLaunchConfig`; preserve all other existing calibration defaults. Old 448-byte HMM tails are rejected.
- Replace both HMM admission envelopes, adapters, full dependency graphs and creation code with preserved V2 evidence. Keep the 640-byte constructor and canonical zero-salt config6-prefix economics hash; the full plan hash binds the auxiliary tail.
- Export full `hmmLiquidityManagerV2Abi`, `hmmFeeCollectorV2Abi`, `hmmFeeCollectorFactoryV2Abi`, `hmmFixedHookV2Abi` and `hmmDynamicHookV2Abi`, including all strategy configuration, pause and fee-owner/share controls. V2 funds the strategy per swap in both currencies after treasury, without an HMM burn.
- Migrate documentation/examples and independent contract vectors; add old-tail/guard rejection, exact admission, two-chunk graph certification and constructor/mining coverage. SDK support removal does not deregister existing onchain HMM V1 markets.
- Keep the full offline example-test and CLI-child coverage runnable on Node 20/22/24 with a test-only loader backed by the existing TypeScript dev dependency; no production dependency or example-runtime change.

## 0.9.1

- Add the canonical Abyss 0.01% fee tier (`feePips: 100`, `tickSpacing: 1`) to recipes and lifecycle topology planning.
- Cover both token orderings, spacing-one boundary tails and lifecycle admission without changing existing tiers or launch defaults.

## 0.9.0

- Add frozen Robinhood mainnet HMM Fixed and HMM Dynamic pool presets with their exact admitted profile, adapter, envelope, dependency graph and hash-verified constructor creation code.
- Add typed `HmmStrategyConfig` / `HmmLaunchConfig`, `encodeHmmLaunchTail`, `decodeHmmLaunchTail`, `validateHmmLaunchConfig` and calibrated `defaultHmmLaunchConfig` helpers.
- Append the required 448-byte HMM launch tail automatically in the config6 codec; reject missing/invalid tails and preserve them through planning, salt mining and recovery. Match the collector factory's prefix-only hook economics commitment while binding the full tail in the launch-plan hash.
- Add independent Foundry ABI fixtures, validation and fixed/dynamic plan tests, a pure configuration example and consumer documentation. Existing preset selections and fixed launch examples remain unchanged.

## 0.8.1

- Add the zero-author-royalty Dynamic Fee Hook preset (`V4DynamicFeePool`) with explicit config6 minimum, maximum, and sensitivity; require zero LP fee.

## 0.8.0

- Require continuous opening-to-boundary position coverage for unstarted plans; enable permanent tails by default. Replace `staircaseBoundaries` with `positionGaps`.
- Default launch wrappers to unsigned dry-run; require `--broadcast` for writes and use `--resume` to retain the original plan, receipts, and metadata session.
- Add opt-in `createLifecycleSessionCache` for static reads at one canonical block; financial state and execution proof stay live.

## 0.7.1

- Add frozen deployment/profile selectors and transaction-first construction. `prepareAndPlanLifecycleLaunch` prepares salts and proves the selected mode; `buildLaunchTransactions` compiles unsigned commands.
- Add ordered-buy output calibration with `buySlippageBps`, budget-funded range presets, exact position/market allocation checks, and pre-buy burning of unused launch inventory.
- Add immediate reviewed-envelope replay through `buildNextTransaction({ reviewedTransaction })`, retaining exact gas and gas price.

## 0.6.3

- Reduce profile-certification dependency rounds and duplicate RPC reads; overlap independent work on batching-capable clients while retaining registry and graph checks.

## 0.6.2

- Add opt-in `LifecycleRpcClient.onDiagnostic` timing events for planning, RPC queueing, certification, and simulation. Events omit request payloads and secrets.

## 0.6.1

- Add opt-in `supportsReadBatching`, bounded to eight concurrent SDK reads per invocation, and invocation-local reuse of identical pinned reads. Default clients remain serial.
- Skip V4-only metadata reads for Abyss-only plans; preserve required reads for selected V4 profiles.

## 0.6.0

- Separate `executionProof`, `protocolFit`, and `transportPreflight`. Robinhood admission requires native Nitro compute/poster evidence and exact sequential replay.
- Add read-only immediate transaction preflight through `buildNextTransaction({ submissionClient })`; optional caller limits tighten admission.
