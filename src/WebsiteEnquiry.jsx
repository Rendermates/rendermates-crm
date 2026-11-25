import React, { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { db } from './firebase';
import { enquiryAddress, enquiryMessages } from './enquiry-details';

export default function WebsiteEnquiry({ job }) {
  const [history, setHistory] = useState({ jobId: null, rows: [], status: 'loading' });
  const [notes, setNotes] = useState(job.enquiryNotes || '');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [saveError, setSaveError] = useState('');
  useEffect(() => {
    if (!dirty) setNotes(job.enquiryNotes || '');
  }, [job.enquiryNotes, dirty]);
  const editNotes = value => {
    setNotes(value);
    setDirty(true);
    setSaveStatus('');
    setSaveError('');
  };
  const saveNotes = async event => {
    event.preventDefault();
    setSaving(true);
    setSaveStatus('');
    setSaveError('');
    try {
      await updateDoc(doc(db, 'jobs', job.id), { enquiryNotes: notes });
      setDirty(false);
      setSaveStatus('Notes saved.');
    } catch (error) {
      setSaveError('Could not save notes: ' + error.message);
    } finally {
      setSaving(false);
    }
  };
  useEffect(() => {
    const ref = query(collection(db, 'jobs', job.id, 'messages'), where('direction', '==', 'incoming'));
    return onSnapshot(ref, snap => setHistory({
      jobId: job.id, rows: snap.docs.map(d => ({ ...d.data(), id: d.id })), status: 'ready'
    }), () => setHistory({ jobId: job.id, rows: [], status: 'error' }));
  }, [job.id]);
  const current = history.jobId === job.id ? history : { rows: [], status: 'loading' };
  const messages = enquiryMessages(job, current.rows);
  const address = enquiryAddress(job);
  return <section aria-label="Website enquiry details" style={{
    background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '12px',
    padding: '18px', marginBottom: '20px', color: '#0f172a', overflowWrap: 'anywhere'
  }}>
    <h2 style={{ fontSize: '16px', margin: '0 0 14px' }}>Website enquiry details</h2>
    <h3 style={{ fontSize: '13px', margin: '0 0 5px', color: '#075985' }}>Property address</h3>
    <p style={{ margin: '0 0 16px', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
      {address || 'Address not recorded. Add it in Customer profile & messages.'}
    </p>
    <h3 style={{ fontSize: '13px', margin: '0 0 5px', color: '#075985' }}>Customer’s form message</h3>
    {messages.map(row => <p key={row.id} style={{
      whiteSpace: 'pre-wrap', lineHeight: 1.7, margin: '8px 0', background: '#fff',
      borderRadius: '8px', border: '1px solid #e0f2fe', padding: '12px'
    }}>{row.text}</p>)}
    {!messages.length && current.status === 'loading' && <p role="status">Loading saved enquiry…</p>}
    {current.status === 'error' && <p role="alert">
      Saved message history could not load. Try again by reopening this contact.
    </p>}
    {!messages.length && current.status === 'ready' && <p style={{ marginBottom: 0, lineHeight: 1.6 }}>
      No form message is saved on this contact. Check the original website notification email or Elementor submission.
      You can preserve it in Customer profile & messages → Incoming message (manual entry).
    </p>}
    <form onSubmit={saveNotes} style={{ marginTop: '18px', paddingTop: '16px', borderTop: '1px solid #bae6fd' }}>
      <label htmlFor={`enquiry-notes-${job.id}`} style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#075985', marginBottom: '6px' }}>
        Job notes
      </label>
      <p id={`enquiry-notes-help-${job.id}`} style={{ fontSize: '12px', color: '#475569', margin: '0 0 10px' }}>
        Add, edit or remove notes whenever needed. The customer’s original message above stays unchanged. Click Save notes to keep your changes.
      </p>
      <textarea id={`enquiry-notes-${job.id}`} aria-describedby={`enquiry-notes-help-${job.id}`}
        value={notes} onChange={event => editNotes(event.target.value)} disabled={saving}
        rows={5} maxLength={20000} placeholder="Write notes about this enquiry or job…"
        style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '8px', font: 'inherit', fontSize: '13px', lineHeight: 1.6, resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '10px' }}>
        <button type="submit" disabled={saving || !dirty} style={{ background: '#0284c7', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 16px', fontWeight: '700', cursor: saving || !dirty ? 'default' : 'pointer', opacity: saving || !dirty ? 0.6 : 1 }}>
          {saving ? 'Saving…' : 'Save notes'}
        </button>
        <button type="button" disabled={saving || !notes} onClick={() => editNotes('')}
          style={{ background: '#fff', color: '#dc2626', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '10px 16px', cursor: saving || !notes ? 'default' : 'pointer' }}>Clear notes</button>
        <span role="status" style={{ fontSize: '12px', color: '#475569' }}>{saving ? 'Saving…' : dirty ? 'Unsaved changes' : saveStatus}</span>
        {saveError && <span role="alert" style={{ fontSize: '12px', color: '#dc2626' }}>{saveError}</span>}
      </div>
    </form>
  </section>;
}
