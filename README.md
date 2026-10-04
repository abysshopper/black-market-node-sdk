![Abyss header](assets/abyss-header.png)

# @black-market/sdk

Canonical TypeScript SDK for Black Market on [Robinhood Chain](https://robinhoodchain.blockscout.com): reviewed multi-market launch planning and recovery, stable-author fee APIs, optional signed metadata integration, Abyss DEX infrastructure and lending.

Built on [viem](https://viem.sh). ESM-only, Node 20+.

## Install

```sh
npm install @black-market/sdk viem
# or
pnpm add @black-market/sdk viem
```

## Quick start

```ts
import { createProtocolPublicClient, getAddresses, robinhoodMainnet } from "@black-market/sdk";

const client = createProtocolPublicClient({ chainId: 4663 });
const addresses = getAddresses(4663); // canonical Robinhood mainnet deployment
```

### Wallet client (signing)

```ts
import { createProtocolWalletClient } from "@black-market/sdk";

const wallet = createProtocolWalletClient({
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
  chainId: 4663,
});
```

### Reviewed multi-market launches

The root package and browser-safe `@black-market/sdk/lifecycle` entrypoint expose the same current launch API. Select profiles from the explicit reviewed registry; template IDs are not SDK allowlists. Shared V4 uses config **4**, pool-bound V4 uses config **5**, and Abyss retains its canonical schema. Both V4 configurations explicitly commit `profileId`, `termsDigest`, stable `developerBeneficiary` and creator-selected `developerFeeBps`; bound config also commits `hookSalt` immediately before `profileId`. There is no default developer rate, conversion from old configs or old launcher compatibility path.

```ts
import {
  readLifecycleProfiles, preparePoolBoundLifecyclePlan, planLaunch,
  readLaunchProgress, buildNextTransaction,
} from "@black-market/sdk/lifecycle";

const profiles = await readLifecycleProfiles({ client, orchestrator: plan.orchestrator });
// Select admitted schema/topology and copy that profile's exact envelope/terms into the plan.
const finalized = await preparePoolBoundLifecyclePlan({ client, plan });
const planned = await planLaunch({
  client, account: finalized.plan.creator, plan: finalized.plan,
  mode: "staged", limits, fork, // execution mode is explicit; no automatic fallback
});
const progress = await readLaunchProgress({ client, planned, receipts });
const next = await buildNextTransaction({ client, planned, receipts, limits, fork });
// No SDK operation above signs or writes to the source chain.
// A separately authenticated wallet may submit only the exact admitted next envelope.
```

Registry authority, runtime/dependency hashes, reviewed bounds, frozen author consent, canonical oracle configuration, exact code chunks/initcode/constructor and deployer-recorded runtime provenance are verified. Hook address bits alone are not proof. One V4 market per quote is enforced across templates and topologies; an Abyss market may use the same quote.

Staged execution splits **only empty infrastructure preparation**. Minting, permanent locking, every ordered buy and public opening remain one indivisible activation. The planner uses sequential `eth_simulateV1` or an explicitly supplied separate disposable loopback fork. Unknown chain/RPC/account/calldata limits or unavailable stateful execution prevent transaction admission. Recovery rereads confirmation-bound canonical state and receipt/replacement/reorg evidence, not a cached step index; pending cancellation does not require readmission of retired profiles.

Read the [lifecycle guide](docs/launch-lifecycle.md) for exact codecs, profile discovery, execution-limit provenance, salt finalization, simulation, wallet-domain checks, recovery and V3 fee accounting.

### Stable authors and V3 fees

```ts
import {
  readLifecycleAuthor, readAuthorHubs, readDeveloperFees,
  buildSetAuthorPayoutTransaction, buildClaimDeveloperFeesTransaction,
  buildClaimDeveloperFeesPageTransaction, decodeDeveloperClaimReceipt,
} from "@black-market/sdk";

const author = await readLifecycleAuthor({ client, registry, authorId });
const hubs = await readAuthorHubs({ client, registry, authorId, offset: 0n, limit: 100n });
const fees = await readDeveloperFees({ client, registry, authorId, hub });
const unsigned = await buildClaimDeveloperFeesPageTransaction({
  client, registry, authorId, offset: 0n, limit: 10n, assets: [],
  account, chainId,
});
// Execution is caller-owned. After canonical confirmation:
const result = decodeDeveloperClaimReceipt({ receipt, transaction: unsigned });
// result.cursorComplete is independent from result.paymentsSucceeded.
// Preserve result.retryableResults; advancing the discovery cursor does not pay failed rows.
```

`authorId` is the immutable economic beneficiary, while `authorPayout(authorId)` is the live payout/controller. The admin or current controller may build an unsigned routing update; direct/page claims have no caller-selected recipient. Hub authentication is anchored to `registry.core -> core.feeFactory -> factory.isHub`, never attacker hub self-reports. V3 ordinary harvest uses the exported `lifecycleFeeHubAbi` and **no-argument `claimAndSplit()`**, including current source-specific developer allocations and reserved owner/developer credits.

`LaunchApiClient` remains the optional signed metadata/image-upload/transaction-publication client. It does not sign, broadcast or choose launch economics. Its browser-native `fetch` and `globalThis.setTimeout` implementation remains browser-safe.

### Networks

| Chain ID | Network                       |
| -------: | ----------------------------- |
|    `4663` | Robinhood Chain mainnet       |
|   `46631` | Black Market workbench (fork) |
|   `31337` | Local Anvil                   |

`getAddresses()` defaults to the workbench chain (`46631`); pass `4663` for the canonical mainnet deployment or `31337` for a local Anvil fork.

Deployment addresses can be overridden with environment variables, evaluated once at module load. Bare names win, then `VITE_`, then `NEXT_PUBLIC_`. Reviewed launch addresses (`LAUNCH_ORCHESTRATOR`, `LAUNCH_IMPLEMENTATION_REGISTRY`, `LAUNCH_FEE_OWNER_REGISTRY`) are explicit on every chain and default to zero; old launcher addresses are not fallback targets. Abyss infrastructure overrides apply on `31337`/`46631` (mainnet `4663` retains its canonical DEX deployment). Lending overrides apply on `31337` (all three prefixes) and `46631` (`VITE_`/`NEXT_PUBLIC_` only). The workbench RPC URL reads `VITE_RPC_URL`, then `NEXT_PUBLIC_RPC_URL`, then `RPC_URL`.

## Package layout

| Module         | Contents                                                              |
| -------------- | --------------------------------------------------------------------- |
| `addresses`    | Chain definitions, explicit reviewed launch addresses and env overrides |
| `abis`         | Lending-market ABIs (pool, data providers, lens, oracle, vesting, …)  |
| `abyss`        | Unchanged Abyss DEX ABIs, pool profiles, fee tiers and wrapped-native funding |
| `auction`      | Display supply and paired-asset metadata catalog (not an admission list) |
| `launch`       | Pure pool geometry and initial-buy estimates (not execution proof) |
| `launch-api`   | Optional signed launch metadata, upload, and publication API client   |
| `lifecycle`    | Reviewed schemas/ABIs, registry admission, planner/simulation/recovery and author APIs |
| `live`         | Reserve/user position normalization from lens & data-provider rows    |
| `format`       | RAY/WAD math, health-factor and units formatting helpers              |
| `client`       | viem public/wallet client factories                                   |

## Examples

Runnable scripts live in [`examples/`](examples/). `quickstart.mjs` demonstrates current config-4 commitment bytes and pure math offline. `launch.mjs` reviews an explicit saved plan without signatures or source-chain writes. The actual lifecycle smoke requires separately authorized owned loopback fixtures.

```sh
pnpm build
node examples/quickstart.mjs
```

## Development

```sh
pnpm install
pnpm build      # tsc → dist/
pnpm test       # build + node:test suite
pnpm typecheck
```

## Releasing

Releases are published to npm by GitHub Actions with [trusted publishing (OIDC)](https://docs.npmjs.com/trusted-publishers) — no npm tokens are stored in this repository.

1. Bump `version` in `package.json` and merge to `main`.
2. Cut a matching git tag (e.g. `v0.1.0`) and create a GitHub Release from it.
3. The [`publish` workflow](.github/workflows/publish.yml) runs on the `release: published` event (or via manual `workflow_dispatch` with a `version` input): it builds, tests, verifies the release tag / input version equals `package.json`'s `version`, dry-run checks the tarball contents, then publishes with `npm publish --provenance --access public`.

The publish job declares `environment: npm` and `permissions: id-token: write`. Configure the **`npm` environment** in the repository settings (Settings → Environments) with required reviewers so every publish needs approval, and register this repository + workflow as a trusted publisher on npmjs.com for the `@black-market/sdk` package.

## License

MIT
