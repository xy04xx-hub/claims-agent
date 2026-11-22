// Owner: B (muzair110)
// One error shape for every non-success answer (contracts/api/error.response.schema.json).
import type { ApiResponse } from './types.js';

export interface FieldError {
  path: string;
  message: string;
}

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL_ERROR';

function headersFor(requestId: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  };
  if (requestId !== undefined) headers['x-request-id'] = requestId;
  return headers;
}

export function jsonResponse(status: number, body: unknown, requestId: string | undefined): ApiResponse {
  return { statusCode: status, headers: headersFor(requestId), body: JSON.stringify(body) };
}

export function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  requestId: string | undefined,
  fields?: readonly FieldError[],
): ApiResponse {
  const body: { error: ErrorCode; message: string; requestId?: string; fields?: readonly FieldError[] } = {
    error: code,
    message,
  };
  if (requestId !== undefined) body.requestId = requestId;
  if (fields !== undefined && fields.length > 0) body.fields = fields;
  return jsonResponse(status, body, requestId);
}
