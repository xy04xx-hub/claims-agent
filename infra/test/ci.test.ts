import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
// Validates: Requirements 8.1, 8.2, 8.5, 8.6, 8.7
const ROOT = resolve(__dirname, '..', '..');
const workflowText = readFileSync(join(ROOT, '.github/workflows/pr.yml'), 'utf8');
const wf = parse(workflowText) as {
  on: Record<string, { branches?: string[] }>;
  permissions: Record<string, string>;
  jobs: Record<string, { name?: string; steps: Array<{ uses?: string; run?: string }> }>;
};

const JOBS = ['lint', 'typecheck', 'test', 'synth', 'secret-scan'];

describe('pr.yml', () => {
  it('triggers on pull_request to main only', () => {
    expect(Object.keys(wf.on)).toEqual(['pull_request']);
    expect(wf.on.pull_request.branches).toEqual(['main']);
  });

  it('has read-only contents permission', () => {
    expect(wf.permissions).toEqual({ contents: 'read' });
  });

  it('has the five named jobs', () => {
    expect(Object.keys(wf.jobs).sort()).toEqual([...JOBS].sort());
    for (const j of JOBS) expect(wf.jobs[j].name).toBe(j);
  });

  it.each(['lint', 'typecheck', 'test', 'synth'])('%s calls its root script', (j) => {
    const runs = wf.jobs[j].steps.map((s) => s.run ?? '');
    expect(runs).toContain(j === 'test' ? 'npm test' : `npm run ${j}`);
  });

  it('secret-scan uses gitleaks', () => {
    const uses = wf.jobs['secret-scan'].steps.map((s) => s.uses ?? '');
    expect(uses.some((u) => u.startsWith('gitleaks/gitleaks-action@'))).toBe(true);
  });

  it('references no secrets other than GITHUB_TOKEN', () => {
    const refs = workflowText.match(/secrets\.[A-Za-z0-9_]+/g) ?? [];
    expect(refs.filter((r) => r !== 'secrets.GITHUB_TOKEN')).toEqual([]);
  });

  it('has no AWS credential steps', () => {
    expect(workflowText).not.toMatch(/configure-aws-credentials|AWS_ACCESS_KEY|AWS_SECRET|role-to-assume|id-token/i);
  });

  it('pins every third-party action to a 40-char SHA', () => {
    const uses = Object.values(wf.jobs).flatMap((j) => j.steps.map((s) => s.uses).filter((u): u is string => !!u));
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u, u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });
});

describe('CODEOWNERS', () => {
  const SHARED = [
    '/.kiro/steering/', '/.kiro/skills/', '/contracts/', '/backend/shared/',
    '/infra/lib/constructs/claims-function.ts', '/infra/config/default.json',
    '/infra/config/demo.json', '/package.json', '/tests/e2e/', '/docs/adr/',
    '/docs/plan/', '/.github/',
  ];
  const lines = readFileSync(join(ROOT, '.github/CODEOWNERS'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  it.each(SHARED)('lists both owners for %s', (path) => {
    const line = lines.find((l) => l.split(/\s+/)[0] === path);
    expect(line, `missing ${path}`).toBeDefined();
    const owners = line!.split(/\s+/).slice(1);
    expect(owners).toContain('@xy04xx-hub');
    expect(owners).toContain('@muzair110');
  });
});
