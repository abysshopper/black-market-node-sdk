# Launch a token with the TypeScript SDK

Use SDK **0.16.0** on Robinhood Chain mainnet (**4663**). For a first launch, run
[`launch-erc20-abyss.ts`](../examples/launch-erc20-abyss.ts): one market, one position,
one buy. [Runner setup](../examples/README.md) covers its environment and commands.
This guide explains the economics and the public APIs for your own integration.

## Choose an offering

Choose the token behavior, fee destination, and pool implementation separately.
`LifecycleTokenKind` selects ERC20 or ERC404; `LifecycleRewardMode` selects none,
staking, or dividends. A pool profile selects the admitted venue/hook implementation.

| Offering | `KnownLifecycleProfile` keys | Fee behavior / restrictions |
| --- | --- | --- |
| Canonical Abyss | `Abyss0`, `Abyss1`, `Abyss2`, `Abyss3` | STANDARD, STANDARD_ORACLE, QUOTE, QUOTE_ORACLE respectively; config1. |
| Fixed V4 | `V4FixedFeePool` | One bound hook per pool; fixed `hookFeePips`, optional LP fee. |
| Dynamic V4 | `V4DynamicFeePool` | Oracle-velocity fee between minimum and maximum; LP and developer fees 0. |
| HMM V2 | `V4HmmFixedPool`, `V4HmmDynamicPool` | Auxiliary fee-funded bids/asks; LP and developer fees 0; explicit risk guards. |
| UFG | Abyss QUOTE/QUOTE_ORACLE or `V4UfgFixedPool`, `V4UfgDynamicPool` | Treasury route; ERC20 without rewards; quote-only fees, executor bounty 0. |
| Auto-compounding | `V4AutoCompoundStaticPool`, `V4AutoCompoundDynamicPool` | Net hook fees fund permanently locked full-range liquidity; both fee modes; LP and developer fees 0. |
| Raeto | `V4RaetoFixedPool`, `V4RaetoDynamicPool` | QuoteOnly WETH/USDG; Raeto share 5/10/25/50/75%; LP and developer fees 0. |

SDK presets are the source of supported profiles and deployment wiring. Profiles
registered after this release appear with a subsequent SDK update.
This local snippet lists the release's supported offerings without RPC reads:

```ts
import {
  getAddresses, listKnownLifecycleProfiles,
} from "@black-market/sdk";

const profiles = listKnownLifecycleProfiles({
  chainId: 4663, orchestrator: getAddresses(4663).launchOrchestrator,
});
console.table(profiles.map(({ profile: p }) => ({
  id: p.id, venue: p.venueKind, version: p.topology.configVersion,
})));
```

`readLifecycleProfiles` remains available for explicit registry inspection, not
as a planning prerequisite. Select the exact preset ID, schema, terms, treasury,
and dependency graph. For V4, permit at most **one market per quote asset** across all hooks/fees; combine positions in that market.
An Abyss market can share the same quote. Oracle-enabled does not mean lending-approved.

