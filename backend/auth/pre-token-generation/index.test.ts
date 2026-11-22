// Owner: B (muzair110)
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { TENANT } from '../../../infra/lib/constructs/platform/auth-model.js';
import { TENANT_ID_PATTERN, InvalidTenantError, type PreTokenEventV2 } from './claim-mapping.js';
import { handler } from './index.js';

const EMAIL = 'alice.example@claims-test.example';

function makeEvent(triggerSource: string, attrs?: Record<string, unknown>): PreTokenEventV2 {
  return {
    triggerSource,
    callerContext: { clientId: 'client-abc' },
    request: {
      userAttributes: attrs ?? { email: EMAIL, 'custom:tenantId': 't1' },
    },
    response: {},
  };
}

function accessClaims(e: PreTokenEventV2): unknown {
  const details = e.response.claimsAndScopeOverrideDetails as {
    accessTokenGeneration?: { claimsToAddOrOverride?: unknown };
  };
  return details.accessTokenGeneration?.claimsToAddOrOverride;
}

describe('pre token generation handler', () => {
  let spy: MockInstance<(...args: unknown[]) => void>;

  beforeEach(() => {
    spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    spy.mockRestore();
  });

  const sources = [
    'TokenGeneration_HostedAuth',
    'TokenGeneration_Authentication',
    'TokenGeneration_NewPasswordChallenge',
    'TokenGeneration_AuthenticateDevice',
    'TokenGeneration_RefreshTokens',
    'PreTokenGen_Unknown',
  ];

  it.each(sources)('adds the tenant claim for %s', async (source) => {
    const out = await handler(makeEvent(source), { awsRequestId: 'req-1' });
    expect(accessClaims(out)).toEqual({ tenantId: 't1' });
    expect(out.triggerSource).toBe(source);
  });

  it.each([
    ['absent', { email: EMAIL }],
    ['empty', { email: EMAIL, 'custom:tenantId': '' }],
    ['invalid', { email: EMAIL, 'custom:tenantId': 'a#b' }],
  ])('rejects a %s tenant attribute', async (_name, attrs) => {
    await expect(handler(makeEvent('TokenGeneration_Authentication', attrs))).rejects.toBeInstanceOf(
      InvalidTenantError,
    );
  });

  it('logs one JSON line with the expected fields and no email or tenant value', async () => {
    await handler(makeEvent('TokenGeneration_HostedAuth'), { awsRequestId: 'req-2' });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0]?.[0]);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      triggerSource: 'TokenGeneration_HostedAuth',
      clientId: 'client-abc',
      outcome: 'ok',
      requestId: 'req-2',
    });
    expect(line).not.toContain(EMAIL);
    expect(line).not.toContain('claims-test.example');
    expect(line).not.toContain('userAttributes');
  });

  it('logs a rejected outcome without the email and rethrows', async () => {
    await expect(
      handler(makeEvent('TokenGeneration_Authentication', { email: EMAIL }), { awsRequestId: 'req-3' }),
    ).rejects.toThrow();
    const line = String(spy.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({ outcome: 'rejected', requestId: 'req-3' });
    expect(line).not.toContain(EMAIL);
  });

  it('keeps the tenant pattern equal to the infra model', () => {
    expect(TENANT_ID_PATTERN.source).toBe(TENANT.pattern.source);
  });
});
