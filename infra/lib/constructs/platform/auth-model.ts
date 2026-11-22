// Owner: B (muzair110)
// Pure constants for the Auth stack. Imports nothing from aws-cdk-lib so scripts can use it.

export const GROUP_NAMES = { customer: 'Customer', adjuster: 'Adjuster' } as const;
export type GroupName = (typeof GROUP_NAMES)[keyof typeof GROUP_NAMES];

export const TENANT = {
  /** Attribute name as declared on the pool. */
  attributeName: 'tenantId',
  /** Attribute name in the Cognito API and in the trigger event. */
  userAttribute: 'custom:tenantId',
  /** Claim name in the access token. */
  claim: 'tenantId',
  minLength: 1,
  maxLength: 40,
  /** Valid_Tenant_Id: no `#`, because keys use `tenantId#...`. */
  pattern: /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/,
  defaultTenantId: 't1',
} as const;

export const PASSWORD_POLICY = {
  minLength: 12,
  requireLowercase: true,
  requireUppercase: true,
  requireDigits: true,
  requireSymbols: true,
  tempPasswordValidityDays: 7,
} as const;

/** Attribute sets shared by the console client and the verification client. */
export const CLIENT_ATTRIBUTES = {
  read: ['email', 'email_verified', 'name', 'custom:tenantId'],
  write: ['name'],
} as const;

export const TOKEN_VALIDITY = { accessMinutes: 60, idMinutes: 60, refreshDays: 1 } as const;

export const TRIGGER = {
  entry: 'backend/auth/pre-token-generation/index.ts',
  timeoutSeconds: 5,
  memorySize: 256,
} as const;

export const CALLBACK_PATH = '/';
