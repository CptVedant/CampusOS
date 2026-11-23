// @vitest-environment jsdom
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../src/App';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../src/services';
import { fingerprint, saveAuth } from '../src/storage';

interface Fixture {
  app: {
    inject: (request: object) => Promise<{ body: string; statusCode: number }>;
    close: () => Promise<void>;
  };
  accounts: Record<
    'teacher' | 'student' | 'second' | 'admin',
    { id: string; email: string }
  >;
  course: string;
}
vi.hoisted(() => vi.stubEnv('VITE_USE_MOCKS', 'false'));
let fixture: Fixture;
const fixturePath = pathToFileURL(resolve('tests/backend-fixture.mjs')).href;

beforeEach(async () => {
  const { createBackend } = await import(/* @vite-ignore */ fixturePath);
  fixture = await createBackend();
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    const response = await fixture.app.inject({
      method: init.method,
      url: path,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      payload: init.body ?? undefined,
    });
    return new Response(response.body, {
      status: response.statusCode,
      headers: { 'content-type': 'application/json' },
    });
  });
});
afterEach(async () => {
  saveAuth(null);
  vi.unstubAllGlobals();
  await fixture?.app.close();
});

it('runs a live teacher and student attendance session against Fastify and SQLite', async () => {
  const { password } = await import(/* @vite-ignore */ fixturePath);
  const { accounts, course } = fixture;
  const teacher = await api.login(accounts.teacher.email, password);
  expect(teacher.user.role).toBe('teacher');
  saveAuth(teacher);
  expect(await api.roster(course)).toHaveLength(2);
  const created = await api.saveCourse({
    course_code: 'DB102',
    title: 'Database Systems',
  });
  await api.saveCourse({ course_code: 'DB102', title: 'DBMS' }, created.id);
  await api.enroll(created.id, accounts.student.id);
  expect(await api.roster(created.id)).toHaveLength(1);
  await api.unenroll(created.id, accounts.student.id);
  await api.deleteCourse(created.id);

  const session = await api.start(course);
  expect(session.otp_code).toMatch(/^\d{6}$/);
  expect((await api.sessions(course))[0].is_active).toBe(true);

  const student = await api.login(accounts.student.email, password);
  expect(student.user.role).toBe('student');
  saveAuth(student);
  expect((await api.courses(true))[0].id).toBe(course);
  const [active] = await api.active();
  expect(active).toMatchObject({
    session_id: session.id,
    already_punched: false,
  });
  expect(active).not.toHaveProperty('otp_code');
  const wrong = session.otp_code === '000000' ? '000001' : '000000';
  await expect(
    api.punch(session.id, wrong, fingerprint()),
  ).rejects.toMatchObject({ code: 'INVALID_OTP' });
  await api.punch(session.id, session.otp_code!, fingerprint());
  await expect(
    api.punch(session.id, session.otp_code!, fingerprint()),
  ).rejects.toMatchObject({ code: 'ALREADY_PUNCHED' });
  expect((await api.active())[0].already_punched).toBe(true);
  expect((await api.summary(course)).courses[0]).toMatchObject({
    sessions_attended: 1,
    attendance_percentage: 100,
  });

  saveAuth(teacher);
  expect((await api.session(session.id)).present[0].student_id).toBe(
    accounts.student.id,
  );
  await api.mark(session.id, accounts.second.id);
  expect(
    (await api.session(session.id)).present.some(
      (entry) =>
        entry.student_id === accounts.second.id && Boolean(entry.manual),
    ),
  ).toBe(true);
  await api.unmark(session.id, accounts.second.id);
  expect((await api.session(session.id)).absent[0].student_id).toBe(
    accounts.second.id,
  );
  await api.stop(session.id);
  expect((await api.session(session.id)).session).not.toHaveProperty(
    'otp_code',
  );

  saveAuth(student);
  expect(await api.active()).toEqual([]);
  expect((await api.summary()).records[0].session_id).toBe(session.id);

  const admin = await api.login(accounts.admin.email, password);
  saveAuth(admin);
  expect((await api.courses())[0].teacher_id).toBe(accounts.teacher.id);
});

it('renders the teacher-to-student check-in flow and labels demo materials', async () => {
  const { password } = await import(/* @vite-ignore */ fixturePath);
  const { accounts } = fixture;
  saveAuth(await api.login(accounts.teacher.email, password));
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('scrollTo', () => undefined);
  vi.stubGlobal('confirm', () => true);

  function open(path: string) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = render(
      <QueryClientProvider client={client}>
        <MemoryRouter
          initialEntries={[path]}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return () => {
      view.unmount();
      client.clear();
    };
  }

  const closeTeacher = open('/attendance');
  const start = await screen.findByRole('button', { name: 'Start session' });
  await waitFor(() =>
    expect((start as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(start);
  await screen.findByRole('heading', { name: 'Session code' });
  const code = screen.getByText(/^\d{6}$/).textContent!;
  closeTeacher();

  saveAuth(await api.login(accounts.student.email, password));
  const closeStudent = open('/');
  const digits = await screen.findByRole('group', {
    name: 'Six-digit session code',
  });
  fireEvent.paste(within(digits).getByRole('textbox', { name: 'Digit 1' }), {
    clipboardData: { getData: () => code },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Submit code' }));
  await screen.findByText('Attendance recorded for CS101.');
  await screen.findByText('100.00%');
  fireEvent.click(screen.getByRole('link', { name: 'Materials' }));
  await screen.findByText('Demo data');
  await screen.findByText('Relational model and keys');
  closeStudent();

  saveAuth(await api.login(accounts.teacher.email, password));
  const closeResults = open('/attendance');
  await screen.findByRole('heading', { name: 'Present · 1' });
  fireEvent.click(screen.getByRole('button', { name: 'End session' }));
  await screen.findByRole('heading', { name: 'Session results' });
  closeResults();
}, 15000);
