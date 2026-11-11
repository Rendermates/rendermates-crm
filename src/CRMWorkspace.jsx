import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { db } from './firebase';
import { useCrmAccess } from './crm-access-context';
import { saveCustomer } from './crm-data';
import { ADDRESS_FIELDS, LOSS_REASONS, STATUSES, EMAIL_KINDS, analytics, manages, millis, validateRule } from '../crm-automation/domain';
import './CRMWorkspace.css';

const label = value => String(value).replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
const dateTime = value => millis(value) === null ? 'Not recorded' :
  new Date(millis(value)).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', dateStyle: 'medium', timeStyle: 'short' });
const localDateTime = value => {
  if (millis(value) === null) return '';
  const date = new Date(millis(value)), pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const Field = ({ title, children }) => <label className="crm-field"><span>{title}</span>{children}</label>;
const initialPreferences = job => Object.fromEntries(EMAIL_KINDS.map(kind => [kind, {
  optIn: job.contactPreferences?.[kind]?.optIn === true, source: job.contactPreferences?.[kind]?.source || ''
}]));
function notifyDue(tasks, email) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  for (const task of tasks.filter(t => t.assignedTo === email)) {
    const key = `crm-task-notified:${email}:${task.id}:${task.dueAt}`;
    try {
      if (!localStorage.getItem(key)) {
        new Notification('Rendermates follow-up due', { body: task.title });
        localStorage.setItem(key, '1');
      }
    } catch { /* In-app alert stays available when storage/notifications are blocked. */ }
  }
}
export function TaskReminderStrip({ onOpen }) {
  const access = useCrmAccess();
  const [tasks, setTasks] = useState([]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const stop = onSnapshot(query(collection(db, 'crmTasks'), where('assignedTo', '==', access.email)),
      snap => setTasks(snap.docs.map(d => ({ ...d.data(), id: d.id }))), () => setTasks([]));
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => { stop(); clearInterval(timer); };
  }, [access.email]);
  const due = useMemo(() => tasks.filter(t => t.status === 'open' && millis(t.dueAt) !== null && millis(t.dueAt) <= now), [tasks, now]);
  useEffect(() => notifyDue(due, access.email), [due, access.email]);
  return due.length ? <aside style={{ padding: '10px 24px', background: '#eaf4f7', borderBottom: '1px solid #c4dee6', display: 'flex', gap: 16, alignItems: 'center', font: '13px system-ui' }}>
    <span role="status">{due.length} follow-up{due.length === 1 ? '' : 's'} assigned to you {due.length === 1 ? 'is' : 'are'} due.</span>
    <button onClick={onOpen} style={{ cursor: 'pointer', background: 'white', color: '#176a7d', border: '1px solid #b3d0da', borderRadius: 6, padding: '7px 12px' }}>View tasks</button>
  </aside> : null;
}

export function LostDealDialog({ job, onClose, onSave }) {
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <div className="crm-overlay"><section className="crm-modal" role="dialog" aria-modal="true" aria-labelledby="lost-heading">
    <h2 id="lost-heading">Record lost deal</h2><p>{job.clientName || job.name}</p>
    <form onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('');
      try { await onSave({ lossReason: reason, lossNotes: notes }); onClose(); }
      catch (e) { setError(e.message); } finally { setBusy(false); }
    }}>
      <Field title="Loss reason"><select required value={reason} onChange={e => setReason(e.target.value)}>
        <option value="">Select a reason</option>{LOSS_REASONS.map(r => <option key={r}>{r}</option>)}
      </select></Field>
      <Field title="Loss notes"><textarea required={reason === 'Other'} value={notes} onChange={e => setNotes(e.target.value)} maxLength={4000} /></Field>
      {error && <p role="alert">{error}</p>}
      <div className="crm-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Record loss</button></div>
    </form>
  </section></div>;
}

