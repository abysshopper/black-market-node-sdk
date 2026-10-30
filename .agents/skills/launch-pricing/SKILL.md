---
name: launch-pricing
description: Price an Abyss launch from USD valuation, actual supply and quote decimals; fund exact one-sided ranges, protect ordered first buys, and integrate admitted Kyber conversion calldata inside lifecycle funding. Use before economic review or signing.
---

# Price the pools and make the opening purchase

Read `../sdk-usage/SKILL.md`, `../token-launch/SKILL.md` and
`docs/launch-lifecycle.md`. This skill prepares and reviews economics; it does not
authorize a wallet signature, API publication or broadcast. A correct first attempt
means proving the exact final commitment before sending, not guaranteeing future
market conditions or automatically retrying a refused launch.

## 1. Resolve price inputs and their provenance

- Record the target USD valuation, actual minted supply in raw launch-token units,
  each quote address/decimals, quote USD-X18 price, source and observation time.
  The project normally starts near $5,000; respect a different explicit target.
- **If you are an AI agent, look up the current quote-token USD price yourself.**
  Use CoinGecko, Dexscreener, web search or another reliable online market source.
  Do not ask whether the user wants pricing, make them choose a provider or require
  a particular API. Price lookup is part of preparing the launch.
- Match the actual token and chain, not just its ticker. Record source/time and
  validate decimals and positive price; compare liquid markets where relevant.
  A tokenized stock's underlying price or an assumed stablecoin peg is not enough.
  If no usable price can be found, explain the missing input before construction;
  never silently substitute zero, $1 or a 1:1 pool ratio.
- Explain stale/incomplete/manual valuation evidence without inventing a universal
  freshness cutoff. A construction USD estimate is not an on-chain lending oracle;
  do not make a lending Chainlink cutoff the only launch pricing path.
- Parse decimal USD inputs with exact decimal-to-X18 conversion, not Number/float.
  Read token decimals; the lifecycle launch-token recipe uses raw 18-decimal supply.

## 2. Price every market from total supply, not its allocation

Let `S` be total minted raw supply, `M` target USD-X18, `P` quote USD-X18,
`d` quote decimals, `Q = 2^96` and `R = sqrtPriceX96^2 / Q^2`.
`R` is **raw token1 per raw token0**, not human quote per launch token.

- If the launch token is token0: target raw ratio is `M * 10^d / (P * S)`.
- If the launch token is token1: invert that ratio.
- Whole-token quote per launch token also depends on both token decimals.
  `sqrtPriceX96 = 1n << 96n` means raw-unit parity, not a $5,000 valuation.

The historical helper name `launchedTokenIsQuote` means **launch token is token0**.
Derive it from the finalized predicted token address and quote address, not from
"quote-only fee mode". Predict with the actual core/factory; reevaluate after any
change that affects the token address. Lexicographic numeric address ordering
sets token0/token1, not input order or a checksum's letter case.

Call `deriveLaunchPoolRecipe` with explicit `supply`, per-market `tokenBudget`,
`pairedTokenDecimals`, `pairedTokenUsdPriceX18`, `targetMarketCapUsdX18`,
`launchedTokenIsQuote`, `fee` and `tickSpacing`. Supply determines price;
`tokenBudget` determines this pool's inventory/liquidity. For four pools allocated
25% each, every recipe still uses the full supply. Never divide the target FDV
or multiply an already whole-token valuation by the number of markets.
The helper's omitted-supply default is **one billion** tokens, not the lifecycle
example's one million. Never rely on that default for a lifecycle launch.

Reconstruct aligned opening FDV independently using integer arithmetic:

```text
launch is token0: FDVx18 = sqrtPriceX96^2 * S * P / (2^192 * 10^d)
launch is token1: FDVx18 = 2^192 * S * P / (sqrtPriceX96^2 * 10^d)
```

Use the actual aligned sqrt price, not the unrounded target. Review deviations
introduced by tick spacing. Multi-quote pools should imply approximately the same
USD token price using the recorded quote snapshots; pool FDVs are not additive.
Also report retained-supply FDV after expected inventory burn and the post-buy
valuation. Opening reference FDV, circulating market cap, pool TVL and funds raised
are different quantities.

