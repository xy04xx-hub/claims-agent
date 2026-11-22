// Owner: B (muzair110). Unit tests of the seed-users script with injected dependencies.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runSeedUsers, SEED_USERS, type ExistingUser, type SeedUsersDeps } from './lib/seed-users.js';

const dir = path.dirname(fileURLToPath(import.meta.url));

function fake(over: Partial<SeedUsersDeps> = {}) {
  const calls: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const deps: SeedUsersDeps = {
    getPoolId: async () => {
      calls.push('getPoolId');
      return 'us-east-1_pool';
    },
    getUser: async (): Promise<ExistingUser | undefined> => {
      calls.push('getUser');
      return undefined;
    },
    createUser: async (_p, u) => {
      calls.push(`createUser:${u.email}`);
      return { sub: `sub-${u.email}` };
    },
    addToGroup: async (_p, email, group) => {
      calls.push(`addToGroup:${email}:${group}`);
    },
    randomInt: (max) => Math.floor(max / 2),
    print: (l) => out.push(l),
    error: (l) => err.push(l),
    ...over,
  };
  return { deps, calls, out, err };
}

describe('seed-users arguments', () => {
  it.each([[[]], [['prod']], [['dev-a', 'dev-b']]])('rejects %j without calling any dependency', async (argv) => {
    const f = fake();
    expect(await runSeedUsers(argv, f.deps)).toBe(1);
    expect(f.calls).toEqual([]);
    expect(f.err.join('\n')).toContain('Usage');
  });
});

describe('seed-users run', () => {
  it('names the stack and returns 1 when the pool id cannot be read', async () => {
    const f = fake({
      getPoolId: async () => {
        throw new Error('boom');
      },
    });
    expect(await runSeedUsers(['dev-b'], f.deps)).toBe(1);
    expect(f.err.join('\n')).toContain('ClaimsAgent-dev-b-Auth');
    expect(f.calls).toEqual([]);
  });

  it('continues with the other users when one fails, and never prints a password to error', async () => {
    const f = fake({
      createUser: async (_p, u) => {
        if (u.email === 'customer1@example.com') throw new Error('denied');
        return { sub: 'sub-x' };
      },
    });
    expect(await runSeedUsers(['dev-b'], f.deps)).toBe(1);
    expect(f.calls.filter((c) => c.startsWith('addToGroup'))).toHaveLength(2);
    expect(f.err.join('\n')).toContain('customer1@example.com: denied');
    const passwords = f.out
      .filter((l) => l.startsWith('CREATED'))
      .map((l) => l.split('temporary password: ')[1]!);
    expect(passwords).toHaveLength(2);
    for (const p of passwords) expect(f.err.join('\n')).not.toContain(p);
  });

  it('prints a summary with email, group, tenant and sub', async () => {
    const f = fake();
    expect(await runSeedUsers(['dev-a'], f.deps)).toBe(0);
    expect(f.out).toContain('email | group | tenant | sub');
    expect(f.out).toContain('adjuster1@example.com | Adjuster | t1 | sub-adjuster1@example.com');
    expect(f.out).toContain('customer1@example.com | Customer | t1 | sub-customer1@example.com');
  });
});

describe('seed-users source scan', () => {
  const entry = readFileSync(path.join(dir, 'seed-users.ts'), 'utf8');
  const lib = readFileSync(path.join(dir, 'lib/seed-users.ts'), 'utf8');

  it('has no password literal or 12-digit number', () => {
    for (const src of [entry, lib]) {
      expect(src).not.toMatch(/\b\d{12}\b/);
      expect(src).not.toMatch(/(?:password|Password)\s*[:=]\s*['"`][^'"`]+['"`]/);
    }
  });

  it('takes group names and tenant from auth-model.ts', () => {
    expect(lib).toMatch(/from '\.\.\/\.\.\/infra\/lib\/constructs\/platform\/auth-model\.js'/);
    for (const src of [entry, lib]) {
      expect(src).not.toMatch(/['"`](Customer|Adjuster)['"`]/);
    }
    expect(SEED_USERS.map((u) => u.group)).toContain('Adjuster');
  });
});
