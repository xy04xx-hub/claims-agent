// Owner: B (muzair110).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PASSWORD_POLICY, TENANT } from '../../infra/lib/constructs/platform/auth-model';
import { SEED_USERS, generateTemporaryPassword, runSeedUsers, type SeedUsersDeps } from './seed-users';

// Characters Cognito accepts as password symbols (subset relevant to the generator, plus the documented set).
const COGNITO_SYMBOLS = '^$*.[]{}()?"!@#%&/\\,><\':;|_~`=+- ';

/** Deterministic random source: cycles through the generated integers, reduced modulo the bound. */
function sourceFrom(ints: number[]): (max: number) => number {
  let i = 0;
  return (max) => {
    const n = ints[i % ints.length]!;
    i += 1;
    return n % max;
  };
}

// Feature: b-t06-auth-stack, Property 7: Generated temporary passwords satisfy the password policy
// **Validates: Requirements 12.6**
describe('Property 7: Generated temporary passwords satisfy the password policy', () => {
  const intsArb = fc.array(fc.nat({ max: 1_000_000 }), { minLength: 1, maxLength: 200 });

  it('meets length, character classes and allowed symbols for any random source', () => {
    fc.assert(
      fc.property(intsArb, (ints) => {
        const pw = generateTemporaryPassword(sourceFrom(ints));
        expect(pw.length).toBeGreaterThanOrEqual(PASSWORD_POLICY.minLength);
        expect(pw).toMatch(/[a-z]/);
        expect(pw).toMatch(/[A-Z]/);
        expect(pw).toMatch(/[0-9]/);
        const symbols = [...pw].filter((c) => !/[a-zA-Z0-9]/.test(c));
        expect(symbols.length).toBeGreaterThan(0);
        for (const c of symbols) expect(COGNITO_SYMBOLS).toContain(c);
        // Safe to paste in a shell and type on the hosted page.
        expect(pw).not.toMatch(/[\s'"`\\$]/);
      }),
      { numRuns: 100 },
    );
  });

  it('is deterministic for the same random source', () => {
    fc.assert(
      fc.property(intsArb, (ints) => {
        expect(generateTemporaryPassword(sourceFrom(ints))).toBe(generateTemporaryPassword(sourceFrom(ints)));
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: b-t06-auth-stack, Property 8: Seeding creates exactly the missing users and is idempotent
// **Validates: Requirements 12.5, 12.7, 12.8, 12.9, 12.10**
describe('Property 8: Seeding creates exactly the missing users and is idempotent', () => {
  type Initial = 'absent' | 'same' | 'other';
  interface FakeUser {
    tenantId: string;
    sub: string;
    password?: string;
    groups: Set<string>;
  }

  const initialArb = fc.constantFrom<Initial>('absent', 'same', 'other');
  const scenarioArb = fc.record({
    initial: fc.tuple(initialArb, initialArb, initialArb),
    failing: fc.tuple(fc.boolean(), fc.boolean(), fc.boolean()),
  });

  function build(initial: Initial[], failing: boolean[]) {
    const tenant = TENANT.defaultTenantId;
    const users = new Map<string, FakeUser>();
    SEED_USERS.forEach((u, i) => {
      if (initial[i] !== 'absent') {
        users.set(u.email, {
          tenantId: initial[i] === 'same' ? tenant : `${tenant}-other`,
          sub: `existing-${i}`,
          groups: new Set(),
        });
      }
    });
    const failSet = new Set(SEED_USERS.filter((_, i) => failing[i]).map((u) => u.email));
    const created: string[] = [];
    const groupCalls: string[] = [];
    const printed: string[] = [];
    const errors: string[] = [];
    let counter = 0;
    const deps: SeedUsersDeps = {
      getPoolId: async () => 'pool-1',
      getUser: async (_pool, email) => {
        const u = users.get(email);
        return u === undefined ? undefined : { tenantId: u.tenantId, sub: u.sub };
      },
      createUser: async (_pool, u) => {
        if (failSet.has(u.email)) throw new Error('create failed');
        created.push(u.email);
        counter += 1;
        users.set(u.email, {
          tenantId: u.tenantId,
          sub: `new-${counter}`,
          password: u.temporaryPassword,
          groups: new Set(),
        });
        return { sub: `new-${counter}` };
      },
      addToGroup: async (_pool, email, group) => {
        groupCalls.push(email);
        users.get(email)!.groups.add(group);
      },
      randomInt: sourceFrom([7, 13, 29, 3, 101, 57, 11]),
      print: (l) => printed.push(l),
      error: (l) => errors.push(l),
    };
    return { deps, users, failSet, created, groupCalls, printed, errors, tenant };
  }

  it('creates exactly the missing users, leaves others untouched and prints passwords once', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ initial, failing }) => {
        const f = build(initial, failing);
        const before = new Map([...f.users].map(([k, v]) => [k, { ...v, groups: new Set(v.groups) }]));
        const code = await runSeedUsers(['dev-b'], f.deps);

        const expectedCreated = SEED_USERS.filter((u, i) => initial[i] === 'absent' && !f.failSet.has(u.email)).map(
          (u) => u.email,
        );
        expect([...f.created].sort()).toEqual([...expectedCreated].sort());

        SEED_USERS.forEach((u, i) => {
          const after = f.users.get(u.email);
          if (initial[i] === 'absent') {
            if (f.failSet.has(u.email)) expect(after).toBeUndefined();
            else expect(after?.groups.has(u.group)).toBe(true);
          } else {
            const b = before.get(u.email)!;
            expect(after?.tenantId).toBe(b.tenantId);
            expect(after?.sub).toBe(b.sub);
            expect(after?.password).toBeUndefined();
            // Group ensured only for present users with the right tenant.
            expect(f.groupCalls.includes(u.email)).toBe(initial[i] === 'same');
          }
          // Temporary password printed exactly once for created users, never otherwise.
          const pw = after?.password;
          const count = pw === undefined ? 0 : f.printed.filter((l) => l.includes(pw)).length;
          expect(count).toBe(expectedCreated.includes(u.email) ? 1 : 0);
          if (pw !== undefined) expect(f.errors.some((l) => l.includes(pw))).toBe(false);
        });

        const clean = initial.every((x) => x !== 'other') && f.failSet.size === 0;
        const failedOrMismatch =
          SEED_USERS.some((u, i) => initial[i] === 'other') ||
          SEED_USERS.some((u, i) => initial[i] === 'absent' && f.failSet.has(u.email));
        expect(code === 0).toBe(!failedOrMismatch);
        if (clean) expect(code).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('a second run after a clean first run creates nothing and returns 0', async () => {
    await fc.assert(
      fc.asyncProperty(fc.tuple(fc.boolean(), fc.boolean(), fc.boolean()), async (present) => {
        const f = build(present.map((p) => (p ? 'same' : 'absent')), [false, false, false]);
        expect(await runSeedUsers(['dev-b'], f.deps)).toBe(0);
        const createdAfterFirst = f.created.length;
        const printedAfterFirst = f.printed.length;
        expect(await runSeedUsers(['dev-b'], f.deps)).toBe(0);
        expect(f.created.length).toBe(createdAfterFirst);
        expect(f.printed.slice(printedAfterFirst).some((l) => l.startsWith('CREATED'))).toBe(false);
        for (const u of SEED_USERS) expect(f.users.get(u.email)?.groups.has(u.group)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
