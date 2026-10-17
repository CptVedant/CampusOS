import { newId } from '../../utils/ids.js';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../utils/errors.js';

/*
 * Access model (the SRS only says teachers/admins manage courses, so this is the smallest
 * reasonable reading):
 *   admin   - manages every course
 *   teacher - manages only courses where courses.teacher_id is their own id
 *   student - may view only courses they are enrolled in; never manages
 * Course not found -> 404. Course exists but caller is not allowed -> 403.
 */

export function findCourse(db, id) {
  return db.prepare('SELECT id, course_code, title, teacher_id FROM courses WHERE id = ?').get(id);
}

export function getCourseOrThrow(db, id) {
  const course = findCourse(db, id);
  if (!course) throw new NotFoundError('Course not found');
  return course;
}

export function canManageCourse(user, course) {
  return user.role === 'admin' || (user.role === 'teacher' && course.teacher_id === user.sub);
}

export function assertCanManageCourse(user, course) {
  if (!canManageCourse(user, course)) throw new AuthorizationError('You are not allowed to manage this course');
}

function canViewCourse(db, user, course) {
  if (canManageCourse(user, course)) return true;
  if (user.role !== 'student') return false;
  return Boolean(
    db.prepare('SELECT 1 FROM enrollments WHERE course_id = ? AND student_id = ?').get(course.id, user.sub),
  );
}

function assertIsTeacher(db, teacherId) {
  const row = db.prepare('SELECT role FROM users WHERE id = ?').get(teacherId);
  // Same message whether the user is missing or has another role.
  if (!row || row.role !== 'teacher') throw new ValidationError('teacher_id must reference an existing teacher');
}

// Maps SQLite constraint failures (second line of defence) to clean client errors.
function translateConstraintError(err) {
  if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') return new ConflictError('COURSE_CODE_EXISTS', 'Course code already exists');
  if (err?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return new ValidationError('teacher_id must reference an existing teacher');
  return err;
}

function assertCodeAvailable(db, courseCode, exceptCourseId = '') {
  const taken = db
    .prepare('SELECT 1 FROM courses WHERE course_code = ? AND id <> ?')
    .get(courseCode, exceptCourseId);
  if (taken) throw new ConflictError('COURSE_CODE_EXISTS', 'Course code already exists');
}

export function listCourses(db, user) {
  if (user.role === 'admin') {
    return db.prepare('SELECT id, course_code, title, teacher_id FROM courses ORDER BY course_code').all();
  }
  if (user.role === 'teacher') {
    return db
      .prepare('SELECT id, course_code, title, teacher_id FROM courses WHERE teacher_id = ? ORDER BY course_code')
      .all(user.sub);
  }
  return listEnrolledCourses(db, user.sub);
}

export function listEnrolledCourses(db, studentId) {
  return db
    .prepare(
      `SELECT c.id, c.course_code, c.title, c.teacher_id
         FROM courses c
         JOIN enrollments e ON e.course_id = c.id
        WHERE e.student_id = ?
        ORDER BY c.course_code`,
    )
    .all(studentId);
}

export function getCourse(db, user, courseId) {
  const course = getCourseOrThrow(db, courseId);
  if (!canViewCourse(db, user, course)) throw new AuthorizationError('You are not allowed to view this course');
  return course;
}

export function createCourse(db, user, { course_code, title, teacher_id }) {
  let teacherId = teacher_id;
  if (user.role === 'teacher') {
    if (teacherId !== undefined && teacherId !== user.sub) {
      throw new AuthorizationError('Teachers can only create courses for themselves');
    }
    teacherId = user.sub;
  } else if (teacherId === undefined) {
    throw new ValidationError('teacher_id is required');
  }
  assertIsTeacher(db, teacherId);

  const course = { id: newId(), course_code: course_code.trim(), title: title.trim(), teacher_id: teacherId };
  assertCodeAvailable(db, course.course_code);
  try {
    db.prepare('INSERT INTO courses (id, course_code, title, teacher_id) VALUES (?, ?, ?, ?)')
      .run(course.id, course.course_code, course.title, course.teacher_id);
  } catch (err) {
    throw translateConstraintError(err);
  }
  return course;
}

export function updateCourse(db, user, courseId, { course_code, title, teacher_id }) {
  const course = getCourseOrThrow(db, courseId);
  assertCanManageCourse(user, course);

  let teacherId = course.teacher_id;
  if (teacher_id !== undefined && teacher_id !== course.teacher_id) {
    if (user.role !== 'admin') throw new AuthorizationError('Only an admin can reassign a course to another teacher');
    assertIsTeacher(db, teacher_id);
    teacherId = teacher_id;
  }

  const updated = { id: course.id, course_code: course_code.trim(), title: title.trim(), teacher_id: teacherId };
  assertCodeAvailable(db, updated.course_code, course.id);
  try {
    db.prepare('UPDATE courses SET course_code = ?, title = ?, teacher_id = ? WHERE id = ?')
      .run(updated.course_code, updated.title, updated.teacher_id, updated.id);
  } catch (err) {
    throw translateConstraintError(err);
  }
  return updated;
}

/*
 * Deletion policy. The schema cascades from courses to enrollments, attendance_sessions,
 * documents and assessments. Enrollments are pure links, so deleting them with the course is
 * safe. The other tables hold records of real activity (and documents also own files on disk
 * that a row cascade would orphan), so a course that has any of them is refused with 409.
 */
export function deleteCourse(db, user, courseId) {
  const course = getCourseOrThrow(db, courseId);
  assertCanManageCourse(user, course);

  const remove = db.transaction(() => {
    const { n } = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM attendance_sessions WHERE course_id = ?)
              + (SELECT COUNT(*) FROM documents WHERE course_id = ?)
              + (SELECT COUNT(*) FROM assessments WHERE course_id = ?) AS n`,
      )
      .get(courseId, courseId, courseId);
    if (n > 0) {
      throw new ConflictError(
        'COURSE_HAS_DEPENDENTS',
        'Course has attendance, document or assessment records and cannot be deleted',
      );
    }
    db.prepare('DELETE FROM courses WHERE id = ?').run(courseId); // enrollments cascade
  });
  remove.immediate();
  return { id: course.id };
}
