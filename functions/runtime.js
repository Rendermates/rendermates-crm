import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { GoogleAuth, Impersonated } from 'google-auth-library';
import { calendarClient } from './calendar-client.js';
import { firestoreStore } from './firestore-store.js';

export function database() {
  if (!getApps().length) initializeApp();
  return getFirestore();
}

export async function dependencies(calendarId, writer) {
  if (!calendarId || !writer) throw new Error('Calendar deployment parameters are missing');
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  // Keyless: runtime identity can impersonate ONLY the separate calendar writer.
  // The writer has calendar ACL access, not Firestore or project-wide admin access.
  const client = new Impersonated({
    sourceClient: await auth.getClient(),
    targetPrincipal: writer,
    targetScopes: ['https://www.googleapis.com/auth/calendar.events'],
    lifetime: 600
  });
  return {
    store: firestoreStore(database()),
    calendar: calendarClient({
      calendarId,
      getAccessToken: async () => {
        const { token } = await client.getAccessToken();
        if (!token) throw new Error('Calendar access token unavailable');
        return token;
      }
    })
  };
}
