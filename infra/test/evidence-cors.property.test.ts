import { describe, it } from 'vitest';
import fc from 'fast-check';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { buildCorsRule } from '../lib/constructs/platform/evidence-bucket-config.js';
import { validOriginsArb } from './helpers/origins.js';

// Feature: b-t05-foundation-stack, Property 6: CORS rule allows POST from the configured origins only
// **Validates: Requirements 5.3, 5.4**
describe('Property 6: CORS rule', () => {
  it('allows POST only, from exactly the configured origins, never a wildcard', () => {
    fc.assert(
      fc.property(validOriginsArb, (origins) => {
        const rule = buildCorsRule(origins);
        return (
          rule.allowedMethods.length === 1 &&
          rule.allowedMethods[0] === s3.HttpMethods.POST &&
          rule.allowedOrigins.length === origins.length &&
          rule.allowedOrigins.every((o, i) => o === origins[i]) &&
          !rule.allowedOrigins.some((o) => o.includes('*'))
        );
      }),
      { numRuns: 100 },
    );
  });
});
