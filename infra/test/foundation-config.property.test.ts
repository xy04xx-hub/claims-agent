// Owner: B (muzair110)
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ConfigError, isValidConsoleOrigin, validateStageConfig } from '../lib/stage-config.js';
import { hostArb, validOriginArb, validOriginsArb } from './helpers/origins.js';

type Cfg = Record<string, unknown>;

const baseConfig: Cfg = {
  autoApproveCaps: {
    phoneAccidentalDamage: 500,
    phoneTheft: 300,
    phoneLoss: 0,
    carWindscreenOrCosmetic: 250,
    carSevere: 0,
  },
  bedrockModelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
  maxTokens: 1024,
  maxEvidenceImageBytes: 3670016,
  maxUploadBytes: 5242880,
  maxEvidenceFilesPerClaim: 6,
  maxDescriptionLength: 1000,
  jobTicketTtlSeconds: 60,
  workerTimeoutSeconds: 60,
  sqsMaxReceiveCount: 3,
  authLocalOrigins: ["http://localhost:5173"],
  enableVerificationClient: false,
  cspApiOrigins: ['https://*.execute-api.us-east-1.amazonaws.com'],
  cspCognitoOrigins: ['https://cognito-idp.us-east-1.amazonaws.com', 'https://*.amazoncognito.com'],
  cspEvidenceOrigins: ['https://*.s3.us-east-1.amazonaws.com'],
};

const validConfigArb: fc.Arbitrary<Cfg> = fc
  .record({
    evidenceRetentionDays: fc.integer({ min: 1, max: 3650 }),
    consoleOrigins: validOriginsArb,
    earlyClaimDays: fc.integer({ min: 0, max: 365 }),
    frequencyWindowDays: fc.integer({ min: 1, max: 365 }),
    frequencyMaxClaims: fc.integer({ min: 1, max: 1000 }),
    outlierMultiple: fc.double({ min: 0.01, max: 100, noNaN: true }),
  })
  .map((n) => ({ ...baseConfig, ...n }));

const fileArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,15}\.json$/);

const INT_RANGES: Record<string, [number, number]> = {
  evidenceRetentionDays: [1, 3650],
  earlyClaimDays: [0, 365],
  frequencyWindowDays: [1, 365],
  frequencyMaxClaims: [1, 1000],
};
const NEW_KEYS = [
  'evidenceRetentionDays',
  'consoleOrigins',
  'earlyClaimDays',
  'frequencyWindowDays',
  'frequencyMaxClaims',
  'outlierMultiple',
] as const;
const wrongTypeArb = fc.constantFrom<unknown>('text', null, true, {}, 'NaN');

interface Mutation {
  key: string;
  apply: (c: Cfg) => Cfg;
}
const set = (key: string, value: unknown) => (c: Cfg): Cfg => ({ ...c, [key]: value });

const mutationArb: fc.Arbitrary<Mutation> = fc.oneof(
  // key deleted
  fc.constantFrom(...NEW_KEYS).map<Mutation>((key) => ({
    key,
    apply: (c) => {
      const o = { ...c };
      delete o[key];
      return o;
    },
  })),
  // wrong type
  fc.tuple(fc.constantFrom(...NEW_KEYS), wrongTypeArb).map<Mutation>(([key, bad]) => ({
    key,
    apply: set(key, bad),
  })),
  // non-integer, below minimum, above maximum for integer keys
  fc
    .tuple(fc.constantFrom(...Object.keys(INT_RANGES)), fc.integer({ min: 1, max: 1000 }))
    .chain(([key, delta]) => {
      const [min, max] = INT_RANGES[key];
      return fc.constantFrom<unknown>(min + 0.5, min - delta, max + delta).map<Mutation>((v) => ({
        key,
        apply: set(key, v),
      }));
    }),
  // outlierMultiple out of range
  fc.constantFrom<unknown>(0, -1, 100.5, 1000, Infinity).map<Mutation>((v) => ({
    key: 'outlierMultiple',
    apply: set('outlierMultiple', v),
  })),
  // consoleOrigins: empty or more than 5
  fc.constant<Mutation>({ key: 'consoleOrigins', apply: set('consoleOrigins', []) }),
  fc.array(validOriginArb, { minLength: 6, maxLength: 10 }).map<Mutation>((list) => ({
    key: 'consoleOrigins',
    apply: set('consoleOrigins', list),
  })),
);

describe('foundation config properties', () => {
  // Feature: b-t05-foundation-stack, Property 1: New config keys are validated and defects are named
  // **Validates: Requirements 7.1, 7.3**
  it('Property 1: accepts valid configs and names file and key for any single defect', () => {
    fc.assert(
      fc.property(validConfigArb, mutationArb, fileArb, (cfg, mutation, file) => {
        expect(validateStageConfig(cfg, file)).toEqual(cfg);

        let error: unknown;
        try {
          validateStageConfig(mutation.apply(cfg), file);
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(ConfigError);
        const message = (error as ConfigError).message;
        expect(message).toContain(file);
        expect(message).toContain(mutation.key);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: b-t05-foundation-stack, Property 3: Config round trip including the new keys
  // **Validates: Requirements 7.6**
  it('Property 3: JSON round trip preserves the config and the parsed value validates', () => {
    fc.assert(
      fc.property(validConfigArb, fileArb, (cfg, file) => {
        const parsed = JSON.parse(JSON.stringify(cfg)) as Cfg;
        expect(parsed).toEqual(cfg);
        expect(validateStageConfig(parsed, file)).toEqual(cfg);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: b-t05-foundation-stack, Property 2: Console origin validation accepts exactly the allowed forms
  // **Validates: Requirements 7.4**
  it('Property 2: valid origins pass and every single-defect origin fails with its path named', () => {
    const defectArb: fc.Arbitrary<string | number> = fc
      .tuple(validOriginArb, hostArb, fc.stringMatching(/^[a-z0-9]{1,8}$/))
      .chain(([origin, host, seg]) => {
        const authority = origin.replace(/^https?:\/\//, '');
        return fc.constantFrom<string | number>(
          `${origin}/${seg}`, // path
          `${origin}/`, // trailing slash
          `${origin}?q=${seg}`, // query
          `${origin}#${seg}`, // fragment
          `https://*.${host}`, // wildcard subdomain
          `${origin}*`, // wildcard suffix
          `HTTPS://${authority}`, // uppercase scheme
          `ftp://${authority}`, // other scheme
          `http://${host === 'localhost' ? 'example' : host}`, // http for non-localhost
          `https://user@${authority}`, // credentials
          '', // empty
          42, // not a string
        );
      });

    fc.assert(
      fc.property(
        validOriginArb,
        defectArb,
        validOriginsArb,
        fc.nat(4),
        fileArb,
        (good, bad, list, idx, file) => {
          expect(isValidConsoleOrigin(good)).toBe(true);
          expect(isValidConsoleOrigin(bad)).toBe(false);

          const i = idx % list.length;
          const origins: unknown[] = list.map((o, j) => (j === i ? bad : o));
          let error: unknown;
          try {
            validateStageConfig(
              {
                ...baseConfig,
                evidenceRetentionDays: 90,
                consoleOrigins: origins,
                earlyClaimDays: 14,
                frequencyWindowDays: 30,
                frequencyMaxClaims: 3,
                outlierMultiple: 2,
              },
              file,
            );
          } catch (e) {
            error = e;
          }
          expect(error).toBeInstanceOf(ConfigError);
          const message = (error as ConfigError).message;
          expect(message).toContain(file);
          expect(message).toContain(`consoleOrigins[${i}]`);
        },
      ),
      { numRuns: 200 },
    );
  });
});
