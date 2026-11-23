import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/database/db.js';
import { runMigrations } from '../src/database/migrate.js';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/modules/auth/auth.service.js';
import {
  formatOtp,
  generateOtp,
  translatePunchConstraintError,
} from '../src/modules/attendance/attendance.service.js';
import { newId } from '../src/utils/ids.js';

const TEST_CONFIG = {
  nodeEnv: 'test',
  isProduction: false,
  logLevel: 'silent',
  jwtSecret: 'phase4-test-secret-not-for-production-0123456789',
  jwtExpiresIn: '1h',
};

const ROLE_OF = {
  admin: 'admin',
  teacherA: 'teacher',
  teacherB: 'teacher',
  student1: 'student',
  student2: 'student',
  student3: 'student',
  student4: 'student',
  outsider: 'student', // never enrolled anywhere unless a test says so
};

let dir, db, app, passwordHash;
const people = {};
const tokens = {};

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-p4-'));
  db = openDatabase(path.join(dir, 'test.sqlite'));
  runMigrations(db);
  passwordHash = await hashPassword('Phase4#TestPassword');
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

const MISSING_ID = '00000000-0000-4000-8000-000000000000';
let fpSeq = 0;
const freshFp = () => `11111111-1111-4111-8111-${String(++fpSeq).padStart(12, '0')}`;
let courseSeq = 0;

function makeCourse(teacherKey, ...studentKeys) {
  const id = newId();
  db.prepare('INSERT INTO courses (id, course_code, title, teacher_id) VALUES (?,?,?,?)')
    .run(id, `P4-${++courseSeq}-${id.slice(0, 4)}`, 'Phase 4 course', people[teacherKey].id);
  for (const s of studentKeys) {
    db.prepare('INSERT INTO enrollments (course_id, student_id) VALUES (?,?)').run(id, people[s].id);
  }
  return id;
}
function makeSession(courseId, { active = true, otp = '123456' } = {}) {
  const id = newId();
  db.prepare('INSERT INTO attendance_sessions (id, course_id, otp_code) VALUES (?,?,?)').run(id, courseId, otp);
  if (!active) {
    db.prepare("UPDATE attendance_sessions SET is_active = 0, ended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(id);
  }
  return id;
}
const addRecord = (sessionId, studentKey, fingerprint = freshFp()) =>
  db.prepare('INSERT INTO attendance_records (id, session_id, student_id, device_fingerprint) VALUES (?,?,?,?)')
    .run(newId(), sessionId, people[studentKey].id, fingerprint);
const recordCount = (sessionId) =>
  db.prepare('SELECT COUNT(*) FROM attendance_records WHERE session_id = ?').pluck().get(sessionId);
const sessionRow = (id) => db.prepare('SELECT * FROM attendance_sessions WHERE id = ?').get(id);
const punch = (who, body) => call('POST', '/api/attendance/punch', who, body);
const start = (who, courseId) => call('POST', '/api/attendance/start', who, { course_id: courseId });
const stop = (who, sessionId) => call('POST', '/api/attendance/stop', who, { session_id: sessionId });

// ───────────── Session lifecycle ─────────────

test('ATT-01/03/04: teacher starts a session; OTP is 6 digits, persisted, active', async () => {
  const course = makeCourse('teacherA');
  const res = await start('teacherA', course);
  assert.equal(res.statusCode, 201);
  const session = res.json().data;
  assert.deepEqual(Object.keys(session).sort(), ['course_id', 'ended_at', 'id', 'is_active', 'otp_code', 'started_at']);
  assert.match(session.otp_code, /^\d{6}$/);
  assert.equal(session.is_active, true);
  assert.equal(session.ended_at, null);
  assert.equal(session.course_id, course);

  const row = sessionRow(session.id);
  assert.equal(row.otp_code, session.otp_code);
  assert.equal(row.is_active, 1);
  assert.equal(row.ended_at, null);
});

test('ATT-02/08: admin can start a session for another teacher\'s course', async () => {
  const course = makeCourse('teacherB');
  const res = await start('admin', course);
  assert.equal(res.statusCode, 201);
  assert.equal(sessionRow(res.json().data.id).course_id, course);
});

test('ATT-03: OTP generation always yields exactly six digits, keeping leading zeros', () => {
  assert.equal(formatOtp(7), '000007');
  assert.equal(formatOtp(0), '000000');
  assert.equal(formatOtp(999999), '999999');
  for (let i = 0; i < 2000; i++) assert.match(generateOtp(), /^\d{6}$/);
  assert.ok(new Set(Array.from({ length: 50 }, generateOtp)).size > 1, 'codes must vary');
});

test('ATT-04: the OTP stays static for the life of the session', async () => {
  const course = makeCourse('teacherA', 'student1');
  const created = (await start('teacherA', course)).json().data;
  const detail = async () => (await call('GET', `/api/attendance/sessions/${created.id}`, 'teacherA')).json().data.session.otp_code;
  assert.equal(await detail(), created.otp_code);
  const ok = await punch('student1', { session_id: created.id, otp: created.otp_code, device_fingerprint: freshFp() });
  assert.equal(ok.statusCode, 201);
  assert.equal(await detail(), created.otp_code);
  assert.equal(sessionRow(created.id).otp_code, created.otp_code);
});

test('ATT-05/06/07: student, unauthenticated and non-owner teacher cannot start a session', async () => {
  const course = makeCourse('teacherA', 'student1');
  assert.equal((await start('student1', course)).statusCode, 403);
  assert.equal((await start(null, course)).statusCode, 401);
  assert.equal((await start('teacherB', course)).statusCode, 403);
  assert.equal(db.prepare('SELECT COUNT(*) FROM attendance_sessions WHERE course_id = ?').pluck().get(course), 0);
});

test('ATT-13: start rejects missing, malformed and nonexistent course ids', async () => {
  assert.equal((await call('POST', '/api/attendance/start', 'teacherA', {})).statusCode, 400);
  assert.equal((await call('POST', '/api/attendance/start', 'teacherA', { course_id: 'nope' })).statusCode, 400);
  assert.equal((await start('teacherA', MISSING_ID)).statusCode, 404);
  assert.equal((await start('admin', MISSING_ID)).statusCode, 404);
});

test('ATT: only one active session per course; a new one is allowed after stopping', async () => {
  const course = makeCourse('teacherA');
  const first = (await start('teacherA', course)).json().data;
  const second = await start('teacherA', course);
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().error.code, 'SESSION_ALREADY_ACTIVE');
  assert.equal(db.prepare('SELECT COUNT(*) FROM attendance_sessions WHERE course_id = ?').pluck().get(course), 1);
  assert.equal((await stop('teacherA', first.id)).statusCode, 200);
  assert.equal((await start('teacherA', course)).statusCode, 201);
});

