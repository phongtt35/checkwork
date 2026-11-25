import { AlertCircle, CheckSquare, LogOut, RefreshCw, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export function LoginView() {
  const { role, user, authError, signInWithGoogle, signOut, refreshAccess } = useAuth();
  const [signingIn, setSigningIn] = useState(false);

  const handleLogin = async () => {
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } finally {
      setSigningIn(false);
    }
  };

  if (role === 'unauthorized' || role === 'inactive') {
    const isInactive = role === 'inactive';
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-between p-6">
        <header className="max-w-5xl w-full mx-auto flex items-center justify-between py-2">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900">
            CheckWork
          </span>
          <span className="text-xs text-slate-500">Quản lý công việc sinh viên</span>
        </header>

        <main className="max-w-md w-full mx-auto bg-white border border-slate-200 rounded-2xl p-8 space-y-6">
          <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center">
            <ShieldAlert className="w-5 h-5" />
          </div>

          <div className="space-y-2">
            <h1 className="text-xl font-semibold text-slate-900 text-balance">
              {isInactive
                ? 'Tài khoản sinh viên đang bị tạm khóa'
                : 'Email chưa có trong danh sách lớp'}
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              {isInactive ? (
                <>
                  Tài khoản <span className="font-medium text-slate-900">{user?.email}</span> hiện
                  đang ở trạng thái tạm khóa. Vui lòng liên hệ giảng viên hoặc quản trị viên để
                  kích hoạt lại.
                </>
              ) : (
                <>
                  Tài khoản <span className="font-medium text-slate-900">{user?.email}</span> chưa
                  được nhập vào hệ thống từ danh sách Excel. Chỉ sinh viên trong danh sách lớp mới
                  được phép đăng nhập.
                </>
              )}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              type="button"
              onClick={refreshAccess}
              className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-slate-200 bg-white text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Kiểm tra lại</span>
            </button>
            <button
              type="button"
              onClick={signOut}
              className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Đổi tài khoản</span>
            </button>
          </div>
        </main>

        <footer className="max-w-5xl w-full mx-auto text-center text-xs text-slate-400 py-2">
          Xác thực qua Google Authentication · Dữ liệu đồng bộ thời gian thực
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-between p-6">
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between py-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center">
            <CheckSquare className="w-4 h-4" />
          </div>
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
            CheckWork
          </span>
        </div>
        <span className="text-xs text-slate-500 hidden sm:inline">
          Hệ thống Check-in &amp; Theo dõi Tiến độ Nhóm
        </span>
      </header>

      <main className="max-w-4xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-center my-8">
        <section className="lg:col-span-7 space-y-5">
          <p className="text-xs font-medium text-blue-700">
            Quản lý công việc sinh viên theo nhóm
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight leading-tight text-balance">
            Check-in đầu ngày nhanh gọn, theo dõi tiến độ minh bạch theo từng nhóm.
          </h1>
          <p className="text-base text-slate-600 leading-relaxed max-w-xl">
            Sinh viên lập kế hoạch đầu ngày và cập nhật kết quả cuối ngày ngay trên điện thoại.
            Quản trị viên nắm bắt tức thì tình hình từng nhóm và các vướng mắc cần hỗ trợ.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
              <p className="text-sm font-semibold text-slate-900">Dành cho Sinh viên</p>
              <p className="text-xs text-slate-500 leading-relaxed">
                Đăng nhập bằng email Google có trong danh sách lớp, check-in công việc và báo cáo vướng mắc cuối ngày.
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
              <p className="text-sm font-semibold text-slate-900">Dành cho Quản trị viên</p>
              <p className="text-xs text-slate-500 leading-relaxed">
                Import danh sách từ Excel (.xlsx), theo dõi biểu đồ tỷ lệ hoàn thành theo ngày và theo nhóm.
              </p>
            </div>
          </div>
        </section>

        <section className="lg:col-span-5">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
            <div className="space-y-1.5">
              <h2 className="text-xl font-semibold text-slate-900">Đăng nhập hệ thống</h2>
              <p className="text-sm text-slate-500">
                Sử dụng tài khoản Google được cấp quyền để tiếp tục.
              </p>
            </div>

            {authError && (
              <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{authError}</span>
              </div>
            )}

            <button
              type="button"
              disabled={signingIn}
              onClick={handleLogin}
              className="w-full min-h-[48px] inline-flex items-center justify-center gap-3 px-5 py-3 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-800 active:scale-[0.99] transition-all disabled:opacity-60 cursor-pointer"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#EA4335"
                  d="M12 5.04c1.64 0 3.12.56 4.28 1.66l3.2-3.2C17.52 1.68 14.96.64 12 .64 7.38.64 3.4 3.28 1.48 7.12l3.74 2.9C6.1 7.36 8.8 5.04 12 5.04z"
                />
                <path
                  fill="#4285F4"
                  d="M23.16 12.28c0-.8-.08-1.58-.22-2.32H12v4.4h6.26c-.28 1.44-1.08 2.66-2.3 3.48l3.56 2.76c2.08-1.92 3.64-4.74 3.64-8.32z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.22 14.02c-.22-.66-.34-1.36-.34-2.08s.12-1.42.34-2.08L1.48 6.96C.74 8.44.32 10.14.32 11.94s.42 3.5 1.16 4.98l3.74-2.9z"
                />
                <path
                  fill="#34A853"
                  d="M12 23.24c3.24 0 5.96-1.08 7.94-2.92l-3.56-2.76c-1.08.72-2.46 1.16-4.38 1.16-3.2 0-5.9-2.32-6.78-5.44l-3.74 2.9c1.92 3.84 5.9 7.06 10.52 7.06z"
                />
              </svg>
              <span>{signingIn ? 'Đang kết nối Google...' : 'Đăng nhập bằng Google'}</span>
            </button>

            <div className="pt-4 border-t border-slate-100 space-y-2 text-xs text-slate-500">
              <p>· Sinh viên sử dụng đúng email đã có trong file Excel của lớp.</p>
              <p>· Dữ liệu check-in mỗi ngày được lưu độc lập, không ghi đè.</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="max-w-5xl w-full mx-auto text-center text-xs text-slate-400 py-2">
        CheckWork · Firebase Authentication &amp; Cloud Firestore
      </footer>
    </div>
  );
}