function ProfileEditor({ job, onClose }) {
  const access = useCrmAccess();
  const [original] = useState(job);
  const [draft, setDraft] = useState(() => ({
    ...job, clientName: job.clientName || job.name || '', email: job.email || job.clientEmail || '', addressDetails: job.addressDetails || {},
    contactPreferences: initialPreferences(job), customerNotes: job.customerNotes || ''
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const change = (key, value) => setDraft(old => ({ ...old, [key]: value }));
  return <div className="crm-overlay"><section className="crm-modal wide" role="dialog" aria-modal="true" aria-labelledby="profile-heading">
    <h2 id="profile-heading">Edit customer profile</h2>
    <p>Only customer fields change. Existing dates, claims, extras and calendar data are preserved. Changing the email address resets email consent; record fresh permission afterward.</p>
    <form onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('');
      try {
        await saveCustomer(db, original, draft, access.email, manages(access.role) ? draft.assignedTo || '' : undefined);
        onClose();
      } catch (e) { setError(e.message); } finally { setBusy(false); }
    }}>
      <div className="crm-form-grid">
        {['clientName', 'email', 'phone'].map(key => <Field key={key} title={key === 'clientName' ? 'Customer name' : label(key)}>
          <input type={key === 'email' ? 'email' : 'text'} required={key === 'clientName'} value={draft[key] || ''} maxLength={key === 'clientName' ? 300 : 200} onChange={e => change(key, e.target.value)} />
        </Field>)}
        <Field title="Sales stage"><select value={draft.status || 'lead'} onChange={e => change('status', e.target.value)}>{STATUSES.map(s => <option value={s} key={s}>{label(s)}</option>)}</select></Field>
        {manages(access.role) && <Field title="Assigned representative email"><input type="email" value={draft.assignedTo || ''} placeholder="Leave blank for unassigned" onChange={e => change('assignedTo', e.target.value)} /></Field>}
        <Field title="Last purchase date"><input type="date" value={draft.lastPurchaseDate || ''} onChange={e => change('lastPurchaseDate', e.target.value)} /></Field>
        <Field title="Next follow-up date"><input type="date" value={draft.nextFollowUpDate || ''} onChange={e => change('nextFollowUpDate', e.target.value)} /></Field>
      </div>
      {draft.status === 'lost' && <div className="crm-form-grid">
        <Field title="Loss reason"><select required value={draft.lossReason || ''} onChange={e => change('lossReason', e.target.value)}><option value="">Select a reason</option>{LOSS_REASONS.map(r => <option key={r}>{r}</option>)}</select></Field>
        <Field title="Loss notes"><textarea required={draft.lossReason === 'Other'} value={draft.lossNotes || ''} onChange={e => change('lossNotes', e.target.value)} /></Field>
      </div>}
      <fieldset><legend>Plain-text address</legend>
        <Field title="Existing / full address"><input value={draft.address || ''} onChange={e => change('address', e.target.value)} /></Field>
        <div className="crm-form-grid">{ADDRESS_FIELDS.map(key => <Field title={label(key)} key={key}>
          <input value={draft.addressDetails[key] || ''} maxLength={500} onChange={e => change('addressDetails', { ...draft.addressDetails, [key]: e.target.value })} />
        </Field>)}</div>
        <small>Structured fields are optional for older records. A formatted plain-text address is kept for compatibility.</small>
      </fieldset>
      <Field title="Customer notes"><textarea rows={4} value={draft.customerNotes} maxLength={10000} onChange={e => change('customerNotes', e.target.value)} /></Field>
      <fieldset><legend>Communication consent</legend><p>No existing customer is opted in automatically. Record how and when permission was obtained.</p>
        {EMAIL_KINDS.map(kind => <div className="crm-consent" key={kind}>
          <label><input type="checkbox" checked={draft.contactPreferences[kind].optIn} onChange={e => change('contactPreferences', {
            ...draft.contactPreferences, [kind]: { ...draft.contactPreferences[kind], optIn: e.target.checked }
          })} /> {label(kind)} emails permitted</label>
          <input aria-label={`${label(kind)} consent source`} placeholder="Consent source / evidence (required if opted in)"
            required={draft.contactPreferences[kind].optIn} maxLength={1000} value={draft.contactPreferences[kind].source}
            onChange={e => change('contactPreferences', { ...draft.contactPreferences, [kind]: { ...draft.contactPreferences[kind], source: e.target.value } })} />
        </div>)}
      </fieldset>
      {error && <p className="crm-error" role="alert">{error}</p>}
      <div className="crm-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save customer'}</button></div>
    </form>
  </section></div>;
}

function CustomerTimeline({ job, relatedJobs }) {
  const access = useCrmAccess();
  const [events, setEvents] = useState({});
  const [text, setText] = useState('');
  const [kind, setKind] = useState('note');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const stops = relatedJobs.flatMap(parent => ['messages', 'activity'].map(name => onSnapshot(collection(db, 'jobs', parent.id, name), snap => {
      setEvents(old => ({ ...old, [`${parent.id}:${name}`]: snap.docs.map(d => ({ ...d.data(), jobId: parent.id, id: `${parent.id}:${d.id}` })) }));
    }, () => setError('History could not load. Check access and deploy the CRM rules before using this module.'))));
    return () => stops.forEach(stop => stop());
  }, [job.id, relatedJobs]);
  const rows = Object.values(events).flat().filter(row => relatedJobs.some(j => j.id === row.jobId));
  for (const parent of relatedJobs) {
    const incoming = parent.message || parent.enquiryMessage || parent.websiteMessage;
    if (incoming && !rows.some(row => row.jobId === parent.id && row.direction === 'incoming' && row.text === incoming)) {
      rows.push({ id: `${parent.id}:original-enquiry`, jobId: parent.id, direction: 'incoming', text: incoming, createdAt: parent.createdAt, source: 'Original website enquiry' });
    }
  }
  rows.sort((a, b) => (millis(b.createdAt) || 0) - (millis(a.createdAt) || 0));
  return <section className="crm-card"><h3>Messages & activity</h3>
    <p>Website enquiries and logged conversations across {relatedJobs.length} accessible record(s) with the same email. Historical inbox emails are not imported. New entries are saved on the selected record.</p>
    {error && <p role="alert" className="crm-error">{error}</p>}
    <ol className="crm-timeline">{rows.map(row => <li key={row.id}>
      <div><strong>{row.direction === 'incoming' ? 'Incoming enquiry' : row.type === 'incoming_logged' ? 'Incoming message · manually logged' : row.type === 'note' ? 'Team note' : 'Activity'}</strong><time>{dateTime(row.createdAt)}</time></div>
      <p>{row.text}</p><small>{row.source || row.actor || 'CRM'} · record #{row.jobId?.slice(-6)}</small>
    </li>)}</ol>
    {!rows.length && <p>No messages recorded yet.</p>}
    <form onSubmit={async e => {
      e.preventDefault(); if (!text.trim()) return; setBusy(true);
      try {
        await addDoc(collection(db, 'jobs', job.id, 'messages'), {
          type: kind, text: text.trim(), actor: access.email, createdAt: new Date().toISOString(), source: 'CRM manual log'
        });
        setText(''); setError('');
      } catch { setError('Could not save this message. Your draft has been kept.'); } finally { setBusy(false); }
    }}>
      <Field title="Log type"><select value={kind} onChange={e => setKind(e.target.value)}><option value="note">Team note</option><option value="incoming_logged">Incoming message (manual entry)</option></select></Field>
      <Field title="Message or note"><textarea required rows={3} maxLength={20000} value={text} onChange={e => setText(e.target.value)} /></Field>
      <button disabled={busy} className="primary">Save timeline entry</button>
    </form>
  </section>;
}

