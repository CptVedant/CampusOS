import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/database/db.js';
import { runMigrations } from '../src/database/migrate.js';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/modules/auth/auth.service.js';
import { newId } from '../src/utils/ids.js';

const TEST_CONFIG = {
  nodeEnv: 'test',
  isProduction: false,
  logLevel: 'silent',
  jwtSecret: 'phase3-test-secret-not-for-production-0123456789',
  jwtExpiresIn: '1h',
};

const ROLE_OF = {
  admin: 'admin',
  teacherA: 'teacher',
  teacherB: 'teacher',
  student1: 'student',
  student2: 'student',
  student3: 'student',
};

let dir, db, app, passwordHash;
const people = {};
const tokens = {};

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-p3-'));
  db = openDatabase(path.join(dir, 'test.sqlite'));
  runMigrations(db);
  passwordHash = await hashPassword('Phase3#TestPassword'); // one real bcrypt hash shared by test users

  const insert = db.prepare('INSERT INTO users (id, full_name, email, password_hash, role) VALUES (?,?,?,?,?)');
  for (const [key, role] of Object.entries(ROLE_OF)) {
    const id = newId();
    people[key] = { id, role, email: `${key}@example.test`, full_name: `Test ${key}` };
    insert.run(id, people[key].full_name, people[key].email, passwordHash, role);
  }

  app = buildApp({ config: TEST_CONFIG, db });
  await app.ready();
  for (const [key, p] of Object.entries(people)) tokens[key] = app.jwt.sign({ sub: p.id, role: p.role });
});

