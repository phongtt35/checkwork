import { CheckCircle2, Database, KeyRound, Shield, Terminal } from 'lucide-react';
import { firebaseConfig, firebaseConfigSource } from '../../firebase';

export function FirebaseDeploymentGuide() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-xl font-bold text-slate-900">
          Hướng dẫn Cấu hình Firebase &amp; Triển khai
        </h2>
        <p className="text-sm text-slate-500">
          Tài liệu tham chiếu cấu trúc dự án Firebase hiện tại, Security Rules và quy trình triển
          khai lên môi trường production.
        </p>
      </div>

      {/* Live Project Info */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-slate-700" />
          <h3 className="text-base font-semibold text-slate-900">
            1. Thông tin Dự án Firebase đang kết nối
          </h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
            <span className="text-slate-500 block">Project ID</span>
            <span className="font-mono font-semibold text-slate-900">
              {firebaseConfig.projectId}
            </span>
          </div>
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
            <span className="text-slate-500 block">Firestore Database ID</span>
            <span className="font-mono font-semibold text-slate-900">
              {firebaseConfig.firestoreDatabaseId}
            </span>
          </div>
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
            <span className="text-slate-500 block">Auth Domain</span>
            <span className="font-mono font-semibold text-slate-900">
              {firebaseConfig.authDomain}
            </span>
          </div>
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
            <span className="text-slate-500 block">Nguồn cấu hình hiện tại</span>
            <span className="font-mono font-semibold text-slate-900">
              {firebaseConfigSource === 'json'
                ? 'firebase-applet-config.json'
                : 'Biến môi trường (.env)'}
            </span>
          </div>
        </div>
      </div>

      {/* Authentication Setup */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-slate-700" />
          <h3 className="text-base font-semibold text-slate-900">
            2. Cấu hình Firebase Authentication (Google Sign-In)
          </h3>
        </div>
        <ol className="list-decimal pl-5 space-y-2 text-sm text-slate-700">
          <li>
            Trong Firebase Console, mở mục <strong>Authentication &rarr; Sign-in method</strong> và
            đảm bảo nhà cung cấp <strong>Google</strong> đã được bật (Enabled).
          </li>
          <li>
            Mở <strong>Authentication &rarr; Settings &rarr; Authorized domains</strong> và thêm tên
            miền triển khai thực tế của bạn (ví dụ: tên miền Cloud Run hoặc Firebase Hosting).
          </li>
          <li>
            Sinh viên đăng nhập qua popup Google; hệ thống tự đối chiếu email với collection{' '}
            <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">students</code>{' '}
            đã import từ file Excel.
          </li>
        </ol>
      </div>

      {/* Security Rules Architecture */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-slate-700" />
          <h3 className="text-base font-semibold text-slate-900">
            3. Cơ chế phân quyền Firestore Security Rules
          </h3>
        </div>
        <ul className="space-y-2 text-sm text-slate-700">
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>
              <strong>Sinh viên (Student):</strong> Chỉ xem và nhận các đầu việc trong{' '}
              <code className="font-mono text-xs">groupTasks</code> thuộc đúng nhóm của mình, đồng
              thời chỉ đọc/cập nhật bản ghi check-in của chính mình (
              <code className="font-mono text-xs">studentUid == request.auth.uid</code>).
            </span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>
              <strong>Quản trị viên (Admin):</strong> Mặc định là{' '}
              <code className="font-mono text-xs">phongtt35@fpt.edu.vn</code> (có thể cấu hình thêm
              hoặc đổi trong mục Dữ liệu &amp; Quyền), có toàn quyền quản lý sinh viên, danh sách
              việc theo nhóm và theo dõi tiến độ.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>
              <strong>Timestamp máy chủ:</strong> Toàn bộ thời điểm nhận việc, hoàn thành, check-in
              và checkout được xác thực bằng <code className="font-mono text-xs">request.time</code>.
            </span>
          </li>
        </ul>
      </div>

      {/* Build & Deploy Commands */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-slate-700" />
          <h3 className="text-base font-semibold text-slate-900">
            4. Lệnh kiểm tra &amp; Triển khai ứng dụng
          </h3>
        </div>
        <pre className="p-4 bg-slate-900 text-slate-100 rounded-xl text-xs font-mono overflow-x-auto leading-relaxed">
{`# 1. Cài đặt thư viện
npm install

# 2. Kiểm tra TypeScript và Security Rules
npm run lint
npx eslint firestore.rules

# 3. Đóng gói bản production
npm run build

# 4. Triển khai Security Rules & Hosting (nếu dùng Firebase CLI)
firebase deploy --only firestore:rules,hosting`}
        </pre>
      </div>
    </div>
  );
}
