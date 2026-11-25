import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText } from 'lucide-react';
import { demoSections } from '../services';
import { MIN_STUDENTS_FOR_STATS } from '../attendance';
import type { Role } from '../types';
import { ErrorText, PageTitle, Result } from '../ui';

const MAX_UPLOAD = 50 * 1024 * 1024;

function Materials({ teacher }: { teacher: boolean }) {
  const query = useQuery({
    queryKey: ['demo', 'materials'],
    queryFn: demoSections.materials,
  });
  const [uploads, setUploads] = useState<File[]>([]);
  const [error, setError] = useState<Error | null>(null);
  function download(content: Blob, name: string) {
    const url = URL.createObjectURL(content);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      {teacher && (
        <section className="card">
          <h2>Add a sample file</h2>
          <label>
            Choose file (up to 50 MB)
            <input
              type="file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setError(
                  file.size > MAX_UPLOAD
                    ? new Error('Choose a file of 50 MB or less.')
                    : null,
                );
                if (file.size <= MAX_UPLOAD) setUploads([...uploads, file]);
                e.target.value = '';
              }}
            />
          </label>
          <ErrorText error={error} />
        </section>
      )}
      <Result query={query}>
        {(files) => (
          <section className="card">
            <ul className="rows">
              {files.map((file) => (
                <li key={file.filename}>
                  <span>
                    <strong>
                      <FileText size={16} /> {file.title}
                    </strong>
                    <small>
                      {file.course} · {file.filename}
                    </small>
                  </span>
                  <button
                    onClick={() =>
                      download(
                        new Blob([file.content], { type: 'text/plain' }),
                        file.filename,
                      )
                    }
                  >
                    <Download size={16} /> Download
                  </button>
                </li>
              ))}
              {uploads.map((file, index) => (
                <li key={file.name + index}>
                  <span>
                    <strong>{file.name}</strong>
                    <small>Local demo file</small>
                  </span>
                  <button onClick={() => download(file, file.name)}>
                    <Download size={16} /> Download
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </Result>
    </>
  );
}
function Marks({ teacher }: { teacher: boolean }) {
  const query = useQuery({
    queryKey: ['demo', 'marks'],
    queryFn: demoSections.marks,
  });
  const [added, setAdded] = useState<
    {
      title: string;
      course: string;
      score: number;
      max: number;
      feedback: string;
    }[]
  >([]);
  const [scores, setScores] = useState<Record<number, string>>({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const scoreInputs = useRef<(HTMLInputElement | null)[]>([]);
  return (
    <Result query={query}>
      {(fixtures) => {
        const items = [...fixtures, ...added];
        return (
          <>
            {teacher && (
              <form
                className="card form-stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const fields = new FormData(form);
                  const title = String(fields.get('title')).trim();
                  const course = String(fields.get('course')).trim();
                  const max = Number(fields.get('max'));
                  if (!title || !course || !Number.isFinite(max) || max <= 0)
                    return;
                  setAdded([
                    ...added,
                    { title, course, max, score: 0, feedback: '' },
                  ]);
                  setSaved(false);
                  form.reset();
                }}
              >
                <h2>Create sample assessment</h2>
                <label>
                  Title
                  <input name="title" required maxLength={120} />
                </label>
                <label>
                  Course code
                  <input name="course" required maxLength={32} />
                </label>
                <label>
                  Maximum marks
                  <input name="max" type="number" min={1} required />
                </label>
                <div>
                  <button className="primary">Create assessment</button>
                </div>
              </form>
            )}
            <form
              className="card table-wrap"
              onSubmit={(event) => {
                event.preventDefault();
                setError(null);
                setSaved(true);
              }}
            >
              <table>
                <thead>
                  <tr>
                    <th>Assessment</th>
                    <th>Course</th>
                    <th>Score</th>
                    <th>Feedback</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={index}>
                      <td>{item.title}</td>
                      <td>{item.course}</td>
                      <td>
                        {teacher ? (
                          <input
                            className="score"
                            type="number"
                            min={0}
                            max={item.max}
                            step="any"
                            required
                            ref={(element) => {
                              scoreInputs.current[index] = element;
                            }}
                            aria-label={item.title + ' score'}
                            value={scores[index] ?? item.score}
                            onChange={(event) => {
                              setScores({
                                ...scores,
                                [index]: event.target.value,
                              });
                              setSaved(false);
                              setError(null);
                            }}
                            onKeyDown={(event) => {
                              if (
                                event.key !== 'ArrowDown' &&
                                event.key !== 'ArrowUp'
                              )
                                return;
                              const next =
                                scoreInputs.current[
                                  index + (event.key === 'ArrowDown' ? 1 : -1)
                                ];
                              if (next) {
                                event.preventDefault();
                                next.focus();
                              }
                            }}
                            onPaste={(event) => {
                              const raw = event.clipboardData
                                .getData('text')
                                .trim();
                              const values = raw.split(/[\t\r\n]+/);
                              if (values.length < 2) return;
                              event.preventDefault();
                              const rows = items.slice(
                                index,
                                index + values.length,
                              );
                              if (
                                rows.length !== values.length ||
                                values.some(
                                  (value, offset) =>
                                    !value.trim() ||
                                    !Number.isFinite(Number(value)) ||
                                    Number(value) < 0 ||
                                    Number(value) > rows[offset].max,
                                )
                              ) {
                                setError(
                                  new Error(
                                    'Paste one valid score per remaining assessment.',
                                  ),
                                );
                                return;
                              }
                              setScores({
                                ...scores,
                                ...Object.fromEntries(
                                  values.map((value, offset) => [
                                    index + offset,
                                    String(Number(value)),
                                  ]),
                                ),
                              });
                              setSaved(false);
                              setError(null);
                            }}
                          />
                        ) : (
                          item.score
                        )}{' '}
                        / {item.max}
                      </td>
                      <td>{item.feedback || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ErrorText error={error} />
              {teacher && (
                <button className="primary">Save sample marks</button>
              )}
              {saved && <p role="status">Sample marks saved for this view.</p>}
            </form>
            <p className="quiet">
              Class statistics appear after at least {MIN_STUDENTS_FOR_STATS}{' '}
              students have graded marks.
            </p>
          </>
        );
      }}
    </Result>
  );
}
function Users() {
  const query = useQuery({
    queryKey: ['demo', 'users'],
    queryFn: demoSections.users,
  });
  return (
    <Result query={query}>
      {(users) => (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Sample ID</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.full_name}</td>
                  <td>{user.email}</td>
                  <td>{user.role}</td>
                  <td>{user.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Result>
  );
}
export default function Demo({
  type,
  role,
}: {
  type: 'materials' | 'marks' | 'users';
  role: Role;
}) {
  const title = {
    materials: 'Course materials',
    marks: 'Marks',
    users: 'Users',
  }[type];
  return (
    <>
      <PageTitle label={role + ' workspace'} title={title} />
      <p className="banner">
        <span className="badge mock">Demo data</span> This screen uses sample
        data. Changes stay in this view.
      </p>
      {type === 'materials' ? (
        <Materials teacher={role === 'teacher'} />
      ) : type === 'marks' ? (
        <Marks teacher={role === 'teacher'} />
      ) : (
        <Users />
      )}
    </>
  );
}