## 3. Fund the requested shape, not arbitrary liquidity

- Market budgets sum exactly to minted supply. Position maxima sum exactly to each
  market budget. Floor allocations and place the integer remainder deterministically.
- For one position, use the recipe's range, liquidity and maximum. For multiple
  positions use `deriveLaunchPositionRanges` with the source preset, explicit count
  and per-pool budget. For continuous Staircase or Early Scarcity, explicitly choose
  `positionGaps: "adjacent"`; the final band extends to the protocol boundary by default.
- Custom bands need their exact price/range weights and budget-safe integer liquidity,
  not a fixed `1000e18`, arbitrary equal-tick extrapolation or a percentage reserve.
  Every initial position must require zero quote deposit in actual token order.
- A forward tail ends at the finite spacing-aligned protocol boundary, not infinity.
  Its allocation is part of the budget, not extra inventory. Do not use the boundary
  endpoint itself as an exclusive router price limit.
- Review canonical rounded LP debits, all residual burn and retained supply. The
  current contracts permit materially undersized positions and burn the remainder:
  budget equality does not prove full-supply LP consumption. A dead-address transfer
  is not the enforced `burn()` policy. Never hide material burn as "rounding dust".
- At an upper-bound token1 opening, reported initial active liquidity can be zero
  until the first downward swap crosses the tick. Check reachable buy-side bands,
  not only the instantaneous opening-liquidity number.

### Read-only arithmetic example

This is an explicit $1, 6-decimal **fixture**, not a live price or executable plan.
Run as an ESM script with the package installed. No RPC, wallet or secret is needed.

```js
import { deriveLaunchPoolRecipe, deriveLaunchPositionRanges } from "@black-market/sdk";
const WAD = 10n ** 18n;
const supply = 1_000_000n * WAD;
const recipe = deriveLaunchPoolRecipe({
  pairedTokenDecimals: 6, pairedTokenUsdPriceX18: WAD,
  targetMarketCapUsdX18: 5_000n * WAD,
  launchedTokenIsQuote: true, fee: 3000, tickSpacing: 60,
  supply, tokenBudget: supply / 2n,
});
const bands = deriveLaunchPositionRanges({
  launchSqrtPriceX96: recipe.launchSqrtPriceX96,
  launchedTokenIsQuote: true, tokenBudget: supply / 2n,
  tickSpacing: 60, venue: "uniswap-v4", distributionPreset: "staircase",
  positionCount: 5, positionGaps: "adjacent",
});
const fdvX18 = recipe.launchSqrtPriceX96 ** 2n * supply * WAD
  / ((1n << 192n) * 10n ** 6n);
console.log({ fdvX18: fdvX18.toString(), bands: bands.positions });
```

## 4. Protect the actual ordered opening buys

1. Commit each buy's `marketIndex`, quote input cap, recipient, minimum token output
   and price guard. The quote is the market's quote. Current fixed examples pay
   native ETH through admitted Kyber Swap funding for every quote, including WETH;
   NativeWrap/direct funding remain SDK choices outside those fixed cases.
2. `estimateLaunchInitialBuy` is only a pure fresh-single-position preview. It does
   not model multi-band traversal, earlier buys, hook/token effects or funding routes.
   Its reported paired input is not proof of actual partial-fill spend. Use the
   covered exact ordered curve model or native calibration for executable minima.
3. `deriveLaunchBuySqrtPriceLimitX96` provides a directional exclusive price guard;
   this is separate from output slippage. On a multi-band or sizable buy, an overly
   tight guard can stop execution early. Review partial fills and retained quote.
4. For an unstarted launch, use `prepareAndPlanLifecycleLaunch` with explicit
   `buySlippageBps`. Covered templates use exact local ordered curve math; unknown
   coverage refuses rather than executing a diagnostic launch. Each minimum is
   `floor(output * (10000 - bps) / 10000)`. Planning and build-next never execute
   conversion or activation calldata. Atomic capacity includes an empirical2M
   compute reserve per Swap before padding, not arbitrary-router execution proof.
   Omission preserves minima. Each executable minimum must be positive. If flooring
   produces zero, refuse or resize/review the buy; never silently substitute `1`.
