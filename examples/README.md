# Examples

ESM scripts import the built public SDK. The deployed mainnet graph uses pool-bound
V4 config 5 and canonical Abyss config 1. Discovery is read-only by default;
source-chain and API writes require explicit caller authorization.

| Script | Behavior |
| --- | --- |
| `quickstart.mjs` | Reads the current mainnet orchestrator, checks its registry binding, and discovers admitted profiles. No wallet or writes. |
| `launch.mjs` | Reviews/reconstructs an explicit saved plan and selected atomic/staged mode; optional offchain config-5 salt mining. Prints simulation, progress, and an admitted unsigned next transaction when evidence permits. |
| `generate-lifecycle-commitment-fixture.mjs` | Independent offline ABI reference for current config-4/Abyss commitment bytes/hash/identity, not a deployment or executable launch. |
| `launch-lifecycle-smoke.mjs` | Actual SDK launch/recovery/custody/fee operations, only on an explicitly authorized owned disposable loopback graph. |
| `smoke-launch.mjs` | One catalogue token creation with actual current lifecycle execution and signed API publication/indexing; defaults to unsigned plan-only and retains failure artifacts. |

## Deployed read-only discovery

```sh
pnpm install
pnpm examples
# Optional: RPC_URL=https://your-robinhood-rpc pnpm examples
```

`CHAIN_ID` defaults to `4663`. Local `31337` and workbench `46631` require a matching
RPC and explicit `LAUNCH_ORCHESTRATOR`, `LAUNCH_IMPLEMENTATION_REGISTRY`, and
`LAUNCH_FEE_OWNER_REGISTRY`. The example checks RPC chain identity and registry binding.
Profile discovery verifies live registry admission and certified dependencies; it does
not build/sign a launch, choose a developer fee, or select market economics.

## Unsigned saved-plan review

Supply full `LaunchPlanV1` JSON using the selected RPC's current deployment:

```sh
pnpm build
node examples/launch.mjs \
  --plan plan.json --rpc https://rpc.mainnet.chain.robinhood.com/ --mode staged --mine
```

`--mine` finalizes config-5 salts offchain and prints the final plan. Persist that exact
commitment before begin. `--receipts receipts.json` and `--confirmations N` restore
canonical recovery context. The CLI never signs, submits source-chain transactions,
uploads metadata, or publishes a launch. Modes never fall back silently.

Executable admission additionally requires current matching execution-limit evidence
(`--limits current-limits.json`) and sequential `eth_simulateV1`, or an explicitly
supplied **separate disposable loopback fork** (`--fork-rpc URL`). Limits must include
chain/account/core/observed-block/hash provenance and actual chain/RPC/account/calldata
caps; encode bigint values as decimal strings. Missing facts produce provisional/refused
admission, not invented provider/account policy. See the
[lifecycle guide](../docs/launch-lifecycle.md#execution-constraints-and-stateful-simulation).

## Real HTTP metadata sessions

The real HTTP integration suite uses the public `LaunchApiClient` against a separately
running service. Reads are unsigned; metadata-session writes require a disposable key
and an owned loopback service with real application storage:

```sh
LAUNCH_API_TEST_URL=http://127.0.0.1:18763 pnpm test:api
LAUNCH_API_TEST_URL=http://127.0.0.1:18763 \
LAUNCH_API_TEST_PRIVATE_KEY="$DISPOSABLE_TEST_PRIVATE_KEY" pnpm test:api:write
```

These are metadata-only session tests, not token deployment or image/transaction
publication. No image store, indexer, wallet balance, or chain transaction is needed.
See [service prerequisites](../docs/launch-lifecycle.md#real-http-api-integration).

## Individual token creation

Prepare the two owned Anvil RPCs and fixture with the
[shared smoke setup](../../black-market/docs/sdk-launch-smoke.md). This forks the
current deployed chain-4663 graph; it does not redeploy contracts or fabricate API facts.
The fixture carries the eight scenario definitions, native-wrap quote asset,
registered oracle ID, unlocked creator and explicit measured local execution caps.

```sh
pnpm smoke:launch --help
pnpm smoke:launch --fixture /tmp/sdk-smoke/fixture.json --list

# Unsigned plan only: no signing, API write, source or simulation transaction.
pnpm smoke:launch --fixture /tmp/sdk-smoke/fixture.json \
  --case erc404-dividends-mixed --output /tmp/node-smoke-plan

# One real launch and publication to your actual owned loopback API/indexer.
pnpm smoke:launch --fixture /tmp/sdk-smoke/fixture.json \
  --case erc404-dividends-mixed --output /tmp/node-smoke-api \
  --execute --api-url http://127.0.0.1:18763 --publish-timeout-seconds 90

# Explicit partial scope; this cannot claim API/end-to-end success.
pnpm smoke:launch --fixture /tmp/sdk-smoke/fixture.json \
  --case erc20-burn-mixed --output /tmp/node-smoke-chain --execute --chain-only
```

Choose any single ID printed by `--list`; modes, positions, rewards and burn economics
come from that exact case with no fallback. Each output directory must be new, with
an existing parent. Read `result.json`, `events.jsonl`, finalized `plan.json` and
`receipts.json` after success or failure. Submitted hashes are saved before polling;
local chain state is kept for debugging. Only `private-recovery.json` (mode `0600`)
contains the one-time API capability/signature—never share it or commit run artifacts.
Publication uses the actual activation hash and retries only a genuine pending-indexer
HTTP `202`, respecting its delay and the deadline. A missing/incompatible API indexer
fails with the completed chain evidence retained; it never launches another token.
See the [lifecycle smoke contract](../docs/launch-lifecycle.md#individual-token-creation-smoke).

## Actual owned-fixture proof

The manifest must declare `fixtureOnly: true`, exact reviewed graph addresses, and
`executionLimits.provenance.scope: "controlled-local-measurement"`. The plan file
contains Solidity-exported `plans` with encoded-plan/hash/identity/token vectors.
Do not pass a mined mainnet manifest as a writable fixture.

```sh
pnpm build
LAUNCH_LIFECYCLE_RPC_URL=http://127.0.0.1:18555 \
LAUNCH_LIFECYCLE_FORK_RPC_URL=http://127.0.0.1:18556 \
LAUNCH_LIFECYCLE_ALLOW_LOCAL_EXECUTION=1 \
node examples/launch-lifecycle-smoke.mjs manifest.json sdk-plans.json
```

This explicitly authorized command executes disposable fixture transactions and
restores snapshots per plan/mode. It exercises ordered buys, canonical Active state,
permanent custody, typed deployment provenance, V3 no-argument `claimAndSplit()`,
reserved owner/developer balances, and authenticated author claims. Cursor completion
and payment success stay separate.

For chain boundary regressions, also set `LAUNCH_LIFECYCLE_MANIFEST` and
`LAUNCH_LIFECYCLE_FIXTURES`, then run `node --test test/lifecycle-chain.test.mjs` with
the same local-execution environment. Ordinary `pnpm test` does not authorize chain writes.
