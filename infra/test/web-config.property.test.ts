// Owner: B (muzair110)
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ConfigError, isValidCspSource, validateStageConfig } from '../lib/stage-config.js';
import {
  CSP_KEYS,
  invalidCspSourceArb,
  nonStringArb,
  validCspConfigArb,
  validCspListArb,
  validCspSourceArb,
} from './helpers/csp-sources.js';

type Cfg = Record<string, unknown>;

const fileArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,15}\.json$/);
const keyArb = fc.constantFrom(...CSP_KEYS);

interface Mutation {
  key: string;
  /** Expected path in the message, for example `cspApiOrigins[1]`. */
  path: string;
  apply: (c: Cfg) => Cfg;
}
const set = (key: string, value: unknown) => (c: Cfg): Cfg => ({ ...c, [key]: value });

const mutationArb: fc.Arbitrary<Mutation> = fc.oneof(
  // key deleted
  keyArb.map<Mutation>((key) => ({
    key,
    path: key,
    apply: (c) => {
      const o = { ...c };
      delete o[key];
      return o;
    },
  })),
  // not an array
  fc
    .tuple(keyArb, fc.constantFrom<unknown>('text', null, 7, true, {}))
    .map<Mutation>(([key, bad]) => ({ key, path: key, apply: set(key, bad) })),
  // empty array
  keyArb.map<Mutation>((key) => ({ key, path: key, apply: set(key, []) })),
  // more than 4 entries
  fc
    .tuple(keyArb, fc.array(validCspSourceArb, { minLength: 5, maxLength: 8 }))
    .map<Mutation>(([key, list]) => ({ key, path: key, apply: set(key, list) })),
  // one invalid entry
  fc
    .tuple(keyArb, validCspListArb, fc.nat(3), fc.oneof(invalidCspSourceArb, nonStringArb))
    .map<Mutation>(([key, list, idx, bad]) => {
      const i = idx % list.length;
      return {
        key,
        path: `${key}[${i}]`,
        apply: set(
          key,
          list.map((o, j) => (j === i ? bad : o)),
        ),
      };
    }),
);

describe('web config properties', () => {
  // Feature: b-t07-web-stack, Property 1: New config keys are validated and defects are named
  // **Validates: Requirements 6.1, 6.3, 6.4**
  it('Property 1: accepts valid configs and names file and key path for any single defect', () => {
    fc.assert(
      fc.property(validCspConfigArb, mutationArb, fileArb, (cfg, mutation, file) => {
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
        expect(message).toContain(mutation.path);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: b-t07-web-stack, Property 2: CSP source validation accepts exactly the allowed forms
  // **Validates: Requirements 6.4, 6.5**
  it('Property 2: valid sources pass, every single-defect source and non-string fails', () => {
    fc.assert(
      fc.property(validCspSourceArb, invalidCspSourceArb, nonStringArb, (good, bad, other) => {
        expect(isValidCspSource(good)).toBe(true);
        expect(isValidCspSource(bad)).toBe(false);
        expect(isValidCspSource(other)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  // Feature: b-t07-web-stack, Property 3: Config round trip including the new keys
  // **Validates: Requirements 6.7**
  it('Property 3: a valid config survives a JSON round trip and is still accepted', () => {
    fc.assert(
      fc.property(validCspConfigArb, fileArb, (cfg, file) => {
        const parsed = JSON.parse(JSON.stringify(cfg)) as unknown;
        expect(parsed).toEqual(cfg);
        expect(validateStageConfig(parsed, file)).toEqual(cfg);
      }),
      { numRuns: 100 },
    );
  });
});
