import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';

export function Result<T>({
  query,
  children,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending)
    return (
      <div className="card skeleton" role="status">
        Loading…
      </div>
    );
  if (query.isError)
    return (
      <div className="card">
        <ErrorText error={query.error} />
        <button onClick={() => void query.refetch()}>Retry</button>
      </div>
    );
  return <>{children(query.data)}</>;
}
export function ErrorText({ error }: { error: Error | null }) {
  return error ? (
    <p className="error" role="alert">
      {error.message}
    </p>
  ) : null;
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="card empty">{children}</div>;
}
export function PageTitle({
  label,
  title,
  detail,
}: {
  label: string;
  title: string;
  detail?: string;
}) {
  return (
    <div className="page-title">
      <span className="eyebrow">{label}</span>
      <h1>{title}</h1>
      {detail && <p>{detail}</p>}
    </div>
  );
}
