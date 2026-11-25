import * as XLSX from 'xlsx';
import type { DailyCheckin, Student, TaskPriority } from '../types';
import { formatTimestampTime, isValidEmail, LIMITS, normalizeEmail, sanitizeText } from './helpers';

export interface ParsedStudentRow {
  rowNumber: number;
  email: string;
  fullName: string;
  groupCode: string;
}

export interface ExcelRowError {
  rowNumber: number;
  rawEmail: string;
  rawName: string;
  rawGroup: string;
  reason: string;
}

export interface ExcelParseResult {
  valid: ParsedStudentRow[];
  errors: ExcelRowError[];
  totalRows: number;
}

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]/g, '');
}

export async function parseStudentsExcel(file: File): Promise<ExcelParseResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('File Excel không có sheet dữ liệu nào.');
  }
  const worksheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: '',
    blankrows: false,
  });

  if (rows.length === 0) {
    throw new Error('Sheet Excel đang trống.');
  }

  const firstRow = rows[0].map((cell) => String(cell ?? ''));
  const normalizedHeaders = firstRow.map(normalizeHeader);

  let emailCol = normalizedHeaders.findIndex((h) => h.includes('email') || h === 'mail');
  let nameCol = normalizedHeaders.findIndex(
    (h) => h.includes('hoten') || h.includes('hovaten') || h === 'ten' || h.includes('fullname') || h === 'name'
  );
  let groupCol = normalizedHeaders.findIndex(
    (h) => h.includes('manhom') || h === 'nhom' || h.includes('group') || h.includes('groupcode')
  );

  const hasHeaderRow = emailCol !== -1 || nameCol !== -1 || groupCol !== -1;
  if (!hasHeaderRow) {
    // Fallback to standard 3-column layout: Email | Họ tên | Mã nhóm
    emailCol = 0;
    nameCol = 1;
    groupCol = 2;
  } else {
    if (emailCol === -1) emailCol = 0;
    if (nameCol === -1) nameCol = 1;
    if (groupCol === -1) groupCol = 2;
  }

  const startIndex = hasHeaderRow ? 1 : 0;
  const seenEmails = new Set<string>();
  const valid: ParsedStudentRow[] = [];
  const errors: ExcelRowError[] = [];

  for (let i = startIndex; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 1;
    const rawEmail = String(row[emailCol] ?? '').trim();
    const rawName = String(row[nameCol] ?? '').trim();
    const rawGroup = String(row[groupCol] ?? '').trim();

    if (!rawEmail && !rawName && !rawGroup) {
      continue;
    }

    const email = normalizeEmail(rawEmail);
    const fullName = sanitizeText(rawName, LIMITS.MAX_NAME_LEN);
    const groupCode = sanitizeText(rawGroup, LIMITS.MAX_GROUP_LEN);

    if (!isValidEmail(email)) {
      errors.push({
        rowNumber,
        rawEmail,
        rawName,
        rawGroup,
        reason: 'Email không hợp lệ hoặc vượt quá 150 ký tự',
      });
      continue;
    }

    if (!fullName) {
      errors.push({
        rowNumber,
        rawEmail,
        rawName,
        rawGroup,
        reason: 'Thiếu họ tên sinh viên',
      });
      continue;
    }

    if (!groupCode) {
      errors.push({
        rowNumber,
        rawEmail,
        rawName,
        rawGroup,
        reason: 'Thiếu mã nhóm',
      });
      continue;
    }

    if (seenEmails.has(email)) {
      errors.push({
        rowNumber,
        rawEmail,
        rawName,
        rawGroup,
        reason: 'Email bị trùng lặp trong file Excel',
      });
      continue;
    }

    seenEmails.add(email);
    valid.push({ rowNumber, email, fullName, groupCode });
  }

  return {
    valid,
    errors,
    totalRows: Math.max(0, rows.length - startIndex),
  };
}

