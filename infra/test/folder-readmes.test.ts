import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { isValidLocalOrigin } from '../lib/stage-config.js';
// Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.10
const root = resolve(__dirname, '../..');
const read = (p: string): string => readFileSync(resolve(root, p), 'utf8');

const folders = ['backend/auth', 'infra/lib/constructs/platform', 'infra/lib/stacks'];

describe.each(folders)('%s/README.md', (folder) => {
  const text = read(`${folder}/README.md`);
  it('has no T-04 placeholder text', () => {
    expect(text).not.toContain('Placeholder created by T-04');
  });
  it('names the owner in the first 10 lines', () => {
    const head = text.split('\n').slice(0, 10).join('\n');
    expect(/\bB\b|muzair110/.test(head)).toBe(true);
  });
});

describe('backend/auth README content', () => {
  const text = read('backend/auth/README.md');
  it.each(['tenantId', 'custom:tenantId', 'clientMetadata', 'ClaimsFunction', 'vitest'])(
    'mentions %s',
    (word) => {
      expect(text).toContain(word);
    },
  );
});

describe('platform README', () => {
  const text = read('infra/lib/constructs/platform/README.md');
  const files = readdirSync(resolve(root, 'infra/lib/constructs/platform')).filter((f) =>
    f.endsWith('.ts'),
  );
  it.each(files)('mentions %s', (file) => {
    expect(text).toContain(file);
  });
});

describe('stacks README', () => {
  const text = read('infra/lib/stacks/README.md');
  it.each([
    'foundation-stack.ts',
    'auth-stack.ts',
    'api-stack.ts',
    'web-stack.ts',
    'ops-stack.ts',
    'processing-stack.ts',
    'agent-stack.ts',
    'build-app.ts',
  ])('mentions %s', (file) => {
    expect(text).toContain(file);
  });
});

describe('authLocalOrigins in config files', () => {
  const banned = ['<', '>', 'TODO', 'placeholder', 'example'];
  it.each(['default', 'dev-a', 'dev-b', 'demo'])('%s.json origins are valid', (name) => {
    const cfg = JSON.parse(read(`infra/config/${name}.json`)) as { authLocalOrigins: string[] };
    expect(Array.isArray(cfg.authLocalOrigins)).toBe(true);
    for (const origin of cfg.authLocalOrigins) {
      expect(isValidLocalOrigin(origin)).toBe(true);
      for (const b of banned) expect(origin.toLowerCase()).not.toContain(b.toLowerCase());
    }
  });
  it('demo.json has no local origins', () => {
    expect(JSON.parse(read('infra/config/demo.json')).authLocalOrigins).toEqual([]);
  });
});
