// Owned fork only, no signing keys. After pnpm build:
// source ~/.config/robinhood-archive-rpc.env; anvil --fork-url "$ROBINHOOD_ARCHIVE_RPC_URL" --fork-block-number 101180179 --chain-id 4663 --port 8571 --host 127.0.0.1 --hardfork cancun --gas-limit 120000000 --quiet
// TEMPLATE_FORK_RPC_URL=http://127.0.0.1:8571 node test/integration/template-gas.fork.mjs
// TEMPLATE_FORK_RPC_URL=http://127.0.0.1:8571 node test/integration/template-gas.fork.mjs --smoke
// Measurements always retain recorded scenarios and execute only missing boundaries.
// Characterization uses100M; --smoke checks planner/build-next at32M without
// re-executing any retained launch. Never print the credential-bearing archive URL.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createPublicClient, createWalletClient, decodeFunctionData, decodeFunctionResult, defineChain, encodeAbiParameters, encodeFunctionData, encodeFunctionResult, http, keccak256, multicall3Abi, parseAbi, parseEventLogs, toHex, zeroAddress, zeroHash } from 'viem';
import { deriveLaunchPoolRecipe, deriveLaunchPositionRanges, getSqrtRatioAtTick } from '../../dist/index.js';
import * as sdk from '../../dist/lifecycle/index.js';
import { deriveKnownPoolBoundHookDeployment } from '../../dist/lifecycle/calibration.js';

