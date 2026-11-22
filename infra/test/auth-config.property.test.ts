// Owner: B (muzair110)
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ConfigError, isValidLocalOrigin, validateStageConfig } from '../lib/stage-config.js';
import { hostArb, localOriginArb, localOriginsArb } from './helpers/origins.js';
import { validCspConfigArb } from './helpers/csp-sources.js';

type Cfg = Record<string, unknown>;

const validConfigArb: fc.Arbitrary<Cfg> = fc
  .tuple(validCspConfigArb, localOriginsArb, fc.boolean())
  .map(([cfg, authLocalOrigins, enableVerificationClient]) => ({
    ...cfg,
    authLocalOrigins,
    enableVerificationClient,
  }));

const fileArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,15}\.json$/);

/** An origin with exactly one defect. */
const badLocalOriginArb: fc.Arbitrary<unknown> = fc
  .tuple(localOriginArb, hostArb, fc.stringMatching(/^[a-z0-9]{1,8}$/))
  .chain(([origin, host, seg]) =>
    fc.constantFrom<unknown>(
      `https://${host}`, // https origin
      origin.replace('http://', 'https://'),
      `${origin}/${seg}`, // path
      `${origin}/`, // trailing slash
      `${origin}?q=${seg}`,
      `${origin}#${seg}`,
      'http://*.localhost', // wildcard
      `${origin}*`,
      origin.replace('http://', 'HTTP://'), // uppercase scheme
      'http://localhost:0', // port 0
      'http://localhost:65536', // port too high
      `http://user@localhost`,
      '',
      42,
    ),
  );

interface Mutation {
  key: string;
  apply: (c: Cfg) => Cfg;
}
const set = (key: string, value: unknown) => (c: Cfg): Cfg => ({ ...c, [key]: value });
const KEYS = ['authLocalOrigins', 'enableVerificationClient'] as const;

const mutationArb: fc.Arbitrary<Mutation> = fc.oneof(
  // key deleted
  fc.constantFrom(...KEYS).map<Mutation>((key) => ({
    key,
    apply: (c) => {
      const o = { ...c };
      delete o[key];
      return o;
    },
  })),
  // wrong type
  fc
    .tuple(fc.constantFrom(...KEYS), fc.constantFrom<unknown>('text', null, 1, {}, 'true'))
    .map<Mutation>(([key, bad]) => ({ key, apply: set(key, bad) })),
  // enableVerificationClient must be a boolean
  fc.constantFrom<unknown>('true', 0, 1, [], undefined).map<Mutation>((v) => ({
    key: 'enableVerificationClient',
    apply: set('enableVerificationClient', v),
  })),
  // four origins
  fc.array(localOriginArb, { minLength: 4, maxLength: 6 }).map<Mutation>((list) => ({
    key: 'authLocalOrigins',
    apply: set('authLocalOrigins', list),
  })),
);

describe('auth config properties', () => {
  // Feature: b-t06-auth-stack, Property 5
  // **Validates: Requirements 9.1, 9.3, 9.4, 9.6**
  it('Property 5: names file and key for any single defect in the new keys', () => {
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

  // Feature: b-t06-auth-stack, Property 5
  it('Property 5: a bad local origin fails with its index named', () => {
    fc.assert(
      fc.property(
        validConfigArb,
        localOriginArb,
        badLocalOriginArb,
        fc.nat(2),
        fileArb,
        (cfg, good, bad, idx, file) => {
          expect(isValidLocalOrigin(good)).toBe(true);
          expect(isValidLocalOrigin(bad)).toBe(false);
          const base = (cfg.authLocalOrigins as string[]).length > 0 ? (cfg.authLocalOrigins as string[]) : [good];
          const i = idx % base.length;
          const origins: unknown[] = base.map((o, j) => (j === i ? bad : o));
          let error: unknown;
          try {
            validateStageConfig({ ...cfg, authLocalOrigins: origins }, file);
          } catch (e) {
            error = e;
          }
          expect(error).toBeInstanceOf(ConfigError);
          const message = (error as ConfigError).message;
          expect(message).toContain(file);
          expect(message).toContain(`authLocalOrigins[${i}]`);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: b-t06-auth-stack, Property 5
  it('Property 5: JSON round trip preserves the config and the parsed value validates', () => {
    fc.assert(
      fc.property(validConfigArb, fileArb, (cfg, file) => {
        const parsed = JSON.parse(JSON.stringify(cfg)) as Cfg;
        expect(parsed).toEqual(cfg);
        expect(validateStageConfig(parsed, file)).toEqual(cfg);
      }),
      { numRuns: 200 },
    );
  });
});
