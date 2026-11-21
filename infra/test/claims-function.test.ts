import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, Duration, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { ClaimsFunction } from '../lib/constructs/claims-function.js';
import { AgentStack } from '../lib/stacks/agent-stack.js';
import { ApiStack } from '../lib/stacks/api-stack.js';
import { AuthStack } from '../lib/stacks/auth-stack.js';
import { FoundationStack } from '../lib/stacks/foundation-stack.js';
import { OpsStack } from '../lib/stacks/ops-stack.js';
import { ProcessingStack } from '../lib/stacks/processing-stack.js';
import { WebStack } from '../lib/stacks/web-stack.js';
import { CI_PLACEHOLDER_ACCOUNT } from '../lib/stage.js';
import { loadStageConfig } from '../lib/stage-config.js';
import { RemovalPolicy } from 'aws-cdk-lib';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, 'fixtures', 'handler.ts');

function build(props: Partial<ConstructorParameters<typeof ClaimsFunction>[2]> = {}) {
  const app = new App();
  const stack = new Stack(app, 'TestStack', { env: { account: CI_PLACEHOLDER_ACCOUNT, region: 'us-east-1' } });
  new ClaimsFunction(stack, 'test-fn', {
    entry,
    timeout: Duration.seconds(30),
    memorySize: 512,
    environment: { CLAIMS_TABLE: 'tbl' },
    ...props,
  });
  return Template.fromStack(stack);
}

describe('ClaimsFunction', () => {
  it('creates one Lambda with the standard settings', () => {
    const t = build();
    t.resourceCountIs('AWS::Lambda::Function', 1);
    t.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
      TracingConfig: { Mode: 'Active' },
      Timeout: 30,
      MemorySize: 512,
    });
  });

  it('adds only the caller variables and the two standard ones', () => {
    const t = build();
    const [fn] = Object.values(t.findResources('AWS::Lambda::Function')) as any[];
    expect(fn.Properties.Environment.Variables).toEqual({
      CLAIMS_TABLE: 'tbl',
      POWERTOOLS_SERVICE_NAME: 'test-fn',
      AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
    });
  });

  it('creates one role and one 14-day log group', () => {
    const t = build();
    t.resourceCountIs('AWS::IAM::Role', 1);
    t.resourceCountIs('AWS::Logs::LogGroup', 1);
    t.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 14 });
    t.hasResourceProperties('AWS::Lambda::Function', { Role: Match.anyValue() });
  });

  it.each([0, 901])('rejects timeout %s seconds', (s) => {
    expect(() => build({ timeout: Duration.seconds(s) })).toThrow(/timeout/);
  });

  it.each([127, 10241])('rejects memory %s MB', (m) => {
    expect(() => build({ memorySize: m })).toThrow(/memorySize/);
  });

  it('accepts the range boundaries', () => {
    expect(() => build({ timeout: Duration.seconds(1), memorySize: 128 })).not.toThrow();
    expect(() => build({ timeout: Duration.seconds(900), memorySize: 10240 })).not.toThrow();
  });

  it('is not instantiated by any stack: dev-a has zero Lambda functions', () => {
    const app = new App();
    const config = loadStageConfig('dev-a', path.resolve(here, '../config'), () => undefined);
    const props = {
      stage: 'dev-a',
      config,
      removalPolicy: RemovalPolicy.DESTROY,
      env: { account: CI_PLACEHOLDER_ACCOUNT, region: 'us-east-1' },
    };
    const stacks = [
      new FoundationStack(app, 'Foundation', props),
      new AuthStack(app, 'Auth', props),
      new ApiStack(app, 'Api', props),
      new WebStack(app, 'Web', props),
      new OpsStack(app, 'Ops', props),
      new ProcessingStack(app, 'Processing', props),
      new AgentStack(app, 'Agent', props),
    ];
    for (const s of stacks) {
      Template.fromStack(s).resourceCountIs('AWS::Lambda::Function', 0);
    }
  });
});