function Tasks({ jobs }) {
  const access = useCrmAccess();
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [draft, setDraft] = useState({ title: '', jobId: '', dueAt: '', assignedTo: access.email });
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    const ref = manages(access.role) ? collection(db, 'crmTasks') : query(collection(db, 'crmTasks'), where('assignedTo', '==', access.email));
    const stop = onSnapshot(ref, snap => setTasks(snap.docs.map(d => ({ ...d.data(), id: d.id }))), () => setError('Tasks could not load. The new access rules must be deployed.'));
    return () => { clearInterval(timer); stop(); };
  }, [access.email, access.role]);
  const due = useMemo(() => tasks.filter(t => t.status === 'open' && millis(t.dueAt) !== null && millis(t.dueAt) <= now), [tasks, now]);
  useEffect(() => notifyDue(due, access.email), [due, access.email]);
  return <section className="crm-card"><div className="crm-section-heading"><h2>Tasks & follow-ups</h2>
    <button onClick={async () => {
      if (typeof Notification === 'undefined') { setError('This browser does not support notifications. In-app alerts still work.'); return; }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') setError('Browser notifications are not enabled. In-app alerts still work.');
    }}>Enable browser reminders</button></div>
    <p>Due times display in Wellington time. Browser alerts require this CRM to remain open; these are not background push notifications.</p>
    {due.length > 0 && <p role="status" className="crm-notice">{due.length} open follow-up{due.length === 1 ? '' : 's'} due now.</p>}
    {error && <p role="alert" className="crm-error">{error}</p>}
    <form className="crm-form-grid" onSubmit={async e => {
      e.preventDefault();
      try {
        if (!draft.title.trim() || !draft.jobId || !Number.isFinite(Date.parse(draft.dueAt))) throw new Error('Choose a customer, title and valid due time.');
        const editable = {
          title: draft.title.trim(), jobId: draft.jobId, assignedTo: manages(access.role) ? draft.assignedTo.trim().toLowerCase() : access.email,
          dueAt: new Date(draft.dueAt).toISOString()
        };
        if (localDateTime(editable.dueAt) !== draft.dueAt) throw new Error('That local time does not exist in your device timezone. Choose a valid due time.');
        if (draft.id) {
          const { jobId: _jobId, ...changes } = editable;
          await updateDoc(doc(db, 'crmTasks', draft.id), { ...changes, updatedAt: new Date().toISOString() });
        } else await addDoc(collection(db, 'crmTasks'), { ...editable, status: 'open', createdBy: access.email, createdAt: new Date().toISOString() });
        setDraft({ title: '', jobId: draft.jobId, dueAt: '', assignedTo: access.email }); setError('');
      } catch (e) { setError(e.message); }
    }}>
      <Field title="Task title"><input required maxLength={500} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></Field>
      <Field title="Customer"><select required disabled={!!draft.id} value={draft.jobId} onChange={e => setDraft({ ...draft, jobId: e.target.value })}><option value="">Choose customer</option>{jobs.map(j => <option value={j.id} key={j.id}>{j.clientName || j.name}</option>)}</select></Field>
      <Field title="Due time (device timezone)"><input type="datetime-local" required value={draft.dueAt} onChange={e => setDraft({ ...draft, dueAt: e.target.value })} /></Field>
      {manages(access.role) && <Field title="Representative email"><input type="email" required value={draft.assignedTo} onChange={e => setDraft({ ...draft, assignedTo: e.target.value })} /></Field>}
      <div className="crm-actions"><button className="primary">{draft.id ? 'Save task changes' : 'Create task'}</button>
        {draft.id && <button type="button" onClick={() => setDraft({ title: '', jobId: '', dueAt: '', assignedTo: access.email })}>Cancel editing</button>}
      </div>
    </form>
    <div className="crm-task-list">{[...tasks].sort((a, b) => (millis(a.dueAt) || 0) - (millis(b.dueAt) || 0)).map(task => <article key={task.id} className={task.status === 'done' ? 'is-done' : ''}>
      <div><strong>{task.title}</strong><p>{jobs.find(j => j.id === task.jobId)?.clientName || 'Assigned customer'} · {dateTime(task.dueAt)}</p><small>{task.assignedTo}</small></div>
      <div className="crm-actions"><button onClick={() => setDraft({ ...task, dueAt: localDateTime(task.dueAt) })}>Edit task</button><button onClick={async () => {
        try { await updateDoc(doc(db, 'crmTasks', task.id), { status: task.status === 'done' ? 'open' : 'done', updatedAt: new Date().toISOString() }); }
        catch { setError('Could not update task.'); }
      }}>{task.status === 'done' ? 'Reopen' : 'Complete'}</button></div>
    </article>)}</div>
    {!tasks.length && <p>No tasks yet. Add the next action for a lead above.</p>}
  </section>;
}