test('ATT-09/12/14: teacher stops own session; it is inactive with ended_at; repeat stop is idempotent', async () => {
  const course = makeCourse('teacherA', 'student1');
  const s = (await start('teacherA', course)).json().data;
  const res = await stop('teacherA', s.id);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().data.is_active, false);
  assert.ok(res.json().data.ended_at);
  assert.ok(
  !('otp_code' in res.json().data),
  'stopping a session must not expose its OTP',
  );
  const row = sessionRow(s.id);
  assert.equal(row.is_active, 0);
  assert.ok(row.ended_at);

  const again = await stop('teacherA', s.id);
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().data.ended_at, row.ended_at, 'ended_at must not be overwritten');
  assert.equal(sessionRow(s.id).ended_at, row.ended_at);

  const late = await punch('student1', { session_id: s.id, otp: s.otp_code, device_fingerprint: freshFp() });
  assert.equal(late.statusCode, 400);
  assert.equal(late.json().error.code, 'SESSION_CLOSED');
});

test('ATT-10/11/13: stop authorization and missing/invalid ids', async () => {
  const course = makeCourse('teacherA');
  const s1 = (await start('teacherA', course)).json().data;
  assert.equal((await stop('teacherB', s1.id)).statusCode, 403);
  assert.equal(sessionRow(s1.id).is_active, 1, 'another teacher must not be able to close it');
  assert.equal((await stop('student1', s1.id)).statusCode, 403);
  assert.equal((await stop(null, s1.id)).statusCode, 401);
  assert.equal(sessionRow(s1.id).is_active, 1);

  assert.equal((await stop('admin', s1.id)).statusCode, 200); // admin across courses
  assert.equal(sessionRow(s1.id).is_active, 0);

  assert.equal((await stop('teacherA', MISSING_ID)).statusCode, 404);
  assert.equal((await call('POST', '/api/attendance/stop', 'teacherA', {})).statusCode, 400);
  assert.equal((await stop('teacherA', 'not-a-uuid')).statusCode, 400);
});

