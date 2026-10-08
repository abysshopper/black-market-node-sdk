![Abyss](https://raw.githubusercontent.com/abysshopper/black-market-node-sdk/main/assets/abyss-social.webp)

# Abyss TypeScript SDK

Token launches, swaps, and lending with [viem](https://viem.sh).

## Install

```sh
pnpm add @black-market/sdk viem
```

## Examples

Clone this repository to run the examples. Requires Node 24+.

```sh
pnpm install && pnpm build
node examples/quickstart.mjs
```

The quickstart reads available launch profiles without a wallet.

For token launches, set `PRIVATE_KEY` and `LAUNCH_API_URL` in your working
folder's `.env`. An optional `RPC_URL` overrides the default endpoint.
Run one example for the token you want to create:

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

Launch examples spend real funds and publish to your configured API.
Plans, transaction hashes, receipts, and errors are saved in `launch-results/`.
Keep `.env` and private recovery files out of Git.

The local, unpublished `0.7.0` candidate is a breaking lifecycle cutover.
`prepareAndPlanLifecycleLaunch` combines bound-hook preparation and complete admission;
`preparePoolBoundLifecyclePlan` and `PlannedLaunch.atomicAttempt` are removed.
Only the explicitly requested execution mode is simulated. Independent `planLaunch`,
recovery and build-next operations acquire fresh authority.

Known deployments/profiles/hooks ship as frozen construction presets selected by
typed keys without remote discovery. Explicit live discovery and unlisted profiles
remain supported. The current October8 mined graph supports pool-bound config6/V2
construction; historical config5 evidence is never reused or relabeled as that graph.
Creator minimum/maximum hook fees and upward-price sensitivity are independent
per-pool values frozen at launch. Optional `buySlippageBps` protects all ordered buys in one SDK
operation, returning only the final proved commitment. Pure transaction compilation
reports exact calldata sizes. Position recipes use Black Market's Early Scarcity,
Staircase and Smooth Ramp weights, widths and gaps with exact allocation maxima.
Position maxima sum to each market budget; market budgets sum to minted supply.
Actual mint-rounding residuals burn before buys, with no creator reserve.
Staircase can explicitly use adjacent shelf boundaries instead of source gaps;
this retains its weights and widths without zero-liquidity price jumps.
Only an explicit final-tail option extends the last band to the finite usable
protocol boundary; arbitrary equal-tick extrapolation is not a preset. See the API
guide for preset and admission scopes.

Lifecycle planning admits execution only after exact stateful proof. Robinhood
admission reads native Nitro compute/poster evidence; optional caller caps only
tighten it. Build-next can freshly prove an optional untrusted `reviewedTransaction`
without changing its exact gas/price, and separately preflight that immediate
envelope with an active `submissionClient`. Execution proof is not wallet submission.

[Example setup](https://github.com/abysshopper/black-market-node-sdk/tree/main/examples)
· [API guide](https://github.com/abysshopper/black-market-node-sdk/blob/main/docs/launch-lifecycle.md)
· [MIT license](https://github.com/abysshopper/black-market-node-sdk/blob/main/LICENSE)

[Agent guide](https://github.com/abysshopper/black-market-node-sdk/blob/main/AGENTS.md)
· [Skills](https://github.com/abysshopper/black-market-node-sdk/tree/main/.agents/skills)
