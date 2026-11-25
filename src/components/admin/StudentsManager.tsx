import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import type { Student } from '../../types';
import {
  downloadSampleExcel,
  type ExcelParseResult,
  parseStudentsExcel,
} from '../../utils/excel';
import {
  emailToStudentId,
  isValidEmail,
  LIMITS,
  normalizeEmail,
  sanitizeText,
} from '../../utils/helpers';

interface StudentsManagerProps {
  students: Student[];
}

export function StudentsManager({ students }: StudentsManagerProps) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState('ALL');
  const [importing, setImporting] = useState(false);
  const [parsePreview, setParsePreview] = useState<ExcelParseResult | null>(null);
  const [updateExistingOnImport, setUpdateExistingOnImport] = useState(true);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Add/Edit Student modal state
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [formEmail, setFormEmail] = useState('');
  const [formName, setFormName] = useState('');
  const [formGroup, setFormGroup] = useState('');
  const [formActive, setFormActive] = useState(true);
  const [savingForm, setSavingForm] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null);
  const [deleting, setDeleting] = useState(false);

  const groups = useMemo(() => {
    const set = new Set(students.map((s) => s.groupCode).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'));
  }, [students]);

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return students.filter((s) => {
      if (groupFilter !== 'ALL' && s.groupCode !== groupFilter) return false;
      if (!q) return true;
      return (
        s.fullName.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q) ||
        s.groupCode.toLowerCase().includes(q)
      );
    });
  }, [students, searchQuery, groupFilter]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setStatusMessage(null);
    try {
      const result = await parseStudentsExcel(file);
      setParsePreview(result);
    } catch (error) {
      setStatusMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Không thể đọc file Excel.',
      });
    }
  };

  const handleConfirmImport = async () => {
    if (!parsePreview || parsePreview.valid.length === 0 || !user) return;
    setImporting(true);
    setStatusMessage(null);

    try {
      const existingById = new Map(students.map((s) => [s.id, s]));
      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;

      // Chunk writes at 200 rows per Firestore batch (max 400 ops when syncing bindings)
      const rows = parsePreview.valid;
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const batch = writeBatch(db);
        let opsInBatch = 0;

        for (const row of chunk) {
          const studentId = await emailToStudentId(row.email);
          const existing = existingById.get(studentId);
          const ref = doc(db, 'students', studentId);

          if (!existing) {
            batch.set(ref, {
              email: row.email,
              fullName: row.fullName,
              groupCode: row.groupCode,
              uid: null,
              photoURL: null,
              active: true,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              lastLoginAt: null,
            });
            createdCount++;
            opsInBatch++;
          } else if (updateExistingOnImport) {
            batch.update(ref, {
              fullName: row.fullName,
              groupCode: row.groupCode,
              active: true,
              updatedAt: serverTimestamp(),
            });
            if (existing.uid) {
              batch.set(doc(db, 'studentBindings', existing.uid), {
                studentId,
                groupCode: row.groupCode,
                active: true,
                updatedAt: serverTimestamp(),
              });
              opsInBatch++;
            }
            updatedCount++;
            opsInBatch++;
          } else {
            skippedCount++;
          }
        }

        if (opsInBatch > 0) {
          await batch.commit();
        }
      }

      // Audit log
      await addDoc(collection(db, 'auditLogs'), {
        action: 'import_students',
        actorUid: user.uid,
        actorEmail: normalizeEmail(user.email || ''),
        details: sanitizeText(
          `Import Excel: thêm mới ${createdCount}, cập nhật ${updatedCount}, bỏ qua ${skippedCount} sinh viên.`,
          LIMITS.MAX_AUDIT_LEN
        ),
        createdAt: serverTimestamp(),
      });

      setParsePreview(null);
      setStatusMessage({
        type: 'success',
        text: `Đã đồng bộ danh sách: thêm mới ${createdCount}, cập nhật ${updatedCount}${
          skippedCount > 0 ? `, bỏ qua ${skippedCount}` : ''
        } sinh viên.`,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'students');
    } finally {
      setImporting(false);
    }
  };

  const openAddModal = () => {
    setEditingStudent(null);
    setFormEmail('');
    setFormName('');
    setFormGroup(groups[0] || 'Nhóm 01');
    setFormActive(true);
    setShowAddModal(true);
    setStatusMessage(null);
  };

  const openEditModal = (student: Student) => {
    setEditingStudent(student);
    setFormEmail(student.email);
    setFormName(student.fullName);
    setFormGroup(student.groupCode);
    setFormActive(student.active);
    setShowAddModal(true);
    setStatusMessage(null);
  };

  const handleSaveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = normalizeEmail(formEmail);
    const fullName = sanitizeText(formName, LIMITS.MAX_NAME_LEN);
    const groupCode = sanitizeText(formGroup, LIMITS.MAX_GROUP_LEN);

    if (!isValidEmail(email)) {
      setStatusMessage({ type: 'error', text: 'Email không đúng định dạng.' });
      return;
    }
    if (!fullName || !groupCode) {
      setStatusMessage({ type: 'error', text: 'Vui lòng nhập đầy đủ họ tên và mã nhóm.' });
      return;
    }

    setSavingForm(true);
    setStatusMessage(null);

    try {
      if (editingStudent) {
        await updateDoc(doc(db, 'students', editingStudent.id), {
          email,
          fullName,
          groupCode,
          active: formActive,
          updatedAt: serverTimestamp(),
        });
        if (editingStudent.uid) {
          await setDoc(doc(db, 'studentBindings', editingStudent.uid), {
            studentId: editingStudent.id,
            groupCode,
            active: formActive,
            updatedAt: serverTimestamp(),
          });
        }
        setStatusMessage({ type: 'success', text: `Đã cập nhật thông tin ${fullName}.` });
      } else {
        const studentId = await emailToStudentId(email);
        const existing = students.find((s) => s.id === studentId);
        if (existing) {
          await updateDoc(doc(db, 'students', studentId), {
            fullName,
            groupCode,
            active: formActive,
            updatedAt: serverTimestamp(),
          });
          if (existing.uid) {
            await setDoc(doc(db, 'studentBindings', existing.uid), {
              studentId,
              groupCode,
              active: formActive,
              updatedAt: serverTimestamp(),
            });
          }
          setStatusMessage({
            type: 'success',
            text: `Email ${email} đã có trong danh sách, đã cập nhật thông tin mới.`,
          });
        } else {
          await setDoc(doc(db, 'students', studentId), {
            email,
            fullName,
            groupCode,
            uid: null,
            photoURL: null,
            active: formActive,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            lastLoginAt: null,
          });
          setStatusMessage({ type: 'success', text: `Đã thêm sinh viên ${fullName}.` });
        }
      }
      setShowAddModal(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'students');
    } finally {
      setSavingForm(false);
    }
  };

  const handleDeleteStudent = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'students', deleteTarget.id));
      if (deleteTarget.uid) {
        await deleteDoc(doc(db, 'studentBindings', deleteTarget.uid));
      }
      setStatusMessage({
        type: 'success',
        text: `Đã xóa sinh viên ${deleteTarget.fullName} khỏi danh sách.`,
      });
      setDeleteTarget(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `students/${deleteTarget.id}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Danh sách &amp; Phân nhóm Sinh viên</h2>
          <p className="text-sm text-slate-500">
            Import từ file Excel (.xlsx) với 3 cột: Email, Họ tên, Mã nhóm. Chỉ sinh viên trong
            danh sách này mới được phép đăng nhập.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={downloadSampleExcel}
            className="min-h-[42px] inline-flex items-center gap-2 px-3.5 py-2 border border-slate-200 bg-white text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Tải file mẫu (.xlsx)</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[42px] inline-flex items-center gap-2 px-3.5 py-2 border border-slate-200 bg-white text-slate-900 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            <span>Import Excel</span>
          </button>

          <button
            type="button"
            onClick={openAddModal}
            className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Thêm sinh viên</span>
          </button>
        </div>
      </div>

      {statusMessage && (
        <div
          className={`flex items-start gap-2.5 p-3.5 rounded-xl border text-sm ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {statusMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Search & Group Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo họ tên, email hoặc mã nhóm..."
            className="w-full min-h-[40px] pl-10 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-900"
          />
        </div>

        <div className="flex items-center gap-3">
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="min-h-[40px] px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:border-slate-900"
          >
            <option value="ALL">Tất cả nhóm ({groups.length})</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>

          <span className="text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap">
            {filteredStudents.length}/{students.length} SV
          </span>
        </div>
      </div>

      {/* Students Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filteredStudents.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <FileSpreadsheet className="w-8 h-8 text-slate-300 mx-auto" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-800">
                {students.length === 0
                  ? 'Chưa có sinh viên nào trong hệ thống'
                  : 'Không tìm thấy sinh viên phù hợp'}
              </p>
              <p className="text-xs text-slate-500">
                {students.length === 0
                  ? 'Nhấn "Import Excel" để tải lên danh sách 3 cột (Email, Họ tên, Mã nhóm).'
                  : 'Thử thay đổi từ khóa tìm kiếm hoặc bộ lọc nhóm.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4">Họ tên</th>
                  <th className="py-3 px-4">Email Google</th>
                  <th className="py-3 px-4">Mã nhóm</th>
                  <th className="py-3 px-4">Trạng thái</th>
                  <th className="py-3 px-4">Liên kết</th>
                  <th className="py-3 px-4 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredStudents.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                      {s.fullName}
                    </td>
                    <td className="py-3 px-4 text-slate-600 font-mono text-xs">{s.email}</td>
                    <td className="py-3 px-4 text-slate-800 whitespace-nowrap">{s.groupCode}</td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`text-xs font-medium ${
                          s.active ? 'text-emerald-700' : 'text-slate-400'
                        }`}
                      >
                        {s.active ? 'Hoạt động' : 'Tạm khóa'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-500 whitespace-nowrap">
                      {s.uid ? 'Đã đăng nhập' : 'Chờ đăng nhập'}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditModal(s)}
                          aria-label={`Chỉnh sửa ${s.fullName}`}
                          className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(s)}
                          aria-label={`Xóa ${s.fullName}`}
                          className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Excel Import Preview Modal */}
      {parsePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/45 backdrop-blur-[2px]">
          <div className="w-full max-w-3xl bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Xem trước dữ liệu Import Excel
                </h3>
                <p className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                  Hợp lệ: {parsePreview.valid.length} dòng · Lỗi: {parsePreview.errors.length} dòng
                </p>
              </div>
              <button
                type="button"
                onClick={() => setParsePreview(null)}
                className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={updateExistingOnImport}
                  onChange={(e) => setUpdateExistingOnImport(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300"
                />
                <span>Tự động cập nhật Họ tên &amp; Mã nhóm nếu Email đã tồn tại trong lớp</span>
              </label>

              {parsePreview.errors.length > 0 && (
                <div className="border border-amber-200 bg-amber-50/70 rounded-xl p-4 space-y-2">
                  <p className="text-xs font-semibold text-amber-900">
                    Các dòng không hợp lệ sẽ được bỏ qua ({parsePreview.errors.length}):
                  </p>
                  <ul className="space-y-1 text-xs text-amber-800 max-h-32 overflow-y-auto">
                    {parsePreview.errors.map((err) => (
                      <li key={err.rowNumber}>
                        Dòng {err.rowNumber} ({err.rawEmail || 'Trống'}): {err.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {parsePreview.valid.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        <th className="py-2.5 px-3">Dòng</th>
                        <th className="py-2.5 px-3">Email</th>
                        <th className="py-2.5 px-3">Họ tên</th>
                        <th className="py-2.5 px-3">Mã nhóm</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {parsePreview.valid.slice(0, 50).map((r) => (
                        <tr key={r.email}>
                          <td className="py-2 px-3 font-mono tabular-nums text-slate-400">
                            {r.rowNumber}
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-700">{r.email}</td>
                          <td className="py-2 px-3 font-medium text-slate-900">{r.fullName}</td>
                          <td className="py-2 px-3 text-slate-700">{r.groupCode}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parsePreview.valid.length > 50 && (
                    <p className="p-2.5 text-center text-xs text-slate-500 bg-slate-50 border-t border-slate-100">
                      Đang hiển thị 50/{parsePreview.valid.length} dòng hợp lệ...
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-3 bg-slate-50">
              <button
                type="button"
                onClick={() => setParsePreview(null)}
                className="min-h-[42px] px-4 py-2 border border-slate-200 bg-white text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={importing || parsePreview.valid.length === 0}
                onClick={() => void handleConfirmImport()}
                className="min-h-[42px] px-5 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                {importing
                  ? 'Đang lưu vào Firestore...'
                  : `Xác nhận Import (${parsePreview.valid.length} sinh viên)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Student Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/45 backdrop-blur-[2px]">
          <form
            onSubmit={handleSaveStudent}
            className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {editingStudent ? 'Chỉnh sửa sinh viên' : 'Thêm sinh viên mới'}
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-700">Email Google *</label>
                <input
                  type="email"
                  required
                  disabled={Boolean(editingStudent)}
                  maxLength={LIMITS.MAX_EMAIL_LEN}
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="sinhvien@fpt.edu.vn"
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-200 rounded-lg text-sm disabled:bg-slate-50 disabled:text-slate-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-700">Họ và tên *</label>
                <input
                  type="text"
                  required
                  maxLength={LIMITS.MAX_NAME_LEN}
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Nguyễn Văn A"
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-200 rounded-lg text-sm"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-700">Mã nhóm *</label>
                <input
                  type="text"
                  required
                  maxLength={LIMITS.MAX_GROUP_LEN}
                  value={formGroup}
                  onChange={(e) => setFormGroup(e.target.value)}
                  placeholder="Nhóm 01"
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-200 rounded-lg text-sm"
                />
              </div>

              <label className="flex items-center gap-2.5 pt-1 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formActive}
                  onChange={(e) => setFormActive(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300"
                />
                <span>Cho phép sinh viên này đăng nhập hệ thống</span>
              </label>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="min-h-[42px] px-4 py-2 border border-slate-200 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={savingForm}
                className="min-h-[42px] px-5 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                {savingForm ? 'Đang lưu...' : 'Lưu thông tin'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/45 backdrop-blur-[2px]">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900">Xác nhận xóa sinh viên</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Bạn có chắc chắn muốn xóa sinh viên{' '}
              <span className="font-semibold text-slate-900">{deleteTarget.fullName}</span> (
              {deleteTarget.email}) khỏi danh sách lớp? Sinh viên này sẽ không thể đăng nhập nữa.
            </p>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="min-h-[42px] px-4 py-2 border border-slate-200 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleDeleteStudent()}
                className="min-h-[42px] px-4 py-2 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {deleting ? 'Đang xóa...' : 'Xác nhận xóa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
