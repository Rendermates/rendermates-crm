import React, { useState, useEffect } from 'react';
import { getCalendarDateHighlights } from './calendar-date';
import WorkGroup from './WorkGroup';
import ReceiptsForecast from './ReceiptsForecast';
import ClaimDates from './ClaimDates';
import { groupWork, isDateKey } from './work-finance';
import { db } from './firebase';
import { collection, addDoc, onSnapshot, query, orderBy, updateDoc, doc } from 'firebase/firestore';
import { 
  Plus, Phone, MapPin, DollarSign, PlusCircle, Trash2, X, FileText, 
  FileUp, Check, Zap, Eye, ExternalLink, Edit2, CheckCircle2, Clock, 
  ArrowLeft, ChevronRight, ChevronLeft, Briefcase, FileCheck, Layers, Calendar, 
  Compass, Globe, Search, Share2, Tag, AlertTriangle, Archive, ArchiveRestore, ChevronDown, Mail
} from 'lucide-react';

const FacebookIcon = ({ size = 16, color = '#2563eb' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
  </svg>
);

const InstagramIcon = ({ size = 16, color = '#e11d48' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
  </svg>
);

const STAGES = [
  { id: 'lead', label: 'New Lead', color: '#dc2626', bg: '#fee2e2', cardBg: '#fff1f2', cardAccent: '#ef4444' },
  { id: 'site_visit', label: 'Site Visit Scheduled', color: '#0284c7', bg: '#e0f2fe', cardBg: '#EFF6FF', cardAccent: '#2563EB' },
  { id: 'quoted', label: 'Quote Sent', color: '#8b5cf6', bg: '#ede9fe', cardBg: '#F5F3FF', cardAccent: '#7C3AED' },
  { id: 'booked', label: 'Booked / Future Work', color: '#0f766e', bg: '#ccfbf1', cardBg: '#FFFBEB', cardAccent: '#D97706' },
  { id: 'in_progress', label: 'In Progress', color: '#0ea5e9', bg: '#e0f2fe', cardBg: '#ECFDF5', cardAccent: '#059669' },
  { id: 'completed', label: 'Completed', color: '#10b981', bg: '#d1fae5', cardBg: '#F1F5F9', cardAccent: '#64748B' }
];

const getJobsByStage = (jobs, stageId) =>
  stageId === 'all' ? jobs : jobs.filter(job => (job.status || 'lead') === stageId);

const isJobArchived = job => Boolean(job?.archived || job?.archivedAt);
const getJobName = job => job?.clientName || job?.name || 'New Lead';

const getBookedJobs = jobs =>
  jobs.filter(job => job.status === 'booked' || job.status === 'in_progress' || (job.startDate && job.endDate));

const LEAD_SOURCES = [
  { id: 'website', label: 'Website (Organic)', color: '#059669', bg: '#d1fae5', icon: Globe },
  { id: 'instagram', label: 'Instagram', color: '#e11d48', bg: '#ffe4e6', icon: InstagramIcon },
  { id: 'facebook', label: 'Facebook', color: '#2563eb', bg: '#dbeafe', icon: FacebookIcon },
  { id: 'google', label: 'Google Search / Ads', color: '#d97706', bg: '#fef3c7', icon: Search },
  { id: 'builderscrack', label: 'Builderscrack', color: '#ea580c', bg: '#ffedd5', icon: Tag },
  { id: 'referral', label: 'Word of Mouth / Referral', color: '#7c3aed', bg: '#ede9fe', icon: Share2 },
  { id: 'direct', label: 'Direct / Phone / Email', color: '#475569', bg: '#f1f5f9', icon: Phone }
];

const JOB_PALETTE = [
  { border: '#0284c7', bg: '#e0f2fe', text: '#0369a1', badge: '#0284c7' },
  { border: '#16a34a', bg: '#dcfce7', text: '#15803d', badge: '#16a34a' },
  { border: '#d97706', bg: '#fef3c7', text: '#b45309', badge: '#d97706' },
  { border: '#7c3aed', bg: '#ede9fe', text: '#6d28d9', badge: '#7c3aed' },
  { border: '#e11d48', bg: '#ffe4e6', text: '#be123c', badge: '#e11d48' },
  { border: '#0d9488', bg: '#ccfbf1', text: '#0f766e', badge: '#0d9488' },
  { border: '#ea580c', bg: '#ffedd5', text: '#c2410c', badge: '#ea580c' },
  { border: '#4f46e5', bg: '#e0e7ff', text: '#3730a3', badge: '#4f46e5' }
];

const MONTHS_NZ = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const getLocalDateInputValue = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const createEmptyExtra = () => ({
  description: '',
  date: getLocalDateInputValue(),
  hours: '',
  rate: '',
  amount: ''
});

const getExtraAmount = (hours, rate) => {
  if (hours === '' || rate === '') return '';
  const total = Number(hours) * Number(rate);
  return Number.isFinite(total) && Number(hours) >= 0 && Number(rate) >= 0
    ? total.toFixed(2)
    : '';
};

const formatExtraDate = (date = '') => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('en-NZ');
  }
  return date;
};

