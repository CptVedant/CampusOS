import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, materialsApi } from '../services';
import type { Material, Role } from '../types';
import { Empty, ErrorText, PageTitle, Result } from '../ui';

function MaterialForm({
  courseId,
  item,
  refresh,
}: {
  courseId: string;
  item?: Material;
  refresh: () => Promise<void>;
}) {
  const save = useMutation({
    mutationFn: (form: FormData) =>
      item
        ? materialsApi.update(item.id, {
            title: String(form.get('title')).trim(),
            description: String(form.get('description')).trim() || null,
          })
        : materialsApi.upload(form),
    onSuccess: refresh,
  });
  return (
    <form
      className="card form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        save.mutate(new FormData(form), {
          onSuccess: () => { if (!item) form.reset(); },
        });
      }}
    >
      {!item && <input type="hidden" name="courseId" value={courseId} />}
      <label>
        Title
        <input name="title" defaultValue={item?.title} required maxLength={200} />
      </label>
      <label>
        Description
        <input name="description" defaultValue={item?.description ?? ''} maxLength={1000} />
      </label>
      {!item && (
        <label>
          File
          <input name="file" type="file" required accept=".pdf,.docx,.png,.jpg,.jpeg,.zip" />
        </label>
      )}
      <ErrorText error={save.error} />
      {save.isSuccess && <p role="status">Material saved.</p>}
      <button className="primary" disabled={save.isPending}>
        {save.isPending ? 'Saving…' : item ? 'Save changes' : 'Upload material'}
      </button>
    </form>
  );
}

function CourseMaterials({ courseId, staff }: { courseId: string; staff: boolean }) {
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<string | null>(null);
  const queryKey = ['materials', courseId];
  const list = useQuery({
    queryKey: [...queryKey, page],
    queryFn: () => materialsApi.list(courseId, page),
  });
  const refresh = () => client.invalidateQueries({ queryKey });
  const remove = useMutation({ mutationFn: materialsApi.remove, onSuccess: refresh });
  const download = useMutation({
    mutationFn: async (item: Material) => {
      const blob = await materialsApi.download(item.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = item.original_filename ?? 'material';
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });

  return (
    <>
      {staff && <MaterialForm courseId={courseId} refresh={refresh} />}
      <ErrorText error={download.error ?? remove.error} />
      <Result query={list}>
        {({ items, hasNext }) => (
          <>
            {items.length ? (
              <ul className="card list">
                {items.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.title}</strong>
                      {item.description && <p>{item.description}</p>}
                      {item.original_filename && <small>{item.original_filename}</small>}
                    </div>
                    <div className="inline">
                      <button disabled={download.isPending} onClick={() => download.mutate(item)}>
                        {download.isPending && download.variables?.id === item.id ? 'Downloading…' : 'Download'}
                      </button>
                      {staff && (
                        <>
                          <button onClick={() => setEditing(editing === item.id ? null : item.id)}>
                            {editing === item.id ? 'Close editor' : 'Edit'}
                          </button>
                          <button disabled={remove.isPending} onClick={() => {
                            if (window.confirm('Delete this material?')) remove.mutate(item.id);
                          }}>
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                    {staff && editing === item.id && (
                      <MaterialForm courseId={courseId} item={item} refresh={refresh} />
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No materials on this page.</Empty>
            )}
            {(page > 1 || hasNext) && (
              <div className="inline">
                <button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
                <span>Page {page}</span>
                <button disabled={!hasNext} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            )}
          </>
        )}
      </Result>
    </>
  );
}

export default function Materials({ role }: { role: Role }) {
  const [selected, setSelected] = useState('');
  const courses = useQuery({
    queryKey: ['material-courses', role],
    queryFn: () => api.courses(role === 'student'),
  });
  return (
    <>
      <PageTitle label="Courses" title="Course materials" />
      <Result query={courses}>
        {(items) => {
          const courseId = items.find(({ id }) => id === selected)?.id ?? items[0]?.id;
          if (!courseId) return <Empty>No courses available.</Empty>;
          return (
            <>
              <label>
                Course
                <select value={courseId} onChange={(event) => setSelected(event.target.value)}>
                  {items.map(({ id, course_code, title }) => (
                    <option key={id} value={id}>{course_code} · {title}</option>
                  ))}
                </select>
              </label>
              <CourseMaterials key={courseId} courseId={courseId} staff={role !== 'student'} />
            </>
          );
        }}
      </Result>
    </>
  );
}
