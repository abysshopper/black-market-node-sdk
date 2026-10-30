---
name: sdk-usage
description: Integrate the Abyss TypeScript SDK using the correct deployment graph, construction presets, public APIs and live execution authority. Covers protocol reads, unsigned lifecycle planning, swaps and lending.
---

# Use the TypeScript SDK

## Read the right contract

- Read `README.md`, `docs/launch-lifecycle.md` and the installed package's exports.
  Use Node 24+, pnpm, TypeScript ESM and integer base units (`bigint`).
- Consumer imports use `@black-market/sdk`. `@black-market/sdk/lifecycle` is the
  browser-safe lifecycle subpath; general pricing/AMM helpers use the root package.
- Use `createProtocolPublicClient({ chainId: 4663 })`, then verify the RPC chain.
  Resolve infrastructure through `getAddresses(chainId)`, not copied addresses.
  Explicitly configure local chains; never reuse mainnet defaults on a fork/local chain.
- Compare the plan's core, registry, funding escrow and selected profiles with the
  intended release. An old SDK, vendored tarball, environment override or saved plan
  can target an older immutable stack even when the application itself is current.
  A package version or a profile name alone does not prove deployment identity.

## Construct locally; check pinned inputs and budgets

1. Use `getKnownLifecycleDeployment`, `getKnownLifecycleProfile` and
   `listKnownLifecycleProfiles` for shipped profiles and deployment wiring. Profiles
   registered after the SDK release need not appear until the next SDK update.
2. Use `readLifecycleProfiles({ client, orchestrator })` only for explicit live
   registry inspection. Normal planning uses presets and covered template budgets;
   it does not crawl registries, execute launch calldata or mirror contract guards.
3. Build the complete `LaunchPlanV1`: explicit creator/core/nonce, token behavior,
   fee policies, funding, all markets/positions and ordered buys. Read the sibling
   `token-launch/SKILL.md` and `launch-pricing/SKILL.md` before choosing economics.
4. `buildLaunchTransactions({ plan, mode })` compiles unsigned calldata only.
   It does not prove balances, fees, gas capacity, quote freshness or execution.
5. `prepareAndPlanLifecycleLaunch({ client, account, plan, mode, ... })` combines
   bound-hook salt preparation, exact local opening-buy floors and current
   input/capacity checks. `planLaunch` checks an already-finalized plan.
   Review the returned final plan/commitment and `planned.assessment`.
6. `readLaunchProgress` and `buildNextTransaction` support canonical recovery.
   Build-next constructs and budgets only the immediate command. Persist returned
   `planned.mode`, confirmation policy and actual included/replacement hashes
   with optional wallet-observed nonce.

No planning/build-next simulation exists, including conversions; do not add a
host-owned simulation/mining loop. Routers enforce committed output minima and
deadlines. Known presets supply construction wiring and native ceilings;
template budgets and exact local curve math never claim execution evidence.
There is one pin, no planning nonce read and at most one chain observation per bound client. Recreate that client
on chain changes. The wallet owns nonce assignment and sending-RPC preparation.
Do not resurrect `preparePoolBoundLifecyclePlan` or `PlannedLaunch.atomicAttempt`.

Multiple markets always select staged. Atomic requires one known-profile market
whose padded compute, including an empirical2M reserve per Swap funding entry,
plus poster allocation fits; explicit staged stays staged. This is not a bound
on arbitrary router code or execution proof. Never remove positions, buys or
hooks to fit a budget. Preparation chunks deterministically;
activation cannot split and an excessive bound refuses before begin. Launch commands
use32M total including poster on4663; approvals omit gas. Caller caps refuse oversized
envelopes, never resize them. `assessment.ready` is not execution proof.

## Representation and integration boundaries

- Preserve `bigint` internally and decimal-string wide values in portable plans.
  Use `serializeLaunchPlan` / `parseLaunchPlan`, not lossy JSON numbers.
- A profile selects an implementation and configuration contract, not arbitrary
  executable hook calldata. Config version and topology are not fee-behavior names.
- Quotes, fee assets and direct ERC20/native-wrap funding are not a curated-token
  allowlist. Swap-conversion inputs and target/spender roles have separate registry
  admission; inspect the pricing skill before integrating Kyber.
- Keep local curve quotes, pinned input/budget assessments, wallet submission,
  canonical activation and API publication as separate outcomes.
- Use existing AMM/lending exports and ABIs before writing wrappers. An indexed
  routing candidate is not executable calldata. A successful launch/oracle setup
  is not lending admission: history, liquidity, risk policy and governance remain
  separate. Do not transplant lending-feed cutoffs into launch USD valuation policy.
- Address identity is case-insensitive; use library checksum/normalization helpers,
  not case-sensitive string matching for tokens, pools or deployment bindings.

## Verification and safety

`node examples/quickstart.ts` is a read-only discovery smoke after building.
Repository code changes use `pnpm test` and `pnpm typecheck`; HTTP/chain suites need
their documented disposable services and explicit authorization. For documentation,
execute the documented pure/read-only consumer path, not a funded launch example.

Reads, pricing, mining and unsigned compilation do not authorize signing,
broadcasting, uploads or metadata publication. Isolated local execution needs explicit
authorization; launch planning never selects a fork backend. Preserve unrelated worktree changes.

The audit's historical decisions and known regressions are in
`../token-launch/references/audit-history.md`; current exports and deployed evidence
override superseded conversations.
