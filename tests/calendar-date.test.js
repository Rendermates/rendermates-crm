import test from 'node:test';
import assert from 'node:assert/strict';
import { getCalendarDateHighlights } from '../src/calendar-date.js';

test('highlights only the current month and exact current day', () => {
  assert.deepEqual(getCalendarDateHighlights('2026-10-29', 2026, 9, 29), { isCurrentMonth: true, isToday: true });
  assert.deepEqual(getCalendarDateHighlights('2026-10-29', 2026, 9, 28), { isCurrentMonth: true, isToday: false });
  assert.deepEqual(getCalendarDateHighlights('2026-10-29', 2026, 10, 29), { isCurrentMonth: false, isToday: false });
  assert.deepEqual(getCalendarDateHighlights('2026-10-29', 2025, 9, 29), { isCurrentMonth: false, isToday: false });
});

test('moves the highlights across month and year boundaries', () => {
  assert.equal(getCalendarDateHighlights('2026-11-01', 2026, 9, 31).isToday, false);
  assert.deepEqual(getCalendarDateHighlights('2026-11-01', 2026, 10, 1), { isCurrentMonth: true, isToday: true });
  assert.deepEqual(getCalendarDateHighlights('2027-01-01', 2027, 0, 1), { isCurrentMonth: true, isToday: true });
  assert.deepEqual(getCalendarDateHighlights('2027-01-01', 2026, 11, 31), { isCurrentMonth: false, isToday: false });
});

test('handles leap day and a month without a day argument', () => {
  assert.deepEqual(getCalendarDateHighlights('2028-02-29', 2028, 1, 29), { isCurrentMonth: true, isToday: true });
  assert.deepEqual(getCalendarDateHighlights('2028-02-29', 2028, 1), { isCurrentMonth: true, isToday: false });
});
