import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { addFormats } from './ajv-formats.js';
import errorSchema from '../../../contracts/api/error.response.schema.json' with { type: 'json' };
import { errorResponse } from './errors.js';
import { toFieldErrors } from './fields.js';

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const validateError = ajv.compile(errorSchema);

const sample = ajv.compile({
  type: 'object',
  additionalProperties: false,
  required: ['text', 'list', 'amount', 'kind', 'id', 'when'],
  properties: {
    text: { type: 'string', minLength: 2, maxLength: 5 },
    list: { type: 'array', maxItems: 2, minItems: 1, uniqueItems: true, items: { type: 'string' } },
    amount: { type: 'number', maximum: 10, exclusiveMinimum: 0, multipleOf: 0.5 },
    kind: { enum: ['A', 'B'] },
    id: { type: 'string', pattern: '^X-[0-9]+$' },
    when: { type: 'string', format: 'date' },
  },
});

function run(value: unknown) {
  sample(value);
  return toFieldErrors(sample.errors ?? []);
}

const VALID = { text: 'abc', list: ['a'], amount: 1, kind: 'A', id: 'X-1', when: '2025-01-31' };

describe('toFieldErrors', () => {
  it('maps each keyword to a fixed message without the submitted value', () => {
    const secret = 'SECRET-VALUE';
    const result = run({
      text: secret + secret,
      list: ['a', 'a', 'b'],
      amount: -3.3,
      kind: secret,
      id: secret,
      when: secret,
    });
    const byPath = new Map(result.map((e) => [e.path, e.message] as const));
    expect(byPath.get('/text')).toBe('must be at most 5 characters');
    expect(result.some((e) => e.path === '/list' && e.message === 'must have at most 2 items')).toBe(true);
    expect(result.some((e) => e.path === '/list' && e.message === 'must be unique')).toBe(true);
    expect(result.some((e) => e.path === '/amount' && e.message === 'must be greater than 0')).toBe(true);
    expect(result.some((e) => e.path === '/amount' && e.message === 'must be a multiple of 0.5')).toBe(true);
    expect(byPath.get('/kind')).toBe('must be one of the allowed values');
    expect(byPath.get('/id')).toBe('has an invalid format');
    expect(byPath.get('/when')).toBe('has an invalid format');
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('maps minLength, maximum and type', () => {
    const result = run({ ...VALID, text: 'a', amount: 11, kind: 'A', list: 'x' });
    expect(result).toContainEqual({ path: '/text', message: 'must be at least 2 characters' });
    expect(result).toContainEqual({ path: '/amount', message: 'must be at most 10' });
    expect(result).toContainEqual({ path: '/list', message: 'must be of type array' });
  });

  it('maps required to the missing name', () => {
    expect(run({})).toContainEqual({ path: '/text', message: 'is required' });
  });

  it('maps an undeclared property to its name', () => {
    expect(run({ ...VALID, tenantId: 'x' })).toEqual([{ path: '/tenantId', message: 'unexpected property' }]);
  });

  it('cuts and sanitizes a hostile property name', () => {
    const hostile = `a\n\u0000"<b>${'z'.repeat(5000)}`;
    const result = run({ ...VALID, [hostile]: 1 });
    expect(result).toHaveLength(1);
    const path = result[0]?.path ?? '';
    expect(path.length).toBeLessThanOrEqual(61);
    expect(path).toMatch(/^\/[A-Za-z0-9_$.-]+$/);
    expect(path.startsWith('/a_')).toBe(true);
  });

  it('caps the list at 20 entries and every entry stays within 200 characters', () => {
    const extra: Record<string, number> = {};
    for (let i = 0; i < 50; i++) extra[`p${i}`] = i;
    const result = run({ ...VALID, ...extra });
    expect(result).toHaveLength(20);
    for (const e of result) {
      expect(e.path.length).toBeLessThanOrEqual(200);
      expect(e.message.length).toBeLessThanOrEqual(200);
    }
  });

  it('de-duplicates identical entries', () => {
    const entries = toFieldErrors([
      { keyword: 'required', instancePath: '', schemaPath: '#', params: { missingProperty: 'a' } },
      { keyword: 'required', instancePath: '', schemaPath: '#', params: { missingProperty: 'a' } },
    ]);
    expect(entries).toEqual([{ path: '/a', message: 'is required' }]);
  });

  it('produces a body that validates against the error contract', () => {
    const res = errorResponse(400, 'BAD_REQUEST', 'Request body is invalid', 'req-1', run({ ...VALID, x: 1, text: 'abcdefgh' }));
    expect(validateError(JSON.parse(res.body))).toBe(true);
  });
});
