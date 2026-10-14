import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { AuthOptions } from '@slc/shared';

import { ApiClientError, authApi } from '../lib/api';
import { useAuth } from '../auth/AuthContext';

/** Messages for `?error=<code>` set by the API after a failed SSO sign-in. */
const SSO_ERROR_MESSAGES: Record<string, string> = {
  sso_failed: 'Sign-in could not be completed. Please try again.',
  sso_no_access:
    'Your SLC account does not have access to Central Admin. Ask a Super Admin to grant you a role.',
  sso_account_disabled: 'This administrator account is disabled.',
  sso_email_missing: 'Your SLC account has no email address. Ask a Super Admin to add one.',
  sso_email_unverified: 'Your SLC account email must be verified before it can be linked.',
  sso_email_conflict: 'This email is already linked to a different SLC account. Contact a Super Admin.',
};

export function Login() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [searchParams] = useSearchParams();
  const returnTo = location.state?.from ?? '/';

  const [options, setOptions] = useState<AuthOptions | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [needOtp, setNeedOtp] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    const code = searchParams.get('error');
    return code ? (SSO_ERROR_MESSAGES[code] ?? SSO_ERROR_MESSAGES.sso_failed) : null;
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    authApi
      .options()
      .then((value) => {
        if (!cancelled) setOptions(value);
      })
      .catch(() => {
        // Older API without /auth/config: fall back to the password form.
        if (!cancelled) setOptions({ passwordLoginEnabled: true, ssoEnabled: false, ssoProviderName: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'authenticated') {
    return <Navigate to={returnTo} replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password, needOtp ? otp.trim() : undefined);
      navigate(returnTo, { replace: true });
    } catch (err) {
      // Generic messaging (avoid revealing which factor failed / enumeration).
      if (err instanceof ApiClientError && err.status === 429) {
        setError('Too many attempts. Please wait and try again.');
      } else if (err instanceof ApiClientError && err.code === 'MFA_REQUIRED') {
        setNeedOtp(true);
        setError(null);
      } else if (err instanceof ApiClientError && err.code === 'INVALID_CODE') {
        setOtp('');
        setError('That code is not valid. Wait for the next code and try again.');
      } else if (err instanceof ApiClientError && err.code === 'MFA_SETUP_REQUIRED') {
        setError(err.message);
      } else {
        setNeedOtp(false);
        setOtp('');
        setError('Invalid email or password.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const showSso = options?.ssoEnabled ?? false;
  const showPassword = options?.passwordLoginEnabled ?? false;

  return (
    <div className="login">
      <div className="login__card" aria-labelledby="login-title">
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

        {!options && <p className="muted">Loading sign-in options…</p>}

        {showSso && (
          <a className="btn btn--block" href={authApi.ssoLoginUrl(returnTo)}>
            Sign in with {options?.ssoProviderName ?? 'SSO'}
          </a>
        )}

        {showSso && showPassword && (
          <div className="login__divider" role="separator">
            <span>backup sign-in, for break-glass accounts only</span>
          </div>
        )}

        {showPassword && (
          <form className="login__form" onSubmit={onSubmit}>
            <label className="field">
              <span className="field__label">Email</span>
              <input
                className="field__input"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus={!showSso}
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

            {needOtp && (
              <div className="field">
                <label className="field__label" htmlFor="login-otp">Authenticator code</label>
                <input
                  id="login-otp"
                  className="field__input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  aria-describedby="login-otp-hint"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  required
                  autoFocus
                />
                <span id="login-otp-hint" className="muted">Enter the 6-digit code from your authenticator app.</span>
              </div>
            )}

            <button
              className={showSso ? 'btn btn--ghost btn--block' : 'btn btn--block'}
              type="submit"
              disabled={submitting}
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