// ───────────── Punch validation ─────────────

test('ATT-15/28: enrolled student punches with the correct OTP; response leaks nothing', async () => {
  const course = makeCourse('teacherA', 'student1', 'student2');
  const s = makeSession(course, { otp: '482913' });
  addRecord(s, 'student2');
  const f = freshFp().toUpperCase(); // stored lower-cased
  const res = await punch('student1', { session_id: s, otp: '482913', device_fingerprint: f });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(Object.keys(res.json().data).sort(), ['course_id', 'punched_at', 'session_id']);
  assert.ok(!res.body.includes('482913'), 'OTP must not be echoed');
  assert.ok(!res.body.includes(people.student2.id), 'no other student data');
  const row = db.prepare('SELECT student_id, device_fingerprint FROM attendance_records WHERE session_id = ? AND student_id = ?')
    .get(s, people.student1.id);
  assert.equal(row.device_fingerprint, f.toLowerCase());
});

test('ATT-16: wrong OTP is rejected with 400 and creates no record', async () => {
  const course = makeCourse('teacherA', 'student1');
  const s = makeSession(course, { otp: '123456' });
  const res = await punch('student1', { session_id: s, otp: '654321', device_fingerprint: freshFp() });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'INVALID_OTP');
  assert.equal(recordCount(s), 0);
});

test('ATT-17: malformed OTPs are rejected', async () => {
  const course = makeCourse('teacherA', 'student1');
  const s = makeSession(course);
  for (const otp of ['12345', '1234567', 'abcdef', '12 456', '', '١٢٣٤٥٦', null, { a: 1 }]) {
    const res = await punch('student1', { session_id: s, otp, device_fingerprint: freshFp() });
    assert.equal(res.statusCode, 400, `otp ${JSON.stringify(otp)} should be 400`);
  }
  assert.equal((await punch('student1', { session_id: s, device_fingerprint: freshFp() })).statusCode, 400);
  assert.equal(recordCount(s), 0);
});

test('ATT-18/19: closed session and nonexistent session reject punches', async () => {
  const course = makeCourse('teacherA', 'student1');
  const closed = makeSession(course, { active: false });
  const res = await punch('student1', { session_id: closed, otp: '123456', device_fingerprint: freshFp() });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'SESSION_CLOSED');
  assert.equal(recordCount(closed), 0);

  const missing = await punch('student1', { session_id: MISSING_ID, otp: '123456', device_fingerprint: freshFp() });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, 'SESSION_NOT_FOUND');
});

test('ATT-20/21: unauthenticated, teacher and admin cannot use the punch endpoint', async () => {
  const course = makeCourse('teacherA', 'student1');
  const s = makeSession(course);
  const body = { session_id: s, otp: '123456', device_fingerprint: freshFp() };
  assert.equal((await punch(null, body)).statusCode, 401);
  assert.equal((await punch('teacherA', body)).statusCode, 403);
  assert.equal((await punch('admin', body)).statusCode, 403);
  assert.equal(recordCount(s), 0);
});

test('ATT-22: a non-enrolled student cannot punch (and learns nothing about the code)', async () => {
  const course = makeCourse('teacherA', 'student1');
  const s = makeSession(course, { otp: '123456' });
  const right = await punch('outsider', { session_id: s, otp: '123456', device_fingerprint: freshFp() });
  const wrong = await punch('outsider', { session_id: s, otp: '000000', device_fingerprint: freshFp() });
  for (const res of [right, wrong]) {
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error.code, 'NOT_ENROLLED');
  }
  const closed = makeSession(course, { active: false });
  assert.equal((await punch('outsider', { session_id: closed, otp: '123456', device_fingerprint: freshFp() })).statusCode, 403);
  assert.equal(recordCount(s), 0);
});

test('ATT-23: duplicate punch by the same student returns 409', async () => {
  const course = makeCourse('teacherA', 'student1');
  const s = makeSession(course);
  const f = freshFp();
  assert.equal((await punch('student1', { session_id: s, otp: '123456', device_fingerprint: f })).statusCode, 201);
  const same = await punch('student1', { session_id: s, otp: '123456', device_fingerprint: f });
  assert.equal(same.statusCode, 409);
  assert.equal(same.json().error.code, 'ALREADY_PUNCHED');
  const otherDevice = await punch('student1', { session_id: s, otp: '123456', device_fingerprint: freshFp() });
  assert.equal(otherDevice.statusCode, 409);
  assert.equal(otherDevice.json().error.code, 'ALREADY_PUNCHED');
  assert.equal(recordCount(s), 1);
});

