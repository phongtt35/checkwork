import { useState } from 'react';
import { formatShortDateVN } from '../../utils/helpers';

export interface DailyChartPoint {
  dateKey: string;
  totalTasks: number;
  completedTasks: number;
  incompleteTasks: number;
  completionRate: number;
  checkedInStudents: number;
}

export interface GroupChartPoint {
  groupCode: string;
  totalStudents: number;
  totalTasks: number;
  completedTasks: number;
  incompleteTasks: number;
  completionRate: number;
}

export function DailyCompletionChart({ data }: { data: DailyChartPoint[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between min-h-[260px]">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Tỷ lệ hoàn thành công việc theo ngày
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Phần trăm đầu việc hoàn thành trên tổng số việc đã check-in
          </p>
        </div>
        <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
          Chưa có dữ liệu check-in trong khoảng thời gian đã chọn
        </div>
      </div>
    );
  }

  const visible = data.slice(-14);
  const hovered = hoveredIdx !== null ? visible[hoveredIdx] : null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Tỷ lệ hoàn thành công việc theo ngày
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {hovered ? (
              <span className="font-mono tabular-nums text-slate-700">
                {hovered.dateKey}: {hovered.completionRate}% ({hovered.completedTasks}/
                {hovered.totalTasks} việc · {hovered.checkedInStudents} SV check-in)
              </span>
            ) : (
              'Di chuột lên cột để xem chi tiết từng ngày'
            )}
          </p>
        </div>
        <span className="text-xs font-mono tabular-nums text-slate-500 shrink-0">
          {visible.length} ngày
        </span>
      </div>

      <div className="relative h-48 flex items-end gap-2 pt-4 pb-6 border-b border-slate-100">
        {/* Horizontal reference lines */}
        <div className="absolute inset-x-0 top-4 bottom-6 pointer-events-none flex flex-col justify-between">
          {[100, 50, 0].map((tick) => (
            <div key={tick} className="flex items-center gap-2 w-full">
              <span className="text-[10px] font-mono tabular-nums text-slate-400 w-7 text-right">
                {tick}%
              </span>
              <div className="flex-1 border-t border-dashed border-slate-100" />
            </div>
          ))}
        </div>

        <div className="relative z-10 flex-1 pl-9 h-full flex items-end gap-1.5 sm:gap-2.5">
          {visible.map((point, idx) => {
            const isHovered = hoveredIdx === idx;
            const barColor =
              point.completionRate >= 80
                ? 'bg-emerald-600'
                : point.completionRate >= 50
                ? 'bg-blue-600'
                : 'bg-amber-500';

            return (
              <div
                key={point.dateKey}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                className="flex-1 h-full flex flex-col items-center justify-end group cursor-pointer"
              >
                <div className="w-full max-w-[34px] h-full flex items-end">
                  <div
                    style={{ height: `${Math.max(point.completionRate, 4)}%` }}
                    className={`w-full rounded-t-md transition-opacity ${barColor} ${
                      hoveredIdx !== null && !isHovered ? 'opacity-45' : 'opacity-100'
                    }`}
                  />
                </div>
                <span className="absolute -bottom-6 text-[10px] font-mono tabular-nums text-slate-500 whitespace-nowrap">
                  {formatShortDateVN(point.dateKey)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function GroupCompletionChart({ data }: { data: GroupChartPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between min-h-[260px]">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Tỷ lệ hoàn thành công việc theo nhóm
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            So sánh hiệu suất hoàn thành giữa các nhóm
          </p>
        </div>
        <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
          Chưa có dữ liệu nhóm để hiển thị
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Tỷ lệ hoàn thành công việc theo nhóm
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Sắp xếp từ nhóm cần chú ý đến nhóm đạt tiến độ cao
          </p>
        </div>
        <span className="text-xs font-mono tabular-nums text-slate-500 shrink-0">
          {data.length} nhóm
        </span>
      </div>

      <div className="space-y-3 max-h-52 overflow-y-auto pr-1">
        {data.map((group) => {
          const barColor =
            group.totalTasks === 0
              ? 'bg-slate-300'
              : group.completionRate >= 80
              ? 'bg-emerald-600'
              : group.completionRate >= 50
              ? 'bg-blue-600'
              : 'bg-amber-500';

          return (
            <div key={group.groupCode} className="space-y-1">
              <div className="flex items-center justify-between text-xs gap-2">
                <span className="font-medium text-slate-800 truncate">{group.groupCode}</span>
                <span className="font-mono tabular-nums text-slate-600 shrink-0">
                  {group.totalTasks > 0
                    ? `${group.completionRate}% (${group.completedTasks}/${group.totalTasks})`
                    : 'Chưa có việc'}
                </span>
              </div>
              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                <div
                  style={{ width: `${group.totalTasks > 0 ? group.completionRate : 0}%` }}
                  className={`h-full rounded-full transition-all ${barColor}`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
