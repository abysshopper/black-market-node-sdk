![Abyss header](assets/abyss-header.png)

# @black-market/sdk

Canonical TypeScript SDK for the Black Market protocol on [Robinhood Chain](https://robinhoodchain.blockscout.com) — Abyss DEX infrastructure, Unified Launcher deployer flows, optional launch API integration, and the lending market.

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

### Current Unified Launcher launches

```ts
import {
  buildUnifiedLaunchCalldata,
  getAddresses,
  toUnifiedLaunchRequest,
  toUniswapV4PoolConfig,
} from "@black-market/sdk";

const addresses = getAddresses(4663);
const v4Config = toUniswapV4PoolConfig(poolRecipe, launchSqrtPriceX96, tickSpacing, true);
const request = toUnifiedLaunchRequest(atomicRequest, { kind: "uniswap-v4-v3", config: v4Config });
const calldata = buildUnifiedLaunchCalldata(request);
// Submit calldata to addresses.unifiedLauncher with zero native value for V4.
```

`toUnifiedLaunchRequest` supports the current Abyss and optimized `uniswap-v4-v3` routes. The V4 route keeps its ten-field `V4PoolConfigV2` wire format; it does not accept a `protocolBps` field. Read the pool registry before submitting so a route is enabled, and obtain the selected fee's tick spacing from the current Abyss factory.

`LaunchApiClient` optionally follows the launch application's signed metadata, image-upload, and transaction-publication session flow. It never signs on the caller's behalf; use `launchAttributionTypes` and `canonicalLaunchMetadataHash` with a wallet client before creating a session.

`LaunchApiClient` works with browser-native `fetch` and timers as well as Node 20+. Its existing exponential retry waits use `globalThis.setTimeout`, so importing the client does not require Node timer modules in a browser bundle.

`buildAtomicLaunchCalldata` remains available only for replaying retired Atomic Launch Factory fixtures. It must not be submitted to the current mainnet launcher.

### Versioned multi-market lifecycle (opt-in)

The lifecycle stack is separate from the current Unified Launcher and fee-only V1. It requires explicit chain/core/creator identity, immutable approved market profiles, and creator-selected `"atomic"` or `"staged"` execution. Shared V4 remains supported with profile `keccak256("black-market.v4-lifecycle-market.v3")` and config 2; additive pool-bound V4 uses profile `keccak256("black-market.v4-pool-bound-lifecycle-market.v1")` and config 3 with `hookSalt` immediately before positions. Existing deployed addresses and defaults are unchanged.

```ts
import {
  planLaunch, buildNextTransaction, readLaunchProgress,
  preparePoolBoundLifecyclePlan, buildPoolBoundHookDeploymentTransaction,
  V4_POOL_BOUND_LIFECYCLE_PROFILE_ID,
} from "@black-market/sdk/lifecycle";

// plan contains reviewed bound config-3 markets (or unchanged shared config-2 markets).
const finalized = await preparePoolBoundLifecyclePlan({
  client, plan,
  onProgress: ({ marketIndex, attempts }) => console.log(marketIndex, attempts.toString()),
});
// Optional calldata only; omit this and preparation deploys the exact typed hook.
const boundMarketIndex = finalized.plan.markets.findIndex(
  (market) => market.profileId === V4_POOL_BOUND_LIFECYCLE_PROFILE_ID,
);
if (boundMarketIndex >= 0) {
  // Before that hook has been deployed; application separately admits any write.
  const predeploy = await buildPoolBoundHookDeploymentTransaction({
    client, plan: finalized.plan, marketIndex: boundMarketIndex,
  });
  console.log(predeploy);
}
const planned = await planLaunch({
  client, account, plan: finalized.plan, mode: "atomic", limits,
});
// A refusal never silently switches to staged. Obtain separate user consent to replan.
const progress = await readLaunchProgress({ client, planned, receipts });
const next = await buildNextTransaction({ client, planned, receipts, limits });
// Submit next only when present, binding its exact value, gas and gasPrice.
```

The browser-safe subpath owns exact schema/venue encoding, sequential stateful simulation, current chain/RPC/account/calldata admission and confirmation-bound receipt/reorg recovery. Unknown constraints or an unavailable stateful backend prevent submission. Staged preparation creates only empty pools; mint/lock/all ordered buys/public opening remain one indivisible activation. Both canonical venues support atomic and staged execution with the same capability mask; preactivation safety comes from the launch token's transfer restrictions plus activation-time canonical opening-state verification, not a pool gate. Read the [lifecycle SDK guide](docs/launch-lifecycle.md) for actual limit-source requirements, a separate disposable fork, funding/cancellation semantics and real local smoke commands.

The [selection/finalization examples](docs/launch-lifecycle.md#select-freeze-and-finalize-a-bound-market) use real public codecs, cancellable offchain salt mining and exact factory/initcode/constructor provenance. Freeze domain, token identity and economics before mining; submit the returned plan through the normal planner, which binds the reviewed token factory and each bound deployment again before writes. One V4 market per quote is enforced across offerings/fees/salts; all positions for that quote share one root, different bound quotes have different roots, and Abyss may share the same quote. Creator cancellation of a pending launch uses the stored commitment, not fresh market/profile admission.

The current graph offers shared V4, pool-bound V4 and Abyss (three adapters/six profiles). Its manifest `executionLimits.provenance` records an explicit controlled-local 32M Anvil policy with separate 1,000-bps headroom, not full Nitro or proven live RPC/account ceilings. Pinned Robinhood ArbGasInfo getters both reported 32M; live RPC/account ceilings remain unknown. Prior 16M archives and old SDK/browser counts in the guide are historical local stress/restoration runs, not final pool-bound Python/UI proof or production constraints. No gas savings are inferred from offchain mining (shared already used it).

**Pool-bound is a topology choice, not a measured gas optimization.** In the historical controlled-local **synthetic multi-buy stress** measurement, successful **V4-only** bound launches cost approximately **5.12–5.23 million gas more per V4 root** than their shared counterparts. The original mixed two-quote pairs instead added approximately **10.82 million gas across two V4 roots** (about **5.41 million per root**); the V4-only range is not universal. Bound cost more in every successful matched stress pair. V4-only q1/q2/q3 plans contain 3/4/5 opening buys, mixed plans 4/6/8; none is an exactly-one-opening-swap product gas comparison. The hook's **24,564-byte runtime / 4,912,800-gas code deposit** is already included in preparation/atomic receipts; do not add it twice. See the durable [historical paired gas results and qualifications](../black-market/docs/launch-lifecycle-v1-operations.md#measured-sharedbound-gas-on-the-captured-graph) for setup, launch, maximum-transaction and marginal costs; refused atomic rows have no fabricated complete-launch totals. These are controlled EVM measurements, not Nitro/live RPC/account admission or actual Python/browser verification.

The completed [non-UI one-opening-swap proof](../black-market/docs/launch-lifecycle-v1-operations.md#completed-one-opening-swap-topology-proof)
now covers all eight named cores on shared/config2 and pool-bound/config3, with their
full inventory/tail and one actual V4 pool. **All32 catalogue rows reached Active in
each actual SDK**; the Node entrypoint exercised 61 requested fixtures / 71 observations
(61 Active including ten explicitly consented same-plan staged alternates, ten terminal
OOG stress refusals), and its real chain suite passed **28 TAP entries including its parent**.
All16 matched gas pairs completed; bound cost **5,154,553–5,185,959 more gas per pool**
in this one-swap workload. Per-fixture snapshot/funding restoration prevents cumulative
creator depletion without top-ups. Gas/Node and the fresh Python/reorg recovery are
distinct retained runs, not a claimed single uninterrupted both-SDK success.
No UI or live broadcast was performed; live provider/account admission remains unproven.

### Networks

| Chain ID | Network                       |
| -------: | ----------------------------- |
|    `4663` | Robinhood Chain mainnet       |
|   `46631` | Black Market workbench (fork) |
|   `31337` | Local Anvil                   |

`getAddresses()` defaults to the workbench chain (`46631`); pass `4663` for the canonical mainnet deployment or `31337` for a local Anvil fork.

Deployment addresses can be overridden with environment variables, evaluated once at module load. Where an override applies, the bare name wins, then `VITE_`, then `NEXT_PUBLIC_` (e.g. `ABYSS_ROUTER` > `VITE_ABYSS_ROUTER` > `NEXT_PUBLIC_ABYSS_ROUTER`). Overrides apply to the launch-application addresses on every chain, to the Abyss infrastructure addresses on `31337` and `46631` (mainnet `4663` always uses the canonical deployment), and to the lending-market addresses on `31337` (bare + `VITE_` + `NEXT_PUBLIC_`) and `46631` (`VITE_`/`NEXT_PUBLIC_` only). The workbench RPC URL reads `VITE_RPC_URL`, then `NEXT_PUBLIC_RPC_URL`, then `RPC_URL`.

## Package layout

| Module         | Contents                                                              |
| -------------- | --------------------------------------------------------------------- |
| `addresses`    | Chain definitions, current deployer/route addresses, env overrides    |
| `abis`         | Lending-market ABIs (pool, data providers, lens, oracle, vesting, …)  |
| `abyss`        | Abyss DEX ABIs and launch-module ABIs, pool profiles, fee tiers       |
| `auction`      | Atomic launch supply constants and paired-asset (quote) catalog       |
| `launch`       | Historical Atomic recipes and fixture calldata                        |
| `deployer`     | Unified Launcher ABI, current launch request and V4 route encoders    |
| `launch-api`   | Optional signed launch metadata, upload, and publication API client   |
| `lifecycle`    | Opt-in lifecycle schema/ABIs, explicit planner, stateful proof and recovery (`@black-market/sdk/lifecycle`) |
| `live`         | Reserve/user position normalization from lens & data-provider rows    |
| `format`       | RAY/WAD math, health-factor and units formatting helpers              |
| `client`       | viem public/wallet client factories                                   |

## Examples

Runnable scripts live in [`examples/`](examples/). `quickstart.mjs` builds a fresh launch request offline, and `abby-launch.mjs` reconstructs the successful [Abby mainnet launch](https://robinhoodchain.blockscout.com/tx/0xd0dcae27e9ec2f7fb6e2304d7b1d739fd2f45f91d1eb5e762cdfcf01819fb837) byte-for-byte without signing or broadcasting.

```sh
pnpm build
node examples/quickstart.mjs
node examples/abby-launch.mjs
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