test('ATT-24: the same fingerprint cannot be reused by another student in a session', async () => {
  const course = makeCourse('teacherA', 'student1', 'student2');
  const s = makeSession(course);
  const f = freshFp();
  assert.equal((await punch('student1', { session_id: s, otp: '123456', device_fingerprint: f })).statusCode, 201);
  const reuse = await punch('student2', { session_id: s, otp: '123456', device_fingerprint: f });
  assert.equal(reuse.statusCode, 409);
  assert.equal(reuse.json().error.code, 'DEVICE_ALREADY_USED');
  assert.ok(!reuse.body.includes(people.student1.id), 'must not reveal who used the device');
  // Case variants of the same UUID are the same device.
  const upper = await punch('student2', { session_id: s, otp: '123456', device_fingerprint: f.toUpperCase() });
  assert.equal(upper.statusCode, 409);
  assert.equal(recordCount(s), 1);
});

test('ATT-25: the same fingerprint may be used in a different session', async () => {
  const course = makeCourse('teacherA', 'student1', 'student2');
  const s1 = makeSession(course, { active: false });
  const s2 = makeSession(course);
  const f = freshFp();
  addRecord(s1, 'student1', f);
  const res = await punch('student2', { session_id: s2, otp: '123456', device_fingerprint: f });
  assert.equal(res.statusCode, 201);
  // ...but that session's own constraints still apply.
  assert.equal((await punch('student1', { session_id: s2, otp: '123456', device_fingerprint: f })).statusCode, 409);
});

test('ATT-26: concurrent duplicate submissions create one record and leak no SQL errors', async () => {
  const course = makeCourse('teacherA', 'student1', 'student2', 'student3', 'student4');
  const sameStudent = makeSession(course);
  const f = freshFp();
  const burst = await Promise.all(
    Array.from({ length: 12 }, () => punch('student1', { session_id: sameStudent, otp: '123456', device_fingerprint: f })),
  );
  assert.equal(burst.filter((r) => r.statusCode === 201).length, 1);
  assert.equal(burst.filter((r) => r.statusCode === 409).length, 11);
  assert.equal(recordCount(sameStudent), 1);

  const sameDevice = makeSession(course);
  const shared = freshFp();
  const students = ['student1', 'student2', 'student3', 'student4'];
  const race = await Promise.all(
    students.flatMap((s) =>
      Array.from({ length: 3 }, () => punch(s, { session_id: sameDevice, otp: '123456', device_fingerprint: shared })),
    ),
  );
  assert.equal(race.filter((r) => r.statusCode === 201).length, 1);
  assert.equal(race.filter((r) => r.statusCode === 409).length, 11);
  assert.equal(recordCount(sameDevice), 1);

  for (const res of [...burst, ...race]) {
    assert.ok(!/sqlite|constraint|SQLITE/i.test(res.body), 'raw SQL errors must never reach clients');
  }
});

test('ATT-26b: constraint violations from the database map to clean 409s (backstop path)', () => {
  const device = translatePunchConstraintError({
    code: 'SQLITE_CONSTRAINT_UNIQUE',
    message: 'UNIQUE constraint failed: attendance_records.session_id, attendance_records.device_fingerprint',
  });
  assert.equal(device.statusCode, 409);
  assert.equal(device.code, 'DEVICE_ALREADY_USED');
  const student = translatePunchConstraintError({
    code: 'SQLITE_CONSTRAINT_UNIQUE',
    message: 'UNIQUE constraint failed: attendance_records.session_id, attendance_records.student_id',
  });
  assert.equal(student.statusCode, 409);
  assert.equal(student.code, 'ALREADY_PUNCHED');
  const other = new Error('boom');
  assert.equal(translatePunchConstraintError(other), other, 'unrelated errors pass through untouched');
});

