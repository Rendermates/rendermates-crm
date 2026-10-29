import React, { useEffect, useState } from 'react';

export default function ClaimDates({ claim, today, onSave }) {
  const [expectedDate, setExpectedDate] = useState(claim.expectedDate || '');
  const [paidDate, setPaidDate] = useState(claim.paidDate || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    setExpectedDate(claim.expectedDate || '');
    setPaidDate(claim.paidDate || '');
  }, [claim.expectedDate, claim.paidDate]);
  const field = { display: 'block', width: '150px', padding: '6px', border: '1px solid #cbd5e1', borderRadius: '6px', marginTop: '3px' };
  return (
    <form onSubmit={async event => {
      event.preventDefault();
      setSaving(true);
      setMessage('');
      try {
        await onSave(claim.id, { expectedDate, paidDate: claim.status === 'Paid' ? paidDate : '' });
        setMessage('Dates saved');
      } catch (error) {
        setMessage(`Could not save: ${error.message}`);
      } finally {
        setSaving(false);
      }
    }} style={{ display: 'grid', gap: '7px', fontSize: '11px' }}>
      <label>Expected receipt
        <input aria-label={`Expected receipt for ${claim.description}`} type="date" value={expectedDate} onChange={event => setExpectedDate(event.target.value)} style={field} />
      </label>
      {claim.status === 'Paid' && (
        <label>Received on
          <input aria-label={`Received on for ${claim.description}`} type="date" max={today} required value={paidDate} onChange={event => setPaidDate(event.target.value)} style={field} />
        </label>
      )}
      {(claim.status === 'Paid' ? !paidDate : !expectedDate) && <span style={{ color: '#92400e' }}>No date set — excluded from monthly totals</span>}
      <button type="submit" disabled={saving} style={{ padding: '6px', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', color: '#0369a1', background: '#f0f9ff' }}>{saving ? 'Saving…' : 'Save dates'}</button>
      <span role="status">{message}</span>
    </form>
  );
}
