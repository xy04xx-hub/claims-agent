// Owner: B (muzair110)
// Feature: b-t08-api-stack. Source scan of the production files under backend/api.
// Guards the boundaries from the design: identity comes only from verified claims (via caller.ts),
// only request-body.ts reads event.body, and the API code has no CDK, AWS SDK, file or network use.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const API_DIR = dirname(fileURLToPath(import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const isProduction = (rel: string): boolean =>
  !rel.endsWith('.test.ts') &&
  !rel.startsWith(`test${sep}`) &&
  rel !== 'vitest.config.ts' &&
  !rel.endsWith('.d.ts');

const files = walk(API_DIR)
  .map((full) => ({ rel: relative(API_DIR, full), full }))
  .filter((f) => isProduction(f.rel))
  .map((f) => ({ rel: f.rel.split(sep).join('/'), text: stripComments(readFileSync(f.full, 'utf8')) }));

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

// (a) Properties read from the request containers that look like identity.
const IDENTITY_NAME = /tenant|role|group|sub/i;
const CONTAINER_READ =
  /\b(?:headers|queryStringParameters|pathParameters|body)\s*(?:\?\.\s*(\w+)|\.\s*(\w+)|\??\.?\[\s*['"`]([^'"`]+)['"`]\s*\])/g;

function identityReads(text: string): string[] {
  const hits: string[] = [];
  for (const m of text.matchAll(CONTAINER_READ)) {
    const name = m[1] ?? m[2] ?? m[3] ?? '';
    if (IDENTITY_NAME.test(name)) hits.push(m[0]);
  }
  return hits;
}

// (b) Reads of event.body, including destructuring and bracket access.
const EVENT_BODY =
  /\b(?:event|ev|evt)\s*\??\.\s*body\b|\b(?:event|ev|evt)\s*\??\.?\[\s*['"`]body['"`]\s*\]|\{[^}]*\bbody\b[^}]*\}\s*=\s*(?:event|ev|evt)\b/;

// (c), (d) Import specifiers.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
const specifiers = (text: string): string[] => [...text.matchAll(SPECIFIER)].map((m) => m[1] ?? '');

const CDK_OR_SDK = (s: string): boolean =>
  s.includes('infra/') || s.includes('aws-cdk-lib') || s.startsWith('@aws-sdk/') || s === 'aws-sdk';
const IO_MODULES = new Set([
  'fs', 'fs/promises', 'node:fs', 'node:fs/promises',
  'http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns', 'child_process',
  'node:http', 'node:https', 'node:http2', 'node:net', 'node:tls', 'node:dgram', 'node:dns', 'node:child_process',
]);
const CLIENT_CREATION = /\bnew\s+[A-Z]\w*Client\s*\(/;
const NETWORK_CALL = /\bfetch\s*\(/;

// (e) Property reads on a claims map. Only caller.ts may do this.
const CLAIMS_READ = /\bclaims\s*\??\s*(?:\.\s*\w|\[)/;

describe('source scan: production files under backend/api', () => {
  it('finds the production files', () => {
    const names = files.map((f) => f.rel);
    expect(names).toEqual(
      expect.arrayContaining([
        'api-customer/index.ts',
        'api-adjuster/index.ts',
        'middleware/middleware.ts',
        'middleware/request-body.ts',
        'middleware/caller.ts',
        'routes.ts',
      ]),
    );
    expect(names.some((n) => n.endsWith('.test.ts') || n.startsWith('test/'))).toBe(false);
  });

  it('(a) reads no identity-like property from body, query, path parameters or headers', () => {
    const offenders = files.flatMap((f) => identityReads(f.text).map((h) => `${f.rel}: ${h}`));
    expect(offenders).toEqual([]);
  });

  it('(a) self-test: the scan catches planted reads', () => {
    expect(identityReads(`const t = event.headers['x-tenant'];`).length).toBe(1);
    expect(identityReads(`const g = event.headers.groups;`).length).toBe(1);
    expect(identityReads(`const r = ev.pathParameters?.role;`).length).toBe(1);
    expect(identityReads(`const s = body["sub"];`).length).toBe(1);
    expect(identityReads(`const q = event.queryStringParameters?.['tenantId'];`).length).toBe(1);
    expect(identityReads(`const ok = event.headers['content-type'];`)).toEqual([]);
  });

  it('(b) only request-body.ts reads event.body', () => {
    const readers = files.filter((f) => EVENT_BODY.test(f.text)).map((f) => f.rel);
    expect(readers).toEqual(['middleware/request-body.ts']);
  });

  it('(b) self-test: the scan catches planted event.body reads', () => {
    expect(EVENT_BODY.test('const b = event.body;')).toBe(true);
    expect(EVENT_BODY.test('const b = ev?.body;')).toBe(true);
    expect(EVENT_BODY.test("const b = event['body'];")).toBe(true);
    expect(EVENT_BODY.test('const { body } = event;')).toBe(true);
    expect(EVENT_BODY.test('return jsonResponse(result.statusCode, result.body, id);')).toBe(false);
  });

  it('(c) imports nothing from infra/ or aws-cdk-lib', () => {
    const offenders = files.flatMap((f) =>
      specifiers(f.text).filter((s) => s.includes('infra/') || s.includes('aws-cdk-lib')).map((s) => `${f.rel}: ${s}`),
    );
    expect(offenders).toEqual([]);
  });

  it('(d) imports no AWS SDK module and creates no AWS SDK client', () => {
    // shared/repo.ts is the one file that wraps the DynamoDB document client. Clients are created in the entry points.
    // shared/presign.ts wraps createPresignedPost (it only imports the S3Client type).
    const allowed = (rel: string, s: string): boolean =>
      (rel === 'shared/repo.ts' && s.startsWith('@aws-sdk/lib-dynamodb')) ||
      (rel.endsWith('/index.ts') && /^api-(customer|adjuster)\//.test(rel) && /^@aws-sdk\/(client-dynamodb|client-s3|client-sqs|lib-dynamodb)$/.test(s)) ||
      (rel === 'shared/presign.ts' && (s === '@aws-sdk/s3-presigned-post' || s === '@aws-sdk/client-s3'));
    const offenders = files.flatMap((f) => [
      ...specifiers(f.text).filter((s) => CDK_OR_SDK(s) && !allowed(f.rel, s)).map((s) => `${f.rel}: ${s}`),
      ...(CLIENT_CREATION.test(f.text) && !/^api-(customer|adjuster)\/index\.ts$/.test(f.rel) ? [`${f.rel}: new *Client()`] : []),
    ]);
    expect(offenders).toEqual([]);
  });

  it('uses no fs or network module in the request path', () => {
    const offenders = files.flatMap((f) => [
      ...specifiers(f.text).filter((s) => IO_MODULES.has(s)).map((s) => `${f.rel}: ${s}`),
      ...(NETWORK_CALL.test(f.text) ? [`${f.rel}: fetch()`] : []),
    ]);
    expect(offenders).toEqual([]);
  });

  it('reads JWT claims properties only in caller.ts', () => {
    const readers = files.filter((f) => CLAIMS_READ.test(f.text)).map((f) => f.rel);
    expect(readers).toEqual(['middleware/caller.ts']);
  });

  it('import scan self-test: catches planted imports', () => {
    const planted = `import { Stack } from 'aws-cdk-lib';\nimport x from '../../infra/lib/a.js';\nconst c = await import('@aws-sdk/client-s3');\nimport { readFileSync } from 'node:fs';`;
    const found = specifiers(planted);
    expect(found).toEqual(['aws-cdk-lib', '../../infra/lib/a.js', '@aws-sdk/client-s3', 'node:fs']);
    expect(found.filter(CDK_OR_SDK).length).toBe(3);
    expect(found.filter((s) => IO_MODULES.has(s)).length).toBe(1);
  });
});
