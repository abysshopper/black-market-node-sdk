# Run the examples

These commands use the checkout's built `@black-market/sdk` **0.16.1** and viem.
Use **Node 24+** for direct TypeScript execution. Start with the one-market
`launch-erc20-abyss.ts`; larger cases require staged preparation and a bounded activation.
For valuation, token ordering, ranges, and buy protection, read the
[launch guide](../docs/launch-lifecycle.md#price-the-launch).

## Set up the checkout

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
cp -n examples/.env.example .env
chmod 600 .env
```

Launch wrappers load `.env` from the working directory with `process.loadEnvFile`.
Existing environment values take precedence. Values are literal; shell interpolation
is not applied. Use the matching SDK version when copying wrappers into a consumer project:
`pnpm add @black-market/sdk@0.16.1 viem`.
Copy `launch-example.ts`, `launch-example-support.ts`, and `launch-example-kyber.ts` with the wrapper.

### Configure the environment

| Variable | Value / default |
| --- | --- |
| `PRIVATE_KEY` | Your funded EOA's 32-byte hex key; leave blank when using a keystore. |
| `EXAMPLE_KEYSTORE_PATH` | Alternative signer: owner-only local V3 scrypt/AES-128-CTR keystore. |
| `EXAMPLE_KEYSTORE_PASSWORD` | Keystore password; defaults to empty. |
| `LAUNCH_API_URL` | Required service root: `https://api.abyss.trading`. |
| `RPC_URL` | Optional Robinhood mainnet RPC; defaults to the SDK's official endpoint. |
| `NFT_BASE_URI` | Optional hosted ERC404 NFT metadata base URI; defaults to empty. |
| `EXAMPLE_BUY_AMOUNT_WEI` | Native ETH input **per buy**; default `10000000000000` (0.00001 ETH). |
| `EXAMPLE_TARGET_MARKET_CAP_USD` | Whole-supply target FDV in decimal USD; default `5000`. |
| `EXAMPLE_TOKEN_NAME` / `EXAMPLE_TOKEN_SYMBOL` | Override the case's token identity. |
| `EXAMPLE_TOKEN_DESCRIPTION` | Override the case's metadata description. |
| `EXAMPLE_IMAGE_PATH` | Optional actual PNG, JPEG, or WebP file, 1 byte–5 MiB. |
| `EXAMPLE_KYBER_API_URL` | Optional conversion API root; defaults to `LAUNCH_API_URL`. |
| `EXAMPLE_CHAIN_GAS_CAP` | Optional complete transaction gas-envelope ceiling. |
| `EXAMPLE_RPC_GAS_CAP` | Optional provider transaction gas-envelope ceiling. |
| `EXAMPLE_ACCOUNT_GAS_CAP` | Optional wallet/account transaction gas-envelope ceiling. |
| `EXAMPLE_MAX_CALLDATA_BYTES` | Optional whole-transaction byte ceiling. |
| `EXAMPLE_HEADROOM_BPS` | Gas headroom, default `1500`; accepted range 0–10,000. |

Configure **exactly one** of `PRIVATE_KEY` and `EXAMPLE_KEYSTORE_PATH`.
A keystore must be a regular file owned by your user with owner-only permissions.
Dry-run derives the public address but does not construct a wallet signer.
Remote RPC/API endpoints require HTTPS; owned loopback services may use HTTP.

Metadata limits are 100 Unicode codepoints/128 UTF-8 bytes for name, 32 codepoints/bytes
for symbol, and 2,000 codepoints for description. The runner normalizes and trims text.
Images are hashed before attribution signing; malformed or animated files may fail API verification.
Keep `.env`, keystores, signed bytes, and private recovery material out of git.

## Discover without a wallet

```sh
pnpm examples
# quickstart.ts does not load .env; load it explicitly if needed:
node --env-file=.env examples/quickstart.ts
```

`quickstart.ts` reads process environment, verifies the chain and core/registry binding,
and prints live profile admission. `CHAIN_ID` defaults to `4663`.
Local `31337` and workbench `46631` need a matching RPC and explicit
`LAUNCH_ORCHESTRATOR`, `LAUNCH_IMPLEMENTATION_REGISTRY`, and `LAUNCH_FEE_OWNER_REGISTRY`.
Discovery does not choose prices, construct a wallet, or write metadata.

## Choose one of eleven launch cases

All commands are `node examples/<file>`, with no required arguments.
V4 cases select the fixed-fee pool-bound profile. Quotes default to WETH.
Position counts below are permanent launch positions, not separate hooks.

| File | Token / rewards | Markets / positions | Mode / total buys |
| --- | --- | --- | --- |
| `launch-erc20-abyss.ts` | ERC20 / none | Abyss WETH: 1 | atomic / 1 |
| `launch-erc20-v4.ts` | ERC20 / none | V4 WETH: 1 | atomic / 1 |
| `launch-erc404-v4.ts` | ERC404 / none | V4 WETH: 1 | staged / 1 |
| `launch-erc404-abyss.ts` | ERC404 / none | Abyss WETH: 1 | atomic / 1 |
| `launch-erc20-staking-v4.ts` | ERC20 / staking | V4 WETH: 2 | staged / 2 |
| `launch-erc20-dividends-abyss.ts` | ERC20 / dividends | Abyss WETH: 3 | staged / 1 |
| `launch-erc20-burn-mixed.ts` | ERC20 / 30% token-fee burn | V4 WETH: 2; Abyss WETH: 1 | staged / 2 |
| `launch-erc404-dividends-mixed.ts` | ERC404 / dividends | V4 WETH: 2; Abyss WETH: 3 | staged / 2 |
| `launch-erc20-multi-quote.ts` | ERC20 / none | V4 WETH: 1; V4 USDG: 1; Abyss WETH: 1 | staged / 3 |
| `launch-erc20-depth-v4.ts` | ERC20 / none | V4 WETH: 4 adjacent Early Scarcity bands | staged / 1 |
| `launch-erc20-dividends-multiquote-mixed.ts` | ERC20 / dividends | V4 WETH: 2; V4 USDG: 2; Abyss WETH: 3 | staged / 3 |

Reward-enabled cases allocate 40% of fee assets to holder rewards and 60% to the owner;
this is a fee-revenue split, not a 40% trading tax. The burn case allocates 30% of
launch-token fee revenue to burn; quote fees are not burned.
At most one V4 market per quote is allowed; an Abyss market may reuse that quote.
Market budgets sum to supply; position caps sum to each market budget. Actual mint
debits can be smaller than caps: unused mint dust burns **before** opening buys.

The eleven wrappers use neither HMM nor UFG. Pure configuration commands are:

```sh
node examples/hmm-launch-config.ts
node examples/ufg-launch-config.ts
```

For actual HMM/UFG integrations, use the [guide](../docs/launch-lifecycle.md#launch-a-ufg-treasury).
`launch.ts` is a direct-core saved-plan tool and does not carry the UFG route/config.

## Dry-run, broadcast, or resume

```sh
node examples/launch-erc20-abyss.ts
node examples/launch-erc20-abyss.ts --broadcast
node examples/launch-erc20-abyss.ts --resume "launch-results/<original-run-dir>"
```

| Mode | Reads / writes | Identity |
| --- | --- | --- |
| No flags | Live discovery, funding quotes, preparation, local economic review and gas-budget checks; unsigned, no API writes | Fresh plan/run directory |
| `--broadcast` | Signs, spends, stages/uploads metadata, deploys, verifies, and publishes; no further prompt | **Fresh plan**, not the preceding dry run |
| `--resume <original-run-dir>` | May sign remaining steps or finish publication | Retained plan, receipts, mode, confirmation policy, and API session |

Dry-run needs the signer source, RPC/API, and sufficient funds for current input/gas-budget checks.
Review its economics, then review the fresh broadcast output too. Mode flags cannot
be combined or duplicated. Resume is an execution authorization; omit `--broadcast`.

Every launch transaction uses the native ceiling,32M total on4663. Capacity profiles
only choose mode/chunks and reject oversized activation; exact local ordered math
protects opening buys. Multiple markets always stage; a single known-profile market
can stay atomic when its padded compute, including an empirical2M reserve per Swap,
plus poster allocation fits. Explicit staged stays staged; the conversion reserve
does not prove arbitrary router execution.
There is no launch simulation, including Kyber. Routers enforce conversion minima
and deadlines on-chain; `assessment.ready` is not a receipt or guaranteed execution.
See [coverage and migration](../docs/lifecycle-gas-profiles.md).

### Fund opening buys

| Quote | What the runner does with native ETH |
| --- | --- |
| WETH | Uses `LifecycleFundingKind.NativeWrap`; wraps ETH, no Kyber swap. |
| USDG | Uses `LifecycleFundingKind.Swap`; builds an admitted Kyber conversion with a minimum quote output. |

ETH for gas is additional. The SDK also supports direct ERC20 funding; the wrappers
use native ETH input. Buys sharing a quote use one aggregated funding output.
The plan expires after **3,600 seconds**; Kyber conversion calldata expires after
**300 seconds**. Conversion expiry must be at most 1,200 seconds away and no later
than plan expiry. A valid plan does not extend an expired conversion quote.
The conversion minimum protects ETH→USDG, not USDG→launch-token output;
[buy protection](../docs/launch-lifecycle.md#protect-the-opening-buy) is separate.

## Keep artifacts and recover the original launch

Each fresh run creates `launch-results/<timestamp-case-random>/`. Resume reuses it.
Read `result.json`, `economic-review.json`, `planning.json`, and `receipts.json` to
separate planning, chain completion, publication, and indexing.
Public `plan.json` may be redacted and cannot reconstruct the exact commitment.
The owner-only `private-recovery.json` retains the exact plan and API capability;
keep it inside its mode-0700 run directory and never share it.

The runner records the signed transaction's hash and exact envelope **before** one raw send.
After a timeout or interrupted send, inspect that hash and chain progress before continuing.
It does not automatically retry sends, adopt replacements, cancel, or create another token.

| Saved chain state | Resume behavior / next action |
| --- | --- |
| Preparing / Ready, still executable | Re-admit the original plan and submit only remaining steps. |
| Active | Recover the original activation receipt; verify and publish, even after the launch deadline. |
| Expired Preparing / Ready | Use SDK cancellation after reconciling receipts; see [recovery](../docs/launch-lifecycle.md#recover-or-cancel). |
| Unstarted / Cancelled / unresolved signed hash | Stops for reconciliation; do not use a new invocation as a retry. |

Resume retains salts and buy minima; it does not rerun preparation or recalibrate economics.
For replacements, retain original `transactionHash`, effective `replacementHash`,
observed block number/hash and the actual submitted nonce as an exact bigint
(decimal string in journals). SDK planning has no account-queue nonce gate; the
wallet assigns and tracks nonces. A missing receipt alone does not establish a reorg.

Metadata is staged before deployment. Publication uses the **original activation hash**.
A `LaunchPublishPending` response means indexing is pending; the runner polls for up
to 90 seconds, respecting `Retry-After`, and checks canonical Active before publication.
An image/indexing error after activation does not undo the launch. Resume publication.

Resume refreshes the original session and retains its one-time capability across responses.
If an image is still awaiting upload, supply the original `EXAMPLE_IMAGE_PATH` bytes;
the SHA-256, type, and length must match. It can renew an expired PUT URL once;
a verified image is not reuploaded. A reorg or changed activation inclusion stops recovery.

## Review a saved direct-core plan without signing

```sh
node examples/launch.ts --plan plan.json \
  --rpc https://rpc.mainnet.chain.robinhood.com/ --mode staged --mine
```

Use an owner-only exact `LaunchPlanV1` JSON file. `--mine` finalizes bound-hook salts
offchain; omit it when reviewing an already-finalized plan.
`--receipts receipts.json`, `--confirmations N`, and `--limits current-limits.json`
restore receipt references, confirmation depth, and optional tightening limits.
The CLI never signs, uploads, or publishes. It does not support UFG.

## Run read-only and local smoke checks

```sh
pnpm test
node examples/quickstart.ts
node examples/generate-lifecycle-commitment-fixture.ts
```

`pnpm test` is the offline unit suite. The generator prints a historical ABI vector,
not a current executable plan. Do not run a funded launch wrapper as a smoke check.
Owned-fork, owned-fixture, and HTTP API test commands are in the
[SDK reference](../docs/reference.md#run-owned-fixture-and-api-checks); they require
separate disposable infrastructure and explicit permission for any writes.