function Metrics({ jobs }) {
  const data = analytics(jobs);
  const maxVolume = Math.max(1, ...data.volume.map(v => v.count));
  const maxLoss = Math.max(1, ...data.losses.map(v => v.count));
  return <section><h2>Sales analytics</h2><p>All recorded deals, including archived work; not unique customers. Test records excluded: {data.excluded}.</p>
    <div className="crm-kpis">{[
      ['Recorded leads', data.total], ['Converted deals', data.won], ['Lead conversion', `${data.conversion.toFixed(1)}%`],
      ['Average sales cycle', data.cycleDays === null ? 'Not enough dates' : `${data.cycleDays.toFixed(1)} days`]
    ].map(([name, value]) => <article className="crm-card" key={name}><span>{name}</span><strong>{value}</strong></article>)}</div>
    <p>Conversion: deals ever recorded as booked, in progress or completed ÷ all recorded deals. Cycle: created → first recorded win; {data.cycleSamples} dated wins, {data.missingCycles} without usable dates. No historical dates are invented.</p>
    <div className="crm-two-columns">
      <section className="crm-card"><h3>Lead volume · last six calendar months</h3><div className="crm-columns" role="img" aria-label={data.volume.map(v => `${v.month}: ${v.count} leads`).join('; ')}>
        {data.volume.map(v => <div key={v.month}><span>{v.count}</span><i style={{ height: `${v.count / maxVolume * 150}px` }} /><small>{v.month}</small></div>)}
      </div><small>Wellington calendar months; current month is partial. Undated leads are omitted from this chart.</small></section>
      <section className="crm-card"><h3>Top deal loss reasons</h3>{data.losses.length ? data.losses.map(row => <div className="crm-bar" key={row.reason}><div><span>{row.reason}</span><strong>{row.count}</strong></div><i style={{ width: `${row.count / maxLoss * 100}%` }} /></div>) : <p>No lost deals with recorded reasons.</p>}</section>
    </div>
  </section>;
}

