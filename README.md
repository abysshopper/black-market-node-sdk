![Abyss](https://raw.githubusercontent.com/abysshopper/black-market-node-sdk/main/assets/splash.png)

# @black-market/sdk

TypeScript tools for Black Market launches, the Abyss DEX, and lending on
[Robinhood Chain](https://robinhoodchain.blockscout.com). Built on
[viem](https://viem.sh): ESM, Node.js 20+, bigint amounts.

## Install

```sh
npm install @black-market/sdk viem
# or: pnpm add @black-market/sdk viem
```

## Discover the deployed launch graph

Save this as `discover.mjs` and run `node discover.mjs`. It reads mainnet only;
no wallet, private key, or transaction is needed.

```js
import {
  createProtocolPublicClient, getAddresses, readLifecycleProfiles,
} from "@black-market/sdk";

const client = createProtocolPublicClient({ chainId: 4663 });
const { launchOrchestrator } = getAddresses(4663);
const profiles = await readLifecycleProfiles({ client, orchestrator: launchOrchestrator });
console.table(profiles.map(({ id, venueKind, topology, admitted, reason }) => ({
  profile: id, venue: venueKind, config: topology.configVersion, admitted, reason,
})));
```

The mined deployment has **pool-bound V4 config 5** and **Abyss config 1**:
two adapters and five profiles. Discovery checks registry binding, runtime and
dependency commitments, and current admission—not a hard-coded template list.

From this repository, the same read-only example is available with:

```sh
pnpm install
pnpm examples
# Optional RPC override: RPC_URL=https://your-robinhood-rpc pnpm examples
```

## Launch workflow

1. Discover an admitted profile and copy its exact schema, bounds, and author terms.
2. Build an explicit `LaunchPlanV1`: creator, token, sorted funding/fee policies,
   market budgets/configs, ordered buys, deadline, and selected developer rate.
3. For V4 config 5, finalize its hook salt with `preparePoolBoundLifecyclePlan`.
   Save `serializeLaunchPlan(result.plan)`; do not submit a draft commitment.
4. Review `planLaunch` with an explicit `"atomic"` or `"staged"` mode and current
   execution limits. Use `readLaunchProgress` and `buildNextTransaction` for recovery.
5. Your application authenticates the wallet chain, signs the exact admitted
   transaction, and stores receipt references. SDK planning/builders never sign.

Staged preparation does **not** split activation: minting, permanent locking,
every initial buy, and public opening remain one transaction. Unavailable
stateful simulation or execution-limit evidence prevents executable admission.

See the [launch lifecycle guide](https://github.com/abysshopper/black-market-node-sdk/blob/main/docs/launch-lifecycle.md)
for codecs, saved-plan review, salt mining, simulation, recovery, and stable-author
fee claims. [`examples/`](https://github.com/abysshopper/black-market-node-sdk/tree/main/examples)
also includes read-only discovery and unsigned saved-plan review. `LaunchApiClient`
handles signed metadata sessions and publication; it does not broadcast a chain launch.

## Launch examples: one command per case

**Running any command below deliberately signs, spends funds, launches a token,
and publishes through your configured API. Mainnet execution is irreversible.**
No flags, parameters, fixture files, default private keys or API skips are used.

Setup once with **Node 24+**: install dependencies (`pnpm install` in this repository,
or `pnpm add @black-market/sdk viem` in a consumer), copy
[`examples/.env.example`](https://github.com/abysshopper/black-market-node-sdk/blob/main/examples/.env.example)
to `.env` in your working directory, and set your funded wallet's `PRIVATE_KEY`
and actual `LAUNCH_API_URL`. Existing process environment wins over `.env`.
Consumer projects may copy the example files plus both shared helpers into `examples/`;
the implementation imports the installed public `@black-market/sdk` package.

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

Run only the case you intend to launch. `RPC_URL` defaults to the SDK official
chain-4663 mainnet endpoint. Optional `SIMULATION_RPC_URL` selects a separate owned
loopback Anvil for SDK controlled simulation; otherwise actual native `eth_simulateV1`
support is required. Admission failures do not change mode or economics.
Gas/calldata defaults are **EXAMPLE ceilings, not verified provider/account limits**.
Full setup, exact case economics, optional environment caps, and recovery are in the
[example guide](https://github.com/abysshopper/black-market-node-sdk/blob/main/examples/README.md#individual-token-creation).

Every run creates a fresh `launch-results/<timestamp-case-random>/` and retains
redacted logs, plans, signed transaction hashes **before broadcast**, and real receipts
even on failure. Only `private-recovery.json` (mode `0600`) stores raw signed bytes,
API signatures and capabilities. **Do not blindly rerun after an ambiguous broadcast**;
inspect the retained hash first. There is no broadcast retry, relaunch or source rollback.

## Networks and configuration

| Chain | Use | Launch defaults |
| --- | --- | --- |
| `4663` | Robinhood mainnet | Current mined deployment |
| `46631` | Robinhood fork workbench | Explicit environment configuration |
| `31337` | Local Anvil | Explicit environment configuration |

Pass a chain ID explicitly: `getAddresses()` otherwise selects `46631`, while
client factories otherwise select local `31337`. Mainnet lending addresses come
from the replacement infrastructure; canonical Abyss DEX utilities remain available.

| Mainnet launch contract | Address |
| --- | --- |
| Orchestrator | `0xb75CBD17b9aecb7305B4DFcDa69595F783341c0E` |
| Implementation registry | `0xaa8a410709B79cBA6F118F1be1FF568877A3B8Ee` |
| Fee-owner registry | `0x15778Aad08e12D458B2848F035860e2a8c2a0725` |

Launch address overrides are evaluated on import: bare `LAUNCH_ORCHESTRATOR`,
`LAUNCH_IMPLEMENTATION_REGISTRY`, and `LAUNCH_FEE_OWNER_REGISTRY` take precedence
over their `VITE_` and `NEXT_PUBLIC_` forms. Configure the whole matching graph.
Client RPC precedence is explicit `rpcUrl`, then `RPC_URL`, then the selected
chain's default endpoint. See the guide for DEX/lending override details.
The browser-safe `@black-market/sdk/lifecycle` entrypoint contains launch codecs,
ABIs, planning, recovery, and author APIs without selecting a deployed address.

## Tests

```sh
pnpm test         # Build and run the offline node:test unit suite
pnpm typecheck    # TypeScript public surface
LAUNCH_API_TEST_URL=http://127.0.0.1:18763 pnpm test:api
```

`test:api` uses actual HTTP session reads and capability boundaries, without a key
or writes. It requires a running abyss-api service with launch-session routes and
real application storage. Missing configuration/storage or an unreachable service
fails the explicitly selected suite; integration tests are not part of `pnpm test`.

For signed metadata-only create/read/replay/conflict/authorization tests, use an
**owned disposable loopback service and database**, with an explicit disposable key:

```sh
LAUNCH_API_TEST_URL=http://127.0.0.1:18763 \
LAUNCH_API_TEST_PRIVATE_KEY="$DISPOSABLE_TEST_PRIVATE_KEY" pnpm test:api:write
```

`LAUNCH_API_TEST_CHAIN_ID` defaults to `4663`; `LAUNCH_API_TEST_ORCHESTRATOR`
defaults to the mainnet orchestrator above and must match the service signing domain.
No image store, indexed launch, funded wallet, or chain write is required. These
sessions prove HTTP metadata behavior, not image publication or a chain launch.
Service requirements are in the [API integration section](https://github.com/abysshopper/black-market-node-sdk/blob/main/docs/launch-lifecycle.md#real-http-api-integration).

## License

MIT
