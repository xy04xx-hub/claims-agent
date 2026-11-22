// Owner: B (muzair110)
// Pure mapper for the Cognito pre token generation trigger (event version V2_0).
// Backend code must not import from `infra`, so the pattern is copied from
// infra/lib/constructs/platform/auth-model.ts (TENANT.pattern). A test keeps them equal.

export interface PreTokenEventV2 {
  triggerSource: string;
  userPoolId?: string;
  callerContext?: { clientId?: string };
  request: {
    userAttributes: Record<string, unknown>;
    clientMetadata?: Record<string, string>;
    [k: string]: unknown;
  };
  response: { claimsAndScopeOverrideDetails?: unknown; [k: string]: unknown };
  [k: string]: unknown;
}

/** Message never contains the attribute value. */
export class InvalidTenantError extends Error {
  constructor() {
    super('Missing or invalid tenantId attribute');
    this.name = 'InvalidTenantError';
  }
}

export const TENANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

const TENANT_USER_ATTRIBUTE = 'custom:tenantId';
const TENANT_CLAIM = 'tenantId';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Returns a new event with the access token claim `tenantId` set. The input is not changed. */
export function addTenantClaim<E extends PreTokenEventV2>(event: E): E {
  const value = event?.request?.userAttributes?.[TENANT_USER_ATTRIBUTE];
  if (typeof value !== 'string' || !TENANT_ID_PATTERN.test(value)) {
    throw new InvalidTenantError();
  }

  const copy = structuredClone(event);
  const response = copy.response as Record<string, unknown>;
  const details = isPlainObject(response.claimsAndScopeOverrideDetails)
    ? response.claimsAndScopeOverrideDetails
    : {};
  const access = isPlainObject(details.accessTokenGeneration) ? details.accessTokenGeneration : {};
  const claims = isPlainObject(access.claimsToAddOrOverride) ? access.claimsToAddOrOverride : {};

  claims[TENANT_CLAIM] = value;
  access.claimsToAddOrOverride = claims;
  details.accessTokenGeneration = access;
  response.claimsAndScopeOverrideDetails = details;
  return copy;
}
