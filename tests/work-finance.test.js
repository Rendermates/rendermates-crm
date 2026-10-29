import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReceiptsForecast, groupBookedMonths, groupWork, isDateKey, jobContractCents, jobOutstandingCents } from '../src/work-finance.js';

const booked = claims => ({ id: 'booked', status: 'booked', contractAmount: 1000, startDate: '2026-12-01', claims });
const bucket = (result, key) => result.months.find(month => month.key === key);

test('uses payment dates rather than work dates and never counts a paid claim twice', () => {
  const result = buildReceiptsForecast([booked([
    { id: 'deposit', amount: 100, expectedDate: '2026-10-01', paidDate: '2026-10-05', status: 'Paid' },
    { id: 'progress', amount: 400, expectedDate: '2026-11-15', status: 'To Invoice' },
    { id: 'final', amount: 500, expectedDate: '2027-01-10', status: 'Invoiced' },
  ])], '2026-10-30');
  assert.equal(bucket(result, '2026-10').received, 10000);
  assert.equal(bucket(result, '2026-10').expected, 0);
  assert.equal(bucket(result, '2026-11').expected, 40000);
  assert.equal(bucket(result, '2026-12').expected, 0);
  assert.equal(bucket(result, '2027-01').expected, 50000);
  assert.equal(result.unstaged.length, 0);
});

test('legacy dates are never guessed; invalid dates stay undated', () => {
  const result = buildReceiptsForecast([booked([
    { id: 'old-paid', amount: 100, status: 'Paid', date: '1/10/2026', expectedDate: '2026-10-01' },
    { id: 'old-unpaid', amount: 200, status: 'To Invoice', date: '2/10/2026' },
    { id: 'bad-date', amount: 50, status: 'Invoiced', expectedDate: '2026-02-30' },
  ])], '2026-10-30');
  assert.equal(result.undated.length, 3);
  assert.ok(result.months.every(month => month.received === 0 && month.expected === 0));
  assert.equal(result.unstaged[0].cents, 65000);
});

test('overdue is a subset of expected, today is not overdue, archived balances remain', () => {
  const job = { ...booked([
    { id: 'late', amount: 100, status: 'Invoiced', expectedDate: '2026-09-10' },
    { id: 'today', amount: 50, status: 'To Invoice', expectedDate: '2026-10-30' },
  ]), archived: true };
  const result = buildReceiptsForecast([job], '2026-10-30');
  assert.equal(result.overdue.length, 1);
  assert.equal(bucket(result, '2026-09').expected, 10000);
  assert.equal(bucket(result, '2026-09').overdue, 10000);
  assert.equal(bucket(result, '2026-10').expected, 5000);
  assert.equal(bucket(result, '2026-10').overdue, 0);
});

test('unaccepted quotes are not commitments but recorded actual receipts are preserved', () => {
  const result = buildReceiptsForecast([{ status: 'quoted', claims: [
    { amount: 900, expectedDate: '2026-11-01', status: 'To Invoice' },
    { amount: 20, paidDate: '2026-10-01', status: 'Paid' },
  ] }], '2026-10-30');
  assert.equal(bucket(result, '2026-11').expected, 0);
  assert.equal(bucket(result, '2026-10').received, 2000);
});

test('tracks unassigned contract and extras separately; cents avoid floating point drift', () => {
  const job = { ...booked([{ amount: 0.1, status: 'Paid' }]), contractAmount: 0.1, extras: [{ amount: 0.2 }] };
  assert.equal(jobContractCents(job), 30);
  assert.equal(jobOutstandingCents(job), 20);
  assert.equal(buildReceiptsForecast([job], '2026-10-30').unstaged[0].cents, 20);
});

test('groups booked work by year/month with undated work last and keeps all lifecycle groups', () => {
  const jobs = [
    { id: 'later', status: 'booked', startDate: '2027-01-01' },
    { id: 'earlier', status: 'booked', startDate: '2026-11-01' },
    { id: 'missing', status: 'booked' },
    { id: 'active', status: 'in_progress' },
    { id: 'quote', status: 'quoted' },
    { id: 'done', status: 'completed' },
    { id: 'unknown', status: 'custom' },
  ];
  assert.deepEqual(groupBookedMonths(jobs.filter(job => job.status === 'booked')).map(group => group.key), ['2026-11', '2027-01', 'undated']);
  assert.deepEqual(groupWork(jobs).map(group => group.key), ['in_progress', 'pipeline', 'booked', 'completed', 'other']);
  assert.equal(isDateKey('2028-02-29'), true);
  assert.equal(isDateKey('2027-02-29'), false);
});
