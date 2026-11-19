import { moneyCents } from './work-finance.js';

export const backCostRowCents = row => moneyCents(Number(row.days) * Number(row.hoursPerDay) * Number(row.rate));

export const backCostSummary = rows => rows.reduce((total, row) => ({
  days: total.days + (Number(row.days) || 0),
  hours: total.hours + (Number(row.days) || 0) * (Number(row.hoursPerDay) || 0),
  cost: total.cost + backCostRowCents(row)
}), { days: 0, hours: 0, cost: 0 });

export const validBackCostRow = row => Boolean(row.description.trim()) &&
  [row.days, row.hoursPerDay, row.rate].every(value => value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0) &&
  Number.isFinite(Number(row.days) * Number(row.hoursPerDay) * Number(row.rate) * 100) &&
  Number.isSafeInteger(backCostRowCents(row));