test('ATT-27: invalid fingerprints are rejected', async () => {
  const course = makeCourse('teacherA', 'student1');
  const s = makeSession(course);
  const bad = [undefined, '', 'abc', 'x'.repeat(200), "'; DROP TABLE attendance_records;--", null, 12345,
    '11111111-1111-4111-8111-11111111111', // one char short
    'manual:11111111-1111-4111-8111-111111111111']; // would collide with the manual-record namespace
  for (const device_fingerprint of bad) {
    const res = await punch('student1', { session_id: s, otp: '123456', device_fingerprint });
    assert.equal(res.statusCode, 400, `fingerprint ${JSON.stringify(device_fingerprint)} should be 400`);
  }
  assert.equal(recordCount(s), 0);
});

test('ATT: identity comes from the JWT; a client-supplied student_id is ignored', async () => {
  const course = makeCourse('teacherA', 'student1', 'student2');
  const s = makeSession(course);
  const res = await punch('student1', {
    session_id: s, otp: '123456', device_fingerprint: freshFp(), student_id: people.student2.id,
  });
  assert.equal(res.statusCode, 201);
  const owners = db.prepare('SELECT student_id FROM attendance_records WHERE session_id = ?').pluck().all(s);
  assert.deepEqual(owners, [people.student1.id]);
});

test('ATT: students see only active sessions in their own courses, without the OTP', async () => {
  const mine = makeCourse('teacherA', 'student1');
  const theirs = makeCourse('teacherA', 'student2');
  const live = makeSession(mine, { otp: '735190' });
  makeSession(mine, { active: false, otp: '111222' });
  makeSession(theirs, { otp: '999888' });
  const res = await call('GET', '/api/attendance/active', 'student1');
  assert.equal(res.statusCode, 200);
  const rows = res.json().data.filter((r) => [mine, theirs].includes(r.course_id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].session_id, live);
  assert.equal(rows[0].already_punched, false);
  for (const otp of ['735190', '111222', '999888']) assert.ok(!res.body.includes(otp));
  assert.deepEqual(Object.keys(rows[0]).sort(), ['already_punched', 'course_code', 'course_id', 'session_id', 'started_at', 'title']);

  await punch('student1', { session_id: live, otp: '735190', device_fingerprint: freshFp() });
  const after = (await call('GET', '/api/attendance/active', 'student1')).json().data.find((r) => r.session_id === live);
  assert.equal(after.already_punched, true);
  assert.equal((await call('GET', '/api/attendance/active', 'teacherA')).statusCode, 403);
  assert.equal((await call('GET', '/api/attendance/active', null)).statusCode, 401);
});

// ───────────── History and metrics ─────────────

test('ATT-29/30: a student sees only their own history; another student\'s id is never accepted', async () => {
  const course = makeCourse('teacherA', 'student1', 'student2');
  const s = makeSession(course, { active: false });
  addRecord(s, 'student1');
  addRecord(s, 'student2');
  const res = await call('GET', `/api/attendance/me?student_id=${people.student2.id}&studentId=${people.student2.id}`, 'student1');
  assert.equal(res.statusCode, 200);
  const { records, courses } = res.json().data;
  assert.equal(records.filter((r) => r.session_id === s).length, 1);
  assert.ok(!res.body.includes(people.student2.id));
  assert.ok(courses.some((c) => c.course_id === course));
  assert.deepEqual(Object.keys(records[0]).sort(), ['course_code', 'course_id', 'punched_at', 'session_id', 'session_started_at']);

  assert.equal((await call('GET', '/api/attendance/me', 'teacherA')).statusCode, 403);
  assert.equal((await call('GET', '/api/attendance/me', null)).statusCode, 401);
  assert.equal((await call('GET', '/api/attendance/me?course_id=bad', 'student1')).statusCode, 400);
});

test('ATT-31: attendance percentages are correct for known data', async () => {
  const course = makeCourse('teacherA', 'student1', 'student2');
  const c1 = makeSession(course, { active: false });
  const c2 = makeSession(course, { active: false });
  makeSession(course, { active: false }); // closed, nobody attended
  const live = makeSession(course); // in progress
  addRecord(c1, 'student1');
  addRecord(c2, 'student1');

  const summary = async (who) =>
    (await call('GET', `/api/attendance/me?course_id=${course}`, who)).json().data.courses[0];

  // 2 attended of 3 closed sessions; the live session does not count against anyone yet.
  let s1 = await summary('student1');
  assert.deepEqual(
    [s1.total_sessions, s1.sessions_attended, s1.attendance_percentage], [3, 2, 66.67]);
  let s2 = await summary('student2');
  assert.deepEqual([s2.total_sessions, s2.sessions_attended, s2.attendance_percentage], [3, 0, 0]);

  // Punching the live session counts it for that student only.
  assert.equal((await punch('student1', { session_id: live, otp: '123456', device_fingerprint: freshFp() })).statusCode, 201);
  s1 = await summary('student1');
  assert.deepEqual([s1.total_sessions, s1.sessions_attended, s1.attendance_percentage], [4, 3, 75]);
  s2 = await summary('student2');
  assert.deepEqual([s2.total_sessions, s2.sessions_attended, s2.attendance_percentage], [3, 0, 0]);
});

