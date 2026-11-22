// Owner: B (muzair110)
import type { PathParamName } from '../routes.js';

export const BODY_LIMIT_BYTES = 16 * 1024;
export const MAX_FIELD_ERRORS = 20;
export const MAX_FIELD_MESSAGE_LENGTH = 200;
export const SUB_MAX_LENGTH = 128;

/** Equals TENANT.pattern in infra/lib/constructs/platform/auth-model.ts (checked by a test). */
export const TENANT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

export const PATH_PARAM_PATTERNS: Readonly<Record<PathParamName, RegExp>> = {
  claimId: /^CLM-[A-Za-z0-9-]{1,40}$/,
  evidenceId: /^EVD-[A-Za-z0-9-]{1,40}$/,
};
