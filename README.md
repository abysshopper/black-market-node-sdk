![Abyss header](assets/abyss-header.png)

# @black-market/sdk

Canonical TypeScript SDK for the Black Market protocol on [Robinhood Chain](https://robinhoodchain.blockscout.com) — Abyss DEX infrastructure, Atomic token launches, and the lending market.

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

### Atomic launches

```ts
import {
  LAUNCH_TEMPLATES,
  deriveAtomicLaunchPoolRecipe,
  estimateAtomicLaunchInitialBuy,
  buildAtomicLaunchCalldata,
  DEFAULT_ATOMIC_LAUNCH_TARGET_MARKET_CAP_USD,
} from "@black-market/sdk";

// Derive the one-sided launch position from a target FDV.
const recipe = deriveAtomicLaunchPoolRecipe({
  /* … */
});

// Encode an Atomic launch request for the AtomicLaunchFactory.
const calldata = buildAtomicLaunchCalldata(request, nativeBuyAmount);
```

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
| `addresses`    | Chain definitions, canonical deployment addresses, env overrides      |
| `abis`         | Lending-market ABIs (pool, data providers, lens, oracle, vesting, …)  |
| `abyss`        | Abyss DEX ABIs and launch-module ABIs, pool profiles, fee tiers       |
| `auction`      | Atomic launch supply constants and paired-asset (quote) catalog       |
| `launch`       | Launch templates, Atomic launch recipe derivation, calldata building  |
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
