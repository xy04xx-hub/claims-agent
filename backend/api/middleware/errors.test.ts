import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { addFormats } from './ajv-formats.js';
import errorSchema from '../../../contracts/api/error.response.schema.json' with { type: 'json' };
import { errorResponse, jsonResponse, type ErrorCode } from './errors.js';

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const validateError = ajv.compile(errorSchema);

const CASES: ReadonlyArray<[number, ErrorCode]> = [
  [400, 'BAD_REQUEST'],
  [401, 'UNAUTHORIZED'],
  [403, 'FORBIDDEN'],
  [404, 'NOT_FOUND'],
  [501, 'NOT_IMPLEMENTED'],
  [500, 'INTERNAL_ERROR'],
];

describe('errorResponse', () => {
  it.each(CASES)('status %i code %s validates against the error contract', (status, code) => {
    const res = errorResponse(status, code, 'Some message', 'req-1');
    expect(res.statusCode).toBe(status);
    const body: unknown = JSON.parse(res.body);
    expect(validateError(body)).toBe(true);
    expect(body).toMatchObject({ error: code, requestId: 'req-1' });
  });

  it('sets content-type, cache-control and x-request-id', () => {
    const res = errorResponse(400, 'BAD_REQUEST', 'm', 'req-9');
    expect(res.headers).toEqual({
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-request-id': 'req-9',
    });
  });

  it('omits requestId and x-request-id when the request ID is undefined', () => {
    const res = errorResponse(500, 'INTERNAL_ERROR', 'Internal error', undefined);
    expect(res.headers['x-request-id']).toBeUndefined();
    const body: unknown = JSON.parse(res.body);
    expect(body).not.toHaveProperty('requestId');
    expect(validateError(body)).toBe(true);
  });

  it('includes fields when given and omits an empty list', () => {
    const withFields = errorResponse(400, 'BAD_REQUEST', 'm', 'r', [{ path: '/a', message: 'is required' }]);
    const parsed: unknown = JSON.parse(withFields.body);
    expect(parsed).toMatchObject({ fields: [{ path: '/a', message: 'is required' }] });
    expect(validateError(parsed)).toBe(true);
    expect(JSON.parse(errorResponse(400, 'BAD_REQUEST', 'm', 'r', []).body)).not.toHaveProperty('fields');
  });
});

describe('jsonResponse', () => {
  it('serialises the body with the same headers', () => {
    const res = jsonResponse(200, { ok: true }, 'req-2');
    expect(res.body).toBe('{"ok":true}');
    expect(res.headers['x-request-id']).toBe('req-2');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
