// Owner: B (muzair110)
// Middleware core. Pipeline order is fixed (design, "Middleware pipeline"):
// request ID, claims, route lookup, group gate, path parameters, body, dispatch.
// Performs no network call and no file read (Requirement 7.9).
import { routesOf, type FunctionName, type HandlerRoute } from '../routes.js';
import { readCaller } from './caller.js';
import { errorResponse, jsonResponse, type FieldError } from './errors.js';
import { PATH_PARAM_PATTERNS } from './limits.js';
import { readBody } from './request-body.js';
import type {
  ApiEvent,
  ApiResponse,
  LogSink,
  MetricsSink,
  Outcome,
  RouteHandler,
} from './types.js';

export interface MiddlewareDeps {
  readonly service: FunctionName;
  readonly log: LogSink;
  readonly metrics: MetricsSink;
  /** Injected clock, used for durationMs. */
  readonly now: () => number;
  /**
   * Route handlers keyed by routeKey. NOT_IMPLEMENTED means: no handler is registered for the
   * route, so the answer is 501. When an entry exists it is invoked after every check
   * (claims, group, path parameters, body) instead of returning 501.
   * Production entry points pass no handlers, so every route returns 501 in this ticket.
   * Tests inject a recording handler here without changing the production route table.
   * T-09 and T-10 register real handlers here.
   */
  readonly handlers?: Readonly<Record<string, RouteHandler>>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function statusToOutcome(status: number): Outcome | 'OK' {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 501:
      return 'NOT_IMPLEMENTED';
    case 500:
      return 'INTERNAL_ERROR';
    default:
      return 'OK';
  }
}

function checkPathParameters(
  route: HandlerRoute,
  raw: unknown,
): { ok: true; values: Record<string, string> } | { ok: false; fields: FieldError[] } {
  const source = isRecord(raw) ? raw : {};
  const values: Record<string, string> = {};
  const fields: FieldError[] = [];
  for (const name of route.pathParams) {
    const value = source[name];
    if (typeof value === 'string' && PATH_PARAM_PATTERNS[name].test(value)) {
      values[name] = value;
    } else {
      fields.push({ path: `/${name}`, message: 'is invalid' });
    }
  }
  return fields.length > 0 ? { ok: false, fields } : { ok: true, values };
}

export async function handleRequest(event: unknown, deps: MiddlewareDeps): Promise<ApiResponse> {
  const started = deps.now();
  const ev: ApiEvent = isRecord(event) ? (event as ApiEvent) : {};
  const rawRequestId = ev.requestContext?.requestId;
  const requestId =
    typeof rawRequestId === 'string' && rawRequestId.length > 0 ? rawRequestId : undefined;
  const routeKey = typeof ev.routeKey === 'string' ? ev.routeKey : 'unknown';
  let group = 'none';
  let tenantId = 'none';
  let response: ApiResponse;

  try {
    response = await run();
  } catch (err) {
    deps.log.error('Request failed', {
      requestId: requestId ?? 'none',
      errorName: err instanceof Error ? err.name : 'UnknownError',
    });
    response = errorResponse(500, 'INTERNAL_ERROR', 'Internal error', requestId);
  }

  const outcome = statusToOutcome(response.statusCode);
  try {
    deps.log.info('Request handled', {
      requestId: requestId ?? 'none',
      routeKey,
      group,
      tenantId,
      outcome,
      durationMs: Math.max(0, deps.now() - started),
    });
    if (outcome !== 'OK') deps.metrics.outcome(outcome);
    deps.metrics.flush();
  } catch {
    // Telemetry must never change the answer.
  }
  return response;

  async function run(): Promise<ApiResponse> {
    // Step 1
    if (requestId === undefined) {
      return errorResponse(500, 'INTERNAL_ERROR', 'Internal error', undefined);
    }
    // Steps 2 to 6
    const who = readCaller(ev.requestContext?.authorizer?.jwt?.claims);
    if (!who.ok) return errorResponse(who.status, who.code, who.message, requestId);
    const { caller } = who;
    group = caller.group;
    tenantId = caller.tenantId;
    // Step 7
    const route = typeof ev.routeKey === 'string' ? routesOf(deps.service).get(ev.routeKey) : undefined;
    if (route === undefined) return errorResponse(404, 'NOT_FOUND', 'Not found', requestId);
    // Step 8: the group gate comes before any path or body check.
    if (!route.groups.includes(caller.group)) {
      return errorResponse(403, 'FORBIDDEN', 'Access denied', requestId);
    }
    // Step 9
    const params = checkPathParameters(route, ev.pathParameters);
    if (!params.ok) {
      return errorResponse(400, 'BAD_REQUEST', 'Path parameters are invalid', requestId, params.fields);
    }
    // Step 10
    let body: unknown;
    if (route.bodySchema !== undefined) {
      const parsed = readBody(ev, route.bodySchema);
      if (!parsed.ok) {
        return errorResponse(400, 'BAD_REQUEST', parsed.message, requestId, parsed.fields);
      }
      body = parsed.value;
    }
    // Step 11: no handler registered means 501.
    const handler = deps.handlers !== undefined && Object.hasOwn(deps.handlers, route.routeKey)
      ? deps.handlers[route.routeKey]
      : undefined;
    if (handler === undefined) {
      return errorResponse(501, 'NOT_IMPLEMENTED', 'Not implemented yet', requestId);
    }
    const result = await handler({ caller, requestId, pathParameters: params.values, body });
    return jsonResponse(result.statusCode, result.body, requestId);
  }
}

export function createHandler(deps: MiddlewareDeps): (event: unknown) => Promise<ApiResponse> {
  return (event) => handleRequest(event, deps);
}
