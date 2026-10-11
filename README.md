![Abyss](https://raw.githubusercontent.com/abysshopper/black-market-node-sdk/main/assets/abyss-ziggurat-v3-pale-text-1500x500.png)

# Abyss TypeScript SDK

TypeScript SDK for token launches, swaps, and lending with [viem](https://viem.sh).
Import the public package as `@black-market/sdk`. Requires Node 24+ to run the examples.

## Install

Install the package with `pnpm add @black-market/sdk viem`, or use a checkout
to run and customize the examples:

```sh
git clone https://github.com/abysshopper/black-market-node-sdk.git
cd black-market-node-sdk
pnpm install --frozen-lockfile
pnpm build
```

## Examples

The most complete case is [`launch-erc20-dividends-multiquote-mixed.ts`](examples/launch-erc20-dividends-multiquote-mixed.ts).
On Robinhood mainnet (**chain 4663**), it:

1. Creates an ERC20 with 1,000,000 initial tokens and holder dividends.
   Fee-asset allocations split 40% to rewards and 60% to the owner, not a 40% tax.
2. Splits liquidity across V4/WETH (two positions), V4/USDG (two), and Abyss/WETH
   (three), priced from the same whole-supply USD valuation (default $5,000).
3. Funds one opening buy per market with 0.00001 ETH each by default. ETH wraps
   into WETH; USDG uses an admitted Kyber conversion. ETH for gas is additional.
4. Prepares and proves the complete staged plan, prints the economic review,
   and saves artifacts. The default dry-run never signs or submits anything.
5. With authorization, stages metadata, begins and prepares the markets, then
   activates all seven positions and three buys together. It verifies chain
   results and API publication; optional images are verified before submission.

### Configure and run

From the checkout root, create `.env` without overwriting existing configuration:

```sh
cp -n examples/.env.example .env
chmod 600 .env
```

Set `LAUNCH_API_URL` and exactly one key source: `PRIVATE_KEY`, or
`EXAMPLE_KEYSTORE_PATH` to an owner-only V3 scrypt keystore (`EXAMPLE_KEYSTORE_PASSWORD`
defaults to empty). Optional `RPC_URL` overrides the official chain4663 RPC.
Remote endpoints require HTTPS; existing environment values override `.env`.

```sh
# Dry run: no signing, chain submission, image upload, or publication.
node examples/launch-erc20-dividends-multiquote-mixed.ts
# Explicitly authorize spending funds and publishing; no confirmation prompt.
node examples/launch-erc20-dividends-multiquote-mixed.ts --broadcast
# After partial execution, replace this path with the ORIGINAL run directory.
node examples/launch-erc20-dividends-multiquote-mixed.ts --resume "launch-results/<original-run>"
```

Dry-run needs live RPC/API access, the creator key, funding, and admission.
Review the saved `economic-review.json` in `launch-results/`. Broadcast builds a
**fresh plan**; resume may spend/publish but retains the original plan and session.
Keep recovery files; never commit or share keys, private artifacts, or signed bytes.

## Creating your own

Copy the case wrapper beside its helpers, then customize it:

```sh
cp examples/launch-erc20-dividends-multiquote-mixed.ts examples/launch-my-token.ts
node examples/launch-my-token.ts
```

Edit the object passed to `runLaunchExample`: unique `id`, `tokenKind`
(0 ERC20 / 1 ERC404), `rewardMode` (0 none / 1 staking / 2 dividends),
`mode` (`atomic` / `staged`), `markets` (`venue`, `quote`, `positions`), and
`buysPerMarket`. Supported venues are `v4`/`abyss`, quotes `WETH`/`USDG`.
Customize identity, valuation, and buy input with the `EXAMPLE_*` keys in
[`.env.example`](examples/.env.example). For supply, fees, budgets, or ranges,
adapt `constructPlan` in `launch-example.ts` and `deriveExampleMarketEconomics`
in `launch-example-support.ts`. If copying elsewhere, include the Kyber helper too.

See the [launch/API guide](docs/launch-lifecycle.md), [runner configuration](examples/README.md),
and [MIT license](LICENSE) for deeper reference.
