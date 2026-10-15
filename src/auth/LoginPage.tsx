import { useState, type FormEvent } from 'react';
import { AlertCircle, Eye, EyeOff, Factory, Lock, Mail } from 'lucide-react';
import { useAccess, type Role } from './access';
import { DEMO_USERS } from './users';

export function LoginPage() {
  const { login } = useAccess();
  const first = DEMO_USERS[0];
  const [role, setRole] = useState<Role>(first.role);
  const [email, setEmail] = useState(first.email);
  const [password, setPassword] = useState(first.password);
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const pick = (r: Role) => {
    const u = DEMO_USERS.find((x) => x.role === r)!;
    setRole(r);
    setEmail(u.email);
    setPassword(u.password);
    setError('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    const problem = await login(email, password);
    if (problem) {
      setBusy(false);
      setError(problem);
    }
  };

  const cur = DEMO_USERS.find((u) => u.role === role)!;

  return (
    <div className="login-page">
      <div className="login-card">
        <section className="login-brand" aria-hidden="true">
          <div className="login-dots" />
          <div className="login-brand-in">
            <div className="login-logo">
              <Factory size={30} />
            </div>
            <h1>ForgeFlow ERP</h1>
            <p>SECURE ACCESS</p>
            <span className="login-bar" />
            <small>Forging &amp; casting production — raw material to dispatch</small>
          </div>
        </section>

        <section className="login-form">
          <div className="login-form-in">
            <h2>Sign in</h2>
            <p className="login-sub">Login with demo credentials.</p>

            <div className="login-tabs" role="tablist" aria-label="Sign in as">
              {DEMO_USERS.map((u) => (
                <button key={u.role} type="button" role="tab" aria-selected={role === u.role} className={role === u.role ? 'on' : ''} onClick={() => pick(u.role)}>
                  {u.tab}
                </button>
              ))}
            </div>

            <form onSubmit={submit} noValidate>
              <label className="login-label" htmlFor="login-email">
                Email
              </label>
              <div className="login-input">
                <Mail size={16} />
                <input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
              </div>

              <label className="login-label" htmlFor="login-password">
                Password
              </label>
              <div className="login-input">
                <Lock size={16} />
                <input id="login-password" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
                <button type="button" className="login-eye" onClick={() => setShow((s) => !s)} tabIndex={-1} aria-label={show ? 'Hide password' : 'Show password'}>
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              {error && (
                <div className="login-error" role="alert">
                  <AlertCircle size={16} /> {error}
                </div>
              )}

              <button type="submit" className="login-submit" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign In'}
              </button>
            </form>

            <div className="login-demo">
              <p className="login-demo-t">Demo credentials ({cur.name})</p>
              <p>
                Email: <b>{cur.email}</b>
              </p>
              <p>
                Password: <b>{cur.password}</b>
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
