---
name: sdk-usage
description: Use the Abyss TypeScript SDK to read protocol state, build unsigned launch plans, or integrate swaps and lending in a consumer application.
---

# Use the TypeScript SDK

1. Read `README.md` and install `@black-market/sdk` plus `viem` in the consumer.
2. Import public exports from `@black-market/sdk`; use `@black-market/sdk/lifecycle`
   when only the deployment-independent launch APIs are needed.
3. Create a client with `createProtocolPublicClient({ chainId: 4663 })` and resolve
   contracts with `getAddresses(4663)`. Configure another chain explicitly if intended.
4. For launch discovery, call `readLifecycleProfiles({ client, orchestrator })`.
   Inspect returned admission and terms rather than inventing a profile configuration.
5. Use `bigint` and explicit token decimals. Reuse SDK ABIs and viem types.
6. Keep wallet submission separate from reads and unsigned planning.

Runnable read-only example: `node examples/quickstart.mjs` after the repository build.
Swap/lending entrypoints are exported through `src/index.ts`; inspect their existing
implementations and types before adding a wrapper.

For launch execution, read the sibling `token-launch/SKILL.md`. For API shapes and
recovery details, read `docs/launch-lifecycle.md`. Validate repository edits with
`pnpm test` and `pnpm typecheck`; exercise the changed consumer path without writes
unless the user has explicitly authorized them.
