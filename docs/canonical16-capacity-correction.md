# Conservative activation-capacity proposal for issue #21

This proposal does not enable a sixteen-market launch or establish its failure's exact cause. It restores earlier per-market allowances while wider native calibration remains outstanding.

## Evidence and limits

- Baseline SDK: `cedf9587767f2da2b63041fd5bf5e29eeebeed86`.
- Public reproduction: https://github.com/abysshopper/black-market-node-sdk/issues/21
- Unchanged unsigned fixture: https://gist.github.com/How1337ItIs/daf1bec51f78b821297ce60a00bb578c ; SHA256 `547b928cf2eac4b30493018486805bba0b7d72b32b4f1233c5357dd9bc10878f`.
- The fixture has seven V4 and nine Abyss markets, sixteen positions, eight fee assets and no opening buys, NFT, rewards, HMM or compounding.
- The native reproduction completes preparation, then returns an empty activation revert after reporting 31,991,297 gas under a 32M envelope. This alone does not prove out-of-gas as the sole cause or measure a minimum successful envelope.
- A directory out-of-gas trace belongs to a different richer-token captured-state diagnostic; it is not exact attribution for this plain-ERC20 fixture. Synthetic balance is mechanics-only evidence, not affordability.

## Proposed policy

The v3 change `0b29ca26bb73c2cece0af47f239ce34a8c7266cf` halved per-market allowances. Restore the earlier Abyss1M/V40.5M allowances, retain current position costs and padding, and version the model as capacity-v4. The fixture's model output changes from29,571,520 to37,384,020 before poster allocation, so existing capacity checks refuse it before begin. These are model outputs, not execution measurements.

This is a conservative policy proposal, not a proven causal repair or universal gas upper bound. It applies to other market shapes too and may refuse working plans. Successful breadth calibration and maintainer review remain necessary. No live-execution fallback, altered gas ceiling, market-count blacklist or economic change is introduced. Activation remains indivisible.

## Reproduction

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
node --import ./test/register-typescript.mjs --test test/lifecycle-canonical16.test.mjs test/lifecycle-execution.test.mjs
pnpm test
```

Focused checks:41 passed, including exact-fixture `ready:false`, `ACTIVATION_GAS_LIMIT` and build-next refusal without execution RPCs. The new numeric regression failed against the prior model before implementation.

Windows full-suite comparison: untouched baseline479tests/436pass/42fail/1skip; proposed final481tests/438pass/42fail/1skip. The42 distinct failing test names match exactly. This is not a green full suite; existing failures include permissions, recovery-file checks and path quoting. No new public native activation or production release is established by these offline checks.
