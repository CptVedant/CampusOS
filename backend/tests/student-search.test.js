import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/database/db.js';
import { runMigrations } from '../src/database/migrate.js';
import { newId } from '../src/utils/ids.js';

async function setup(t) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  runMigrations(db);

  const insertUser = db.prepare(
    'INSERT INTO users (id, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
  );
  function user(full_name, email, role = 'student') {
    const id = newId();
    insertUser.run(id, full_name, email, 'unused-test-hash', role);
    return { id, role, full_name, email };
  }
  const teacher = user('Course Teacher', 'teacher@example.test', 'teacher');
  const other = user('Other Teacher', 'other@example.test', 'teacher');
  const admin = user('Campus Admin', 'admin@example.test', 'admin');
  const student = user('Asha Rao', 'asha@example.test');
  const courseId = newId();
  const otherCourseId = newId();
  const insertCourse = db.prepare('INSERT INTO courses (id, course_code, title, teacher_id) VALUES (?, ?, ?, ?)');
  insertCourse.run(courseId, 'CS101', 'Computer Science', teacher.id);
  insertCourse.run(otherCourseId, 'MA101', 'Mathematics', other.id);

  const app = buildApp({
    db,
    config: { logLevel: 'silent', jwtSecret: 'student-search-test-secret', jwtExpiresIn: '1h' },
  });
  t.after(() => app.close());
  await app.ready();
  function call(method, url, account, payload) {
    const headers = account
      ? { authorization: 'Bearer ' + app.jwt.sign({ sub: account.id, role: account.role }) }
      : {};
    return app.inject({ method, url, headers, payload });
  }
  function search(account, q, id = courseId) {
    const query = q === undefined ? '' : '?' + new URLSearchParams({ q });
    return call('GET', '/api/courses/' + id + '/students/search' + query, account);
  }
  return { admin, other, teacher, student, user, courseId, otherCourseId, search, call };
}

test('owner finds an unenrolled student by name or email and the enrollment flag changes after enrollment', async (t) => {
  const { teacher, admin, student, courseId, otherCourseId, search, call, user } = await setup(t);
  user('Asha Staff', 'asha.staff@example.test', 'teacher');
  const expected = { student_id: student.id, full_name: student.full_name, email: student.email, already_enrolled: false };
  for (const query of ['  SHA RA  ', 'SHA@EXAMPLE']) {
    const found = await search(teacher, query);
    assert.equal(found.statusCode, 200);
    assert.deepEqual(found.json(), { success: true, data: [expected] });
  }

  const rosterUrl = '/api/courses/' + courseId + '/enrollments';
  const enrolled = await call('POST', rosterUrl, teacher, { student_id: expected.student_id });
  assert.equal(enrolled.statusCode, 201);
  const roster = await call('GET', rosterUrl, teacher);
  assert.equal(roster.statusCode, 200);
  assert.equal(roster.json().data[0].student_id, student.id);

  const updated = await search(teacher, 'asha');
  assert.equal(updated.statusCode, 200);
  assert.deepEqual(updated.json().data, [{ ...expected, already_enrolled: true }]);
  const adminResult = await search(admin, 'asha', otherCourseId);
  assert.equal(adminResult.statusCode, 200);
  assert.deepEqual(adminResult.json().data, [expected]);
});

test('search requires staff access to the selected course', async (t) => {
  const { teacher, student, other, search } = await setup(t);
  assert.equal((await search(undefined, 'asha')).statusCode, 401);
  assert.equal((await search(student, 'asha')).statusCode, 403);
  assert.equal((await search(other, 'asha')).statusCode, 403);
  assert.equal((await search(teacher, 'asha', newId())).statusCode, 404);
  assert.equal((await search(teacher, 'asha', 'invalid-id')).statusCode, 400);
});

test('search validates the query and returns an empty list for unmatched literal text', async (t) => {
  const { teacher, search, user } = await setup(t);
  for (const query of [undefined, '  ', '  ab ', 'x'.repeat(255)]) {
    assert.equal((await search(teacher, query)).statusCode, 400);
  }
  user('Symbols 100%_ complete', 'symbols@example.test');
  for (const query of ['no matching name', '%%%']) {
    const response = await search(teacher, query);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { success: true, data: [] });
  }
  const literal = await search(teacher, '0%_');
  assert.equal(literal.statusCode, 200);
  assert.equal(literal.json().data[0].full_name, 'Symbols 100%_ complete');
});

test('search limits and consistently orders results', async (t) => {
  const { teacher, search, user } = await setup(t);
  const expected = [];
  for (let n = 24; n >= 0; n--) {
    const number = String(n).padStart(2, '0');
    const name = 'Search Match ' + number;
    user(name, 'match' + number + '@example.test');
    expected.unshift(name);
  }
  const response = await search(teacher, 'search match');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data.map((row) => row.full_name), expected.slice(0, 20));
});
