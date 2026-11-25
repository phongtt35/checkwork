import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Timestamp,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from '../firebase';
import type { AuthRole, Student, SystemConfig } from '../types';
import {
  BOOTSTRAPPED_ADMIN_EMAIL,
  emailToSafeKey,
  LIMITS,
  normalizeEmail,
  sanitizeText,
} from '../utils/helpers';

interface AuthContextValue {
  user: User | null;
  role: AuthRole;
  studentProfile: Student | null;
  systemConfig: SystemConfig | null;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshAccess: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<AuthRole>('loading');
  const [studentProfile, setStudentProfile] = useState<Student | null>(null);
  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let unsubStudent: (() => void) | null = null;
    let unsubConfig: (() => void) | null = null;
    let cancelled = false;

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      if (unsubStudent) {
        unsubStudent();
        unsubStudent = null;
      }
      if (unsubConfig) {
        unsubConfig();
        unsubConfig = null;
      }

      if (!currentUser) {
        if (!cancelled) {
          setUser(null);
          setStudentProfile(null);
          setSystemConfig(null);
          setRole('unauthenticated');
        }
        return;
      }

      setUser(currentUser);
      setRole('loading');
      setAuthError(null);

      try {
        const email = currentUser.email ? normalizeEmail(currentUser.email) : '';
        if (!email || !currentUser.emailVerified) {
          await firebaseSignOut(auth);
          if (!cancelled) {
            setAuthError('Tài khoản Google chưa xác minh email. Vui lòng sử dụng tài khoản đã xác minh.');
            setRole('unauthenticated');
          }
          return;
        }

        // 1. Check Admin eligibility
        let isAdminUser = email === BOOTSTRAPPED_ADMIN_EMAIL;

        if (!isAdminUser) {
          try {
            const adminSnap = await getDoc(doc(db, 'admins', currentUser.uid));
            if (adminSnap.exists()) {
              isAdminUser = true;
            }
          } catch (error) {
            handleFirestoreError(error, OperationType.GET, `admins/${currentUser.uid}`);
          }
        }

        if (!isAdminUser) {
          const inviteKey = emailToSafeKey(email);
          try {
            const inviteSnap = await getDoc(doc(db, 'adminInvites', inviteKey));
            if (inviteSnap.exists()) {
              isAdminUser = true;
            }
          } catch (error) {
            handleFirestoreError(error, OperationType.GET, `adminInvites/${inviteKey}`);
          }
        }

        if (isAdminUser) {
          // Ensure admins/{uid} document exists
          const adminDocRef = doc(db, 'admins', currentUser.uid);
          try {
            const adminDocSnap = await getDoc(adminDocRef);
            if (!adminDocSnap.exists()) {
              await setDoc(adminDocRef, {
                email,
                displayName: sanitizeText(currentUser.displayName || email, LIMITS.MAX_NAME_LEN),
                role: 'admin',
                createdAt: serverTimestamp(),
              });
            }
          } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `admins/${currentUser.uid}`);
          }

