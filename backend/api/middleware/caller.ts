// Owner: B (muzair110)
// Builds the Caller from the verified JWT claims only (pipeline steps 2 to 6).
import { parseGroups } from './groups.js';
import { SUB_MAX_LENGTH, TENANT_PATTERN } from './limits.js';
import type { Caller } from './types.js';
import type { Group } from '../routes.js';

export type CallerResult =
  | { ok: true; caller: Caller }
  | { ok: false; status: 401 | 403; code: 'UNAUTHORIZED' | 'FORBIDDEN'; message: string };

const NO_CLAIMS = 'Authentication is required';
const NOT_ACCESS = 'An access token is required';
const DENIED = 'Access denied';

const unauthorized = (message: string): CallerResult => ({
  ok: false,
  status: 401,
  code: 'UNAUTHORIZED',
  message,
});
const forbidden = (): CallerResult => ({ ok: false, status: 403, code: 'FORBIDDEN', message: DENIED });

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function readCaller(claims: unknown): CallerResult {
  if (!isRecord(claims)) return unauthorized(NO_CLAIMS);
  if (claims['token_use'] !== 'access') return unauthorized(NOT_ACCESS);

  const sub = claims['sub'];
  if (typeof sub !== 'string' || sub.length < 1 || sub.length > SUB_MAX_LENGTH) return forbidden();

  const tenantId = claims['tenantId'];
  if (typeof tenantId !== 'string' || !TENANT_PATTERN.test(tenantId)) return forbidden();

  const recognized = parseGroups(claims['cognito:groups']).filter(
    (g): g is Group => g === 'Customer' || g === 'Adjuster',
  );
  const unique = [...new Set(recognized)];
  if (unique.length !== 1 || unique[0] === undefined) return forbidden();

  return { ok: true, caller: { sub, group: unique[0], tenantId } };
}
