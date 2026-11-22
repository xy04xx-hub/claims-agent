// Cognito hosted UI sign-in: authorization code with PKCE. Tokens live in memory only (never localStorage).
// Only the one-time PKCE verifier and state are kept in sessionStorage during the redirect.
const REDIRECT = `${window.location.origin}/`;
const b64url = (buf: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (): string => b64url(crypto.getRandomValues(new Uint8Array(32)));

export interface Session {
  accessToken: string;
  username: string;
  groups: string[];
  expiresAt: number;
}

function decode(token: string): Record<string, unknown> {
  const part = token.split('.')[1] ?? '';
  return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
}

export async function startLogin(): Promise<void> {
  const verifier = random();
  const state = random();
  sessionStorage.setItem('pkce_verifier', verifier);
  sessionStorage.setItem('pkce_state', state);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: __CLIENT_ID__,
    redirect_uri: REDIRECT,
    scope: 'openid email',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  window.location.assign(`https://${__COGNITO_DOMAIN__}/oauth2/authorize?${q}`);
}

/** Exchanges ?code= for tokens when the page is the redirect target. Returns undefined when there is no code. */
export async function finishLogin(): Promise<Session | undefined> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) return undefined;
  const verifier = sessionStorage.getItem('pkce_verifier');
  const state = sessionStorage.getItem('pkce_state');
  sessionStorage.removeItem('pkce_verifier');
  sessionStorage.removeItem('pkce_state');
  window.history.replaceState({}, '', REDIRECT);
  if (!verifier || params.get('state') !== state) throw new Error('Sign-in state mismatch. Please sign in again.');
  const res = await fetch(`https://${__COGNITO_DOMAIN__}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: __CLIENT_ID__,
      code,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`Sign-in failed (${res.status}).`);
  const tokens = (await res.json()) as { access_token: string };
  const claims = decode(tokens.access_token);
  return {
    accessToken: tokens.access_token,
    username: String(claims.username ?? ''),
    groups: Array.isArray(claims['cognito:groups']) ? (claims['cognito:groups'] as string[]) : [],
    expiresAt: Number(claims.exp ?? 0) * 1000,
  };
}

export function logout(): void {
  const q = new URLSearchParams({ client_id: __CLIENT_ID__, logout_uri: REDIRECT });
  window.location.assign(`https://${__COGNITO_DOMAIN__}/logout?${q}`);
}
