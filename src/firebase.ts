import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore, type Firestore } from 'firebase/firestore';

export interface FirebaseAppletConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  measurementId?: string;
  oAuthClientId?: string;
  recaptchaSiteKey?: string;
}

// Read firebase-applet-config.json if it exists; Vite returns {} cleanly if absent
const configModules = import.meta.glob<FirebaseAppletConfig>(
  '/firebase-applet-config.json',
  { eager: true, import: 'default' }
);
const fileConfig = configModules['/firebase-applet-config.json'];
const env = import.meta.env;

const pickValue = (fileVal: string | undefined, ...envKeys: string[]): string => {
  if (typeof fileVal === 'string' && fileVal.trim().length > 0) {
    return fileVal.trim();
  }
  for (const key of envKeys) {
    const raw = env[key];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return raw.trim();
    }
  }
  return '';
};

export const firebaseConfigSource: 'json' | 'env' =
  fileConfig?.apiKey && fileConfig?.projectId ? 'json' : 'env';

export const firebaseConfig: FirebaseAppletConfig = {
  apiKey: pickValue(fileConfig?.apiKey, 'VITE_FIREBASE_API_KEY'),
  authDomain: pickValue(fileConfig?.authDomain, 'VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: pickValue(fileConfig?.projectId, 'VITE_FIREBASE_PROJECT_ID'),
  storageBucket: pickValue(fileConfig?.storageBucket, 'VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: pickValue(
    fileConfig?.messagingSenderId,
    'VITE_FIREBASE_MESSAGING_SENDER_ID'
  ),
  appId: pickValue(fileConfig?.appId, 'VITE_FIREBASE_APP_ID'),
  firestoreDatabaseId:
    pickValue(
      fileConfig?.firestoreDatabaseId,
      'VITE_FIREBASE_FIRESTORE_DATABASE_ID',
      'VITE_FIREBASE_DATABASE_ID'
    ) || '(default)',
  measurementId: pickValue(fileConfig?.measurementId, 'VITE_FIREBASE_MEASUREMENT_ID'),
  oAuthClientId: pickValue(fileConfig?.oAuthClientId, 'VITE_FIREBASE_OAUTH_CLIENT_ID'),
  recaptchaSiteKey: pickValue(
    fileConfig?.recaptchaSiteKey,
    'VITE_FIREBASE_RECAPTCHA_SITE_KEY'
  ),
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId
);

let appInstance: FirebaseApp | null = null;
let dbInstance: Firestore | null = null;
let authInstance: Auth | null = null;

if (isFirebaseConfigured) {
  appInstance = initializeApp(firebaseConfig);
  dbInstance =
    firebaseConfig.firestoreDatabaseId &&
    firebaseConfig.firestoreDatabaseId !== '(default)'
      ? getFirestore(appInstance, firebaseConfig.firestoreDatabaseId)
      : getFirestore(appInstance);
  authInstance = getAuth(appInstance);
} else {
  console.error(
    'Thiếu cấu hình Firebase: không tìm thấy firebase-applet-config.json và chưa thiết lập đầy đủ biến VITE_FIREBASE_* trong .env.'
  );
}

export const db = dbInstance as Firestore;
export const auth = authInstance as Auth;
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: authInstance?.currentUser?.uid ?? null,
      email: authInstance?.currentUser?.email ?? null,
      emailVerified: authInstance?.currentUser?.emailVerified ?? null,
      isAnonymous: authInstance?.currentUser?.isAnonymous ?? null,
      tenantId: authInstance?.currentUser?.tenantId ?? null,
      providerInfo:
        authInstance?.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<void> {
  if (!isFirebaseConfigured || !dbInstance) return;
  try {
    await getDocFromServer(doc(dbInstance, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration: the client is offline.');
    }
  }
}

void testConnection();
