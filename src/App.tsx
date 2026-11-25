/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AlertTriangle } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginView } from './components/LoginView';
import { AdminConsole } from './components/admin/AdminConsole';
import { StudentPortal } from './components/student/StudentPortal';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { isFirebaseConfigured } from './firebase';

function AppContent() {
  const { role } = useAuth();

  if (role === 'loading') {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin mx-auto" />
          <p className="text-sm text-slate-600">Đang xác thực tài khoản...</p>
        </div>
      </div>
    );
  }

  if (role === 'admin') {
    return <AdminConsole />;
  }

  if (role === 'student') {
    return <StudentPortal />;
  }

  return <LoginView />;
}

function MissingFirebaseConfigView() {
  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-2.5 text-amber-700">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <h1 className="text-base font-bold text-slate-900">Thiếu cấu hình Firebase</h1>
        </div>
        <p className="text-sm text-slate-600 leading-relaxed">
          Không tìm thấy tệp{' '}
          <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
            firebase-applet-config.json
          </code>{' '}
          và chưa có đầy đủ biến môi trường Firebase trong{' '}
          <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">.env</code>.
        </p>
        <pre className="p-3.5 bg-slate-900 text-slate-100 rounded-xl text-xs font-mono overflow-x-auto leading-relaxed">
{`VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_FIRESTORE_DATABASE_ID=(default)`}
        </pre>
      </div>
    </div>
  );
}

export default function App() {
  if (!isFirebaseConfigured) {
    return <MissingFirebaseConfigView />;
  }

  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
}

