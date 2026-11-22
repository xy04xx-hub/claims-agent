import { useEffect, useMemo, useRef, useState } from 'react';
import { Api } from './api';
import { finishLogin, logout, startLogin, type Session } from './auth';
import { CustomerScreen } from './Customer';
import { AdjusterScreen } from './Adjuster';

export function App() {
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState<string>();
  const [ready, setReady] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice; the code can be used once
    started.current = true;
    finishLogin()
      .then(setSession)
      .catch((e: Error) => setError(e.message))
      .finally(() => setReady(true));
  }, []);

  const api = useMemo(() => (session ? new Api(session.accessToken) : undefined), [session]);

  if (!ready) return <main><p>Loading...</p></main>;
  if (!session || !api) {
    return (
      <main>
        <h1>Instant Claims</h1>
        <p>Small, clean claims are paid in seconds. Everything else goes to a person.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <button onClick={() => void startLogin()}>Sign in</button>
      </main>
    );
  }
  const isAdjuster = session.groups.includes('Adjuster');
  const isCustomer = session.groups.includes('Customer');
  return (
    <>
      <header>
        <strong>Instant Claims</strong>
        <span>{session.username} ({session.groups.join(', ') || 'no role'})</span>
        <button className="secondary" onClick={logout}>Sign out</button>
      </header>
      <main>
        {isAdjuster ? <AdjusterScreen api={api} /> : isCustomer ? <CustomerScreen api={api} /> : <p className="error">Your account has no role.</p>}
      </main>
    </>
  );
}
