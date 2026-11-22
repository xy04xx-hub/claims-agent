import { useEffect, useState } from 'react';
import { Api, ApiError, type ClaimView } from './api';

export function AdjusterScreen({ api }: { api: Api }) {
  const [queue, setQueue] = useState<ClaimView[]>([]);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = () => api.queue().then(setQueue).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [api]);

  async function resolve(c: ClaimView, decision: 'APPROVE' | 'REJECT') {
    setError(undefined);
    try {
      await api.resolve(c.claimId, decision, decision === 'APPROVE' ? 'VERIFIED_OK' : 'OTHER',
        decision === 'APPROVE' ? 'Checked evidence against the policy.' : 'Rejected by adjuster.');
      setNotice(`${c.claimId}: ${decision === 'APPROVE' ? 'approved' : 'rejected'}.`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setNotice(`${c.claimId} was already resolved.`);
      else setError((e as Error).message);
    }
    await load();
  }

  async function open(c: ClaimView, evidenceId: string) {
    try {
      window.open(await api.evidenceUrl(c.claimId, evidenceId), '_blank', 'noopener');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <h2>Review queue</h2>
      <button className="secondary" onClick={() => void load()}>Refresh</button>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="ok" role="status">{notice}</p>}
      {queue.length === 0 && <p>No claims waiting for review.</p>}
      {queue.map((c) => (
        <section key={c.claimId} className="card" data-testid="queue-item">
          <strong>{c.claimId}</strong> {c.cause?.replace(/_/g, ' ').toLowerCase()} on {c.itemId}, amount {c.amountClaimed}
          <br /><small>Filed {c.createdAt?.slice(0, 16).replace('T', ' ')}</small>
          <ul>{(c.routedReasons ?? []).map((r) => <li key={r}>{r}</li>)}</ul>
          <p>
            {(c.evidenceIds ?? []).map((e) => (
              <button key={e} className="link" onClick={() => void open(c, e)}>Evidence {e.slice(0, 12)}</button>
            ))}
          </p>
          <button onClick={() => void resolve(c, 'APPROVE')}>Approve</button>{' '}
          <button className="danger" onClick={() => void resolve(c, 'REJECT')}>Reject</button>
        </section>
      ))}
    </>
  );
}