test('ATT-32: a course with no sessions yields 0%, not NaN or an error', async () => {
  const course = makeCourse('teacherA', 'student3');
  const res = await call('GET', `/api/attendance/me?course_id=${course}`, 'student3');
  assert.equal(res.statusCode, 200);
  const [row] = res.json().data.courses;
  assert.deepEqual([row.total_sessions, row.sessions_attended, row.attendance_percentage], [0, 0, 0]);
  assert.deepEqual(res.json().data.records, []);
});

// ───────────── Staff queries ─────────────

test('ATT-33/34/35: staff can list sessions only for courses they may manage', async () => {
  const course = makeCourse('teacherA', 'student1');
  const s = makeSession(course);
  addRecord(s, 'student1');
  const url = `/api/attendance/sessions?course_id=${course}`;

  for (const who of ['teacherA', 'admin']) {
    const res = await call('GET', url, who);
    assert.equal(res.statusCode, 200);
    const row = res.json().data.find((x) => x.id === s);
    assert.equal(row.attendance_count, 1);
    assert.equal(row.is_active, true);
    assert.ok(!('otp_code' in row));
  }
  assert.equal((await call('GET', url, 'teacherB')).statusCode, 403);
  assert.equal((await call('GET', url, 'student1')).statusCode, 403);
  assert.equal((await call('GET', url, null)).statusCode, 401);
  assert.equal((await call('GET', '/api/attendance/sessions', 'teacherA')).statusCode, 400);
  assert.equal((await call('GET', '/api/attendance/sessions?course_id=nope', 'teacherA')).statusCode, 400);
  assert.equal((await call('GET', `/api/attendance/sessions?course_id=${MISSING_ID}`, 'admin')).statusCode, 404);
});

test('ATT-33/34: session detail lists present/absent, shows the OTP only while active, hides fingerprints', async () => {
  const course = makeCourse('teacherA', 'student1', 'student2');
  const s = makeSession(course, { otp: '246810' });
  const secretFp = freshFp();
  addRecord(s, 'student1', secretFp);

  const res = await call('GET', `/api/attendance/sessions/${s}`, 'teacherA');
  assert.equal(res.statusCode, 200);
  const d = res.json().data;
  assert.equal(d.session.otp_code, '246810');
  assert.deepEqual(d.present.map((p) => p.student_id), [people.student1.id]);
  assert.deepEqual(d.present[0].manual, false);
  assert.deepEqual(d.absent.map((p) => p.student_id), [people.student2.id]);
  assert.ok(!res.body.includes(secretFp) && !res.body.includes('device_fingerprint'));

  await stop('teacherA', s);
  const closed = (await call('GET', `/api/attendance/sessions/${s}`, 'admin')).json().data;
  assert.ok(!('otp_code' in closed.session), 'a closed session no longer exposes its code');

  assert.equal((await call('GET', `/api/attendance/sessions/${s}`, 'teacherB')).statusCode, 403);
  assert.equal((await call('GET', `/api/attendance/sessions/${s}`, 'student1')).statusCode, 403);
  assert.equal((await call('GET', `/api/attendance/sessions/${MISSING_ID}`, 'admin')).statusCode, 404);
  assert.equal((await call('GET', '/api/attendance/sessions/not-a-uuid', 'admin')).statusCode, 400);
});

// ───────────── Manual corrections ─────────────

