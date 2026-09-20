# Examples

Runnable ESM scripts that exercise the real `@black-market/sdk` API. Historical examples never sign or broadcast. `launch.mjs` lists its valid launch matrix by default, simulates without signing, and runs the API metadata/image/publish lifecycle as part of its one explicit `--execute` operation.

| Script | Shows |
| ------ | ----- |
| `quickstart.mjs` | Offline canonical addresses, templates, recipe derivation, initial-buy estimate, calldata and formatting helpers |
| `abby-launch.mjs` | Exact reconstruction of the successful Robinhood mainnet Abby launch from transaction calldata |
| `launch.mjs` | Current Unified Launcher examples: all template/profile/fee-split presets on Abyss and Uniswap V4 V3 |

## Running

Examples import the built package output (`../dist/index.js`) the same way a consumer imports `@black-market/sdk`, so build first:

```sh
pnpm build
node examples/quickstart.mjs
```

or run the offline quickstart through the package script:

```sh
pnpm examples
```

## Current launch runner
List the 18 valid 1% fee presets (each supports `abyss` and `uniswap-v4-v3`):

```sh
node examples/launch.mjs
```

Simulate a unique, no-initial-buy launch without signing or broadcasting:

```sh
RPC_URL=https://rpc.mainnet.chain.robinhood.com \
node examples/launch.mjs --simulate \
  --creator 0xYOUR_ADDRESS \
  --case quote-staking-owner \
  --route uniswap-v4-v3 \
  --paired-token 0xPAIRED_TOKEN \
  --paired-decimals 18 \
  --paired-usd-x18 1000000000000000000
```
`--execute` is one linear operation: it signs attribution, creates the API session, optionally uploads and verifies an image, submits the Unified Launcher transaction, waits for a successful receipt, then publishes that transaction to the API session. It requires `PRIVATE_KEY`; the Robinhood mainnet RPC is the default. A failure after transaction submission retains the printed transaction hash and API session state for recovery, but never silently submits another launch.

## Verified APIBurnToken launch

The runner created and published this current `uniswap-v4-v3` launch on Robinhood Chain mainnet:

| Field | Value |
| --- | --- |
| Token | [`0x02cd85fd3de913a06962afe41e0997c93feb9178`](https://robinhoodchain.blockscout.com/address/0x02cd85fd3de913a06962afe41e0997c93feb9178) |
| Transaction | [`0x52673e85019787d8ab67256027b8c675eff75aa6c1e4d2f772b9e8c36aa6edcd`](https://robinhoodchain.blockscout.com/tx/0x52673e85019787d8ab67256027b8c675eff75aa6c1e4d2f772b9e8c36aa6edcd) |
| Route | Active `uniswap-v4-v3` adapter from the schema-/2 launcher stack |
| Token/pool | Burnable fee-burn template, Lighthouse profile, 5% fee tier |
| Initial buy | 0.0025 WETH, wrapped and approved exactly by the runner |
| API state | Published as `optimistic`; image validated as JPEG, 941 × 941 |

If publication returns `awaiting_indexer` after a confirmed transaction, do not invoke `--execute` again. Resume only the existing API publication:

```sh
node examples/launch.mjs --resume-publish \
  --session SESSION_ID --capability SESSION_CAPABILITY \
  --transaction 0xCONFIRMED_TRANSACTION_HASH
```

The recovery command never signs, wraps, approves, uploads, or submits another on-chain launch.

Lighthouse is the QuoteOracle profile. The dual templates are protocol-limited to Beacon, so their 1% companion pools cannot be Lighthouse. Current token deployer capabilities also permit either burnable or holder-dividend tokens for Standard, Quote Staking, Dual Staking, and Fee Burn; the dividend templates remain holder-dividend only.