export const STAGE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

export const STACK_NAMES = [
  'Foundation',
  'Auth',
  'Api',
  'Processing',
  'Agent',
  'Web',
  'Ops',
] as const;
export type StackName = (typeof STACK_NAMES)[number];

export const CI_PLACEHOLDER_ACCOUNT = 'ci-placeholder';

/** Validates the `stage` context value. Throws with the allowed format on any other input. */
export function parseStage(raw: unknown): string {
  if (typeof raw !== 'string' || !STAGE_PATTERN.test(raw)) {
    const shown = typeof raw === 'string' ? JSON.stringify(raw) : String(raw);
    throw new Error(
      `Context value "stage" is invalid: ${shown}. Use 1 to 32 characters: lowercase letters, digits and hyphens, starting with a letter. Example: -c stage=dev-b`,
    );
  }
  return raw;
}

/** CDK_DEFAULT_ACCOUNT when set and non-blank; the placeholder for `ci`; otherwise an error. */
export function resolveAccount(
  stage: string,
  env: Record<string, string | undefined>,
): string {
  const account = env.CDK_DEFAULT_ACCOUNT;
  if (account !== undefined && account.trim() !== '') {
    return account;
  }
  if (stage === 'ci') {
    return CI_PLACEHOLDER_ACCOUNT;
  }
  throw new Error(
    `CDK_DEFAULT_ACCOUNT is not set. Stage "${stage}" needs AWS credentials so CDK can find the account. Only stage "ci" runs without it.`,
  );
}

export function stackName(stage: string, name: StackName): string {
  return `ClaimsAgent-${stage}-${name}`;
}
