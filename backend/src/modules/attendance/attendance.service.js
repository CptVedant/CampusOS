import { randomInt, timingSafeEqual } from 'node:crypto';
import { newId } from '../../utils/ids.js';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { assertCanManageCourse, getCourseOrThrow } from '../courses/courses.service.js';

/*
 * Attendance engine. Design notes:
 *  - Student identity is always the verified JWT subject, never a request field.
 *  - A punch is validated and inserted inside one IMMEDIATE transaction (no awaits inside),
 *    so a concurrent "stop" or a duplicate punch cannot slip between check and insert.
 *  - The UNIQUE(session_id, student_id) and UNIQUE(session_id, device_fingerprint) constraints
 *    remain the final safeguard; their violations are mapped to clean 409s.
 *  - Manual overrides (the schema has no status column) are modelled as staff-created or
 *    staff-deleted attendance records. A manual record carries a synthetic fingerprint
 *    'manual:<uuid>', which can never equal a real (UUID-format) device fingerprint.
 */

const MANUAL_PREFIX = 'manual:';

export const formatOtp = (n) => String(n).padStart(6, '0');
export const generateOtp = () => formatOtp(randomInt(0, 1_000_000)); // CSPRNG, keeps leading zeros

function otpMatches(stored, submitted) {
  const a = Buffer.from(stored);
  const b = Buffer.from(submitted);
  return a.length === b.length && timingSafeEqual(a, b);
}

const toSession = (row, { withOtp = true } = {}) => {
  const session = {
    id: row.id,
    course_id: row.course_id,
    is_active: row.is_active === 1,
    started_at: row.started_at,
    ended_at: row.ended_at,
  };
  if (withOtp) session.otp_code = row.otp_code;
  return session;
};

const SESSION_BY_ID = 'SELECT id, course_id, otp_code, is_active, started_at, ended_at FROM attendance_sessions WHERE id = ?';

// Loads a session and checks the caller may manage its course (owner teacher or admin).
function getManageableSession(db, user, sessionId) {
  const row = db
    .prepare(
      `SELECT s.id, s.course_id, s.otp_code, s.is_active, s.started_at, s.ended_at, c.teacher_id
         FROM attendance_sessions s
         JOIN courses c ON c.id = s.course_id
        WHERE s.id = ?`,
    )
    .get(sessionId);
  if (!row) throw new NotFoundError('Attendance session not found');
  assertCanManageCourse(user, { teacher_id: row.teacher_id });
  return row;
}

const isEnrolled = (db, courseId, studentId) =>
  Boolean(db.prepare('SELECT 1 FROM enrollments WHERE course_id = ? AND student_id = ?').get(courseId, studentId));

// Maps a SQLite uniqueness failure on attendance_records to the matching 409.
export function translatePunchConstraintError(err) {
  const unique = err?.code === 'SQLITE_CONSTRAINT_UNIQUE' || err?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY';
  if (!unique) return err;
  const message = String(err.message);
  if (message.includes('device_fingerprint')) {
    return new ConflictError('DEVICE_ALREADY_USED', 'This device has already been used to record attendance in this session');
  }
  if (message.includes('student_id')) {
    return new ConflictError('ALREADY_PUNCHED', 'Attendance has already been recorded for this session');
  }
  return new ConflictError('CONFLICT', 'Conflicting attendance record');
}

// ───────────── Session lifecycle (staff) ─────────────

export function startSession(db, user, courseId) {
  const course = getCourseOrThrow(db, courseId);
  assertCanManageCourse(user, course);

  const create = db.transaction(() => {
    // One live code per course. Enforced here (not in the schema) inside the write transaction.
    const active = db.prepare('SELECT 1 FROM attendance_sessions WHERE course_id = ? AND is_active = 1').get(courseId);
    if (active) throw new ConflictError('SESSION_ALREADY_ACTIVE', 'This course already has an active attendance session');
    const id = newId();
    db.prepare('INSERT INTO attendance_sessions (id, course_id, otp_code) VALUES (?, ?, ?)')
      .run(id, courseId, generateOtp());
    return db.prepare(SESSION_BY_ID).get(id);
  });
  return toSession(create.immediate());
}

// Idempotent: stopping an already-closed session returns it unchanged (ended_at is not overwritten).
export function stopSession(db, user, sessionId) {
  const session = getManageableSession(db, user, sessionId);
  if (session.is_active === 1) {
    db.prepare(
      `UPDATE attendance_sessions
          SET is_active = 0, ended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ? AND is_active = 1`,
    ).run(sessionId);
  }

return toSession(db.prepare(SESSION_BY_ID).get(sessionId), {
  withOtp: false,
});

}

