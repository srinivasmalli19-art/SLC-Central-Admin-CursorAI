import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { ApiClientError } from '../lib/api';
import { useAuth } from '../auth/AuthContext';

export function Login() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') {
    return <Navigate to={location.state?.from ?? '/'} replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate(location.state?.from ?? '/', { replace: true });
    } catch (err) {
      // Generic messaging (avoid revealing which factor failed / enumeration).
      if (err instanceof ApiClientError && err.status === 429) {
        setError('Too many attempts. Please wait and try again.');
      } else {
        setError('Invalid email or password.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={onSubmit} aria-labelledby="login-title">
        <div className="login__brand">
          <span className="sidebar__logo" aria-hidden="true">
            SLC
          </span>
          <div>
            <h1 id="login-title" className="login__title">
              Central Admin
            </h1>
            <p className="muted login__subtitle">Administrator sign in</p>
          </div>
        </div>

        {error && (
          <div className="login__error" role="alert">
            {error}
          </div>
        )}

        <label className="field">
          <span className="field__label">Email</span>
          <input
            className="field__input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </label>

        <label className="field">
          <span className="field__label">Password</span>
          <input
            className="field__input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        <button className="btn btn--block" type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
