// Owner: B (muzair110)
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readBody } from './request-body.js';
import { BODY_LIMIT_BYTES } from './limits.js';
import type { BodySchemaFile } from '../routes.js';

const JSON_HEADERS = { 'content-type': 'application/json' };
const example = (name: string): string =>
  readFileSync(new URL(`../../../contracts/api/${name}.request.example.json`, import.meta.url), 'utf8');
const CLAIM: BodySchemaFile = 'claim-create.request.schema.json';

describe('readBody', () => {
  it.each([
    ['evidence-upload', 'evidence-upload.request.schema.json'],
    ['claim-create', 'claim-create.request.schema.json'],
    ['resolution', 'resolution.request.schema.json'],
  ] as const)('accepts the %s example', (name, schema) => {
    expect(readBody({ body: example(name), headers: JSON_HEADERS }, schema).ok).toBe(true);
  });

  it('accepts base64 bodies and content types with parameters and upper case', () => {
    const body = Buffer.from(example('claim-create')).toString('base64');
    const result = readBody(
      { body, isBase64Encoded: true, headers: { 'Content-Type': 'Application/JSON; charset=utf-8' } },
      CLAIM,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects empty and missing bodies', () => {
    expect(readBody({ headers: JSON_HEADERS }, CLAIM).ok).toBe(false);
    expect(readBody({ body: '', headers: JSON_HEADERS }, CLAIM).ok).toBe(false);
  });

  it('rejects a wrong or missing content type', () => {
    expect(readBody({ body: '{}', headers: { 'content-type': 'text/plain' } }, CLAIM)).toMatchObject({ ok: false });
    expect(readBody({ body: '{}' }, CLAIM)).toMatchObject({ ok: false });
  });

  it('rejects invalid JSON and non-object values', () => {
    expect(readBody({ body: '{nope', headers: JSON_HEADERS }, CLAIM)).toMatchObject({
      ok: false,
      message: 'Request body is not valid JSON',
    });
    expect(readBody({ body: '[]', headers: JSON_HEADERS }, CLAIM)).toMatchObject({ ok: false });
    expect(readBody({ body: '"x"', headers: JSON_HEADERS }, CLAIM)).toMatchObject({ ok: false });
  });

  it('applies the size limit at 16,384 / 16,385 bytes before parsing', () => {
    const atLimit = ' '.repeat(BODY_LIMIT_BYTES - 2) + '{}';
    const over = ' '.repeat(BODY_LIMIT_BYTES - 1) + '{}';
    const fits = readBody({ body: atLimit, headers: JSON_HEADERS }, CLAIM);
    expect(fits).toMatchObject({ ok: false, message: 'Request body is invalid' });
    expect(readBody({ body: over, headers: JSON_HEADERS }, CLAIM)).toMatchObject({
      ok: false,
      message: 'Request body is too large',
    });
    const b64 = Buffer.from(over).toString('base64');
    expect(readBody({ body: b64, isBase64Encoded: true, headers: JSON_HEADERS }, CLAIM)).toMatchObject({
      message: 'Request body is too large',
    });
  });

  it('returns field errors for undeclared properties without echoing values', () => {
    const body = JSON.stringify({ ...JSON.parse(example('claim-create')), tenantId: 'secret-value' });
    const result = readBody({ body, headers: JSON_HEADERS }, CLAIM);
    expect(result).toMatchObject({ ok: false, fields: [{ path: '/tenantId', message: 'unexpected property' }] });
    expect(JSON.stringify(result)).not.toContain('secret-value');
  });
});
