import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateStageConfig, type StageConfig } from '../lib/stage-config.js';
// Feature: b-t04-cdk-skeleton, Property 7: Config round trip
// **Validates: Requirements 7.8**

// `+ 0` normalizes -0 to 0, which JSON cannot represent.
const cap = fc
  .double({ min: 0, max: 1e9, noNaN: true, noDefaultInfinity: true })
  .map((n) => n + 0);
const positive = fc.double({
  min: Number.MIN_VALUE,
  max: 1e9,
  noNaN: true,
  noDefaultInfinity: true,
});

const base = fc.record({
  autoApproveCaps: fc.record({
    phoneAccidentalDamage: cap,
    phoneTheft: cap,
    phoneLoss: cap,
    carWindscreenOrCosmetic: cap,
    carSevere: cap,
  }),
  bedrockModelId: fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9.:_-]{0,60}$/),
  maxTokens: positive,
  maxEvidenceImageBytes: positive,
  maxUploadBytes: positive,
  maxEvidenceFilesPerClaim: positive,
  maxDescriptionLength: positive,
  jobTicketTtlSeconds: positive,
  workerTimeoutSeconds: positive,
  sqsMaxReceiveCount: positive,
});

// removalPolicy is omitted (not undefined) when absent.
const validConfig: fc.Arbitrary<StageConfig> = fc
  .tuple(base, fc.constantFrom(undefined, 'DESTROY', 'RETAIN', 'SNAPSHOT' as const))
  .map(([b, rp]) => (rp === undefined ? b : { ...b, removalPolicy: rp }) as StageConfig);

describe('Property 7: Config round trip', () => {
  it('JSON round trip preserves the config and validation accepts it', () => {
    fc.assert(
      fc.property(validConfig, (c) => {
        const parsed: unknown = JSON.parse(JSON.stringify(c));
        expect(parsed).toEqual(c);
        expect(validateStageConfig(parsed, 'roundtrip.json')).toEqual(c);
      }),
      { numRuns: 100 },
    );
  });
});
