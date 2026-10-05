# Working with the Abyss TypeScript SDK

Read `README.md` first. This repository contains the public `@black-market/sdk`
package, runnable examples, and its tests.

## Skills

- `.agents/skills/sdk-usage/SKILL.md`: read protocol state and integrate public APIs.
- `.agents/skills/token-launch/SKILL.md`: run or adapt token-launch/API examples.

Read the relevant skill before working on those paths.

## Code and configuration

- Use Node 24+ and pnpm. Install with `pnpm install --frozen-lockfile`.
- Consumer code imports `@black-market/sdk`; source lives in `src/`.
- Keep TypeScript ESM imports and the existing `.js` relative-import suffixes.
- Use SDK address/ABI/client helpers; do not copy deployment addresses into apps.
- Select the intended chain explicitly. Use `bigint` for token amounts and fixed-point values.
- Keep launch cases independently runnable with one command and no arguments.
- Load secrets from the environment or an existing `.env`; never overwrite it.

## Wallet safety

- Reading/planning is not permission to spend funds or publish metadata.
- Run launch examples only when the user explicitly authorizes chain and API writes.
- Never add a default key, bypass admission, change a refused case, or silently skip the API.
- Keep signed hashes before broadcast and retain failure logs; never automatically relaunch.
- Do not commit `.env`, `launch-results/`, raw signed transactions, or recovery capabilities.

## Checks

- `pnpm test`: build and run the offline unit suite.
- `pnpm typecheck`: check the public TypeScript surface.
- `node examples/quickstart.mjs`: read-only live smoke after building.
- HTTP tests are opt-in: `pnpm test:api` and `pnpm test:api:write` need an actual
  disposable API/database; signed tests also need an explicitly supplied test key.

Update affected examples and docs with API changes. Keep the README short and
consumer-facing; put execution details in `docs/launch-lifecycle.md`.
