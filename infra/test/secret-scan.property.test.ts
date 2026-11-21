// Feature: b-t04-cdk-skeleton, Property 6: Secret scan flags secret-like keys and account IDs only
// **Validates: Requirements 7.6, 7.7**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { scanForSecrets } from '../lib/stage-config.js';

const FILE = 'dev-x.json';

const validConfig = {
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
};

const caseVariant = (s: string) =>
  fc.array(fc.boolean(), { minLength: s.length, maxLength: s.length }).map((flags) =>
    [...s].map((c, i) => (flags[i] ? c.toUpperCase() : c.toLowerCase())).join(''),
  );

const affix = fc.stringMatching(/^[a-z]{0,6}$/);
const sep = fc.constantFrom('_', '-', '.', ' ');

// Keys that must be flagged: secret / password / token as a standalone word (any letter case,
// separated by a delimiter or a camelCase boundary), or "apikey" ignoring case and separators.
const prefix = fc.stringMatching(/^[a-z]{1,5}$/);
const standaloneWord = fc.constantFrom('secret', 'password', 'token').chain((w) =>
  fc.oneof(
    caseVariant(w),
    fc.tuple(prefix, sep, caseVariant(w)).map(([a, s, v]) => `${a}${s}${v}`),
    fc.tuple(caseVariant(w), sep, prefix).map(([v, s, b]) => `${v}${s}${b}`),
    // camelCase boundary: prefix + Capitalized word (e.g. authToken, dbPassword)
    prefix.map((a) => `${a}${w[0].toUpperCase()}${w.slice(1)}`),
  ),
);
const apiKey = fc.tuple(prefix, caseVariant('api'), fc.constantFrom('', '_', '-', '.'), caseVariant('key'), prefix)
  .map(([a, x, s, k, b]) => `${a}${x}${s}${k}${b}`);
const secretKey = fc.oneof(standaloneWord, apiKey);

const accountId = fc.stringMatching(/^[0-9]{12}$/);
const safeKey = fc.stringMatching(/^[a-z]{1,10}$/).filter((k) => !/secret|password|token|apikey/i.test(k));

describe('Property 6: secret scan', () => {
  it('passes for a valid stage config', () => {
    expect(() => scanForSecrets(validConfig, FILE)).not.toThrow();
  });

  it('passes for the maxTokens example and fails for authToken', () => {
    expect(() => scanForSecrets({ maxTokens: 1024 }, FILE)).not.toThrow();
    expect(() => scanForSecrets({ authToken: 'x' }, FILE)).toThrow(/authToken/);
  });

  it('throws naming the file and key for any added secret-like key', () => {
    fc.assert(
      fc.property(secretKey, fc.oneof(fc.string({ maxLength: 8 }).filter((s) => !/\d{12}/.test(s)), fc.integer()), (key, val) => {
        const cfg = { ...validConfig, [key]: val };
        expect(() => scanForSecrets(cfg, FILE)).toThrow(new RegExp(`${FILE}.*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      }),
      { numRuns: 200 },
    );
  });

  it('throws naming the file and key for an added 12-digit account ID value', () => {
    fc.assert(
      fc.property(safeKey, accountId, fc.stringMatching(/^[a-z:/-]{0,6}$/), (key, id, pre) => {
        fc.pre(!(key in validConfig));
        const cfg = { ...validConfig, [key]: `${pre}${id}` };
        expect(() => scanForSecrets(cfg, FILE)).toThrow(new RegExp(`${FILE}.*${key}`));
      }),
      { numRuns: 200 },
    );
  });

  it('passes for added benign keys with non-account values', () => {
    fc.assert(
      fc.property(safeKey, fc.oneof(fc.integer(), fc.boolean(), fc.stringMatching(/^[a-z0-9]{0,11}$/)), (key, val) => {
        expect(() => scanForSecrets({ ...validConfig, [key]: val }, FILE)).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });
});
