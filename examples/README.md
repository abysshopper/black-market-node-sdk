# Examples

The launch examples use the installed public `@black-market/sdk` package and viem,
including when copied into a consumer project. The deployed chain-4663 graph uses
pool-bound V4 config 5 and canonical Abyss config 1. Discovery is read-only; running
a fixed launch example with configured wallet/API deliberately executes real writes.

| Script | Behavior |
| --- | --- |
| `quickstart.mjs` | Reads the current mainnet orchestrator, checks its registry binding, and discovers admitted profiles. No wallet or writes. |
| `launch.mjs` | Reviews/reconstructs an explicit saved plan and selected atomic/staged mode; optional offchain config-5 salt mining. Prints simulation, progress, and an admitted unsigned next transaction when evidence permits. |
| `generate-lifecycle-commitment-fixture.mjs` | Independent offline ABI reference for current config-4/Abyss commitment bytes/hash/identity, not a deployment or executable launch. |
| `launch-lifecycle-smoke.mjs` | Actual SDK launch/recovery/custody/fee operations, only on an explicitly authorized owned disposable loopback graph. |
| `launch-erc20-*.mjs`, `launch-erc404-*.mjs` | Eight independent zero-parameter launch cases with actual SDK admission, local signing, chain verification and mandatory API publication/indexing. |

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

Executable admission requires actual stateful measurement and exact validated replay.
`--limits current-limits.json` is optional tightening policy, not a required backend:
missing caps stay explicit uncertainty, while supplied malformed/stale/mismatched
provenance rejects. Encode bigint values as decimal strings. Robinhood `4663` reads
pinned native Nitro compute/poster evidence and requires native `eth_simulateV1`.
A **separate disposable loopback fork** (`--fork-rpc URL`) remains available for
generic EVM, not as a Nitro metering substitute. Unsigned review reports
`transportPreflight: "not-requested"` unless a consumer supplies its active submission
RPC to build-next. See the
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

**Running one of these files signs and broadcasts a real launch and writes to your
configured API. Mainnet execution is irreversible and spends real funds.** Choose
one command per intended launch; there are no flags, parameters or fixture files.

### Setup once

Use **Node 24+**. In this repository run `pnpm install`. In a consumer project install
both public dependencies with `pnpm add @black-market/sdk viem` (or
`npm install @black-market/sdk viem`) and copy the selected files with
`launch-example.mjs` and `launch-example-support.mjs` into `examples/`.
Copy `examples/.env.example` to `.env` in the directory you will run commands from:

```sh
cp examples/.env.example .env
chmod 600 .env
```

Edit `.env` once:

```dotenv
PRIVATE_KEY=
LAUNCH_API_URL=
RPC_URL=
```

Set `PRIVATE_KEY` to **your funded EOA's** 32-byte hex key and `LAUNCH_API_URL` to
your actual HTTPS or owned loopback API service root. There is no default wallet,
public development key, guessed API URL, or silent API skip. The API needs actual
application storage and an indexer observing the same chain as the execution RPC.
Existing environment variables take precedence over the working-directory `.env`,
loaded once using Node's native `process.loadEnvFile`. No shell interpolation is used.

Blank `RPC_URL` uses the SDK official Robinhood chain-4663 mainnet endpoint; HTTPS
providers and explicit owned loopback HTTP execution RPCs are supported.
The creator is derived locally from the key, and the deployment/WETH addresses come
from `getAddresses(4663)`. The runner checks chain identity, EOA and deployed core,
discovers admitted profiles, verifies the actual wrapped-native binding and reads
the registered P1 `(1,4096)` oracle configuration. No fixture defines these facts.
Optional `NFT_BASE_URI` supplies your actually hosted ERC404 NFT metadata base URI.
Blank uses an empty base URI: NFT units/mirror behavior remain real, but the example
does not claim hosted NFT metadata exists.

The fixed Robinhood examples require native sequential Nitro `eth_simulateV1`, including
an isolated pinned ArbOS capability probe and exact fee-bearing replay. Generic
Anvil/Hardhat forks cannot certify Nitro compute/poster metering and are not a fallback.
Unsupported native simulation, insufficient funds or failed admission stop before API
staging/broadcast. Each immediate next envelope is additionally preflighted read-only
through the same execution RPC before signing. There is no mode fallback, admission
override, automatic submission replay or reduced case.

### Commands and fixed cases

```sh
node examples/launch-erc20-v4.mjs
node examples/launch-erc20-abyss.mjs
node examples/launch-erc404-v4.mjs
node examples/launch-erc404-abyss.mjs
node examples/launch-erc20-staking-v4.mjs
node examples/launch-erc20-dividends-abyss.mjs
node examples/launch-erc20-burn-mixed.mjs
node examples/launch-erc404-dividends-mixed.mjs
```

