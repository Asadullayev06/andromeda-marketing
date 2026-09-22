import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="u">{t('login.username')}</FieldLabel>
            <Input id="u" autoFocus autoComplete="username"
              value={username} onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="p">{t('login.password')}</FieldLabel>
            <Input id="p" type="password" autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        </FieldGroup>

        <Button variant="default" className="mt-5 w-full" type="submit" disabled={busy}>
          {busy ? '…' : t('login.submit')}
        </Button>
      </form>
    </div>
  );
}
