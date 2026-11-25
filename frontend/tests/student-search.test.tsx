// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../src/services';
import { saveAuth } from '../src/storage';
import { useStudentSearch } from '../src/useStudentSearch';

vi.hoisted(() => vi.stubEnv('VITE_USE_MOCKS', 'false'));

afterEach(() => {
  cleanup();
  saveAuth(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('sends an authenticated, encoded query and returns enrollment status', async () => {
  const match = {
    student_id: 'student-1',
    full_name: 'Asha Rao',
    email: 'asha+class@example.test',
    already_enrolled: true,
  };
  saveAuth({
    token: 'test-token',
    user: {
      id: 'staff-1',
      full_name: 'Test Teacher',
      email: 'teacher@example.test',
      role: 'teacher',
    },
  });
  const fetchRequest = vi.fn<typeof fetch>(async () =>
    Response.json({ success: true, data: [match] }),
  );
  vi.stubGlobal('fetch', fetchRequest);

  await expect(
    api.searchStudents('course-1', ' asha+class@ '),
  ).resolves.toEqual([match]);
  const [url, init] = fetchRequest.mock.calls[0];
  expect(url).toBe('/api/courses/course-1/students/search?q=asha%2Bclass%40');
  expect(new Headers(init?.headers).get('Authorization')).toBe(
    'Bearer test-token',
  );
});

it('waits for the latest eligible term and keys results by course', async () => {
  vi.useFakeTimers();
  const fetchRequest = vi.fn(async () =>
    Response.json({ success: true, data: [] }),
  );
  vi.stubGlobal('fetch', fetchRequest);
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result, rerender, unmount } = renderHook(
    ({ course, input }) => useStudentSearch(course, input),
    { wrapper, initialProps: { course: 'course-1', input: ' as ' } },
  );
  try {
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(result.current.eligible).toBe(false);
    expect(fetchRequest).not.toHaveBeenCalled();

    rerender({ course: 'course-1', input: 'ash' });
    await act(() => vi.advanceTimersByTimeAsync(200));
    rerender({ course: 'course-1', input: 'asha' });
    await act(() => vi.advanceTimersByTimeAsync(299));
    expect(fetchRequest).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetchRequest).toHaveBeenCalledTimes(1);
    expect(fetchRequest).toHaveBeenLastCalledWith(
      '/api/courses/course-1/students/search?q=asha',
      expect.anything(),
    );

    rerender({ course: 'course-2', input: 'asha' });
    expect(fetchRequest).toHaveBeenCalledTimes(2);
    expect(fetchRequest).toHaveBeenLastCalledWith(
      '/api/courses/course-2/students/search?q=asha',
      expect.anything(),
    );
  } finally {
    unmount();
    client.clear();
  }
});
