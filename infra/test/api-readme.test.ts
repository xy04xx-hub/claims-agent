import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6
const infraReadme = readFileSync(resolve(__dirname, '../README.md'), 'utf8');
const start = infraReadme.indexOf('## Api stack');
const apiSection = start < 0 ? '' : infraReadme.slice(start).split(/\n## /)[0] ?? '';
const backendReadme = readFileSync(resolve(__dirname, '../../backend/api/README.md'), 'utf8');

describe('infra/README.md Api section', () => {
  it('exists', () => {
    expect(apiSection).not.toBe('');
  });
  it.each(['ApiUrl', 'ApiId', 'CustomerFunctionName', 'AdjusterFunctionName', 'cspApiOrigins', '501'])(
    'documents %s',
    (item) => {
      expect(apiSection).toContain(item);
    },
  );
});

describe('backend/api/README.md', () => {
  it('has no T-04 placeholder', () => {
    expect(backendReadme).not.toContain('Placeholder created by T-04');
  });
  it('has an owner line in the first 10 lines', () => {
    const head = backendReadme.split('\n').slice(0, 10);
    expect(head.some((l) => l.startsWith('Owner: B'))).toBe(true);
  });
});
