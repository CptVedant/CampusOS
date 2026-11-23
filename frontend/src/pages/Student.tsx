import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Clock3 } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { api } from '../services';
import { checkedTier, dateTime, percent } from '../attendance';
import { fingerprint } from '../storage';
import type { ActiveSession, Summary, User } from '../types';
import { Empty, ErrorText, PageTitle, Result } from '../ui';

export function AttendanceCard({ item }: { item: Summary }) {
  const tier = checkedTier(item.attendance_percentage, item.tier);
  useEffect(() => {
    if (import.meta.env.DEV && tier === 'Pending check')
      console.warn('Attendance tier mismatch', item.course_id, item.tier);
  }, [tier, item.course_id, item.tier]);
  return (
    <article className="card attendance-card">
      <div className="spread">
        <div>
          <span className="code">{item.course_code}</span>
          <h3>{item.title}</h3>
        </div>
        <strong className="percentage">
          {percent(item.attendance_percentage)}
        </strong>
      </div>
      <progress
        max={100}
        value={item.attendance_percentage}
        aria-label={item.title + ' attendance'}
      />
      <div className="spread">
        <span className={'badge ' + tier.toLowerCase().replace(' ', '-')}>
          {tier}
        </span>
        <small>
          {item.sessions_attended}/{item.total_sessions} sessions
        </small>
      </div>
    </article>
  );
}
function Punch({ session }: { session: ActiveSession }) {
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const client = useQueryClient();
  const submit = useMutation({
    mutationFn: () =>
      api.punch(session.session_id, digits.join(''), fingerprint()),
    onSuccess: async () => {
      setDigits(['', '', '', '', '', '']);
      await client.invalidateQueries({ queryKey: ['student'] });
    },
  });
  function fill(index: number, value: string) {
    const next = [...digits];
    const incoming = value.replace(/\D/g, '').slice(0, 6 - index);
    if (!incoming) next[index] = '';
    else
      [...incoming].forEach((digit, offset) => {
        next[index + offset] = digit;
      });
    setDigits(next);
    submit.reset();
    if (incoming) inputs.current[Math.min(5, index + incoming.length)]?.focus();
  }
  if (session.already_punched || submit.isSuccess)
    return (
      <p className="banner" role="status">
        Attendance recorded for {session.course_code}.
      </p>
    );
  return (
    <form
      className="card glass punch"
      id="punch"
      onSubmit={(event) => {
        event.preventDefault();
        if (digits.every(Boolean) && !submit.isPending) submit.mutate();
      }}
    >
      <div>
        <h2>Enter session code</h2>
        <p>
          Enter the six digits shown by your teacher for {session.course_code}.
        </p>
      </div>
      <div
        className="otp-inputs"
        role="group"
        aria-label="Six-digit session code"
      >
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(el) => {
              inputs.current[index] = el;
            }}
            aria-label={'Digit ' + (index + 1)}
            inputMode="numeric"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            value={digit}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => fill(index, event.currentTarget.value)}
            onPaste={(event) => {
              event.preventDefault();
              fill(index, event.clipboardData.getData('text'));
            }}
            onKeyDown={(event) => {
              if (
                (event.key === 'Backspace' && !digit) ||
                event.key === 'ArrowLeft'
              )
                inputs.current[index - 1]?.focus();
              if (event.key === 'ArrowRight')
                inputs.current[index + 1]?.focus();
            }}
          />
        ))}
      </div>
      <ErrorText error={submit.error} />
      <button
        className="primary"
        disabled={submit.isPending || !digits.every(Boolean)}
      >
        {submit.isPending ? 'Submitting…' : 'Submit code'}
      </button>
    </form>
  );
}
export default function Student({ user }: { user: User }) {
  const path = useLocation().pathname;
  const [course, setCourse] = useState('');
  const [chosen, setChosen] = useState('');
  const history = path === '/attendance';
  const coursesPage = path === '/courses';
  const filter = history ? course : '';
  const summary = useQuery({
    queryKey: ['student', 'summary', filter],
    queryFn: () => api.summary(filter),
    refetchInterval: 8000,
  });
  const courses = useQuery({
    queryKey: ['student', 'courses'],
    queryFn: () => api.courses(true),
    enabled: history || coursesPage,
  });
  const active = useQuery({
    queryKey: ['student', 'active'],
    queryFn: api.active,
    refetchInterval: 4000,
    enabled: !history && !coursesPage,
  });
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return (
    <>
      <PageTitle
        label="Student workspace"
        title={
          history
            ? 'Attendance history'
            : coursesPage
              ? 'My courses'
              : greeting + ', ' + user.full_name.split(' ')[0]
        }
        detail={
          history
            ? 'Review your recorded sessions.'
            : coursesPage
              ? 'Courses you are enrolled in.'
              : 'Your attendance this term'
        }
      />
      {!history && !coursesPage && (
        <Result query={active}>
          {(sessions) => {
            const selected =
              sessions.find((s) => s.session_id === chosen) ??
              sessions.find((s) => !s.already_punched) ??
              sessions[0];
            return selected ? (
              <>
                <a className="banner spread" href="#punch">
                  <span>
                    <Clock3 size={17} /> <strong>{selected.course_code}</strong>{' '}
                    {selected.already_punched
                      ? 'attendance recorded'
                      : 'attendance is open'}
                  </span>
                  <ArrowRight size={18} />
                </a>
                {sessions.length > 1 && (
                  <label>
                    Open session
                    <select
                      value={selected.session_id}
                      onChange={(event) => setChosen(event.target.value)}
                    >
                      {sessions.map((s) => (
                        <option key={s.session_id} value={s.session_id}>
                          {s.course_code} · {s.title}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div id={selected.already_punched ? 'punch' : undefined}>
                  <Punch key={selected.session_id} session={selected} />
                </div>
              </>
            ) : (
              <p className="quiet">
                No attendance sessions are open right now.
              </p>
            );
          }}
        </Result>
      )}
      {history && (
        <Result query={courses}>
          {(items) => (
            <label className="filter">
              Course
              <select
                value={course}
                onChange={(event) => setCourse(event.target.value)}
              >
                <option value="">All courses</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.course_code} · {item.title}
                  </option>
                ))}
              </select>
            </label>
          )}
        </Result>
      )}
      {coursesPage ? (
        <Result query={courses}>
          {(items) =>
            items.length ? (
              <div className="grid">
                {items.map((item) => (
                  <article className="card" key={item.id}>
                    <span className="code">{item.course_code}</span>
                    <h2>{item.title}</h2>
                  </article>
                ))}
              </div>
            ) : (
              <Empty>No course enrollments yet.</Empty>
            )
          }
        </Result>
      ) : (
        <Result query={summary}>
          {(data) => (
            <>
              <h2>{history ? 'Summary' : 'Courses'}</h2>
              {data.courses.length ? (
                <div className="grid">
                  {data.courses.map((item) => (
                    <AttendanceCard key={item.course_id} item={item} />
                  ))}
                </div>
              ) : (
                <Empty>No course attendance to display yet.</Empty>
              )}
              {history && (
                <>
                  <h2>Recorded sessions</h2>
                  {data.records.length ? (
                    <div className="card table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Course</th>
                            <th>Session started</th>
                            <th>Recorded</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.records.map((r) => (
                            <tr key={r.session_id}>
                              <td>{r.course_code}</td>
                              <td>{dateTime(r.session_started_at)}</td>
                              <td>{dateTime(r.punched_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty>No attendance records yet.</Empty>
                  )}
                </>
              )}
            </>
          )}
        </Result>
      )}
    </>
  );
}