test('ATT-36: staff can mark an enrolled student present, even after the session closed', async () => {
  const course = makeCourse('teacherA', 'student1', 'student2');
  const s = makeSession(course, { active: false });
  const url = `/api/attendance/sessions/${s}/records`;

  const res = await call('POST', url, 'teacherA', { student_id: people.student1.id });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().data.manual, true);
  assert.equal(recordCount(s), 1);
  const detail = (await call('GET', `/api/attendance/sessions/${s}`, 'teacherA')).json().data;
  assert.equal(detail.present[0].manual, true);

  const admin = await call('POST', url, 'admin', { student_id: people.student2.id });
  assert.equal(admin.statusCode, 201);

  // Manual records never block real devices: the synthetic fingerprint is outside the UUID namespace.
  const live = makeSession(course);
  assert.equal((await call('POST', `/api/attendance/sessions/${live}/records`, 'teacherA', { student_id: people.student1.id })).statusCode, 201);
});

test('ATT-36: manual marking respects authorization, enrollment, role and uniqueness', async () => {
  const course = makeCourse('teacherA', 'student1');
  const s = makeSession(course);
  const url = `/api/attendance/sessions/${s}/records`;

  assert.equal((await call('POST', url, 'teacherA', { student_id: people.student1.id })).statusCode, 201);
  const dup = await call('POST', url, 'teacherA', { student_id: people.student1.id });
  assert.equal(dup.statusCode, 409);
  assert.equal(dup.json().error.code, 'ALREADY_PUNCHED');

  const notEnrolled = await call('POST', url, 'teacherA', { student_id: people.outsider.id });
  assert.equal(notEnrolled.statusCode, 400);
  assert.equal(notEnrolled.json().error.code, 'STUDENT_NOT_ENROLLED');
  assert.equal((await call('POST', url, 'teacherA', { student_id: people.teacherB.id })).statusCode, 400);
  assert.equal((await call('POST', url, 'teacherA', { student_id: MISSING_ID })).statusCode, 404);
  assert.equal((await call('POST', url, 'teacherA', { student_id: 'bad' })).statusCode, 400);

  // Not allowed: other teacher, student, anonymous.
  assert.equal((await call('POST', url, 'teacherB', { student_id: people.student1.id })).statusCode, 403);
  assert.equal((await call('POST', url, 'student1', { student_id: people.student1.id })).statusCode, 403);
  assert.equal((await call('POST', url, null, { student_id: people.student1.id })).statusCode, 401);
  assert.equal((await call('POST', `/api/attendance/sessions/${MISSING_ID}/records`, 'admin', { student_id: people.student1.id })).statusCode, 404);
  assert.equal(recordCount(s), 1);
});

test('ATT-34/35/36: staff can remove a record; others cannot; missing record is 404', async () => {
  const course = makeCourse('teacherA', 'student1', 'student2');
  const s = makeSession(course, { active: false });
  addRecord(s, 'student1');
  addRecord(s, 'student2');
  const del = (who, key) => call('DELETE', `/api/attendance/sessions/${s}/records/${people[key].id}`, who);

  assert.equal((await del('teacherB', 'student1')).statusCode, 403);
  assert.equal((await del('student1', 'student1')).statusCode, 403);
  assert.equal((await del(null, 'student1')).statusCode, 401);
  assert.equal(recordCount(s), 2, 'unauthorized attempts must not delete anything');

  assert.equal((await del('teacherA', 'student1')).statusCode, 200);
  assert.equal((await del('admin', 'student2')).statusCode, 200);
  assert.equal(recordCount(s), 0);
  assert.equal((await del('teacherA', 'student1')).statusCode, 404);
  assert.equal((await call('DELETE', `/api/attendance/sessions/${MISSING_ID}/records/${people.student1.id}`, 'admin')).statusCode, 404);
  assert.equal((await call('DELETE', `/api/attendance/sessions/${s}/records/not-a-uuid`, 'admin')).statusCode, 400);
});

// ───────────── Cross-cutting and integrity ─────────────

test('guards run before validation: unauthorized callers never see 400', async () => {
  assert.equal((await call('POST', '/api/attendance/start', 'student1', {})).statusCode, 403);
  assert.equal((await call('POST', '/api/attendance/stop', 'student1', {})).statusCode, 403);
  assert.equal((await call('POST', '/api/attendance/punch', null, {})).statusCode, 401);
  assert.equal((await call('POST', '/api/attendance/punch', 'teacherA', {})).statusCode, 403);
  assert.equal((await call('POST', '/api/attendance/punch', 'admin', {})).statusCode, 403);
  assert.equal((await call('GET', '/api/attendance/sessions', 'student1')).statusCode, 403);
  assert.equal((await call('POST', `/api/attendance/sessions/${MISSING_ID}/records`, 'student1', {})).statusCode, 403);
  assert.equal((await call('GET', '/api/attendance/me', 'teacherA')).statusCode, 403);
});

