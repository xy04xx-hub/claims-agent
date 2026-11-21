// Feature: b-t04-cdk-skeleton, Property 2: Valid stages produce exactly the seven named stacks
// **Validates: Requirements 2.1, 2.3, 2.7, 5.1, 5.2**
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../lib/build-app.js';
import { STACK_NAMES, STAGE_PATTERN, stackName } from '../lib/stage.js';
import type { StageConfig } from '../lib/stage-config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(
  fs.readFileSync(path.resolve(here, '../config/default.json'), 'utf8'),
) as StageConfig;

const stageArb = fc.stringMatching(STAGE_PATTERN);
const accountArb = fc.stringMatching(/^[0-9]{12}$/);

describe('Property 2: stack set', () => {
  it('builds exactly seven stacks, named, in us-east-1, tagged', () => {
    fc.assert(
      fc.property(stageArb, accountArb, (stage, account) => {
        const app = new cdk.App();
        buildApp(app, {
          stage,
          config,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
          env: { account, region: 'us-east-1' },
        });
        app.synth(); // tags are applied by aspects during synthesis
        const stacks = app.node.children.filter(cdk.Stack.isStack) as cdk.Stack[];
        expect(stacks.map((s) => s.stackName).sort()).toEqual(
          STACK_NAMES.map((n) => stackName(stage, n)).sort(),
        );
        for (const s of stacks) {
          expect(s.region).toBe('us-east-1');
          expect(s.account).toBe(account);
          const tags = s.tags.tagValues();
          expect(tags.project).toBe('claims-agent');
          expect(tags.stage).toBe(stage);
        }
      }),
      { numRuns: 100 },
    );
    // Foundation synth is heavy; 100 full synths exceed the 5 s default.
  }, 60_000);
});
