import { useEffect, useState } from 'react';
import { collection, getDocs, addDoc } from 'firebase/firestore';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'firebase/auth';
import { db, auth } from './firebase';
import { Calendar, Plus, Globe, Search, Tag, Share2, Phone, MapPin, LogOut, X } from 'lucide-react';

export default function App() {
  const [user, setUser] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [isAdding, setIsAdding] = useState(false);
  const [activeStage, setActiveStage] = useState('All Stages');
  const [newAddress, setNewAddress] = useState('');
  const [newSource, setNewSource] = useState('Website (Organic)');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        fetchJobs();
      } else {
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  async function fetchJobs() {
    try {
      const querySnapshot = await getDocs(collection(db, 'jobs'));
      const jobsData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setJobs(jobsData);
    } catch (error) {
      console.error("Erro ao carregar obras:", error);
    } finally {
      setLoading(false);
    }
  }

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Erro no login:", error);
    }
  };

  const handleAddJob = async (e) => {
    e.preventDefault();
    if (!newAddress.trim()) return;
    
    try {
      await addDoc(collection(db, 'jobs'), {
        address: newAddress,
        source: newSource,
        status: 'New Lead',
        contract: 0,
        paid: 0,
        dateAdded: new Date().toISOString().split('T')[0]
      });
      setNewAddress('');
      setIsAdding(false);
      fetchJobs();
    } catch (error) {
      console.error("Erro ao adicionar:", error);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="bg-white p-8 rounded-2xl shadow-sm text-center max-w-sm w-full border border-slate-100">
          <div className="bg-blue-600 text-white rounded-xl w-16 h-16 flex items-center justify-center font-bold text-3xl mx-auto mb-4">R</div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Rendermates <span className="text-blue-500">CRM</span></h1>
          <p className="text-slate-500 text-sm mb-8">Jobs Portfolio & Schedule Master</p>
          <button onClick={handleLogin} className="w-full bg-blue-600 text-white font-semibold py-3 px-4 rounded-xl hover:bg-blue-700 transition-colors">
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  const filteredJobs = jobs.filter(job => activeStage === 'All Stages' || job.status === activeStage);
  const getSourceCount = (source) => jobs.filter(j => j.source === source).length;
  const getStageCount = (stage) => jobs.filter(j => j.status === stage).length;

  return (
    <div className="min-h-screen bg-slate-50 p-4 font-sans max-w-md mx-auto relative pb-20">
      
      <button onClick={() => signOut(auth)} className="absolute top-2 right-2 text-slate-400 p-2 hover:text-red-500 z-10">
        <LogOut size={16} />
      </button>

      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 mb-4 mt-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="bg-blue-600 text-white rounded-xl w-12 h-12 flex items-center justify-center font-bold text-xl shadow-sm">R</div>
          <div>
            <h1 className="text-xl font-bold text-slate-800 leading-tight">Rendermates <span className="text-blue-500">CRM</span></h1>
            <p className="text-slate-500 text-xs font-medium">Jobs Portfolio & Schedule Master</p>
          </div>
        </div>
        
        <div className="flex gap-2">
          <button className="flex-1 border border-blue-200 text-blue-600 bg-blue-50 rounded-xl py-2 px-2 flex items-center justify-center gap-2 font-semibold text-sm">
            <Calendar size={16} className="text-red-500" />
            Booked Calendar (1)
          </button>
          <button 
            onClick={() => setIsAdding(!isAdding)}
            className="flex-1 bg-blue-600 text-white rounded-xl py-2 px-2 flex items-center justify-center gap-2 font-semibold text-sm shadow-sm hover:bg-blue-700"
          >
            {isAdding ? <X size={16} /> : <Plus size={16} />}
            {isAdding ? 'Cancel' : 'New Job'}
          </button>
        </div>
      </div>

      {isAdding && (
        <form onSubmit={handleAddJob} className="bg-white rounded-2xl p-4 shadow-md border border-blue-200 mb-4 animate-in fade-in slide-in-from-top-4">
          <h3 className="font-bold text-slate-800 mb-3">Add New Lead</h3>
          <input 
            type="text" 
            placeholder="Address (e.g. 54 Amritsar St)" 
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            className="w-full border border-slate-200 rounded-lg p-3 mb-3 text-sm focus:outline-none focus:border-blue-500"
            required
            autoFocus
          />
          <select 
            value={newSource}
            onChange={(e) => setNewSource(e.target.value)}
            className="w-full border border-slate-200 rounded-lg p-3 mb-4 text-sm bg-white focus:outline-none focus:border-blue-500"
          >
            <option value="Website (Organic)">Website (Organic)</option>
            <option value="Instagram">Instagram</option>
            <option value="Facebook">Facebook</option>
            <option value="Builderscrack">Builderscrack</option>
            <option value="Word of Mouth">Word of Mouth / Referral</option>
          </select>
          <button type="submit" className="w-full bg-green-600 text-white font-bold py-3 rounded-lg hover:bg-green-700 transition-colors">
            Save Job
          </button>
        </form>
      )}

      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 mb-4">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <Globe size={14} className="text-blue-500" />
            <h2 className="text-slate-600 font-bold text-xs tracking-wider">LEAD SOURCES TRACKER</h2>
          </div>
          <div className="text-right">
            <span className="text-slate-400 text-xs">Total Leads:</span><br/>
            <span className="text-slate-700 font-bold text-xs">{jobs.length}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge text={`All Sources (${jobs.length})`} style="border-blue-500 text-blue-600 bg-blue-50" />
          <Badge icon={<Globe size={12} />} text={`Website: ${getSourceCount('Website (Organic)')}`} style="border-green-200 text-green-700" />
          <Badge text={`Instagram: ${getSourceCount('Instagram')}`} style="border-slate-200 text-pink-600" />
          <Badge text={`Facebook: ${getSourceCount('Facebook')}`} style="border-slate-200 text-blue-600" />
          <Badge icon={<Tag size={12} />} text={`Builderscrack: ${getSourceCount('Builderscrack')}`} style="border-slate-200 text-red-500" />
          <Badge icon={<Share2 size={12} />} text={`Word of Mouth: ${getSourceCount('Word of Mouth')}`} style="border-slate-200 text-purple-600" />
        </div>
      </div>

      <div className="flex overflow-x-auto gap-2 mb-4 pb-2 hide-scrollbar">
        <StageBadge text="All Stages" count={jobs.length} active={activeStage === 'All Stages'} onClick={() => setActiveStage('All Stages')} />
        <StageBadge text="New Lead" count={getStageCount('New Lead')} active={activeStage === 'New Lead'} onClick={() => setActiveStage('New Lead')} />
        <StageBadge text="Site Visit" count={getStageCount('Site Visit')} active={activeStage === 'Site Visit'} onClick={() => setActiveStage('Site Visit')} />
        <StageBadge text="Quote Sent" count={getStageCount('Quote Sent')} active={activeStage === 'Quote Sent'} onClick={() => setActiveStage('Quote Sent')} />
        <StageBadge text="In Progress" count={getStageCount('In Progress')} active={activeStage === 'In Progress'} onClick={() => setActiveStage('In Progress')} />
      </div>

      <div className="space-y-4">
        {filteredJobs.length === 0 ? (
          <p className="text-center text-slate-500 text-sm mt-8">Nenhuma obra encontrada para este filtro.</p>
        ) : (
          filteredJobs.map(job => (
            <div key={job.id} className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-bold text-lg text-slate-900">{job.address}</h3>
                <span className="bg-blue-100 text-blue-600 text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
                  {job.status || 'New Lead'}
                </span>
              </div>
              
              <div className="inline-flex items-center gap-1 bg-green-50 text-green-600 px-2 py-1 rounded text-xs font-medium mb-3 border border-green-100">
                <Globe size={12} />
                {job.source || 'Website (Organic)'}
              </div>

              <div className="flex items-center gap-2 text-slate-500 text-sm mb-3">
                <MapPin size={14} className="text-blue-400" />
                {job.address}
              </div>

              <div className="bg-slate-50 border border-slate-100 rounded-lg p-2 text-xs text-slate-600 flex items-center gap-2 mb-4">
                <Calendar size={14} className="text-blue-500" />
                Adicionado: <span className="font-bold text-slate-800">{job.dateAdded || 'Data indisponível'}</span>
              </div>

              <div className="flex justify-between text-sm pt-3 border-t border-slate-100">
                <span className="text-slate-500">Contract: <span className="font-bold text-slate-800">${job.contract || '0.00'}</span></span>
                <span className="text-slate-500">Paid: <span className="font-bold text-green-600">${job.paid || '0.00'}</span></span>
              </div>
            </div>
          ))
        )}
      </div>

    </div>
  );
}

function Badge({ icon, text, style }) {
  return (
    <div className={`flex items-center gap-1.5 border rounded-full px-3 py-1.5 text-xs font-semibold ${style}`}>
      {icon}
      {text}
    </div>
  );
}

function StageBadge({ text, count, active, onClick }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center justify-center min-w-[80px] px-3 py-2 rounded-2xl border text-center whitespace-nowrap transition-all ${
        active ? 'bg-blue-600 border-blue-600 text-white shadow-md scale-[1.02]' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
      }`}
    >
      <span className="text-xs font-semibold">{text}</span>
      <span className="text-xs font-bold">({count})</span>
    </button>
  );
}
