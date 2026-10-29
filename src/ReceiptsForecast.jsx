import React, { useState } from 'react';
import { buildReceiptsForecast, monthLabel } from './work-finance';

const name = job => job.clientName || job.name || 'Unnamed job';
export default function ReceiptsForecast({ jobs, today, onOpenJob }) {
  const [includeGst, setIncludeGst] = useState(true);
  const forecast = buildReceiptsForecast(jobs, today);
  const displayCents = cents => includeGst ? Math.round(cents * 1.15) : cents;
  const money = cents => (cents / 100)
    .toLocaleString('en-NZ', { style: 'currency', currency: 'NZD' });
  const amount = cents => money(displayCents(cents));
  const total = rows => money(rows.reduce((sum, row) => sum + displayCents(row.cents), 0));
  const cell = { padding: '12px', textAlign: 'right', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' };
  const openJob = job => <button type="button" onClick={() => onOpenJob(job.id)} style={{ background: 'none', border: 0, color: '#0369a1', textDecoration: 'underline', cursor: 'pointer', textAlign: 'left' }}>{name(job)}{job.archived || job.archivedAt ? ' (Archived)' : ''}</button>;
  return (
    <section aria-label="Receipts forecast" style={{ background: '#fff', padding: '22px', border: '1px solid #e2e8f0', borderRadius: '14px', marginBottom: '20px' }}>
      <h2 style={{ marginTop: 0 }}>Receipts Forecast</h2>
      <p style={{ color: '#475569', fontSize: '13px' }}>Deposit, Progress and Final claims, grouped by payment date — not the job start date. Unpaid stages use their expected receipt date; paid stages use their actual received date. Archived balances remain included.</p>
      <p style={{ color: '#64748b', fontSize: '12px' }}>Receipts only, not profit or net cash flow. Quotes and leads are excluded from committed forecasts. Amounts assume full payment of each stage; split a stage into separate claims for partial payments.</p>
      <label style={{ display: 'block', marginBottom: '16px', fontSize: '13px' }}><input type="checkbox" checked={includeGst} onChange={event => setIncludeGst(event.target.checked)} /> Include 15% GST</label>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '18px' }}>
        <strong style={{ padding: '12px', background: '#fff1f2', color: '#9f1239', borderRadius: '8px' }}>Overdue: {total(forecast.overdue)}</strong>
        <strong style={{ padding: '12px', background: '#fffbeb', color: '#92400e', borderRadius: '8px' }}>Unpaid — no date set: {total(forecast.undated.filter(row => !row.paid))}</strong>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <caption style={{ textAlign: 'left', padding: '8px', color: '#64748b' }}>Amounts {includeGst ? 'including' : 'excluding'} GST · overdue is part of unpaid expected, not an additional amount.</caption>
          <thead><tr><th style={{ ...cell, textAlign: 'left' }}>Month</th><th style={cell}>Unpaid expected</th><th style={cell}>Received</th><th style={cell}>Of expected: overdue</th></tr></thead>
          <tbody>{forecast.months.map(month => (
            <tr key={month.key} style={{ background: month.key === today.slice(0, 7) ? '#fffbeb' : '#fff' }}>
              <td style={{ ...cell, textAlign: 'left', whiteSpace: 'normal' }}>
                <details><summary style={{ cursor: 'pointer', fontWeight: '700' }}>{monthLabel(month.key)} · {month.rows.length} stage(s)</summary>
                  {month.rows.map((row, index) => <div key={`${row.job.id}-${row.claim.id}-${index}`} style={{ padding: '8px 0' }}>{openJob(row.job)} — {row.claim.description || row.claim.stageType} · {row.date} · {amount(row.cents)} · {row.paid ? 'Received' : row.overdue ? 'Overdue' : row.claim.status || 'To Invoice'}</div>)}
                  {month.rows.length === 0 && <p>No dated receipts recorded.</p>}
                </details>
              </td>
              <td style={cell}>{total(month.rows.filter(row => !row.paid))}</td><td style={{ ...cell, color: '#047857' }}>{total(month.rows.filter(row => row.paid))}</td><td style={{ ...cell, color: '#be123c' }}>{total(month.rows.filter(row => row.overdue))}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <details style={{ marginTop: '20px' }} open={forecast.undated.length > 0}>
        <summary style={{ fontWeight: '800', cursor: 'pointer' }}>No date set ({forecast.undated.length})</summary>
        <p style={{ color: '#64748b', fontSize: '12px' }}>Historical dates are never inferred from the creation date or job schedule. Open a job to set the correct date.</p>
        {forecast.undated.map((row, index) => <p key={`${row.job.id}-${row.claim.id}-${index}`} style={{ fontSize: '13px' }}>{openJob(row.job)} — {row.claim.description || row.claim.stageType} · {amount(row.cents)} · {row.paid ? 'Paid — received date not recorded' : 'Expected date not set'}</p>)}
        {!forecast.undated.length && <p>No undated stages.</p>}
      </details>
      <details style={{ marginTop: '20px' }}>
        <summary style={{ fontWeight: '800', cursor: 'pointer' }}>Contract amounts not yet assigned to payment stages ({forecast.unstaged.length} jobs)</summary>
        <p style={{ fontSize: '12px', color: '#64748b' }}>These balances are not included in monthly totals. Add Deposit, Progress or Final stages and expected dates to forecast them. Extra costs must also be included in a payment stage; they are not counted twice automatically.</p>
        {forecast.unstaged.map(row => <p key={row.job.id}>{openJob(row.job)} — {amount(row.cents)}</p>)}
      </details>
    </section>
  );
}
