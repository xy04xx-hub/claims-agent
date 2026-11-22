// Owner: B (muzair110)
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addTenantClaim, type PreTokenEventV2 } from './claim-mapping.js';

const RUNS = { numRuns: 100 };

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Valid tenant ids: 1 to 40 characters from [A-Za-z0-9_-], first character alphanumeric.
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split('');
const validTenantArb = fc
  .tuple(
    fc.constantFrom(...ALNUM),
    fc.array(fc.constantFrom(...ALNUM, '_', '-'), { maxLength: 39 }),
  )
  .map(([first, rest]) => first + rest.join(''));

const triggerSourceArb = fc.constantFrom(
  'TokenGeneration_HostedAuth',
  'TokenGeneration_Authentication',
  'TokenGeneration_NewPasswordChallenge',
  'TokenGeneration_AuthenticateDevice',
  'TokenGeneration_RefreshTokens',
  'TokenGeneration_Unknown',
);

const jsonValueArb = fc.jsonValue();

const stringMapArb = fc.dictionary(fc.string({ maxLength: 8 }), fc.string({ maxLength: 12 }), {
  maxKeys: 4,
});

// Existing override content: claims (possibly holding an old tenantId), scopes and group overrides.
const existingDetailsArb = fc.record(
  {
    accessTokenGeneration: fc.record(
      {
        claimsToAddOrOverride: fc.dictionary(
          fc.oneof(fc.constant('tenantId'), fc.string({ maxLength: 8 })),
          fc.string({ maxLength: 12 }),
          { maxKeys: 4 },
        ),
        claimsToSuppress: fc.array(fc.string({ maxLength: 8 }), { maxLength: 3 }),
        scopesToAdd: fc.array(fc.string({ maxLength: 8 }), { maxLength: 3 }),
        scopesToSuppress: fc.array(fc.string({ maxLength: 8 }), { maxLength: 3 }),
      },
      { requiredKeys: [] },
    ),
    idTokenGeneration: fc.record(
      { claimsToAddOrOverride: stringMapArb, claimsToSuppress: fc.array(fc.string({ maxLength: 8 })) },
      { requiredKeys: [] },
    ),
    groupOverrideDetails: fc.record(
      {
        groupsToOverride: fc.array(fc.string({ maxLength: 8 }), { maxLength: 3 }),
        iamRolesToOverride: fc.array(fc.string({ maxLength: 8 }), { maxLength: 3 }),
        preferredRole: fc.string({ maxLength: 8 }),
      },
      { requiredKeys: [] },
    ),
  },
  { requiredKeys: [] },
);

type ResponseShape = { present: false } | { present: true; value: unknown };

const responseDetailsArb: fc.Arbitrary<ResponseShape> = fc.oneof(
  fc.constant<ResponseShape>({ present: false }),
  fc.constant<ResponseShape>({ present: true, value: undefined }),
  fc.constant<ResponseShape>({ present: true, value: null }),
  fc.constant<ResponseShape>({ present: true, value: [] }),
  fc.constant<ResponseShape>({ present: true, value: {} }),
  existingDetailsArb.map<ResponseShape>((value) => ({ present: true, value })),
);

const validEventArb: fc.Arbitrary<PreTokenEventV2> = fc
  .record({
    triggerSource: triggerSourceArb,
    tenantId: validTenantArb,
    otherAttributes: fc.dictionary(
      fc.string({ maxLength: 10 }).filter((k) => k !== 'custom:tenantId'),
      jsonValueArb,
      { maxKeys: 4 },
    ),
    clientMetadata: fc.option(
      fc.record({ tenantId: fc.string({ maxLength: 12 }), other: fc.string({ maxLength: 12 }) }),
      { nil: undefined },
    ),
    clientId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
    extraResponse: fc.dictionary(
      fc.string({ maxLength: 8 }).filter((k) => k !== 'claimsAndScopeOverrideDetails'),
      jsonValueArb,
      { maxKeys: 3 },
    ),
    details: responseDetailsArb,
  })
  .map(({ triggerSource, tenantId, otherAttributes, clientMetadata, clientId, extraResponse, details }) => {
    const response: Record<string, unknown> = { ...extraResponse };
    if (details.present) response.claimsAndScopeOverrideDetails = details.value;
    const request: PreTokenEventV2['request'] = {
      userAttributes: { ...otherAttributes, 'custom:tenantId': tenantId },
    };
    if (clientMetadata !== undefined) request.clientMetadata = clientMetadata;
    const event: PreTokenEventV2 = { triggerSource, request, response };
    if (clientId !== undefined) event.callerContext = { clientId };
    return event;
  });

/** Independent model of the expected result, with the tenantId claim removed. */
function expectedWithoutTenantClaim(input: PreTokenEventV2): PreTokenEventV2 {
  const copy = structuredClone(input);
  const response = copy.response as Record<string, unknown>;
  const details = isPlainObject(response.claimsAndScopeOverrideDetails)
    ? response.claimsAndScopeOverrideDetails
    : {};
  const access = isPlainObject(details.accessTokenGeneration) ? details.accessTokenGeneration : {};
  const claims = isPlainObject(access.claimsToAddOrOverride) ? access.claimsToAddOrOverride : {};
  delete claims.tenantId;
  access.claimsToAddOrOverride = claims;
  details.accessTokenGeneration = access;
  response.claimsAndScopeOverrideDetails = details;
  return copy;
}

/** Typed path to the access token claims of a mapped event. */
type MappedDetails = {
  accessTokenGeneration: { claimsToAddOrOverride: Record<string, unknown> };
};
function accessClaims(event: PreTokenEventV2): Record<string, unknown> {
  return (event.response.claimsAndScopeOverrideDetails as MappedDetails).accessTokenGeneration
    .claimsToAddOrOverride;
}

// Feature: b-t06-auth-stack, Property 1
describe('Property 1: addTenantClaim sets the tenant claim from the user attribute and changes nothing else', () => {
  it('sets tenantId from the attribute and leaves everything else as it was', () => {
    fc.assert(
      fc.property(validEventArb, (event) => {
        const snapshot = structuredClone(event);
        deepFreeze(event);

        const result = addTenantClaim(event);

        expect(accessClaims(result).tenantId).toBe(
          event.request.userAttributes['custom:tenantId'],
        );

        const stripped = structuredClone(result);
        delete accessClaims(stripped).tenantId;
        expect(stripped).toEqual(expectedWithoutTenantClaim(snapshot));

        // The input was not changed (it is frozen, so a write would also have thrown).
        expect(event).toEqual(snapshot);
        expect(result).not.toBe(event);
      }),
      RUNS,
    );
  });

  it('ignores a different tenantId in clientMetadata', () => {
    fc.assert(
      fc.property(validEventArb, fc.string({ minLength: 1, maxLength: 12 }), (event, other) => {
        event.request.clientMetadata = { tenantId: `x${other}` };
        const result = addTenantClaim(event);
        expect(accessClaims(result).tenantId).toBe(
          event.request.userAttributes['custom:tenantId'],
        );
      }),
      RUNS,
    );
  });
});
