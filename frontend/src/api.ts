// Typed API client. Sends the Cognito access token as a Bearer token. Shapes follow contracts/api.
export interface RequiredEvidence { kind: string; description: string }
export interface CauseInfo { cause: string; requiredEvidence: RequiredEvidence[] }
export interface ItemInfo { itemId: string; category: string; label: string; causes: CauseInfo[] }
export interface PolicyInfo { policyId: string; version: number; items: ItemInfo[] }
export interface ClaimView {
  claimId: string;
  status: string;
  policyId?: string;
  itemId?: string;
  cause?: string;
  amountClaimed?: number;
  lossDate?: string;
  createdAt?: string;
  decidedAt?: string;
  payout?: number;
  checksPassed?: string[];
  customerMessage?: string;
  evidenceIds?: string[];
  routedReasons?: string[];
}
interface Upload { evidenceId: string; url: string; fields: Record<string, string> }

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class Api {
  constructor(private token: string) {}

  private async call<T>(method: 'GET' | 'POST', route: string, body?: unknown): Promise<T> {
    const res = await fetch(`${__API_URL__}${route}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) throw new ApiError(res.status, String(json.message ?? `Request failed (${res.status})`));
    return json as T;
  }

  policies = async (): Promise<PolicyInfo[]> => (await this.call<{ policies: PolicyInfo[] }>('GET', '/me/policies')).policies;
  myClaims = async (): Promise<ClaimView[]> => (await this.call<{ items: ClaimView[] }>('GET', '/claims')).items;
  claim = (id: string): Promise<ClaimView> => this.call('GET', `/claims/${encodeURIComponent(id)}`);
  queue = async (): Promise<ClaimView[]> => (await this.call<{ items: ClaimView[] }>('GET', '/queue')).items;
  evidenceUrl = async (claimId: string, evidenceId: string): Promise<string> =>
    (await this.call<{ url: string }>('GET', `/claims/${encodeURIComponent(claimId)}/evidence/${encodeURIComponent(evidenceId)}`)).url;
  resolve = (claimId: string, decision: 'APPROVE' | 'REJECT', reasonCode: string, note: string) =>
    this.call<{ claimId: string; status: string }>('POST', `/claims/${encodeURIComponent(claimId)}/resolution`, { decision, reasonCode, note });

  /** Presigned POST: the form fields go first and the file last. The file never passes through the API. */
  async uploadEvidence(file: File, kind: string): Promise<string> {
    const r = await this.call<{ uploads: Upload[] }>('POST', '/evidence/uploads', {
      files: [{ name: file.name, contentType: file.type, sizeBytes: file.size, kind }],
    });
    const up = r.uploads[0];
    if (!up) throw new ApiError(500, 'No upload URL returned.');
    const form = new FormData();
    for (const [k, v] of Object.entries(up.fields)) form.append(k, v); // includes x-amz-meta-kind
    form.append('file', file, file.name);
    const put = await fetch(up.url, { method: 'POST', body: form });
    if (!put.ok) throw new ApiError(put.status, `Upload failed (${put.status}).`);
    return up.evidenceId;
  }

  async createClaim(body: {
    policyId: string; itemId: string; cause: string; description: string;
    amountClaimed: number; lossDate: string; evidenceIds: string[];
  }): Promise<string> {
    const r = await this.call<{ claimId: string }>('POST', '/claims', { clientRequestId: crypto.randomUUID(), ...body });
    return r.claimId;
  }
}
