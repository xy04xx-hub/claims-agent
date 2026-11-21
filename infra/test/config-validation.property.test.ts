import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ConfigError, validateStageConfig } from '../lib/stage-config.js';

// Feature: b-t04-cdk-skeleton, Property 5: Config validation rejects any single defect and names it
// **Validates: Requirements 5.7, 7.5**

const CAP_KEYS = [
  'phoneAccidentalDamage',
  'phoneTheft',
  'phoneLoss',
  'carWindscreenOrCosmetic',
  'carSevere',
] as const;
const POSITIVE_KEYS = [
  'maxTokens',
  'maxEvidenceImageBytes',
  'maxUploadBytes',
  'maxEvidenceFilesPerClaim',
  'maxDescriptionLength',
  'jobTicketTtlSeconds',
  'workerTimeoutSeconds',
  'sqsMaxReceiveCount',
] as const;

type Cfg = Record<string, unknown> & { autoApproveCaps: Record<string, unknown> };

const capArb = fc.integer({ min: 0, max: 1_000_000 });
const posArb = fc.integer({ min: 1, max: 100_000_000 });

const validConfigArb: fc.Arbitrary<Cfg> = fc
  .record({
    autoApproveCaps: fc.record(Object.fromEntries(CAP_KEYS.map((k) => [k, capArb]))),
    bedrockModelId: fc.stringMatching(/^[a-z][a-z0-9.:-]{0,59}$/),
    ...Object.fromEntries(POSITIVE_KEYS.map((k) => [k, posArb])),
    evidenceRetentionDays: fc.integer({ min: 1, max: 3650 }),
    consoleOrigins: fc.constant(['http://localhost:5173']),
    cspApiOrigins: fc.constant(['https://*.execute-api.us-east-1.amazonaws.com']),
    cspCognitoOrigins: fc.constant(['https://cognito-idp.us-east-1.amazonaws.com']),
    cspEvidenceOrigins: fc.constant(['https://*.s3.us-east-1.amazonaws.com']),
    earlyClaimDays: fc.integer({ min: 0, max: 365 }),
    frequencyWindowDays: fc.integer({ min: 1, max: 365 }),
    frequencyMaxClaims: fc.integer({ min: 1, max: 1000 }),
    outlierMultiple: fc.integer({ min: 1, max: 100 }),
  })
  .chain((base) =>
    fc
      .option(fc.constantFrom('DESTROY', 'RETAIN', 'SNAPSHOT'), { nil: undefined })
      .map((rp) => (rp === undefined ? base : { ...base, removalPolicy: rp })),
  ) as fc.Arbitrary<Cfg>;

const fileArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,15}\.json$/);

const wrongTypeArb = fc.constantFrom<unknown>('text', null, true, [], {}, 'NaN');

interface Mutation {
  key: string;
  apply: (c: Cfg) => Cfg;
}

const clone = (c: Cfg): Cfg => structuredClone(c);

const topKeys = ['autoApproveCaps', 'bedrockModelId', ...POSITIVE_KEYS];
const capPaths = CAP_KEYS.map((k) => `autoApproveCaps.${k}`);

const mutationArb: fc.Arbitrary<Mutation> = fc.oneof(
  // delete a required key
  fc.constantFrom(...topKeys, ...capPaths).map<Mutation>((path) => ({
    key: path,
    apply: (c) => {
      const o = clone(c);
      if (path.includes('.')) delete o.autoApproveCaps[path.split('.')[1]];
      else delete o[path];
      return o;
    },
  })),
  // wrong type
  fc
    .tuple(fc.constantFrom(...topKeys, ...capPaths), wrongTypeArb)
    .map<Mutation>(([path, bad]) => ({
      key: path,
      apply: (c) => {
        const o = clone(c);
        // a number is the wrong type for the string key
        const val = path === 'bedrockModelId' ? 42 : bad;
        if (path.includes('.')) o.autoApproveCaps[path.split('.')[1]] = val;
        else o[path] = val;
        return o;
      },
    })),
  // negative or non-numeric cap
  fc
    .tuple(
      fc.constantFrom(...CAP_KEYS),
      fc.oneof(
        fc.integer({ min: -1_000_000, max: -1 }),
        fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
        fc.string(),
      ),
    )
    .map<Mutation>(([k, bad]) => ({
      key: `autoApproveCaps.${k}`,
      apply: (c) => {
        const o = clone(c);
        o.autoApproveCaps[k] = bad;
        return o;
      },
    })),
  // empty model id
  fc.constantFrom('', '   ', '\t\n').map<Mutation>((v) => ({
    key: 'bedrockModelId',
    apply: (c) => ({ ...clone(c), bedrockModelId: v }),
  })),
  // removalPolicy outside the allowed names
  fc
    .string()
    .filter((s) => !['DESTROY', 'RETAIN', 'SNAPSHOT'].includes(s))
    .map<Mutation>((v) => ({
      key: 'removalPolicy',
      apply: (c) => ({ ...clone(c), removalPolicy: v }),
    })),
);

describe('Property 5: config validation', () => {
  it('rejects any single defect with an error naming the file and the key', () => {
    fc.assert(
      fc.property(validConfigArb, mutationArb, fileArb, (config, mutation, file) => {
        const mutated = mutation.apply(config);
        let caught: unknown;
        try {
          validateStageConfig(mutated, file);
        } catch (e) {
          caught = e;
        }
        expect(caught).toBeInstanceOf(ConfigError);
        const msg = (caught as Error).message;
        expect(msg).toContain(file);
        expect(msg).toContain(mutation.key);
      }),
      { numRuns: 200 },
    );
  });

  it('returns any unmutated valid config', () => {
    fc.assert(
      fc.property(validConfigArb, fileArb, (config, file) => {
        expect(validateStageConfig(config, file)).toEqual(config);
      }),
      { numRuns: 100 },
    );
  });
});