<a id="deployed-infrastructure"></a>
[Deployment addresses](reference.md#deployed-infrastructure), [fee tiers](reference.md#choose-a-fee-tier),
and [config6 fields](reference.md#pool-bound-v4-version-6) are in the reference.

## Price the launch

Choose supply and a whole-supply opening valuation (FDV):

```text
FDV in USD = price per token in USD × total minted token supply
quote per token = target FDV in USD ÷ token supply ÷ quote USD price
```

**1,000,000 tokens at $5,000 FDV = $0.005/token.** At an illustrative WETH price
of $2,486.49, that is about **0.00000201 WETH/token**. FDV is not cash raised or
quote deposited: the initial positions hold launch tokens only.
The SDK examples default to $5,000; the app defaults to $15,000. Neither number is
a recommendation or an anti-sniper guarantee. Compare the buyer's actual trade size.

### Account for decimals and address order

Let `q` be human quote units per launch token, `dQ` quote decimals, and `dL` launch
token decimals (18 for these recipes). The smaller numeric address is token0.
The helper's confusing `launchedTokenIsQuote: true` means **launch token is token0**.
Determine it from `BigInt(predictedToken) < BigInt(quoteAddress)`.

| Launch-token order | Raw token1/token0 ratio | $0.005, 6-decimal quote, 18-decimal token |
| --- | --- | --- |
| token0 | `q × 10^(dQ-dL)` | `5 × 10^-15` |
| token1 | `1 / (q × 10^(dQ-dL))` | `2 × 10^14` |

Before tick alignment, `sqrtPriceX96 = floor(sqrt(raw ratio) × 2^96)`.
`1n << 96n` means raw-unit parity, not a dollar price. Keep integer amounts as
`bigint`; parse display amounts with viem `parseUnits`, not floating-point arithmetic.

### Derive and display the aligned opening

Pricing helpers are imported from the **package root**, not `/lifecycle`.
Run this pure example with no wallet or RPC. It prices the full 1M supply while
allocating 500,000 tokens to this pool; the other half could fund a second pool.
The $1 six-decimal quote here is an arithmetic input, not a live price lookup.

```ts
import { deriveLaunchPoolRecipe } from "@black-market/sdk";
import { formatUnits } from "viem";

const WAD = 10n ** 18n;
const supply = 1_000_000n * WAD;
for (const launchedTokenIsQuote of [true, false]) {
  const r = deriveLaunchPoolRecipe({
    pairedTokenDecimals: 6, pairedTokenUsdPriceX18: WAD,
    targetMarketCapUsdX18: 5_000n * WAD,
    launchedTokenIsQuote, fee: 3000, tickSpacing: 60,
    supply, tokenBudget: supply / 2n,
  });
  const squared = r.launchSqrtPriceX96 ** 2n;
  const fdvX18 = launchedTokenIsQuote
    ? squared * supply * WAD / ((1n << 192n) * 10n ** 6n)
    : (1n << 192n) * supply * WAD / (squared * 10n ** 6n);
  console.log({
    launchedTokenIsQuote, tick: r.launchTick,
    sqrtPriceX96: r.launchSqrtPriceX96.toString(),
    range: [r.tickLower, r.tickUpper], liquidity: r.liquidity.toString(),
    alignedFdvUsd: formatUnits(fdvX18, 18),
  });
}
```

Output for the inputs above (raw integers except FDV):

| Launch order | Tick | `sqrtPriceX96` | Range | Liquidity | Aligned FDV (USD) |
| --- | --- | --- | --- | --- | --- |
| token0 (`true`) | -329280 | `5610644101265567582035` | [-329280, 887220] | `35408142276778286` | 5014.946157970295405007 |
| token1 (`false`) | 329280 | `1118784514236214582089729076342544510` | [-887220, 329280] | `35408142276778286` | 5014.946157970295405007 |

Tick spacing rounds the intended opening. Show the aligned FDV before signing;
use the actual quote/USD snapshot and actual predicted token orientation.
Always pass `supply`: the helper's omitted-supply default is **one billion** tokens,
not the runner's one million. `tokenBudget` changes depth, not whole-supply price.

### Split inventory across pools and ranges

Choose **one valuation**, then split token supply among pools. Each pool translates
that valuation using its quote's decimals and USD price. Two pools each priced at
$5,000 FDV still describe one $5,000 token valuation; their FDVs are not additive.
Less inventory at the same opening price means less depth.

Start with the recipe's single range. For multiple bands, `deriveLaunchPositionRanges`
supports `early-scarcity`, `staircase`, and `smooth-ramp` via `distributionPreset`.
The app's Single range / Even spread / Layered / Higher ground choices are separate
app presets. This pure SDK example creates four adjacent Early Scarcity bands:

```ts
import { deriveLaunchPoolRecipe, deriveLaunchPositionRanges } from "@black-market/sdk";

const budget = 500_000n * 10n ** 18n;
const recipe = deriveLaunchPoolRecipe({
  pairedTokenDecimals: 6, pairedTokenUsdPriceX18: 10n ** 18n,
  targetMarketCapUsdX18: 5_000n * 10n ** 18n,
  launchedTokenIsQuote: true, fee: 3000,
  supply: 1_000_000n * 10n ** 18n, tokenBudget: budget,
});
const ranges = deriveLaunchPositionRanges({
  launchSqrtPriceX96: recipe.launchSqrtPriceX96,
  launchedTokenIsQuote: true, tokenBudget: budget, tickSpacing: 60,
  venue: "uniswap-v4", distributionPreset: "early-scarcity",
  positionCount: 4, positionGaps: "adjacent",
});
console.table(ranges.positions.map((p) => ({
  lower: p.tickLower, upper: p.tickUpper, bps: p.inventoryBps,
  cap: p.maxTokenAmount.toString(),
})));
console.log("expected mint dust burned:", ranges.unspentTokenAmount.toString());
```

The returned raw caps and ticks are:

| Range | Inventory bps | Token cap (18-decimal raw units) |
| --- | --- | --- |
| [-329280, -328920] | 366 | `18300000000000000000000` |
| [-328920, -328140] | 975 | `48750000000000000000000` |
| [-328140, -327000] | 2805 | `140250000000000000000000` |
| [-327000, 887220] | 5854 | `292700000000000000000000` |

The expected mint dust burned is **6,401,491 raw units** (0.000000000006401491 tokens).

The inventory weights are **3.66% / 9.75% / 28.05% / 58.54%** of this pool's budget.
Use `positionGaps: "adjacent"` for default continuous planner admission; Early
Scarcity and Staircase otherwise preserve source gaps. Smooth Ramp is always adjacent.
The final band reaches the spacing-aligned protocol boundary by default.
Coverage must run continuously from opening to a funded permanent tail in **each** pool.

Market budgets sum exactly to minted supply; position caps sum exactly to their
market budget. Actual integer mint debits may be lower. Every unused launch token
is **burned before opening buys**, not held as a creator reserve. Inspect material
burn separately from small rounding dust. Tail allocation is part of the budget.
At a token1 opening, active liquidity may be zero until the first downward swap
crosses the opening upper tick; inspect reachable buy-side liquidity too.

### Protect the opening buy

Show estimated **tokens and share of supply**, quote spent, fees, and final marginal
price. A 0.00001 ETH smoke buy bought about 4.9 tokens out of 1M in recorded fixed-V4
examples; it does not predict the impact of a $100 or $1,000 buy.
A larger buy traverses ranges and can acquire a large share of supply.

`prepareAndPlanLifecycleLaunch({ buySlippageBps: 50 })` derives every ordered buy's
minimum from the covered exact local curve model or native diagnostic output:

```text
minTokenOut = floor(tokenOut × (10000 - buySlippageBps) / 10000)
50 bps: floor(tokenOut × 9950 / 10000)
```

Native calibration requires activation in the complete executed sequence. The
option accepts 0–9,999 bps and applies only before begin; omission preserves minima.
A 1-wei minimum is effectively unprotected. Never submit the diagnostic draft.
A Kyber conversion minimum protects ETH→quote output, not quote→launch-token output.

`deriveLaunchBuySqrtPriceLimitX96` is a separate, directional **marginal-price guard**.
Its `slippageBps` accepts 1–9,999 (default 50). It may stop a buy early; check partial
fills and refunds. It does not calculate minimum token output.
`estimateLaunchInitialBuy` is a pure single-position estimate, not a model of
multi-band traversal, prior buys, or hook execution. Use the ordered model or native calibration.
Final valuation uses the retained supply after burn and the observed post-buy price.

## Build the plan

For a complete wrapper, use [`launch-erc20-abyss.ts`](../examples/launch-erc20-abyss.ts).
For your own application, this function builds and prepares one market: 1M ERC20 supply,
Abyss QUOTE_ORACLE, 0.30% fee, one position, and a 0.00001 ETH native-wrap buy.
Pass a current WETH/USD-X18 price as `wethUsdPriceX18`. It reads and simulates, without signing.
The caller chooses `name` and `symbol`; keep API metadata identical to these fields.

```ts
import { randomBytes } from "node:crypto";
import { toHex, zeroAddress, type Address, type PublicClient } from "viem";
import {
  deriveLaunchPoolRecipe, deriveLaunchBuySqrtPriceLimitX96,
  encodeAbyssLifecycleMarketConfig, getAddresses, getKnownLifecycleProfile,
  KnownLifecycleProfile, LAUNCH_ORACLE_CONFIG_ID, LifecycleFundingKind,
  LifecycleRewardMode, LifecycleTokenKind, predictLifecycleToken,
  prepareAndPlanLifecycleLaunch, readLifecycleProfiles, type LaunchPlanV1, type PlannedLaunch,
} from "@black-market/sdk";

export async function prepareOneMarketLaunch(
  client: PublicClient, principal: Address, wethUsdPriceX18: bigint,
  name: string, symbol: string,
): Promise<PlannedLaunch> {
  if (await client.getChainId() !== 4663) throw new Error("Wrong RPC chain");
  const { launchOrchestrator: orchestrator, weth } = getAddresses(4663);
  const preset = getKnownLifecycleProfile({
    chainId: 4663, orchestrator, key: KnownLifecycleProfile.Abyss3,
  });
  if (!preset) throw new Error("Unknown deployment");
  const [profile] = await readLifecycleProfiles({
    client, orchestrator, profileIds: [preset.profile.id],
  });
  if (!profile?.admitted) throw new Error(profile?.reason ?? "Profile unavailable");
  const supply = 1_000_000n * 10n ** 18n;
  const buy = 10_000_000_000_000n;
  const draft: LaunchPlanV1 = {
    chainId: 4663n, orchestrator, creator: principal,
    nonce: BigInt(toHex(randomBytes(32))),
    token: {
      kind: LifecycleTokenKind.ERC20, rewardMode: LifecycleRewardMode.None,
      name, symbol, supply, nftUnit: 0n, metadataURI: "",
      salt: toHex(randomBytes(32)), inventoryRecipient: principal, burnOnCancel: false,
    },
    funding: [], feeAssets: [], markets: [], buys: [],
    deadline: BigInt(Math.floor(Date.now() / 1000)) + 3600n, executorFeeBps: 275,
  };
  const token = await predictLifecycleToken({ client, plan: draft });
  const token0 = BigInt(token) < BigInt(weth);
  const r = deriveLaunchPoolRecipe({
    pairedTokenDecimals: 18, pairedTokenUsdPriceX18: wethUsdPriceX18,
    targetMarketCapUsdX18: 5_000n * 10n ** 18n,
    launchedTokenIsQuote: token0, fee: 3000, supply, tokenBudget: supply,
  });
  const plan: LaunchPlanV1 = {
    ...draft,
    funding: [{ asset: weth, amount: buy, kind: LifecycleFundingKind.NativeWrap,
      inputAsset: weth, inputAmount: buy, target: zeroAddress, data: "0x" }],
    feeAssets: [token, weth].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1)
      .map((asset) => ({ asset, ownerBps: 10000, rewardsBps: 0, burnBps: 0 })),
    markets: [{ adapterId: profile.registration.adapterId, profileId: profile.id,
      quoteAsset: weth, tokenBudget: supply, configVersion: 1,
      config: encodeAbyssLifecycleMarketConfig({
        profile: 3, fee: 3000, oracleConfigId: LAUNCH_ORACLE_CONFIG_ID,
        openingSqrtPriceX96: r.launchSqrtPriceX96,
        positions: [{ tickLower: r.tickLower, tickUpper: r.tickUpper,
          liquidity: r.liquidity, tokenAmountMaximum: supply }],
      }) }],
    buys: [{ marketIndex: 0, quoteAmountIn: buy, minTokenOut: 1n,
      recipient: principal, sqrtPriceLimitX96: deriveLaunchBuySqrtPriceLimitX96({
        launchSqrtPriceX96: r.launchSqrtPriceX96, launchedTokenIsQuote: token0,
      }) }],
  };
  return prepareAndPlanLifecycleLaunch({
    client, account: principal, plan, mode: "atomic", buySlippageBps: 50,
  });
}
```

The draft's `minTokenOut: 1n` is diagnostic. The function calls
`prepareAndPlanLifecycleLaunch` with `buySlippageBps: 50` and returns the final
protected plan. Token prediction uses core/creator/nonce/token configuration, so
the predicted token can enter sorted fee assets without a circular market-config hash.
`executorFeeBps: 275` matches the example runner: 2.75% of newly collected fees
goes to whoever calls `claimAndSplit()`. It is not charged to traders. Use 0 for none.

<a id="pool-bound-v4-version-6"></a>
For V4, use `encodePoolBoundV4LifecycleMarketConfig` with explicit `version: 6`,
all three hook-fee fields, selected oracle, external-liquidity policy, sorted fee
assets, positions, and the chosen profile's treasury/terms. A draft `hookSalt` is
finalized by `prepareAndPlanLifecycleLaunch`; freeze economics before mining.
[Config6 reference](reference.md#pool-bound-v4-version-6) describes fixed vs dynamic fees.

**Direct-core funding:** creator, payer, and refund recipient are the same address.
ERC20 inputs approve the core's `fundingEscrow`, not the core or router. Native
WETH buys use `NativeWrap`; other quotes can use admitted Kyber conversion, or be
funded directly as ERC20. Gas ETH is extra. [UFG](#launch-a-ufg-treasury) instead
uses a proxy creator, principal payer/refund recipient, and proxy approvals.

The wrappers set the plan deadline to **now + 3,600 seconds**. A Kyber conversion
uses **now + 300 seconds**, at most 1,200 seconds and never beyond plan expiry.
Staging can outlive the conversion even while the plan is valid. Do not edit a
saved deadline or replace committed conversion bytes after begin.

## Prepare and simulate

| Mode | Transactions after any approvals | Choose when |
| --- | --- | --- |
| `atomic` | One transaction creates, prepares, mints, locks, buys, and opens. | The exact full launch fits the execution envelope. |
| `staged` | Begin → prepare batches → one activation that mints, locks, buys, and opens all markets. | Preparation needs separate transactions. |

Staging is not rollback. A begun plan remains begun after its deadline until cancelled.
Activation cannot be split into separate position mints or buys.
An atomic request is a preference: conservative capacity bounds or an actual atomic capacity failure may select staged. Explicit staged stays staged. No markets or buys are removed. Review and persist returned `planned.mode`.

| Operation | Options type / purpose |
| --- | --- |
| `prepareAndPlanLifecycleLaunch` | `PrepareAndPlanLifecycleLaunchOptions`: `client`, `account`, `plan`, `mode`; optional `ufg: { config }`, `buySlippageBps`, `limits`, `fork`, `receipts`, `confirmations`, `signal`, `onProgress`, topology opt-outs. |
| `planLaunch` | `PlanLaunchOptions`: same execution context, including optional `ufg: { config }` and `signal`; re-admits an already-finalized plan without changing salts/minima. |
| `simulateLaunchPlan` | `client`, `planned`; optional `limits`, `fork`, `receipts`, `confirmations`, `signal`. |
| `readLaunchProgress` | `client`, `planned`; optional `receipts`, `confirmations`, `signal`. |
| `buildNextTransaction` | Progress options, plus optional `action`, `limits`, `fork`, `reviewedTransaction`. |

`buildLaunchTransactions` compiles unsigned commands; it does not prove execution.
Persist `serializeLaunchPlan(planned.plan)`, returned `planned.mode`, confirmation policy,
receipt references, and UFG config if applicable. `parseLaunchPlan` restores bigint values.
Do not serialize the entire `PlannedLaunch`, which can contain live limit callbacks.

Every launch step uses the native total transaction ceiling:32M on4663, including
poster gas. Approvals omit gas/fees for wallet preparation. Covered Robinhood
ArbOS61 templates use capacity bounds and exact local ordered-buy math, never
component-sized gas limits. Their evidence is `profiled` / `not-run`, not a receipt.
Conversion-carrying begin/atomic and consuming activation require exact native
execution. Unknown coverage or uncertain activation gets full-sequence execution
before begin. Explicit `simulateLaunchPlan` always executes; a generic fork is not Nitro proof.

Review checks the complete sequence, not just a successful prefix. There is no
SDK-invented 50M aggregate cap. A caller `maxSimulationGas` still tightens policy;
incomplete execution proof refuses admission. A refused full review cannot begin
a new launch. Only the immediate command receives final gas/price/estimate/admission.
Suffix metrics remain provisional; build-next admits only the canonical next command
at its fresh native-ceiling budget, never reusing a provisional estimate.

See [capacity, native/fork evidence and migration](lifecycle-gas-profiles.md)
for exact proof fields, upfront affordability and the public capacity-bound helper.

Review the returned final plan/hash, aligned price, burn, retained supply, fees,
ordered buy outputs/minima, funding, refunds, and complete gas envelope. A fresh
`buildNextTransaction` admits the immediate next step as canonical progress advances.
The wallet owns sending-RPC preparation; `submissionClient` has been removed.

`planned.transactions[0]` contains exact immediate `from/to/data/value` and, for
launch commands, native-ceiling `gas` and current `gasPrice`. Approvals omit both.
There is no fixed wallet nonce; the wallet assigns it. The plan identity nonce is unchanged.
The envelope is reusable, but its block-bound admission is historical, not permission
to sign later. Pass it as `reviewedTransaction` for fresh immediate admission after
review or recovery. This is not a second user review gate.
Reuse `planned.progress` for the same result's display instead of reading progress
independently beside the plan.

`fixedFinalEnvelope` and `LifecycleFinalEnvelope` are removed. A reviewed launch gas
that differs from the native ceiling refuses with `STALE_REVIEWED_GAS`; re-review,
never silently rewrite it. A lower caller complete-envelope cap refuses rather than
shrinking gas. Held prices below the pinned fee floor also refuse without bumping.
On Nitro the floor is max(ArbGasInfo L2 price, header base fee); twice base fee is
fresh recommendation headroom only. Reserve value plus ceiling×price, without
adding poster fees again. Actual activation capacity refusal asks the user to
reduce positions/pools; a large conservative bound alone is not such a refusal.

On chain4663, one RPC L2 header pins the invocation. Token prediction, native/token
balances, allowances, launch progress, Nitro getters and prices share one Multicall3 call
at that explicit L2 block. Further independent stages use one aggregate, even for
one or two reads. Multicall3's block-number/hash getters expose L1 values on Nitro
and must not select the L2 pin.
The same pin survives salt mining and buy calibration; there are no final chain or
canonical-header guard reads. Receipt confirmation/reorg checks remain.

Required native execution validates the exact calldata once; there is no later
exact-gas replay. Poster allocation comes from the same-review price tuple and a
local size bound, not a per-transaction oracle. Build-next encodes only its canonical
next command, preserving normal/UFG calldata and original/clipped batch spans.

Multicall3 runtime, Nitro backend capability and account-code observations are
retained for the caller's session. Chain identity is observed once per bound client;
recreate the client on chain changes. Financial state and required proof stay fresh.
The 4663 preset uses the deployed `hookSaltMiner`; returned salts are verified
locally. Its deployed `launchLens` supplies dependent progress, market, balance
and hook-mining reads in the same initial aggregate. Callers need no lens
configuration. See [read caching](reference.md#cache-static-reads-and-inspect-timing).

## Sign and confirm

Call `buildNextTransaction` before **every signature**, including approvals and
cancellation. Pass `reviewedTransaction` to hold the same gas/fee and intent, not a
wallet nonce. Send the exact returned `from/to/data/value/gas/gasPrice`.
`confirmations` defaults to 1; choose and retain your policy before begin.
The wallet owns its queue, nonce assignment and sending-RPC preparation. Unrelated
pending transactions are not an SDK confirmation-safety refusal. Retain the actual
submitted nonce and let the wallet advance locally; unknown reload recovery may
need one host-owned queue read, never a per-plan nonce gate. Check the active wallet
account/provider chain after asynchronous work, and never automatically replay a write.
The following local-account loop signs only when explicitly called by your application.
Use a new owner-only journal path inside a private directory; on reload, restore the
original plan and receipt references before calling it. Journal records contain secrets.

```ts
import { appendFile } from "node:fs/promises";
import {
  keccak256, type Chain, type Hash, type LocalAccount, type PublicClient,
  type Transport, type WalletClient,
} from "viem";
import {
  buildNextTransaction, LifecyclePhase, readLaunchProgress, serializeLaunchPlan,
  type LifecycleReceiptReference, type PlannedLaunch,
} from "@black-market/sdk";

export async function executeLaunch(
  client: PublicClient, wallet: WalletClient<Transport, Chain, LocalAccount>,
  planned: PlannedLaunch, receipts: LifecycleReceiptReference[], journalPath: string,
  activationHash?: Hash,
) {
  const record = (value: unknown) => appendFile(journalPath,
    JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v) + "\n",
    { mode: 0o600 });
  await record({ plan: serializeLaunchPlan(planned.plan), mode: planned.mode,
    confirmations: planned.confirmations, ufg: planned.ufg, receipts });
  for (;;) {
    const next = await buildNextTransaction({
      client, planned, receipts,
    });
    if (!next) {
      const progress = await readLaunchProgress({ client, planned, receipts });
      if (!progress.confirmationSafe || progress.canonical.phase !== LifecyclePhase.Active
        || !progress.receipts.every((r) => r.status === "confirmed")
        || !progress.markets.every((m) => m.live?.publicTrading) || !activationHash) {
        throw new Error("Launch not confirmed Active; reconcile the journal");
      }
      return { progress, activationHash };
    }
    const approval = next.kind === "approve" || next.kind === "approve-reset";
    if (!next.admission?.admitted || !approval && (next.gas === undefined || next.gasPrice === undefined)) {
      throw new Error("Immediate transaction is not admitted");
    }
    const request = await wallet.prepareTransactionRequest({
      chain: wallet.chain, account: wallet.account,
      to: next.to, data: next.data, value: next.value, gas: next.gas, gasPrice: next.gasPrice,
    });
    const [address] = await wallet.getAddresses();
    if (wallet.chain.id !== next.chainId || await wallet.getChainId() !== next.chainId
      || address?.toLowerCase() !== next.from.toLowerCase()
      || wallet.account.address.toLowerCase() !== planned.account.toLowerCase()) {
      throw new Error("Wallet account or chain changed");
    }
    const raw = await wallet.signTransaction(request);
    const hash = keccak256(raw);
    await record({ transactionId: next.id, kind: next.kind, hash, raw });
    const sent = await client.sendRawTransaction({ serializedTransaction: raw });
    if (sent !== hash) throw new Error("Submission hash mismatch; reconcile before continuing");
    const receipt = await client.waitForTransactionReceipt({
      hash, confirmations: planned.confirmations,
    });
    await record({ hash, receipt });
    if (receipt.status !== "success" || receipt.transactionHash !== hash) {
      throw new Error("Reverted or replaced transaction; reconcile before continuing");
    }
    receipts.push({ transactionHash: hash, confirmations: planned.confirmations,
      nonce: BigInt(request.nonce), observedBlockNumber: receipt.blockNumber, observedBlockHash: receipt.blockHash });
    if (next.kind === "atomic" || next.kind === "activate") activationHash = hash;
    await record({ receipts, activationHash });
  }
}
```

A send timeout is ambiguous: the hash may already be mined. Stop, query the saved
hash, and reconcile pending nonce/receipt state; do not automatically resend.
For an interactive review delay, pass the previously displayed command as
`reviewedTransaction` to a fresh `buildNextTransaction` before signing.
That revalidates the same immediate intent at its held gas/fee; the wallet owns its nonce.

Completion has **four checks**: receipt confirmed → markets active → metadata
published → API indexed. A successful transaction alone does not establish the last two.

## Publish metadata

Stage metadata **before chain signatures**, after you freeze the final plan. The
call order is `createUploadSession` → optional `putImage` → `completeUpload` →
confirm activation → `publishUploadSession`. Metadata-only sessions skip the image calls.
The following metadata-only function signs attribution and writes the API; call it
only with authorization. It works with a direct creator or the UFG principal.

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { toHex, zeroHash, type Chain, type LocalAccount, type Transport, type WalletClient } from "viem";
import {
  canonicalLaunchMetadataHash, LaunchApiClient, launchAttributionTypes,
  type LaunchSessionCreateMetadata, type PlannedLaunch,
} from "@black-market/sdk";

export async function stageMetadata(
  wallet: WalletClient<Transport, Chain, LocalAccount>, planned: PlannedLaunch,
  metadata: LaunchSessionCreateMetadata, journalPath: string,
) {
  if (wallet.account.address.toLowerCase() !== planned.account.toLowerCase()
    || await wallet.getChainId() !== Number(planned.chainId)
    || wallet.chain.id !== Number(planned.chainId)) throw new Error("Wrong signer domain");
  if (metadata.name !== planned.plan.token.name || metadata.symbol !== planned.plan.token.symbol) {
    throw new Error("Metadata differs from plan");
  }
  const record = (v: unknown) => appendFile(journalPath, JSON.stringify(v) + "\n", { mode: 0o600 });
  const idempotencyKey = randomUUID();
  const nonce = toHex(randomBytes(32));
  const deadline = BigInt(Math.floor(Date.now() / 1000)) + 600n;
  const signature = await wallet.signTypedData({
    account: wallet.account,
    domain: { name: "Abyss Launch Attribution", version: "1",
      chainId: Number(planned.chainId), verifyingContract: planned.plan.orchestrator },
    types: launchAttributionTypes, primaryType: "LaunchAttribution",
    message: { chainId: planned.chainId, wallet: planned.account,
      metadataHash: canonicalLaunchMetadataHash(metadata), imageSha256: zeroHash,
      imageContentType: "", imageContentLength: 0n, idempotencyKey, nonce, deadline },
  });
  const body = { chainId: Number(planned.chainId), wallet: planned.account, metadata,
    authorization: { nonce, deadline: deadline.toString(), signature } };
  await record({ idempotencyKey, body });
  const api = new LaunchApiClient({ baseUrl: "https://api.abyss.trading", retries: 1 });
  const session = await api.createUploadSession(body, idempotencyKey);
  await record({ session }); // Save the one-time capability before continuing.
  if (!session.capability || session.status !== "ready_to_launch") {
    throw new Error("Metadata session not ready");
  }
  return { api, sessionId: session.sessionId, capability: session.capability };
}
```

Retain the capability separately: `getUploadSession`, `renewUploadUrl`, and
`completeUpload` responses do not reissue it. With an image, authorize its SHA-256,
content type, and byte length using `sha256Hex`; upload only the signed bytes to the
API-issued PUT URL/headers. Wait for verified image readiness before launching.

Publish the **original atomic/activation transaction hash**, not an approval or begin
hash. Before publication, reread `readLaunchProgress` with all retained receipts;
require confirmation-safe Active, all markets public, and the activation confirmed at
its saved block number/hash. Call `publishUploadSession(chainId, sessionId, capability,
{ chainId, transactionHash })` on the same `LaunchApiClient`.

Catch `LaunchPublishPending`: its `session` retains indexing state and `retryAfterMs`
tells you when to poll `getUploadSession` or retry the same publication. HTTP 202 is
pending indexing, not a deployment revert. A published/indexed response must match
the predicted token, activation hash, metadata, and image. An API/image failure after
Active calls for publication recovery, not another deployment.

## Recover or cancel

Restore the exact saved plan with `parseLaunchPlan`, original mode, confirmations,
receipt references, and UFG config. Use `planLaunch` to re-admit it; obtain fresh
commands with `buildNextTransaction`. Never regenerate nonce, salts, or minima.
For runner launches use `--resume <original-run-dir>`; do not substitute a fresh run.

| Canonical phase / evidence | Action |
| --- | --- |
| None, no submitted hashes | Replan before signing; an expired unstarted plan needs a new explicit review. Runner resume stops for reconciliation. |
| Preparing / Ready, deadline valid | Resume the original plan's remaining preparations/activation. |
| Preparing / Ready, expired or retired | Request `buildNextTransaction({ client, planned, receipts, action: "cancel" })`; apply the same signing/receipt checks. |
| Active | Verify markets and original activation, then finish publication/claims. |
| Cancelled | Terminal; confirm refunds and inactive token state. |
| Pending / unconfirmed / replaced / reorged receipt | Reconcile the saved hash, inclusion, and nonce first; do not advance from a cached step counter. |

Preparing/Ready cancellation uses the committed plan without adapter calls or new
profile admission. It refunds **unspent external funding**; wrapped-native refunds
are WETH, not ETH gas. Token inventory stays inactive or burns per `burnOnCancel`.
Active liquidity cannot be cancelled or withdrawn, and there is no postlaunch creator pause.
`buildNextTransaction` returning `undefined` can mean Active **or Cancelled**; read phase.

| Symptom | Cause | Next action |
| --- | --- | --- |
| HTTP 403/429 on `eth_chainId`, `eth_getBalance`, `eth_simulateV1` | RPC throttling | Wait or use another RPC; reconcile and resume the same run. A 429 is not a revert. |
| Begun launch, deadline passed | Interrupted staged execution | Cancel as above; a fresh invocation cannot continue the original funds. |
| `eth_getLogs` range error | Genesis scan exceeds the 10M-block limit | Scan from core deployment block 82,880,313 in chunks of at most 10M. |
| `KYBER_UNAVAILABLE` / invalid WETH route | Trying to swap ETH→WETH | Use native wrapping; Kyber converts other quotes. |
| `INVALID_KYBER_INTENT` | Conversion deadline reused the plan deadline / exceeds 1,200 seconds | Use the separate 300-second conversion clock before committing. |
| `PLAN_NOT_ADMITTED` gas error | Saved envelope no longer fits | Rebuild the immediate envelope with `buildNextTransaction`. |
| `ECONOMIC_REVIEW_REQUIRED` hash mismatch | Review belongs to a different plan invocation | Review and admit the same saved plan. |
| `PUBLISH_TIMEOUT` / `API_INDEX_TIMEOUT` / image URL error after activation | Publication/indexing | Check Active; resume publication for the existing token. |

## After launch

Read the confirmed progress's `feeHub`, rewards module, and prepared market identities.
Locked launch positions are permanent; collecting fees never withdraws their principal.

| Role | What to do |
| --- | --- |
| Anyone | Call fee hub `claimAndSplit()` to collect and split fees; receive the executor bounty if configured. |
| Fee owner | Read `claimableOwnerFees(owner, asset)`; call `claimOwnerFees(asset, recipient)` for credited fees. |
| Token holder | Claim staking rewards or dividends from the rewards module; the app has holder claim UI. |
| Hook author | Use `readDeveloperFees` and `buildClaimDeveloperFeesTransaction`; [author reference](reference.md#stable-author-apis-and-v3-fees). |
| UFG holder | Read the treasury with `readUfgTreasury(client, token)`; redeem through its contract. |

For ordinary owner fees, first simulate fee hub `claimAndSplit()` with
`lifecycleFeeHubAbi`, submit that approved transaction, and wait for confirmation.
Then read `claimableOwnerFees(owner, asset)`. Simulate and submit
`claimOwnerFees(asset, recipient)` from the credited owner account. The second call
withdraws credits without harvesting again. Check each receipt and `Distributed` /
`OwnerFeesClaimed` events; an outer success can still contain failed individual payouts.

<a id="stable-author-apis-and-v3-fees"></a>
V3 author royalties come from attributable owner fees **after** the executor bounty;
they do not reduce holder rewards or burn allocations. Author identity is stable,
while its registry payout can change. Owner credits remain with the credited owner.
The current fee owner may change executor bounty up to **1,000 bps**; policy fractions
and frozen author terms stay fixed. See the [full fee reference](reference.md#stable-author-apis-and-v3-fees).

<a id="0120-release-opt-in-ufg-treasuries"></a>
## Launch a UFG treasury

UFG is an opt-in launch route, not another DEX venue. Creating one requires the SDK;
the app can display treasury launches but its creation route is not available here.
Start with the pure [`ufg-launch-config.ts`](../examples/ufg-launch-config.ts) example.
Neither the eleven wrappers nor the generic `examples/launch.ts` CLI supports UFG deployment.

1. Choose reward-free **ERC20**, executor bounty **0**, treasury share **10,000 bps**,
   exit fee **0–2,000 bps**, and **1–7 sorted unique reserve addresses**.
   The reserve set must equal the market quote set and exclude the launch token.
2. Before prediction, set creator to `UFG_LAUNCH_PROXY_ADDRESS` and nonce to
   `ufgLaunchNonce(principal, nonce96)`. Keep inventory/buy recipients external to the proxy.
   Recompute token orientation, ranges, and fees for that predicted token.
3. Use canonical Abyss config1 **2 QUOTE / 3 QUOTE_ORACLE**, or UFG fixed/dynamic V4
   config6 with `feeMode: 1` (QuoteOnly), LP fee 0, developer fee 0, and the identical
   typed `ufgLaunchConfig` tail. HMM and ordinary V4 profiles cannot substitute.
4. Build policies with `buildUfgFeeAssetPolicies(predictedToken, reserveAssets)`:
   launch-token fees burn; reserve fees fund the treasury after protocol share.
5. Call `prepareAndPlanLifecycleLaunch` or `planLaunch` with `account: principal`
   and **`ufg: { config }`**. Every sender/payer/refund recipient stays the principal.
   Approve the **proxy**, not the funding escrow, for non-native inputs.
6. Preserve `PlannedLaunch.ufg` and restore the same config on recovery.
   `readLaunchProgress` and `buildNextTransaction`, including cancellation, keep proxy routing.

`validateUfgLaunchPlan` checks offline restrictions. `buildUfgApprovals`,
`buildUfgLaunchTransactions`, and `buildUfgCancelTransaction` build unsigned commands;
use planner admission before signing. [UFG addresses/codecs](reference.md#deployed-infrastructure)
and `ufgBlackMarketTreasuryAbi` cover treasury reads, `collect()`, and redemption.

`readUfgTreasury(client, token)` returns the treasury address or `undefined`.
Holders burn tokens for a pro-rata share of **current collected reserves**, less
exit fee; this is not a guaranteed USD floor. Accrued pool fees are not collected
backing. Inspect collection failure events as well as receipt success; a fork check
needed at least 750k gas for `collect()`, not a universal mainnet gas limit.

## Configure Raeto

Raeto is a constrained **fee-sharing offering**, not a UFG treasury or a redemption
contract. Select `V4RaetoFixedPool` (fixed maximum hook fee) or
`V4RaetoDynamicPool` (minimum/maximum/sensitivity schedule). The hook creation
bytes are identical to the ordinary zero-royalty fixed/dynamic templates; the
Raeto collector, factory, locker, adapter and frozen terms are different.

```ts
import {
  getKnownLifecycleProfile, KnownLifecycleProfile, RAETO_QUOTE_ASSETS,
  RAETO_SHARE_BPS_OPTIONS, encodeRaetoLaunchTail, validateRaetoLaunchPlan,
  type RaetoLaunchConfigV1,
} from "@black-market/sdk/lifecycle";

const preset = getKnownLifecycleProfile({
  chainId: 4663, orchestrator: "0x91560876033d568d25CDe98C78c33ff8FC43962c",
  key: KnownLifecycleProfile.V4RaetoFixedPool,
})!;
const raetoLaunchConfig: RaetoLaunchConfigV1 = { shareBps: 500 };
console.log(preset.profile.id, RAETO_QUOTE_ASSETS, RAETO_SHARE_BPS_OPTIONS,
  encodeRaetoLaunchTail(raetoLaunchConfig));
// Add raetoLaunchConfig to the market's V4PoolBoundLifecycleMarketConfigV6.
// Once all markets are built: validateRaetoLaunchPlan(plan).
```

Every Raeto-route market must use its Raeto config6 profile/adapter, **WETH or
USDG**, `feeMode: 1` (QuoteOnly), `lpFeePips: 0`, and `developerFeeBps: 0`.
One V4 market per quote means at most two Raeto markets, with at most 32 total
positions. Preserve normal token/reward choices and fee-asset policies; no UFG
proxy, treasury, special nonce, or UFG funding approvals are involved.

Set `raetoLaunchConfig.shareBps` to **500, 1000, 2500, 5000, or 7500**.
The 5% floor cannot be disabled. **1234, 8000 and 10000 are not deployed options**,
even though a newer local contract source accepts a wider range. This release
pins the deployed five-item menu, proved by read-only calls to both live factories
at block 101,180,179. The encoder appends exactly one canonical 32-byte uint16
word; missing/extra/mixed HMM/UFG/auto-compounding tails reject.

Use `validateRaetoLaunchPlan(plan)` for the exclusive Raeto route; it rejects
every non-Raeto or malformed market with `INVALID_RAETO_PLAN`. Config/tail and
market fee/quote errors use `INVALID_RAETO_CONFIG`. Then use the ordinary
`prepareAndPlanLifecycleLaunch` / `buildNextTransaction` flow. A share change
changes the full plan hash, but Raeto's hook-constructor commitment hashes only
the zero-salt V6 prefix, not the collector share. Always re-review changed plans.

At collection the collector books `floor(post-treasury quote fees × shareBps /
10000)` as Raeto credit and forwards the remainder into the normal fee hub.
The **current fee owner** can call `setShareBps` with another menu value,
including immediately before collection; that selection applies to all
uncollected fees. Collection does not pay or consult the payout registry.
Anyone can call `claimRaeto(quoteAsset)` to pay the registry's **current** payout,
not a caller-selected recipient. Donations are not fee revenue or Raeto credit.
Use `raetoFeeCollectorV1Abi` for `shareBps`, `owed`, token/quote getters, the
share/claim methods and `RaetoShareUpdated` / `RaetoFeesBooked` /
`RaetoFeesClaimed`. [Reference and preserved deployment evidence](reference.md#raeto-profiles)
identify the payout registry and profile/adapter IDs.

Both variants use the measured v4 capacity model, with deterministic preparation
batches, exact local opening-buy quotes and the unchanged native 32M total gas
ceiling. A ready assessment is a budget/input check, **not execution proof**.
See [gas evidence](lifecycle-gas-profiles.md#raeto-and-auto-compounding-v4-evidence).

## Configure auto-compounding

Select `V4AutoCompoundStaticPool` for a fixed hook fee or
`V4AutoCompoundDynamicPool` for the existing minimum/maximum/sensitivity schedule.
Both use pool-bound config6, LP fee **0**, developer fee **0**, and either
`feeMode: 0` (InputToken) or `feeMode: 1` (QuoteOnly).

```ts
import {
  getAddresses, getKnownLifecycleProfile, KnownLifecycleProfile,
  encodeAutoCompoundTail, type AutoCompoundConfigV1,
} from "@black-market/sdk";

const preset = getKnownLifecycleProfile({
  chainId: 4663, orchestrator: getAddresses(4663).launchOrchestrator,
  key: KnownLifecycleProfile.V4AutoCompoundStaticPool,
})!;
const autoCompoundConfig: AutoCompoundConfigV1 = { compoundShareBps: 5000 };
console.log(preset.profile.id, encodeAutoCompoundTail(autoCompoundConfig));
```

The 50% share is illustrative, not a recommended allocation. Put
`autoCompoundConfig` in `V4PoolBoundLifecycleMarketConfigV6`; the market encoder
appends the canonical **64-byte** version/share tail automatically. Shares may be
0–10,000 bps. Missing tails, wrong versions, extra bytes, nonzero LP/developer fees,
or invalid shares fail locally before funding. Copy the selected preset's exact
profile ID, terms, beneficiary, treasury, denominator and deployment graph.

Use the ordinary `prepareAndPlanLifecycleLaunch` flow to mine and admit the full
market config. The compound share is part of the hook's constructor commitment:
changing it requires a newly mined salt and reviewed plan. The retired profiles
are not selectable. [Pinned identities and codecs](reference.md#auto-compounding-profiles)
include the recorded readback and read-only verification command.

The hook owns its new full-range liquidity permanently; the non-compounding
remainder follows the launch's normal fee-asset policies. It burns the allocated
launch-token fees and uses quote fees to buy and compound. During launch,
`_attemptCompound` defers until `openingCompletedAt` is set **after all opening
buys**, so the local ordered opening-buy curve remains exact. Post-opening swaps
can compound in `afterSwap`; the hook's low-gas guard reverts `CompoundOutOfGas()`.
Do not cap swap gas below `eth_estimateGas` or treat launch bounds as swap limits.
Launch transactions now have measured static/dynamic capacity and preparation
costs in `robinhood-4663-capacity-v4`, not ordinary fixed-hook guesses. They retain
the native 32M total gas ceiling and never execute calldata during planning.
See [the fork matrix and ArbOS caveat](lifecycle-gas-profiles.md#raeto-and-auto-compounding-v4-evidence).


<a id="0100-release-hmm-v2-only"></a>
## Configure HMM V2

Select `V4HmmFixedPool` or `V4HmmDynamicPool`, with LP/developer fees **0**.
HMM adds auxiliary strategy liquidity; it cannot withdraw locked launch positions.
`defaultHmmLaunchConfig` requires explicit bid-principal and reference-price guards:

```ts
import { defaultHmmLaunchConfig, encodeHmmLaunchTail } from "@black-market/sdk";

const config = defaultHmmLaunchConfig({
  tokenBudget: 500_000n * 10n ** 18n, quoteAsset: "USDG", quoteDecimals: 6,
  maxBidQuote: 100n * 10n ** 6n, referenceDeviation: 0,
});
config.strategyShareBps = 2500;
config.strategy.premiumDecaySeconds = 259200;
console.log("tail bytes:", (encodeHmmLaunchTail(config).length - 2) / 2);
```

These 100-USDG/zero-deviation/25% choices illustrate units, not recommended risk
settings. Put the typed config in config6 `hmmLaunchConfig`; the codec appends its
**512-byte** tail automatically. The [reference](reference.md#hmm-fields-and-migration)
lists all 15 strategy fields and the short HMM V1 migration note.

### V2 fee funding and owner controls

HMM V2 reserves its strategy share **on each swap in both currencies, after protocol
treasury share**. The remainder follows normal fee-hub distribution. HMM does not
burn strategy fees. Funded bids and maintenance events do not prove fills or profit.

Use `hmmFeeCollectorV2Abi` to read `strategyOwner()` / `liquidityManager()` and call
`setStrategyShareBps(0..10000)` as the current fee owner. Use
`hmmLiquidityManagerV2Abi` for `strategyConfig()`, `setStrategyConfig(...)`,
`placementsPaused()`, and `setPlacementsPaused(bool)`. Pausing stops new placements
and queues auxiliary withdrawal on maintenance, not trading or fee collection.
Lower intake caps do not liquidate existing lots; premium changes affect new lots.

For reference tick `R`, deviation `D`, and spacing `S`, ask lower is at least
`R - D*S`; bid upper is at most `R + D*S`, with grid rounding. A wider deviation
permits placements farther from the truncated oracle reference but weakens its
price bound. Choose guards against the actual pool; there is no universal safe setting.
