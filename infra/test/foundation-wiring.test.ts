// Owner: B (muzair110)
// Wiring tests for the Foundation stack (T-05, task 4.6): dependency direction, exposed handles, source scan.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { CI_PLACEHOLDER_ACCOUNT } from '../lib/stage.js';
import { loadStageConfig, resolveRemovalPolicy } from '../lib/stage-config.js';
import type { BaseStackProps } from '../lib/stack-props.js';
import { FoundationStack, type FoundationResources } from '../lib/stacks/foundation-stack.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.resolve(HERE, '../config');
const LIB_DIR = path.resolve(HERE, '../lib');

function makeProps(stage: string): BaseStackProps {
  const config = loadStageConfig(stage, CONFIG_DIR, () => undefined);
  return {
    stage,
    config,
    removalPolicy: cdk.RemovalPolicy[resolveRemovalPolicy(stage, config)],
    env: { account: CI_PLACEHOLDER_ACCOUNT, region: 'us-east-1' },
  };
}

function newApp(): cdk.App {
  return new cdk.App({ outdir: fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'cdk-test-')) });
}

describe('foundation wiring', () => {
  it('consumer stack depends on Foundation and not the other way round', () => {
    const app = newApp();
    const props = makeProps('dev-a');
    const foundation = new FoundationStack(app, 'Foundation', props);
    const consumer = new cdk.Stack(app, 'Consumer', { env: props.env });
    const role = new iam.Role(consumer, 'Role', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });
    foundation.claimsTable.grantReadData(role);
    foundation.dataKey.grantDecrypt(role);
    app.synth();
    expect(consumer.dependencies).toContain(foundation);
    expect(foundation.dependencies).not.toContain(consumer);
  }, 30_000);

  it('FoundationStack is assignable to FoundationResources and every field is defined', () => {
    expectTypeOf<FoundationStack>().toMatchTypeOf<FoundationResources>();
    const foundation = new FoundationStack(newApp(), 'Foundation', makeProps('dev-a'));
    const resources: FoundationResources = foundation;
    const fields: (keyof FoundationResources)[] = [
      'dataKey',
      'policiesTable',
      'claimsTable',
      'evidenceIndexTable',
      'claimTypePacksTable',
      'auditLogTable',
      'evidenceBucket',
      'autoApproveEnabledParameter',
      'earlyClaimDaysParameter',
      'frequencyWindowDaysParameter',
      'frequencyMaxClaimsParameter',
      'outlierMultipleParameter',
      'parameterNames',
    ];
    for (const f of fields) expect(resources[f], f).toBeDefined();
    expect(Object.keys(resources.parameterNames)).toHaveLength(5);
  }, 30_000);
});

describe('foundation source scan', () => {
  const files = [
    path.join(LIB_DIR, 'stacks/foundation-stack.ts'),
    ...fs
      .readdirSync(path.join(LIB_DIR, 'constructs/platform'))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => path.join(LIB_DIR, 'constructs/platform', f)),
  ];

  it('finds the stack file and the helper files', () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  const forbidden: [string, RegExp][] = [
    ['importValue', /importValue/],
    ['exportName', /exportName/],
    ['arn:aws', /arn:aws/],
    ['12-digit number', /(?<!\d)\d{12}(?!\d)/],
    ['web-stack or api-stack import', /from\s+['"][^'"]*(web-stack|api-stack)(\.js)?['"]/],
  ];
  for (const file of files) {
    for (const [label, re] of forbidden) {
      it(`${path.basename(file)} has no ${label}`, () => {
        expect(fs.readFileSync(file, 'utf8')).not.toMatch(re);
      });
    }
  }
});
