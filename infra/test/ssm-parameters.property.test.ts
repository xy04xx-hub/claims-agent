// Owner: B (muzair110)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  PARAMETER_KEYS,
  buildParameters,
  type ParameterKey,
} from '../lib/constructs/platform/ssm-parameters.js';
import type { StageConfig } from '../lib/stage-config.js';
import { STAGE_PATTERN } from '../lib/stage.js';

const here = dirname(fileURLToPath(import.meta.url));
const platformDir = join(here, '..', 'lib', 'constructs', 'platform');
const stackFile = join(here, '..', 'lib', 'stacks', 'foundation-stack.ts');

const stageArb = fc.stringMatching(STAGE_PATTERN);
const configArb: fc.Arbitrary<StageConfig> = fc
  .record({
    earlyClaimDays: fc.integer({ min: 0, max: 365 }),
    frequencyWindowDays: fc.integer({ min: 1, max: 365 }),
    frequencyMaxClaims: fc.integer({ min: 1, max: 1000 }),
    outlierMultiple: fc.double({ min: 0.01, max: 100, noNaN: true }),
  })
  .map((c) => c as unknown as StageConfig);

describe('Property 5: parameter names and values', () => {
  // Feature: b-t05-foundation-stack, Property 5: Parameter names and values follow the stage and the config
  // **Validates: Requirements 6.2, 6.3, 6.4, 6.6**
  it('follows the stage and the config', () => {
    fc.assert(
      fc.property(stageArb, configArb, (stage, config) => {
        const params = buildParameters(stage, config);
        const entries = PARAMETER_KEYS.map((k) => [k, params[k]] as const);
        const names = entries.map(([, p]) => p.name);
        if (Object.keys(params).length !== 5) return false;
        if (new Set(names).size !== 5) return false;
        if (!entries.every(([k, p]) => p.name === `/claims/${stage}/${k}`)) return false;
        if (params.autoApproveEnabled.value !== 'true') return false;
        const numeric: Exclude<ParameterKey, 'autoApproveEnabled'>[] = [
          'earlyClaimDays',
          'frequencyWindowDays',
          'frequencyMaxClaims',
          'outlierMultiple',
        ];
        return numeric.every((k) => Number(params[k].value) === config[k]);
      }),
      { numRuns: 200 },
    );
  });

  it('writes the /claims/ prefix only in ssm-parameters.ts', () => {
    const files = readdirSync(platformDir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => join(platformDir, f));
    if (existsSync(stackFile)) files.push(stackFile);
    expect(files.some((f) => f.endsWith('ssm-parameters.ts'))).toBe(true);
    const offenders = files
      .filter((f) => !f.endsWith('ssm-parameters.ts'))
      .filter((f) => /\/claims\/(?!\{)/.test(readFileSync(f, 'utf8'))); // API route paths such as /claims/{claimId} are not SSM names
    expect(offenders).toEqual([]);
    expect(readFileSync(join(platformDir, 'ssm-parameters.ts'), 'utf8')).toContain('/claims/');
  });
});