const archiveUrl = process.env.ROBINHOOD_ARCHIVE_RPC_URL;
const redact = (error) => {
  const message = String(error?.stack ?? error);
  return archiveUrl ? message.replaceAll(archiveUrl, 'alchemy') : message;
};
process.on('uncaughtException', (error) => { console.error(redact(error)); process.exit(1); });
assert.ok(archiveUrl, 'Source the configured Robinhood archive RPC environment before running');
const url = new URL(process.env.TEMPLATE_FORK_RPC_URL ?? '');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.protocol === 'http:' && url.port === '8571', 'An explicitly supplied owned loopback Anvil on port 8571 is required');
const chain = defineChain({ id: 4663, name: 'Owned template-gas fork', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [url.href] } } });
const transport = http(url.href, { timeout: 300_000, retryCount: 0 });
const client = createPublicClient({ chain, transport, pollingInterval: 20 });
const wallet = createWalletClient({ chain, transport });
const clientVersion = await client.request({ method: 'web3_clientVersion' });
assert.match(clientVersion, /anvil/i);
assert.equal(await client.getChainId(), 4663);
const [principal] = await wallet.getAddresses();
assert.equal(principal.toLowerCase(), '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266', 'Only the unlocked Anvil development account is allowed');
const info = await client.request({ method: 'anvil_nodeInfo' });
const forkBlock = BigInt(info.forkConfig.forkBlockNumber);
assert.ok(forkBlock > 100_721_302n, 'Fork must include both Raeto admissions; each run records its exact pin');
const upstream = createPublicClient({ transport: http(archiveUrl) });
const source = await upstream.getBlock({ blockNumber: forkBlock });
const gasInfo = '0x000000000000000000000000000000000000006c';
const priceData = encodeFunctionData({ abi: parseAbi(['function getPricesInWei() view returns (uint256,uint256,uint256,uint256,uint256,uint256)']), functionName: 'getPricesInWei' });
const priceResult = (await upstream.call({ to: gasInfo, data: priceData, blockNumber: forkBlock })).data;
assert.ok(priceResult && priceResult.length === 2 + 192 * 2);
// Anvil has no ArbOS precompiles. Budget prices come from the real source pin.
// The read-only Lens smoke also needs ArbSys's L2 environment views: on Anvil
// these are exactly NUMBER and BLOCKHASH. This eth_call-only override implements
// those two views, not any protocol code or state. No launch is replayed.
const arbSys = '0x0000000000000000000000000000000000000064';
const arbNumberSelector = encodeFunctionData({ abi: parseAbi(['function arbBlockNumber() view returns (uint256)']), functionName: 'arbBlockNumber' }).slice(2);
// if selector == arbBlockNumber: return NUMBER; otherwise arbBlockHash(uint256):
// return BLOCKHASH(calldataload(4)). Both branches return one ABI word.
const arbSysForkViews = `0x60003560e01c63${arbNumberSelector}14601b576004354060005260206000f35b4360005260206000f3`;
const planningClient = { supportsReadBatching: true, request: async (args) => {
  if (args.method !== 'eth_call') return client.request(args);
  const [tx, block] = args.params;
  if (tx.to.toLowerCase() === gasInfo) { assert.equal(tx.data, priceData); return priceResult; }
  if (tx.to.toLowerCase() !== '0xca11bde05977b3631167028862be2a173976ca11') return client.request(args);
  const decoded = decodeFunctionData({ abi: multicall3Abi, data: tx.data });
  assert.equal(decoded.functionName, 'aggregate3');
  const calls = decoded.args[0];
  if (!calls.some(({ target }) => target.toLowerCase() === gasInfo)) return client.request(args);
  const forkCalls = calls.filter(({ target }) => target.toLowerCase() !== gasInfo);
  const forkData = encodeFunctionData({ abi: multicall3Abi, functionName: 'aggregate3', args: [forkCalls] });
  const overrides = process.argv.includes('--smoke') ? [{ [arbSys]: { code: arbSysForkViews } }] : [];
  const forkResult = await client.request({ method: 'eth_call', params: [{ to: tx.to, data: forkData }, block, ...overrides] });
  const results = decodeFunctionResult({ abi: multicall3Abi, functionName: 'aggregate3', data: forkResult });
  let index = 0;
  return encodeFunctionResult({ abi: multicall3Abi, functionName: 'aggregate3', result: calls.map((call) => {
    if (call.target.toLowerCase() !== gasInfo) return results[index++];
    assert.equal(call.callData, priceData);
    return { success: true, returnData: priceResult };
  }) });
} };
const identity = { chainId: 4663n, orchestrator: '0x91560876033d568d25CDe98C78c33ff8FC43962c' };
const deployment = sdk.getKnownLifecycleDeployment(identity);
const quotes = [...sdk.RAETO_QUOTE_ASSETS];
const keys = [sdk.KnownLifecycleProfile.V4RaetoFixedPool, sdk.KnownLifecycleProfile.V4RaetoDynamicPool, sdk.KnownLifecycleProfile.V4AutoCompoundStaticPool, sdk.KnownLifecycleProfile.V4AutoCompoundDynamicPool];
const tokenAbi = parseAbi(['function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)', 'function approve(address,uint256) returns (bool)']);
const decimals = await Promise.all(quotes.map((address) => client.readContract({ address, abi: tokenAbi, functionName: 'decimals' })));
assert.deepEqual(decimals, [18, 6]);
const events = parseAbi([
  'event RaetoCollectorCreated(address indexed collector,address indexed launchToken,bytes32 indexed poolId,address hub,address quoteAsset,uint16 shareBps,address registry,address feeOwner)',
  'event OpeningCompleted(bytes32 indexed poolId,uint256 indexed completedAt)',
  'event CompoundDeferred(uint8 reason)',
  'event CompoundExecuted(uint256 quoteSpent,uint256 tokenBought,uint256 tokenBurned,uint256 quoteDeposited,uint256 tokenDeposited,uint128 liquidityAdded)',
]);
const json = (value) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n';
const send = async (tx, account = principal, gas = 100_000_000n) => {
  const hash = await wallet.sendTransaction({ account, to: tx.to, data: tx.data, value: tx.value ?? 0n, gas: tx.gas ?? gas, ...(tx.gasPrice === undefined ? {} : { gasPrice: tx.gasPrice }) });
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, 'success', `${tx.id ?? 'setup'} reverted: ${hash}`);
  return receipt;
};
const outer = await client.request({ method: 'evm_snapshot' });
const evidence = { schemaVersion: 1, chainId: 4663, forkBlock: Number(forkBlock), forkBlockHash: source.hash, forkTimestamp: source.timestamp, clientVersion,
  archiveProvider: 'alchemy',
  caveat: 'Anvil Cancun EVM compute gas, NOT native ArbOS/poster-gas proof. 100M characterization envelopes; 32M eth_call fit recorded separately. Budget prices use pinned native ArbGasInfo; read-only Lens smokes map ArbSys L2 number/hash views to actual Anvil NUMBER/BLOCKHASH via eth_call-only override. Launch contracts and execution state are not mocked.',
  nativePrices: { blockNumber: Number(forkBlock), to: gasInfo, data: priceData, result: priceResult },
  economics: 'Synthetic deterministic fixtures: supply 1M, FDV $5000, WETH $3000 / USDG $1; not current market valuations. Adjacent staircase bands with a permanent tail.',
  setup: {}, cases: [] };
