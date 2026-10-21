import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyDKTkUKuDqu5GlTB_5Ks4IjSjFxE9g4HW4",
  authDomain: "rendermates-crm.firebaseapp.com",
  projectId: "rendermates-crm",
  storageBucket: "rendermates-crm.firebasestorage.app",
  messagingSenderId: "1043078243866",
  appId: "1:1043078243866:web:f3869ea5572407586893a3",
  measurementId: "G-LK9QWKLT3Z"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const storage = getStorage(app);
export default app;
export const auth = getAuth(app);
