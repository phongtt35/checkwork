import type { Timestamp } from 'firebase/firestore';

// Volumetric bounds synchronized with firebase-blueprint.json & firestore.rules
export const LIMITS = {
  MAX_EMAIL_LEN: 150,
  MAX_NAME_LEN: 120,
  MAX_GROUP_LEN: 40,
  MAX_TASKS: 30,
  MAX_TASK_TITLE_LEN: 300,
  MAX_TASK_DESC_LEN: 500,
  MAX_REASON_LEN: 500,
  MAX_BLOCKER_LEN: 500,
  MAX_NOTE_LEN: 1000,
  MAX_PHOTO_LEN: 500,
  MAX_ORG_NAME_LEN: 120,
  MAX_TERM_LEN: 60,
  MAX_AUDIT_LEN: 400,
} as const;

export const BOOTSTRAPPED_ADMIN_EMAIL = 'phongtt35@fpt.edu.vn';

export const EMAIL_REGEX = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  return (
    normalized.length >= 5 &&
    normalized.length <= LIMITS.MAX_EMAIL_LEN &&
    EMAIL_REGEX.test(normalized)
  );
}

export function sanitizeText(value: string, maxLen: number): string {
  return value.trim().slice(0, maxLen);
}

export function emailToSafeKey(email: string): string {
  return normalizeEmail(email)
    .replace(/@/g, '_at_')
    .replace(/\./g, '_dot_')
    .replace(/\+/g, '_plus_');
}

export async function emailToStudentId(email: string): Promise<string> {
  const normalized = normalizeEmail(email);
  const data = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `stu_${hex.slice(0, 32)}`;
}

export function getTodayDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getOffsetDateKey(daysOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return getTodayDateKey(d);
}

export function formatDateKeyVN(dateKey: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey;
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const days = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
  const dayName = days[date.getDay()];
  return `${dayName}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

export function formatShortDateVN(dateKey: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey;
  const [, m, d] = dateKey.split('-');
  return `${d}/${m}`;
}

export function formatTimestampTime(ts: Timestamp | null | undefined): string {
  if (!ts || typeof ts.toDate !== 'function') return '—';
  const d = ts.toDate();
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatTimestampFull(ts: Timestamp | null | undefined): string {
  if (!ts || typeof ts.toDate !== 'function') return '—';
  const d = ts.toDate();
  const datePart = d.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const timePart = d.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${datePart} ${timePart}`;
}

export function generateTaskId(): string {
  return `tsk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function generateGroupTaskId(): string {
  return `gt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
