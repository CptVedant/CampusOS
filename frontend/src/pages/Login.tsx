import type { ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { GraduationCap } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, demoAccounts, useMocks } from '../services';
import type { Auth } from '../types';
import { ErrorText } from '../ui';

const schema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});
type Fields = z.infer<typeof schema>;

export default function Login({
  onLogin,
  themeButton,
  expired,
}: {
  onLogin: (auth: Auth) => void;
  themeButton: ReactNode;
  expired: boolean;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Fields>({ resolver: zodResolver(schema) });
  const login = useMutation({
    mutationFn: ({ email, password }: Fields) => api.login(email, password),
    onSuccess: onLogin,
  });
  return (
    <main className="login">
      <div className="login-header">
        <span className="brand">
          <span className="brand-icon">
            <GraduationCap size={22} />
          </span>
          CampusOS
        </span>
        {themeButton}
      </div>
      <div className="login-card card">
        <h1>Sign in</h1>
        <p>Access your CampusOS workspace.</p>
        {expired && (
          <p className="error" role="alert">
            Your session expired. Sign in again.
          </p>
        )}
        <form
          onSubmit={handleSubmit((values) => login.mutate(values))}
          noValidate
        >
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              aria-invalid={!!errors.email}
              {...register('email')}
            />
          </label>
          {errors.email && (
            <p className="error" role="alert">
              {errors.email.message}
            </p>
          )}
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              {...register('password')}
            />
          </label>
          {errors.password && (
            <p className="error" role="alert">
              {errors.password.message}
            </p>
          )}
          <ErrorText error={login.error} />
          <button className="primary" disabled={login.isPending}>
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        {useMocks && (
          <section className="demo-login">
            <span className="badge mock">Demo data</span>
            <p>Open a workspace with sample data.</p>
            <div className="inline">
              {Object.entries(demoAccounts).map(([role, email]) => (
                <button
                  disabled={login.isPending}
                  type="button"
                  key={role}
                  onClick={() => login.mutate({ email, password: 'demo1234' })}
                >
                  {role}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
