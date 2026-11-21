import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  resolveRemovalPolicy,
  type RemovalPolicyName,
  type StageConfig,
} from '../lib/stage-config.js';

// Feature: b-t04-cdk-skeleton, Property 4: Removal policy resolution
// **Validates: Requirements 5.3, 5.4, 5.5, 5.6**

const ALLOWED: readonly RemovalPolicyName[] = ['DESTROY', 'RETAIN', 'SNAPSHOT'];

const stageArb = fc.oneof(
  fc.constantFrom('ci', 'dev-a', 'dev-b', 'demo'),
  fc.stringMatching(/^[a-z][a-z0-9-]{0,31}$/),
);

const policyArb = fc.constantFrom<RemovalPolicyName>(...ALLOWED);

const baseConfig: StageConfig = {
  autoApproveCaps: {
    phoneAccidentalDamage: 500,
    phoneTheft: 300,
    phoneLoss: 0,
    carWindscreenOrCosmetic: 250,
    carSevere: 0,
  },
  bedrockModelId: 'model',
  maxTokens: 1,
  maxEvidenceImageBytes: 1,
  maxUploadBytes: 1,
  maxEvidenceFilesPerClaim: 1,
  maxDescriptionLength: 1,
  jobTicketTtlSeconds: 1,
  workerTimeoutSeconds: 1,
  sqsMaxReceiveCount: 1,
  evidenceRetentionDays: 90,
  consoleOrigins: ['http://localhost:5173'],
  cspApiOrigins: ['https://*.execute-api.us-east-1.amazonaws.com'],
  cspCognitoOrigins: ['https://cognito-idp.us-east-1.amazonaws.com', 'https://*.amazoncognito.com'],
  cspEvidenceOrigins: ['https://*.s3.us-east-1.amazonaws.com'],
  earlyClaimDays: 14,
  frequencyWindowDays: 30,
  frequencyMaxClaims: 3,
  outlierMultiple: 2,
};

const configArb = fc.option(policyArb, { nil: undefined }).map(
  (removalPolicy): StageConfig =>
    removalPolicy === undefined ? { ...baseConfig } : { ...baseConfig, removalPolicy },
);

describe('Property 4: removal policy resolution', () => {
  it('returns config.removalPolicy when set', () => {
    fc.assert(
      fc.property(stageArb, policyArb, (stage, removalPolicy) => {
        expect(resolveRemovalPolicy(stage, { ...baseConfig, removalPolicy })).toBe(removalPolicy);
      }),
      { numRuns: 100 },
    );
  });

  it('defaults to RETAIN for demo and DESTROY otherwise when unset', () => {
    fc.assert(
      fc.property(stageArb, (stage) => {
        expect(resolveRemovalPolicy(stage, { ...baseConfig })).toBe(
          stage === 'demo' ? 'RETAIN' : 'DESTROY',
        );
      }),
      { numRuns: 100 },
    );
  });

  it('always returns one of DESTROY, RETAIN, SNAPSHOT', () => {
    fc.assert(
      fc.property(stageArb, configArb, (stage, config) => {
        expect(ALLOWED).toContain(resolveRemovalPolicy(stage, config));
      }),
      { numRuns: 100 },
    );
  });
});
