import test from 'node:test';
import assert from 'node:assert/strict';
import { parseXeroQuoteTotals } from '../src/xero-quote.js';

test('Xero subtotal and gross are read independently of the GST tax amount', () => {
  assert.deepEqual(parseXeroQuoteTotals('Subtotal 24,490.00 Total GST 15.00% 3,673.50 Total NZD 28,163.50'), {
    amountExclGst: '24490.00', amountIncGst: '28163.50'
  });
});

test('a tax-only value is not mistaken for the contract subtotal or total', () => {
  assert.deepEqual(parseXeroQuoteTotals('Total GST 3,673.50'), { amountExclGst: '', amountIncGst: '' });
});

test('explicit excluding and including labels and currency symbols are accepted', () => {
  assert.deepEqual(parseXeroQuoteTotals('Total Excl. GST: $1,000.00 Total Including GST: NZD $1,150.00'), {
    amountExclGst: '1000.00', amountIncGst: '1150.00'
  });
});

test('missing tax-inclusive total is derived using cent-accurate 15% GST', () => {
  assert.deepEqual(parseXeroQuoteTotals('Subtotal 6,122.50'), {
    amountExclGst: '6122.50', amountIncGst: '7040.88'
  });
});

test('a missing subtotal is derived from the inclusive quote total, not Total GST', () => {
  assert.deepEqual(parseXeroQuoteTotals('Total GST 3,673.50 Total NZD 28,163.50'), {
    amountExclGst: '24490.00', amountIncGst: '28163.50'
  });
});

test('unrecognized PDF text stays blank for manual confirmation, not an old quote value', () => {
  assert.deepEqual(parseXeroQuoteTotals('Unreadable document'), { amountExclGst: '', amountIncGst: '' });
});
