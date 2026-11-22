// Owner: B (muzair110). Seed users logic: creates synthetic Cognito users with injected dependencies.
import {
  GROUP_NAMES,
  PASSWORD_POLICY,
  TENANT,
  type GroupName,
} from '../../infra/lib/constructs/platform/auth-model.js';
import { parseStageArg } from './stage-arg.js';

export interface SeedUser {
  name: string;
  email: string;
  displayName: string;
  group: GroupName;
}

export const SEED_USERS: readonly SeedUser[] = [
  { name: 'customer1', email: 'customer1@example.com', displayName: 'Customer One', group: GROUP_NAMES.customer },
  { name: 'customer2', email: 'customer2@example.com', displayName: 'Customer Two', group: GROUP_NAMES.customer },
  { name: 'adjuster1', email: 'adjuster1@example.com', displayName: 'Adjuster One', group: GROUP_NAMES.adjuster },
];

export interface ExistingUser {
  tenantId?: string;
  sub?: string;
}

export interface SeedUsersDeps {
  /** Reads the Auth stack output UserPoolId. */
  getPoolId(stage: string): Promise<string>;
  /** Returns undefined when the user does not exist. */
  getUser(poolId: string, email: string): Promise<ExistingUser | undefined>;
  createUser(
    poolId: string,
    u: { email: string; displayName: string; tenantId: string; temporaryPassword: string },
  ): Promise<{ sub?: string }>;
  /** Idempotent in Cognito. */
  addToGroup(poolId: string, email: string, group: GroupName): Promise<void>;
  /** crypto.randomInt in production. */
  randomInt(maxExclusive: number): number;
  print(line: string): void;
  error(line: string): void;
}

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
// No quotes, backslash, `$` or space: safe to type on the hosted page and to paste into a shell.
const SYMBOLS = '!#%*+-=?@_^';
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;
const PASSWORD_LENGTH = 20;

export function generateTemporaryPassword(randomInt: (max: number) => number): string {
  const pick = (set: string): string => set[randomInt(set.length)]!;
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  const length = Math.max(PASSWORD_LENGTH, PASSWORD_POLICY.minLength);
  while (chars.length < length) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

interface SummaryRow {
  email: string;
  group: GroupName;
  tenant: string;
  sub: string;
}

export async function runSeedUsers(argv: string[], deps: SeedUsersDeps): Promise<number> {
  const parsed = parseStageArg(argv);
  if (!parsed.ok) {
    deps.error(parsed.usage);
    return 1;
  }
  const { stage } = parsed;

  let poolId: string;
  try {
    poolId = await deps.getPoolId(stage);
  } catch (e) {
    deps.error(`Could not read UserPoolId from stack ClaimsAgent-${stage}-Auth: ${(e as Error).message}`);
    return 1;
  }

  const tenantId = TENANT.defaultTenantId;
  const errors: string[] = [];
  const rows: SummaryRow[] = [];

  for (const user of SEED_USERS) {
    try {
      const existing = await deps.getUser(poolId, user.email);
      let sub = '';
      if (existing === undefined) {
        const temporaryPassword = generateTemporaryPassword(deps.randomInt);
        const created = await deps.createUser(poolId, {
          email: user.email,
          displayName: user.displayName,
          tenantId,
          temporaryPassword,
        });
        sub = created.sub ?? '';
        // Printed once, right after creation, and never kept anywhere else.
        deps.print(`CREATED ${user.email} temporary password: ${temporaryPassword}`);
        rows.push({ email: user.email, group: user.group, tenant: tenantId, sub });
        await deps.addToGroup(poolId, user.email, user.group);
      } else if (existing.tenantId === tenantId) {
        sub = existing.sub ?? '';
        deps.print(`EXISTS ${user.email} (password unchanged)`);
        rows.push({ email: user.email, group: user.group, tenant: tenantId, sub });
        await deps.addToGroup(poolId, user.email, user.group);
      } else {
        errors.push(`${user.email}: tenantId is immutable, delete the user and run again`);
      }
    } catch (e) {
      errors.push(`${user.email}: ${(e as Error).message}`);
    }
  }

  if (rows.length > 0) {
    deps.print('email | group | tenant | sub');
    for (const r of rows) deps.print(`${r.email} | ${r.group} | ${r.tenant} | ${r.sub}`);
  }
  for (const err of errors) deps.error(err);
  return errors.length === 0 ? 0 : 1;
}
