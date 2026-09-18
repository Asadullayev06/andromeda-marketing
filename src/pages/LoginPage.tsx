import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Rocket } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { useLang } from '../i18n';

export default function LoginPage() {
  const { signIn } = useAuth();
  const { t } = useLang();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await signIn(username.trim(), password);
      nav('/', { replace: true });
    } catch {
      setError(t('login.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="logo-lg"><Rocket size={30} /></div>
        <h1>{t('login.title')}</h1>
        <p className="login-sub">{t('login.sub')}</p>

        <label className="form-label" htmlFor="u">{t('login.username')}</label>
        <input id="u" className="form-input" autoFocus autoComplete="username"
          value={username} onChange={(e) => setUsername(e.target.value)} />

        <label className="form-label" htmlFor="p">{t('login.password')}</label>
        <input id="p" className="form-input" type="password" autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} />

        {error && <div className="login-error">{error}</div>}

        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? '…' : t('login.submit')}
        </button>
      </form>
    </div>
  );
}
