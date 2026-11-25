import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  CheckSquare,
  Database,
  Download,
  ListTodo,
  LogOut,
  Menu,
  Search,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import type { DailyCheckin, GroupTask, Student } from '../../types';
import { exportDashboardReportExcel } from '../../utils/excel';
import {
  formatDateKeyVN,
  formatTimestampTime,
  getOffsetDateKey,
  getTodayDateKey,
} from '../../utils/helpers';
import {
  DailyCompletionChart,
  type DailyChartPoint,
  GroupCompletionChart,
  type GroupChartPoint,
} from './CompletionCharts';
import { DataAndSettings } from './DataAndSettings';
import { FirebaseDeploymentGuide } from './FirebaseDeploymentGuide';
import { GroupTasksManager } from './GroupTasksManager';
import { StudentDetailDrawer } from './StudentDetailDrawer';
import { StudentsManager } from './StudentsManager';

type AdminSection = 'overview' | 'tasks' | 'students' | 'data' | 'guide';
type DatePreset = 'today' | 'yesterday' | '7days' | 'all' | 'custom';
type StatusFilter =
  | 'ALL'
  | 'NOT_CHECKED_IN'
  | 'CHECKED_IN'
  | 'CHECKED_OUT'
  | 'HAS_INCOMPLETE'
  | 'ALL_COMPLETED';

