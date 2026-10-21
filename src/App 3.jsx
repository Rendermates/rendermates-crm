import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'firebase/auth';
import { db, auth } from './firebase';

export default function App() {
  const [user, setUser] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

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

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-xl shadow-md text-center max-w-sm w-full">
          <h1 className="text-2xl font-bold text-slate-800 mb-6">Rendermates CRM</h1>
          <p className="text-gray-500 mb-8">Faça login para aceder ao sistema.</p>
          <button 
            onClick={handleLogin}
            className="w-full bg-blue-600 text-white font-semibold py-3 px-4 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Entrar com o Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-slate-800">Painel Rendermates</h1>
          <button 
            onClick={() => signOut(auth)}
            className="text-sm bg-gray-200 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-300 transition-colors"
          >
            Sair
          </button>
        </div>
        
        {loading ? (
          <p className="text-gray-500">A carregar obras...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {jobs.map((job) => (
              <div key={job.id} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h2 className="text-xl font-semibold text-slate-700 mb-4">{job.address}</h2>
                {job.claims && job.claims.length > 0 && (
                  <div className="space-y-3">
                    {job.claims.map((claim, index) => (
                      <div key={index} className="flex justify-between items-center bg-gray-50 p-3 rounded-lg">
                        <div>
                          <p className="font-medium text-slate-700">{claim.description || `Fase ${index + 1}`}</p>
                          <p className="text-xs text-gray-500">{claim.date}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-slate-800">${claim.amount}</p>
                          <span className={`text-xs px-2 py-1 rounded-full ${claim.status === 'Paid' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                            {claim.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