const blankRule = () => ({ name: '', kind: 'maintenance', trigger: 'maintenance', months: 12, monthDay: '12-15', status: 'completed',
  subject: 'A reminder from {{company}}', body: 'Hi {{name}},\nWe are getting in touch about your property at {{address}}.\nRendermates', enabled: false });
function Automations() {
  const [rules, setRules] = useState([]);
  const [outbox, setOutbox] = useState([]);
  const [control, setControl] = useState(null);
  const [draft, setDraft] = useState(blankRule);
  const [error, setError] = useState('');
  useEffect(() => {
    const fail = () => setError('Automation data could not load. Deploy the new rules and backend before enabling delivery.');
    const stops = [
      onSnapshot(collection(db, 'crmEmailRules'), s => setRules(s.docs.map(d => ({ ...d.data(), id: d.id }))), fail),
      onSnapshot(collection(db, 'crmEmailOutbox'), s => setOutbox(s.docs.map(d => ({ ...d.data(), id: d.id }))), fail),
      onSnapshot(doc(db, '_crmAutomationControl', 'email'), s => setControl(s.exists() ? s.data() : null), fail)
    ];
    return () => stops.forEach(stop => stop());
  }, []);
  return <section className="crm-card"><h2>Email automations</h2>
    <p className="crm-notice">{control?.enabled === true ? 'Backend sending is enabled. Only consented, eligible recipients can be sent email.' : 'Sending is OFF. Rules can be prepared, but a configured sender and explicit backend activation are required.'}</p>
    <p>Maintenance, annual campaigns and follow-ups each need their own opt-in. Every automated email includes an unsubscribe link. Templates support {'{{name}}, {{address}}, {{company}}'}.</p>
    {error && <p role="alert" className="crm-error">{error}</p>}
    <form onSubmit={async e => {
      e.preventDefault();
      try { validateRule(draft); await addDoc(collection(db, 'crmEmailRules'), { ...draft, createdAt: new Date().toISOString() }); setDraft(blankRule()); setError(''); }
      catch (e) { setError(e.message); }
    }}>
      <div className="crm-form-grid">
        <Field title="Rule name"><input required maxLength={200} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></Field>
        <Field title="Consent category"><select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value })}>{EMAIL_KINDS.map(k => <option key={k} value={k}>{label(k)}</option>)}</select></Field>
        <Field title="Trigger"><select value={draft.trigger} onChange={e => setDraft({ ...draft, trigger: e.target.value })}><option value="maintenance">Months after last purchase</option><option value="annual">Annual date / Christmas</option><option value="status">Sales stage change</option><option value="follow_up">Next follow-up date</option></select></Field>
        {draft.trigger === 'maintenance' && <Field title="Months after purchase"><input type="number" min="1" max="120" value={draft.months} onChange={e => setDraft({ ...draft, months: Number(e.target.value) })} /></Field>}
        {draft.trigger === 'annual' && <Field title="Annual date (MM-DD)"><input pattern="[0-9]{2}-[0-9]{2}" value={draft.monthDay} onChange={e => setDraft({ ...draft, monthDay: e.target.value })} /></Field>}
        {draft.trigger === 'status' && <Field title="When stage becomes"><select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}>{STATUSES.map(s => <option key={s} value={s}>{label(s)}</option>)}</select></Field>}
      </div>
      <Field title="Email subject"><input required maxLength={300} value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} /></Field>
      <Field title="Email message"><textarea required rows={5} maxLength={20000} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} /></Field>
      <label className="crm-checkbox"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} /> Enable this rule (global sending switch still applies)</label>
      <button className="primary">Save automation rule</button>
    </form>
    <h3>Prepared rules</h3>{rules.map(rule => <article className="crm-rule" key={rule.id}><div><strong>{rule.name}</strong><p>{label(rule.trigger)} · {label(rule.kind)} · {rule.enabled ? 'Rule enabled' : 'Paused'}</p></div><button onClick={async () => {
      try { await updateDoc(doc(db, 'crmEmailRules', rule.id), { enabled: !rule.enabled }); } catch { setError('Could not change rule.'); }
    }}>{rule.enabled ? 'Pause' : 'Enable rule'}</button></article>)}
    {!rules.length && <p>No rules yet.</p>}
    <h3>Recent delivery records</h3>
    {[...outbox].sort((a, b) => (millis(b.createdAt) || 0) - (millis(a.createdAt) || 0)).slice(0, 30).map(row => <p key={row.id}><strong>{row.ruleName}</strong> · {row.status} · {dateTime(row.createdAt)}</p>)}
    {!outbox.length && <p>No deliveries queued. Creating a rule does not opt anyone in.</p>}
  </section>;
}

