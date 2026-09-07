# Examples

Runnable ESM scripts that exercise the real `@black-market/sdk` API. Neither script signs or broadcasts a transaction.

| Script | Shows |
| ------ | ----- |
| `quickstart.mjs` | Offline canonical addresses, templates, recipe derivation, initial-buy estimate, calldata and formatting helpers |
| `abby-launch.mjs` | Exact reconstruction of the successful Robinhood mainnet Abby launch from transaction calldata |

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