| File suffix | Token / rewards | Markets and permanent positions | Mode / opening buys |
| --- | --- | --- | --- |
| `erc20-v4` | ERC20 / none | V4: 1 | atomic / 1 |
| `erc20-abyss` | ERC20 / none | Abyss: 1 | atomic / 1 |
| `erc404-v4` | ERC404 / none | V4: 1 | staged / 1 |
| `erc404-abyss` | ERC404 / none | Abyss: 1 | atomic / 1 |
| `erc20-staking-v4` | ERC20 / staking | V4: 2 | staged / 2 |
| `erc20-dividends-abyss` | ERC20 / dividends | Abyss: 3 | staged / 1 |
| `erc20-burn-mixed` | ERC20 / token-only burn 3000 bps | dual-fee V4: 2; Abyss: 1 | staged / 1 per market |
| `erc404-dividends-mixed` | ERC404 / dividends | V4: 2; Abyss: 3 | staged / 1 per market |

ERC20 supply is `1_000_000e18`; ERC404 supply is `10_000e18`, NFT unit `100e18`.
Positions retain `1000e18` liquidity and the case's exact ranges. Each ordered buy
spends up to `0.001 ETH` through native-wrap funding. Rewards use 4000 bps where
selected; token-only burn is 3000 bps in the burn case. V4 uses frozen registered
treasury/author terms with developer rate `0`; executor fee is 275 bps.
Hook salts/random identities are finalized and saved before execution.

### Optional execution restrictions

There are no default chain/RPC/account gas or calldata caps. The SDK reads current
Nitro protocol compute ceilings and exact-calldata poster budgets itself. Default
headroom is **1500 bps (15%)**. Set explicit decimal restrictions only when you intend
to tighten the complete transaction envelope: `EXAMPLE_CHAIN_GAS_CAP`,
`EXAMPLE_RPC_GAS_CAP`, `EXAMPLE_ACCOUNT_GAS_CAP`, `EXAMPLE_MAX_CALLDATA_BYTES`.
`EXAMPLE_HEADROOM_BPS` preserves your explicit 0–10000 policy. These are local
restrictions, not invented provider/account assurances or admission bypasses.
Poster allocation is already inside Nitro gas/affordability and is not charged twice.

### Evidence and failure recovery

Each run automatically creates `launch-results/<timestamp-case-random>/`; there is
no user output option. Inspect `result.json`, `events.jsonl`, finalized `plan.json`,
`receipts.json` and `published-token.json`. Exact admitted wallet envelopes are signed
locally; computed hashes and unsigned envelopes are durably retained as
`broadcast-attempt` **before the one raw broadcast**. Real receipts are saved before
status/canonical-state assertions. No unlocked-account signing or sending is used.
Public evidence redacts known keys, signatures, signed raw bytes, API capabilities,
authorization values and RPC endpoint credentials. Only `private-recovery.json`
(mode `0600`) retains raw signed transactions and one-time API recovery material;
never share or commit it. `launch-results/` is ignored.

Every case requires actual API metadata staging, publication using the activation
hash, and an indexed DTO matching token/creator/hash/metadata. Genuine pending-indexer
HTTP `202` responses are polled for up to 90 seconds respecting `Retry-After`;
other API failures are not retried or converted to partial success. Broadcast/API
failures retain logs/hashes and exit nonzero. The runner never retries a raw send,
relaunches, cancels or rolls back the source chain. **Do not blindly rerun after an
ambiguous broadcast**: inspect the durable transaction hash on chain first.
See [chain/API invariants](../docs/launch-lifecycle.md#individual-token-creation-examples).

### Owned-local wallet verification helpers

`launch-example-support.mjs` exports
`createLocalLaunchWallet({privateKey,creator,chainId,orchestrator,client,redactor})`
and `submitSignedRecorded({transaction,wallet,client,wait,artifacts,signal})`.
`client.request({method,params})` is an explicit RPC adapter; `transaction` carries
`id`, `kind`, and exact unsigned `wire` chain/from/to/data/value/gas fields plus
optional nonce/fees/type/accessList. `wait(hash)` returns a real receipt.
The signer exposes `address`, `signTypedData(typedData)` and `signTransaction(wire)`
returning `{wire,rawTransaction,transactionHash}`. Retain the result privately.
Use `RunArtifacts(output,caseId,redactor)` with `Redactor` and a fresh directory for
durable evidence; call `initialize()` before work and `finish(status,error)` afterward.
The shared `runLaunchExample(caseObject)` in `launch-example.mjs` takes the same fixed
case objects as the eight files, loads environment and auto-creates its output.
Offline diagnostic tests are in `test/launch-example.test.mjs`; they do not claim
real launch or API-indexer proof.


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
