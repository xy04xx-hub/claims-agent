// Owner: B (muzair110)
// Minimal event and response types, so no @types/aws-lambda dependency.
import type { Group } from '../routes.js';

export interface ApiEvent {
  routeKey?: unknown;
  body?: unknown;
  isBase64Encoded?: unknown;
  headers?: unknown;
  pathParameters?: unknown;
  requestContext?: { requestId?: unknown; authorizer?: { jwt?: { claims?: unknown } } };
}

export interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface Caller {
  readonly sub: string;
  readonly group: Group;
  readonly tenantId: string;
}

/** No event, headers or claims map: a handler reaches the caller only through `caller`. */
export interface RouteContext {
  readonly caller: Caller;
  readonly requestId: string;
  readonly pathParameters: Readonly<Record<string, string>>;
  /** Validated against the route schema, or undefined when the route has no body. */
  readonly body: unknown;
}

export interface RouteResult {
  readonly statusCode: number;
  readonly body: unknown;
}

export type RouteHandler = (ctx: RouteContext) => Promise<RouteResult>;

export type Outcome =
  | 'NOT_IMPLEMENTED'
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL_ERROR';

export interface LogSink {
  info(message: string, fields: Record<string, unknown>): void;
  error(message: string, fields: Record<string, unknown>): void;
}

export interface MetricsSink {
  outcome(outcome: Outcome): void;
  flush(): void;
}