export function AdminConsole() {
  const { user, systemConfig, signOut } = useAuth();
  const [section, setSection] = useState<AdminSection>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [students, setStudents] = useState<Student[]>([]);
  const [checkins, setCheckins] = useState<DailyCheckin[]>([]);
  const [groupTasks, setGroupTasks] = useState<GroupTask[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // Filters
  const todayKey = useMemo(() => getTodayDateKey(), []);
  const [datePreset, setDatePreset] = useState<DatePreset>('today');
  const [customDate, setCustomDate] = useState<string>(todayKey);
  const [groupFilter, setGroupFilter] = useState<string>('ALL');
  const [studentSearch, setStudentSearch] = useState<string>('');
  const [selectedStudentId, setSelectedStudentId] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

  // Detail Drawer
  const [drawerStudent, setDrawerStudent] = useState<Student | null>(null);

  useEffect(() => {
    let loadedStudents = false;
    let loadedCheckins = false;

    const unsubStudents = onSnapshot(
      collection(db, 'students'),
      (snap) => {
        const list: Student[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Student, 'id'>),
        }));
        list.sort((a, b) =>
          a.groupCode.localeCompare(b.groupCode, 'vi') ||
          a.fullName.localeCompare(b.fullName, 'vi')
        );
        setStudents(list);
        loadedStudents = true;
        if (loadedCheckins) setLoadingData(false);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'students')
    );

    const unsubCheckins = onSnapshot(
      collection(db, 'checkins'),
      (snap) => {
        const list: DailyCheckin[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<DailyCheckin, 'id'>),
        }));
        list.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
        setCheckins(list);
        loadedCheckins = true;
        if (loadedStudents) setLoadingData(false);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'checkins')
    );

    const unsubTasks = onSnapshot(
      collection(db, 'groupTasks'),
      (snap) => {
        const list: GroupTask[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<GroupTask, 'id'>),
        }));
        list.sort((a, b) =>
          a.groupCode.localeCompare(b.groupCode, 'vi') ||
          a.status.localeCompare(b.status)
        );
        setGroupTasks(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'groupTasks')
    );

    return () => {
      unsubStudents();
      unsubCheckins();
      unsubTasks();
    };
  }, []);

  const groups = useMemo(() => {
    const set = new Set(students.map((s) => s.groupCode).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'));
  }, [students]);

  const activeSingleDateKey = useMemo(() => {
    if (datePreset === 'today') return todayKey;
    if (datePreset === 'yesterday') return getOffsetDateKey(-1);
    if (datePreset === 'custom') return customDate || todayKey;
    return null;
  }, [datePreset, customDate, todayKey]);

  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    return students.filter((s) => {
      if (groupFilter !== 'ALL' && s.groupCode !== groupFilter) return false;
      if (selectedStudentId !== 'ALL' && s.id !== selectedStudentId) return false;
      if (!q) return true;
      return (
        s.fullName.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q) ||
        s.groupCode.toLowerCase().includes(q)
      );
    });
  }, [students, groupFilter, selectedStudentId, studentSearch]);

  const filteredStudentIds = useMemo(
    () => new Set(filteredStudents.map((s) => s.id)),
    [filteredStudents]
  );

  // Checkins filtered by Date & Student/Group filters (before Status filter for KPI/Chart calculation)
  const dateAndStudentFilteredCheckins = useMemo(() => {
    const min7Days = getOffsetDateKey(-6);
    return checkins.filter((c) => {
      if (!filteredStudentIds.has(c.studentId)) return false;
      if (datePreset === 'today') return c.dateKey === todayKey;
      if (datePreset === 'yesterday') return c.dateKey === getOffsetDateKey(-1);
      if (datePreset === 'custom') return c.dateKey === (customDate || todayKey);
      if (datePreset === '7days') return c.dateKey >= min7Days && c.dateKey <= todayKey;
      return true;
    });
  }, [checkins, filteredStudentIds, datePreset, customDate, todayKey]);

  // Apply Status filter for rows
  const matchesStatusFilter = (c: DailyCheckin | null): boolean => {
    if (statusFilter === 'ALL') return true;
    if (statusFilter === 'NOT_CHECKED_IN') return c === null;
    if (!c) return false;
    if (statusFilter === 'CHECKED_IN') return c.status === 'checked_in';
    if (statusFilter === 'CHECKED_OUT') return c.status === 'checked_out';
    if (statusFilter === 'HAS_INCOMPLETE') return c.incompleteCount > 0;
    if (statusFilter === 'ALL_COMPLETED') {
      return c.status === 'checked_out' && c.incompleteCount === 0 && c.totalTasks > 0;
    }
    return true;
  };

  // Single-day per-student rows (includes students who haven't checked in!)
  const singleDayRows = useMemo(() => {
    if (!activeSingleDateKey) return [];
    const checkinByStudent = new Map<string, DailyCheckin>();
    for (const c of dateAndStudentFilteredCheckins) {
      checkinByStudent.set(c.studentId, c);
    }
    return filteredStudents
      .map((student) => ({
        student,
        checkin: checkinByStudent.get(student.id) ?? null,
      }))
      .filter((row) => matchesStatusFilter(row.checkin));
  }, [activeSingleDateKey, dateAndStudentFilteredCheckins, filteredStudents, statusFilter]);

  // Multi-day rows
  const multiDayRows = useMemo(() => {
    if (activeSingleDateKey) return [];
    const studentById = new Map(students.map((s) => [s.id, s]));
    return dateAndStudentFilteredCheckins
      .filter((c) => matchesStatusFilter(c))
      .map((c) => ({
        checkin: c,
        student: studentById.get(c.studentId) ?? null,
      }));
  }, [activeSingleDateKey, dateAndStudentFilteredCheckins, students, statusFilter]);

  // KPI computations
  const kpis = useMemo(() => {
    const totalStudents = filteredStudents.length;
    const checkedInStudentSet = new Set(dateAndStudentFilteredCheckins.map((c) => c.studentId));
    const checkedOutStudentSet = new Set(
      dateAndStudentFilteredCheckins
        .filter((c) => c.status === 'checked_out')
        .map((c) => c.studentId)
    );
    const incompleteStudentSet = new Set(
      dateAndStudentFilteredCheckins
        .filter((c) => c.incompleteCount > 0)
        .map((c) => c.studentId)
    );

    const totalTasks = dateAndStudentFilteredCheckins.reduce((s, c) => s + c.totalTasks, 0);
    const completedTasks = dateAndStudentFilteredCheckins.reduce(
      (s, c) => s + c.completedCount,
      0
    );
    const incompleteTasks = dateAndStudentFilteredCheckins.reduce(
      (s, c) => s + c.incompleteCount,
      0
    );
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    return {
      totalStudents,
      checkedInCount: checkedInStudentSet.size,
      checkedOutCount: checkedOutStudentSet.size,
      incompleteStudentCount: incompleteStudentSet.size,
      totalTasks,
      completedTasks,
      incompleteTasks,
      completionRate,
    };
  }, [filteredStudents, dateAndStudentFilteredCheckins]);

  // Group Summary & Chart Data
  const groupSummary = useMemo(() => {
    const studentsByGroup = new Map<string, Student[]>();
    for (const s of filteredStudents) {
      const list = studentsByGroup.get(s.groupCode) ?? [];
      list.push(s);
      studentsByGroup.set(s.groupCode, list);
    }

    const checkinsByGroup = new Map<string, DailyCheckin[]>();
    for (const c of dateAndStudentFilteredCheckins) {
      const list = checkinsByGroup.get(c.groupCode) ?? [];
      list.push(c);
      checkinsByGroup.set(c.groupCode, list);
    }

    const result: Array<{
      groupCode: string;
      totalStudents: number;
      checkedInStudents: number;
      checkedOutStudents: number;
      completedTasks: number;
      incompleteTasks: number;
      totalTasks: number;
      completionRate: number;
    }> = [];

    for (const [groupCode, grpStudents] of studentsByGroup.entries()) {
      const grpCheckins = checkinsByGroup.get(groupCode) ?? [];
      const checkedInSet = new Set(grpCheckins.map((c) => c.studentId));
      const checkedOutSet = new Set(
        grpCheckins.filter((c) => c.status === 'checked_out').map((c) => c.studentId)
      );
      const completedTasks = grpCheckins.reduce((s, c) => s + c.completedCount, 0);
      const incompleteTasks = grpCheckins.reduce((s, c) => s + c.incompleteCount, 0);
      const totalTasks = grpCheckins.reduce((s, c) => s + c.totalTasks, 0);
      const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

      result.push({
        groupCode,
        totalStudents: grpStudents.length,
        checkedInStudents: checkedInSet.size,
        checkedOutStudents: checkedOutSet.size,
        completedTasks,
        incompleteTasks,
        totalTasks,
        completionRate,
      });
    }

    result.sort((a, b) => a.completionRate - b.completionRate || a.groupCode.localeCompare(b.groupCode, 'vi'));
    return result;
  }, [filteredStudents, dateAndStudentFilteredCheckins]);

  // Daily Chart Data (uses checkins filtered by student/group, plus date range when 7days/all, or last 7 days context when single day)
  const dailyChartData: DailyChartPoint[] = useMemo(() => {
    const source =
      activeSingleDateKey !== null
        ? checkins.filter((c) => filteredStudentIds.has(c.studentId))
        : dateAndStudentFilteredCheckins;

    const byDate = new Map<string, DailyCheckin[]>();
    for (const c of source) {
      const list = byDate.get(c.dateKey) ?? [];
      list.push(c);
      byDate.set(c.dateKey, list);
    }

    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateKey, list]) => {
        const totalTasks = list.reduce((s, c) => s + c.totalTasks, 0);
        const completedTasks = list.reduce((s, c) => s + c.completedCount, 0);
        const incompleteTasks = list.reduce((s, c) => s + c.incompleteCount, 0);
        const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
        const checkedInStudents = new Set(list.map((c) => c.studentId)).size;
        return {
          dateKey,
          totalTasks,
          completedTasks,
          incompleteTasks,
          completionRate,
          checkedInStudents,
        };
      });
  }, [activeSingleDateKey, checkins, dateAndStudentFilteredCheckins, filteredStudentIds]);

  const groupChartData: GroupChartPoint[] = useMemo(
    () =>
      groupSummary.map((g) => ({
        groupCode: g.groupCode,
        totalStudents: g.totalStudents,
        totalTasks: g.totalTasks,
        completedTasks: g.completedTasks,
        incompleteTasks: g.incompleteTasks,
        completionRate: g.completionRate,
      })),
    [groupSummary]
  );

  // Incomplete students grouped by groupCode
  const incompleteByGroup = useMemo(() => {
    const grouped = new Map<string, DailyCheckin[]>();
    for (const c of dateAndStudentFilteredCheckins) {
      if (c.incompleteCount > 0) {
        const list = grouped.get(c.groupCode) ?? [];
        list.push(c);
        grouped.set(c.groupCode, list);
      }
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b, 'vi'));
  }, [dateAndStudentFilteredCheckins]);

  const studentMap = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  const handleExportReport = () => {
    const label = activeSingleDateKey || (datePreset === '7days' ? '7_ngay_qua' : 'tat_ca');
    exportDashboardReportExcel(filteredStudents, dateAndStudentFilteredCheckins, label);
  };

  const navItems: Array<{ id: AdminSection; label: string; icon: typeof BarChart3 }> = [
    { id: 'overview', label: 'Tổng quan & Tiến độ', icon: BarChart3 },
    { id: 'tasks', label: 'Việc cần làm theo nhóm', icon: ListTodo },
    { id: 'students', label: 'Quản lý sinh viên', icon: Users },
    { id: 'data', label: 'Quản trị & Dữ liệu', icon: Database },
    { id: 'guide', label: 'Hướng dẫn Firebase', icon: BookOpen },
  ];

  const sectionTitle = navItems.find((n) => n.id === section)?.label || '';

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex">
      {/* Desktop Sidebar (256px) */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col bg-white border-r border-slate-200 sticky top-0 h-screen">
        <div className="h-16 px-5 border-b border-slate-200 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
            <CheckSquare className="w-4 h-4" />
          </div>
          <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            CheckWork
          </span>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`w-full min-h-[42px] flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-3">
          <div className="space-y-0.5 min-w-0">
            <p className="text-xs font-medium text-slate-900 truncate">
              {systemConfig?.organizationName || 'Quản trị viên'}
            </p>
            <p className="text-[11px] text-slate-500 font-mono truncate">{user?.email}</p>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="w-full min-h-[40px] inline-flex items-center justify-center gap-2 px-3 py-2 border border-slate-200 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Đăng xuất</span>
          </button>
        </div>
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative w-64 max-w-[80vw] bg-white h-full border-r border-slate-200 flex flex-col z-10">
            <div className="h-14 px-4 border-b border-slate-200 flex items-center justify-between">
              <span className="font-display text-base font-bold text-slate-900">CheckWork</span>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center text-slate-500 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSection(item.id);
                      setMobileNavOpen(false);
                    }}
                    className={`w-full min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium ${
                      active ? 'bg-slate-900 text-white' : 'text-slate-600'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-200">
              <button
                type="button"
                onClick={signOut}
                className="w-full min-h-[42px] inline-flex items-center justify-center gap-2 border border-slate-200 text-slate-700 text-xs font-medium rounded-lg"
              >
                <LogOut className="w-4 h-4" />
                <span>Đăng xuất</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-14 lg:h-16 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Mở menu"
              className="lg:hidden min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-xs sm:text-sm min-w-0">
              <span className="text-slate-400 hidden sm:inline">Quản trị</span>
              <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <span className="font-semibold text-slate-900 truncate">{sectionTitle}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {section === 'overview' && (
              <button
                type="button"
                onClick={handleExportReport}
                className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 border border-slate-200 bg-white text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Xuất báo cáo (.xlsx)</span>
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {loadingData ? (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                {[1, 2, 3, 4, 5].map((n) => (
                  <div
                    key={n}
                    className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse"
                  />
                ))}
              </div>
              <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
            </div>
          ) : section === 'overview' ? (
            <div className="space-y-6">
              {/* Filters Bar */}
              <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {/* Date Preset Segmented Control */}
                  <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
                    {(
                      [
                        { id: 'today', label: 'Hôm nay' },
                        { id: 'yesterday', label: 'Hôm qua' },
                        { id: '7days', label: '7 ngày qua' },
                        { id: 'all', label: 'Tất cả' },
                        { id: 'custom', label: 'Chọn ngày' },
                      ] as const
                    ).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setDatePreset(p.id)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                          datePreset === p.id
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  {datePreset === 'custom' && (
                    <input
                      type="date"
                      value={customDate}
                      onChange={(e) => setCustomDate(e.target.value)}
                      className="min-h-[38px] px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-mono text-slate-800"
                    />
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={studentSearch}
                      onChange={(e) => setStudentSearch(e.target.value)}
                      placeholder="Tìm tên, email sinh viên..."
                      className="w-full min-h-[40px] pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-900"
                    />
                  </div>

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
                    value={selectedStudentId}
                    onChange={(e) => setSelectedStudentId(e.target.value)}
                    className="min-h-[40px] px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:border-slate-900"
                  >
                    <option value="ALL">Tất cả sinh viên ({students.length})</option>
                    {students.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.fullName} ({s.groupCode})
                      </option>
                    ))}
                  </select>

                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                    className="min-h-[40px] px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:border-slate-900"
                  >
                    <option value="ALL">Tất cả trạng thái</option>
                    {activeSingleDateKey && (
                      <option value="NOT_CHECKED_IN">Chưa check-in</option>
                    )}
                    <option value="CHECKED_IN">Đã check-in (chờ checkout)</option>
                    <option value="CHECKED_OUT">Đã checkout</option>
                    <option value="HAS_INCOMPLETE">Có việc chưa hoàn thành</option>
                    <option value="ALL_COMPLETED">Hoàn thành 100%</option>
                  </select>
                </div>
              </section>

              {/* KPI Strip */}
              <section className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
                  <p className="text-xs text-slate-500">Tổng sinh viên</p>
                  <p className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                    {kpis.totalStudents}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
                  <p className="text-xs text-slate-500">Đã check-in</p>
                  <p className="text-2xl font-bold font-mono tabular-nums text-blue-700">
                    {kpis.checkedInCount}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
                  <p className="text-xs text-slate-500">Đã checkout</p>
                  <p className="text-2xl font-bold font-mono tabular-nums text-emerald-700">
                    {kpis.checkedOutCount}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
                  <p className="text-xs text-slate-500">SV có việc chưa xong</p>
                  <p className="text-2xl font-bold font-mono tabular-nums text-amber-700">
                    {kpis.incompleteStudentCount}
                  </p>
                </div>
                <div className="col-span-2 lg:col-span-1 bg-white border border-slate-200 rounded-xl p-4 space-y-1">
                  <p className="text-xs text-slate-500">Tỷ lệ hoàn thành việc</p>
                  <div className="flex items-baseline gap-2 font-mono tabular-nums">
                    <span className="text-2xl font-bold text-slate-900">
                      {kpis.completionRate}%
                    </span>
                    <span className="text-xs text-slate-500">
                      ({kpis.completedTasks}/{kpis.totalTasks})
                    </span>
                  </div>
                </div>
              </section>

              {/* Charts Row */}
              <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <DailyCompletionChart data={dailyChartData} />
                <GroupCompletionChart data={groupChartData} />
              </section>

              {/* Group Overview Table */}
              <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Tổng quan tiến độ theo nhóm
                    </h3>
                    <p className="text-xs text-slate-500">
                      Nhấn vào tên nhóm để lọc nhanh danh sách sinh viên thuộc nhóm đó
                    </p>
                  </div>
                  {groupFilter !== 'ALL' && (
                    <button
                      type="button"
                      onClick={() => setGroupFilter('ALL')}
                      className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                    >
                      Bỏ lọc nhóm
                    </button>
                  )}
                </div>

                {groupSummary.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500">
                    Chưa có nhóm sinh viên nào. Hãy import danh sách Excel tại mục Quản lý sinh
                    viên.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                          <th className="py-3 px-4">Mã nhóm</th>
                          <th className="py-3 px-4 text-right">Tổng SV</th>
                          <th className="py-3 px-4 text-right">Đã check-in</th>
                          <th className="py-3 px-4 text-right">Đã checkout</th>
                          <th className="py-3 px-4 text-right">Việc hoàn thành</th>
                          <th className="py-3 px-4 text-right">Chưa hoàn thành</th>
                          <th className="py-3 px-4 text-right">Tỷ lệ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {groupSummary.map((g) => (
                          <tr
                            key={g.groupCode}
                            onClick={() =>
                              setGroupFilter((prev) =>
                                prev === g.groupCode ? 'ALL' : g.groupCode
                              )
                            }
                            className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                          >
                            <td className="py-3 px-4 font-medium text-slate-900">
                              {g.groupCode}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                              {g.totalStudents}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums text-blue-700">
                              {g.checkedInStudents}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-700">
                              {g.checkedOutStudents}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-800">
                              {g.completedTasks}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums text-amber-700">
                              {g.incompleteTasks}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                              {g.totalTasks > 0 ? `${g.completionRate}%` : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Incomplete Tasks Grouped by Group */}
              <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        Sinh viên chưa hoàn thành công việc (Phân loại theo nhóm)
                      </h3>
                      <p className="text-xs text-slate-500">
                        Hiển thị chi tiết lý do và các vướng mắc cần hỗ trợ
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-mono tabular-nums text-amber-700 font-medium">
                    {incompleteByGroup.length} nhóm có việc trễ
                  </span>
                </div>

                {incompleteByGroup.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500">
                    Không có sinh viên nào báo cáo công việc chưa hoàn thành trong bộ lọc hiện tại.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200">
                    {incompleteByGroup.map(([grpCode, items]) => (
                      <div key={grpCode} className="p-5 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-semibold text-slate-900">{grpCode}</h4>
                          <span className="text-xs font-mono tabular-nums text-slate-500">
                            {items.length} lượt chưa hoàn thành
                          </span>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                          {items.map((entry) => {
                            const stu = studentMap.get(entry.studentId) ?? null;
                            const incompleteTasks = entry.tasks.filter(
                              (t) => t.status === 'incomplete'
                            );
                            return (
                              <div
                                key={entry.id}
                                className="border border-amber-200 bg-amber-50/30 rounded-xl p-4 space-y-2.5"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-semibold text-slate-900">
                                      {entry.studentName}
                                    </p>
                                    <p className="text-xs text-slate-500 font-mono tabular-nums">
                                      {formatDateKeyVN(entry.dateKey)} · {entry.incompleteCount}/
                                      {entry.totalTasks} việc chưa xong
                                    </p>
                                  </div>
                                  {stu && (
                                    <button
                                      type="button"
                                      onClick={() => setDrawerStudent(stu)}
                                      className="text-xs font-medium text-blue-700 hover:underline shrink-0 cursor-pointer"
                                    >
                                      Xem lịch sử
                                    </button>
                                  )}
                                </div>

                                <ul className="space-y-2">
                                  {incompleteTasks.map((task) => (
                                    <li
                                      key={task.id}
                                      className="bg-white border border-amber-200/70 rounded-lg p-3 text-xs space-y-1"
                                    >
                                      <p className="font-semibold text-slate-900">{task.title}</p>
                                      <p className="text-slate-600">
                                        <span className="font-medium text-slate-800">Lý do:</span>{' '}
                                        {task.reason}
                                      </p>
                                      <p className="text-slate-600">
                                        <span className="font-medium text-slate-800">
                                          Vướng mắc:
                                        </span>{' '}
                                        {task.blocker}
                                      </p>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Detailed Activity Table */}
              <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Chi tiết hoạt động sinh viên
                    </h3>
                    <p className="text-xs text-slate-500">
                      {activeSingleDateKey
                        ? `Ngày ${formatDateKeyVN(activeSingleDateKey)}`
                        : datePreset === '7days'
                        ? 'Trong 7 ngày gần nhất'
                        : 'Toàn bộ thời gian'}
                    </p>
                  </div>
                  <span className="text-xs font-mono tabular-nums text-slate-500">
                    {activeSingleDateKey ? singleDayRows.length : multiDayRows.length} dòng
                  </span>
                </div>

                {activeSingleDateKey ? (
                  singleDayRows.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500">
                      Không có dữ liệu phù hợp với bộ lọc hiện tại.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                            <th className="py-3 px-4">Sinh viên</th>
                            <th className="py-3 px-4">Nhóm</th>
                            <th className="py-3 px-4">Trạng thái</th>
                            <th className="py-3 px-4">Check-in</th>
                            <th className="py-3 px-4">Checkout</th>
                            <th className="py-3 px-4 text-right">Hoàn thành</th>
                            <th className="py-3 px-4 text-right">Lịch sử</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {singleDayRows.map(({ student, checkin }) => (
                            <tr
                              key={student.id}
                              onClick={() => setDrawerStudent(student)}
                              className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                            >
                              <td className="py-3 px-4">
                                <p className="font-medium text-slate-900">{student.fullName}</p>
                                <p className="text-xs font-mono text-slate-500">{student.email}</p>
                              </td>
                              <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                                {student.groupCode}
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap text-xs font-medium">
                                {!checkin ? (
                                  <span className="text-slate-400">Chưa check-in</span>
                                ) : checkin.status === 'checked_in' ? (
                                  <span className="text-blue-700">Đã check-in</span>
                                ) : checkin.incompleteCount > 0 ? (
                                  <span className="text-amber-700">
                                    Checkout ({checkin.incompleteCount} chưa xong)
                                  </span>
                                ) : (
                                  <span className="text-emerald-700">Hoàn thành hết</span>
                                )}
                              </td>
                              <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600">
                                {checkin ? formatTimestampTime(checkin.checkInAt) : '—'}
                              </td>
                              <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600">
                                {checkin?.status === 'checked_out'
                                  ? formatTimestampTime(checkin.checkOutAt)
                                  : '—'}
                              </td>
                              <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-800">
                                {checkin
                                  ? `${checkin.completedCount}/${checkin.totalTasks}`
                                  : '—'}
                              </td>
                              <td className="py-3 px-4 text-right">
                                <span className="text-xs font-medium text-blue-700 hover:underline">
                                  Chi tiết
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : multiDayRows.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500">
                    Chưa có dữ liệu check-in nào trong khoảng thời gian đã chọn.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                          <th className="py-3 px-4">Ngày</th>
                          <th className="py-3 px-4">Sinh viên</th>
                          <th className="py-3 px-4">Nhóm</th>
                          <th className="py-3 px-4">Trạng thái</th>
                          <th className="py-3 px-4">Check-in / Out</th>
                          <th className="py-3 px-4 text-right">Tiến độ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {multiDayRows.map(({ checkin, student }) => (
                          <tr
                            key={checkin.id}
                            onClick={() => student && setDrawerStudent(student)}
                            className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                          >
                            <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap">
                              {checkin.dateKey}
                            </td>
                            <td className="py-3 px-4">
                              <p className="font-medium text-slate-900">{checkin.studentName}</p>
                              <p className="text-xs font-mono text-slate-500">
                                {checkin.studentEmail}
                              </p>
                            </td>
                            <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                              {checkin.groupCode}
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap text-xs font-medium">
                              {checkin.status === 'checked_in' ? (
                                <span className="text-blue-700">Đã check-in</span>
                              ) : checkin.incompleteCount > 0 ? (
                                <span className="text-amber-700">
                                  Có {checkin.incompleteCount} việc chưa xong
                                </span>
                              ) : (
                                <span className="text-emerald-700">Hoàn thành</span>
                              )}
                            </td>
                            <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                              {formatTimestampTime(checkin.checkInAt)} &rarr;{' '}
                              {checkin.status === 'checked_out'
                                ? formatTimestampTime(checkin.checkOutAt)
                                : 'Chưa out'}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums font-medium text-slate-900">
                              {checkin.completedCount}/{checkin.totalTasks}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          ) : section === 'tasks' ? (
            <GroupTasksManager students={students} groupTasks={groupTasks} />
          ) : section === 'students' ? (
            <StudentsManager students={students} />
          ) : section === 'data' ? (
            <DataAndSettings
              students={students}
              checkins={checkins}
              groupTasks={groupTasks}
            />
          ) : (
            <FirebaseDeploymentGuide />
          )}
        </main>
      </div>

      {/* Slide-over Student Detail Drawer */}
      <StudentDetailDrawer
        student={drawerStudent}
        checkins={checkins}
        onClose={() => setDrawerStudent(null)}
      />
    </div>
  );
}