test('ATT-40: foreign keys and unique constraints remain enforced at the database level', () => {
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  const course = makeCourse('teacherA', 'student1', 'student2');
  const s = makeSession(course);
  const f = freshFp();
  addRecord(s, 'student1', f);
  assert.throws(() => addRecord(s, 'student1', freshFp()), /UNIQUE/);   // (session, student)
  assert.throws(() => addRecord(s, 'student2', f), /UNIQUE/);           // (session, device)
  assert.throws(() => db.prepare('INSERT INTO attendance_records (id, session_id, student_id, device_fingerprint) VALUES (?,?,?,?)')
    .run(newId(), MISSING_ID, people.student1.id, freshFp()), /FOREIGN KEY/);
  assert.throws(() => db.prepare("INSERT INTO attendance_sessions (id, course_id, otp_code) VALUES (?,?,'123456')")
    .run(newId(), MISSING_ID), /FOREIGN KEY/);
  assert.throws(() => db.prepare("INSERT INTO attendance_sessions (id, course_id, otp_code) VALUES (?,?,'12345')")
    .run(newId(), course), /CHECK/);
});

test('ATT-41: SQL injection payloads are treated as data', async () => {
  const course = makeCourse('teacherA', 'student1');
  const s = makeSession(course);
  const evil = ["' OR '1'='1", "1; DROP TABLE attendance_records;--", `${s}' OR 1=1--`];
  for (const bad of evil) {
    const enc = encodeURIComponent(bad);
    assert.equal((await call('POST', '/api/attendance/start', 'teacherA', { course_id: bad })).statusCode, 400);
    assert.equal((await call('POST', '/api/attendance/stop', 'teacherA', { session_id: bad })).statusCode, 400);
    assert.equal((await call('GET', `/api/attendance/sessions/${enc}`, 'admin')).statusCode, 400);
    assert.equal((await call('GET', `/api/attendance/sessions?course_id=${enc}`, 'admin')).statusCode, 400);
    assert.equal((await call('GET', `/api/attendance/me?course_id=${enc}`, 'student1')).statusCode, 400);
    assert.equal((await punch('student1', { session_id: s, otp: bad, device_fingerprint: freshFp() })).statusCode, 400);
    assert.equal((await punch('student1', { session_id: bad, otp: '123456', device_fingerprint: freshFp() })).statusCode, 400);
    assert.equal((await punch('student1', { session_id: s, otp: '123456', device_fingerprint: bad })).statusCode, 400);
  }
  for (const table of ['attendance_records', 'attendance_sessions', 'users', 'courses', 'enrollments']) {
    assert.ok(db.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get(table), `${table} must still exist`);
  }
  assert.equal(recordCount(s), 0);
});

test('ATT-42: no response leaks password data; students never receive an OTP', async () => {
  const course = makeCourse('teacherA', 'student1', 'student2');
  const s = makeSession(course, { otp: '570213' });
  addRecord(s, 'student2');
  const studentResponses = [
    await punch('student1', { session_id: s, otp: '570213', device_fingerprint: freshFp() }),
    await punch('student1', { session_id: s, otp: '570213', device_fingerprint: freshFp() }), // 409
    await punch('student1', { session_id: s, otp: '000000', device_fingerprint: freshFp() }), // 400 (wrong code)
    await punch('outsider', { session_id: s, otp: '570213', device_fingerprint: freshFp() }), // 403
    await call('GET', '/api/attendance/active', 'student1'),
    await call('GET', '/api/attendance/me', 'student1'),
    await call('POST', '/api/attendance/start', 'student1', { course_id: course }), // 403
  ];
  for (const res of studentResponses) {
    assert.ok(!res.body.includes('570213'), 'students must never receive the OTP');
    assert.ok(!/password/i.test(res.body));
    assert.ok(!res.body.includes(passwordHash));
  }
  const staffResponses = [
    await call('GET', `/api/attendance/sessions/${s}`, 'teacherA'),
    await call('GET', `/api/attendance/sessions?course_id=${course}`, 'teacherA'),
  ];
  for (const res of staffResponses) {
    assert.ok(!/password/i.test(res.body));
    assert.ok(!res.body.includes(passwordHash));
  }
});
