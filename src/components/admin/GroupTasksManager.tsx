import {
  AlertCircle,
  CheckCircle2,
  Download,
  ListChecks,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  TextQuote,
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
import type { GroupTask, GroupTaskStatus, Student, TaskPriority } from '../../types';
import {
  downloadSampleTasksExcel,
  type GroupTaskExcelParseResult,
  parseGroupTasksExcel,
} from '../../utils/excel';
import {
  generateGroupTaskId,
  LIMITS,
  normalizeEmail,
  sanitizeText,
} from '../../utils/helpers';

interface GroupTasksManagerProps {
  students: Student[];
  groupTasks: GroupTask[];
}

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: 'Cao',
  medium: 'Trung bình',
  low: 'Thấp',
};

const STATUS_LABELS: Record<GroupTaskStatus, string> = {
  open: 'Chưa nhận',
  claimed: 'Đang làm',
  completed: 'Hoàn thành',
};

export function GroupTasksManager({ students, groupTasks }: GroupTasksManagerProps) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | GroupTaskStatus>('ALL');

  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Manual CRUD Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<GroupTask | null>(null);
  const [formGroup, setFormGroup] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formPriority, setFormPriority] = useState<TaskPriority>('medium');
  const [saving, setSaving] = useState(false);

  // Quick Multi-line Paste Modal
  const [quickPasteOpen, setQuickPasteOpen] = useState(false);
  const [pasteGroup, setPasteGroup] = useState('');
  const [pastePriority, setPastePriority] = useState<TaskPriority>('medium');
  const [pasteText, setPasteText] = useState('');
  const [savingPaste, setSavingPaste] = useState(false);

  // Excel Import Preview Modal
  const [excelPreview, setExcelPreview] = useState<GroupTaskExcelParseResult | null>(null);
  const [importingExcel, setImportingExcel] = useState(false);

  // Delete Confirmation
  const [deleteTarget, setDeleteTarget] = useState<GroupTask | null>(null);
  const [deleting, setDeleting] = useState(false);

  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const s of students) {
      if (s.groupCode) set.add(s.groupCode);
    }
    for (const t of groupTasks) {
      if (t.groupCode) set.add(t.groupCode);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'));
  }, [students, groupTasks]);

  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return groupTasks.filter((t) => {
      if (groupFilter !== 'ALL' && t.groupCode !== groupFilter) return false;
      if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.groupCode.toLowerCase().includes(q) ||
        (t.assignedToName || '').toLowerCase().includes(q)
      );
    });
  }, [groupTasks, groupFilter, statusFilter, searchQuery]);

  const counts = useMemo(() => {
    const base =
      groupFilter === 'ALL'
        ? groupTasks
        : groupTasks.filter((t) => t.groupCode === groupFilter);
    return {
      total: base.length,
      open: base.filter((t) => t.status === 'open').length,
      claimed: base.filter((t) => t.status === 'claimed').length,
      completed: base.filter((t) => t.status === 'completed').length,
    };
  }, [groupTasks, groupFilter]);

  const parsedPasteLines = useMemo(() => {
    return pasteText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [rawTitle, ...rest] = line.split('|');
        const title = sanitizeText(rawTitle || '', LIMITS.MAX_TASK_TITLE_LEN);
        const description = sanitizeText(rest.join('|'), LIMITS.MAX_TASK_DESC_LEN);
        return { title, description };
      })
      .filter((item) => item.title.length > 0);
  }, [pasteText]);

  const openCreateModal = () => {
    setEditingTask(null);
    setFormGroup(groupFilter !== 'ALL' ? groupFilter : groups[0] || 'Nhóm 01');
    setFormTitle('');
    setFormDesc('');
    setFormPriority('medium');
    setModalOpen(true);
    setFeedback(null);
  };

  const openEditModal = (task: GroupTask) => {
    setEditingTask(task);
    setFormGroup(task.groupCode);
    setFormTitle(task.title);
    setFormDesc(task.description);
    setFormPriority(task.priority);
    setModalOpen(true);
    setFeedback(null);
  };

  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const groupCode = sanitizeText(formGroup, LIMITS.MAX_GROUP_LEN);
    const title = sanitizeText(formTitle, LIMITS.MAX_TASK_TITLE_LEN);
    const description = sanitizeText(formDesc, LIMITS.MAX_TASK_DESC_LEN);

    if (!groupCode || !title) {
      setFeedback({ type: 'error', text: 'Vui lòng nhập mã nhóm và tên công việc.' });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      if (editingTask) {
        await updateDoc(doc(db, 'groupTasks', editingTask.id), {
          groupCode,
          title,
          description,
          priority: formPriority,
          updatedAt: serverTimestamp(),
        });
        setFeedback({ type: 'success', text: `Đã cập nhật công việc "${title}".` });
      } else {
        const id = generateGroupTaskId();
        await setDoc(doc(db, 'groupTasks', id), {
          groupCode,
          title,
          description,
          priority: formPriority,
          status: 'open',
          assignedToStudentId: null,
          assignedToUid: null,
          assignedToName: null,
          claimedAt: null,
          completedAt: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setFeedback({ type: 'success', text: `Đã thêm công việc mới cho ${groupCode}.` });
      }
      setModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'groupTasks');
    } finally {
      setSaving(false);
    }
  };

  const handleReleaseTask = async (task: GroupTask) => {
    setFeedback(null);
    try {
      await updateDoc(doc(db, 'groupTasks', task.id), {
        status: 'open',
        assignedToStudentId: null,
        assignedToUid: null,
        assignedToName: null,
        claimedAt: null,
        completedAt: null,
        updatedAt: serverTimestamp(),
      });
      setFeedback({
        type: 'success',
        text: `Đã đưa công việc "${task.title}" về trạng thái Chưa nhận.`,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `groupTasks/${task.id}`);
    }
  };

  const handleDeleteTask = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'groupTasks', deleteTarget.id));
      setFeedback({
        type: 'success',
        text: `Đã xóa công việc "${deleteTarget.title}".`,
      });
      setDeleteTarget(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `groupTasks/${deleteTarget.id}`);
    } finally {
      setDeleting(false);
    }
  };

  const handleQuickPasteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const groupCode = sanitizeText(pasteGroup, LIMITS.MAX_GROUP_LEN);
    if (!groupCode || parsedPasteLines.length === 0) return;

    setSavingPaste(true);
    setFeedback(null);
    try {
      for (let i = 0; i < parsedPasteLines.length; i += 400) {
        const chunk = parsedPasteLines.slice(i, i + 400);
        const batch = writeBatch(db);
        for (const item of chunk) {
          const id = generateGroupTaskId();
          batch.set(doc(db, 'groupTasks', id), {
            groupCode,
            title: item.title,
            description: item.description,
            priority: pastePriority,
            status: 'open',
            assignedToStudentId: null,
            assignedToUid: null,
            assignedToName: null,
            claimedAt: null,
            completedAt: null,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
      }

      await addDoc(collection(db, 'auditLogs'), {
        action: 'import_tasks',
        actorUid: user.uid,
        actorEmail: normalizeEmail(user.email || ''),
        details: sanitizeText(
          `Nhập nhanh ${parsedPasteLines.length} đầu việc cho ${groupCode}.`,
          LIMITS.MAX_AUDIT_LEN
        ),
        createdAt: serverTimestamp(),
      });

      setQuickPasteOpen(false);
      setPasteText('');
      setFeedback({
        type: 'success',
        text: `Đã thêm ${parsedPasteLines.length} công việc cho ${groupCode}.`,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'groupTasks');
    } finally {
      setSavingPaste(false);
    }
  };

  const handleExcelFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setFeedback(null);
    try {
      const parsed = await parseGroupTasksExcel(file);
      setExcelPreview(parsed);
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : 'Không thể đọc file Excel.',
      });
    }
  };

  const handleConfirmExcelImport = async () => {
    if (!excelPreview || excelPreview.valid.length === 0 || !user) return;
    setImportingExcel(true);
    setFeedback(null);
    try {
      const rows = excelPreview.valid;
      for (let i = 0; i < rows.length; i += 400) {
        const chunk = rows.slice(i, i + 400);
        const batch = writeBatch(db);
        for (const row of chunk) {
          const id = generateGroupTaskId();
          batch.set(doc(db, 'groupTasks', id), {
            groupCode: row.groupCode,
            title: row.title,
            description: row.description,
            priority: row.priority,
            status: 'open',
            assignedToStudentId: null,
            assignedToUid: null,
            assignedToName: null,
            claimedAt: null,
            completedAt: null,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
      }

      await addDoc(collection(db, 'auditLogs'), {
        action: 'import_tasks',
        actorUid: user.uid,
        actorEmail: normalizeEmail(user.email || ''),
        details: sanitizeText(
          `Import Excel việc nhóm: thêm ${rows.length} đầu việc.`,
          LIMITS.MAX_AUDIT_LEN
        ),
        createdAt: serverTimestamp(),
      });

      setExcelPreview(null);
      setFeedback({
        type: 'success',
        text: `Đã import thành công ${rows.length} công việc theo nhóm từ Excel.`,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'groupTasks');
    } finally {
      setImportingExcel(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Việc cần làm theo nhóm</h2>
          <p className="text-sm text-slate-500">
            Tạo hoặc import danh sách đầu việc cho từng nhóm để thành viên chủ động nhặt khi
            check-in đầu ngày.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={downloadSampleTasksExcel}
            className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-2 border border-slate-200 bg-white text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>File mẫu (.xlsx)</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleExcelFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 border border-slate-200 bg-white text-slate-900 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            <span>Import Excel</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setPasteGroup(groupFilter !== 'ALL' ? groupFilter : groups[0] || 'Nhóm 01');
              setPasteText('');
              setQuickPasteOpen(true);
              setFeedback(null);
            }}
            className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 border border-slate-200 bg-white text-slate-900 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap cursor-pointer"
          >
            <TextQuote className="w-4 h-4" />
            <span>Nhập nhanh nhiều dòng</span>
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Thêm công việc</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`flex items-start gap-2.5 p-3.5 rounded-xl border text-sm ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
          <p className="text-xs text-slate-500">Tổng đầu việc</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900">
            {counts.total}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
          <p className="text-xs text-slate-500">Chưa có người nhận</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-700">
            {counts.open}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
          <p className="text-xs text-slate-500">Đang thực hiện</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-blue-700">
            {counts.claimed}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
          <p className="text-xs text-slate-500">Đã hoàn thành</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-emerald-700">
            {counts.completed}
          </p>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm tên việc, mô tả, nhóm hoặc người nhận..."
            className="w-full min-h-[40px] pl-10 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-900"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="min-h-[40px] px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:border-slate-900"
          >
            <option value="ALL">Tất cả nhóm ({groups.length})</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | GroupTaskStatus)}
            className="min-h-[40px] px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:border-slate-900"
          >
            <option value="ALL">Tất cả trạng thái</option>
            <option value="open">Chưa nhận</option>
            <option value="claimed">Đang làm</option>
            <option value="completed">Hoàn thành</option>
          </select>
        </div>
      </div>

      {/* Tasks Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filteredTasks.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <ListChecks className="w-8 h-8 text-slate-300 mx-auto" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-800">
                {groupTasks.length === 0
                  ? 'Chưa có đầu việc nào được giao cho các nhóm'
                  : 'Không tìm thấy công việc phù hợp'}
              </p>
              <p className="text-xs text-slate-500">
                Nhấn "Import Excel", "Nhập nhanh nhiều dòng" hoặc "Thêm công việc" để tạo backlog
                cho từng nhóm.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4">Nhóm</th>
                  <th className="py-3 px-4">Công việc</th>
                  <th className="py-3 px-4">Ưu tiên</th>
                  <th className="py-3 px-4">Trạng thái</th>
                  <th className="py-3 px-4">Sinh viên nhận</th>
                  <th className="py-3 px-4 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTasks.map((task) => (
                  <tr key={task.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                      {task.groupCode}
                    </td>
                    <td className="py-3 px-4 max-w-md">
                      <p className="font-medium text-slate-900">{task.title}</p>
                      {task.description && (
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                          {task.description}
                        </p>
                      )}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-xs font-medium">
                      <span
                        className={
                          task.priority === 'high'
                            ? 'text-red-700'
                            : task.priority === 'medium'
                            ? 'text-slate-700'
                            : 'text-slate-500'
                        }
                      >
                        {PRIORITY_LABELS[task.priority]}
                      </span>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-xs font-medium">
                      <span
                        className={
                          task.status === 'completed'
                            ? 'text-emerald-700'
                            : task.status === 'claimed'
                            ? 'text-blue-700'
                            : 'text-slate-500'
                        }
                      >
                        {STATUS_LABELS[task.status]}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">
                      {task.assignedToName || '—'}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        {task.status !== 'open' && (
                          <button
                            type="button"
                            onClick={() => void handleReleaseTask(task)}
                            title="Trả lại trạng thái Chưa nhận"
                            aria-label={`Đặt lại trạng thái ${task.title}`}
                            className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-amber-50 hover:text-amber-700 cursor-pointer"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openEditModal(task)}
                          aria-label={`Chỉnh sửa ${task.title}`}
                          className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(task)}
                          aria-label={`Xóa ${task.title}`}
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

      {/* Manual Create / Edit Task Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/45 backdrop-blur-[2px]">
          <form
            onSubmit={handleSaveTask}
            className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {editingTask ? 'Chỉnh sửa công việc nhóm' : 'Thêm công việc cho nhóm'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">Mã nhóm *</label>
                  <input
                    type="text"
                    required
                    list="existing-group-codes"
                    maxLength={LIMITS.MAX_GROUP_LEN}
                    value={formGroup}
                    onChange={(e) => setFormGroup(e.target.value)}
                    placeholder="Nhóm 01"
                    className="w-full min-h-[42px] px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  />
                  <datalist id="existing-group-codes">
                    {groups.map((g) => (
                      <option key={g} value={g} />
                    ))}
                  </datalist>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">Độ ưu tiên</label>
                  <select
                    value={formPriority}
                    onChange={(e) => setFormPriority(e.target.value as TaskPriority)}
                    className="w-full min-h-[42px] px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                  >
                    <option value="high">Cao</option>
                    <option value="medium">Trung bình</option>
                    <option value="low">Thấp</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-700">
                  Tên công việc *
                </label>
                <input
                  type="text"
                  required
                  maxLength={LIMITS.MAX_TASK_TITLE_LEN}
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Ví dụ: Hoàn thiện API giỏ hàng"
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-200 rounded-lg text-sm"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-700">
                  Mô tả / Tiêu chí hoàn thành
                </label>
                <textarea
                  rows={3}
                  maxLength={LIMITS.MAX_TASK_DESC_LEN}
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="Ghi chú thêm cho sinh viên thực hiện..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="min-h-[42px] px-4 py-2 border border-slate-200 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={saving}
                className="min-h-[42px] px-5 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                {saving ? 'Đang lưu...' : 'Lưu công việc'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Quick Multi-Line Paste Import Modal */}
      {quickPasteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/45 backdrop-blur-[2px]">
          <form
            onSubmit={handleQuickPasteSubmit}
            className="w-full max-w-2xl bg-white border border-slate-200 rounded-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Nhập nhanh danh sách việc cần làm theo nhóm
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Mỗi dòng là một công việc. Có thể thêm mô tả sau dấu <code className="font-mono">|</code>{' '}
                  (ví dụ: <code className="font-mono">Thiết kế UI | Trang chủ &amp; Dashboard</code>).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQuickPasteOpen(false)}
                className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-700">Áp dụng cho nhóm *</label>
                <input
                  type="text"
                  required
                  list="paste-group-codes"
                  maxLength={LIMITS.MAX_GROUP_LEN}
                  value={pasteGroup}
                  onChange={(e) => setPasteGroup(e.target.value)}
                  placeholder="Nhóm 01"
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-200 rounded-lg text-sm"
                />
                <datalist id="paste-group-codes">
                  {groups.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-700">Độ ưu tiên mặc định</label>
                <select
                  value={pastePriority}
                  onChange={(e) => setPastePriority(e.target.value as TaskPriority)}
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                >
                  <option value="high">Cao</option>
                  <option value="medium">Trung bình</option>
                  <option value="low">Thấp</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-slate-700">
                  Danh sách công việc
                </label>
                <span className="text-xs font-mono tabular-nums text-slate-500">
                  {parsedPasteLines.length} đầu việc hợp lệ
                </span>
              </div>
              <textarea
                rows={8}
                required
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={
                  'Phân tích yêu cầu chức năng | Tài liệu SRS chương 1-2\nThiết kế cơ sở dữ liệu Firestore\nXây dựng màn hình đăng nhập'
                }
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-sans resize-y focus:outline-none focus:border-slate-900"
              />
            </div>

            <div className="flex justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setQuickPasteOpen(false)}
                className="min-h-[42px] px-4 py-2 border border-slate-200 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={savingPaste || parsedPasteLines.length === 0}
                className="min-h-[42px] px-5 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                {savingPaste
                  ? 'Đang tạo công việc...'
                  : `Tạo ${parsedPasteLines.length} công việc`}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Excel Import Preview Modal */}
      {excelPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/45 backdrop-blur-[2px]">
          <div className="w-full max-w-3xl bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Xem trước Import Việc cần làm từ Excel
                </h3>
                <p className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                  Hợp lệ: {excelPreview.valid.length} dòng · Lỗi: {excelPreview.errors.length} dòng
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExcelPreview(null)}
                className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {excelPreview.errors.length > 0 && (
                <div className="border border-amber-200 bg-amber-50/70 rounded-xl p-4 space-y-1.5 text-xs text-amber-800">
                  <p className="font-semibold text-amber-900">
                    Các dòng lỗi sẽ bị bỏ qua ({excelPreview.errors.length}):
                  </p>
                  {excelPreview.errors.map((err) => (
                    <p key={err.rowNumber}>
                      Dòng {err.rowNumber}: {err.reason}
                    </p>
                  ))}
                </div>
              )}

              {excelPreview.valid.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        <th className="py-2.5 px-3">Mã nhóm</th>
                        <th className="py-2.5 px-3">Tên công việc</th>
                        <th className="py-2.5 px-3">Mô tả</th>
                        <th className="py-2.5 px-3">Ưu tiên</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {excelPreview.valid.slice(0, 60).map((r) => (
                        <tr key={`${r.rowNumber}_${r.title}`}>
                          <td className="py-2 px-3 font-medium text-slate-900 whitespace-nowrap">
                            {r.groupCode}
                          </td>
                          <td className="py-2 px-3 text-slate-800">{r.title}</td>
                          <td className="py-2 px-3 text-slate-500">{r.description || '—'}</td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            {PRIORITY_LABELS[r.priority]}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-3 bg-slate-50">
              <button
                type="button"
                onClick={() => setExcelPreview(null)}
                className="min-h-[42px] px-4 py-2 border border-slate-200 bg-white text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={importingExcel || excelPreview.valid.length === 0}
                onClick={() => void handleConfirmExcelImport()}
                className="min-h-[42px] px-5 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                {importingExcel
                  ? 'Đang import...'
                  : `Xác nhận Import (${excelPreview.valid.length} việc)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/45 backdrop-blur-[2px]">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900">Xác nhận xóa công việc</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Bạn có chắc chắn muốn xóa công việc{' '}
              <span className="font-semibold text-slate-900">{deleteTarget.title}</span> thuộc{' '}
              <span className="font-semibold text-slate-900">{deleteTarget.groupCode}</span>?
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
                onClick={() => void handleDeleteTask()}
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
