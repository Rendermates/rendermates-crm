import React, { useEffect, useState } from 'react';
import { PlusCircle, Trash2 } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { backCostRowCents, backCostSummary, validBackCostRow } from './back-cost';
import { formatMoney } from './work-finance';

const fieldStyle = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px' };
const cellStyle = { padding: '14px 16px' };

export default function BackCost({ job }) {
  const [rows, setRows] = useState(() => job.backCosts || []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!dirty) setRows(job.backCosts || []);
  }, [job.backCosts, dirty]);

  const totals = backCostSummary(rows);
  const quantity = value => Number(value.toFixed(4)).toLocaleString('en-NZ', { maximumFractionDigits: 4 });
  const change = next => {
    setRows(next);
    setDirty(true);
    setMessage('');
    setError('');
  };
  const edit = (id, field, value) => change(rows.map(row => row.id === id ? { ...row, [field]: value } : row));
  const save = async event => {
    event.preventDefault();
    if (!rows.every(validBackCostRow) || !Number.isSafeInteger(totals.cost)) {
      setError('Enter a description and valid, non-negative days, hours and rate for every row.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await updateDoc(doc(db, 'jobs', job.id), {
        backCosts: rows.map(row => ({
          id: row.id, description: row.description.trim(),
          days: Number(row.days), hoursPerDay: Number(row.hoursPerDay), rate: Number(row.rate),
          amount: backCostRowCents(row) / 100
        }))
      });
      setDirty(false);
      setMessage('Back Cost saved.');
    } catch (err) {
      setError('Could not save Back Cost: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save}>
      <fieldset disabled={saving} style={{ border: 'none', margin: 0, padding: 0, minWidth: 0 }}>
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px', marginBottom: '22px' }}>
          <div style={{ fontSize: '14px', fontWeight: '800', color: '#0f172a', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <PlusCircle size={16} color="#0284c7" /> Actual Labour Costs
          </div>
          <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 12px' }}>
            Days worked × hours per day × hourly rate. Costs are excl. GST and do not change the Xero quote, Extras or customer payments.
          </p>
          <button type="button" onClick={() => change([...rows, { id: crypto.randomUUID(), description: '', days: '', hoursPerDay: '', rate: '' }])}
            style={{ background: '#0284c7', color: 'white', border: 'none', borderRadius: '8px', padding: '10px 16px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <PlusCircle size={16} /> Add Row
          </button>
        </div>
        <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '12px', marginBottom: '22px' }}>
          <table style={{ width: '100%', minWidth: '820px', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead style={{ background: '#f8fafc', color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
              <tr>{['Description / Worker Name', 'Days Worked', 'Hours per Day', 'Hourly Rate ($)', 'Row Total (Excl. GST)', 'Actions'].map(label => (
                <th key={label} scope="col" style={cellStyle}>{label}</th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>No back costs recorded yet for this job. Click Add Row to get started.</td></tr>
              ) : rows.map((row, index) => (
                <tr key={row.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ ...cellStyle, minWidth: '220px' }}>
                    <input aria-label={`Description / Worker Name ${index + 1}`} value={row.description} onChange={e => edit(row.id, 'description', e.target.value)} placeholder="e.g. Worker name or labour" style={fieldStyle} required />
                  </td>
                  {[['days', 'Days Worked'], ['hoursPerDay', 'Hours per Day'], ['rate', 'Hourly Rate']].map(([field, label]) => (
                    <td key={field} style={cellStyle}>
                      <input aria-label={`${label} ${index + 1}`} type="number" min="0" step="any" value={row[field]} onChange={e => edit(row.id, field, e.target.value)} style={{ ...fieldStyle, minWidth: '100px' }} required />
                    </td>
                  ))}
                  <td style={{ ...cellStyle, fontWeight: '700', whiteSpace: 'nowrap' }}>{formatMoney(backCostRowCents(row))}</td>
                  <td style={{ ...cellStyle, textAlign: 'right' }}>
                    <button type="button" aria-label={`Remove back cost row ${index + 1}`} onClick={() => change(rows.filter(item => item.id !== row.id))}
                      style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}><Trash2 size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <section aria-label="Back Cost Summary" style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '10px', padding: '16px', color: '#065f46' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px' }}>Back Cost Summary</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', fontSize: '14px' }}>
            <div>Total Days: <strong>{quantity(totals.days)}</strong></div>
            <div>Total Hours: <strong>{quantity(totals.hours)}</strong></div>
            <div>Total Back Cost: <strong>{formatMoney(totals.cost)}</strong> excl. GST</div>
          </div>
          <p style={{ margin: '10px 0 0', fontSize: '12px' }}>Total days adds each worker’s days, not calendar days. Changes are saved with the button below.</p>
        </section>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '16px' }}>
          <button type="submit" disabled={!dirty || saving} style={{ background: '#0284c7', color: 'white', border: 'none', borderRadius: '8px', padding: '10px 16px', fontWeight: '700', cursor: dirty ? 'pointer' : 'default', opacity: dirty ? 1 : 0.6 }}>
            {saving ? 'Saving…' : 'Save Back Cost'}
          </button>
          <span role="status" style={{ fontSize: '13px', color: '#64748b' }}>{dirty ? 'Unsaved changes' : message}</span>
          {error && <span role="alert" style={{ fontSize: '13px', color: '#dc2626' }}>{error}</span>}
        </div>
      </fieldset>
    </form>
  );
}
