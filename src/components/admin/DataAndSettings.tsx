import {
  AlertTriangle,
  CheckCircle2,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import type {
  AdminInvite,
  AdminSettings,
  AuditLog,
  DailyCheckin,
  GroupTask,
  Student,
} from '../../types';
import {
  BOOTSTRAPPED_ADMIN_EMAIL,
  emailToSafeKey,
  formatTimestampFull,
  isValidEmail,
  LIMITS,
  normalizeEmail,
  sanitizeText,
} from '../../utils/helpers';

interface DataAndSettingsProps {
  students: Student[];
  checkins: DailyCheckin[];
  groupTasks: GroupTask[];
}

const RESET_PHRASE = 'XOA DU LIEU CONG VIEC';

export function DataAndSettings({ students, checkins, groupTasks }: DataAndSettingsProps) {
  const { user, systemConfig } = useAuth();

  const [orgName, setOrgName] = useState(
    systemConfig?.organizationName || 'Quản lý Thực tập & Đồ án Nhóm'
  );
  const [termName, setTermName] = useState(
    systemConfig?.academicTerm || 'Học kỳ hiện tại'
  );
  const [allowCustomStudentTasks, setAllowCustomStudentTasks] = useState(
    Boolean(systemConfig?.allowCustomStudentTasks)
  );
  const [savingConfig, setSavingConfig] = useState(false);

  const [primaryAdminEmail, setPrimaryAdminEmail] = useState(BOOTSTRAPPED_ADMIN_EMAIL);
  const [savingPrimaryAdmin, setSavingPrimaryAdmin] = useState(false);

  const [adminInvites, setAdminInvites] = useState<AdminInvite[]>([]);
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [addingAdmin, setAddingAdmin] = useState(false);

  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Two-step Reset modal state
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetStep, setResetStep] = useState<1 | 2>(1);
  const [step1Checked, setStep1Checked] = useState(false);
  const [resetTasksStatus, setResetTasksStatus] = useState(true);
  const [step2Input, setStep2Input] = useState('');
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (systemConfig) {
      setOrgName(systemConfig.organizationName);
      setTermName(systemConfig.academicTerm);
      setAllowCustomStudentTasks(Boolean(systemConfig.allowCustomStudentTasks));
    }
  }, [systemConfig]);

  useEffect(() => {
    const unsubInvites = onSnapshot(
      collection(db, 'adminInvites'),
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<AdminInvite, 'id'>),
        }));
        setAdminInvites(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'adminInvites')
    );

    const logsQuery = query(
      collection(db, 'auditLogs'),
      orderBy('createdAt', 'desc')
    );
    const unsubLogs = onSnapshot(
      logsQuery,
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<AuditLog, 'id'>),
        }));
        setAuditLogs(list.slice(0, 20));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'auditLogs')
    );

    const unsubSettings = onSnapshot(
      doc(db, 'adminSettings', 'main'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as AdminSettings;
          if (data.primaryAdminEmail) {
            setPrimaryAdminEmail(data.primaryAdminEmail);
          }
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, 'adminSettings/main')
    );

    return () => {
      unsubInvites();
      unsubLogs();
      unsubSettings();
    };
  }, []);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const cleanOrg = sanitizeText(orgName, LIMITS.MAX_ORG_NAME_LEN);
    const cleanTerm = sanitizeText(termName, LIMITS.MAX_TERM_LEN);
    if (!cleanOrg || !cleanTerm) return;

    setSavingConfig(true);
    setFeedback(null);
    try {
      await updateDoc(doc(db, 'systemConfig', 'main'), {
        organizationName: cleanOrg,
        academicTerm: cleanTerm,
        allowCustomStudentTasks,
        updatedAt: serverTimestamp(),
      });
      await addDoc(collection(db, 'auditLogs'), {
        action: 'update_config',
        actorUid: user.uid,
        actorEmail: normalizeEmail(user.email || ''),
        details: sanitizeText(
          `Cập nhật cấu hình: ${cleanOrg} (${cleanTerm}), Tự nhập việc: ${
            allowCustomStudentTasks ? 'Bật' : 'Tắt'
          }`,
          LIMITS.MAX_AUDIT_LEN
        ),
        createdAt: serverTimestamp(),
      });
      setFeedback({ type: 'success', text: 'Đã lưu cấu hình hệ thống.' });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'systemConfig/main');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSavePrimaryAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const email = normalizeEmail(primaryAdminEmail);
    if (!isValidEmail(email)) {
      setFeedback({ type: 'error', text: 'Email Admin mặc định không hợp lệ.' });
      return;
    }

    setSavingPrimaryAdmin(true);
    setFeedback(null);
    try {
      await setDoc(doc(db, 'adminSettings', 'main'), {
        primaryAdminEmail: email,
        updatedAt: serverTimestamp(),
      });
      if (email !== BOOTSTRAPPED_ADMIN_EMAIL) {
        const safeKey = emailToSafeKey(email);
        if (!adminInvites.some((inv) => inv.id === safeKey)) {
          await setDoc(doc(db, 'adminInvites', safeKey), {
            email,
            addedBy: normalizeEmail(user.email || ''),
            createdAt: serverTimestamp(),
          });
        }
      }
      await addDoc(collection(db, 'auditLogs'), {
        action: 'update_config',
        actorUid: user.uid,
        actorEmail: normalizeEmail(user.email || ''),
        details: sanitizeText(
          `Cập nhật Admin chính cấu hình: ${email}`,
          LIMITS.MAX_AUDIT_LEN
        ),
        createdAt: serverTimestamp(),
      });
      setFeedback({
        type: 'success',
        text: `Đã cấu hình Admin chính là ${email}.`,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'adminSettings/main');
    } finally {
      setSavingPrimaryAdmin(false);
    }
  };

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const email = normalizeEmail(newAdminEmail);
    if (!isValidEmail(email)) {
      setFeedback({ type: 'error', text: 'Email quản trị viên không hợp lệ.' });
      return;
    }

    const safeKey = emailToSafeKey(email);
    if (email === BOOTSTRAPPED_ADMIN_EMAIL || adminInvites.some((inv) => inv.id === safeKey)) {
      setFeedback({
        type: 'error',
        text: `Tài khoản ${email} đã có quyền quản trị trong hệ thống.`,
      });
      return;
    }

    setAddingAdmin(true);
    setFeedback(null);
    try {
      await setDoc(doc(db, 'adminInvites', safeKey), {
        email,
        addedBy: normalizeEmail(user.email || ''),
        createdAt: serverTimestamp(),
      });
      setNewAdminEmail('');
      setFeedback({ type: 'success', text: `Đã cấp quyền quản trị cho ${email}.` });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `adminInvites/${safeKey}`);
    } finally {
      setAddingAdmin(false);
    }
  };

  const handleRemoveAdminInvite = async (invite: AdminInvite) => {
    try {
      await deleteDoc(doc(db, 'adminInvites', invite.id));
      setFeedback({ type: 'success', text: `Đã thu hồi lời mời quản trị của ${invite.email}.` });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `adminInvites/${invite.id}`);
    }
  };

  const openResetFlow = () => {
    setResetStep(1);
    setStep1Checked(false);
    setResetTasksStatus(true);
    setStep2Input('');
    setResetModalOpen(true);
  };

  const handleConfirmReset = async () => {
    if (!user || step2Input.trim() !== RESET_PHRASE) return;
    setResetting(true);
    setFeedback(null);

    try {
      const totalCheckins = checkins.length;

      // Batch delete ONLY checkins documents; students & systemConfig remain intact!
      for (let i = 0; i < checkins.length; i += 400) {
        const chunk = checkins.slice(i, i + 400);
        const batch = writeBatch(db);
        for (const item of chunk) {
          batch.delete(doc(db, 'checkins', item.id));
        }
        await batch.commit();
      }

      // Optionally reset groupTasks status back to 'open' while keeping task definitions
      let resetTaskCount = 0;
      if (resetTasksStatus) {
        const nonOpenTasks = groupTasks.filter((t) => t.status !== 'open');
        for (let i = 0; i < nonOpenTasks.length; i += 400) {
          const chunk = nonOpenTasks.slice(i, i + 400);
          const batch = writeBatch(db);
          for (const task of chunk) {
            batch.update(doc(db, 'groupTasks', task.id), {
              status: 'open',
              assignedToStudentId: null,
              assignedToUid: null,
              assignedToName: null,
              claimedAt: null,
              completedAt: null,
              updatedAt: serverTimestamp(),
            });
            resetTaskCount++;
          }
          await batch.commit();
        }
      }

      await updateDoc(doc(db, 'systemConfig', 'main'), {
        totalResets: (systemConfig?.totalResets ?? 0) + 1,
        lastResetAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await addDoc(collection(db, 'auditLogs'), {
        action: 'reset_checkins',
        actorUid: user.uid,
        actorEmail: normalizeEmail(user.email || ''),
        details: sanitizeText(
          `Reset dữ liệu công việc (${totalCheckins} bản ghi check-in/checkout${
            resetTaskCount > 0 ? `, đặt lại ${resetTaskCount} việc nhóm về Chưa nhận` : ''
          }). Giữ nguyên ${students.length} sinh viên.`,
          LIMITS.MAX_AUDIT_LEN
        ),
        createdAt: serverTimestamp(),
      });

      setResetModalOpen(false);
      setFeedback({
        type: 'success',
        text: `Đã xóa ${totalCheckins} bản ghi check-in/checkout${
          resetTaskCount > 0 ? ` và đặt lại ${resetTaskCount} việc nhóm về Chưa nhận` : ''
        }. Danh sách ${students.length} sinh viên và cấu hình hệ thống được giữ nguyên.`,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'checkins');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Quản trị Dữ liệu &amp; Phân quyền</h2>
        <p className="text-sm text-slate-500">
          Cấu hình thông tin lớp học, phân quyền tài khoản quản trị và reset dữ liệu công việc.
        </p>
      </div>

      {feedback && (
        <div
          className={`flex items-start gap-2.5 p-3.5 rounded-xl border text-sm ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{feedback.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* System Configuration */}
        <form
          onSubmit={handleSaveConfig}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
        >
          <h3 className="text-base font-semibold text-slate-900">Cấu hình hệ thống</h3>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-700">
                Tên lớp học / Dự án
              </label>
              <input
                type="text"
                required
                maxLength={LIMITS.MAX_ORG_NAME_LEN}
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                className="w-full min-h-[42px] px-3 py-2 border border-slate-200 rounded-lg text-sm"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-700">
                Học kỳ / Đợt thực tập
              </label>
              <input
                type="text"
                required
                maxLength={LIMITS.MAX_TERM_LEN}
                value={termName}
                onChange={(e) => setTermName(e.target.value)}
                className="w-full min-h-[42px] px-3 py-2 border border-slate-200 rounded-lg text-sm"
              />
            </div>

            <label className="flex items-start gap-2.5 pt-1 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={allowCustomStudentTasks}
                onChange={(e) => setAllowCustomStudentTasks(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded border-slate-300"
              />
              <span>
                Cho phép sinh viên tự nhập thêm công việc ngoài danh sách việc của nhóm (Mặc định tắt
                để sinh viên chỉ nhặt việc từ danh sách nhóm).
              </span>
            </label>
          </div>

          <button
            type="submit"
            disabled={savingConfig}
            className="min-h-[42px] px-4 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
          >
            {savingConfig ? 'Đang lưu...' : 'Lưu cấu hình'}
          </button>
        </form>

        {/* Admin Role Management */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-slate-700" />
            <h3 className="text-base font-semibold text-slate-900">Tài khoản Quản trị viên</h3>
          </div>

          <form onSubmit={handleSavePrimaryAdmin} className="space-y-2 pb-4 border-b border-slate-100">
            <label className="block text-xs font-medium text-slate-700">
              Email Admin chính cấu hình (Mặc định: {BOOTSTRAPPED_ADMIN_EMAIL})
            </label>
            <div className="flex gap-2">
              <input
                type="email"
                required
                value={primaryAdminEmail}
                onChange={(e) => setPrimaryAdminEmail(e.target.value)}
                className="flex-1 min-h-[42px] px-3 py-2 border border-slate-200 rounded-lg font-mono text-xs"
              />
              <button
                type="submit"
                disabled={savingPrimaryAdmin}
                className="min-h-[42px] px-3.5 border border-slate-200 bg-white text-slate-900 text-xs font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                {savingPrimaryAdmin ? 'Đang lưu...' : 'Cập nhật'}
              </button>
            </div>
          </form>

          <form onSubmit={handleAddAdmin} className="flex gap-2">
            <input
              type="email"
              required
              value={newAdminEmail}
              onChange={(e) => setNewAdminEmail(e.target.value)}
              placeholder="Thêm email Google quản trị phụ..."
              className="flex-1 min-h-[42px] px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
            <button
              type="submit"
              disabled={addingAdmin}
              className="min-h-[42px] px-3.5 inline-flex items-center gap-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Thêm Admin</span>
            </button>
          </form>

          <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
            <li className="px-4 py-3 flex items-center justify-between text-xs bg-slate-50/60">
              <div>
                <p className="font-mono font-medium text-slate-900">{BOOTSTRAPPED_ADMIN_EMAIL}</p>
                <p className="text-slate-500">Quản trị viên mặc định hệ thống</p>
              </div>
              <span className="font-medium text-slate-600">Mặc định</span>
            </li>
            {adminInvites.map((inv) => (
              <li
                key={inv.id}
                className="px-4 py-3 flex items-center justify-between text-xs bg-white"
              >
                <div>
                  <p className="font-mono font-medium text-slate-900">{inv.email}</p>
                  <p className="text-slate-500">Thêm bởi {inv.addedBy}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRemoveAdminInvite(inv)}
                  aria-label={`Thu hồi quyền ${inv.email}`}
                  className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Danger Zone: Two-Step Reset Check-in History */}
      <div className="bg-white border border-red-200 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-red-700">
            <AlertTriangle className="w-4 h-4" />
            <h3 className="text-base font-semibold">Reset dữ liệu Check-in / Check-out</h3>
          </div>
          <p className="text-sm text-slate-600 max-w-2xl">
            Xóa toàn bộ {checkins.length} bản ghi lịch sử công việc hiện có để bắt đầu đợt mới.
            Danh sách {students.length} sinh viên và cấu hình hệ thống được giữ nguyên hoàn toàn.
          </p>
          {systemConfig?.lastResetAt && (
            <p className="text-xs text-slate-500 font-mono tabular-nums">
              Lần reset gần nhất: {formatTimestampFull(systemConfig.lastResetAt)} (Tổng{' '}
              {systemConfig.totalResets} lần)
            </p>
          )}
        </div>

        <button
          type="button"
          disabled={checkins.length === 0}
          onClick={openResetFlow}
          className="min-h-[44px] px-4 py-2.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
        >
          Reset lịch sử công việc
        </button>
      </div>

      {/* Audit Logs */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Nhật ký thao tác quản trị</h3>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            {auditLogs.length} bản ghi gần nhất
          </span>
        </div>
        {auditLogs.length === 0 ? (
          <p className="p-6 text-center text-xs text-slate-500">Chưa có nhật ký thao tác nào.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-xs">
            {auditLogs.map((log) => (
              <li
                key={log.id}
                className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="space-y-0.5">
                  <p className="font-medium text-slate-900">{log.details}</p>
                  <p className="text-slate-500 font-mono">{log.actorEmail}</p>
                </div>
                <span className="font-mono tabular-nums text-slate-500 shrink-0">
                  {formatTimestampFull(log.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Two-Step Reset Confirmation Modal */}
      {resetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[2px]">
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-xs font-mono uppercase tracking-wide text-red-600 font-semibold">
                  Xác nhận bước {resetStep}/2
                </p>
                <h3 className="text-lg font-semibold text-slate-900">
                  Reset toàn bộ dữ liệu công việc
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setResetModalOpen(false)}
                className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {resetStep === 1 ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 space-y-1.5">
                  <p className="font-semibold">Phạm vi thao tác:</p>
                  <p>· Sẽ xóa vĩnh viễn: {checkins.length} bản ghi check-in / checkout.</p>
                  <p>
                    · Sẽ giữ nguyên: {students.length} tài khoản sinh viên, nhóm và cấu hình hệ
                    thống.
                  </p>
                </div>

                <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={resetTasksStatus}
                    onChange={(e) => setResetTasksStatus(e.target.checked)}
                    className="w-4 h-4 mt-0.5 rounded border-slate-300"
                  />
                  <span>
                    Đồng thời đặt lại trạng thái các công việc nhóm về "Chưa nhận" (giữ nguyên danh
                    sách đầu việc đã tạo).
                  </span>
                </label>

                <label className="flex items-start gap-2.5 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={step1Checked}
                    onChange={(e) => setStep1Checked(e.target.checked)}
                    className="w-4 h-4 mt-0.5 rounded border-slate-300"
                  />
                  <span>
                    Tôi đã kiểm tra và hiểu rằng lịch sử công việc sẽ không thể khôi phục sau khi
                    reset.
                  </span>
                </label>

                <div className="flex justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setResetModalOpen(false)}
                    className="min-h-[42px] px-4 py-2 border border-slate-200 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="button"
                    disabled={!step1Checked}
                    onClick={() => setResetStep(2)}
                    className="min-h-[42px] px-4 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                  >
                    Tiếp tục bước 2
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-slate-600">
                  Nhập chính xác cụm từ{' '}
                  <span className="font-mono font-semibold text-red-700">{RESET_PHRASE}</span> để
                  xác nhận thực thi.
                </p>
                <input
                  type="text"
                  value={step2Input}
                  onChange={(e) => setStep2Input(e.target.value)}
                  placeholder={RESET_PHRASE}
                  className="w-full min-h-[44px] px-3.5 py-2 border border-slate-300 rounded-lg font-mono text-sm focus:outline-none focus:border-red-600"
                />

                <div className="flex justify-between items-center pt-2">
                  <button
                    type="button"
                    onClick={() => setResetStep(1)}
                    className="text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    Quay lại bước 1
                  </button>
                  <div className="flex gap-2.5">
                    <button
                      type="button"
                      onClick={() => setResetModalOpen(false)}
                      className="min-h-[42px] px-4 py-2 border border-slate-200 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 cursor-pointer"
                    >
                      Hủy bỏ
                    </button>
                    <button
                      type="button"
                      disabled={resetting || step2Input.trim() !== RESET_PHRASE}
                      onClick={() => void handleConfirmReset()}
                      className="min-h-[42px] px-4 py-2 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 disabled:opacity-40 cursor-pointer"
                    >
                      {resetting ? 'Đang xóa dữ liệu...' : 'Xác nhận Reset'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
