// Owner: B (muzair110)
// Pure constants for the Api stack. Imports nothing from aws-cdk-lib so tests and scripts can use it.
import { GROUP_NAMES, type GroupName } from './auth-model.js';

export type FunctionKey = 'api-customer' | 'api-adjuster';
export type HttpMethodName = 'GET' | 'POST';
export type RouteTicket = 'T-09' | 'T-10' | 'T-24';
export type RouteState = 'NOT_IMPLEMENTED';

export interface ApiRoute {
  /** `${method} ${path}` */
  readonly routeKey: string;
  readonly method: HttpMethodName;
  /** Starts with '/', may hold {claimId} and {evidenceId}. */
  readonly path: string;
  readonly function: FunctionKey;
  readonly groups: readonly GroupName[];
  readonly state: RouteState;
  readonly ticket: RouteTicket;
}

const { customer, adjuster } = GROUP_NAMES;

function route(
  method: HttpMethodName,
  path: string,
  fn: FunctionKey,
  groups: readonly GroupName[],
  ticket: RouteTicket,
): ApiRoute {
  return { routeKey: `${method} ${path}`, method, path, function: fn, groups, state: 'NOT_IMPLEMENTED', ticket };
}

/** The nine routes of architecture.md (section "API"). */
export const API_ROUTES: readonly ApiRoute[] = [
  route('GET', '/me/policies', 'api-customer', [customer], 'T-09'),
  route('POST', '/evidence/uploads', 'api-customer', [customer], 'T-09'),
  route('POST', '/claims', 'api-customer', [customer], 'T-09'),
  route('GET', '/claims', 'api-customer', [customer], 'T-09'),
  route('GET', '/claims/{claimId}', 'api-customer', [customer, adjuster], 'T-09'),
  route('GET', '/claims/{claimId}/evidence/{evidenceId}', 'api-customer', [customer, adjuster], 'T-10'),
  route('GET', '/queue', 'api-adjuster', [adjuster], 'T-10'),
  route('POST', '/claims/{claimId}/resolution', 'api-adjuster', [adjuster], 'T-10'),
  route('GET', '/impact', 'api-adjuster', [adjuster], 'T-24'),
];

/** Default route throttling of the `$default` stage. */
export const THROTTLE = { rateLimit: 20, burstLimit: 40 } as const;

export const FUNCTION_SETTINGS = { timeoutSeconds: 10, memorySize: 256 } as const;

export const INTEGRATION_TIMEOUT_SECONDS = 10;

/** Repo-relative entry files. */
export const FUNCTION_ENTRIES: Readonly<Record<FunctionKey, string>> = {
  'api-customer': 'backend/api/api-customer/index.ts',
  'api-adjuster': 'backend/api/api-adjuster/index.ts',
};

export const METRICS_NAMESPACE = 'ClaimsAgent';

export const ACCESS_LOG_RETENTION_DAYS = 14;

export const CORS = {
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type'],
  exposeHeaders: ['x-request-id'],
  maxAgeSeconds: 600,
  allowCredentials: false,
} as const;

/**
 * Field name to API Gateway variable. Exactly the eleven fields of the access log.
 * No source IP, claims, principal, header, query string, path or body.
 */
export const ACCESS_LOG_FIELDS: Readonly<Record<string, string>> = {
  requestId: '$context.requestId',
  requestTime: '$context.requestTime',
  httpMethod: '$context.httpMethod',
  routeKey: '$context.routeKey',
  status: '$context.status',
  responseLength: '$context.responseLength',
  responseLatency: '$context.responseLatency',
  integrationLatency: '$context.integrationLatency',
  integrationStatus: '$context.integrationStatus',
  errorMessage: '$context.error.message',
  authorizerError: '$context.authorizer.error',
};

export function accessLogFormat(): string {
  return JSON.stringify(ACCESS_LOG_FIELDS);
}

/**
 * JWT audience list: the console client, plus the verification client when it exists.
 * Under CDK the arguments are tokens, so two tokens give two entries.
 */
export function buildAudience(appClientId: string, verificationClientId: string | undefined): string[] {
  if (appClientId === '') {
    throw new Error('appClientId must not be empty');
  }
  if (verificationClientId === undefined || verificationClientId === appClientId) {
    return [appClientId];
  }
  return [appClientId, verificationClientId];
}

export function parseRouteKey(routeKey: string): { method: HttpMethodName; path: string } {
  const space = routeKey.indexOf(' ');
  const method = routeKey.slice(0, space);
  const path = routeKey.slice(space + 1);
  if (space < 1 || (method !== 'GET' && method !== 'POST') || !path.startsWith('/')) {
    throw new Error(`Invalid route key: ${routeKey}`);
  }
  return { method, path };
}

function pascal(segment: string): string {
  const word = segment.replace(/[{}]/g, '');
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Stable construct ID for a route, for example 'GetClaimsClaimIdEvidenceEvidenceId'. */
export function routeConstructId(route: Pick<ApiRoute, 'method' | 'path'>): string {
  const method = route.method.charAt(0) + route.method.slice(1).toLowerCase();
  return method + route.path.split('/').filter((s) => s !== '').map(pascal).join('');
}
