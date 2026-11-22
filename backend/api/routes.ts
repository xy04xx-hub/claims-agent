// Owner: B (muzair110)
// Handler route table. Pure data, no imports, so infra tests can import it.
// Must stay equal to API_ROUTES in infra/lib/constructs/platform/api-model.ts (checked by a test).

export type Group = 'Customer' | 'Adjuster';
export type FunctionName = 'api-customer' | 'api-adjuster';
export type BodySchemaFile =
  | 'evidence-upload.request.schema.json'
  | 'claim-create.request.schema.json'
  | 'resolution.request.schema.json';
export type PathParamName = 'claimId' | 'evidenceId';

export interface HandlerRoute {
  readonly routeKey: string;
  readonly function: FunctionName;
  readonly groups: readonly Group[];
  /** File name in contracts/api, not a parsed schema. */
  readonly bodySchema?: BodySchemaFile;
  readonly pathParams: readonly PathParamName[];
  readonly state: 'NOT_IMPLEMENTED';
  readonly ticket: 'T-09' | 'T-10' | 'T-24';
}

export const ROUTES: readonly HandlerRoute[] = [
  {
    routeKey: 'GET /me/policies',
    function: 'api-customer',
    groups: ['Customer'],
    pathParams: [],
    state: 'NOT_IMPLEMENTED',
    ticket: 'T-09',
  },
  {
    routeKey: 'POST /evidence/uploads',
    function: 'api-customer',
    groups: ['Customer'],
    bodySchema: 'evidence-upload.request.schema.json',
    pathParams: [],
    state: 'NOT_IMPLEMENTED',
    ticket: 'T-09',
  },
  {
    routeKey: 'POST /claims',
    function: 'api-customer',
    groups: ['Customer'],
    bodySchema: 'claim-create.request.schema.json',
    pathParams: [],
    state: 'NOT_IMPLEMENTED',
    ticket: 'T-09',
  },
  {
    routeKey: 'GET /claims',
    function: 'api-customer',
    groups: ['Customer'],
    pathParams: [],
    state: 'NOT_IMPLEMENTED',
    ticket: 'T-09',
  },
  {
    routeKey: 'GET /claims/{claimId}',
    function: 'api-customer',
    groups: ['Customer', 'Adjuster'],
    pathParams: ['claimId'],
    state: 'NOT_IMPLEMENTED',
    ticket: 'T-09',
  },
  {
    routeKey: 'GET /claims/{claimId}/evidence/{evidenceId}',
    function: 'api-customer',
    groups: ['Customer', 'Adjuster'],
    pathParams: ['claimId', 'evidenceId'],
    state: 'NOT_IMPLEMENTED',
    ticket: 'T-10',
  },
  {
    routeKey: 'GET /queue',
    function: 'api-adjuster',
    groups: ['Adjuster'],
    pathParams: [],
    state: 'NOT_IMPLEMENTED',
    ticket: 'T-10',
  },
  {
    routeKey: 'POST /claims/{claimId}/resolution',
    function: 'api-adjuster',
    groups: ['Adjuster'],
    bodySchema: 'resolution.request.schema.json',
    pathParams: ['claimId'],
    state: 'NOT_IMPLEMENTED',
    ticket: 'T-10',
  },
  {
    routeKey: 'GET /impact',
    function: 'api-adjuster',
    groups: ['Adjuster'],
    pathParams: [],
    state: 'NOT_IMPLEMENTED',
    ticket: 'T-24',
  },
];

/** The routes one function serves, keyed by route key. */
export function routesOf(fn: FunctionName): ReadonlyMap<string, HandlerRoute> {
  return new Map(ROUTES.filter((r) => r.function === fn).map((r) => [r.routeKey, r]));
}