try {
  // Fund USDG from the real fork manager balance with fork-only impersonation;
  // never manufacture token storage or bypass the deployed token implementation.
  const funder = sdk.getKnownLifecycleProfile({ ...identity, key: keys[0] }).boundHook.poolManager;
  const available = await client.readContract({ address: quotes[1], abi: tokenAbi, functionName: 'balanceOf', args: [funder] });
  const fundingAmount = 100n * 10n ** 6n;
  assert.ok(available >= fundingAmount, 'Pinned manager must hold enough USDG for isolated fixtures');
  await client.request({ method: 'anvil_impersonateAccount', params: [funder] });
  await client.request({ method: 'anvil_setBalance', params: [funder, toHex(10n ** 18n)] });
  const funded = await send({ to: quotes[1], data: encodeFunctionData({ abi: tokenAbi, functionName: 'transfer', args: [principal, fundingAmount] }) }, funder);
  await client.request({ method: 'anvil_stopImpersonatingAccount', params: [funder] });
  const approved = await send({ to: quotes[1], data: encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [deployment.fundingEscrow, fundingAmount] }) });
  evidence.setup = { funder, available, amount: fundingAmount, transferHash: funded.transactionHash, approvalHash: approved.transactionHash };

  const minedSalts = new Map();
  async function makePlan(scenario, index) {
    const preset = sdk.getKnownLifecycleProfile({ ...identity, key: scenario.key });
    const envelope = preset.profile.envelope;
    const supply = 1_000_000n * 10n ** 18n;
    // Every scenario restores its snapshot. Reusing identity is safe and keeps
    // empty source-chain slots cacheable; it does not reuse deployed launch state.
    let plan = { ...identity, creator: principal, nonce: 202610290000n,
      token: { kind: 0, rewardMode: 0, name: 'SDK template gas fixture', symbol: 'TGAS', supply, nftUnit: 0n, metadataURI: '', salt: toHex(1n, { size: 32 }), inventoryRecipient: principal, burnOnCancel: true },
      funding: [], feeAssets: [], markets: [], buys: [], deadline: source.timestamp + 86400n, executorFeeBps: 0 };
    const token = await client.readContract({ address: plan.orchestrator, abi: sdk.launchLifecycleAbi, functionName: 'predictToken', args: [plan] });
    const marketQuotes = scenario.marketCount === 1 ? [quotes[scenario.quoteIndex]] : quotes;
    plan.feeAssets = [token, ...marketQuotes].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1).map((asset) => ({ asset, ownerBps: 10000, rewardsBps: 0, burnBps: 0 }));
    plan.markets = marketQuotes.map((quote, marketIndex) => {
      const tokenBudget = marketIndex === marketQuotes.length - 1 ? supply - supply / BigInt(marketQuotes.length) * BigInt(marketIndex) : supply / BigInt(marketQuotes.length);
      const launchedTokenIsQuote = BigInt(token) < BigInt(quote);
      const recipe = deriveLaunchPoolRecipe({ supply, tokenBudget, pairedTokenDecimals: quote === quotes[0] ? 18 : 6, pairedTokenUsdPriceX18: (quote === quotes[0] ? 3000n : 1n) * 10n ** 18n, targetMarketCapUsdX18: 5000n * 10n ** 18n, launchedTokenIsQuote, fee: 3000, tickSpacing: 60 });
      const count = Math.floor(scenario.positions / marketQuotes.length) + (marketIndex < scenario.positions % marketQuotes.length ? 1 : 0);
      const bands = count === 1 ? { positions: [{ ...recipe, maxTokenAmount: tokenBudget }] }
        : count <= 16 ? deriveLaunchPositionRanges({ launchSqrtPriceX96: recipe.launchSqrtPriceX96, launchedTokenIsQuote, tokenBudget, tickSpacing: 60, venue: 'uniswap-v4', distributionPreset: 'staircase', positionCount: count, positionGaps: 'adjacent' })
        // The public distribution catalogue intentionally stops at 16. This
        // explicit 32-band fixture reaches the templates' full structural limit
        // without changing that API: adjacent one-spacing bands and a final tail.
        : { positions: Array.from({ length: count }, (_, i) => {
          const near = recipe.launchTick + (launchedTokenIsQuote ? 1 : -1) * i * 60;
          const far = i === count - 1 ? launchedTokenIsQuote ? 887220 : -887220 : near + (launchedTokenIsQuote ? 60 : -60);
          const tickLower = Math.min(near, far), tickUpper = Math.max(near, far);
          const a = getSqrtRatioAtTick(tickLower), b = getSqrtRatioAtTick(tickUpper), q96 = 1n << 96n;
          const maxTokenAmount = tokenBudget / BigInt(count) + (i === count - 1 ? tokenBudget % BigInt(count) : 0n);
          const liquidity = launchedTokenIsQuote ? (((maxTokenAmount * a) / q96) * b) / (b - a) : maxTokenAmount * q96 / (b - a);
          return { tickLower, tickUpper, liquidity, maxTokenAmount };
        }) };
      const config = { version: 6, lpFeePips: 0, tickSpacing: 60, sqrtPriceX96: recipe.launchSqrtPriceX96,
        hookFeePips: 10000, minimumHookFeePips: 1000, feeSensitivityPipsSecondsPerTick: 7654321, feeMode: scenario.feeMode ?? 1,
        protocolFeeDenominator: envelope.protocolFeeDenominator, treasury: envelope.protocolTreasury, externalLiquidityDisabled: false,
        oracleConfigId: keccak256(encodeAbiParameters([{ type: 'uint24' }, { type: 'uint16' }], [1, 4096])), hookSalt: zeroHash,
        profileId: preset.profile.id, termsDigest: envelope.termsDigest, developerBeneficiary: envelope.beneficiary, developerFeeBps: 0,
        positions: bands.positions.map((p, i) => ({ tickLower: p.tickLower, tickUpper: p.tickUpper, liquidity: p.liquidity, salt: toHex(BigInt(i), { size: 32 }), maxTokenAmount: p.maxTokenAmount })),
        ...(sdk.isRaetoProfile(preset.profile.id) ? { raetoLaunchConfig: { shareBps: sdk.RAETO_SHARE_BPS_OPTIONS[index % sdk.RAETO_SHARE_BPS_OPTIONS.length] } } : { autoCompoundConfig: { compoundShareBps: 5000 } }) };
      return { adapterId: preset.profile.registration.adapterId, profileId: preset.profile.id, quoteAsset: quote, tokenBudget, configVersion: 6, config: sdk.encodePoolBoundV4LifecycleMarketConfig(config) };
    });
    plan.buys = Array.from({ length: scenario.buyCount }, (_, i) => {
      const marketIndex = i % marketQuotes.length;
      return { marketIndex, quoteAmountIn: marketQuotes[marketIndex] === quotes[0] ? 10n ** 13n : 10n ** 6n, minTokenOut: 1n, recipient: principal, sqrtPriceLimitX96: 0n };
    });
    plan.funding = marketQuotes.flatMap((asset) => {
      const amount = plan.buys.filter((buy) => marketQuotes[buy.marketIndex] === asset).reduce((sum, buy) => sum + buy.quoteAmountIn, 0n);
      return amount === 0n ? [] : [{ asset, amount, kind: asset === quotes[0] ? 1 : 0, inputAsset: asset, inputAmount: amount, target: zeroAddress, data: '0x' }];
    }).sort((a, b) => BigInt(a.asset) < BigInt(b.asset) ? -1 : 1);
    for (const [marketIndex, market] of plan.markets.entries()) {
      const known = deriveKnownPoolBoundHookDeployment({ plan, marketIndex, token });
      const key = `${known.deployment.deployer}:${known.deployment.initCodeHash}`;
      let mined = minedSalts.get(key);
      if (!mined) {
        mined = await sdk.minePoolBoundHookSalt({ deployer: known.deployment.deployer, initCodeHash: known.deployment.initCodeHash });
        minedSalts.set(key, mined);
      }
      plan.markets[marketIndex] = { ...market, config: sdk.encodePoolBoundV4LifecycleMarketConfig({ ...sdk.decodePoolBoundV4LifecycleMarketConfig(market.config, 6), hookSalt: mined.salt }) };
    }
    const initialBuys = sdk.computeLifecycleOpeningBuys({ plan, predictedToken: token });
    plan = { ...plan, buys: plan.buys.map((buy, i) => ({ ...buy, minTokenOut: initialBuys[i].tokenOut * 9950n / 10000n })) };
    return { plan, token, initialBuys };
  }

  async function assertActive(plan, token, receipts, initialBuys) {
    const launchId = sdk.hashLaunchIdentity(plan);
    const progress = await client.readContract({ address: plan.orchestrator, abi: sdk.launchLifecycleAbi, functionName: 'readLaunchProgress', args: [launchId] });
    assert.equal(progress.phase, sdk.LifecyclePhase.Active);
    assert.equal(progress.positionCount, plan.markets.reduce((n, market) => n + sdk.decodePoolBoundV4LifecycleMarketConfig(market.config, 6).positions.length, 0));
    const activation = receipts.at(-1);
    const actualBuys = parseEventLogs({ abi: sdk.launchLifecycleAbi, eventName: 'InitialBuyExecuted', logs: activation.logs });
    assert.equal(actualBuys.length, initialBuys.length);
    for (const [i, log] of actualBuys.entries()) {
      assert.equal(log.args.tokenOut, initialBuys[i].tokenOut, 'Exact local curve output must match actual opening');
      assert.equal(log.args.quoteSpent, initialBuys[i].quoteSpent);
    }
    const logs = receipts.flatMap((receipt) => receipt.logs);
    const collectors = parseEventLogs({ abi: events, eventName: 'RaetoCollectorCreated', logs });
    for (const log of collectors) {
      const market = plan.markets.find((market) => market.quoteAsset.toLowerCase() === log.args.quoteAsset.toLowerCase());
      const configured = sdk.decodePoolBoundV4LifecycleMarketConfig(market.config, 6).raetoLaunchConfig.shareBps;
      assert.equal(log.args.shareBps, configured);
      const [share, launchToken, quote] = await Promise.all(['shareBps', 'launchToken', 'quoteAsset'].map((functionName) => client.readContract({ address: log.args.collector, abi: sdk.raetoFeeCollectorV1Abi, functionName })));
      assert.equal(share, configured); assert.equal(launchToken, token); assert.equal(quote.toLowerCase(), market.quoteAsset.toLowerCase());
    }
    const auto = plan.markets.some((market) => sdk.isAutoCompoundProfile(market.profileId));
    const deferred = parseEventLogs({ abi: events, eventName: 'CompoundDeferred', logs: activation.logs });
    const opened = parseEventLogs({ abi: events, eventName: 'OpeningCompleted', logs: activation.logs });
    if (auto) {
      assert.equal(deferred.length, plan.buys.length);
      assert.ok(deferred.every((event) => event.args.reason === 0), 'Every compound attempt defers for Opening');
      assert.equal(parseEventLogs({ abi: events, eventName: 'CompoundExecuted', logs: activation.logs }).length, 0);
      assert.equal(opened.length, plan.markets.length);
      if (actualBuys.length) assert.ok(opened.every((event) => event.logIndex > actualBuys.at(-1).logIndex), 'Opening completes only after every ordered buy');
    } else assert.equal(collectors.length, plan.markets.length);
    return { launchId, phase: 'Active', positionCount: progress.positionCount,
      collectors: collectors.map(({ args }) => ({ collector: args.collector, quoteAsset: args.quoteAsset, shareBps: args.shareBps })),
      opening: { exactBuyOutputsMatched: actualBuys.length, compoundDeferredForOpening: deferred.length, openingCompletedEvents: opened.length } };
  }

  const smoke = process.argv.includes('--smoke');
  const scenarios = [];
  for (const key of keys) {
    if (smoke) {
      for (const quoteIndex of [0, 1]) for (const mode of ['atomic', 'staged']) scenarios.push({ key, marketCount: 1, positions: 1, buyCount: 1, quoteIndex, mode });
      continue;
    }
    const raeto = key === keys[0] || key === keys[1];
    for (const quoteIndex of raeto ? [0, 1] : [0]) for (const positions of [1, 8, 32]) for (const buyCount of [0, 1, 4]) for (const mode of ['atomic', 'staged']) scenarios.push({ key, marketCount: 1, positions, buyCount, quoteIndex, mode });
    for (const positions of [8, 32]) for (const buyCount of [0, 1, 4]) scenarios.push({ key, marketCount: 2, positions, buyCount, quoteIndex: 0, mode: 'staged' });
    if (!raeto) for (const mode of ['atomic', 'staged']) scenarios.push({ key, marketCount: 1, positions: 8, buyCount: 4, quoteIndex: 1, feeMode: 0, mode });
  }
  const signature = ({ key, marketCount, positions, buyCount, quoteIndex, mode, feeMode = 1 }) => [key, marketCount, positions, buyCount, quoteIndex, mode, feeMode].join(':');
  const requiredBoundary = (s) => {
    if (s.key === keys[0]) return false; // Complete retained fixed-Raeto matrix.
    if (s.key === keys[1]) return s.marketCount === 1
      ? s.quoteIndex === 0 ? s.positions === 32 && s.buyCount === 4 && s.mode === 'staged'
        : s.positions === 1 && s.buyCount === 1 && s.mode === 'atomic' || s.positions === 32 && s.buyCount === 4 && s.mode === 'staged'
      : s.positions === 8 && s.buyCount === 0 || s.positions === 32 && s.buyCount === 4;
    if (s.marketCount === 2) return s.positions === 8 && s.buyCount === 0 || s.positions === 32 && s.buyCount === 4;
    if (s.quoteIndex === 1) return s.feeMode === 0 && s.positions === 8 && s.buyCount === 4;
    return s.positions === 1 && s.buyCount === 0 || s.positions === 8 && s.buyCount === 1 || s.positions === 32 && s.buyCount === 4;
  };
  const saved = JSON.parse(await readFile(new URL('../fixtures/template-gas-matrix.json', import.meta.url), 'utf8'));
  assert.equal(saved.forkBlock, evidence.forkBlock);
  assert.equal(saved.forkBlockHash, evidence.forkBlockHash);
  assert.equal(saved.clientVersion, evidence.clientVersion);
  assert.equal(saved.nativePrices.result, priceResult);
  const completed = new Set(saved.cases.map(({ scenario }) => signature(scenario)));
  if (!smoke) {
    evidence.cases = saved.cases;
    evidence.retainedPublicArchiveCases = saved.retainedPublicArchiveCases ?? saved.cases.length;
    const missing = scenarios.filter((scenario) => requiredBoundary(scenario) && !completed.has(signature(scenario))).length;
    console.log(`Retaining ${saved.cases.length} recorded launches; executing ${missing} missing boundary cases`);
  }
  for (const [index, scenario] of scenarios.entries()) {
    if (!smoke && (completed.has(signature(scenario)) || !requiredBoundary(scenario))) continue;
    console.log(`Starting ${index + 1}/${scenarios.length}: ${JSON.stringify(scenario)}`);
    const snapshot = await client.request({ method: 'evm_snapshot' });
    try {
      if (smoke) {
        const matrixCase = saved.cases.findIndex(({ scenario: s }) => s.key === scenario.key && s.marketCount === 1 && s.quoteIndex === scenario.quoteIndex);
        assert.ok(matrixCase >= 0, 'A profiled smoke requires an existing real execution observation');
        const retained = saved.cases[matrixCase], plan = sdk.parseLaunchPlan(JSON.stringify(retained.plan));
        const planned = await sdk.planLaunch({ client: planningClient, account: principal, plan, mode: scenario.mode });
        assert.equal(planned.assessment.ready, true, planned.assessment.reason);
        assert.equal(planned.assessment.gasProfile.version, 'robinhood-4663-capacity-v5');
        const next = await sdk.buildNextTransaction({ client: planningClient, planned });
        assert.ok(next);
        assert.equal(next.gas, 32_000_000n);
        assert.equal(next.assessment.ready, true);
        evidence.cases.push({ scenario: { ...retained.scenario, mode: scenario.mode }, readOnly: true,
          assessment: { ready: true, version: planned.assessment.gasProfile.version, mode: planned.mode, bounds: planned.assessment.gasProfile.bounds },
          next: { kind: next.kind, gasLimit: next.gas },
          retainedExecution: { matrixCase, launchId: retained.observed.launchId, phase: retained.observed.phase } });
        await writeFile(new URL('../fixtures/template-gas-smoke.json', import.meta.url), json(evidence));
        console.log(`Profiled read-only smoke: ${scenario.key} quote=${scenario.quoteIndex} mode=${planned.mode}`);
        continue;
      }
      const { plan, token, initialBuys } = await makePlan(scenario, index);
      const receipts = [], transactions = [];
      const commands = sdk.buildLaunchTransactions({ plan, mode: scenario.mode, ...(scenario.mode === 'staged' ? { preparationBatches: scenario.marketCount === 2 && scenario.positions === 8 ? [2] : Array(scenario.marketCount).fill(1) } : {}) });
      for (const command of commands) {
        console.log(`  Characterizing ${command.id}`);
        const request = { account: principal, to: command.to, data: command.data, value: command.value };
        const minimumGasEstimate = await client.estimateGas({ ...request, gas: 100_000_000n });
        let nativeCeilingCallSucceeded = false, nativeCeilingFailure;
        try { await client.call({ ...request, gas: 32_000_000n }); nativeCeilingCallSucceeded = true; }
        catch (error) { nativeCeilingFailure = redact(error.shortMessage ?? error.message); }
        const receipt = await send(command);
        receipts.push(receipt);
        transactions.push({ kind: command.kind, hash: receipt.transactionHash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, gasLimit: 100_000_000n, calldataBytes: (command.data.length - 2) / 2,
          minimumGasEstimate, nativeCeilingCallSucceeded, ...(nativeCeilingFailure ? { nativeCeilingFailure } : {}), ...(command.kind === 'prepare' ? { marketStart: command.marketStart, marketCount: command.marketCount } : {}) });
      }
      const observed = await assertActive(plan, token, receipts, initialBuys);
      evidence.cases.push({ scenario, predictedToken: token, plan: JSON.parse(sdk.serializeLaunchPlan(plan)), transactions, observed });
      const output = new URL('../fixtures/template-gas-matrix.json', import.meta.url);
      await writeFile(output, json(evidence));
      console.log(`${index + 1}/${scenarios.length} ${scenario.key} ${scenario.mode} markets=${scenario.marketCount} positions=${scenario.positions} buys=${scenario.buyCount} quote=${scenario.quoteIndex}: ${transactions.map((tx) => `${tx.kind}=${tx.gasUsed}`).join(' ')}`);
    } catch (error) { console.error('Template case failed:', redact(error)); throw error; }
    finally { assert.equal(await client.request({ method: 'evm_revert', params: [snapshot] }), true); }
  }
  console.log(`Recorded ${evidence.cases.length} ${smoke ? 'read-only profiled assessments' : 'matrix launches'} at fork block ${forkBlock}`);
} finally { assert.equal(await client.request({ method: 'evm_revert', params: [outer] }), true, 'Restore the owned fork after profiling'); }
