import React, { useState } from 'react';
import { jobContractCents, jobOutstandingCents, groupBookedMonths } from './work-finance';

const money = cents => (cents / 100).toLocaleString('en-NZ', { style: 'currency', currency: 'NZD' });

export default function WorkGroup({ group, renderJob }) {
  const [open, setOpen] = useState(Boolean(group.open));
  const parts = group.months ? groupBookedMonths(group.jobs) : group.completed ? [
    { key: 'outstanding', label: 'Balance outstanding', jobs: group.jobs.filter(job => jobOutstandingCents(job) > 0) },
    { key: 'settled', label: 'Fully paid', jobs: group.jobs.filter(job => jobContractCents(job) > 0 && jobOutstandingCents(job) === 0) },
    { key: 'unknown', label: 'Contract amount not set', jobs: group.jobs.filter(job => jobContractCents(job) <= 0) },
  ].filter(part => part.jobs.length) : null;
  return (
    <section style={{ marginBottom: '16px', border: '1px solid #e2e8f0', borderRadius: '14px', background: '#fff', padding: '16px' }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', width: '100%', border: 0, padding: '2px', background: 'transparent', cursor: 'pointer', textAlign: 'left', color: '#0f172a' }}>
        <strong style={{ fontSize: '17px' }}>{open ? '▾' : '▸'} {group.label} ({group.jobs.length})</strong>
        <span style={{ color: '#64748b', fontSize: '12px' }}>Contracted: {money(group.jobs.reduce((sum, job) => sum + jobContractCents(job), 0))} excl. GST</span>
      </button>
      {open && (parts ? parts.map(part => (
        <WorkGroup key={part.key} group={{ ...part, open: false }} renderJob={renderJob} />
      )) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: '16px', marginTop: '14px' }}>
          {group.jobs.map(renderJob)}
        </div>
      ))}
    </section>
  );
}
