import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { assertCanManageCourse, getCourseOrThrow } from '../courses/courses.service.js';

export function enrollStudent(db, user, courseId, studentId) {
  const course = getCourseOrThrow(db, courseId);
  assertCanManageCourse(user, course);

  // Role comes from the database row, never from anything the client sent.
  const student = db.prepare('SELECT id, role FROM users WHERE id = ?').get(studentId);
  if (!student) throw new NotFoundError('Student not found');
  if (student.role !== 'student') throw new ValidationError('User is not a student');

  const exists = db
    .prepare('SELECT 1 FROM enrollments WHERE course_id = ? AND student_id = ?')
    .get(courseId, studentId);
  if (exists) throw new ConflictError('ALREADY_ENROLLED', 'Student is already enrolled in this course');

  try {
    db.prepare('INSERT INTO enrollments (course_id, student_id) VALUES (?, ?)').run(courseId, studentId);
  } catch (err) {
    // Backstop for a concurrent duplicate (composite PK) or a row deleted mid-request (FK).
    if (err?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new ConflictError('ALREADY_ENROLLED', 'Student is already enrolled in this course');
    }
    if (err?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') throw new NotFoundError('Course or student not found');
    throw err;
  }
  return db
    .prepare('SELECT course_id, student_id, enrolled_at FROM enrollments WHERE course_id = ? AND student_id = ?')
    .get(courseId, studentId);
}

export function listEnrollments(db, user, courseId) {
  const course = getCourseOrThrow(db, courseId);
  assertCanManageCourse(user, course);
  // Explicit column list: nothing from users beyond what a roster needs (no password_hash).
  return db
    .prepare(
      `SELECT e.student_id, u.full_name, u.email, e.enrolled_at
         FROM enrollments e
         JOIN users u ON u.id = e.student_id
        WHERE e.course_id = ?
        ORDER BY u.full_name, e.student_id`,
    )
    .all(courseId);
}

export function removeEnrollment(db, user, courseId, studentId) {
  const course = getCourseOrThrow(db, courseId);
  assertCanManageCourse(user, course);
  const result = db
    .prepare('DELETE FROM enrollments WHERE course_id = ? AND student_id = ?')
    .run(courseId, studentId);
  if (result.changes === 0) throw new NotFoundError('Enrollment not found');
  return { course_id: courseId, student_id: studentId };
}

export function searchStudents(db, user, courseId, query) {
  assertCanManageCourse(user, getCourseOrThrow(db, courseId));
  const term = query.trim();
  if ([...term].length < 3) throw new ValidationError('Enter at least 3 characters to search for students');

  return db
    .prepare(
      `SELECT u.id AS student_id, u.full_name, u.email,
              EXISTS (
                SELECT 1 FROM enrollments e WHERE e.course_id = ? AND e.student_id = u.id
              ) AS already_enrolled
         FROM users u
        WHERE u.role = 'student'
          AND (instr(lower(u.full_name), lower(?)) > 0 OR instr(lower(u.email), lower(?)) > 0)
        ORDER BY u.full_name COLLATE NOCASE, u.id
        LIMIT 20`,
    )
    .all(courseId, term, term)
    .map((row) => ({ ...row, already_enrolled: Boolean(row.already_enrolled) }));
}
