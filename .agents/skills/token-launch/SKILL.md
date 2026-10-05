---
name: token-launch
description: Run or adapt the Abyss TypeScript token-launch examples, including ERC20/ERC404, rewards, multiple markets, metadata publication, and failure recovery. Use before signing or broadcasting.
---

# Launch a token and publish its metadata

## Before execution

- Require explicit user authorization for real chain transactions and API writes.
- Read `examples/README.md`; choose one of the eight `launch-erc20-*` or
  `launch-erc404-*` files. Do not add flags or fixture requirements.
- Set `PRIVATE_KEY` and `LAUNCH_API_URL` through the user's environment or `.env`.
  Never overwrite an existing `.env`, print its values, or supply a development key.
- The wallet must be funded and match the selected deployment. `RPC_URL` is optional.
  The SDK needs complete simulation admission; inspect the guide if the provider
  cannot supply it. Never bypass a refusal or silently alter the case.

## Run or adapt

Basic example: `node examples/launch-erc20-v4.mjs`.
Complex NFT/dividend example: `node examples/launch-erc404-dividends-mixed.mjs`.

Each file supplies a fixed case to `launch-example.mjs`. Reuse that shared runner
and `launch-example-support.mjs` for local signing and durable artifacts. It uses
actual SDK plans, admitted envelopes, metadata sessions, activation receipts, and
published indexed DTOs. Preserve exact amounts, fees, ordered buys and markets.
API integration is required; a pending-indexing response is not success.

## Failures

Inspect the newest `launch-results/` run's `result.json`, `events.jsonl` and
`receipts.json`. A broadcast timeout may occur after acceptance: look up the saved
signed hash before further action. Do not launch a new token to recover API failure.
Raw signed bytes, signatures and capabilities stay in private recovery files.
Never retry broadcast, relaunch automatically, or claim an unobserved success.