          // Ensure systemConfig/main exists
          const configRef = doc(db, 'systemConfig', 'main');
          try {
            const configSnap = await getDoc(configRef);
            if (!configSnap.exists()) {
              await setDoc(configRef, {
                organizationName: 'Quản lý Thực tập & Đồ án Nhóm',
                academicTerm: 'Học kỳ hiện tại',
                totalResets: 0,
                lastResetAt: null,
                allowCustomStudentTasks: false,
                updatedAt: serverTimestamp(),
              });
            }
          } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, 'systemConfig/main');
          }

          // Ensure adminSettings/main exists
          const adminSettingsRef = doc(db, 'adminSettings', 'main');
          try {
            const settingsSnap = await getDoc(adminSettingsRef);
            if (!settingsSnap.exists()) {
              await setDoc(adminSettingsRef, {
                primaryAdminEmail: BOOTSTRAPPED_ADMIN_EMAIL,
                updatedAt: serverTimestamp(),
              });
            }
          } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, 'adminSettings/main');
          }

          if (!cancelled) {
            unsubConfig = onSnapshot(
              configRef,
              (snap) => {
                if (snap.exists()) {
                  setSystemConfig(snap.data() as SystemConfig);
                }
              },
              (err) => handleFirestoreError(err, OperationType.GET, 'systemConfig/main')
            );
            setStudentProfile(null);
            setRole('admin');
          }
          return;
        }

        // 2. Check Student whitelist (imported Excel list)
        const studentsRef = collection(db, 'students');
        const q = query(studentsRef, where('email', '==', email), limit(1));
        let studentSnap;
        try {
          studentSnap = await getDocs(q);
        } catch (error) {
          handleFirestoreError(error, OperationType.LIST, 'students');
        }

        if (!studentSnap || studentSnap.empty) {
          if (!cancelled) {
            setStudentProfile(null);
            setRole('unauthorized');
          }
          return;
        }

        const docSnap = studentSnap.docs[0];
        const rawData = docSnap.data() as Omit<Student, 'id'>;

        if (!rawData.active) {
          if (!cancelled) {
            setStudentProfile({ id: docSnap.id, ...rawData });
            setRole('inactive');
          }
          return;
        }

        // Bind UID and photoURL on student login
        const nextPhoto = currentUser.photoURL
          ? sanitizeText(currentUser.photoURL, LIMITS.MAX_PHOTO_LEN)
          : null;
        try {
          await updateDoc(doc(db, 'students', docSnap.id), {
            uid: currentUser.uid,
            photoURL: nextPhoto,
            lastLoginAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          await setDoc(doc(db, 'studentBindings', currentUser.uid), {
            studentId: docSnap.id,
            groupCode: rawData.groupCode,
            active: true,
            updatedAt: serverTimestamp(),
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, `students/${docSnap.id}`);
        }

        if (!cancelled) {
          unsubStudent = onSnapshot(
            doc(db, 'students', docSnap.id),
            (snap) => {
              if (!snap.exists()) {
                setStudentProfile(null);
                setRole('unauthorized');
                return;
              }
              const data = snap.data() as Omit<Student, 'id'>;
              const profile: Student = {
                id: snap.id,
                email: data.email,
                fullName: data.fullName,
                groupCode: data.groupCode,
                uid: data.uid ?? null,
                photoURL: data.photoURL ?? null,
                active: Boolean(data.active),
                createdAt: (data.createdAt as Timestamp | null) ?? null,
                updatedAt: (data.updatedAt as Timestamp | null) ?? null,
                lastLoginAt: (data.lastLoginAt as Timestamp | null) ?? null,
              };
              setStudentProfile(profile);
              setRole(profile.active ? 'student' : 'inactive');
            },
            (err) => handleFirestoreError(err, OperationType.GET, `students/${docSnap.id}`)
          );

          unsubConfig = onSnapshot(
            doc(db, 'systemConfig', 'main'),
            (snap) => {
              if (snap.exists()) {
                setSystemConfig(snap.data() as SystemConfig);
              }
            },
            () => {
              // Config might not be initialized yet if no admin logged in; safe to ignore
            }
          );
        }
      } catch (err) {
        if (!cancelled) {
          setAuthError(err instanceof Error ? err.message : 'Lỗi xác thực hệ thống.');
          setRole('unauthenticated');
        }
      }
    });

    return () => {
      cancelled = true;
      unsubscribeAuth();
      if (unsubStudent) unsubStudent();
      if (unsubConfig) unsubConfig();
    };
  }, [refreshTick]);

  const signInWithGoogle = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (code === 'auth/popup-closed-by-user') {
        setAuthError('Bạn đã đóng cửa sổ đăng nhập Google.');
      } else if (code === 'auth/popup-blocked') {
        setAuthError('Trình duyệt đã chặn cửa sổ bật lên. Vui lòng cho phép popup để đăng nhập.');
      } else {
        setAuthError('Không thể đăng nhập bằng Google. Vui lòng thử lại.');
      }
    }
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setStudentProfile(null);
    setSystemConfig(null);
    setRole('unauthenticated');
  };

  const refreshAccess = () => {
    setRefreshTick((t) => t + 1);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        studentProfile,
        systemConfig,
        authError,
        signInWithGoogle,
        signOut,
        refreshAccess,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
