![Abyss](https://raw.githubusercontent.com/abysshopper/black-market-node-sdk/main/assets/abyss-ziggurat-v3-pale-text-1500x500.png)

# Abyss TypeScript SDK

Use `@black-market/sdk` with [viem](https://viem.sh) to launch tokens, swap, and read lending markets.
This guide targets SDK **0.16.1** on Robinhood Chain mainnet (**4663**).
The package supports Node 20+; running the checkout's TypeScript examples requires **Node 24+**.

## Install

```sh
pnpm add @black-market/sdk@0.16.1 viem
```

To run the examples, use a checkout:

```sh
git clone https://github.com/abysshopper/black-market-node-sdk.git
cd black-market-node-sdk
pnpm install --frozen-lockfile
pnpm build
```

## Check the deployment first

```sh
pnpm examples
# To load configuration from an existing working-directory .env explicitly:
node --env-file=.env examples/quickstart.ts
```

`pnpm examples` builds and runs [`examples/quickstart.ts`](examples/quickstart.ts).
It reads chain identity, the orchestrator's registry, and current profile admission.
It needs no wallet and makes no writes. It reads the process environment; it does **not** load `.env` itself.
Export `RPC_URL` in your shell or use `--env-file` as shown. `CHAIN_ID` defaults to `4663`.

## Run a one-market ERC20 launch

Start with [`launch-erc20-abyss.ts`](examples/launch-erc20-abyss.ts): one Abyss/WETH market,
one permanent position, one opening buy, no holder rewards, atomic execution.

```sh
cp -n examples/.env.example .env
chmod 600 .env
```

Set `LAUNCH_API_URL=https://api.abyss.trading` and exactly one signer source:
`PRIVATE_KEY`, or `EXAMPLE_KEYSTORE_PATH` with optional `EXAMPLE_KEYSTORE_PASSWORD`.
Use your own funded account. Keep secrets and recovery files out of git.
The launch wrappers load the working-directory `.env`; existing environment values win.
Optional `RPC_URL` selects another Robinhood RPC. Remote endpoints require HTTPS.

```sh
# Unsigned planning; no chain transactions, uploads, or publication.
node examples/launch-erc20-abyss.ts
# Authorizes spending and publication, with no further prompt.
node examples/launch-erc20-abyss.ts --broadcast
# After partial execution, use the ORIGINAL run directory.
node examples/launch-erc20-abyss.ts --resume "launch-results/<original-run-dir>"
```

**Broadcast builds a fresh plan**, including a new nonce and token identity; it does not sign the dry-run plan.
Review the broadcast's printed economics too. `--resume` can spend funds and publish;
it continues the saved identity and does not require `--broadcast`.
A dry run still needs a signer source, sufficient funding, and live RPC/API access for input and gas-budget checks. It never executes launch calldata.

### Understand the defaults

- ERC20 supply: **1,000,000 tokens**. Target FDV: **$5,000**, or **$0.005/token** before tick alignment.
- FDV is a valuation, not cash deposited. Initial positions contain launch tokens only.
- Opening buy: **0.00001 ETH per buy**. ETH wraps into WETH; USDG cases convert through Kyber.
- ETH for gas is extra. The buy's output depends on fees, ranges, and the aligned opening price.
- `EXAMPLE_TARGET_MARKET_CAP_USD` and `EXAMPLE_BUY_AMOUNT_WEI` change the target and buy input.
  These defaults are examples, not a recommended valuation or an anti-sniper guarantee.

Use the [worked pricing guide](docs/launch-lifecycle.md#price-the-launch) before changing supply or ranges.

## Choose an example

Each filename below is in `examples/`. V4 cases use the fixed-fee pool-bound profile;
quotes are WETH unless USDG is listed. Positions are permanently locked.

| File | Token / rewards | Markets / position counts | Mode / buys |
| --- | --- | --- | --- |
| `launch-erc20-abyss.ts` | ERC20 / none | Abyss: 1 | atomic / 1 |
| `launch-erc20-v4.ts` | ERC20 / none | V4: 1 | atomic / 1 |
| `launch-erc404-v4.ts` | ERC404 / none | V4: 1 | staged / 1 |
| `launch-erc404-abyss.ts` | ERC404 / none | Abyss: 1 | atomic / 1 |
| `launch-erc20-staking-v4.ts` | ERC20 / staking | V4: 2 | staged / 2 |
| `launch-erc20-dividends-abyss.ts` | ERC20 / dividends | Abyss: 3 | staged / 1 |
| `launch-erc20-burn-mixed.ts` | ERC20 / 30% token-fee burn | V4: 2; Abyss: 1 | staged / 2 |
| `launch-erc404-dividends-mixed.ts` | ERC404 / dividends | V4: 2; Abyss: 3 | staged / 2 |
| `launch-erc20-multi-quote.ts` | ERC20 / none | V4 WETH: 1; V4 USDG: 1; Abyss WETH: 1 | staged / 3 |
| `launch-erc20-depth-v4.ts` | ERC20 / none | V4: 4, Early Scarcity | staged / 1 |
| `launch-erc20-dividends-multiquote-mixed.ts` | ERC20 / dividends | V4 WETH: 2; V4 USDG: 2; Abyss WETH: 3 | staged / 3 |

## Choose an offering for your integration

Use `listKnownLifecycleProfiles` for the release's supported offerings and deployment wiring.
Planning batches pinned current state, checks native-ceiling capacity budgets and computes exact local opening-buy quotes. It never simulates a launch transaction, including conversions. Multiple markets always select staged; one known-profile market can remain atomic when its padded budget, including 2M compute per Swap funding entry, plus poster allocation fits. Explicit staged stays staged. On4663 every launch step uses32M total gas including poster; approvals leave gas to the wallet. The empirical conversion reserve is not proof for arbitrary router code. Retain returned `planned.mode` and check `planned.assessment.ready`, not removed simulation/proof fields.

| Offering | Choose it for | Guide |
| --- | --- | --- |
| Canonical Abyss | STANDARD / STANDARD_ORACLE / QUOTE / QUOTE_ORACLE pools | [Choose an offering](docs/launch-lifecycle.md#choose-an-offering) |
| Fixed V4 | One hook per pool, fixed hook fee, optional LP fee | [Build the plan](docs/launch-lifecycle.md#build-the-plan) |
| Dynamic V4 | Oracle-velocity hook fee between your minimum and maximum; LP fee 0 | [Fee configuration](docs/reference.md#pool-bound-v4-version-6) |
| HMM V2 | Fee-funded auxiliary bids/asks; LP and developer fees 0 | [Configure HMM V2](docs/launch-lifecycle.md#configure-hmm-v2) |
| UFG | Quote-fee treasury and holder redemption; reward-free ERC20 only | [Launch a UFG treasury](docs/launch-lifecycle.md#launch-a-ufg-treasury) |
| Auto-compounding | Static/dynamic hook fees fund permanently locked full-range liquidity; LP and developer fees 0 | [Configure auto-compounding](docs/launch-lifecycle.md#configure-auto-compounding) |
| Raeto | Fixed/dynamic quote-fee sharing with Raeto; WETH/USDG only, 5/10/25/50/75% share, LP and developer fees 0 | [Configure Raeto](docs/launch-lifecycle.md#configure-raeto) |

The eleven launch wrappers do not launch HMM, UFG, auto-compounding, or Raeto. Start HMM/UFG integrations with
[`hmm-launch-config.ts`](examples/hmm-launch-config.ts) or [`ufg-launch-config.ts`](examples/ufg-launch-config.ts);
for auto-compounding/Raeto, use the typed config6 examples in the linked guides. Both now have measured launch capacity profiles. These are configuration paths, not deployment commands.

## Recover and integrate

After an interrupted send, inspect the saved transaction hash and use `--resume` on the original directory.
If markets are already active but publication failed, resume publication; do not deploy another token.
The runner saves artifacts under `launch-results/`; retain its owner-only recovery file.

- [Launch guide](docs/launch-lifecycle.md): pricing → planning → signing → publication → fees and recovery.
- [Runner reference](examples/README.md): environment, eleven cases, artifacts, and resume behavior.
- [SDK reference](docs/reference.md): addresses, codecs, limits, Nitro gas, and author APIs.
- [Gas and RPC evidence](docs/lifecycle-gas-profiles.md): native ceilings, deterministic capacity/chunk budgets, exact local buy math and0.15.1 migration.
- [Changelog](CHANGELOG.md) · [MIT license](LICENSE)
