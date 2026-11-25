import type { Timestamp } from 'firebase/firestore';

export type TaskStatus = 'pending' | 'completed' | 'incomplete';
export type CheckinStatus = 'checked_in' | 'checked_out';
export type TaskPriority = 'high' | 'medium' | 'low';
export type GroupTaskStatus = 'open' | 'claimed' | 'completed';

export interface CheckinTask {
  id: string;
  title: string;
  status: TaskStatus;
  reason: string;
  blocker: string;
  groupTaskId?: string | null;
}

export interface GroupTask {
  id: string;
  groupCode: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: GroupTaskStatus;
  assignedToStudentId?: string | null;
  assignedToUid?: string | null;
  assignedToName?: string | null;
  claimedAt?: Timestamp | null;
  completedAt?: Timestamp | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface Student {
  id: string;
  email: string;
  fullName: string;
  groupCode: string;
  uid: string | null;
  photoURL: string | null;
  active: boolean;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  lastLoginAt: Timestamp | null;
}

export interface DailyCheckin {
  id: string;
  studentId: string;
  studentUid: string;
  studentEmail: string;
  studentName: string;
  groupCode: string;
  dateKey: string; // YYYY-MM-DD
  status: CheckinStatus;
  tasks: CheckinTask[];
  totalTasks: number;
  completedCount: number;
  incompleteCount: number;
  dailyNote?: string;
  checkInAt: Timestamp | null;
  checkOutAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface AdminInvite {
  id: string;
  email: string;
  addedBy: string;
  createdAt: Timestamp | null;
}

export interface SystemConfig {
  organizationName: string;
  academicTerm: string;
  totalResets: number;
  lastResetAt: Timestamp | null;
  allowCustomStudentTasks?: boolean;
  updatedAt: Timestamp | null;
}

export interface AdminSettings {
  primaryAdminEmail: string;
  updatedAt: Timestamp | null;
}

export interface AuditLog {
  id: string;
  action: 'import_students' | 'import_tasks' | 'reset_checkins' | 'update_config';
  actorUid: string;
  actorEmail: string;
  details: string;
  createdAt: Timestamp | null;
}

export type AuthRole = 'loading' | 'unauthenticated' | 'admin' | 'student' | 'unauthorized' | 'inactive';
