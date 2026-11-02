import { Fragment, useEffect, useRef, useState } from 'react';
import { GoogleAuthProvider, onIdTokenChanged, signInWithPopup, signOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from './firebase';
import { accessErrorMessage, googleIdentity } from './crm-access';
import './CrmAccess.css';

export default function CrmAccess({ children }) {
  const [access, setAccess] = useState({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const signingOut = useRef(false);
  const membershipWatch = useRef(() => {});

  useEffect(() => {
    let active = true;
    let version = 0;
    const stopMembership = () => {
      membershipWatch.current();
      membershipWatch.current = () => {};
    };
    const stopAuth = onIdTokenChanged(auth, async user => {
      if (!active) return;
      const current = ++version;
      stopMembership();
      if (signingOut.current) return;
      if (!user) {
        setAccess({ phase: 'signed-out' });
        return;
      }
      setAccess({ phase: 'checking', user });
      const isCurrent = () => active && current === version && !signingOut.current;
      try {
        const token = await user.getIdTokenResult();
        if (!isCurrent()) return;
        const email = googleIdentity(token.claims);
        if (!email) {
          setAccess({ phase: 'denied', user });
          return;
        }
        membershipWatch.current = onSnapshot(
          doc(db, '_crmAccess', email),
          { includeMetadataChanges: true },
          snapshot => {
            if (!isCurrent()) return;
            // Never authorize using offline cache or an uncommitted local write.
            if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) {
              setAccess({ phase: 'checking', user });
              return;
            }
            setAccess({
              phase: snapshot.exists() && snapshot.data().enabled === true ? 'allowed' : 'denied',
              user,
              email
            });
          },
          error => {
            if (!isCurrent()) return;
            setAccess({
              phase: error.code === 'permission-denied' ? 'denied' : 'error',
              user,
              message: accessErrorMessage(error.code)
            });
          }
        );
      } catch (error) {
        if (isCurrent()) setAccess({ phase: 'error', user, message: accessErrorMessage(error.code) });
      }
    }, error => {
      if (!active || signingOut.current) return;
      ++version;
      stopMembership();
      setAccess({ phase: 'error', message: accessErrorMessage(error.code) });
    });
    return () => {
      active = false;
      ++version;
      stopMembership();
      stopAuth();
    };
  }, [attempt]);

  const login = async () => {
    setBusy(true);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      setAccess({ phase: 'signed-out', message: accessErrorMessage(error.code) });
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    signingOut.current = true;
    membershipWatch.current();
    membershipWatch.current = () => {};
    // Unmount the workspace immediately, even if sign-out fails or the network stalls.
    setAccess({ phase: 'signed-out' });
    setBusy(true);
    try {
      await signOut(auth);
    } catch (error) {
      setAccess({ phase: 'error', user: auth.currentUser, message: accessErrorMessage(error.code) });
    } finally {
      signingOut.current = false;
      setBusy(false);
    }
  };

  if (access.phase === 'allowed') {
    return (
      <Fragment key={access.user.uid}>
        <header className="crm-session">
          <span><strong>Secure workspace</strong><span className="crm-session-email">{access.email}</span></span>
          <button type="button" className="crm-access-secondary" onClick={logout}>Sign out</button>
        </header>
        {children}
      </Fragment>
    );
  }

  const checking = access.phase === 'loading' || access.phase === 'checking';
  const denied = access.phase === 'denied';
  return (
    <main className="crm-access-page">
      <section className="crm-access-card" aria-labelledby="crm-access-title">
        <div className="crm-access-mark" aria-hidden="true">R</div>
        <p className="crm-access-eyebrow">RENDERMATES · PRIVATE WORKSPACE</p>
        <h1 id="crm-access-title">Rendermates CRM</h1>
        <p className="crm-access-description">Your jobs, schedule and payments. Only for your authorized team.</p>
        {checking ? (
          <p role="status" className="crm-access-status">Checking secure access…</p>
        ) : denied ? (
          <div role="alert" className="crm-access-alert">
            <h2>Access not granted</h2>
            <p>This Google account is not authorized to use the CRM. Sign out and choose an approved account, or contact your administrator.</p>
            {access.user?.email && <p className="crm-access-account">{access.user.email}</p>}
          </div>
        ) : access.message ? (
          <p role="alert" className="crm-access-alert">{access.message}</p>
        ) : (
          <p className="crm-access-status">Sign in with your approved Google account to continue.</p>
        )}
        {!checking && access.phase === 'signed-out' && (
          <button type="button" className="crm-access-primary" disabled={busy} onClick={login}>
            {busy ? 'Opening Google sign-in…' : 'Sign in with Google'}
          </button>
        )}
        {access.user && (
          <button type="button" className="crm-access-secondary" disabled={busy} onClick={logout}>
            Sign out and switch account
          </button>
        )}
        {!checking && (denied || access.phase === 'error') && (
          <button type="button" className="crm-access-secondary" disabled={busy} onClick={() => setAttempt(value => value + 1)}>
            Retry access check
          </button>
        )}
        <p className="crm-access-footnote">Signing in does not grant access automatically.</p>
      </section>
    </main>
  );
}
