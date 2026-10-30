import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as sdk from '../dist/lifecycle/index.js';

const matrix = JSON.parse(await readFile(new URL('./fixtures/template-gas-matrix.json', import.meta.url), 'utf8'));
const keys = [sdk.KnownLifecycleProfile.V4RaetoFixedPool, sdk.KnownLifecycleProfile.V4RaetoDynamicPool,
  sdk.KnownLifecycleProfile.V4AutoCompoundStaticPool, sdk.KnownLifecycleProfile.V4AutoCompoundDynamicPool];
const padded = (value) => (value * BigInt(10000 + sdk.LIFECYCLE_CAPACITY_PADDING_BPS) + 9999n) / 10000n;
const ceiling = sdk.ROBINHOOD_NATIVE_TRANSACTION_GAS_LIMIT;

test('committed fork evidence covers every requested template, depth, quote, path and opening-buy dimension', () => {
  assert.equal(matrix.chainId, 4663);
  assert.ok(matrix.forkBlock > 100_721_302);
  assert.match(matrix.forkBlockHash, /^0x[0-9a-f]{64}$/);
  assert.match(matrix.clientVersion, /anvil/i);
  assert.match(matrix.caveat, /NOT native ArbOS/);
  assert.equal(matrix.cases.length, 84, '59 retained observations plus the approved25 missing boundary cases');
  assert.equal(matrix.retainedPublicArchiveCases, 59);
  assert.equal(matrix.archiveProvider, 'alchemy');
  const signatures = matrix.cases.map(({ scenario: s }) => [s.key, s.marketCount, s.positions, s.buyCount, s.quoteIndex, s.mode, s.feeMode ?? 1].join(':'));
  assert.equal(new Set(signatures).size, matrix.cases.length, 'A recorded case must never execute twice');
  for (const key of keys) {
    const rows = matrix.cases.filter(({ scenario }) => scenario.key === key);
    for (const positions of [1, 8, 32]) for (const mode of ['atomic', 'staged']) {
      assert.ok(rows.some(({ scenario: s }) => s.marketCount === 1 && s.positions === positions && s.mode === mode), `${key}: missing ${positions}/${mode}`);
    }
    for (const buyCount of [0, 1, 4]) for (const mode of ['atomic', 'staged']) {
      assert.ok(rows.some(({ scenario: s }) => s.marketCount === 1 && s.buyCount === buyCount && s.mode === mode), `${key}: missing ${buyCount} buys/${mode}`);
    }
    for (const [positions, buyCount] of [[8, 0], [32, 4]]) {
      assert.ok(rows.some(({ scenario: s }) => s.marketCount === 2 && s.positions === positions && s.buyCount === buyCount && s.mode === 'staged'), `${key}: missing two-market ${positions}/${buyCount}`);
    }
    if (key === keys[0] || key === keys[1]) for (const quoteIndex of [0, 1]) assert.ok(rows.some(({ scenario: s }) => s.marketCount === 1 && s.quoteIndex === quoteIndex));
  }
});

for (const [index, row] of matrix.cases.entries()) test(`measured gas + forwarding estimate fit current capacity bounds with margin: ${index + 1} ${row.scenario.key}/${row.scenario.mode}/${row.scenario.positions}/${row.scenario.buyCount}`, () => {
  const plan = sdk.parseLaunchPlan(JSON.stringify(row.plan));
  const bounds = sdk.computeLifecycleLaunchGasBounds({ plan, predictedToken: row.predictedToken });
  assert.ok(bounds, 'Every measured Raeto/auto-compound plan must have known capacity');
  const commands = sdk.buildLaunchTransactions({ plan, mode: row.scenario.mode,
    ...(row.scenario.mode === 'staged' ? { preparationBatches: row.transactions.filter(({ kind }) => kind === 'prepare').map(({ marketCount }) => marketCount) } : {}) });
  assert.equal(commands.length, row.transactions.length);
  for (const [i, tx] of row.transactions.entries()) {
    const command = commands[i];
    assert.equal(command.kind, tx.kind);
    assert.equal((command.data.length - 2) / 2, tx.calldataBytes);
    const bound = tx.kind === 'atomic' ? bounds.atomicComputeGasUpperBound : tx.kind === 'activate' ? bounds.activationComputeGasUpperBound
      : tx.kind === 'prepare' ? padded(sdk.preparationGasEstimate(plan, tx.marketStart, tx.marketCount) + 24n * BigInt(tx.calldataBytes))
      // Begin has no market preparation or activation; its full native envelope
      // is the enforced budget, not an invented component estimate.
      : ceiling;
    const used = BigInt(tx.gasUsed);
    assert.ok(bound !== undefined && used <= bound, `${tx.kind}: used ${used} > bound ${bound}`);
    if (used <= ceiling && BigInt(tx.minimumGasEstimate) <= ceiling) assert.equal(tx.nativeCeilingCallSucceeded, true, 'An infrastructure failure must not be recorded as a capacity refusal');
    assert.ok(BigInt(tx.minimumGasEstimate) <= bound, `${tx.kind}: forwarding estimate ${tx.minimumGasEstimate} > bound ${bound}`);
    assert.ok(bound * 100n >= used * 105n, `${tx.kind}: less than 5% observed-gas margin`);
    if (tx.nativeCeilingCallSucceeded) assert.ok(bound <= ceiling, `${tx.kind}: observed 32M fit must remain plannable, bound ${bound}`);
  }
  assert.equal(row.observed.phase, 'Active');
  assert.equal(row.observed.positionCount, row.scenario.positions);
  assert.equal(row.observed.opening.exactBuyOutputsMatched, plan.buys.length);
  if (sdk.isRaetoProfile(plan.markets[0].profileId)) {
    sdk.validateRaetoLaunchPlan(plan);
    assert.equal(row.observed.collectors.length, plan.markets.length);
    for (const collector of row.observed.collectors) {
      const market = plan.markets.find((market) => market.quoteAsset.toLowerCase() === collector.quoteAsset.toLowerCase());
      assert.equal(collector.shareBps, sdk.decodePoolBoundV4LifecycleMarketConfig(market.config, 6).raetoLaunchConfig.shareBps);
    }
  } else assert.equal(row.observed.opening.compoundDeferredForOpening, plan.buys.length);
});

test('read-only fork smoke profiles every template/quote without replaying retained launch executions', async () => {
  const smoke = JSON.parse(await readFile(new URL('./fixtures/template-gas-smoke.json', import.meta.url), 'utf8'));
  for (const key of keys) for (const quoteIndex of [0, 1]) for (const mode of ['atomic', 'staged']) {
    const row = smoke.cases.find(({ scenario: s }) => s.key === key && s.quoteIndex === quoteIndex && s.mode === mode);
    assert.ok(row, `${key}: missing ${mode}/${quoteIndex} profiled smoke`);
    assert.equal(row.assessment.ready, true);
    assert.equal(row.assessment.version, 'robinhood-4663-capacity-v4', 'Retain the recorded model version; never rewrite historical smoke evidence');
    assert.equal(row.readOnly, true);
    assert.equal(BigInt(row.next.gasLimit), ceiling);
    const retained = matrix.cases[row.retainedExecution.matrixCase];
    assert.equal(row.retainedExecution.phase, 'Active');
    assert.equal(row.retainedExecution.launchId, retained.observed.launchId);
    assert.equal(retained.scenario.key, key);
    assert.ok(retained.transactions.every(({ gasUsed }) => BigInt(gasUsed) > 0n));
  }
});
