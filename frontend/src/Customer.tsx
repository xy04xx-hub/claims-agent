import { useEffect, useState, type FormEvent } from 'react';
import { Api, type ClaimView, type PolicyInfo } from './api';

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const pretty = (s: string) => s.replace(/_/g, ' ').toLowerCase();

export function CustomerScreen({ api }: { api: Api }) {
  const [policies, setPolicies] = useState<PolicyInfo[]>([]);
  const [claims, setClaims] = useState<ClaimView[]>([]);
  const [tracked, setTracked] = useState<string>();
  const [error, setError] = useState<string>();

  const refresh = () => api.myClaims().then(setClaims).catch(() => undefined);
  useEffect(() => {
    api.policies().then(setPolicies).catch((e: Error) => setError(e.message));
    void refresh();
  }, [api]);

  return (
    <>
      <h2>My policies</h2>
      {error && <p className="error" role="alert">{error}</p>}
      {policies.map((p) => (
        <section key={p.policyId} className="card">
          <strong>{p.policyId}</strong> (version {p.version})
          <ul>
            {p.items.map((i) => (
              <li key={i.itemId}>{i.label} <small>({i.category}; covered: {i.causes.map((c) => pretty(c.cause)).join(', ')})</small></li>
            ))}
          </ul>
        </section>
      ))}
      <h2>File a claim</h2>
      <ClaimForm api={api} policies={policies} onFiled={(id) => { setTracked(id); void refresh(); }} />
      {tracked && <ClaimStatus api={api} claimId={tracked} onFinal={() => void refresh()} />}
      <h2>My claims</h2>
      <table>
        <thead><tr><th>Claim</th><th>Status</th><th>Amount</th><th>Filed</th></tr></thead>
        <tbody>
          {claims.map((c) => (
            <tr key={c.claimId}>
              <td><button className="link" onClick={() => setTracked(c.claimId)}>{c.claimId}</button></td>
              <td>{c.status}</td><td>{c.amountClaimed}</td><td>{c.createdAt?.slice(0, 16).replace('T', ' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function ClaimForm({ api, policies, onFiled }: { api: Api; policies: PolicyInfo[]; onFiled: (id: string) => void }) {
  const items = policies.flatMap((p) => p.items.map((i) => ({ policyId: p.policyId, ...i })));
  const [itemId, setItemId] = useState('');
  const [cause, setCause] = useState('');
  const [amount, setAmount] = useState('');
  const [lossDate, setLossDate] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const item = items.find((i) => i.itemId === itemId) ?? items[0];
  const causeInfo = item?.causes.find((c) => c.cause === cause) ?? item?.causes[0];
  const evidence = causeInfo?.requiredEvidence[0];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (!item || !causeInfo || !evidence) return;
    if (!file) return setError('Please choose the evidence file.');
    if (!TYPES.includes(file.type)) return setError('Evidence must be a JPEG, PNG or PDF.');
    if (file.size > MAX_BYTES) return setError('Evidence must be 5 MB or smaller.');
    setBusy(true);
    try {
      const evidenceId = await api.uploadEvidence(file, evidence.kind);
      const claimId = await api.createClaim({
        policyId: item.policyId, itemId: item.itemId, cause: causeInfo.cause, description,
        amountClaimed: Number(amount), lossDate, evidenceIds: [evidenceId],
      });
      onFiled(claimId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={(e) => void submit(e)}>
      <label>Item
        <select name="item" value={item?.itemId ?? ''} onChange={(e) => { setItemId(e.target.value); setCause(''); }}>
          {items.map((i) => <option key={i.itemId} value={i.itemId}>{i.label}</option>)}
        </select>
      </label>
      <label>What happened (cause)
        <select name="cause" value={causeInfo?.cause ?? ''} onChange={(e) => setCause(e.target.value)}>
          {item?.causes.map((c) => <option key={c.cause} value={c.cause}>{pretty(c.cause)}</option>)}
        </select>
      </label>
      <label>Amount claimed
        <input name="amount" type="number" min="1" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label>Loss date
        <input name="lossDate" type="date" required value={lossDate} onChange={(e) => setLossDate(e.target.value)} />
      </label>
      <label>Description ({description.length}/1000)
        <textarea name="description" maxLength={1000} required value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      {evidence && (
        <label>Evidence: {evidence.description}
          <input name="file" type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setFile(e.target.files?.[0])} />
        </label>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" disabled={busy || !item}>{busy ? 'Submitting...' : 'Submit claim'}</button>
    </form>
  );
}

function ClaimStatus({ api, claimId, onFinal }: { api: Api; claimId: string; onFinal: () => void }) {
  const [view, setView] = useState<ClaimView>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let stop = false;
    const t0 = Date.now();
    setView(undefined);
    (async () => {
      while (!stop) {
        try {
          const v = await api.claim(claimId);
          if (stop) return;
          setView(v);
          if (v.status !== 'PROCESSING') return onFinal();
        } catch (e) {
          setError((e as Error).message);
          return;
        }
        // 500 ms for the first 10 s, then 2 s
        await new Promise((r) => setTimeout(r, Date.now() - t0 < 10_000 ? 500 : 2_000));
      }
    })();
    return () => { stop = true; };
  }, [api, claimId]);

  return (
    <section className="card" data-testid="claim-status">
      <h3>Claim {claimId}</h3>
      {error && <p className="error">{error}</p>}
      {!view || view.status === 'PROCESSING' ? (
        <p>Checking your claim against your policy and evidence...</p>
      ) : (
        <>
          <p className={view.status === 'AUTO_APPROVED' ? 'ok' : 'review'}>
            <strong>{view.status === 'AUTO_APPROVED' ? 'Approved' : view.status === 'ROUTED_TO_ADJUSTER' ? 'Needs review' : view.status}</strong>
            {view.status === "AUTO_APPROVED" && view.payout !== undefined && <> Payout: {view.payout.toFixed(2)}</>}
          </p>
          {view.customerMessage && <p>{view.customerMessage}</p>}
          {view.checksPassed && view.checksPassed.length > 0 && (
            <ul>{view.checksPassed.map((c) => <li key={c}>Passed: {pretty(c)}</li>)}</ul>
          )}
        </>
      )}
    </section>
  );
}
