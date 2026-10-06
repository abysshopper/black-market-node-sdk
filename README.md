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

Lifecycle planning proves exact stateful execution without requiring a policy service.
Robinhood admission reads native Nitro compute/poster evidence; optional caller caps
only tighten it. Build-next can separately preflight the immediate unsigned envelope
with an active `submissionClient`. Execution proof is not guaranteed wallet submission.

[Example setup](https://github.com/abysshopper/black-market-node-sdk/tree/main/examples)
· [API guide](https://github.com/abysshopper/black-market-node-sdk/blob/main/docs/launch-lifecycle.md)
· [MIT license](https://github.com/abysshopper/black-market-node-sdk/blob/main/LICENSE)

[Agent guide](https://github.com/abysshopper/black-market-node-sdk/blob/main/AGENTS.md)
· [Skills](https://github.com/abysshopper/black-market-node-sdk/tree/main/.agents/skills)
