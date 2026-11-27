import { initializeApp, type FirebaseApp } from 'firebase/app';
import { CustomProvider, initializeAppCheck, ReCaptchaEnterpriseProvider, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAI, GoogleAIBackend, type AI } from 'firebase/ai';
import { getAuth, signInAnonymously, onAuthStateChanged, type User } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, type Firestore } from 'firebase/firestore';
import { getRemoteConfig, type RemoteConfig } from 'firebase/remote-config';
import { call, native } from './native';

const env = import.meta.env;

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const isConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

let app: FirebaseApp | undefined;
let ai: AI | undefined;
let db: Firestore | undefined;
let remoteConfig: RemoteConfig | undefined;

export function firebase() {
  if (!isConfigured) throw new Error('Firebase is not configured. Copy .env.example to .env.local.');
  if (app) return { app, ai: ai!, db: db!, remoteConfig: remoteConfig! };

  app = initializeApp(firebaseConfig);

  // App Check must be initialized before any Firebase AI Logic call.
  const debugToken = env.VITE_APPCHECK_DEBUG_TOKEN;
  if (debugToken && !native) {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      debugToken === 'true' ? true : debugToken;
  }
  const siteKey = env.VITE_RECAPTCHA_SITE_KEY ?? 'debug-only';
  initializeAppCheck(app, {
    provider: native
      ? // Android app: tokens come from the native App Check SDK (Play Integrity, or a registered debug token).
        new CustomProvider({ getToken: () => call<{ token: string; expireTimeMillis: number }>((id) => native!.appCheckToken(id, false)) })
      : env.VITE_RECAPTCHA_PROVIDER === 'v3'
        ? new ReCaptchaV3Provider(siteKey)
        : new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });

  ai = getAI(app, { backend: new GoogleAIBackend() });
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  remoteConfig = getRemoteConfig(app);

  return { app, ai, db, remoteConfig };
}

export function watchUser(cb: (user: User | null) => void) {
  const auth = getAuth(firebase().app);
  const unsub = onAuthStateChanged(auth, (u) => {
    if (u) cb(u);
    else signInAnonymously(auth).catch((e) => {
      console.warn('Anonymous sign-in failed', e);
      cb(null);
    });
  });
  return unsub;
}
