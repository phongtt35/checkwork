import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  History,
  ListTodo,
  LogOut,
  Plus,
  RotateCcw,
  Trash2,
  Undo2,
  Users,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import type { CheckinTask, DailyCheckin, GroupTask, TaskPriority } from '../../types';
import {
  formatDateKeyVN,
  formatTimestampTime,
  generateTaskId,
  getTodayDateKey,
  LIMITS,
  sanitizeText,
} from '../../utils/helpers';

type StudentTab = 'today' | 'history';

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  high: 'Ưu tiên cao',
  medium: 'Trung bình',
  low: 'Ưu tiên thấp',
};

export function StudentPortal() {
  const { user, studentProfile, systemConfig, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState<StudentTab>('today');
  const [checkins, setCheckins] = useState<DailyCheckin[]>([]);
  const [loadingCheckins, setLoadingCheckins] = useState(true);
  const [groupTasks, setGroupTasks] = useState<GroupTask[]>([]);
  const [loadingGroupTasks, setLoadingGroupTasks] = useState(true);

  const todayKey = useMemo(() => getTodayDateKey(), []);
  const allowCustomTasks = Boolean(systemConfig?.allowCustomStudentTasks);

  // Draft state for new check-in (when not yet checked in today)
  const [selectedGroupTaskIds, setSelectedGroupTaskIds] = useState<string[]>([]);
  const [newTaskInput, setNewTaskInput] = useState('');
  const [draftCustomTasks, setDraftCustomTasks] = useState<CheckinTask[]>([]);
  const [draftNote, setDraftNote] = useState('');
  const [showTeamTasks, setShowTeamTasks] = useState(false);

  // Checkout / active evaluation state (when checked_in today)
  const [evalTasks, setEvalTasks] = useState<CheckinTask[]>([]);
  const [evalNote, setEvalNote] = useState('');
  const [addingEvalTask, setAddingEvalTask] = useState('');
  const [showPickExtraPanel, setShowPickExtraPanel] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !studentProfile) return;

    const q = query(
      collection(db, 'checkins'),
      where('studentUid', '==', user.uid)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: DailyCheckin[] = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<DailyCheckin, 'id'>),
        }));
        list.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
        setCheckins(list);
        setLoadingCheckins(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'checkins');
      }
    );

    return () => unsubscribe();
  }, [user, studentProfile]);

  useEffect(() => {
    if (!user || !studentProfile) return;

    const q = query(
      collection(db, 'groupTasks'),
      where('groupCode', '==', studentProfile.groupCode)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: GroupTask[] = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<GroupTask, 'id'>),
        }));
        list.sort((a, b) => {
          const pDiff = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
          if (pDiff !== 0) return pDiff;
          return a.title.localeCompare(b.title, 'vi');
        });
        setGroupTasks(list);
        setLoadingGroupTasks(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'groupTasks');
      }
    );

    return () => unsubscribe();
  }, [user, studentProfile]);

  const todayCheckin = useMemo(
    () => checkins.find((c) => c.dateKey === todayKey) ?? null,
    [checkins, todayKey]
  );

  const pastCheckins = useMemo(
    () => checkins.filter((c) => c.dateKey !== todayKey),
    [checkins, todayKey]
  );

  // Tasks in the group that this student can select (open or already claimed by self)
  const selectableGroupTasks = useMemo(() => {
    if (!user) return [];
    return groupTasks
      .filter(
        (gt) =>
          gt.status === 'open' ||
          (gt.status === 'claimed' && gt.assignedToUid === user.uid)
      )
      .sort((a, b) => {
        const aOwn = a.status === 'claimed' ? 0 : 1;
        const bOwn = b.status === 'claimed' ? 0 : 1;
        if (aOwn !== bOwn) return aOwn - bOwn;
        const pDiff = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
        if (pDiff !== 0) return pDiff;
        return a.title.localeCompare(b.title, 'vi');
      });
  }, [groupTasks, user]);

  // Tasks claimed by teammates or completed
  const teamOtherTasks = useMemo(() => {
    if (!user) return [];
    return groupTasks.filter(
      (gt) =>
        gt.status !== 'open' &&
        !(gt.status === 'claimed' && gt.assignedToUid === user.uid)
    );
  }, [groupTasks, user]);

  const groupTaskStats = useMemo(() => {
    const openCount = groupTasks.filter((t) => t.status === 'open').length;
    const myClaimedCount = groupTasks.filter(
      (t) => t.status === 'claimed' && t.assignedToUid === user?.uid
    ).length;
    const completedCount = groupTasks.filter((t) => t.status === 'completed').length;
    return {
      total: groupTasks.length,
      openCount,
      myClaimedCount,
      completedCount,
    };
  }, [groupTasks, user]);

  // Keep selectedGroupTaskIds synchronized with live selectableGroupTasks (prevents double-claiming)
  useEffect(() => {
    const allowedSet = new Set(selectableGroupTasks.map((t) => t.id));
    setSelectedGroupTaskIds((prev) => {
      const next = prev.filter((id) => allowedSet.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [selectableGroupTasks]);

  const previousUnfinishedTasks = useMemo(() => {
    const selectableIdSet = new Set(selectableGroupTasks.map((t) => t.id));
    for (const c of pastCheckins) {
      const unfinished = c.tasks.filter((t) => {
        if (t.status !== 'incomplete' && t.status !== 'pending') return false;
        if (t.groupTaskId) {
          return selectableIdSet.has(t.groupTaskId);
        }
        return allowCustomTasks;
      });
      if (unfinished.length > 0) {
        return { dateKey: c.dateKey, tasks: unfinished };
      }
    }
    return null;
  }, [pastCheckins, selectableGroupTasks, allowCustomTasks]);

  // Sync evalTasks when todayCheckin changes
  useEffect(() => {
    if (todayCheckin) {
      setEvalTasks(todayCheckin.tasks.map((t) => ({ ...t })));
      setEvalNote(todayCheckin.dailyNote ?? '');
    }
  }, [todayCheckin]);

  const totalDraftCount =
    selectedGroupTaskIds.length + (allowCustomTasks ? draftCustomTasks.length : 0);

  const toggleSelectGroupTask = (taskId: string) => {
    setFormError(null);
    setSuccessNotice(null);
    setSelectedGroupTaskIds((prev) => {
      if (prev.includes(taskId)) {
        return prev.filter((id) => id !== taskId);
      }
      if (totalDraftCount >= LIMITS.MAX_TASKS) {
        setFormError(`Tối đa ${LIMITS.MAX_TASKS} công việc mỗi ngày.`);
        return prev;
      }
      return [...prev, taskId];
    });
  };

  const handleAddDraftCustomTask = () => {
    if (!allowCustomTasks) return;
    const clean = sanitizeText(newTaskInput, LIMITS.MAX_TASK_TITLE_LEN);
    if (!clean) return;
    if (totalDraftCount >= LIMITS.MAX_TASKS) {
      setFormError(`Tối đa ${LIMITS.MAX_TASKS} công việc mỗi ngày.`);
      return;
    }
    setFormError(null);
    setDraftCustomTasks((prev) => [
      ...prev,
      {
        id: generateTaskId(),
        groupTaskId: null,
        title: clean,
        status: 'pending',
        reason: '',
        blocker: '',
      },
    ]);
    setNewTaskInput('');
  };

  const handleImportYesterdayTasks = () => {
    if (!previousUnfinishedTasks) return;
    let remaining = LIMITS.MAX_TASKS - totalDraftCount;
    if (remaining <= 0) return;

    const nextGroupIds = [...selectedGroupTaskIds];
    const nextCustom = [...draftCustomTasks];
    const existingCustomTitles = new Set(nextCustom.map((t) => t.title.toLowerCase()));

    for (const prevTask of previousUnfinishedTasks.tasks) {
      if (remaining <= 0) break;
      if (prevTask.groupTaskId) {
        if (!nextGroupIds.includes(prevTask.groupTaskId)) {
          nextGroupIds.push(prevTask.groupTaskId);
          remaining--;
        }
      } else if (allowCustomTasks && !existingCustomTitles.has(prevTask.title.toLowerCase())) {
        nextCustom.push({
          id: generateTaskId(),
          groupTaskId: null,
          title: sanitizeText(prevTask.title, LIMITS.MAX_TASK_TITLE_LEN),
          status: 'pending',
          reason: '',
          blocker: '',
        });
        existingCustomTitles.add(prevTask.title.toLowerCase());
        remaining--;
      }
    }

    setSelectedGroupTaskIds(nextGroupIds);
    if (allowCustomTasks) {
      setDraftCustomTasks(nextCustom);
    }
    setFormError(null);
  };

  const handleCheckInSubmit = async () => {
    if (!user || !studentProfile) return;

    const selectedGroupObjects = selectedGroupTaskIds
      .map((id) => selectableGroupTasks.find((t) => t.id === id))
      .filter((t): t is GroupTask => Boolean(t));

    const combinedTasks: CheckinTask[] = [
      ...selectedGroupObjects.map((gt) => ({
        id: generateTaskId(),
        groupTaskId: gt.id,
        title: sanitizeText(gt.title, LIMITS.MAX_TASK_TITLE_LEN),
        status: 'pending' as const,
        reason: '',
        blocker: '',
      })),
      ...(allowCustomTasks
        ? draftCustomTasks.map((t) => ({
            id: t.id,
            groupTaskId: null,
            title: sanitizeText(t.title, LIMITS.MAX_TASK_TITLE_LEN),
            status: 'pending' as const,
            reason: '',
            blocker: '',
          }))
        : []),
    ].slice(0, LIMITS.MAX_TASKS);

    if (combinedTasks.length === 0) {
      setFormError('Vui lòng chọn ít nhất 1 công việc từ danh sách nhóm trước khi check-in.');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setSuccessNotice(null);

    const checkinId = `${studentProfile.id}_${todayKey}`;

    try {
      const batch = writeBatch(db);
      for (const gt of selectedGroupObjects) {
        if (gt.status === 'open') {
          batch.update(doc(db, 'groupTasks', gt.id), {
            status: 'claimed',
            assignedToStudentId: studentProfile.id,
            assignedToUid: user.uid,
            assignedToName: sanitizeText(studentProfile.fullName, LIMITS.MAX_NAME_LEN),
            claimedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }

      batch.set(doc(db, 'checkins', checkinId), {
        studentId: studentProfile.id,
        studentUid: user.uid,
        studentEmail: studentProfile.email,
        studentName: studentProfile.fullName,
        groupCode: studentProfile.groupCode,
        dateKey: todayKey,
        status: 'checked_in',
        tasks: combinedTasks,
        totalTasks: combinedTasks.length,
        completedCount: 0,
        incompleteCount: 0,
        dailyNote: sanitizeText(draftNote, LIMITS.MAX_NOTE_LEN),
        checkInAt: serverTimestamp(),
        checkOutAt: null,
        updatedAt: serverTimestamp(),
      });

      await batch.commit();

      setSelectedGroupTaskIds([]);
      setDraftCustomTasks([]);
      setDraftNote('');
      setSuccessNotice('Đã nhận việc và check-in đầu ngày thành công.');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `checkins/${checkinId}`);
    } finally {
      setSubmitting(false);
    }
  };

  const extraSelectableGroupTasks = useMemo(() => {
    const activeGroupTaskIds = new Set(
      evalTasks.map((t) => t.groupTaskId).filter((id): id is string => Boolean(id))
    );
    return selectableGroupTasks.filter((gt) => !activeGroupTaskIds.has(gt.id));
  }, [selectableGroupTasks, evalTasks]);

  const sanitizeEvalTaskList = (list: CheckinTask[]): CheckinTask[] =>
    list.map((t) => ({
      id: t.id,
      groupTaskId: t.groupTaskId ?? null,
      title: sanitizeText(t.title, LIMITS.MAX_TASK_TITLE_LEN),
      status: t.status,
      reason: sanitizeText(t.reason, LIMITS.MAX_REASON_LEN),
      blocker: sanitizeText(t.blocker, LIMITS.MAX_BLOCKER_LEN),
    }));

  const handlePickExtraGroupTask = async (gt: GroupTask) => {
    if (!user || !studentProfile || !todayCheckin || todayCheckin.status !== 'checked_in') {
      return;
    }
    if (evalTasks.length >= LIMITS.MAX_TASKS) {
      setFormError(`Tối đa ${LIMITS.MAX_TASKS} công việc mỗi ngày.`);
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setSuccessNotice(null);

    const newTask: CheckinTask = {
      id: generateTaskId(),
      groupTaskId: gt.id,
      title: sanitizeText(gt.title, LIMITS.MAX_TASK_TITLE_LEN),
      status: 'pending',
      reason: '',
      blocker: '',
    };
    const updatedTasks = sanitizeEvalTaskList([...evalTasks, newTask]);
    const completedCount = updatedTasks.filter((t) => t.status === 'completed').length;
    const incompleteCount = updatedTasks.filter((t) => t.status === 'incomplete').length;

    try {
      const batch = writeBatch(db);
      if (gt.status === 'open') {
        batch.update(doc(db, 'groupTasks', gt.id), {
          status: 'claimed',
          assignedToStudentId: studentProfile.id,
          assignedToUid: user.uid,
          assignedToName: sanitizeText(studentProfile.fullName, LIMITS.MAX_NAME_LEN),
          claimedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      batch.update(doc(db, 'checkins', todayCheckin.id), {
        tasks: updatedTasks,
        totalTasks: updatedTasks.length,
        completedCount,
        incompleteCount,
        dailyNote: sanitizeText(evalNote, LIMITS.MAX_NOTE_LEN),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();

      setEvalTasks(updatedTasks);
      setSuccessNotice(`Đã nhặt thêm công việc "${gt.title}".`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `checkins/${todayCheckin.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReleaseTaskToGroup = async (task: CheckinTask) => {
    if (!user || !todayCheckin || todayCheckin.status !== 'checked_in') return;
    if (evalTasks.length <= 1) {
      setFormError('Cần giữ lại ít nhất 1 công việc trong phiên check-in hôm nay.');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setSuccessNotice(null);

    const updatedTasks = sanitizeEvalTaskList(evalTasks.filter((t) => t.id !== task.id));
    const completedCount = updatedTasks.filter((t) => t.status === 'completed').length;
    const incompleteCount = updatedTasks.filter((t) => t.status === 'incomplete').length;

    const linkedGroupTask = task.groupTaskId
      ? groupTasks.find((gt) => gt.id === task.groupTaskId)
      : undefined;

    try {
      const batch = writeBatch(db);
      if (
        linkedGroupTask &&
        linkedGroupTask.status === 'claimed' &&
        linkedGroupTask.assignedToUid === user.uid
      ) {
        batch.update(doc(db, 'groupTasks', linkedGroupTask.id), {
          status: 'open',
          assignedToStudentId: null,
          assignedToUid: null,
          assignedToName: null,
          claimedAt: null,
          updatedAt: serverTimestamp(),
        });
      }
      batch.update(doc(db, 'checkins', todayCheckin.id), {
        tasks: updatedTasks,
        totalTasks: updatedTasks.length,
        completedCount,
        incompleteCount,
        dailyNote: sanitizeText(evalNote, LIMITS.MAX_NOTE_LEN),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();

      setEvalTasks(updatedTasks);
      setSuccessNotice(`Đã trả "${task.title}" về danh sách nhóm.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `checkins/${todayCheckin.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddEvalCustomTask = async () => {
    if (!allowCustomTasks || !todayCheckin || todayCheckin.status !== 'checked_in') return;
    const clean = sanitizeText(addingEvalTask, LIMITS.MAX_TASK_TITLE_LEN);
    if (!clean) return;
    if (evalTasks.length >= LIMITS.MAX_TASKS) {
      setFormError(`Tối đa ${LIMITS.MAX_TASKS} công việc mỗi ngày.`);
      return;
    }

    const updatedTasks = sanitizeEvalTaskList([
      ...evalTasks,
      {
        id: generateTaskId(),
        groupTaskId: null,
        title: clean,
        status: 'pending',
        reason: '',
        blocker: '',
      },
    ]);
    setEvalTasks(updatedTasks);
    setAddingEvalTask('');
    setFormError(null);

    const completedCount = updatedTasks.filter((t) => t.status === 'completed').length;
    const incompleteCount = updatedTasks.filter((t) => t.status === 'incomplete').length;

    try {
      await updateDoc(doc(db, 'checkins', todayCheckin.id), {
        tasks: updatedTasks,
        totalTasks: updatedTasks.length,
        completedCount,
        incompleteCount,
        dailyNote: sanitizeText(evalNote, LIMITS.MAX_NOTE_LEN),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `checkins/${todayCheckin.id}`);
    }
  };

  const handleTaskStatusChange = (taskId: string, status: 'completed' | 'incomplete') => {
    setFormError(null);
    setEvalTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              status,
              reason: status === 'completed' ? '' : t.reason,
              blocker: status === 'completed' ? '' : t.blocker,
            }
          : t
      )
    );
  };

  const handleTaskFieldChange = (
    taskId: string,
    field: 'reason' | 'blocker',
    value: string
  ) => {
    setFormError(null);
    const maxLen = field === 'reason' ? LIMITS.MAX_REASON_LEN : LIMITS.MAX_BLOCKER_LEN;
    setEvalTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, [field]: value.slice(0, maxLen) } : t))
    );
  };

  const handleSaveProgressDraft = async () => {
    if (!todayCheckin || todayCheckin.status !== 'checked_in') return;
    setSubmitting(true);
    setFormError(null);
    setSuccessNotice(null);

    const cleanTasks = sanitizeEvalTaskList(evalTasks);
    const completedCount = cleanTasks.filter((t) => t.status === 'completed').length;
    const incompleteCount = cleanTasks.filter((t) => t.status === 'incomplete').length;

    try {
      await updateDoc(doc(db, 'checkins', todayCheckin.id), {
        tasks: cleanTasks,
        totalTasks: cleanTasks.length,
        completedCount,
        incompleteCount,
        dailyNote: sanitizeText(evalNote, LIMITS.MAX_NOTE_LEN),
        updatedAt: serverTimestamp(),
      });
      setSuccessNotice('Đã lưu tiến độ tạm thời.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `checkins/${todayCheckin.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckoutSubmit = async () => {
    if (!user || !todayCheckin || todayCheckin.status !== 'checked_in') return;

    const pendingCount = evalTasks.filter((t) => t.status === 'pending').length;
    if (pendingCount > 0) {
      setFormError(
        `Còn ${pendingCount} công việc chưa đánh giá. Vui lòng chọn "Đã hoàn thành" hoặc "Chưa hoàn thành" cho tất cả công việc.`
      );
      return;
    }

    const missingReasonTask = evalTasks.find(
      (t) =>
        t.status === 'incomplete' &&
        (t.reason.trim().length === 0 || t.blocker.trim().length === 0)
    );
    if (missingReasonTask) {
      setFormError(
        `Công việc "${missingReasonTask.title}" chưa hoàn thành: bắt buộc nhập đầy đủ Lý do và Vướng mắc cụ thể.`
      );
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setSuccessNotice(null);

    const cleanTasks = evalTasks.map((t) => ({
      id: t.id,
      groupTaskId: t.groupTaskId ?? null,
      title: sanitizeText(t.title, LIMITS.MAX_TASK_TITLE_LEN),
      status: t.status,
      reason: t.status === 'incomplete' ? sanitizeText(t.reason, LIMITS.MAX_REASON_LEN) : '',
      blocker: t.status === 'incomplete' ? sanitizeText(t.blocker, LIMITS.MAX_BLOCKER_LEN) : '',
    }));

    const completedCount = cleanTasks.filter((t) => t.status === 'completed').length;
    const incompleteCount = cleanTasks.filter((t) => t.status === 'incomplete').length;

    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'checkins', todayCheckin.id), {
        status: 'checked_out',
        tasks: cleanTasks,
        totalTasks: cleanTasks.length,
        completedCount,
        incompleteCount,
        dailyNote: sanitizeText(evalNote, LIMITS.MAX_NOTE_LEN),
        checkOutAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Mark any completed linked groupTask as completed
      for (const task of cleanTasks) {
        if (task.status === 'completed' && task.groupTaskId) {
          const gt = groupTasks.find((item) => item.id === task.groupTaskId);
          if (gt && gt.status === 'claimed' && gt.assignedToUid === user.uid) {
            batch.update(doc(db, 'groupTasks', gt.id), {
              status: 'completed',
              completedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        }
      }

      await batch.commit();
      setSuccessNotice('Đã hoàn tất Checkout cuối ngày.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `checkins/${todayCheckin.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (!studentProfile) return null;

  const evalCompleted = evalTasks.filter((t) => t.status === 'completed').length;
  const evalIncomplete = evalTasks.filter((t) => t.status === 'incomplete').length;
  const evalPending = evalTasks.filter((t) => t.status === 'pending').length;

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-24 lg:pb-12">
      {/* Compact Sticky Top Bar (<= 56px) */}
      <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto h-full flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
              CheckWork
            </span>
            <span className="hidden sm:inline text-slate-300" aria-hidden="true">
              /
            </span>
            <span className="hidden sm:inline text-xs text-slate-500 truncate">
              {systemConfig?.organizationName || 'Cổng sinh viên'}
            </span>
          </div>

          <div className="hidden lg:flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setActiveTab('today')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'today'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Công việc hôm nay
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'history'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Lịch sử ({pastCheckins.length})
            </button>
          </div>

          <button
            type="button"
            onClick={signOut}
            className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Đăng xuất</span>
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-5 sm:pt-8 space-y-6">
        {/* Student Identity Summary (Zero-pill unboxed metadata) */}
        <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-5 border-b border-slate-200">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
              <span className="font-medium text-slate-800">{studentProfile.groupCode}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{studentProfile.email}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
              {studentProfile.fullName}
            </h1>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-600 font-mono tabular-nums">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span>{formatDateKeyVN(todayKey)}</span>
          </div>
        </section>

        {loadingCheckins || loadingGroupTasks ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
              <div className="h-5 w-48 bg-slate-100 rounded animate-pulse" />
              <div className="h-14 w-full bg-slate-100 rounded-xl animate-pulse" />
              <div className="h-14 w-full bg-slate-100 rounded-xl animate-pulse" />
            </div>
            <div className="lg:col-span-4 bg-white border border-slate-200 rounded-2xl p-6 space-y-3">
              <div className="h-4 w-32 bg-slate-100 rounded animate-pulse" />
              <div className="h-16 w-full bg-slate-100 rounded-xl animate-pulse" />
            </div>
          </div>
        ) : activeTab === 'today' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Primary Today Workspace */}
            <div className="lg:col-span-8 space-y-5">
              {successNotice && (
                <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{successNotice}</span>
                </div>
              )}

              {formError && (
                <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              {/* CASE 1: NOT CHECKED IN YET -> PICK GROUP TASKS */}
              {!todayCheckin && (
                <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900">
                        Check-in đầu ngày — Nhặt việc của {studentProfile.groupCode}
                      </h2>
                      <p className="text-sm text-slate-500">
                        Chọn các đầu việc từ danh sách công việc nhóm để nhận làm trong hôm nay.
                      </p>
                    </div>
                    {previousUnfinishedTasks && (
                      <button
                        type="button"
                        onClick={handleImportYesterdayTasks}
                        className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Chọn {previousUnfinishedTasks.tasks.length} việc còn dang dở</span>
                      </button>
                    )}
                  </div>

                  {/* Selectable Group Task Backlog */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700 flex items-center gap-1.5">
                        <ListTodo className="w-4 h-4 text-slate-500" />
                        <span>Việc sẵn sàng nhận ({selectableGroupTasks.length})</span>
                      </span>
                      <span className="font-mono tabular-nums text-slate-500">
                        Đã chọn {selectedGroupTaskIds.length} việc
                      </span>
                    </div>

                    {selectableGroupTasks.length === 0 ? (
                      <div className="py-8 px-4 text-center border border-dashed border-slate-200 rounded-xl space-y-1.5">
                        <p className="text-sm font-medium text-slate-700">
                          {groupTasks.length === 0
                            ? `Nhóm ${studentProfile.groupCode} chưa có danh sách công việc`
                            : 'Tất cả việc của nhóm đã được nhận hoặc hoàn thành'}
                        </p>
                        <p className="text-xs text-slate-500">
                          {allowCustomTasks
                            ? 'Bạn có thể tự thêm công việc phát sinh bên dưới.'
                            : 'Vui lòng liên hệ quản trị viên để bổ sung đầu việc cho nhóm.'}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {selectableGroupTasks.map((gt) => {
                          const isSelected = selectedGroupTaskIds.includes(gt.id);
                          const isMine =
                            gt.status === 'claimed' && gt.assignedToUid === user?.uid;

                          return (
                            <button
                              key={gt.id}
                              type="button"
                              onClick={() => toggleSelectGroupTask(gt.id)}
                              className={`w-full min-h-[56px] text-left p-3.5 rounded-xl border transition-colors flex items-start gap-3 cursor-pointer ${
                                isSelected
                                  ? 'border-slate-900 bg-slate-50'
                                  : 'border-slate-200 bg-white hover:bg-slate-50/70'
                              }`}
                            >
                              <span
                                className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                                  isSelected
                                    ? 'bg-slate-900 border-slate-900 text-white'
                                    : 'border-slate-300 bg-white'
                                }`}
                              >
                                {isSelected && <Check className="w-3.5 h-3.5" />}
                              </span>

                              <div className="flex-1 min-w-0 space-y-1">
                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                  <p className="text-sm font-medium text-slate-900 leading-snug">
                                    {gt.title}
                                  </p>
                                  <div className="flex items-center gap-2 text-[11px] font-medium shrink-0">
                                    {isMine && (
                                      <span className="text-blue-700">Bạn đang giữ</span>
                                    )}
                                    <span
                                      className={
                                        gt.priority === 'high'
                                          ? 'text-red-700'
                                          : gt.priority === 'medium'
                                          ? 'text-slate-600'
                                          : 'text-slate-400'
                                      }
                                    >
                                      {PRIORITY_LABEL[gt.priority]}
                                    </span>
                                  </div>
                                </div>
                                {gt.description && (
                                  <p className="text-xs text-slate-500 leading-relaxed">
                                    {gt.description}
                                  </p>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Read-only view of teammate-claimed / completed group tasks */}
                  {teamOtherTasks.length > 0 && (
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setShowTeamTasks((v) => !v)}
                        className="w-full min-h-[44px] px-4 py-2.5 bg-slate-50 flex items-center justify-between text-xs font-medium text-slate-700 hover:bg-slate-100/80 transition-colors cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          <Users className="w-3.5 h-3.5 text-slate-500" />
                          <span>
                            Công việc thành viên khác đã nhận / hoàn thành ({teamOtherTasks.length})
                          </span>
                        </span>
                        {showTeamTasks ? (
                          <ChevronUp className="w-4 h-4 text-slate-500" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-slate-500" />
                        )}
                      </button>

                      {showTeamTasks && (
                        <ul className="divide-y divide-slate-100 bg-white">
                          {teamOtherTasks.map((gt) => (
                            <li
                              key={gt.id}
                              className="px-4 py-3 flex items-start justify-between gap-3 text-xs"
                            >
                              <div className="space-y-0.5 min-w-0">
                                <p className="font-medium text-slate-700">{gt.title}</p>
                                {gt.assignedToName && (
                                  <p className="text-slate-500">
                                    Phụ trách: {gt.assignedToName}
                                  </p>
                                )}
                              </div>
                              <span
                                className={`font-medium whitespace-nowrap shrink-0 ${
                                  gt.status === 'completed'
                                    ? 'text-emerald-700'
                                    : 'text-blue-700'
                                }`}
                              >
                                {gt.status === 'completed' ? 'Hoàn thành' : 'Đang làm'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {/* Optional Custom Tasks (only rendered when Admin enables allowCustomStudentTasks) */}
                  {allowCustomTasks && (
                    <div className="pt-2 border-t border-slate-100 space-y-3">
                      <label className="block text-xs font-medium text-slate-700">
                        Thêm công việc ngoài danh sách (tùy chọn)
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newTaskInput}
                          maxLength={LIMITS.MAX_TASK_TITLE_LEN}
                          onChange={(e) => setNewTaskInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddDraftCustomTask();
                            }
                          }}
                          placeholder="Nhập công việc phát sinh khác..."
                          className="flex-1 min-h-[44px] px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-900 transition-colors"
                        />
                        <button
                          type="button"
                          onClick={handleAddDraftCustomTask}
                          aria-label="Thêm công việc tự nhập"
                          className="min-h-[44px] min-w-[44px] px-4 inline-flex items-center justify-center gap-1.5 border border-slate-200 bg-white text-slate-800 text-xs font-medium rounded-xl hover:bg-slate-50 shrink-0 cursor-pointer"
                        >
                          <Plus className="w-4 h-4" />
                          <span>Thêm</span>
                        </button>
                      </div>

                      {draftCustomTasks.length > 0 && (
                        <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                          {draftCustomTasks.map((task, idx) => (
                            <li
                              key={task.id}
                              className="flex items-center gap-3 px-4 py-2.5 bg-white"
                            >
                              <span className="text-xs font-mono tabular-nums text-slate-400 shrink-0">
                                +{idx + 1}
                              </span>
                              <input
                                type="text"
                                value={task.title}
                                maxLength={LIMITS.MAX_TASK_TITLE_LEN}
                                onChange={(e) =>
                                  setDraftCustomTasks((prev) =>
                                    prev.map((item) =>
                                      item.id === task.id
                                        ? { ...item, title: e.target.value }
                                        : item
                                    )
                                  )
                                }
                                className="flex-1 bg-transparent text-sm text-slate-900 focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setDraftCustomTasks((prev) =>
                                    prev.filter((item) => item.id !== task.id)
                                  )
                                }
                                aria-label="Xóa công việc tự nhập"
                                className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center text-slate-400 hover:text-red-600 rounded-lg cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label
                      htmlFor="checkin-note"
                      className="block text-xs font-medium text-slate-600"
                    >
                      Ghi chú đầu ngày (không bắt buộc)
                    </label>
                    <textarea
                      id="checkin-note"
                      rows={2}
                      maxLength={LIMITS.MAX_NOTE_LEN}
                      value={draftNote}
                      onChange={(e) => setDraftNote(e.target.value)}
                      placeholder="Mục tiêu ưu tiên hoặc dự kiến phối hợp nhóm..."
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-900 transition-colors resize-none"
                    />
                  </div>

                  <button
                    type="button"
                    disabled={submitting || totalDraftCount === 0}
                    onClick={handleCheckInSubmit}
                    className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 px-5 py-3 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-800 active:scale-[0.99] transition-all disabled:opacity-50 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      {submitting
                        ? 'Đang nhận việc & Check-in...'
                        : `Xác nhận Check-in đầu ngày (${totalDraftCount} việc)`}
                    </span>
                  </button>
                </div>
              )}

              {/* CASE 2: CHECKED IN -> READY FOR CHECKOUT */}
              {todayCheckin && todayCheckin.status === 'checked_in' && (
                <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900">
                        Checkout cuối ngày
                      </h2>
                      <p className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                        Đã check-in lúc {formatTimestampTime(todayCheckin.checkInAt)} ·{' '}
                        {evalTasks.length} công việc
                      </p>
                    </div>
                    <div className="text-xs font-mono tabular-nums text-slate-600">
                      {evalCompleted} xong · {evalIncomplete} chưa xong · {evalPending} chờ đánh giá
                    </div>
                  </div>

                  {/* Pick extra group tasks mid-day */}
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {extraSelectableGroupTasks.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowPickExtraPanel((v) => !v)}
                          className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 border border-slate-200 bg-slate-50 text-slate-800 text-xs font-medium rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
                        >
                          <Plus className="w-4 h-4" />
                          <span>
                            Nhặt thêm việc từ danh sách nhóm ({extraSelectableGroupTasks.length})
                          </span>
                        </button>
                      )}
                    </div>

                    {showPickExtraPanel && extraSelectableGroupTasks.length > 0 && (
                      <div className="border border-slate-200 rounded-xl p-3 bg-slate-50/70 space-y-2">
                        <p className="text-xs font-medium text-slate-600 px-1">
                          Chọn đầu việc nhóm để bổ sung vào danh sách hôm nay:
                        </p>
                        <div className="space-y-1.5 max-h-64 overflow-y-auto">
                          {extraSelectableGroupTasks.map((gt) => (
                            <div
                              key={gt.id}
                              className="flex items-center justify-between gap-3 p-2.5 bg-white border border-slate-200 rounded-lg"
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-slate-900 truncate">
                                  {gt.title}
                                </p>
                                {gt.description && (
                                  <p className="text-[11px] text-slate-500 truncate">
                                    {gt.description}
                                  </p>
                                )}
                              </div>
                              <button
                                type="button"
                                disabled={submitting}
                                onClick={() => void handlePickExtraGroupTask(gt)}
                                className="min-h-[36px] px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 shrink-0 disabled:opacity-50 cursor-pointer"
                              >
                                Nhặt việc
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Optional free-text extra task only if enabled by Admin */}
                    {allowCustomTasks && (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={addingEvalTask}
                          maxLength={LIMITS.MAX_TASK_TITLE_LEN}
                          onChange={(e) => setAddingEvalTask(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void handleAddEvalCustomTask();
                            }
                          }}
                          placeholder="Bổ sung công việc phát sinh ngoài danh sách..."
                          className="flex-1 min-h-[44px] px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-900 transition-colors"
                        />
                        <button
                          type="button"
                          onClick={() => void handleAddEvalCustomTask()}
                          className="min-h-[44px] px-3.5 inline-flex items-center justify-center gap-1.5 border border-slate-200 bg-white text-slate-700 text-xs font-medium rounded-xl hover:bg-slate-50 transition-colors shrink-0 cursor-pointer"
                        >
                          <Plus className="w-4 h-4" />
                          <span>Bổ sung</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Task Evaluation List */}
                  <div className="space-y-3">
                    {evalTasks.map((task, idx) => {
                      const isIncomplete = task.status === 'incomplete';
                      const isCompleted = task.status === 'completed';
                      const needsInput =
                        isIncomplete &&
                        (task.reason.trim().length === 0 || task.blocker.trim().length === 0);

                      return (
                        <div
                          key={task.id}
                          className={`border rounded-xl p-4 space-y-3 transition-colors ${
                            isCompleted
                              ? 'border-emerald-200 bg-emerald-50/30'
                              : isIncomplete
                              ? 'border-amber-300 bg-amber-50/30'
                              : 'border-slate-200 bg-white'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2.5">
                            <div className="flex items-start gap-2.5 flex-1 min-w-0">
                              <span className="text-xs font-mono tabular-nums text-slate-400 pt-0.5 shrink-0">
                                {String(idx + 1).padStart(2, '0')}.
                              </span>
                              <p className="text-sm font-medium text-slate-900 leading-snug">
                                {task.title}
                              </p>
                            </div>

                            {evalTasks.length > 1 && task.groupTaskId && task.status === 'pending' && (
                              <button
                                type="button"
                                disabled={submitting}
                                onClick={() => void handleReleaseTaskToGroup(task)}
                                title="Trả công việc lại cho nhóm"
                                className="min-h-[32px] inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-500 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors shrink-0 cursor-pointer"
                              >
                                <Undo2 className="w-3.5 h-3.5" />
                                <span>Trả lại nhóm</span>
                              </button>
                            )}
                          </div>

                          {/* 44px+ Touch-Friendly Evaluation Buttons */}
                          <div className="grid grid-cols-2 gap-2.5">
                            <button
                              type="button"
                              onClick={() => handleTaskStatusChange(task.id, 'completed')}
                              className={`min-h-[44px] inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                                isCompleted
                                  ? 'bg-emerald-600 border-emerald-600 text-white'
                                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <Check className="w-4 h-4 shrink-0" />
                              <span className="whitespace-nowrap">Đã hoàn thành</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleTaskStatusChange(task.id, 'incomplete')}
                              className={`min-h-[44px] inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                                isIncomplete
                                  ? 'bg-amber-600 border-amber-600 text-white'
                                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <XCircle className="w-4 h-4 shrink-0" />
                              <span className="whitespace-nowrap">Chưa hoàn thành</span>
                            </button>
                          </div>

                          {/* Mandatory Reason & Blocker when incomplete */}
                          {isIncomplete && (
                            <div className="space-y-3 pt-2 border-t border-amber-200/70">
                              <div className="space-y-1">
                                <label className="block text-xs font-medium text-slate-800">
                                  Lý do chưa hoàn thành <span className="text-red-600">*</span>
                                </label>
                                <input
                                  type="text"
                                  value={task.reason}
                                  maxLength={LIMITS.MAX_REASON_LEN}
                                  onChange={(e) =>
                                    handleTaskFieldChange(task.id, 'reason', e.target.value)
                                  }
                                  placeholder="Ví dụ: Phát sinh lỗi API thanh toán ngoài dự kiến..."
                                  className="w-full min-h-[42px] px-3 py-2 bg-white border border-amber-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900"
                                />
                              </div>

                              <div className="space-y-1">
                                <label className="block text-xs font-medium text-slate-800">
                                  Vướng mắc cụ thể cần giải quyết <span className="text-red-600">*</span>
                                </label>
                                <textarea
                                  rows={2}
                                  value={task.blocker}
                                  maxLength={LIMITS.MAX_BLOCKER_LEN}
                                  onChange={(e) =>
                                    handleTaskFieldChange(task.id, 'blocker', e.target.value)
                                  }
                                  placeholder="Ví dụ: Thiếu tài khoản sandbox test webhook, cần leader/giảng viên cấp quyền..."
                                  className="w-full px-3 py-2 bg-white border border-amber-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 resize-none"
                                />
                              </div>

                              {needsInput && (
                                <p className="text-xs text-amber-800">
                                  Bắt buộc nhập cả lý do và vướng mắc cụ thể trước khi checkout.
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="checkout-note"
                      className="block text-xs font-medium text-slate-600"
                    >
                      Ghi chú cuối ngày
                    </label>
                    <textarea
                      id="checkout-note"
                      rows={2}
                      maxLength={LIMITS.MAX_NOTE_LEN}
                      value={evalNote}
                      onChange={(e) => setEvalNote(e.target.value)}
                      placeholder="Tổng kết thêm hoặc kế hoạch cho ngày tiếp theo..."
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-900 transition-colors resize-none"
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 pt-1">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void handleSaveProgressDraft()}
                      className="sm:w-44 min-h-[48px] inline-flex items-center justify-center px-4 py-2.5 border border-slate-200 bg-white text-slate-700 text-sm font-medium rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      Lưu tạm
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void handleCheckoutSubmit()}
                      className="flex-1 min-h-[48px] inline-flex items-center justify-center gap-2 px-5 py-3 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-800 active:scale-[0.99] transition-all disabled:opacity-50 cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>
                        {submitting ? 'Đang gửi Checkout...' : 'Hoàn tất Checkout cuối ngày'}
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* CASE 3: CHECKED OUT COMPLETE */}
              {todayCheckin && todayCheckin.status === 'checked_out' && (
                <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-emerald-700 text-xs font-medium">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Đã hoàn tất báo cáo ngày hôm nay</span>
                      </div>
                      <h2 className="text-lg font-semibold text-slate-900">
                        Tổng kết công việc {formatDateKeyVN(todayKey)}
                      </h2>
                    </div>

                    <div className="text-right font-mono tabular-nums">
                      <p className="text-2xl font-bold text-slate-900">
                        {todayCheckin.completedCount}/{todayCheckin.totalTasks}
                      </p>
                      <p className="text-xs text-slate-500">công việc hoàn thành</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs font-mono tabular-nums">
                    <div className="p-3 bg-slate-50 rounded-xl">
                      <span className="text-slate-500 block">Giờ Check-in</span>
                      <span className="text-sm font-semibold text-slate-900">
                        {formatTimestampTime(todayCheckin.checkInAt)}
                      </span>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl">
                      <span className="text-slate-500 block">Giờ Checkout</span>
                      <span className="text-sm font-semibold text-slate-900">
                        {formatTimestampTime(todayCheckin.checkOutAt)}
                      </span>
                    </div>
                  </div>

                  <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                    {todayCheckin.tasks.map((task, idx) => (
                      <li key={task.id} className="p-4 space-y-2 bg-white">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-2.5">
                            <span className="text-xs font-mono tabular-nums text-slate-400 pt-0.5">
                              {String(idx + 1).padStart(2, '0')}.
                            </span>
                            <span className="text-sm font-medium text-slate-900">{task.title}</span>
                          </div>
                          <span
                            className={`text-xs font-medium whitespace-nowrap shrink-0 ${
                              task.status === 'completed' ? 'text-emerald-700' : 'text-amber-700'
                            }`}
                          >
                            {task.status === 'completed' ? 'Đã hoàn thành' : 'Chưa hoàn thành'}
                          </span>
                        </div>
                        {task.status === 'incomplete' && (
                          <div className="pl-7 text-xs text-slate-600 space-y-1">
                            <p>
                              <span className="font-medium text-slate-800">Lý do:</span>{' '}
                              {task.reason}
                            </p>
                            <p>
                              <span className="font-medium text-slate-800">Vướng mắc:</span>{' '}
                              {task.blocker}
                            </p>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>

                  {todayCheckin.dailyNote && (
                    <div className="p-3.5 bg-slate-50 rounded-xl text-xs text-slate-600">
                      <span className="font-medium text-slate-800">Ghi chú: </span>
                      {todayCheckin.dailyNote}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right Column: Summary & Group Backlog Overview */}
            <aside className="lg:col-span-4 space-y-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                <h3 className="text-sm font-semibold text-slate-900">Trạng thái hôm nay</h3>
                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Check-in</span>
                    <span className="font-mono tabular-nums font-medium text-slate-900">
                      {todayCheckin ? formatTimestampTime(todayCheckin.checkInAt) : 'Chưa thực hiện'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Checkout</span>
                    <span className="font-mono tabular-nums font-medium text-slate-900">
                      {todayCheckin?.status === 'checked_out'
                        ? formatTimestampTime(todayCheckin.checkOutAt)
                        : 'Chưa checkout'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <span className="text-slate-500">Số ngày đã ghi nhận</span>
                    <span className="font-mono tabular-nums font-semibold text-slate-900">
                      {checkins.length}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  Tiến độ việc của {studentProfile.groupCode}
                </h3>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Chưa có người nhận</span>
                    <span className="font-mono tabular-nums font-semibold text-slate-900">
                      {groupTaskStats.openCount}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Bạn đang đảm nhận</span>
                    <span className="font-mono tabular-nums font-semibold text-blue-700">
                      {groupTaskStats.myClaimedCount}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Nhóm đã hoàn thành</span>
                    <span className="font-mono tabular-nums font-semibold text-emerald-700">
                      {groupTaskStats.completedCount}/{groupTaskStats.total}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">Các ngày gần đây</h3>
                  {pastCheckins.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('history')}
                      className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                    >
                      Xem tất cả
                    </button>
                  )}
                </div>

                {pastCheckins.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Lịch sử các ngày trước sẽ được lưu riêng biệt tại đây.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {pastCheckins.slice(0, 5).map((item) => (
                      <li key={item.id} className="py-2.5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-slate-900 truncate">
                            {formatDateKeyVN(item.dateKey)}
                          </p>
                          <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                            {item.status === 'checked_out' ? 'Đã checkout' : 'Chưa checkout'}
                          </p>
                        </div>
                        <span className="text-xs font-mono tabular-nums font-semibold text-slate-700 shrink-0">
                          {item.completedCount}/{item.totalTasks}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </aside>
          </div>
        ) : (
          /* HISTORY TAB */
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Lịch sử Check-in / Check-out
                </h2>
                <p className="text-xs text-slate-500">
                  Dữ liệu từng ngày được lưu độc lập, không ghi đè các ngày trước.
                </p>
              </div>
              <span className="text-xs font-mono tabular-nums text-slate-500">
                Tổng {checkins.length} ngày
              </span>
            </div>

            {checkins.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-2">
                <p className="text-sm font-medium text-slate-800">Chưa có lịch sử làm việc nào</p>
                <p className="text-xs text-slate-500">
                  Hãy thực hiện Check-in đầu ngày tại tab Công việc hôm nay.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('today')}
                  className="mt-2 min-h-[44px] px-4 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg cursor-pointer"
                >
                  Về trang Hôm nay
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {checkins.map((entry) => {
                  const isExpanded = expandedHistoryId === entry.id;
                  const pct =
                    entry.totalTasks > 0
                      ? Math.round((entry.completedCount / entry.totalTasks) * 100)
                      : 0;
                  return (
                    <div
                      key={entry.id}
                      className="bg-white border border-slate-200 rounded-2xl overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedHistoryId(isExpanded ? null : entry.id)
                        }
                        className="w-full min-h-[64px] px-5 py-4 flex items-center justify-between gap-4 text-left hover:bg-slate-50/80 transition-colors cursor-pointer"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                            <span>{formatDateKeyVN(entry.dateKey)}</span>
                            {entry.dateKey === todayKey && (
                              <span className="text-xs font-medium text-blue-700">· Hôm nay</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 font-mono tabular-nums">
                            Check-in {formatTimestampTime(entry.checkInAt)} · Checkout{' '}
                            {entry.status === 'checked_out'
                              ? formatTimestampTime(entry.checkOutAt)
                              : 'Chưa checkout'}
                          </p>
                        </div>

                        <div className="text-right font-mono tabular-nums shrink-0">
                          <p className="text-sm font-bold text-slate-900">
                            {entry.completedCount}/{entry.totalTasks} ({pct}%)
                          </p>
                          <p
                            className={`text-[11px] ${
                              entry.incompleteCount > 0 ? 'text-amber-700' : 'text-emerald-700'
                            }`}
                          >
                            {entry.incompleteCount > 0
                              ? `${entry.incompleteCount} việc chưa xong`
                              : entry.status === 'checked_out'
                              ? 'Hoàn thành hết'
                              : 'Đang thực hiện'}
                          </p>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="px-5 pb-5 pt-2 border-t border-slate-100 space-y-3">
                          <ul className="divide-y divide-slate-100">
                            {entry.tasks.map((t, i) => (
                              <li key={t.id} className="py-2.5 space-y-1">
                                <div className="flex items-start justify-between gap-3">
                                  <span className="text-sm text-slate-800">
                                    {i + 1}. {t.title}
                                  </span>
                                  <span
                                    className={`text-xs font-medium whitespace-nowrap shrink-0 ${
                                      t.status === 'completed'
                                        ? 'text-emerald-700'
                                        : t.status === 'incomplete'
                                        ? 'text-amber-700'
                                        : 'text-slate-500'
                                    }`}
                                  >
                                    {t.status === 'completed'
                                      ? 'Đã hoàn thành'
                                      : t.status === 'incomplete'
                                      ? 'Chưa hoàn thành'
                                      : 'Đang chờ'}
                                  </span>
                                </div>
                                {t.status === 'incomplete' && (
                                  <div className="text-xs text-slate-600 pl-4 space-y-0.5">
                                    <p>
                                      <span className="font-medium text-slate-700">Lý do:</span>{' '}
                                      {t.reason}
                                    </p>
                                    <p>
                                      <span className="font-medium text-slate-700">Vướng mắc:</span>{' '}
                                      {t.blocker}
                                    </p>
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                          {entry.dailyNote && (
                            <p className="text-xs text-slate-500 bg-slate-50 p-3 rounded-lg">
                              Ghi chú: {entry.dailyNote}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>

      {/* Mobile Fixed Bottom Navigation (<= 64px, fits well inside 15% mobile height cap) */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-2">
        <button
          type="button"
          onClick={() => setActiveTab('today')}
          className={`flex flex-col items-center justify-center gap-1 min-h-[44px] cursor-pointer ${
            activeTab === 'today' ? 'text-slate-900 font-semibold' : 'text-slate-500'
          }`}
        >
          <Clock className="w-5 h-5" />
          <span className="text-[11px]">Hôm nay</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={`flex flex-col items-center justify-center gap-1 min-h-[44px] cursor-pointer ${
            activeTab === 'history' ? 'text-slate-900 font-semibold' : 'text-slate-500'
          }`}
        >
          <History className="w-5 h-5" />
          <span className="text-[11px]">Lịch sử ({pastCheckins.length})</span>
        </button>
      </nav>
    </div>
  );
}