export default function CRMWorkspace({ jobs, initialJobId, onBack, onOpenWork, tab = 'customers', onTabChange }) {
  const access = useCrmAccess();
  const [selectedId, setSelectedId] = useState(initialJobId || '');
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState(false);
  const selected = jobs.find(j => j.id === selectedId);
  const relatedJobs = useMemo(() => selected ? jobs.filter(j => j.id === selected.id ||
    ((selected.email || selected.clientEmail) && String(j.email || j.clientEmail || '').toLowerCase() === String(selected.email || selected.clientEmail).toLowerCase())) : [], [jobs, selected]);
  const filtered = jobs.filter(j => `${j.clientName || j.name || ''} ${j.email || ''} ${j.phone || ''} ${j.address || ''}`.toLowerCase().includes(search.toLowerCase()));
  return <main className="crm-workspace"><header className="crm-workspace-header"><div><span className="crm-eyebrow">RENDERMATES · CUSTOMER RELATIONSHIPS</span><h1>Sales & customer workspace</h1><p>Keep the next action, the conversation and the customer together.</p></div><button onClick={onBack}>Back to work overview</button></header>
    <nav className="crm-tabs" aria-label="Sales workspace">{['customers', 'tasks', ...(manages(access.role) ? ['analytics', 'automations'] : [])].map(key => <button key={key} aria-current={tab === key ? 'page' : undefined} onClick={() => onTabChange(key)}>{label(key)}</button>)}</nav>
    {tab === 'customers' && <div className="crm-customer-layout"><aside className="crm-card"><Field title="Search customers"><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, email, phone or address" /></Field>
      <p>{filtered.length} accessible customer / deal records</p><div className="crm-customers">{filtered.map(j => <button key={j.id} className={selectedId === j.id ? 'selected' : ''} onClick={() => { setSelectedId(j.id); setEdit(false); }}><strong>{j.clientName || j.name || 'New lead'}</strong><small>{label(j.status || 'lead')} · {j.email || j.phone || 'No contact details'}</small></button>)}</div>
    </aside><div>{selected ? <>
      <section className="crm-card"><div className="crm-section-heading"><div><span className="crm-eyebrow">{label(selected.status || 'lead')}</span><h2>{selected.clientName || selected.name}</h2></div><button className="primary" onClick={() => setEdit(true)}>Edit customer</button></div>
        <div className="crm-contact-grid"><p><strong>Email</strong>{selected.email || selected.clientEmail || 'Not recorded'}</p><p><strong>Phone</strong>{selected.phone || 'Not recorded'}</p><p><strong>Address</strong>{selected.address || 'Not recorded'}</p><p><strong>Representative</strong>{selected.assignedTo || 'Unassigned · managers only'}</p></div>
        <p className="crm-preserve">{selected.customerNotes || 'No customer notes yet.'}</p>
        {selected.status === 'lost' && <p className="crm-notice">Lost: {selected.lossReason || 'Reason not recorded'} {selected.lossNotes && `— ${selected.lossNotes}`}</p>}
        <p>Next follow-up: {selected.nextFollowUpDate || 'Not set'} · Last purchase: {selected.lastPurchaseDate || 'Not recorded'}</p>
        <p>{EMAIL_KINDS.map(kind => `${label(kind)}: ${selected.contactPreferences?.[kind]?.optIn ? 'opted in' : 'not opted in'}`).join(' · ')}</p>
        <button onClick={() => onOpenWork(selected.id)}>Open job, quote & payments</button>
      </section>
      <CustomerTimeline key={selected.id} job={selected} relatedJobs={relatedJobs} />
      {edit && <ProfileEditor job={selected} onClose={() => setEdit(false)} />}
    </> : <section className="crm-card"><h2>Select a customer</h2><p>Open a record to see the enquiry, history and next steps. Existing jobs remain intact.</p></section>}</div></div>}
    {tab === 'tasks' && <Tasks jobs={jobs} />}
    {tab === 'analytics' && manages(access.role) && <Metrics jobs={jobs} />}
    {tab === 'automations' && manages(access.role) && <Automations />}
  </main>;
}
