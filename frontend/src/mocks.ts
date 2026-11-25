import { ApiError } from './api';
import { readAuth } from './storage';
import { demoAccounts } from './services';
import type {
  ActiveSession,
  Attendance,
  Course,
  Session,
  Student,
  User,
} from './types';

const studentId = '00000000-0000-4000-8000-000000000001';
const teacherId = '00000000-0000-4000-8000-000000000002';
const adminId = '00000000-0000-4000-8000-000000000003';
const secondId = '00000000-0000-4000-8000-000000000004';
export const userFixtures: User[] = [
  {
    id: studentId,
    full_name: 'Alex Rivera',
    email: demoAccounts.student,
    role: 'student',
  },
  {
    id: teacherId,
    full_name: 'Maya Singh',
    email: demoAccounts.teacher,
    role: 'teacher',
  },
  {
    id: adminId,
    full_name: 'Jordan Lee',
    email: demoAccounts.admin,
    role: 'admin',
  },
  {
    id: secondId,
    full_name: 'Sam Patel',
    email: 'sam@campus.test',
    role: 'student',
  },
];
const initialCourses: Course[] = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    course_code: 'CS101',
    title: 'Computer Science',
    teacher_id: teacherId,
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    course_code: 'MA201',
    title: 'Linear Algebra',
    teacher_id: teacherId,
  },
  {
    id: '00000000-0000-4000-8000-000000000103',
    course_code: 'PH110',
    title: 'Physics I',
    teacher_id: teacherId,
  },
];
// Local UI fixtures. These fields do not define a backend API contract.
export const materialFixtures = [
  {
    title: 'Relational model and keys',
    course: 'CS101',
    filename: 'relational-model.txt',
    content:
      'A primary key identifies a row. A foreign key references a key in another table.',
  },
  {
    title: 'Matrix operations',
    course: 'MA201',
    filename: 'matrix-operations.txt',
    content:
      'Matrix multiplication combines rows of the first matrix with columns of the second.',
  },
];
export const markFixtures = [
  {
    title: 'SQL fundamentals',
    course: 'CS101',
    score: 18,
    max: 20,
    feedback: 'Review outer joins.',
  },
  {
    title: 'Vectors and matrices',
    course: 'MA201',
    score: 24,
    max: 30,
    feedback: 'Good work on matrix operations.',
  },
];
interface Recorded {
  session_id: string;
  student_id: string;
  punched_at: string;
  device?: string;
}
interface DemoDb {
  courses: Course[];
  roster: Record<string, string[]>;
  sessions: Session[];
  records: Recorded[];
}
const dbKey = 'campusos.mock.v1';
function load(): DemoDb {
  const existing = localStorage.getItem(dbKey);
  if (existing) return JSON.parse(existing) as DemoDb;
  return {
    courses: initialCourses,
    roster: Object.fromEntries(
      initialCourses.map(({ id }) => [id, [studentId, secondId]]),
    ),
    sessions: [],
    records: [],
  };
}
function getStudent(id: string): Student {
  const user = userFixtures.find(
    (candidate) => candidate.id === id && candidate.role === 'student',
  );
  if (!user) throw new ApiError(400, '', 'Enter the UUID of a demo student.');
  return { student_id: id, full_name: user.full_name, email: user.email };
}
function fail(
  status: number,
  code: string,
  message = 'The requested demo record was not found.',
): never {
  throw new ApiError(status, code, message);
}
export async function mockRequest<T>(
  path: string,
  method = 'GET',
  body?: object,
): Promise<T> {
  const db = load();
  const user = readAuth()?.user;
  const fields = (body ?? {}) as Record<string, string>;
  const url = new URL(path, 'https://campus.test');
  const [, section, action, id, tail, student] = url.pathname.split('/');
  function save(value: unknown): T {
    localStorage.setItem(dbKey, JSON.stringify(db));
    return value as T;
  }
  function courseFor(courseId: string) {
    return db.courses.find((course) => course.id === courseId) ?? fail(404, '');
  }
  function sessionFor(sessionId: string) {
    return (
      db.sessions.find((session) => session.id === sessionId) ??
      fail(404, 'SESSION_NOT_FOUND')
    );
  }
  if (section === 'auth') {
    const account = userFixtures.find(
      ({ email }) => email === fields.email.toLowerCase(),
    );
    if (!account || fields.password !== 'demo1234')
      return fail(401, '', 'Use a demo account and the password shown below.');
    return { user: account, token: 'mock:' + account.id } as T;
  }
  if (!user) return fail(401, '', 'Sign in again.');
  const enrolled = (courseId: string) =>
    (db.roster[courseId] ?? []).includes(user.id);
  const visible = db.courses.filter((course) =>
    user.role === 'student'
      ? enrolled(course.id)
      : user.role === 'admin' || course.teacher_id === user.id,
  );
  if (section === 'me') return visible as T;
  if (section === 'courses') {
    if (!action && method === 'GET') return visible as T;
    if (!action || (id !== 'enrollments' && method === 'PUT')) {
      const teacher =
        user.role === 'teacher'
          ? user.id
          : fields.teacher_id || courseFor(action).teacher_id;
      if (
        !userFixtures.some(
          (account) => account.id === teacher && account.role === 'teacher',
        )
      )
        return fail(400, '', 'Enter a demo teacher UUID.');
      if (
        db.courses.some(
          (c) => c.id !== action && c.course_code === fields.course_code,
        )
      )
        return fail(409, '', 'This course code is already in use.');
      const course = {
        id: action || crypto.randomUUID(),
        title: fields.title,
        course_code: fields.course_code,
        teacher_id: teacher,
      };
      db.courses = [...db.courses.filter((c) => c.id !== action), course];
      return save(course);
    }
    const course = courseFor(action);
    if (id !== 'enrollments') {
      if (db.sessions.some((session) => session.course_id === action))
        return fail(409, '', 'This course has attendance history.');
      db.courses = db.courses.filter((c) => c.id !== action);
      delete db.roster[action];
      return save({ id: action });
    }
    const roster = (db.roster[course.id] ??= []);
    if (method === 'GET') return roster.map(getStudent) as T;
    if (method === 'DELETE')
      db.roster[course.id] = roster.filter((key) => key !== tail);
    else {
      getStudent(fields.student_id);
      if (roster.includes(fields.student_id))
        return fail(409, '', 'This student is already enrolled.');
      roster.push(fields.student_id);
    }
    return save({});
  }
  if (action === 'active') {
    const active: ActiveSession[] = db.sessions
      .filter((s) => s.is_active && enrolled(s.course_id))
      .map((s) => ({
        session_id: s.id,
        course_id: s.course_id,
        course_code: courseFor(s.course_id).course_code,
        title: courseFor(s.course_id).title,
        started_at: s.started_at,
        already_punched: db.records.some(
          (record) =>
            record.session_id === s.id && record.student_id === user.id,
        ),
      }));
    return active as T;
  }
  if (action === 'me') {
    const filter = url.searchParams.get('course_id');
    const attendance: Attendance = { courses: [], records: [] };
    visible.forEach((course) => {
      if (filter && filter !== course.id) return;
      let total = 0;
      let present = 0;
      db.sessions
        .filter((s) => s.course_id === course.id)
        .forEach((s) => {
          const record = db.records.find(
            (r) => r.session_id === s.id && r.student_id === user.id,
          );
          if (record || !s.is_active) total++;
          if (!record) return;
          present++;
          attendance.records.push({
            session_id: s.id,
            course_id: course.id,
            course_code: course.course_code,
            session_started_at: s.started_at,
            punched_at: record.punched_at,
          });
        });
      attendance.courses.push({
        course_id: course.id,
        course_code: course.course_code,
        title: course.title,
        total_sessions: total,
        sessions_attended: present,
        attendance_percentage: total
          ? Math.round((present / total) * 10000) / 100
          : 0,
      });
    });
    return attendance as T;
  }
  if (action === 'start') {
    courseFor(fields.course_id);
    if (
      db.sessions.some((s) => s.course_id === fields.course_id && s.is_active)
    )
      return fail(409, 'SESSION_ALREADY_ACTIVE');
    const session: Session = {
      id: crypto.randomUUID(),
      course_id: fields.course_id,
      otp_code: String(
        crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000,
      ).padStart(6, '0'),
      is_active: true,
      started_at: new Date().toISOString(),
      ended_at: null,
    };
    db.sessions.unshift(session);
    return save(session);
  }
  if (action === 'stop') {
    const session = sessionFor(fields.session_id);
    session.is_active = false;
    session.ended_at ??= new Date().toISOString();
    delete session.otp_code;
    return save(session);
  }
  if (action === 'punch' || tail === 'records') {
    const session = sessionFor(action === 'punch' ? fields.session_id : id);
    const student_id = action === 'punch' ? user.id : fields.student_id;
    if (method === 'DELETE') {
      db.records = db.records.filter(
        (r) => r.session_id !== session.id || r.student_id !== student,
      );
      return save({});
    }
    if (!(db.roster[session.course_id] ?? []).includes(student_id))
      return fail(
        403,
        action === 'punch' ? 'NOT_ENROLLED' : 'STUDENT_NOT_ENROLLED',
      );
    if (action === 'punch' && !session.is_active)
      return fail(400, 'SESSION_CLOSED');
    if (action === 'punch' && fields.otp !== session.otp_code)
      return fail(400, 'INVALID_OTP');
    if (
      db.records.some(
        (record) =>
          record.session_id === session.id && record.student_id === student_id,
      )
    )
      return fail(409, 'ALREADY_PUNCHED');
    if (
      fields.device_fingerprint &&
      db.records.some(
        (r) =>
          r.session_id === session.id && r.device === fields.device_fingerprint,
      )
    )
      return fail(409, 'DEVICE_ALREADY_USED');
    const record = {
      session_id: session.id,
      student_id,
      punched_at: new Date().toISOString(),
      device: fields.device_fingerprint,
    };
    db.records.push(record);
    return save(record);
  }
  if (action === 'sessions' && !id) {
    return db.sessions
      .filter((s) => s.course_id === url.searchParams.get('course_id'))
      .map((s) => ({
        id: s.id,
        course_id: s.course_id,
        is_active: s.is_active,
        started_at: s.started_at,
        ended_at: s.ended_at,
        attendance_count: db.records.filter((r) => r.session_id === s.id)
          .length,
      })) as T;
  }
  if (action === 'sessions') {
    const session = sessionFor(id);
    const present = db.records
      .filter((r) => r.session_id === id)
      .map((r) => ({
        ...getStudent(r.student_id),
        punched_at: r.punched_at,
        manual: !r.device,
      }));
    const absent = (db.roster[session.course_id] ?? [])
      .filter((key) => !present.some((r) => r.student_id === key))
      .map(getStudent);
    return { session, present, absent } as T;
  }
  return fail(404, '');
}
