import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { enquiryAddress, enquiryMessages } from './enquiry-details';

export default function WebsiteEnquiry({ job }) {
  const [history, setHistory] = useState({ jobId: null, rows: [], status: 'loading' });
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
  </section>;
}