// ───────────── Punch (student) ─────────────

/*
 * Check order matters for information disclosure: enrollment is verified before the session's
 * state or code is, so a student outside the course learns nothing about either.
 */
export function punchAttendance(db, user, { session_id, otp, device_fingerprint }) {
  const fingerprint = device_fingerprint.toLowerCase(); // case variants must not bypass the UNIQUE constraint

  const punch = db.transaction(() => {
    const session = db.prepare(SESSION_BY_ID).get(session_id);
    if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', 'Attendance session not found');
    if (!isEnrolled(db, session.course_id, user.sub)) {
      throw new AppError(403, 'NOT_ENROLLED', 'You are not enrolled in this course');
    }
    if (session.is_active !== 1) throw new AppError(400, 'SESSION_CLOSED', 'Attendance session is closed');
    if (!otpMatches(session.otp_code, otp)) throw new AppError(400, 'INVALID_OTP', 'Invalid OTP');

    const sameStudent = db
      .prepare('SELECT 1 FROM attendance_records WHERE session_id = ? AND student_id = ?')
      .get(session_id, user.sub);
    if (sameStudent) throw new ConflictError('ALREADY_PUNCHED', 'Attendance has already been recorded for this session');

    const sameDevice = db
      .prepare('SELECT 1 FROM attendance_records WHERE session_id = ? AND device_fingerprint = ?')
      .get(session_id, fingerprint);
    if (sameDevice) {
      throw new ConflictError('DEVICE_ALREADY_USED', 'This device has already been used to record attendance in this session');
    }

    try {
      db.prepare('INSERT INTO attendance_records (id, session_id, student_id, device_fingerprint) VALUES (?, ?, ?, ?)')
        .run(newId(), session_id, user.sub, fingerprint);
    } catch (err) {
      throw translatePunchConstraintError(err); // backstop for writers that bypass the checks above
    }
    const row = db
      .prepare('SELECT punched_at FROM attendance_records WHERE session_id = ? AND student_id = ?')
      .get(session_id, user.sub);
    return { session_id, course_id: session.course_id, punched_at: row.punched_at };
  });
  return punch.immediate();
}

// Active sessions in the student's enrolled courses. Never includes the OTP.
export function listActiveSessionsForStudent(db, studentId) {
  return db
    .prepare(
      `SELECT s.id AS session_id, s.course_id, c.course_code, c.title, s.started_at,
              EXISTS (SELECT 1 FROM attendance_records r
                       WHERE r.session_id = s.id AND r.student_id = ?) AS already_punched
         FROM attendance_sessions s
         JOIN courses c ON c.id = s.course_id
         JOIN enrollments e ON e.course_id = s.course_id AND e.student_id = ?
        WHERE s.is_active = 1
        ORDER BY s.started_at DESC, s.id`,
    )
    .all(studentId, studentId)
    .map((row) => ({ ...row, already_punched: row.already_punched === 1 }));
}

// ───────────── History and metrics (student, own data only) ─────────────

/*
 * Percentage = sessions_attended / total_sessions * 100, rounded to 2 decimals.
 * total_sessions counts, per enrolled course, every CLOSED session plus any still-active
 * session the student has already punched, so a session in progress does not count against
 * anyone yet. total_sessions = 0 gives 0 (no division by zero). Sessions are counted from the
 * start of the course's history, regardless of when the student enrolled (the schema offers no
 * finer rule).
 */
export function getStudentHistory(db, studentId, courseId = null) {
  const courses = db
    .prepare(
      `SELECT c.id AS course_id, c.course_code, c.title,
              (SELECT COUNT(*) FROM attendance_sessions s
                WHERE s.course_id = c.id
                  AND (s.is_active = 0
                       OR EXISTS (SELECT 1 FROM attendance_records r
                                   WHERE r.session_id = s.id AND r.student_id = ?))) AS total_sessions,
              (SELECT COUNT(*) FROM attendance_records r
                 JOIN attendance_sessions s ON s.id = r.session_id
                WHERE s.course_id = c.id AND r.student_id = ?) AS sessions_attended
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
        WHERE e.student_id = ? AND (? IS NULL OR c.id = ?)
        ORDER BY c.course_code`,
    )
    .all(studentId, studentId, studentId, courseId, courseId)
    .map((row) => ({
      ...row,
      attendance_percentage:
        row.total_sessions === 0 ? 0 : Math.round((row.sessions_attended / row.total_sessions) * 10000) / 100,
    }));

  const records = db
    .prepare(
      `SELECT r.session_id, s.course_id, c.course_code, s.started_at AS session_started_at, r.punched_at
         FROM attendance_records r
         JOIN attendance_sessions s ON s.id = r.session_id
         JOIN courses c ON c.id = s.course_id
        WHERE r.student_id = ? AND (? IS NULL OR s.course_id = ?)
        ORDER BY r.punched_at DESC, r.session_id`,
    )
    .all(studentId, courseId, courseId);

  return { courses, records };
}

