// Owner: B (muzair110)
import { addTenantClaim, type PreTokenEventV2 } from './claim-mapping.js';

function log(
  level: 'INFO' | 'WARN',
  outcome: 'ok' | 'rejected',
  event: PreTokenEventV2,
  requestId: string | undefined,
): void {
  // Never log userAttributes, email, tokens or the tenant value.
  console.log(
    JSON.stringify({
      level,
      message: 'pre-token-generation',
      triggerSource: event?.triggerSource,
      clientId: event?.callerContext?.clientId,
      outcome,
      requestId,
    }),
  );
}

export const handler = async (
  event: PreTokenEventV2,
  context?: { awsRequestId?: string },
): Promise<PreTokenEventV2> => {
  const requestId = context?.awsRequestId;
  try {
    const out = addTenantClaim(event);
    log('INFO', 'ok', event, requestId);
    return out;
  } catch (e) {
    log('WARN', 'rejected', event, requestId);
    throw e; // Cognito fails the sign-in, so no token is issued
  }
};
