import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, useMocks } from './services';

const SEARCH_DELAY_MS = 300;
export const MIN_STUDENT_SEARCH_LENGTH = 3;

export function useStudentSearch(courseId: string, input: string) {
  const term = input.trim();
  const eligible =
    Boolean(courseId) &&
    !useMocks &&
    [...term].length >= MIN_STUDENT_SEARCH_LENGTH;
  const [settledTerm, setSettledTerm] = useState('');
  useEffect(() => {
    if (!eligible) {
      setSettledTerm('');
      return;
    }
    const timer = window.setTimeout(
      () => setSettledTerm(term),
      SEARCH_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [eligible, term]);

  const isDebouncing = eligible && settledTerm !== term;
  const query = useQuery({
    queryKey: ['staff', 'student-search', courseId, term],
    queryFn: ({ signal }) => api.searchStudents(courseId, term, signal),
    enabled: eligible && !isDebouncing,
    retry: false,
  });

  return { query, eligible, isDebouncing };
}