// ───────────── Staff queries ─────────────

export function listSessions(db, user, courseId) {
  const course = getCourseOrThrow(db, courseId);
  assertCanManageCourse(user, course);
  return db
    .prepare(
      `SELECT s.id, s.course_id, s.is_active, s.started_at, s.ended_at,
              (SELECT COUNT(*) FROM attendance_records r WHERE r.session_id = s.id) AS attendance_count
         FROM attendance_sessions s
        WHERE s.course_id = ?
        ORDER BY s.started_at DESC, s.id`,
    )
    .all(courseId)
    .map((row) => ({ ...row, is_active: row.is_active === 1 }));
}

export function getSessionDetail(db, user, sessionId) {
  const session = getManageableSession(db, user, sessionId);
  const present = db
    .prepare(
      `SELECT u.id AS student_id, u.full_name, u.email, r.punched_at,
              (substr(r.device_fingerprint, 1, 7) = 'manual:') AS manual
         FROM attendance_records r
         JOIN users u ON u.id = r.student_id
        WHERE r.session_id = ?
        ORDER BY u.full_name, u.id`,
    )
    .all(sessionId)
    .map((row) => ({ ...row, manual: row.manual === 1 })); // fingerprints are not exposed
  const absent = db
    .prepare(
      `SELECT u.id AS student_id, u.full_name, u.email
         FROM enrollments e
         JOIN users u ON u.id = e.student_id
        WHERE e.course_id = ?
          AND NOT EXISTS (SELECT 1 FROM attendance_records r
                           WHERE r.session_id = ? AND r.student_id = e.student_id)
        ORDER BY u.full_name, u.id`,
    )
    .all(session.course_id, sessionId);

  // The code is only meaningful while the session is open.
  return { session: toSession(session, { withOtp: session.is_active === 1 }), present, absent };
}

// ───────────── Manual overrides (staff) ─────────────

export function markPresent(db, user, sessionId, studentId) {
  const run = db.transaction(() => {
    const session = getManageableSession(db, user, sessionId); // allowed on closed sessions too (late corrections)
    const student = db.prepare('SELECT id, role FROM users WHERE id = ?').get(studentId);
    if (!student) throw new NotFoundError('Student not found');
    if (student.role !== 'student') throw new ValidationError('User is not a student');
    if (!isEnrolled(db, session.course_id, studentId)) {
      throw new AppError(400, 'STUDENT_NOT_ENROLLED', 'Student is not enrolled in this course');
    }
    const exists = db
      .prepare('SELECT 1 FROM attendance_records WHERE session_id = ? AND student_id = ?')
      .get(sessionId, studentId);
    if (exists) throw new ConflictError('ALREADY_PUNCHED', 'Attendance has already been recorded for this session');

    try {
      db.prepare('INSERT INTO attendance_records (id, session_id, student_id, device_fingerprint) VALUES (?, ?, ?, ?)')
        .run(newId(), sessionId, studentId, `${MANUAL_PREFIX}${newId()}`);
    } catch (err) {
      throw translatePunchConstraintError(err);
    }
    const row = db
      .prepare('SELECT punched_at FROM attendance_records WHERE session_id = ? AND student_id = ?')
      .get(sessionId, studentId);
    return { session_id: sessionId, student_id: studentId, punched_at: row.punched_at, manual: true };
  });
  return run.immediate();
}

export function removeRecord(db, user, sessionId, studentId) {
  getManageableSession(db, user, sessionId);
  const result = db
    .prepare('DELETE FROM attendance_records WHERE session_id = ? AND student_id = ?')
    .run(sessionId, studentId);
  if (result.changes === 0) throw new NotFoundError('Attendance record not found');
  return { session_id: sessionId, student_id: studentId };
}
