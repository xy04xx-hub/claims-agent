import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5
const ROOT = resolve(__dirname, '..', '..');
const p = (rel: string) => join(ROOT, rel);

const REQUIRED_17 = [
  '.github', 'contracts', 'infra', 'backend/shared', 'backend/domain', 'backend/api',
  'backend/auth', 'backend/processing', 'backend/tools', 'agent', 'frontend', 'seed',
  'scripts', 'tests/e2e', 'tests/adversarial', 'tools', 'docs',
];
const REQUIRED_5 = [
  'infra/lib/stacks', 'infra/lib/constructs/platform', 'infra/lib/constructs/engine',
  'infra/config', 'infra/test',
];

// Owner per folder, from repository.md section 2. Matched case-insensitively in the README head.
const OWNER_FOLDERS: Record<string, RegExp> = {
  '.github': /\bB\b|muzair110/,
  'backend/shared': /\bboth\b/i,
  'backend/api': /\bB\b|muzair110/,
  'backend/auth': /\bB\b|muzair110/,
  'backend/processing': /\bA\b/,
  'backend/tools': /\bA\b/,
  agent: /\bA\b/,
  frontend: /\bB\b|muzair110/,
  seed: /\bA\b/,
  'tests/e2e': /\bboth\b/i,
  'tests/adversarial': /\bA\b/,
  'infra/lib/stacks': /muzair110|\bB\b/,
  'infra/lib/constructs/platform': /\bB\b|muzair110/,
  'infra/lib/constructs/engine': /\bA\b/,
  'infra/config': /\bboth\b/i,
};

const CODE_EXT = /\.(ts|tsx|js|mjs|cjs|py|sh|json)$/;
const NON_CODE_FILES = new Set(['README.md', 'package.json', 'package-lock.json']);

function hasSourceCode(dir: string): boolean {
  return readdirSync(p(dir)).some((name) => {
    if (name === 'node_modules' || NON_CODE_FILES.has(name)) return false;
    const full = p(join(dir, name));
    return statSync(full).isDirectory() || CODE_EXT.test(name);
  });
}

function isDir(rel: string): boolean {
  return existsSync(p(rel)) && statSync(p(rel)).isDirectory();
}

describe('repository layout', () => {
  it.each(REQUIRED_17)('required directory exists: %s', (dir) => {
    expect(isDir(dir), `missing directory ${dir}`).toBe(true);
  });

  it.each(REQUIRED_5)('required infra directory exists: %s', (dir) => {
    expect(isDir(dir), `missing directory ${dir}`).toBe(true);
  });

  it('lists exactly 17 and 5 required directories', () => {
    expect(new Set(REQUIRED_17).size).toBe(17);
    expect(new Set(REQUIRED_5).size).toBe(5);
  });

  it.each(Object.keys(OWNER_FOLDERS))('empty owner folder %s has a README naming the owner', (dir) => {
    if (hasSourceCode(dir)) return;
    const readme = p(join(dir, 'README.md'));
    expect(existsSync(readme), `${dir} has no source code and needs README.md`).toBe(true);
    const head = readFileSync(readme, 'utf8').split('\n').slice(0, 10).join('\n');
    expect(head, `README in ${dir} must name its owner in the first 10 lines`).toMatch(OWNER_FOLDERS[dir]);
  });
});

describe('npm workspaces', () => {
  const rootPkg = JSON.parse(readFileSync(p('package.json'), 'utf8')) as { workspaces: string[] };
  const REQUIRED_WORKSPACES = ['infra', 'backend/*', 'agent', 'frontend', 'contracts', 'tools/diagram'];

  it('root workspaces are exactly the six required entries', () => {
    expect([...rootPkg.workspaces].sort()).toEqual([...REQUIRED_WORKSPACES].sort());
  });

  function workspaceDirs(): string[] {
    return rootPkg.workspaces.flatMap((entry) => {
      if (!entry.endsWith('/*')) return [entry];
      const base = entry.slice(0, -2);
      return readdirSync(p(base))
        .map((name) => `${base}/${name}`)
        .filter((d) => isDir(d) && existsSync(p(join(d, 'package.json'))));
    });
  }

  it('every workspace directory has a package.json with a name', () => {
    for (const dir of workspaceDirs()) {
      const file = p(join(dir, 'package.json'));
      expect(existsSync(file), `${dir} needs package.json`).toBe(true);
      const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: string };
      expect(pkg.name, `${dir}/package.json needs a name`).toBeTruthy();
    }
  });

  it('workspace names are unique', () => {
    const names = workspaceDirs().map(
      (dir) => (JSON.parse(readFileSync(p(join(dir, 'package.json')), 'utf8')) as { name: string }).name,
    );
    expect(names.length).toBeGreaterThanOrEqual(11);
    expect(new Set(names).size, `duplicate names in ${names.join(', ')}`).toBe(names.length);
  });
});