5. A desired percentage purchase is a sizing objective: use estimates for a candidate,
   then verify actual net output against retained supply, all fees and earlier buys.
   Do not equate $250/$5,000 with buying exactly 5% of supply along an AMM curve.
6. Freeze the returned plan/hash and review conversion floor, available escrow per
   quote, each net buy output/spend, unused-input/quote refunds and gas/data costs.
   Sign only the freshly checked immediate envelope, without repadding its reviewed
   gas/price. After submission, never regenerate minima, salts or economics.

## 5. Kyber calldata funds the launch; it does not replace the opening buy

Supported sequence:

```text
creator native ETH / admitted ERC20
  -> funding escrow calls admitted Kyber target
  -> measured quote output credited to this launch
  -> core activates: LP mints, inventory burn, committed direct venue buys
  -> unused quote/input refunded; markets open; token Active
```

The SDK supports NativeWrap for direct ETH/WETH and ERC20 funding for direct quote
payment. The current fixed examples deliberately use `LifecycleFundingKind.Swap`
with native input for all quotes; conversion refusal never authorizes fallback.
For admitted conversion, use:

| AssetFundingV1 field | Meaning |
| --- | --- |
| `asset` | This row's ERC20 output quote. |
| `amount` | Minimum newly measured output, sufficient for all that quote's buys. |
| `inputAsset` | Actual input ERC20, or zero address for native ETH. |
| `inputAmount` | Exact authorized raw input, not estimated output. |
| `target` | Registered router target with matching enabled runtime/spender binding. |
| `data` | Exact executable conversion calldata, not a route preview or launch buy. |

Before requesting a build, read `registry.fundingTarget(target)` on the **selected**
graph: enabled, spender and runtime must match. Non-native conversion inputs also
need `fundingInputAllowed(inputAsset)`; direct same-token funding does not. Old
registry admission does not transfer to a fresh registry. Missing admission is an
admin prerequisite, not evidence of bad output-token liquidity or permission to
register a router, bypass validation or execute a separate wallet swap.

Use the operator's Abyss API build boundary:
`POST /api/v1/quote/kyber/build?chainId=4663`. Body fields are `tokenIn`, `tokenOut`,
`amountIn` (decimal string), `sender`, `recipient`, `slippageBps` and `deadline`
(decimal unix seconds). Set **sender and recipient to the funding escrow**, not
creator/core/legacy executor. The API normalizes zero-address native identity;
current HTTP slippage is 1..2000 bps and deadline is future, at most three hours.
Do not confuse that limit with lifecycle ordered-buy slippage's 0..9999 domain.

The build obtains its own fresh route; GET `/api/v1/quote/kyber` is preview only.
Validate returned chain/tokens/input/value, router and recognized calldata bindings,
`expiresAt`, `amountOutMinimum`, route/impact and input budget. Unknown impact is
unknown, not zero. Preserve the exact returned bytes. Map `transaction.to` to
`target`, `transaction.data` to `data`, and output floor to `amount`; require floor
>= the sum of committed buys in that quote. Native outer launch value sums native
funding inputs; ERC20 conversion has zero inner native value.

The creator approves the **escrow**, not the core/router, for ERC20 input. Escrow
sets and clears its own allowance to the registered spender. NativeWrap uses
`inputAsset == asset == wrappedNative`, `inputAmount == amount`, zero target/data;
Swap with native input uses zero `inputAsset`. They are not interchangeable shapes.
Funding rows are unique/sorted by output asset: aggregate buys sharing a quote and
do not insert duplicate conversion rows or assume one build yields many quotes.

Get executable calldata late enough to avoid expiry, then review the complete
selected-mode launch, conversion floors, buys and deterministic capacity budget.
The SDK does not simulate the router; output floors and deadlines remain on-chain
guards, and a ready assessment is not execution proof. If the quote changes
before submission, rebuild/review the unstarted commitment; if already started,
recover its exact plan rather than refreshing opaque funding bytes. An expired
staged conversion can require cancellation, not mutation of the committed plan.
Do not ask Kyber to buy the predicted inactive token: its pool does not exist/publicly
trade yet. A post-activation wallet Kyber swap is a separate transaction with separate
balances, approvals and authorization; do not substitute it for an atomic first buy.

Source/evidence map: `../token-launch/references/audit-history.md`.
