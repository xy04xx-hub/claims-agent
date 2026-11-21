import { describe, it } from 'vitest';
import fc from 'fast-check';
import * as cdk from 'aws-cdk-lib';
import { resolveDataProtection } from '../lib/constructs/platform/data-protection.js';
import { STAGE_PATTERN } from '../lib/stage.js';

// Feature: b-t05-foundation-stack, Property 4: Data protection depends only on the stage and the removal policy
// **Validates: Requirements 2.5, 2.6, 4.7, 4.8, 4.9, 8.1, 8.2, 8.3, 8.4**
const stageArb = fc.oneof(
  { arbitrary: fc.constant('demo'), weight: 3 },
  { arbitrary: fc.stringMatching(STAGE_PATTERN), weight: 5 },
);
const policyArb = fc.constantFrom(
  cdk.RemovalPolicy.DESTROY,
  cdk.RemovalPolicy.RETAIN,
  cdk.RemovalPolicy.SNAPSHOT,
);

describe('Property 4: data protection', () => {
  it('depends only on the stage and the removal policy', () => {
    fc.assert(
      fc.property(stageArb, policyArb, (stage, policy) => {
        const result = resolveDataProtection(stage, policy);
        const destroy = policy === cdk.RemovalPolicy.DESTROY;
        return (
          result.deletionProtection === (stage === 'demo') &&
          result.removalPolicy ===
            (destroy ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN) &&
          result.autoDeleteObjects === destroy &&
          (result.removalPolicy as cdk.RemovalPolicy) !== cdk.RemovalPolicy.SNAPSHOT
        );
      }),
      { numRuns: 200 },
    );
  });
});
