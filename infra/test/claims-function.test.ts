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
    const [fn] = Object.values(t.findResources('AWS::Lambda::Function')) as Array<{ Properties: { Environment: { Variables: Record<string, string> } } }>;
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

  it('is instantiated only by Processing (the decision function and the evidence processor) and Auth (the pre token function): Foundation has the CDK auto-delete provider Lambda, the other stacks none', () => {
    const app = new App();
    const config = loadStageConfig('dev-a', path.resolve(here, '../config'), () => undefined);
    const props = {
      stage: 'dev-a',
      config,
      removalPolicy: RemovalPolicy.DESTROY,
      env: { account: CI_PLACEHOLDER_ACCOUNT, region: 'us-east-1' },
    };
    const foundation = new FoundationStack(app, 'Foundation', props);
    const web = new WebStack(app, 'Web', props);
    const stacks = [
      foundation,
      new AuthStack(app, 'Auth', { ...props, consoleUrl: web.consoleUrl }),
      new ApiStack(app, 'Api', props),
      web,
      new OpsStack(app, 'Ops', props),
      new ProcessingStack(app, 'Processing', { ...props, foundation }),
      new AgentStack(app, 'Agent', props),
    ];
    for (const s of stacks) {
      const t = Template.fromStack(s);
      if (s instanceof FoundationStack) {
        // Foundation: only the CDK-managed S3 auto-delete provider, no ClaimsFunction.
        t.resourceCountIs('AWS::Lambda::Function', 1);
        t.resourceCountIs('Custom::S3AutoDeleteObjects', 1);
        const [logicalId] = Object.keys(t.findResources('AWS::Lambda::Function'));
        expect(logicalId).toMatch(/^CustomS3AutoDeleteObjectsCustomResourceProvider/);
      } else if (s instanceof ProcessingStack) {
        // T-14 and T-13: the Decision Lambda and the Evidence Processor, both built with ClaimsFunction.
        t.resourceCountIs('AWS::Lambda::Function', 2);
      } else if (s instanceof AuthStack) {
        // T-06: the pre token generation function, built with ClaimsFunction.
        t.resourceCountIs('AWS::Lambda::Function', 1);
      } else if (s instanceof WebStack) {
        // Web: only the CDK-managed BucketDeployment handler (and auto-delete provider if present), no ClaimsFunction.
        const ids = Object.keys(t.findResources('AWS::Lambda::Function'));
        expect(ids.length).toBeGreaterThan(0);
        for (const id of ids) {
          expect(id).toMatch(/^(Custom(CDKBucketDeployment|S3AutoDeleteObjectsCustomResourceProvider))/);
        }
      } else {
        t.resourceCountIs('AWS::Lambda::Function', 0);
      }
    }
  });
});