after(async () => {
  await app.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ───────────── helpers ─────────────
const call = (method, url, who, payload) =>
  app.inject({ method, url, headers: who ? { authorization: `Bearer ${tokens[who]}` } : {}, payload });

let seq = 0;
function makeCourse(teacherKey, code = `AUTO${++seq}-${newId().slice(0, 6)}`) {
  const id = newId();
  db.prepare('INSERT INTO courses (id, course_code, title, teacher_id) VALUES (?,?,?,?)')
    .run(id, code, `Title ${code}`, people[teacherKey].id);
  return id;
}
const enrollDirect = (courseId, studentKey) =>
  db.prepare('INSERT INTO enrollments (course_id, student_id) VALUES (?,?)').run(courseId, people[studentKey].id);
const isEnrolled = (courseId, studentKey) =>
  Boolean(db.prepare('SELECT 1 FROM enrollments WHERE course_id = ? AND student_id = ?').get(courseId, people[studentKey].id));
const courseCount = () => db.prepare('SELECT COUNT(*) FROM courses').pluck().get();
const courseRow = (id) => db.prepare('SELECT id, course_code, title, teacher_id FROM courses WHERE id = ?').get(id);
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

// ───────────── Course tests ─────────────

test('COURSE-01: authenticated teacher can create a course (owned by self)', async () => {
  const res = await call('POST', '/api/courses', 'teacherA', { course_code: 'CS101', title: 'Intro to CS' });
  assert.equal(res.statusCode, 201);
  const course = res.json().data;
  assert.deepEqual(Object.keys(course).sort(), ['course_code', 'id', 'teacher_id', 'title']);
  assert.equal(course.teacher_id, people.teacherA.id);
  assert.deepEqual(courseRow(course.id), course);

  // Explicitly naming themselves is allowed; trimming is applied.
  const res2 = await call('POST', '/api/courses', 'teacherA', {
    course_code: '  CS102  ', title: ' Data Structures ', teacher_id: people.teacherA.id,
  });
  assert.equal(res2.statusCode, 201);
  assert.equal(res2.json().data.course_code, 'CS102');
  assert.equal(res2.json().data.title, 'Data Structures');
});

test('COURSE-02: admin can create a course for a teacher, and manage it', async () => {
  const res = await call('POST', '/api/courses', 'admin', {
    course_code: 'MA201', title: 'Linear Algebra', teacher_id: people.teacherB.id,
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().data.teacher_id, people.teacherB.id);

  const id = res.json().data.id;
  assert.equal((await call('PUT', `/api/courses/${id}`, 'admin', { course_code: 'MA201', title: 'Linear Algebra II' })).statusCode, 200);
  assert.equal((await call('DELETE', `/api/courses/${id}`, 'admin')).statusCode, 200);
});

test('COURSE-03: student cannot create a course', async () => {
  const before = courseCount();
  const res = await call('POST', '/api/courses', 'student1', {
    course_code: 'HACK1', title: 'Nope', teacher_id: people.teacherA.id,
  });
  assert.equal(res.statusCode, 403);
  assert.equal(courseCount(), before);
});

test('COURSE-04: unauthenticated request cannot create a course', async () => {
  const before = courseCount();
  const res = await call('POST', '/api/courses', null, { course_code: 'HACK2', title: 'Nope' });
  assert.equal(res.statusCode, 401);
  assert.equal(courseCount(), before);
});

test('COURSE-05: creation rejects invalid or missing data', async () => {
  const before = courseCount();
  const bad = [
    ['missing course_code', 'teacherA', { title: 'T' }],
    ['missing title', 'teacherA', { course_code: 'X1' }],
    ['empty title', 'teacherA', { course_code: 'X2', title: '' }],
    ['blank course_code', 'teacherA', { course_code: '   ', title: 'T' }],
    ['over-long course_code', 'teacherA', { course_code: 'C'.repeat(33), title: 'T' }],
    ['malformed teacher_id', 'admin', { course_code: 'X3', title: 'T', teacher_id: 'not-a-uuid' }],
    ['admin without teacher_id', 'admin', { course_code: 'X4', title: 'T' }],
    ['teacher_id is a student', 'admin', { course_code: 'X5', title: 'T', teacher_id: people.student1.id }],
    ['teacher_id is an admin', 'admin', { course_code: 'X6', title: 'T', teacher_id: people.admin.id }],
    ['teacher_id does not exist', 'admin', { course_code: 'X7', title: 'T', teacher_id: MISSING_ID }],
    ['no body', 'teacherA', undefined],
  ];
  for (const [label, who, payload] of bad) {
    const res = await call('POST', '/api/courses', who, payload);
    assert.equal(res.statusCode, 400, `${label} should be 400, got ${res.statusCode}`);
    assert.equal(res.json().success, false);
  }
  assert.equal(courseCount(), before, 'no course may be created by invalid requests');

  // Duplicate course_code is a conflict, not a 500.
  await call('POST', '/api/courses', 'teacherA', { course_code: 'DUP100', title: 'First' });
  const dup = await call('POST', '/api/courses', 'teacherB', { course_code: 'DUP100', title: 'Second' });
  assert.equal(dup.statusCode, 409);
  assert.equal(dup.json().error.code, 'COURSE_CODE_EXISTS');

  // A teacher cannot create a course on behalf of another teacher.
  const other = await call('POST', '/api/courses', 'teacherA', {
    course_code: 'X8', title: 'T', teacher_id: people.teacherB.id,
  });
  assert.equal(other.statusCode, 403);
});

test('COURSE-06: existing course can be retrieved by authorized users; lists respect role', async () => {
  const mine = makeCourse('teacherA');
  const theirs = makeCourse('teacherB');
  enrollDirect(mine, 'student1');

  for (const who of ['teacherA', 'admin', 'student1']) {
    const res = await call('GET', `/api/courses/${mine}`, who);
    assert.equal(res.statusCode, 200, `${who} should view the course`);
    assert.deepEqual(Object.keys(res.json().data).sort(), ['course_code', 'id', 'teacher_id', 'title']);
    assert.equal(res.json().data.id, mine);
  }
  // Not permitted to view: other teacher, un-enrolled student.
  assert.equal((await call('GET', `/api/courses/${mine}`, 'teacherB')).statusCode, 403);
  assert.equal((await call('GET', `/api/courses/${mine}`, 'student2')).statusCode, 403);
  assert.equal((await call('GET', `/api/courses/${mine}`, null)).statusCode, 401);

  const ids = async (who) => (await call('GET', '/api/courses', who)).json().data.map((c) => c.id);
  const adminIds = await ids('admin');
  assert.ok(adminIds.includes(mine) && adminIds.includes(theirs));
  const teacherAIds = await ids('teacherA');
  assert.ok(teacherAIds.includes(mine) && !teacherAIds.includes(theirs));
  assert.deepEqual(await ids('student1'), [mine]);
  assert.deepEqual(await ids('student2'), []);
  assert.equal((await call('GET', '/api/courses', null)).statusCode, 401);
});

test('COURSE-07: a user cannot modify or delete another teacher\'s course', async () => {
  const id = makeCourse('teacherA', 'OWN-A');
  const original = courseRow(id);

  const put = await call('PUT', `/api/courses/${id}`, 'teacherB', { course_code: 'STOLEN', title: 'Hijacked' });
  assert.equal(put.statusCode, 403);
  assert.equal((await call('DELETE', `/api/courses/${id}`, 'teacherB')).statusCode, 403);
  assert.equal((await call('PUT', `/api/courses/${id}`, 'student1', { course_code: 'S', title: 'S' })).statusCode, 403);
  assert.deepEqual(courseRow(id), original, 'course must be unchanged');

  // The owner cannot hand the course to another teacher; only an admin can.
  const reassignByOwner = await call('PUT', `/api/courses/${id}`, 'teacherA', {
    course_code: 'OWN-A', title: original.title, teacher_id: people.teacherB.id,
  });
  assert.equal(reassignByOwner.statusCode, 403);
  const reassignByAdmin = await call('PUT', `/api/courses/${id}`, 'admin', {
    course_code: 'OWN-A', title: original.title, teacher_id: people.teacherB.id,
  });
  assert.equal(reassignByAdmin.statusCode, 200);
  assert.equal(courseRow(id).teacher_id, people.teacherB.id);
});

test('COURSE-08: nonexistent course returns 404 (malformed id returns 400)', async () => {
  for (const who of ['admin', 'teacherA', 'student1']) {
    assert.equal((await call('GET', `/api/courses/${MISSING_ID}`, who)).statusCode, 404);
  }
  assert.equal((await call('PUT', `/api/courses/${MISSING_ID}`, 'admin', { course_code: 'Z', title: 'Z' })).statusCode, 404);
  assert.equal((await call('DELETE', `/api/courses/${MISSING_ID}`, 'teacherA')).statusCode, 404);
  assert.equal((await call('GET', '/api/courses/not-a-uuid', 'admin')).statusCode, 400);
});

test('COURSE-09: course update works for owner teacher and admin', async () => {
  const id = makeCourse('teacherA', 'UPD-1');
  const res = await call('PUT', `/api/courses/${id}`, 'teacherA', { course_code: 'UPD-2', title: ' New title ' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(courseRow(id), { id, course_code: 'UPD-2', title: 'New title', teacher_id: people.teacherA.id });

  const byAdmin = await call('PUT', `/api/courses/${id}`, 'admin', { course_code: 'UPD-3', title: 'Admin edit' });
  assert.equal(byAdmin.statusCode, 200);
  assert.equal(courseRow(id).course_code, 'UPD-3');

  // Invalid body and conflicting code are rejected without changing the row.
  const other = makeCourse('teacherA', 'UPD-OTHER');
  assert.equal((await call('PUT', `/api/courses/${id}`, 'teacherA', { course_code: 'UPD-3', title: '' })).statusCode, 400);
  const clash = await call('PUT', `/api/courses/${id}`, 'teacherA', { course_code: 'UPD-OTHER', title: 'x' });
  assert.equal(clash.statusCode, 409);
  assert.equal(courseRow(id).course_code, 'UPD-3');
  assert.ok(other);
});

test('COURSE-10: course deletion is authorization-protected and safe', async () => {
  const id = makeCourse('teacherA');
  assert.equal((await call('DELETE', `/api/courses/${id}`, null)).statusCode, 401);
  assert.equal((await call('DELETE', `/api/courses/${id}`, 'student1')).statusCode, 403);
  assert.equal((await call('DELETE', `/api/courses/${id}`, 'teacherB')).statusCode, 403);
  assert.ok(courseRow(id), 'course must survive unauthorized attempts');

  // Owner deletes; its enrollment links go with it (pure join rows).
  enrollDirect(id, 'student1');
  assert.equal((await call('DELETE', `/api/courses/${id}`, 'teacherA')).statusCode, 200);
  assert.equal(courseRow(id), undefined);
  assert.equal(isEnrolled(id, 'student1'), false);
  assert.equal((await call('GET', `/api/courses/${id}`, 'admin')).statusCode, 404);

  // A course with real activity records is not silently destroyed.
  const busy = makeCourse('teacherA');
  db.prepare("INSERT INTO attendance_sessions (id, course_id, otp_code) VALUES (?,?,'123456')").run(newId(), busy);
  const refused = await call('DELETE', `/api/courses/${busy}`, 'admin');
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.json().error.code, 'COURSE_HAS_DEPENDENTS');
  assert.ok(courseRow(busy));
});

// ───────────── Enrollment tests ─────────────

test('ENROLL-01: teacher (owner) and admin can enroll a student', async () => {
  const c1 = makeCourse('teacherA');
  const res = await call('POST', `/api/courses/${c1}/enrollments`, 'teacherA', { student_id: people.student1.id });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(Object.keys(res.json().data).sort(), ['course_id', 'enrolled_at', 'student_id']);
  assert.equal(res.json().data.student_id, people.student1.id);
  assert.ok(isEnrolled(c1, 'student1'));

  const c2 = makeCourse('teacherB');
  const byAdmin = await call('POST', `/api/courses/${c2}/enrollments`, 'admin', { student_id: people.student2.id });
  assert.equal(byAdmin.statusCode, 201);
  assert.ok(isEnrolled(c2, 'student2'));

  // A teacher who does not own the course may not enroll anyone.
  const notOwner = await call('POST', `/api/courses/${c1}/enrollments`, 'teacherB', { student_id: people.student3.id });
  assert.equal(notOwner.statusCode, 403);
  assert.equal(isEnrolled(c1, 'student3'), false);
});

test('ENROLL-02: non-student users cannot be enrolled as students', async () => {
  const c = makeCourse('teacherA');
  for (const key of ['teacherB', 'admin', 'teacherA']) {
    const res = await call('POST', `/api/courses/${c}/enrollments`, 'teacherA', { student_id: people[key].id });
    assert.equal(res.statusCode, 400, `${key} must not be enrollable`);
  }
  const missing = await call('POST', `/api/courses/${c}/enrollments`, 'teacherA', { student_id: MISSING_ID });
  assert.equal(missing.statusCode, 404);
  const malformed = await call('POST', `/api/courses/${c}/enrollments`, 'teacherA', { student_id: 'nope' });
  assert.equal(malformed.statusCode, 400);
  assert.equal(db.prepare('SELECT COUNT(*) FROM enrollments WHERE course_id = ?').pluck().get(c), 0);

  const noCourse = await call('POST', `/api/courses/${MISSING_ID}/enrollments`, 'admin', { student_id: people.student1.id });
  assert.equal(noCourse.statusCode, 404);
});

test('ENROLL-03: duplicate enrollment is rejected cleanly', async () => {
  const c = makeCourse('teacherA');
  const url = `/api/courses/${c}/enrollments`;
  assert.equal((await call('POST', url, 'teacherA', { student_id: people.student1.id })).statusCode, 201);
  const dup = await call('POST', url, 'teacherA', { student_id: people.student1.id });
  assert.equal(dup.statusCode, 409);
  assert.equal(dup.json().error.code, 'ALREADY_ENROLLED');
  assert.equal(db.prepare('SELECT COUNT(*) FROM enrollments WHERE course_id = ?').pluck().get(c), 1);
});

test('ENROLL-04: a student cannot manage anyone\'s enrollment', async () => {
  const c = makeCourse('teacherA');
  enrollDirect(c, 'student2');
  const url = `/api/courses/${c}/enrollments`;

  assert.equal((await call('POST', url, 'student1', { student_id: people.student1.id })).statusCode, 403); // self-enroll
  assert.equal((await call('POST', url, 'student1', { student_id: people.student3.id })).statusCode, 403);
  assert.equal((await call('DELETE', `${url}/${people.student2.id}`, 'student1')).statusCode, 403);
  assert.equal((await call('DELETE', `${url}/${people.student2.id}`, 'student2')).statusCode, 403); // even their own
  assert.ok(isEnrolled(c, 'student2'));
  assert.equal(isEnrolled(c, 'student1'), false);
  assert.equal(isEnrolled(c, 'student3'), false);
});

test('ENROLL-05: unauthorized enrollment requests return 401 / 403', async () => {
  const c = makeCourse('teacherA');
  const url = `/api/courses/${c}/enrollments`;
  assert.equal((await call('POST', url, null, { student_id: people.student1.id })).statusCode, 401);
  assert.equal((await call('POST', url, 'student1', { student_id: people.student1.id })).statusCode, 403);
  assert.equal((await call('POST', url, 'teacherB', { student_id: people.student1.id })).statusCode, 403);
  assert.equal(isEnrolled(c, 'student1'), false);
});

test('ENROLL-06: course enrollment listing is authorization-protected', async () => {
  const c = makeCourse('teacherA');
  enrollDirect(c, 'student1');
  enrollDirect(c, 'student2');
  const url = `/api/courses/${c}/enrollments`;

  assert.equal((await call('GET', url, null)).statusCode, 401);
  assert.equal((await call('GET', url, 'student1')).statusCode, 403);
  assert.equal((await call('GET', url, 'teacherB')).statusCode, 403);

  for (const who of ['teacherA', 'admin']) {
    const res = await call('GET', url, who);
    assert.equal(res.statusCode, 200);
    const rows = res.json().data;
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.deepEqual(Object.keys(row).sort(), ['email', 'enrolled_at', 'full_name', 'student_id']);
    }
    assert.deepEqual(rows.map((r) => r.student_id).sort(), [people.student1.id, people.student2.id].sort());
  }
  assert.equal((await call('GET', `/api/courses/${MISSING_ID}/enrollments`, 'admin')).statusCode, 404);
});

test('ENROLL-07: a student can retrieve their own enrolled courses', async () => {
  const a = makeCourse('teacherA', 'ME-A');
  const b = makeCourse('teacherB', 'ME-B');
  const c = makeCourse('teacherA', 'ME-C');
  enrollDirect(a, 'student3');
  enrollDirect(b, 'student3');
  enrollDirect(c, 'student2');

  const res = await call('GET', '/api/me/courses', 'student3');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().data.map((x) => x.course_code), ['ME-A', 'ME-B']);
  assert.deepEqual(Object.keys(res.json().data[0]).sort(), ['course_code', 'id', 'teacher_id', 'title']);

  assert.equal((await call('GET', '/api/me/courses', null)).statusCode, 401);
  assert.equal((await call('GET', '/api/me/courses', 'teacherA')).statusCode, 403);
});

test('ENROLL-08: a student cannot retrieve another student\'s enrollment data', async () => {
  const c = makeCourse('teacherA', 'PRIV-1');
  enrollDirect(c, 'student2');

  // student1 supplies student2's id in every way the API could conceivably accept it.
  const viaQuery = await call('GET', `/api/me/courses?student_id=${people.student2.id}&studentId=${people.student2.id}`, 'student1');
  assert.equal(viaQuery.statusCode, 200);
  const own = db.prepare('SELECT course_id FROM enrollments WHERE student_id = ? ORDER BY course_id')
    .pluck().all(people.student1.id);
  const returned = viaQuery.json().data.map((x) => x.id).sort();
  assert.deepEqual(returned, own, 'must return exactly student1\'s own enrollments');
  assert.ok(!returned.includes(c), 'must not include student2\'s course');
  assert.equal((await call('GET', `/api/courses/${c}/enrollments`, 'student1')).statusCode, 403);
  assert.equal((await call('GET', `/api/courses/${c}`, 'student1')).statusCode, 403);
  assert.equal((await call('GET', `/api/me/courses/${people.student2.id}`, 'student1')).statusCode, 404);
});

test('ENROLL-09: removing an enrollment works for owner teacher and admin', async () => {
  const c = makeCourse('teacherA');
  enrollDirect(c, 'student1');
  enrollDirect(c, 'student2');
  const url = (key) => `/api/courses/${c}/enrollments/${people[key].id}`;

  assert.equal((await call('DELETE', url('student1'), 'teacherB')).statusCode, 403);
  assert.ok(isEnrolled(c, 'student1'));

  const byTeacher = await call('DELETE', url('student1'), 'teacherA');
  assert.equal(byTeacher.statusCode, 200);
  assert.equal(isEnrolled(c, 'student1'), false);

  assert.equal((await call('DELETE', url('student2'), 'admin')).statusCode, 200);
  assert.equal(isEnrolled(c, 'student2'), false);
});

test('ENROLL-10: nonexistent enrollment is handled correctly', async () => {
  const c = makeCourse('teacherA');
  const gone = await call('DELETE', `/api/courses/${c}/enrollments/${people.student1.id}`, 'teacherA');
  assert.equal(gone.statusCode, 404);
  assert.equal(gone.json().success, false);

  enrollDirect(c, 'student1');
  assert.equal((await call('DELETE', `/api/courses/${c}/enrollments/${people.student1.id}`, 'teacherA')).statusCode, 200);
  assert.equal((await call('DELETE', `/api/courses/${c}/enrollments/${people.student1.id}`, 'teacherA')).statusCode, 404); // twice
  assert.equal((await call('DELETE', `/api/courses/${MISSING_ID}/enrollments/${people.student1.id}`, 'admin')).statusCode, 404);
  assert.equal((await call('DELETE', `/api/courses/${c}/enrollments/not-a-uuid`, 'admin')).statusCode, 400);
});

// ───────────── Cross-cutting tests ─────────────

test('SQL injection payloads are treated as data', async () => {
  const payload = "X'); DROP TABLE courses;--";
  const res = await call('POST', '/api/courses', 'teacherA', { course_code: payload, title: "Robert'); DROP TABLE users;--" });
  assert.equal(res.statusCode, 201);
  assert.equal(courseRow(res.json().data.id).course_code, payload);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'courses'").get(), 'courses table must still exist');
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'users'").get(), 'users table must still exist');

  const c = makeCourse('teacherA');
  const injectedIds = ["' OR '1'='1", "1; DROP TABLE enrollments;--", `${c}' OR 1=1--`];
  for (const bad of injectedIds) {
    const id = encodeURIComponent(bad);
    assert.equal((await call('GET', `/api/courses/${id}`, 'admin')).statusCode, 400);
    assert.equal((await call('DELETE', `/api/courses/${c}/enrollments/${id}`, 'admin')).statusCode, 400);
    const enroll = await call('POST', `/api/courses/${c}/enrollments`, 'admin', { student_id: bad });
    assert.equal(enroll.statusCode, 400);
  }
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'enrollments'").get());
});

test('foreign keys remain enforced', async () => {
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  // Direct inserts that violate FKs are rejected by SQLite itself.
  assert.throws(() => db.prepare('INSERT INTO enrollments (course_id, student_id) VALUES (?,?)')
    .run(MISSING_ID, people.student1.id), /FOREIGN KEY/);
  assert.throws(() => db.prepare('INSERT INTO courses (id, course_code, title, teacher_id) VALUES (?,?,?,?)')
    .run(newId(), 'FKBAD', 'x', MISSING_ID), /FOREIGN KEY/);
  // A teacher who owns a course cannot be deleted out from under it (ON DELETE RESTRICT).
  makeCourse('teacherB');
  assert.throws(() => db.prepare('DELETE FROM users WHERE id = ?').run(people.teacherB.id), /FOREIGN KEY/);
});

test('authorization runs before validation and controller logic', async () => {
  const c = makeCourse('teacherA');
  const before = courseCount();

  // Invalid bodies from unauthorized callers get 401/403, never 400: the guard ran first.
  assert.equal((await call('POST', '/api/courses', 'student1', {})).statusCode, 403);
  assert.equal((await call('POST', '/api/courses', null, {})).statusCode, 401);
  assert.equal((await call('PUT', `/api/courses/${c}`, 'student1', {})).statusCode, 403);
  assert.equal((await call('POST', `/api/courses/${c}/enrollments`, 'student1', {})).statusCode, 403);
  assert.equal((await call('POST', `/api/courses/${c}/enrollments`, null, {})).statusCode, 401);

  // A student's valid, well-formed request has no effect.
  const ok = await call('POST', '/api/courses', 'student1', {
    course_code: 'STUDENTMADE', title: 'x', teacher_id: people.teacherA.id,
  });
  assert.equal(ok.statusCode, 403);
  assert.equal(courseCount(), before);

  // Client-supplied role/identity fields are not trusted: unknown properties are dropped.
  const res = await call('POST', '/api/courses', 'student1', {
    course_code: 'ROLEFORGE', title: 'x', role: 'admin',
  });
  assert.equal(res.statusCode, 403);
});

test('no password or password_hash leaks through course/enrollment responses', async () => {
  const c = makeCourse('teacherA');
  enrollDirect(c, 'student1');
  const responses = [
    await call('GET', '/api/courses', 'admin'),
    await call('GET', `/api/courses/${c}`, 'teacherA'),
    await call('GET', `/api/courses/${c}/enrollments`, 'teacherA'),
    await call('GET', `/api/courses/${c}/enrollments`, 'admin'),
    await call('GET', '/api/me/courses', 'student1'),
    await call('POST', `/api/courses/${c}/enrollments`, 'teacherA', { student_id: people.teacherA.id }), // 400
    await call('POST', `/api/courses/${c}/enrollments`, 'teacherA', { student_id: people.student1.id }), // 409
  ];
  for (const res of responses) {
    assert.ok(!/password/i.test(res.body), 'response must not mention password fields');
    assert.ok(!res.body.includes(passwordHash), 'response must not contain a password hash');
  }
});
