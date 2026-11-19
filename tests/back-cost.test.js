import test from 'node:test';
import assert from 'node:assert/strict';
import { backCostRowCents, backCostSummary, validBackCostRow } from '../src/back-cost.js';
import { quoteFinancials } from '../src/work-finance.js';

const worker = { id: 'worker', description: 'Worker', days: 2, hoursPerDay: 8, rate: 35 };

test('back cost multiplies days, hours per day and rate in cents', () => {
  assert.equal(backCostRowCents(worker), 56000);
  assert.equal(backCostRowCents({ ...worker, days: '1.5', hoursPerDay: '7.5', rate: '42.50' }), 47813);
});

test('summary sums worker days, total hours and rounded row costs', () => {
  const rows = [worker, { ...worker, days: 1.5, hoursPerDay: 7.5, rate: 42.5 }];
  assert.deepEqual(backCostSummary(rows), { days: 3.5, hours: 27.25, cost: 103813 });
  assert.deepEqual(backCostSummary([]), { days: 0, hours: 0, cost: 0 });
  assert.deepEqual(backCostSummary([worker]), { days: 2, hours: 16, cost: 56000 });
});

test('incomplete drafts calculate safely but cannot be saved', () => {
  const draft = { ...worker, description: '', days: '', hoursPerDay: '', rate: '' };
  assert.equal(backCostRowCents(draft), 0);
  assert.equal(validBackCostRow(draft), false);
  assert.equal(validBackCostRow(worker), true);
  assert.equal(validBackCostRow({ ...worker, days: 0, rate: 0 }), true);
  assert.equal(validBackCostRow({ ...worker, days: -1 }), false);
  assert.equal(validBackCostRow({ ...worker, rate: 'Infinity' }), false);
  assert.equal(validBackCostRow({ ...worker, rate: 'NaN' }), false);
  assert.equal(validBackCostRow({ ...worker, days: 1e308, rate: 1e308 }), false);
});

test('actual back costs do not change the quote, extras or customer balances', () => {
  const job = { contractAmount: 1000, claims: [{ amount: 200, status: 'Paid' }], extras: [{ amount: 150 }] };
  assert.deepEqual(quoteFinancials({ ...job, backCosts: [worker] }), quoteFinancials(job));
});
