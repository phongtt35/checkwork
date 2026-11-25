# Security Specification — CheckWork Firestore Rules

## 1. Data Invariants
1. **Master Identity & Verified Email**: Every read and write operation requires an authenticated user with `request.auth.token.email_verified == true`.
2. **Admin Privilege Separation**: Admin status is strictly determined by verified bootstrapped email (`phongtt35@fpt.edu.vn`), presence in `/admins/{uid}`, or presence in `/adminInvites/{safeEmailKey}`. No user can self-promote to Admin or inject an `isAdmin`/`role` field into `/students`.
3. **Student Roster Integrity**: Students cannot create, delete, or edit their own `email`, `fullName`, `groupCode`, or `active` status. Only Admins can manage the student roster. A student whose verified email matches a `students` record with `active == true` may only bind their own `uid`, `photoURL`, `lastLoginAt`, and `updatedAt` on first/subsequent login.
4. **Daily Check-in Ownership & Immutability**:
   - A `checkins/{checkinId}` document may only be created by the owning student whose `studentId` exists in `/students`, is `active == true`, and whose email matches `request.auth.token.email.lower()`.
   - `studentId`, `studentUid`, `studentEmail`, `dateKey`, and `checkInAt` are immutable after creation.
   - `status` transitions strictly from `'checked_in'` to `'checked_out'` (terminal state for students; once `'checked_out'`, students cannot modify the record, preventing retroactive tampering; only Admins can delete during reset or edit if needed).
5. **Temporal & Volumetric Integrity**: All `createdAt`, `updatedAt`, `checkInAt`, `checkOutAt` timestamps must match `request.time`. All string fields have strict `.size()` bounds; `tasks` array is bounded `1 <= size <= 30`.
6. **PII Isolation**: `/students` and `/checkins` contain student emails/names. `get` and `list` are strictly restricted to `isAdmin()` or the owning student (`resource.data.studentUid == request.auth.uid` / `resource.data.email == request.auth.token.email.lower()`).

## 2. The "Dirty Dozen" Malicious Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated Student Read**: Anonymous client attempts `getDocs(collection(db, 'students'))` -> DENIED.
2. **Unverified Email Spoof**: Signed-in user with `email_verified: false` and `email: 'phongtt35@fpt.edu.vn'` attempts Admin read -> DENIED.
3. **Blanket Student List Scrape**: Authenticated student queries `collection(db, 'students')` without filtering to their own email/uid -> DENIED.
4. **Cross-Student Check-in Read**: Student A attempts `getDoc(doc(db, 'checkins', 'studentB_2026-11-24'))` -> DENIED.
5. **Identity Spoofing on Check-in Create**: Student A creates a checkin with `studentUid: 'studentB_uid'` or `studentEmail: 'studentB@fpt.edu.vn'` -> DENIED.
6. **Unauthorized Whitelist Self-Add**: Non-admin user attempts `setDoc(doc(db, 'students', 'new_id'), ...)` -> DENIED.
7. **Group / Name Tampering by Student**: Student updates their own `students` doc changing `groupCode` or `active` -> DENIED.
8. **Shadow Ghost Field Injection**: Student creates a checkin with an undeclared field `isApproved: true` -> DENIED (`hasOnly` check).
9. **Terminal State Re-open**: Student attempts to update a `checkins` doc whose existing `status == 'checked_out'` back to `'checked_in'` or change tasks -> DENIED.
10. **Client Timestamp Forgery**: Student creates a checkin with a backdated `checkInAt: Timestamp(2020-01-01)` instead of `serverTimestamp()` (`request.time`) -> DENIED.
11. **Resource Exhaustion / ID Poisoning**: User attempts `setDoc(doc(db, 'checkins', 'x'.repeat(300)), ...)` or `tasks` with 100 items -> DENIED.
12. **Privilege Escalation on Admin Collections**: Student attempts `setDoc(doc(db, 'admins', myUid), { role: 'admin' })` or `deleteDoc(doc(db, 'systemConfig', 'main'))` -> DENIED.