export function downloadSampleExcel(): void {
  const sampleRows = [
    ['Email', 'Họ tên', 'Mã nhóm'],
    ['an.nguyen@fpt.edu.vn', 'Nguyễn Văn An', 'Nhóm 01'],
    ['binh.tran@fpt.edu.vn', 'Trần Thị Bình', 'Nhóm 01'],
    ['chi.le@fpt.edu.vn', 'Lê Minh Chi', 'Nhóm 02'],
    ['dung.pham@fpt.edu.vn', 'Phạm Quốc Dũng', 'Nhóm 02'],
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(sampleRows);
  worksheet['!cols'] = [{ wch: 28 }, { wch: 24 }, { wch: 14 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'DanhSachSinhVien');
  XLSX.writeFile(workbook, 'mau_danh_sach_sinh_vien.xlsx');
}

export function exportDashboardReportExcel(
  students: Student[],
  checkins: DailyCheckin[],
  dateLabel: string
): void {
  const checkinMap = new Map<string, DailyCheckin[]>();
  for (const c of checkins) {
    const existing = checkinMap.get(c.studentId) ?? [];
    existing.push(c);
    checkinMap.set(c.studentId, existing);
  }

  const rows: Record<string, string | number>[] = [];
  for (const student of students) {
    const list = checkinMap.get(student.id) ?? [];
    if (list.length === 0) {
      rows.push({
        'Họ tên': student.fullName,
        Email: student.email,
        'Mã nhóm': student.groupCode,
        Ngày: dateLabel,
        'Trạng thái': 'Chưa check-in',
        'Giờ Check-in': '—',
        'Giờ Checkout': '—',
        'Tổng việc': 0,
        'Hoàn thành': 0,
        'Chưa hoàn thành': 0,
        'Chi tiết chưa hoàn thành & vướng mắc': '',
      });
    } else {
      for (const c of list) {
        const incompleteDetails = c.tasks
          .filter((t) => t.status === 'incomplete')
          .map((t) => `[${t.title}] Lý do: ${t.reason} | Vướng mắc: ${t.blocker}`)
          .join('\n');
        rows.push({
          'Họ tên': student.fullName,
          Email: student.email,
          'Mã nhóm': c.groupCode,
          Ngày: c.dateKey,
          'Trạng thái': c.status === 'checked_out' ? 'Đã checkout' : 'Đã check-in',
          'Giờ Check-in': formatTimestampTime(c.checkInAt),
          'Giờ Checkout': formatTimestampTime(c.checkOutAt),
          'Tổng việc': c.totalTasks,
          'Hoàn thành': c.completedCount,
          'Chưa hoàn thành': c.incompleteCount,
          'Chi tiết chưa hoàn thành & vướng mắc': incompleteDetails,
        });
      }
    }
  }

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = [
    { wch: 22 },
    { wch: 28 },
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 12 },
    { wch: 16 },
    { wch: 50 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'BaoCaoTienDo');
  XLSX.writeFile(workbook, `bao_cao_cong_viec_${dateLabel}.xlsx`);
}

export interface ParsedGroupTaskRow {
  rowNumber: number;
  groupCode: string;
  title: string;
  description: string;
  priority: TaskPriority;
}

export interface GroupTaskRowError {
  rowNumber: number;
  rawGroup: string;
  rawTitle: string;
  reason: string;
}

export interface GroupTaskExcelParseResult {
  valid: ParsedGroupTaskRow[];
  errors: GroupTaskRowError[];
}

function parsePriority(raw: string): TaskPriority {
  const n = normalizeHeader(raw);
  if (n === 'cao' || n === 'high' || n === '1' || n === 'urgent') return 'high';
  if (n === 'thap' || n === 'low' || n === '3') return 'low';
  return 'medium';
}

export async function parseGroupTasksExcel(file: File): Promise<GroupTaskExcelParseResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('File Excel không có sheet dữ liệu nào.');
  }
  const worksheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: '',
    blankrows: false,
  });

  if (rows.length === 0) {
    throw new Error('Sheet Excel đang trống.');
  }

  const firstRow = rows[0].map((c) => String(c ?? ''));
  const normalizedHeaders = firstRow.map(normalizeHeader);

  let groupCol = normalizedHeaders.findIndex(
    (h) => h.includes('manhom') || h === 'nhom' || h === 'group' || h === 'groupcode'
  );
  let titleCol = normalizedHeaders.findIndex(
    (h) =>
      h.includes('tencongviec') ||
      h.includes('congviec') ||
      h.includes('dauviec') ||
      h === 'title' ||
      h === 'task'
  );
  let descCol = normalizedHeaders.findIndex(
    (h) => h.includes('mota') || h.includes('ghichu') || h.includes('description')
  );
  let priorityCol = normalizedHeaders.findIndex(
    (h) => h.includes('uutien') || h.includes('douutien') || h === 'priority'
  );

  const hasHeaderRow = groupCol !== -1 || titleCol !== -1;
  if (!hasHeaderRow) {
    groupCol = 0;
    titleCol = 1;
    descCol = 2;
    priorityCol = 3;
  } else {
    if (groupCol === -1) groupCol = 0;
    if (titleCol === -1) titleCol = 1;
    if (descCol === -1) descCol = 2;
    if (priorityCol === -1) priorityCol = 3;
  }

  const startIndex = hasHeaderRow ? 1 : 0;
  const valid: ParsedGroupTaskRow[] = [];
  const errors: GroupTaskRowError[] = [];

  for (let i = startIndex; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 1;
    const rawGroup = String(row[groupCol] ?? '').trim();
    const rawTitle = String(row[titleCol] ?? '').trim();
    const rawDesc = descCol >= 0 ? String(row[descCol] ?? '').trim() : '';
    const rawPriority = priorityCol >= 0 ? String(row[priorityCol] ?? '').trim() : '';

    if (!rawGroup && !rawTitle && !rawDesc) continue;

    const groupCode = sanitizeText(rawGroup, LIMITS.MAX_GROUP_LEN);
    const title = sanitizeText(rawTitle, LIMITS.MAX_TASK_TITLE_LEN);
    const description = sanitizeText(rawDesc, LIMITS.MAX_TASK_DESC_LEN);
    const priority = parsePriority(rawPriority);

    if (!groupCode) {
      errors.push({ rowNumber, rawGroup, rawTitle, reason: 'Thiếu mã nhóm' });
      continue;
    }
    if (!title) {
      errors.push({ rowNumber, rawGroup, rawTitle, reason: 'Thiếu tên công việc' });
      continue;
    }

    valid.push({ rowNumber, groupCode, title, description, priority });
  }

  return { valid, errors };
}

export function downloadSampleTasksExcel(): void {
  const sampleRows = [
    ['Mã nhóm', 'Tên công việc', 'Mô tả', 'Độ ưu tiên'],
    ['Nhóm 01', 'Thiết kế sơ đồ cơ sở dữ liệu', 'Hoàn thiện ERD và tài liệu đặc tả bảng', 'Cao'],
    ['Nhóm 01', 'Xây dựng API đăng nhập & phân quyền', 'Kiểm thử token và xử lý lỗi 401/403', 'Cao'],
    ['Nhóm 01', 'Viết unit test module người dùng', 'Đạt tối thiểu 80% coverage', 'Trung bình'],
    ['Nhóm 02', 'Thiết kế giao diện trang chủ responsive', 'Kiểm tra trên màn hình 375px và 1440px', 'Cao'],
    ['Nhóm 02', 'Tích hợp biểu đồ thống kê tiến độ', 'Hiển thị dữ liệu theo ngày và nhóm', 'Trung bình'],
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(sampleRows);
  worksheet['!cols'] = [{ wch: 14 }, { wch: 36 }, { wch: 40 }, { wch: 14 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'ViecCanLamTheoNhom');
  XLSX.writeFile(workbook, 'mau_viec_can_lam_nhom.xlsx');
}
