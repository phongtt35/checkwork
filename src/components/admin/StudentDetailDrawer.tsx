import { X } from 'lucide-react';
import type { DailyCheckin, Student } from '../../types';
import { formatDateKeyVN, formatTimestampTime } from '../../utils/helpers';

interface StudentDetailDrawerProps {
  student: Student | null;
  checkins: DailyCheckin[];
  onClose: () => void;
}

export function StudentDetailDrawer({
  student,
  checkins,
  onClose,
}: StudentDetailDrawerProps) {
  if (!student) return null;

  const studentCheckins = checkins
    .filter((c) => c.studentId === student.id)
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey));

  const totalTasks = studentCheckins.reduce((sum, c) => sum + c.totalTasks, 0);
  const completedTasks = studentCheckins.reduce((sum, c) => sum + c.completedCount, 0);
  const rate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-[2px]">
      <div className="w-full max-w-xl bg-white h-full border-l border-slate-200 flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="font-medium text-slate-800">{student.groupCode}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{student.email}</span>
            </div>
            <h2 className="text-lg font-semibold text-slate-900 truncate">
              {student.fullName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng chi tiết"
            className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-3 divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/70">
          <div className="p-4 text-center">
            <p className="text-xs text-slate-500">Số ngày hoạt động</p>
            <p className="text-lg font-bold font-mono tabular-nums text-slate-900">
              {studentCheckins.length}
            </p>
          </div>
          <div className="p-4 text-center">
            <p className="text-xs text-slate-500">Việc hoàn thành</p>
            <p className="text-lg font-bold font-mono tabular-nums text-slate-900">
              {completedTasks}/{totalTasks}
            </p>
          </div>
          <div className="p-4 text-center">
            <p className="text-xs text-slate-500">Tỷ lệ</p>
            <p className="text-lg font-bold font-mono tabular-nums text-slate-900">{rate}%</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {studentCheckins.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">
              Sinh viên này chưa có lịch sử check-in nào.
            </div>
          ) : (
            studentCheckins.map((entry) => (
              <div
                key={entry.id}
                className="border border-slate-200 rounded-xl overflow-hidden bg-white"
              >
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {formatDateKeyVN(entry.dateKey)}
                    </p>
                    <p className="text-xs text-slate-500 font-mono tabular-nums">
                      Check-in {formatTimestampTime(entry.checkInAt)} · Checkout{' '}
                      {entry.status === 'checked_out'
                        ? formatTimestampTime(entry.checkOutAt)
                        : 'Chưa checkout'}
                    </p>
                  </div>
                  <span className="text-xs font-mono tabular-nums font-semibold text-slate-700">
                    {entry.completedCount}/{entry.totalTasks} xong
                  </span>
                </div>

                <ul className="divide-y divide-slate-100">
                  {entry.tasks.map((task, idx) => (
                    <li key={task.id} className="px-4 py-3 space-y-1.5">
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-sm text-slate-800">
                          {idx + 1}. {task.title}
                        </span>
                        <span
                          className={`text-xs font-medium whitespace-nowrap shrink-0 ${
                            task.status === 'completed'
                              ? 'text-emerald-700'
                              : task.status === 'incomplete'
                              ? 'text-amber-700'
                              : 'text-slate-500'
                          }`}
                        >
                          {task.status === 'completed'
                            ? 'Đã hoàn thành'
                            : task.status === 'incomplete'
                            ? 'Chưa hoàn thành'
                            : 'Đang chờ'}
                        </span>
                      </div>
                      {task.status === 'incomplete' && (
                        <div className="text-xs text-slate-600 pl-4 space-y-1 bg-amber-50/50 rounded-lg p-2.5">
                          <p>
                            <span className="font-semibold text-slate-800">Lý do:</span>{' '}
                            {task.reason}
                          </p>
                          <p>
                            <span className="font-semibold text-slate-800">Vướng mắc:</span>{' '}
                            {task.blocker}
                          </p>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>

                {entry.dailyNote && (
                  <div className="px-4 py-2.5 bg-slate-50/50 border-t border-slate-100 text-xs text-slate-600">
                    <span className="font-medium text-slate-700">Ghi chú:</span> {entry.dailyNote}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