export default function App() {
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [activeTab, setActiveTab] = useState('claims');
  const [filterStage, setFilterStage] = useState('all');
  const [filterSource, setFilterSource] = useState('all');
  const [showArchivedJobs, setShowArchivedJobs] = useState(false);
  const [newLeadsCollapsed, setNewLeadsCollapsed] = useState(true);
  const [dashboardTab, setDashboardTab] = useState('jobs');
  const [showNewJobModal, setShowNewJobModal] = useState(false);
  const [showCalendarView, setShowCalendarView] = useState(false);
  const [currentDate, setCurrentDate] = useState(getLocalDateInputValue);
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());
  const [expandedMonthIdx, setExpandedMonthIdx] = useState(null);

  useEffect(() => {
    let timer;
    const refreshCurrentDate = () => {
      clearTimeout(timer);
      setCurrentDate(getLocalDateInputValue());
      const now = new Date();
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = setTimeout(refreshCurrentDate, nextMidnight.getTime() - now.getTime() + 100);
    };
    refreshCurrentDate();
    window.addEventListener('focus', refreshCurrentDate);
    document.addEventListener('visibilitychange', refreshCurrentDate);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refreshCurrentDate);
      document.removeEventListener('visibilitychange', refreshCurrentDate);
    };
  }, []);

  const [newJob, setNewJob] = useState({
    clientName: '',
    phone: '',
    address: '',
    system: 'Sto',
    sqm: '',
    contractAmount: '',
    status: 'lead',
    source: 'website',
    siteVisitDate: '',
    siteVisitTime: '09:00',
    siteVisitNotes: '',
    startDate: '',
    endDate: ''
  });

  const [quoteData, setQuoteData] = useState({ quoteNumber: '', amountExclGst: '', amountIncGst: '', fileName: '', pdfDataUrl: '' });
  const [isProcessingPdf, setIsProcessingPdf] = useState(false);
  const [newExtra, setNewExtra] = useState(createEmptyExtra);
  const [claimStageType, setClaimStageType] = useState('Deposit');
  const [customStageText, setCustomStageText] = useState('');
  const [claimMode, setClaimMode] = useState('percent');
  const [claimInputValue, setClaimInputValue] = useState('10');
  const [claimInvoiceNo, setClaimInvoiceNo] = useState('');
  const [claimExpectedDate, setClaimExpectedDate] = useState('');
  const [editingInvoiceId, setEditingInvoiceId] = useState(null);
  const [editingInvoiceVal, setEditingInvoiceVal] = useState('');

  const [visitDate, setVisitDate] = useState('');
  const [visitTime, setVisitTime] = useState('09:00');
  const [visitNotes, setVisitNotes] = useState('');
  const [jobStartDate, setJobStartDate] = useState('');
  const [jobEndDate, setJobEndDate] = useState('');

  useEffect(() => {
    if (!window.pdfjsLib) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = () => {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }
      };
      document.head.appendChild(script);
    }

    const q = query(collection(db, 'jobs'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loaded = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setJobs(loaded);
    });
    return () => unsubscribe();
  }, []);

  const selectedJob = jobs.find(j => j.id === selectedJobId) || null;
  const activeJobs = jobs.filter(job => !isJobArchived(job));
  const archivedJobs = jobs.filter(isJobArchived);
  const currentListJobs = showArchivedJobs ? archivedJobs : activeJobs;

  useEffect(() => {
    if (selectedJob) {
      setVisitDate(selectedJob.siteVisitDate || '');
      setVisitTime(selectedJob.siteVisitTime || '09:00');
      setVisitNotes(selectedJob.siteVisitNotes || '');
      setJobStartDate(selectedJob.startDate || '');
      setJobEndDate(selectedJob.endDate || '');
    }
  }, [selectedJobId]);

  const bookedJobs = getBookedJobs(activeJobs);

  const upcomingReminders = bookedJobs.filter(j => {
    if (!j.startDate) return false;
    const start = new Date(j.startDate);
    const today = new Date();
    const diffDays = Math.ceil((start - today) / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= 7;
  });

  const baseContract = Number(selectedJob?.contractAmount) || 0;
  const totalExtras = (selectedJob?.extras || []).reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
  const totalContractExclGst = baseContract + totalExtras;
  const gstAmount = totalContractExclGst * 0.15;
  const totalContractIncGst = totalContractExclGst * 1.15;
  const totalPaid = (selectedJob?.claims || []).filter(c => c.status === 'Paid').reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
  const remainingUnpaid = totalContractExclGst - totalPaid;
  const percentPaid = totalContractExclGst > 0 ? ((totalPaid / totalContractExclGst) * 100).toFixed(1) : 0;

  const extrasList = selectedJob?.extras || [];
  const pendingExtras = extrasList.filter(x => !x.invoiced);
  const invoicedExtras = extrasList.filter(x => x.invoiced);

  const handleStageSelect = async (newStatus) => {
    if (!selectedJob) return;
    try {
      const updates = { status: newStatus };
      if (newStatus === 'in_progress' && !selectedJob.startDate) {
        updates.startDate = new Date().toISOString().split('T')[0];
      }
      await updateDoc(doc(db, 'jobs', selectedJob.id), updates);
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleArchiveJob = async (job) => {
    if (!job?.id) return;
    const wasArchived = isJobArchived(job);
    try {
      await updateDoc(doc(db, 'jobs', job.id), wasArchived
        ? { archived: false, archivedAt: null }
        : { archived: true, archivedAt: new Date().toISOString() });
      if (selectedJobId === job.id) setSelectedJobId(null);
    } catch (err) {
      alert((wasArchived ? 'Error restoring job: ' : 'Error archiving job: ') + err.message);
    }
  };

  const handleSaveJobDates = async (e) => {
    e.preventDefault();
    if (!selectedJob) return;
    try {
      await updateDoc(doc(db, 'jobs', selectedJob.id), {
        startDate: jobStartDate,
        endDate: jobEndDate,
        status: selectedJob.status === 'lead' || selectedJob.status === 'quoted' ? 'booked' : selectedJob.status
      });
      alert('Job Schedule updated & linked to Annual Calendar!');
    } catch (err) {
      alert('Error updating schedule: ' + err.message);
    }
  };

  const handleCreateJob = async (e) => {
    e.preventDefault();
    if (!newJob.clientName || !newJob.address) return;
    try {
      const docRef = await addDoc(collection(db, 'jobs'), {
        ...newJob,
        sqm: Number(newJob.sqm) || 0,
        contractAmount: Number(newJob.contractAmount) || 0,
        extras: [],
        claims: [],
        createdAt: new Date()
      });
      setShowNewJobModal(false);
      setNewJob({ clientName: '', phone: '', address: '', system: 'Sto', sqm: '', contractAmount: '', status: 'lead', source: 'website', siteVisitDate: '', siteVisitTime: '09:00', siteVisitNotes: '', startDate: '', endDate: '' });
      setSelectedJobId(docRef.id);
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const handleSaveSiteVisit = async (e) => {
    e.preventDefault();
    if (!selectedJob) return;
    try {
      await updateDoc(doc(db, 'jobs', selectedJob.id), {
        siteVisitDate: visitDate,
        siteVisitTime: visitTime,
        siteVisitNotes: visitNotes,
        status: 'site_visit'
      });
      alert('Site Visit scheduled and linked!');
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const generateGoogleCalendarUrl = (job, dateStr, timeStr, notesStr) => {
    if (!job || !dateStr) return '#';
    const cleanDate = dateStr.replace(/-/g, '');
    const cleanTime = (timeStr || '09:00').replace(/:/g, '') + '00';
    const startIso = `${cleanDate}T${cleanTime}`;
    const startHour = parseInt((timeStr || '09:00').split(':')[0], 10);
    const endHour = (startHour + 1).toString().padStart(2, '0');
    const endMinute = (timeStr || '09:00').split(':')[1] || '00';
    const endIso = `${cleanDate}T${endHour}${endMinute}00`;

    const title = `Site Visit — ${getJobName(job)} (Rendermates)`;
    const details = `Client: ${getJobName(job)}\nPhone: ${job.phone || 'N/A'}\nSystem: ${job.system || 'Sto'}\nNotes: ${notesStr || job.siteVisitNotes || 'Exterior plastering & coating inspection'}`;
    const location = job.address || '';

    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${startIso}/${endIso}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(location)}`;
  };

  const generateJobCalendarUrl = (job) => {
    if (!job || !job.startDate || !job.endDate) return '#';
    const startIso = job.startDate.replace(/-/g, '');
    const endDateObj = new Date(job.endDate);
    endDateObj.setDate(endDateObj.getDate() + 1);
    const endIso = endDateObj.toISOString().split('T')[0].replace(/-/g, '');

    const title = `ACTIVE PROJECT: ${getJobName(job)} — ${job.system} (Rendermates)`;
    const details = `Site: ${job.address}\nPhone: ${job.phone || 'N/A'}\nContract: $${job.contractAmount || 0} Excl. GST\nSystem: ${job.system}\nArea: ${job.sqm || 0} m²`;
    const location = job.address || '';

    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${startIso}/${endIso}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(location)}`;
  };

  const handlePdfUpload = async (file) => {
    if (!file) return;
    setIsProcessingPdf(true);

    const nameMatch = file.name.match(/(QU\d+|QUOTE[\-_]?\d+|\d{4,})/i);
    let extractedQuoteNum = nameMatch ? nameMatch[0].toUpperCase() : '';
    let parsedExcl = '';
    let parsedInc = '';

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      const originalPdfDataUrl = reader.result;

      if (file.type === 'application/pdf' && window.pdfjsLib) {
        try {
          const arrayBuffer = await file.arrayBuffer();
          const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          let fullText = '';
          for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            fullText += content.items.map(it => it.str).join(' ') + ' ';
          }

          if (!extractedQuoteNum) {
            const qMatch = fullText.match(/(?:Quote\s*(?:No|Number|#)?:?\s*)(QU[0-9]+|[0-9]{4,})/i);
            if (qMatch) extractedQuoteNum = qMatch[1];
          }

          const subtotalMatch = fullText.match(/(?:Total\s*(?:excl|excluding)?\s*GST|Subtotal)\s*[:\$]?\s*([0-9,]+\.[0-9]{2})/i);
          const totalIncMatch = fullText.match(/(?:Total\s*(?:inc|including)?\s*GST|Amount\s*Due|Total\s*NZD)\s*[:\$]?\s*([0-9,]+\.[0-9]{2})/i);

          parsedExcl = subtotalMatch ? parseFloat(subtotalMatch[1].replace(/,/g, '')) : '';
          parsedInc = totalIncMatch ? parseFloat(totalIncMatch[1].replace(/,/g, '')) : '';

          if (parsedExcl && !parsedInc) parsedInc = (parsedExcl * 1.15).toFixed(2);
          else if (!parsedExcl && parsedInc) parsedExcl = (parsedInc / 1.15).toFixed(2);
        } catch (err) {
          console.warn('PDF parser error:', err);
        }
      }

      setQuoteData({
        fileName: file.name,
        quoteNumber: extractedQuoteNum || 'QU-NEW',
        amountExclGst: parsedExcl || '',
        amountIncGst: parsedInc || '',
        pdfDataUrl: originalPdfDataUrl
      });
      setIsProcessingPdf(false);
    };
  };

  const handleSaveQuoteToJob = async (e) => {
    e.preventDefault();
    if (!selectedJob || !quoteData.amountExclGst) return;

    try {
      const updatePayload = {
        contractAmount: Number(quoteData.amountExclGst) || 0,
        quoteNumber: quoteData.quoteNumber || '',
        quoteFileName: quoteData.fileName || '',
        status: 'quoted'
      };
      if (quoteData.pdfDataUrl) {
        updatePayload.originalPdf = quoteData.pdfDataUrl;
      }

      await updateDoc(doc(db, 'jobs', selectedJob.id), updatePayload);
      setQuoteData({ quoteNumber: '', amountExclGst: '', amountIncGst: '', fileName: '', pdfDataUrl: '' });
      alert('Quote attached & Contract Total updated successfully!');
    } catch (err) {
      alert('Error updating quote: ' + err.message);
    }
  };

  const handleAddExtra = async (e) => {
    e.preventDefault();
    const amount = Number(newExtra.amount);
    const hours = newExtra.hours === '' ? null : Number(newExtra.hours);
    const rate = newExtra.rate === '' ? null : Number(newExtra.rate);
    if (
      !newExtra.description.trim() ||
      !/^\d{4}-\d{2}-\d{2}$/.test(newExtra.date) ||
      newExtra.amount === '' ||
      !Number.isFinite(amount) ||
      amount < 0 ||
      [hours, rate].some(value => value !== null && (!Number.isFinite(value) || value < 0))
    ) return;
    const item = {
      id: Date.now().toString(),
      description: newExtra.description.trim(),
      date: newExtra.date,
      hours,
      rate,
      amount,
      invoiced: false,
    };
    try {
      await updateDoc(doc(db, 'jobs', selectedJob.id), {
        extras: [...(selectedJob.extras || []), item]
      });
      setNewExtra(createEmptyExtra());
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const handleToggleExtraInvoiced = async (extraId) => {
    const updated = (selectedJob.extras || []).map(item => {
      if (item.id === extraId) return { ...item, invoiced: !item.invoiced };
      return item;
    });
    await updateDoc(doc(db, 'jobs', selectedJob.id), { extras: updated });
  };

  const handleDeleteExtra = async (id) => {
    const updated = (selectedJob.extras || []).filter(x => x.id !== id);
    await updateDoc(doc(db, 'jobs', selectedJob.id), { extras: updated });
  };

  const existingClaims = selectedJob?.claims || [];
  const progressClaimsCount = existingClaims.filter(c => c.stageType?.startsWith('Progress') || c.description?.toLowerCase().includes('progress')).length;

  const handleAddClaim = async (e) => {
    e.preventDefault();
    let finalAmount = 0;
    let percentage = 0;

    const inputNum = parseFloat(claimInputValue) || 0;
    if (claimMode === 'percent') {
      percentage = inputNum;
      finalAmount = totalContractExclGst > 0 ? (totalContractExclGst * (percentage / 100)) : 0;
    } else {
      finalAmount = inputNum;
      percentage = totalContractExclGst > 0 ? ((finalAmount / totalContractExclGst) * 100) : 0;
    }

    if (!Number.isFinite(finalAmount) || finalAmount <= 0) {
      alert('Please enter a valid amount or percentage.');
      return;
    }
    if (claimExpectedDate && !isDateKey(claimExpectedDate)) {
      alert('Please enter a valid expected receipt date.');
      return;
    }

    const description = claimStageType === 'Custom'
      ? (customStageText.trim() || 'Custom Claim')
      : claimStageType;

    const item = {
      id: Date.now().toString(),
      stageType: claimStageType,
      description: description,
      percentage: Number(percentage.toFixed(1)),
      amount: Number(finalAmount.toFixed(2)),
      expectedDate: claimExpectedDate,
      invoiceNo: claimInvoiceNo.trim() || 'Pending',
      status: 'To Invoice',
      date: new Date().toLocaleDateString('en-NZ')
    };

    try {
      await updateDoc(doc(db, 'jobs', selectedJob.id), {
        claims: [...existingClaims, item]
      });

      if (claimStageType === 'Deposit') {
        setClaimStageType('Progress Claim 1');
        setClaimInputValue('25');
      } else if (claimStageType.startsWith('Progress Claim')) {
        setClaimStageType(`Progress Claim ${progressClaimsCount + 2}`);
        setClaimInputValue('25');
      }
      setClaimInvoiceNo('');
      setClaimExpectedDate('');
      setCustomStageText('');
    } catch (err) {
      alert('Error adding claim: ' + err.message);
    }
  };

  const handleToggleClaimStatus = async (id) => {
    const claim = selectedJob.claims.find(item => item.id === id);
    if (!claim) return;
    if (claim.status === 'Invoiced' && !window.confirm('Mark this stage as paid today? You can correct the received date using Save dates.')) return;
    if (claim.status === 'Paid' && !window.confirm('Undo this payment? It will return to To Invoice and its received date will be cleared.')) return;
    const updated = (selectedJob.claims || []).map(c => {
      if (c.id === id) {
        const nextStatus = c.status === 'To Invoice' ? 'Invoiced' : (c.status === 'Invoiced' ? 'Paid' : 'To Invoice');
        return { ...c, status: nextStatus, paidDate: nextStatus === 'Paid' ? getLocalDateInputValue() : '' };
      }
      return c;
    });
    try {
      await updateDoc(doc(db, 'jobs', selectedJob.id), { claims: updated });
    } catch (error) {
      alert('Could not update payment status: ' + error.message);
    }
  };

  const handleSaveClaimDates = async (id, dates) => {
    const claim = selectedJob.claims.find(item => item.id === id);
    if (!claim) throw new Error('Payment stage no longer exists.');
    if (dates.expectedDate && !isDateKey(dates.expectedDate)) throw new Error('Enter a valid expected receipt date.');
    if (claim.status === 'Paid' && (!isDateKey(dates.paidDate) || dates.paidDate > getLocalDateInputValue())) {
      throw new Error('Enter a received date that is today or earlier.');
    }
    await updateDoc(doc(db, 'jobs', selectedJob.id), {
      claims: selectedJob.claims.map(item => item.id === id ? { ...item, ...dates } : item)
    });
  };

  const handleSaveInlineInvoiceNo = async (claimId) => {
    const updated = (selectedJob.claims || []).map(c => {
      if (c.id === claimId) {
        return {
          ...c,
          invoiceNo: editingInvoiceVal.trim() || 'Pending',
          status: editingInvoiceVal.trim() && c.status === 'To Invoice' ? 'Invoiced' : c.status
        };
      }
      return c;
    });
    await updateDoc(doc(db, 'jobs', selectedJob.id), { claims: updated });
    setEditingInvoiceId(null);
    setEditingInvoiceVal('');
  };

  const handleDeleteClaim = async (id) => {
    const updated = (selectedJob.claims || []).filter(c => c.id !== id);
    await updateDoc(doc(db, 'jobs', selectedJob.id), { claims: updated });
  };

  const openPdfNewTab = (pdfDataUrl) => {
    if (!pdfDataUrl) return;
    try {
      const parts = pdfDataUrl.split(',');
      const byteCharacters = atob(parts[1]);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/pdf' });
      window.open(URL.createObjectURL(blob), '_blank');
    } catch (e) {
      window.open(pdfDataUrl, '_blank');
    }
  };

  const filteredJobs = getJobsByStage(currentListJobs, filterStage).filter(j => {
    const matchSource = filterSource === 'all' || (j.source || 'website') === filterSource;
    return matchSource;
  });
  const showNewLeadsSection = !showArchivedJobs && (filterStage === 'all' || filterStage === 'lead');
  const newLeadJobs = showNewLeadsSection ? filteredJobs.filter(j => !j.status || j.status === 'lead') : [];
  const otherFilteredJobs = showNewLeadsSection ? filteredJobs.filter(j => j.status && j.status !== 'lead') : filteredJobs;

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', color: '#0f172a', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      
      {!selectedJob ? (
        <div style={{ padding: '24px', maxWidth: '1280px', margin: '0 auto' }}>
          
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', background: '#ffffff', padding: '18px 24px', borderRadius: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid #e2e8f0', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                <img src="/logo.png" alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '<span style="color:#fff;font-weight:bold;font-size:18px;">R</span>'; }} />
              </div>
              <div>
                <h1 style={{ fontSize: '20px', fontWeight: '800', margin: 0, color: '#0f172a' }}>Rendermates <span style={{ color: '#0284c7' }}>CRM</span></h1>
                <p style={{ margin: '2px 0 0 0', color: '#64748b', fontSize: '13px' }}>Jobs Portfolio & Schedule Master</p>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                onClick={() => { setDashboardTab('jobs'); setShowCalendarView(!showCalendarView); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: showCalendarView ? '#0f172a' : '#f8fafc',
                  color: showCalendarView ? '#ffffff' : '#0284c7',
                  border: '1.5px solid #0284c7',
                  padding: '10px 18px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: '800',
                  fontSize: '13px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                  transition: 'all 0.15s ease'
                }}
              >
                <Calendar size={17} /> {showCalendarView ? 'Show Jobs Grid' : `📅 Booked Calendar (${bookedJobs.length})`}
              </button>

              <button
                onClick={() => {
                  setShowArchivedJobs(current => !current);
                  setDashboardTab('jobs');
                  setFilterStage('all');
                  setFilterSource('all');
                  setShowCalendarView(false);
                }}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', background: showArchivedJobs ? '#f1f5f9' : '#fff1f2', color: showArchivedJobs ? '#475569' : '#be123c', border: '1px solid #fecdd3', padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: '800', fontSize: '13px' }}
              >
                {showArchivedJobs ? <Briefcase size={17} /> : <Archive size={17} />}
                {showArchivedJobs ? 'Active Jobs (' + activeJobs.length + ')' : 'Archived (' + archivedJobs.length + ')'}
              </button>

              <button
                onClick={() => setShowNewJobModal(true)}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#0284c7', color: '#ffffff', border: 'none', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '14px', boxShadow: '0 2px 4px rgba(2, 132, 199, 0.2)' }}
              >
                <Plus size={18} /> New Job
              </button>
            </div>
          </header>

          <div role="tablist" aria-label="Dashboard views" style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
            {[['jobs', 'Work Overview'], ['receipts', 'Receipts Forecast']].map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={dashboardTab === key} onClick={() => setDashboardTab(key)}
                style={{ padding: '12px 20px', borderRadius: '9px', border: '1px solid #0284c7', background: dashboardTab === key ? '#0284c7' : '#fff', color: dashboardTab === key ? '#fff' : '#0369a1', fontWeight: '800', cursor: 'pointer' }}>{label}</button>
            ))}
          </div>
          {dashboardTab === 'receipts' && <ReceiptsForecast jobs={jobs} today={currentDate} onOpenJob={id => { setSelectedJobId(id); setActiveTab('claims'); }} />}
          {dashboardTab === 'jobs' && <>

          {upcomingReminders.length > 0 && (
            <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '12px', padding: '14px 18px', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <AlertTriangle size={20} color="#b45309" />
                <span style={{ fontSize: '13px', color: '#92400e', fontWeight: '700' }}>
                  <strong>Upcoming Start Date Alert:</strong> You have {upcomingReminders.length} project(s) scheduled to start in the next 7 days!
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {upcomingReminders.map(rem => (
                  <button
                    key={rem.id}
                    onClick={() => { setSelectedJobId(rem.id); setActiveTab('site_visit'); }}
                    style={{ background: '#ffffff', border: '1px solid #f59e0b', color: '#b45309', padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '800', cursor: 'pointer' }}
                  >
                    {getJobName(rem)} (Starts: {rem.startDate}) →
                  </button>
                ))}
              </div>
            </div>
          )}

          {showCalendarView && (
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '24px', marginBottom: '24px', boxShadow: '0 2px 6px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid #f1f5f9', paddingBottom: '16px' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Calendar size={20} color="#0284c7" /> Annual Project Schedule & Gap Detector ({calendarYear})
                  </h2>
                  <p style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: '13px' }}>
                    Click on any month below to open the complete Day-by-Day schedule preview.
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button onClick={() => setCalendarYear(calendarYear - 1)} style={{ background: '#f1f5f9', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: '800' }}><ChevronLeft size={16} /></button>
                  <span style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a' }}>{calendarYear}</span>
                  <button onClick={() => setCalendarYear(calendarYear + 1)} style={{ background: '#f1f5f9', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: '800' }}><ChevronRight size={16} /></button>
                </div>
              </div>

              {/* 12 MESES CLICÁVEIS */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <div style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', color: '#64748b' }}>
                    12-Month Coverage Overview
                  </div>
                  {expandedMonthIdx !== null && (
                    <button
                      onClick={() => setExpandedMonthIdx(null)}
                      style={{ background: 'none', border: 'none', color: '#0284c7', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                    >
                      ✕ Close expanded preview
                    </button>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px' }}>
                  {MONTHS_NZ.map((monthName, mIdx) => {
                    const currentMonthStart = new Date(calendarYear, mIdx, 1);
                    const currentMonthEnd = new Date(calendarYear, mIdx + 1, 0);

                    const activeInMonth = bookedJobs.filter(j => {
                      if (!j.startDate || !j.endDate) return false;
                      const s = new Date(j.startDate);
                      const e = new Date(j.endDate);
                      return s <= currentMonthEnd && e >= currentMonthStart;
                    });

                    const hasGap = activeInMonth.length === 0;
                    const isSelected = expandedMonthIdx === mIdx;
                    const { isCurrentMonth } = getCalendarDateHighlights(currentDate, calendarYear, mIdx);

                    return (
                      <div
                        key={monthName}
                        data-current-month={isCurrentMonth ? 'true' : undefined}
                        onClick={() => setExpandedMonthIdx(isSelected ? null : mIdx)}
                        style={{
                          border: isSelected ? '2px solid #0284c7' : (hasGap ? '1px dashed #cbd5e1' : '1.5px solid #0284c7'),
                          borderRadius: '10px',
                          padding: '12px',
                          background: isCurrentMonth ? '#fffbeb' : (isSelected ? '#eff6ff' : (hasGap ? '#f8fafc' : '#ffffff')),
                          outline: isCurrentMonth ? '2px solid #d97706' : 'none',
                          outlineOffset: '2px',
                          minHeight: '85px',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          transform: isSelected ? 'scale(1.02)' : 'none',
                          boxShadow: isSelected ? '0 4px 12px rgba(2, 132, 199, 0.15)' : 'none'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: '800', fontSize: '13px', color: isSelected ? '#0284c7' : '#0f172a' }}>
                            {monthName}
                            {isCurrentMonth && <span style={{ display: 'block', marginTop: '3px', fontSize: '10px', color: '#92400e' }}>Current month</span>}
                          </span>
                          <span style={{ fontSize: '10px', fontWeight: '800', padding: '2px 6px', borderRadius: '4px', background: hasGap ? '#fef2f2' : '#dcfce7', color: hasGap ? '#dc2626' : '#15803d' }}>
                            {hasGap ? 'OPEN GAP' : `${activeInMonth.length} Job(s)`}
                          </span>
                        </div>

                        <div style={{ marginTop: '6px' }}>
                          {activeInMonth.map((jb) => {
                            const originalIdx = bookedJobs.findIndex(b => b.id === jb.id);
                            const pal = JOB_PALETTE[originalIdx % JOB_PALETTE.length];
                            return (
                              <div
                                key={jb.id}
                                style={{
                                  fontSize: '11px',
                                  fontWeight: '700',
                                  background: pal.bg,
                                  color: pal.text,
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  marginBottom: '3px',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis'
                                }}
                              >
                                • {getJobName(jb)}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* PREVIEW COMPLETO DO MÊS COM DIAS 1 A 31 (CALENDÁRIO MENSAL INTEGRADO) */}
              {expandedMonthIdx !== null && (() => {
                const monthName = MONTHS_NZ[expandedMonthIdx];
                const daysInMonth = new Date(calendarYear, expandedMonthIdx + 1, 0).getDate();
                const firstDayWeekday = (new Date(calendarYear, expandedMonthIdx, 1).getDay() + 6) % 7; // Segunda = 0

                // Obter obras que tocam este mês
                const currentMonthStart = new Date(calendarYear, expandedMonthIdx, 1);
                const currentMonthEnd = new Date(calendarYear, expandedMonthIdx + 1, 0);
                const activeInMonth = bookedJobs.filter(j => {
                  if (!j.startDate || !j.endDate) return false;
                  const s = new Date(j.startDate);
                  const e = new Date(j.endDate);
                  return s <= currentMonthEnd && e >= currentMonthStart;
                });

                // Calcular ocupação de cada dia
                const daysArray = [];
                for (let i = 0; i < firstDayWeekday; i++) {
                  daysArray.push({ empty: true });
                }

                let busyDaysCount = 0;
                for (let day = 1; day <= daysInMonth; day++) {
                  const dayDate = new Date(calendarYear, expandedMonthIdx, day);
                  const formattedDayStr = `${calendarYear}-${String(expandedMonthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  
                  const runningJobs = activeInMonth.filter(j => {
                    return formattedDayStr >= j.startDate && formattedDayStr <= j.endDate;
                  });

                  if (runningJobs.length > 0) busyDaysCount++;

                  daysArray.push({
                    dayNumber: day,
                    dateStr: formattedDayStr,
                    jobs: runningJobs
                  });
                }

                const occupancyPct = Math.round((busyDaysCount / daysInMonth) * 100);

                return (
                  <div style={{ marginTop: '24px', background: '#f8fafc', border: '2px solid #0284c7', borderRadius: '14px', padding: '22px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>
                          📅 {monthName} {calendarYear} — Full Month Schedule Preview
                          {getCalendarDateHighlights(currentDate, calendarYear, expandedMonthIdx).isCurrentMonth && (
                            <span style={{ display: 'inline-block', marginLeft: '8px', padding: '3px 8px', borderRadius: '6px', background: '#fef3c7', color: '#92400e', fontSize: '11px', verticalAlign: 'middle' }}>Current month</span>
                          )}
                        </h3>
                        <p style={{ margin: '3px 0 0 0', fontSize: '13px', color: '#64748b' }}>
                          <strong>{busyDaysCount}</strong> of <strong>{daysInMonth}</strong> days booked ({occupancyPct}% schedule capacity) • <strong>{daysInMonth - busyDaysCount}</strong> free days
                        </p>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '12px', fontWeight: '800', padding: '4px 10px', borderRadius: '6px', background: occupancyPct > 70 ? '#dcfce7' : (occupancyPct > 0 ? '#e0f2fe' : '#fef2f2'), color: occupancyPct > 70 ? '#15803d' : (occupancyPct > 0 ? '#0284c7' : '#dc2626') }}>
                          {occupancyPct > 70 ? '🔥 High Occupancy' : (occupancyPct > 0 ? '⚡ Available Capacity' : '⚠️ Entire Month Open')}
                        </span>
                        <button
                          onClick={() => setExpandedMonthIdx(null)}
                          style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                        >
                          ✕ Close
                        </button>
                      </div>
                    </div>

                    {/* GRELHA CALENDÁRIO COM 7 COLUNAS (SEG A DOM) */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px', marginBottom: '20px' }}>
                      {WEEKDAYS.map(w => (
                        <div key={w} style={{ textAlign: 'center', fontSize: '11px', fontWeight: '800', color: '#64748b', padding: '6px 0', textTransform: 'uppercase', background: '#f1f5f9', borderRadius: '6px' }}>
                          {w}
                        </div>
                      ))}

                      {daysArray.map((cell, idx) => {
                        if (cell.empty) {
                          return <div key={`empty-${idx}`} style={{ minHeight: '68px', background: 'transparent' }} />;
                        }

                        const hasJobs = cell.jobs && cell.jobs.length > 0;
                        const { isToday } = getCalendarDateHighlights(currentDate, calendarYear, expandedMonthIdx, cell.dayNumber);
                        return (
                          <div
                            key={cell.dayNumber}
                            aria-current={isToday ? 'date' : undefined}
                            style={{
                              minHeight: '75px',
                              background: isToday ? '#fffbeb' : (hasJobs ? '#ffffff' : '#f8fafc'),
                              border: hasJobs ? '1.5px solid #0284c7' : '1px dashed #cbd5e1',
                              outline: isToday ? '2px solid #d97706' : 'none',
                              outlineOffset: '1px',
                              borderRadius: '8px',
                              padding: '6px',
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'space-between',
                              boxShadow: hasJobs ? '0 1px 3px rgba(0,0,0,0.05)' : 'none'
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '12px', fontWeight: '800', color: isToday ? '#ffffff' : (hasJobs ? '#0f172a' : '#94a3b8'), background: isToday ? '#b45309' : 'transparent', borderRadius: '50%', minWidth: '24px', height: '24px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                {cell.dayNumber}
                              </span>
                              {isToday && <span style={{ fontSize: '10px', fontWeight: '800', color: '#92400e' }}>Today</span>}
                              {!hasJobs && !isToday && (
                                <span style={{ fontSize: '9px', fontWeight: '700', color: '#94a3b8' }}>Free</span>
                              )}
                            </div>

                            <div style={{ marginTop: '4px' }}>
                              {cell.jobs && cell.jobs.map((job) => {
                                const originalIdx = bookedJobs.findIndex(b => b.id === job.id);
                                const pal = JOB_PALETTE[originalIdx % JOB_PALETTE.length];
                                return (
                                  <div
                                    key={job.id}
                                    onClick={() => { setSelectedJobId(job.id); setActiveTab('site_visit'); }}
                                    style={{
                                      fontSize: '10px',
                                      fontWeight: '800',
                                      background: pal.bg,
                                      color: pal.text,
                                      borderLeft: `3px solid ${pal.badge}`,
                                      padding: '2px 4px',
                                      borderRadius: '3px',
                                      marginBottom: '2px',
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      cursor: 'pointer'
                                    }}
                                    title={`${getJobName(job)} (${job.startDate} to ${job.endDate})`}
                                  >
                                    {getJobName(job)}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* LISTAGEM DETALHADA DAS OBRAS DESTE MÊS */}
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', color: '#64748b', marginBottom: '8px' }}>
                        Booked Projects in {monthName}
                      </div>

                      {activeInMonth.length === 0 ? (
                        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '14px', color: '#dc2626', fontSize: '13px', fontWeight: '700' }}>
                          No active projects booked in {monthName} yet. This month is completely open!
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {activeInMonth.map((job) => {
                            const originalIdx = bookedJobs.findIndex(b => b.id === job.id);
                            const pal = JOB_PALETTE[originalIdx % JOB_PALETTE.length];
                            
                            let durationDays = 0;
                            if (job.startDate && job.endDate) {
                              const diff = new Date(job.endDate) - new Date(job.startDate);
                              durationDays = Math.ceil(diff / (1000 * 60 * 60 * 24)) + 1;
                            }

                            return (
                              <div
                                key={job.id}
                                style={{
                                  background: '#ffffff',
                                  border: `1.5px solid ${pal.border}`,
                                  borderRadius: '10px',
                                  padding: '12px 16px',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  flexWrap: 'wrap',
                                  gap: '10px'
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: pal.border }} />
                                  <div>
                                    <span style={{ fontWeight: '800', fontSize: '14px', color: pal.text }}>{getJobName(job)}</span>
                                    <span style={{ fontSize: '13px', color: '#64748b', marginLeft: '6px' }}>— {job.address}</span>
                                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                                      System: <strong>{job.system}</strong> {job.sqm ? `(${job.sqm} m²)` : ''} • Contract: <strong>${(Number(job.contractAmount) || 0).toLocaleString('en-NZ')}</strong> Excl. GST
                                    </div>
                                  </div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  <span style={{ fontSize: '12px', fontWeight: '800', color: pal.text }}>
                                    📅 {job.startDate} → {job.endDate} ({durationDays} days)
                                  </span>

                                  <a
                                    href={generateJobCalendarUrl(job)}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ background: '#ffffff', border: `1.5px solid ${pal.border}`, color: pal.text, padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '800', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}
                                  >
                                    Google Cal <ExternalLink size={11} />
                                  </a>

                                  <button
                                    onClick={() => { setSelectedJobId(job.id); setActiveTab('site_visit'); }}
                                    style={{ background: pal.border, color: '#ffffff', border: 'none', padding: '6px 12px', borderRadius: '6px', fontWeight: '800', fontSize: '11px', cursor: 'pointer' }}
                                  >
                                    Manage Dates
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                  </div>
                );
              })()}

            </div>
          )}

          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '14px 20px', marginBottom: '20px', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <span style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Globe size={14} color="#0284c7" /> Lead Sources Tracker (Website & Channels)
              </span>
              <span style={{ fontSize: '12px', color: '#64748b' }}>{showArchivedJobs ? 'Archived Jobs:' : 'Active Jobs:'} <strong>{currentListJobs.length}</strong></span>
            </div>
            
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                onClick={() => setFilterSource('all')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '16px',
                  border: filterSource === 'all' ? '2px solid #0284c7' : '1px solid #e2e8f0',
                  background: filterSource === 'all' ? '#e0f2fe' : '#f8fafc',
                  color: filterSource === 'all' ? '#0284c7' : '#475569',
                  fontWeight: '700',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                All Sources ({currentListJobs.length})
              </button>
              {LEAD_SOURCES.map(source => {
                const count = currentListJobs.filter(j => (j.source || 'website') === source.id).length;
                const IconComponent = source.icon;
                return (
                  <button
                    key={source.id}
                    onClick={() => setFilterSource(source.id)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '16px',
                      border: filterSource === source.id ? `2px solid ${source.color}` : '1px solid #e2e8f0',
                      background: filterSource === source.id ? source.bg : '#ffffff',
                      color: filterSource === source.id ? source.color : '#475569',
                      fontWeight: '700',
                      fontSize: '12px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px'
                    }}
                  >
                    <IconComponent size={13} color={source.color} />
                    {source.label}: <strong>{count}</strong>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', overflowX: 'auto', paddingBottom: '4px' }}>
            <button
              onClick={() => setFilterStage('all')}
              style={{
                padding: '8px 16px',
                borderRadius: '20px',
                border: '1px solid',
                borderColor: filterStage === 'all' ? '#0284c7' : '#cbd5e1',
                background: filterStage === 'all' ? '#0284c7' : '#ffffff',
                color: filterStage === 'all' ? '#ffffff' : '#475569',
                fontWeight: '700',
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              All Stages ({currentListJobs.length})
            </button>
            {STAGES.map(s => {
              const count = getJobsByStage(currentListJobs, s.id).length;
              return (
                <button
                  key={s.id}
                  onClick={() => setFilterStage(s.id)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '20px',
                    border: '1px solid',
                    borderColor: filterStage === s.id ? s.color : '#cbd5e1',
                    background: filterStage === s.id ? s.bg : '#ffffff',
                    color: filterStage === s.id ? s.color : '#475569',
                    fontWeight: '700',
                    fontSize: '13px',
                    cursor: 'pointer'
                  }}
                >
                  {s.label} ({count})
                </button>
              );
            })}
          </div>

          {showNewLeadsSection && (
            <section aria-labelledby="new-leads-heading" style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '14px', marginBottom: '18px', overflow: 'hidden' }}>
              <button
                type="button"
                onClick={() => setNewLeadsCollapsed(current => !current)}
                aria-expanded={!newLeadsCollapsed}
                aria-controls="new-leads-content"
                style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '14px 18px', border: 'none', background: 'transparent', color: '#9f1239', textAlign: 'left', cursor: 'pointer' }}
              >
                <span>
                  <span id="new-leads-heading" style={{ display: 'block', fontSize: '16px', fontWeight: '800' }}>New Leads <span style={{ background: '#ffe4e6', borderRadius: '999px', padding: '2px 8px', marginLeft: '6px' }}>{newLeadJobs.length}</span></span>
                  <span style={{ display: 'block', fontSize: '12px', color: '#9f1239', marginTop: '3px' }}>New enquiries waiting for review</span>
                </span>
                <ChevronDown size={19} style={{ transform: newLeadsCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease', flexShrink: 0 }} />
              </button>
              <div id="new-leads-content" hidden={newLeadsCollapsed} style={{ padding: '0 14px 14px' }}>
                {newLeadJobs.length === 0 ? (
                  <p style={{ margin: 0, padding: '8px 4px', color: '#9f1239', fontSize: '13px' }}>No new leads at the moment.</p>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                    {newLeadJobs.map(job => {
                      const leadSource = LEAD_SOURCES.find(src => src.id === (job.source || 'website')) || LEAD_SOURCES[0];
                      const LeadSourceIcon = leadSource.icon;
                      const leadEmail = job.email || job.clientEmail;
                      const leadMessage = job.message || job.enquiryMessage || job.websiteMessage;
                      return (
                        <div key={job.id} onClick={() => { setSelectedJobId(job.id); setActiveTab('site_visit'); }} style={{ background: '#fffafa', border: '1px solid #fecdd3', borderLeft: '4px solid #ef4444', borderRadius: '10px', padding: '14px', cursor: 'pointer', boxShadow: '0 1px 3px rgba(127, 29, 29, 0.06)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                            <div style={{ minWidth: 0 }}>
                              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: '#7f1d1d', overflowWrap: 'anywhere' }}>{getJobName(job)}</h3>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: leadSource.bg, color: leadSource.color, padding: '2px 7px', borderRadius: '7px', fontSize: '10px', fontWeight: '700', marginTop: '5px' }}><LeadSourceIcon size={11} color={leadSource.color} /> {leadSource.label}</span>
                            </div>
                            <span style={{ background: '#fee2e2', color: '#b91c1c', padding: '3px 8px', borderRadius: '999px', fontSize: '10px', fontWeight: '800', whiteSpace: 'nowrap' }}>New Lead</span>
                          </div>
                          <div style={{ marginTop: '10px', fontSize: '12px', color: '#57534e', display: 'flex', alignItems: 'flex-start', gap: '6px' }}><MapPin size={13} color="#ef4444" style={{ flexShrink: 0, marginTop: '1px' }} /><span>{job.address || 'No property address supplied'}</span></div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '8px', fontSize: '12px' }}>
                            {job.phone && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: '#57534e' }}><Phone size={12} /> {job.phone}</span>}
                            {leadEmail && <a href={'mailto:' + leadEmail} onClick={event => event.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: '#9f1239', textDecoration: 'none', overflowWrap: 'anywhere' }}><Mail size={12} /> {leadEmail}</a>}
                          </div>
                          {leadMessage && <div style={{ marginTop: '10px', padding: '9px 10px', background: '#fff1f2', borderRadius: '8px', color: '#7f1d1d', fontSize: '12px', lineHeight: 1.45 }}><strong style={{ display: 'block', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '3px' }}>Enquiry message</strong><span style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 3, overflow: 'hidden', whiteSpace: 'pre-wrap' }}>{leadMessage}</span></div>}
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                            <button type="button" onClick={event => { event.stopPropagation(); handleToggleArchiveJob(job); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: '#ffffff', border: '1px solid #fda4af', color: '#9f1239', padding: '6px 9px', borderRadius: '7px', cursor: 'pointer', fontSize: '11px', fontWeight: '800' }}><Archive size={13} /> Archive</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          )}

          <div>
            {otherFilteredJobs.length === 0 ? (
              showNewLeadsSection && newLeadJobs.length > 0 ? null : (
              <div style={{ gridColumn: '1 / -1', background: '#ffffff', borderRadius: '12px', padding: '48px', textAlign: 'center', border: '1px solid #e2e8f0', color: '#94a3b8' }}>
                <Briefcase size={40} style={{ margin: '0 auto 12px auto' }} />
                <h3 style={{ margin: 0, color: '#475569' }}>No jobs match current filter</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px' }}>Change your stage or source filter above, or click "+ New Job".</p>
              </div>
              )
            ) : (
              (showArchivedJobs ? [{ key: 'archived', label: 'Archived Jobs', open: true, jobs: otherFilteredJobs }] : groupWork(otherFilteredJobs)).map(group => (
                <WorkGroup key={group.key} group={group} renderJob={job => {
                const jExtras = (job.extras || []).reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
                const jContract = (Number(job.contractAmount) || 0) + jExtras;
                const jPaid = (job.claims || []).filter(c => c.status === 'Paid').reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
                const jRemaining = jContract - jPaid;
                const jStage = STAGES.find(s => s.id === job.status) || STAGES[0];
                const jSource = LEAD_SOURCES.find(src => src.id === (job.source || 'website')) || LEAD_SOURCES[0];
                const SourceIcon = jSource.icon;
                const jPendingExtras = (job.extras || []).filter(x => !x.invoiced);

                return (
                  <div
                    key={job.id}
                    onClick={() => { setSelectedJobId(job.id); setActiveTab('site_visit'); }}
                    style={{
                      background: jStage.cardBg,
                      borderRadius: '14px',
                      padding: '20px',
                      border: `1px solid ${jStage.cardAccent}44`,
                      borderLeft: `4px solid ${jStage.cardAccent}`,
                      boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
                      cursor: 'pointer',
                      transition: 'transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0,0,0,0.08)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.04)';
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <div>
                        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>{getJobName(job)}</h2>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: jSource.bg, color: jSource.color, padding: '2px 8px', borderRadius: '8px', fontSize: '11px', fontWeight: '700', marginTop: '4px' }}>
                          <SourceIcon size={11} color={jSource.color} /> {jSource.label}
                        </span>
                      </div>
                      <span style={{ background: jStage.bg, color: jStage.color, padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: '800' }}>
                        {jStage.label}
                      </span>
                    </div>

                    <div style={{ fontSize: '13px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <MapPin size={14} color="#0284c7" />
                      <span>{job.address}</span>
                    </div>

                    {job.phone && (
                      <div style={{ fontSize: '13px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                        <Phone size={14} color="#64748b" />
                        <span>{job.phone}</span>
                      </div>
                    )}

                    {job.startDate && job.endDate ? (
                      <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '8px', padding: '6px 10px', marginBottom: '10px', fontSize: '12px', color: '#065f46', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Calendar size={13} color="#059669" />
                        <span>Run: <strong>{job.startDate}</strong> → <strong>{job.endDate}</strong></span>
                      </div>
                    ) : job.siteVisitDate && (
                      <div style={{ background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: '8px', padding: '6px 10px', marginBottom: '10px', fontSize: '12px', color: '#0369a1', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Calendar size={13} />
                        <span>Visit: <strong>{job.siteVisitDate}</strong> at <strong>{job.siteVisitTime || '09:00'}</strong></span>
                      </div>
                    )}

                    <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '10px 12px', border: '1px solid #f1f5f9', margin: '10px 0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
                        <span style={{ color: '#64748b' }}>Contract: <strong style={{ color: '#0f172a' }}>${jContract.toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</strong></span>
                        <span style={{ color: '#64748b' }}>Paid: <strong style={{ color: '#16a34a' }}>${jPaid.toLocaleString('en-NZ')}</strong></span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: '700' }}>
                        <span style={{ color: '#dc2626' }}>Remaining:</span>
                        <span style={{ color: '#dc2626' }}>${jRemaining.toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</span>
                      </div>
                      {jPendingExtras.length > 0 && (
                        <div style={{ marginTop: '6px', fontSize: '11px', color: '#b45309', background: '#fef3c7', padding: '3px 8px', borderRadius: '6px', fontWeight: '700' }}>
                          ⚡ {jPendingExtras.length} variation(s) pending invoice (+${jPendingExtras.reduce((a,x)=>a+(Number(x.amount)||0),0).toLocaleString('en-NZ')})
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '8px', borderTop: '1px solid #f1f5f9', fontSize: '12px', color: '#64748b' }}>
                      <span>System: <strong>{job.system}</strong> {job.sqm ? `(${job.sqm} m²)` : ''}</span>
                      <button type="button" onClick={event => { event.stopPropagation(); handleToggleArchiveJob(job); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#ffffff', border: '1px solid #cbd5e1', color: isJobArchived(job) ? '#047857' : '#475569', padding: '5px 8px', borderRadius: '7px', cursor: 'pointer', fontSize: '11px', fontWeight: '800' }}>
                        {isJobArchived(job) ? <ArchiveRestore size={13} /> : <Archive size={13} />} {isJobArchived(job) ? 'Restore' : 'Archive'}
                      </button>
                      <span style={{ color: '#0284c7', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '2px' }}>
                        Open Workspace <ChevronRight size={14} />
                      </span>
                    </div>
                  </div>
                );
                }} />
              ))
            )}
          </div>
          </>}
        </div>
      ) : (
        <div style={{ padding: '24px', maxWidth: '1140px', margin: '0 auto' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
            <button
              onClick={() => setSelectedJobId(null)}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#ffffff', border: '1px solid #cbd5e1', color: '#475569', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}
            >
              <ArrowLeft size={16} /> All Jobs
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => handleToggleArchiveJob(selectedJob)} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: '#ffffff', border: '1px solid #cbd5e1', color: isJobArchived(selectedJob) ? '#047857' : '#475569', padding: '8px 11px', borderRadius: '8px', cursor: 'pointer', fontWeight: '800', fontSize: '12px' }}>
                {isJobArchived(selectedJob) ? <ArchiveRestore size={14} /> : <Archive size={14} />} {isJobArchived(selectedJob) ? 'Restore Job' : 'Archive Job'}
              </button>
              <span style={{ fontSize: '12px', color: '#64748b' }}>Unique Client File: #{selectedJob.id.slice(-6)}</span>
            </div>
          </div>

          <div style={{ background: '#ffffff', borderRadius: '16px', padding: '24px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '14px', marginBottom: '20px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#0284c7' }}>
                    Project Workspace
                  </span>
                  {(() => {
                    const src = LEAD_SOURCES.find(s => s.id === (selectedJob.source || 'website')) || LEAD_SOURCES[0];
                    const SrcIcon = src.icon;
                    return (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: src.bg, color: src.color, padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '800' }}>
                        <SrcIcon size={12} color={src.color} /> {src.label}
                      </span>
                    );
                  })()}
                </div>

                <h1 style={{ margin: '4px 0 8px 0', fontSize: '26px', fontWeight: '800', color: '#0f172a' }}>
                  {getJobName(selectedJob)}
                </h1>

                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', fontSize: '14px', color: '#475569' }}>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedJob.address)}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#0284c7', textDecoration: 'none', fontWeight: '600' }}
                  >
                    <Compass size={15} /> Google Maps
                  </a>
                  <a
                    href={`https://maps.apple.com/?q=${encodeURIComponent(selectedJob.address)}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#64748b', textDecoration: 'none' }}
                  >
                    <MapPin size={15} /> Apple Maps
                  </a>
                  {selectedJob.phone && (
                    <a href={`tel:${selectedJob.phone}`} style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#0f172a', textDecoration: 'none' }}>
                      <Phone size={15} color="#64748b" /> {selectedJob.phone}
                    </a>
                  )}
                  {(selectedJob.email || selectedJob.clientEmail) && <a href={'mailto:' + (selectedJob.email || selectedJob.clientEmail)} style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#9f1239', textDecoration: 'none' }}><Mail size={15} color="#64748b" /> {selectedJob.email || selectedJob.clientEmail}</a>}
                  <span>System: <strong>{selectedJob.system}</strong></span>
                  {selectedJob.sqm > 0 && <span><strong>{selectedJob.sqm} m²</strong></span>}
                </div>
                {(selectedJob.message || selectedJob.enquiryMessage || selectedJob.websiteMessage) && (
                  <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '9px', padding: '12px 14px', marginTop: '14px', maxWidth: '760px' }}>
                    <div style={{ fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9f1239', marginBottom: '4px' }}>Website enquiry message</div>
                    <div style={{ fontSize: '13px', lineHeight: 1.5, color: '#7f1d1d', whiteSpace: 'pre-wrap' }}>{selectedJob.message || selectedJob.enquiryMessage || selectedJob.websiteMessage}</div>
                  </div>
                )}
              </div>

              <div style={{ background: '#f8fafc', padding: '12px 18px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'right' }}>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '700' }}>TOTAL CONTRACT (EXCL. GST)</div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a' }}>${totalContractExclGst.toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</div>
                <div style={{ fontSize: '12px', color: '#16a34a', fontWeight: '600' }}>
                  Paid: ${totalPaid.toLocaleString('en-NZ')} ({percentPaid}%) • Unpaid: <span style={{ color: '#dc2626' }}>${remainingUnpaid.toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>

            <div>
              <div style={{ fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '8px', textTransform: 'uppercase' }}>
                Sales Funnel & Stage (Click to advance)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px' }}>
                {STAGES.map((s, idx) => {
                  const isCurrent = selectedJob.status === s.id;
                  const currentIndex = STAGES.findIndex(item => item.id === selectedJob.status);
                  const isPassed = idx < currentIndex;

                  return (
                    <button
                      key={s.id}
                      onClick={() => {
                        handleStageSelect(s.id);
                        if (s.id === 'site_visit') setActiveTab('site_visit');
                      }}
                      style={{
                        padding: '12px 10px',
                        borderRadius: '10px',
                        border: isCurrent ? `2px solid ${s.color}` : '1px solid #e2e8f0',
                        background: isCurrent ? s.bg : (isPassed ? '#f8fafc' : '#ffffff'),
                        color: isCurrent ? s.color : (isPassed ? '#334155' : '#64748b'),
                        fontWeight: '800',
                        fontSize: '12px',
                        textAlign: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        boxShadow: isCurrent ? `0 2px 6px ${s.color}33` : 'none'
                      }}
                    >
                      <div style={{ fontSize: '10px', opacity: 0.8, marginBottom: '2px' }}>
                        {isPassed ? '✓ Done' : (isCurrent ? '▶ Current' : `Step ${idx + 1}`)}
                      </div>
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '6px', borderBottom: '2px solid #e2e8f0', marginBottom: '20px', background: '#ffffff', padding: '6px 12px 0 12px', borderRadius: '12px 12px 0 0', overflowX: 'auto' }}>
            <button
              onClick={() => setActiveTab('site_visit')}
              style={{
                padding: '12px 20px',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === 'site_visit' ? '3px solid #0284c7' : '3px solid transparent',
                color: activeTab === 'site_visit' ? '#0284c7' : '#64748b',
                fontWeight: '800',
                fontSize: '14px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <Calendar size={16} /> Schedule, Calendar & Dates {selectedJob.startDate && '✓'}
            </button>
            <button
              onClick={() => setActiveTab('claims')}
              style={{
                padding: '12px 20px',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === 'claims' ? '3px solid #0284c7' : '3px solid transparent',
                color: activeTab === 'claims' ? '#0284c7' : '#64748b',
                fontWeight: '800',
                fontSize: '14px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <FileText size={16} /> Progress Claims & Invoices ({selectedJob.claims?.length || 0})
            </button>
            <button
              onClick={() => setActiveTab('extras')}
              style={{
                padding: '12px 20px',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === 'extras' ? '3px solid #0284c7' : '3px solid transparent',
                color: activeTab === 'extras' ? '#0284c7' : '#64748b',
                fontWeight: '800',
                fontSize: '14px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <Layers size={16} /> Extras & Variations ({selectedJob.extras?.length || 0})
            </button>
            <button
              onClick={() => setActiveTab('quote')}
              style={{
                padding: '12px 20px',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === 'quote' ? '3px solid #0284c7' : '3px solid transparent',
                color: activeTab === 'quote' ? '#0284c7' : '#64748b',
                fontWeight: '800',
                fontSize: '14px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <FileCheck size={16} /> Xero Quote & Document
            </button>
          </div>

          <div style={{ background: '#ffffff', borderRadius: '0 0 16px 16px', padding: '24px', border: '1px solid #e2e8f0', borderTop: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.04)' }}>
            
            {activeTab === 'site_visit' && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px', marginBottom: '20px' }}>
                  
                  <form onSubmit={handleSaveJobDates} style={{ background: '#f8fafc', border: '1.5px solid #0284c7', borderRadius: '14px', padding: '20px' }}>
                    <div style={{ fontSize: '15px', fontWeight: '800', color: '#0284c7', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Calendar size={18} /> Book Project Dates (Execution Run)
                    </div>

                    <p style={{ margin: '0 0 14px 0', fontSize: '12px', color: '#64748b' }}>
                      Define start and finish dates to display on the <strong>Annual Calendar</strong> and detect gaps between jobs.
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '4px' }}>Project Start Date</label>
                        <input
                          type="date"
                          value={jobStartDate}
                          onChange={(e) => setJobStartDate(e.target.value)}
                          style={{ width: '100%', padding: '10px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }}
                          required
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '4px' }}>Estimated Finish Date</label>
                        <input
                          type="date"
                          value={jobEndDate}
                          onChange={(e) => setJobEndDate(e.target.value)}
                          style={{ width: '100%', padding: '10px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }}
                          required
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      style={{ width: '100%', background: '#0284c7', color: '#ffffff', border: 'none', padding: '11px', borderRadius: '8px', fontWeight: '800', fontSize: '13px', cursor: 'pointer', marginBottom: '10px' }}
                    >
                      Save Booked Dates & Add to Annual Calendar
                    </button>

                    {selectedJob.startDate && selectedJob.endDate && (
                      <a
                        href={generateJobCalendarUrl(selectedJob)}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          background: '#059669',
                          color: '#ffffff',
                          textDecoration: 'none',
                          padding: '10px',
                          borderRadius: '8px',
                          fontWeight: '800',
                          fontSize: '12px'
                        }}
                      >
                        <Calendar size={14} /> Add Scheduled Project to Google Calendar
                      </a>
                    )}
                  </form>

                  <form onSubmit={handleSaveSiteVisit} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '20px' }}>
                    <div style={{ fontSize: '15px', fontWeight: '800', color: '#0f172a', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Compass size={18} color="#0284c7" /> Site Inspection / Visit
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '10px', marginBottom: '12px' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '4px' }}>Visit Date</label>
                        <input
                          type="date"
                          value={visitDate}
                          onChange={(e) => setVisitDate(e.target.value)}
                          style={{ width: '100%', padding: '10px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }}
                          required
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '4px' }}>Visit Time</label>
                        <input
                          type="time"
                          value={visitTime}
                          onChange={(e) => setVisitTime(e.target.value)}
                          style={{ width: '100%', padding: '10px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }}
                          required
                        />
                      </div>
                    </div>

                    <div style={{ marginBottom: '14px' }}>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '4px' }}>Inspection Notes</label>
                      <textarea
                        rows={2}
                        placeholder="e.g. Check cracking on North elevation..."
                        value={visitNotes}
                        onChange={(e) => setVisitNotes(e.target.value)}
                        style={{ width: '100%', padding: '10px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box', fontFamily: 'inherit' }}
                      />
                    </div>

                    <button
                      type="submit"
                      style={{ width: '100%', background: '#475569', color: '#ffffff', border: 'none', padding: '10px', borderRadius: '8px', fontWeight: '800', fontSize: '13px', cursor: 'pointer', marginBottom: '8px' }}
                    >
                      Save Visit
                    </button>

                    <a
                      href={visitDate ? generateGoogleCalendarUrl(selectedJob, visitDate, visitTime, visitNotes) : '#'}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => {
                        if (!visitDate) {
                          e.preventDefault();
                          alert('Please select a visit date first!');
                        }
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        background: '#1a73e8',
                        color: '#ffffff',
                        textDecoration: 'none',
                        padding: '10px',
                        borderRadius: '8px',
                        fontWeight: '800',
                        fontSize: '12px'
                      }}
                    >
                      <Calendar size={14} /> Add Visit to Google Calendar
                    </a>
                  </form>

                </div>
              </div>
            )}

            {activeTab === 'claims' && (
              <div>
                <form onSubmit={handleAddClaim} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px', marginBottom: '22px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                    <div style={{ fontSize: '14px', fontWeight: '800', color: '#0f172a' }}>Record Stage / Progress Claim</div>
                    
                    <div style={{ display: 'flex', background: '#e2e8f0', borderRadius: '6px', padding: '2px' }}>
                      <button
                        type="button"
                        onClick={() => setClaimMode('percent')}
                        style={{ border: 'none', padding: '4px 12px', borderRadius: '4px', fontSize: '11px', fontWeight: '800', cursor: 'pointer', background: claimMode === 'percent' ? '#0284c7' : 'transparent', color: claimMode === 'percent' ? '#fff' : '#64748b' }}
                      >
                        % Percentage
                      </button>
                      <button
                        type="button"
                        onClick={() => setClaimMode('fixed')}
                        style={{ border: 'none', padding: '4px 12px', borderRadius: '4px', fontSize: '11px', fontWeight: '800', cursor: 'pointer', background: claimMode === 'fixed' ? '#0284c7' : 'transparent', color: claimMode === 'fixed' ? '#fff' : '#64748b' }}
                      >
                        $ Fixed Amount
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: '12px', alignItems: 'center' }}>
                    <div>
                      <select
                        value={claimStageType}
                        onChange={(e) => setClaimStageType(e.target.value)}
                        style={{ width: '100%', padding: '10px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', fontWeight: '700', color: '#0f172a' }}
                      >
                        <option value="Deposit">Deposit</option>
                        <option value="Progress Claim 1">Progress Claim 1</option>
                        <option value="Progress Claim 2">Progress Claim 2</option>
                        <option value="Progress Claim 3">Progress Claim 3</option>
                        <option value="Progress Claim 4">Progress Claim 4</option>
                        <option value="Progress Claim 5">Progress Claim 5</option>
                        <option value="Final Claim / Handover">Final Claim / Handover</option>
                        <option value="Custom">Custom Stage Name...</option>
                      </select>
                    </div>

                    {claimStageType === 'Custom' && (
                      <input
                        type="text"
                        placeholder="Stage description..."
                        value={customStageText}
                        onChange={(e) => setCustomStageText(e.target.value)}
                        style={{ width: '100%', padding: '10px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }}
                        required
                      />
                    )}

                    <div style={{ position: 'relative' }}>
                      <input
                        type="number"
                        step="any"
                        placeholder={claimMode === 'percent' ? '% e.g. 10' : '$ Amount Excl. GST'}
                        value={claimInputValue}
                        onChange={(e) => setClaimInputValue(e.target.value)}
                        style={{ width: '100%', padding: '10px', paddingRight: claimMode === 'percent' ? '30px' : '10px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', fontWeight: '700', boxSizing: 'border-box' }}
                        required
                      />
                      {claimMode === 'percent' && (
                        <span style={{ position: 'absolute', right: '10px', top: '10px', color: '#64748b', fontWeight: '800' }}>%</span>
                      )}
                      <div style={{ fontSize: '11px', color: '#0284c7', marginTop: '3px', fontWeight: '700' }}>
                        {claimMode === 'percent'
                          ? `= $${(totalContractExclGst * ((parseFloat(claimInputValue) || 0) / 100)).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Excl. GST`
                          : `= ${totalContractExclGst > 0 ? (((parseFloat(claimInputValue) || 0) / totalContractExclGst) * 100).toFixed(1) : 0}% of Contract`}
                      </div>
                    </div>

                    <div>
                      <input
                        type="text"
                        placeholder="Invoice # (Optional)"
                        value={claimInvoiceNo}
                        onChange={(e) => setClaimInvoiceNo(e.target.value)}
                        style={{ width: '100%', padding: '10px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }}
                      />
                      <span style={{ fontSize: '10px', color: '#94a3b8' }}>Fill now or after Xero</span>
                    </div>

                    <button
                      type="submit"
                      style={{ background: '#0284c7', color: '#ffffff', border: 'none', padding: '11px 18px', borderRadius: '8px', fontWeight: '800', fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      + Add Stage
                    </button>
                  </div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginTop: '12px' }}>
                    Expected receipt date (optional)
                    <input type="date" value={claimExpectedDate} onChange={event => setClaimExpectedDate(event.target.value)} style={{ display: 'block', padding: '9px', border: '1px solid #cbd5e1', borderRadius: '7px', marginTop: '5px' }} />
                    <span style={{ display: 'block', marginTop: '5px', color: '#64748b', fontWeight: '400' }}>Leave blank if unknown. Undated stages appear under No date set, not in monthly totals.</span>
                  </label>
                </form>

                <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                        <th style={{ padding: '12px 16px' }}>Stage</th>
                        <th style={{ padding: '12px 16px', textAlign: 'center' }}>% of Job</th>
                        <th style={{ padding: '12px 16px', textAlign: 'right' }}>Amount (Excl. GST)</th>
                        <th style={{ padding: '12px 16px', textAlign: 'right' }}>Incl. 15% GST</th>
                        <th style={{ padding: '12px 16px' }}>Xero Invoice #</th>
                        <th style={{ padding: '12px 16px', textAlign: 'center' }}>Status</th>
                        <th style={{ padding: '12px 16px' }}>Payment dates</th>
                        <th style={{ padding: '12px 16px', width: '36px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {existingClaims.length === 0 ? (
                        <tr><td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>No payment stages created yet. Select "Deposit" or "Progress Claim" above to record one.</td></tr>
                      ) : (
                        existingClaims.map((claim) => (
                          <tr key={claim.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '14px 16px', fontWeight: '700', color: '#0f172a' }}>
                              {claim.description}
                              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '400' }}>{claim.date}</div>
                            </td>
                            <td style={{ padding: '14px 16px', textAlign: 'center', color: '#0284c7', fontWeight: '800' }}>
                              {claim.percentage ? `${claim.percentage}%` : '-'}
                            </td>
                            <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: '800', color: '#0f172a' }}>
                              ${Number(claim.amount).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td style={{ padding: '14px 16px', textAlign: 'right', color: '#475569' }}>
                              ${(Number(claim.amount) * 1.15).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td style={{ padding: '14px 16px' }}>
                              {editingInvoiceId === claim.id ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <input
                                    type="text"
                                    value={editingInvoiceVal}
                                    onChange={(e) => setEditingInvoiceVal(e.target.value)}
                                    placeholder="INV-0001"
                                    autoFocus
                                    style={{ width: '90px', padding: '5px 8px', fontSize: '12px', border: '1px solid #0284c7', borderRadius: '4px' }}
                                  />
                                  <button onClick={() => handleSaveInlineInvoiceNo(claim.id)} style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: '4px', padding: '5px 8px', fontSize: '11px', cursor: 'pointer', fontWeight: 'bold' }}>✓</button>
                                </div>
                              ) : (
                                <div
                                  onClick={() => { setEditingInvoiceId(claim.id); setEditingInvoiceVal(claim.invoiceNo === 'Pending' ? '' : claim.invoiceNo); }}
                                  title="Click to edit or add Invoice #"
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', cursor: 'pointer', background: claim.invoiceNo && claim.invoiceNo !== 'Pending' ? '#f1f5f9' : '#fef3c7', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontFamily: 'monospace', color: claim.invoiceNo && claim.invoiceNo !== 'Pending' ? '#0f172a' : '#b45309' }}
                                >
                                  <span>{claim.invoiceNo || 'Pending'}</span>
                                  <Edit2 size={12} color="#64748b" />
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                              <button
                                onClick={() => handleToggleClaimStatus(claim.id)}
                                title="Click to cycle: To Invoice → Invoiced → Paid"
                                style={{
                                  border: 'none',
                                  borderRadius: '20px',
                                  padding: '5px 14px',
                                  fontSize: '11px',
                                  fontWeight: '800',
                                  cursor: 'pointer',
                                  background: claim.status === 'Paid' ? '#dcfce7' : (claim.status === 'Invoiced' ? '#ede9fe' : '#fef3c7'),
                                  color: claim.status === 'Paid' ? '#15803d' : (claim.status === 'Invoiced' ? '#6d28d9' : '#b45309')
                                }}
                              >
                                {claim.status === 'Paid' ? '✓ Paid' : (claim.status === 'Invoiced' ? '📄 Invoiced' : '⏳ To Invoice')}
                              </button>
                            </td>
                            <td style={{ padding: '14px 16px' }}>
                              <ClaimDates key={`${claim.id}-${claim.status}`} claim={claim} today={currentDate} onSave={handleSaveClaimDates} />
                            </td>
                            <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                              <button onClick={() => handleDeleteClaim(claim.id)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}>
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'extras' && (
              <div>
                <div style={{ display: 'flex', gap: '14px', marginBottom: '18px' }}>
                  <div style={{ flex: 1, background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '10px', padding: '12px 16px', fontSize: '13px', color: '#92400e', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Clock size={16} color="#d97706" />
                      <span><strong>Pending to Invoice:</strong> {pendingExtras.length} variation(s)</span>
                    </div>
                    <strong style={{ fontSize: '15px' }}>
                      +${pendingExtras.reduce((acc, x) => acc + (Number(x.amount) || 0), 0).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}
                    </strong>
                  </div>

                  <div style={{ flex: 1, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '10px', padding: '12px 16px', fontSize: '13px', color: '#065f46', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <CheckCircle2 size={16} color="#059669" />
                      <span><strong>Already Invoiced:</strong> {invoicedExtras.length} variation(s)</span>
                    </div>
                    <strong style={{ fontSize: '15px' }}>
                      +${invoicedExtras.reduce((acc, x) => acc + (Number(x.amount) || 0), 0).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}
                    </strong>
                  </div>
                </div>

                <form onSubmit={handleAddExtra} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px', marginBottom: '22px' }}>
                  <div style={{ fontSize: '14px', fontWeight: '800', color: '#0f172a', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <PlusCircle size={16} color="#0284c7" /> Quick Add Extra / Cost Variation
                  </div>
                  <div style={{ marginBottom: '12px' }}>
                    <label htmlFor="extra-description" style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#64748b', marginBottom: '4px' }}>Description</label>
                    <input id="extra-description" type="text" placeholder="Description (e.g. Colour match trip to Resene, Timber repair)" value={newExtra.description} onChange={e => { const description = e.target.value; setNewExtra(current => ({ ...current, description })); }} style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px' }} required />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
                    <div>
                      <label htmlFor="extra-work-date" style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#64748b', marginBottom: '4px' }}>Work Date</label>
                      <input id="extra-work-date" type="date" value={newExtra.date} onChange={e => { const date = e.target.value; setNewExtra(current => ({ ...current, date })); }} style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px' }} required />
                    </div>
                    <div>
                      <label htmlFor="extra-hours" style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#64748b', marginBottom: '4px' }}>Hours Worked</label>
                      <input id="extra-hours" type="number" min="0" step="any" placeholder="Hours" value={newExtra.hours} onChange={e => { const hours = e.target.value; setNewExtra(current => ({ ...current, hours, amount: getExtraAmount(hours, current.rate) })); }} style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px' }} />
                    </div>
                    <div>
                      <label htmlFor="extra-hourly-rate" style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#64748b', marginBottom: '4px' }}>Hourly Rate ($/hr)</label>
                      <input id="extra-hourly-rate" type="number" min="0" step="any" placeholder="Rate" value={newExtra.rate} onChange={e => { const rate = e.target.value; setNewExtra(current => ({ ...current, rate, amount: getExtraAmount(current.hours, rate) })); }} style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px' }} />
                    </div>
                    <div>
                      <label htmlFor="extra-total" style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#64748b', marginBottom: '4px' }}>Total Amount ($ Excl GST)</label>
                      <input id="extra-total" type="number" min="0" step="any" placeholder="Amount" value={newExtra.amount} onChange={e => { const amount = e.target.value; setNewExtra(current => ({ ...current, amount })); }} aria-describedby="extra-total-help" style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px' }} required />
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginTop: '12px' }}>
                    <span id="extra-total-help" style={{ fontSize: '11px', color: '#64748b' }}>Hours × hourly rate. You can edit the total; changing hours or rate recalculates it.</span>
                    <button type="submit" style={{ background: '#0284c7', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '8px', fontWeight: '800', fontSize: '13px', cursor: 'pointer' }}>+ Add Extra</button>
                  </div>
                </form>

                <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                        <th style={{ padding: '12px 16px' }}>Date</th>
                        <th style={{ padding: '12px 16px' }}>Description of Extra</th>
                        <th style={{ padding: '12px 16px', textAlign: 'right' }}>Amount (Excl. GST)</th>
                        <th style={{ padding: '12px 16px', textAlign: 'center' }}>Invoiced to Client?</th>
                        <th style={{ padding: '12px 16px', width: '40px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {extrasList.length === 0 ? (
                        <tr><td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>No variations or extras recorded yet for this job.</td></tr>
                      ) : (
                        extrasList.map((extra) => (
                          <tr key={extra.id} style={{ borderBottom: '1px solid #f1f5f9', background: extra.invoiced ? '#fafafa' : '#ffffff' }}>
                            <td style={{ padding: '14px 16px', color: '#64748b' }}>{formatExtraDate(extra.date)}</td>
                            <td style={{ padding: '14px 16px', fontWeight: '700', color: extra.invoiced ? '#64748b' : '#0f172a' }}>
                              <span>{extra.description}</span>
                              {extra.hours != null && extra.rate != null && (
                                <div style={{ fontSize: '11px', fontWeight: '400', color: '#64748b', marginTop: '4px' }}>
                                  {extra.hours} hrs @ ${extra.rate}/hr
                                </div>
                              )}
                              {extra.invoiced && (
                                <span style={{ marginLeft: '8px', fontSize: '11px', color: '#059669', background: '#d1fae5', padding: '2px 6px', borderRadius: '4px', fontWeight: '800' }}>Already Billed</span>
                              )}
                            </td>
                            <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: '800', color: extra.invoiced ? '#64748b' : '#0284c7' }}>
                              +${Number(extra.amount).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}
                            </td>
                            <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                              <button
                                type="button"
                                onClick={() => handleToggleExtraInvoiced(extra.id)}
                                title={extra.invoiced ? 'Click to mark as Pending (not yet invoiced)' : 'Click to mark as Invoiced (already charged to client)'}
                                style={{
                                  border: 'none',
                                  borderRadius: '20px',
                                  padding: '5px 14px',
                                  fontSize: '11px',
                                  fontWeight: '800',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  background: extra.invoiced ? '#dcfce7' : '#fef3c7',
                                  color: extra.invoiced ? '#15803d' : '#b45309'
                                }}
                              >
                                {extra.invoiced ? (<><CheckCircle2 size={13} /> Invoiced</>) : (<><Clock size={13} /> Pending Invoice</>)}
                              </button>
                            </td>
                            <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                              <button onClick={() => handleDeleteExtra(extra.id)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}>
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'quote' && (
              <div>
                <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '12px', padding: '20px', marginBottom: '22px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: '#4c1d95' }}>Attach or Update Xero Quote PDF</h3>
                      <p style={{ margin: '2px 0 0 0', fontSize: '13px', color: '#6d28d9' }}>Drop your exported Xero PDF to auto-read Quote Number & Totals</p>
                    </div>
                    {selectedJob.quoteNumber && (
                      <span style={{ background: '#ede9fe', color: '#6d28d9', padding: '4px 12px', borderRadius: '8px', fontWeight: '800', fontSize: '13px' }}>
                        Current Quote: #{selectedJob.quoteNumber}
                      </span>
                    )}
                  </div>

                  <form onSubmit={handleSaveQuoteToJob}>
                    <div
                      onClick={() => document.getElementById('tab-xero-file-input').click()}
                      style={{ border: '2px dashed #a78bfa', borderRadius: '10px', padding: '20px', textAlign: 'center', background: '#ffffff', cursor: 'pointer', marginBottom: '14px' }}
                    >
                      <FileUp size={32} color="#7c3aed" style={{ margin: '0 auto 6px auto', display: 'block' }} />
                      <div style={{ fontSize: '13px', fontWeight: '800', color: '#4c1d95' }}>
                        {isProcessingPdf ? 'Reading PDF...' : 'Click to select or drop Xero Quote PDF'}
                      </div>
                      {quoteData.fileName && (
                        <div style={{ marginTop: '8px', display: 'inline-block', background: '#ede9fe', color: '#6d28d9', padding: '3px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '700' }}>
                          ✓ Selected: {quoteData.fileName}
                        </div>
                      )}
                      <input id="tab-xero-file-input" type="file" accept=".pdf" style={{ display: 'none' }} onChange={(e) => handlePdfUpload(e.target.files[0])} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '10px', alignItems: 'flex-end' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '4px' }}>Quote #</label>
                        <input
                          type="text"
                          placeholder="e.g. QU000647"
                          value={quoteData.quoteNumber || selectedJob.quoteNumber || ''}
                          onChange={(e) => setQuoteData({ ...quoteData, quoteNumber: e.target.value })}
                          style={{ width: '100%', padding: '9px 12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }}
                        />
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#0f172a', marginBottom: '4px' }}>Subtotal Excl. GST ($) *</label>
                        <input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          value={quoteData.amountExclGst || selectedJob.contractAmount || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            const num = parseFloat(val);
                            setQuoteData({ ...quoteData, amountExclGst: val, amountIncGst: !isNaN(num) ? (num * 1.15).toFixed(2) : '' });
                          }}
                          style={{ width: '100%', padding: '9px 12px', background: '#ffffff', border: '2px solid #7c3aed', borderRadius: '8px', fontSize: '14px', fontWeight: '800', boxSizing: 'border-box' }}
                          required
                        />
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '4px' }}>Total Incl. 15% GST ($)</label>
                        <input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          value={quoteData.amountIncGst || (selectedJob.contractAmount ? (selectedJob.contractAmount * 1.15).toFixed(2) : '')}
                          onChange={(e) => {
                            const val = e.target.value;
                            const num = parseFloat(val);
                            setQuoteData({ ...quoteData, amountIncGst: val, amountExclGst: !isNaN(num) ? (num / 1.15).toFixed(2) : '' });
                          }}
                          style={{ width: '100%', padding: '9px 12px', background: '#ffffff', border: '2px solid #cbd5e1', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }}
                        />
                      </div>

                      <button
                        type="submit"
                        style={{ background: '#7c3aed', color: '#ffffff', border: 'none', padding: '10px 20px', borderRadius: '8px', fontWeight: '800', fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                      >
                        <Check size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} /> Update Contract
                      </button>
                    </div>
                  </form>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h4 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: '#0f172a' }}>Original Attached Document</h4>
                    {selectedJob.originalPdf && (
                      <button
                        onClick={() => openPdfNewTab(selectedJob.originalPdf)}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '12px' }}
                      >
                        <ExternalLink size={13} /> Open in New Tab
                      </button>
                    )}
                  </div>

                  <div style={{ height: '560px', background: '#334155', borderRadius: '12px', overflow: 'hidden', border: '1px solid #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {selectedJob.originalPdf ? (
                      <iframe
                        src={selectedJob.originalPdf}
                        title="Original Xero Quote PDF"
                        style={{ width: '100%', height: '100%', border: 'none' }}
                      />
                    ) : (
                      <div style={{ background: '#ffffff', padding: '32px', borderRadius: '12px', textAlign: 'center', maxWidth: '380px' }}>
                        <FileText size={44} color="#7c3aed" style={{ margin: '0 auto 10px auto' }} />
                        <h4 style={{ margin: '0 0 6px 0', fontSize: '15px', color: '#0f172a' }}>No PDF Attached Yet</h4>
                        <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#64748b' }}>Select or drop the PDF file in the box above to store and view the document anytime.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {showNewJobModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '16px', zIndex: 110 }}>
          <form onSubmit={handleCreateJob} style={{ background: '#ffffff', width: '100%', maxWidth: '480px', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '800' }}>Add New Job / Lead</h2>
              <button type="button" onClick={() => setShowNewJobModal(false)} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer' }}><X size={20} /></button>
            </div>
            
            <input type="text" placeholder="Client Name *" value={newJob.clientName} onChange={e => setNewJob({ ...newJob, clientName: e.target.value })} style={{ width: '100%', padding: '10px', marginBottom: '10px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', boxSizing: 'border-box' }} required />
            <input type="text" placeholder="Phone Number" value={newJob.phone} onChange={e => setNewJob({ ...newJob, phone: e.target.value })} style={{ width: '100%', padding: '10px', marginBottom: '10px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', boxSizing: 'border-box' }} />
            <input type="text" placeholder="Site Address *" value={newJob.address} onChange={e => setNewJob({ ...newJob, address: e.target.value })} style={{ width: '100%', padding: '10px', marginBottom: '12px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', boxSizing: 'border-box' }} required />

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '4px' }}>Where did this lead come from? (Lead Source Tracker)</label>
              <select value={newJob.source} onChange={e => setNewJob({ ...newJob, source: e.target.value })} style={{ width: '100%', padding: '10px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', fontWeight: '600' }}>
                {LEAD_SOURCES.map(src => (
                  <option key={src.id} value={src.id}>{src.label}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <select value={newJob.system} onChange={e => setNewJob({ ...newJob, system: e.target.value })} style={{ flex: 1, padding: '10px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px' }}>
                <option value="Sto">Sto</option>
                <option value="Rockcote">Rockcote</option>
                <option value="Specialized">Specialized</option>
                <option value="General Repair">General Repair</option>
                <option value="Direct-Fixed Refurb">Direct-Fixed Refurb</option>
              </select>
              <input type="number" placeholder="Area (m²)" value={newJob.sqm} onChange={e => setNewJob({ ...newJob, sqm: e.target.value })} style={{ width: '110px', padding: '10px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', boxSizing: 'border-box' }} />
            </div>

            <input type="number" placeholder="Estimated Contract ($ Excl. GST)" value={newJob.contractAmount} onChange={e => setNewJob({ ...newJob, contractAmount: e.target.value })} style={{ width: '100%', padding: '10px', marginBottom: '16px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', boxSizing: 'border-box' }} />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => setShowNewJobModal(false)} style={{ background: 'transparent', color: '#64748b', border: '1px solid #cbd5e1', padding: '9px 16px', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
              <button type="submit" style={{ background: '#0284c7', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: '8px', cursor: 'pointer', fontWeight: '800' }}>Save Job</button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}