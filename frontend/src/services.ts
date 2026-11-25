import { http, requestResponse, responseData } from './api';
import type {
  ActiveSession,
  Attendance,
  Auth,
  Course,
  Material,
  Session,
  SessionDetail,
  Student,
} from './types';

export const useMocks = import.meta.env.VITE_USE_MOCKS === 'true';
const request: typeof http = async (path, method, body) =>
  useMocks
    ? (await import('./mocks')).mockRequest(path, method, body)
    : http(path, method, body);

export const api = {
  login: (email: string, password: string) =>
    request<Auth>('/auth/login', 'POST', { email, password }),
  courses: (student = false) =>
    request<Course[]>(student ? '/me/courses' : '/courses'),
  saveCourse: (
    course: Pick<Course, 'course_code' | 'title'> & { teacher_id?: string },
    id?: string,
  ) =>
    request<Course>(
      '/courses' + (id ? '/' + id : ''),
      id ? 'PUT' : 'POST',
      course,
    ),
  deleteCourse: (id: string) => request('/courses/' + id, 'DELETE'),
  roster: (id: string) => request<Student[]>('/courses/' + id + '/enrollments'),
  enroll: (id: string, student_id: string) =>
    request('/courses/' + id + '/enrollments', 'POST', { student_id }),
  unenroll: (id: string, student: string) =>
    request('/courses/' + id + '/enrollments/' + student, 'DELETE'),
  summary: (id = '') =>
    request<Attendance>(
      '/attendance/me' + (id ? '?course_id=' + encodeURIComponent(id) : ''),
    ),
  active: () => request<ActiveSession[]>('/attendance/active'),
  punch: (session_id: string, otp: string, device_fingerprint: string) =>
    request('/attendance/punch', 'POST', {
      session_id,
      otp,
      device_fingerprint,
    }),
  sessions: (id: string) =>
    request<Session[]>(
      '/attendance/sessions?course_id=' + encodeURIComponent(id),
    ),
  session: (id: string) => request<SessionDetail>('/attendance/sessions/' + id),
  start: (course_id: string) =>
    request<Session>('/attendance/start', 'POST', { course_id }),
  stop: (session_id: string) =>
    request<Session>('/attendance/stop', 'POST', { session_id }),
  mark: (id: string, student_id: string) =>
    request('/attendance/sessions/' + id + '/records', 'POST', { student_id }),
  unmark: (id: string, student: string) =>
    request('/attendance/sessions/' + id + '/records/' + student, 'DELETE'),
};

export const materialsApi = {
  async list(courseId: string, page: number) {
    const query = new URLSearchParams({ courseId, page: String(page) });
    const response = await requestResponse('/documents?' + query);
    return {
      items: await responseData<Material[]>(response),
      hasNext: response.headers.has('X-Next-Page'),
    };
  },
  upload: (form: FormData) => http<Material>('/documents', 'POST', form),
  update: (id: string, fields: Pick<Material, 'title' | 'description'>) =>
    http<Material>('/documents/' + id, 'PATCH', fields),
  async remove(id: string) {
    await requestResponse('/documents/' + id, 'DELETE');
  },
  async download(id: string) {
    return (await requestResponse('/documents/' + id + '/download')).blob();
  },
};
export const demoAccounts = {
  student: 'student@campus.test',
  teacher: 'teacher@campus.test',
  admin: 'admin@campus.test',
} as const;
export const demoSections = {
  materials: () =>
    import('./mocks').then(({ materialFixtures }) => materialFixtures),
  marks: () => import('./mocks').then(({ markFixtures }) => markFixtures),
  users: () => import('./mocks').then(({ userFixtures }) => userFixtures),
};
