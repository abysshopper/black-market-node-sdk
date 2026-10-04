# Examples

ESM scripts import built public SDK entrypoints, not private source helpers. Old Atomic/Unified/template fixtures have been removed; current reviewed profiles are discovered by registry schema/topology, never a template allowlist.

| Script | Behavior |
| --- | --- |
| `quickstart.mjs` | Offline pure geometry/buy estimate, explicit current config-4 terms/rate/commitment and unchanged lending formatting. Non-deployed wire example; no execution claim. |
| `launch.mjs` | Read-only review/recovery of an explicit saved economic plan and explicitly selected atomic/staged mode; optional offchain bound salt mining. Prints simulation/progress/one admitted unsigned next step. |
| `generate-lifecycle-commitment-fixture.mjs` | Independent literal Solidity ABI reference for portable current-config commitment bytes/hash/identity. |
| `launch-lifecycle-smoke.mjs` | Actual public SDK execution, recovery, custody, V3 harvest and author claims on an explicitly authorized owned loopback graph only. |

## Offline quickstart

```sh
pnpm build
node examples/quickstart.mjs
# or: pnpm examples
```

Pure math is not execution proof. Real author/profile/terms/bounds/oracle/dependency identities must come from the explicit reviewed registry. A rate, including zero, must be creator-selected rather than defaulted.

## Read-only reviewed launch CLI

Supply a full saved `LaunchPlanV1` JSON, not a template ID or old request:

```sh
node examples/launch.mjs \
  --plan plan.json --rpc http://127.0.0.1:18555 --mode staged \
  --limits current-limits.json --fork-rpc http://127.0.0.1:18556 --mine
```

`--mine` finalizes config-5 salts offchain and prints the returned plan; persist that exact output before begin. `--receipts receipts.json` and `--confirmations N` restore canonical recovery context. The CLI never signs, submits source-chain transactions, uploads metadata or publishes a launch. If the supplied RPC supports sequential `eth_simulateV1`, no disposable fork is needed; otherwise an explicit separate loopback fork is required for executable admission.

`current-limits.json` must contain fresh matching chain/account/core/observed block/hash provenance and actual chain/RPC/account/calldata caps. Gas/chain/block values are decimal strings. Missing/stale/mismatched facts prevent admission; live block gas limit alone is not provider/account policy. Application limit-service callbacks are preferred for real ongoing submission; see the [lifecycle guide](../docs/launch-lifecycle.md). Modes never fall back silently. Wallet chain/signature/receipt handling is caller-owned.

`LaunchApiClient` remains available for separately caller-authorized signed metadata/image/session/publication integration. Publication of an existing confirmed transaction must not trigger another launch; a metadata session is not economic/profile admission.

## Actual owned-fixture proof

The current manifest declares `fixtureOnly: true`, explicit reviewed graph addresses and `executionLimits.provenance.scope: "controlled-local-measurement"`. The Solidity-exported plan file contains `plans` with exact encoded plan/hash/identity/token vectors. No named-template row count is an SDK admission requirement.

```sh
LAUNCH_LIFECYCLE_RPC_URL=http://127.0.0.1:18555 \
LAUNCH_LIFECYCLE_FORK_RPC_URL=http://127.0.0.1:18556 \
LAUNCH_LIFECYCLE_ALLOW_LOCAL_EXECUTION=1 \
node examples/launch-lifecycle-smoke.mjs manifest.json sdk-plans.json
```

This command intentionally executes only authorized disposable fixture transactions, restores snapshots per plan/mode and never treats atomic refusal as implicit staged consent. It observes actual ordered buys/canonical Active state/permanent custody, exact typed deployment provenance, V3 no-argument `claimAndSplit()` preview/harvest, reserved owner/developer balances and authenticated stable-author page receipts/payout balance deltas. Page cursor completion and payment success stay separate.

Real-graph boundary regressions use the same environment plus `LAUNCH_LIFECYCLE_MANIFEST` and `LAUNCH_LIFECYCLE_FIXTURES`, via `node --test test/lifecycle-chain.test.mjs`. Final verification runs after all concurrent source edits settle. Current retained runtime evidence is owned by the protocol repository's [evidence index](../../black-market/docs/10-4-audit/README.md), not by historical immutable launch fixtures.
