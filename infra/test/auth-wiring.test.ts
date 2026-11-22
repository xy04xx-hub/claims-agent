// Owner: B (muzair110)
// Wiring tests for the Auth stack (T-06, task 6.6): dependency direction, exposed handles, source scan, buildApp.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { afterAll, describe, expect, expectTypeOf, it } from 'vitest';
import { buildApp } from '../lib/build-app.js';
import { CI_PLACEHOLDER_ACCOUNT } from '../lib/stage.js';
import { loadStageConfig, resolveRemovalPolicy } from '../lib/stage-config.js';
import type { BaseStackProps } from '../lib/stack-props.js';
import { AuthStack, type AuthResources } from '../lib/stacks/auth-stack.js';
import { WebStack } from '../lib/stacks/web-stack.js';

const tmpDirs: string[] = [];
const trackTmp = (dir: string): string => {
  tmpDirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

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
  return new cdk.App({ outdir: trackTmp(fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'cdk-test-'))) });
}

describe('auth wiring', () => {
  it('Auth depends on Web, a consumer depends on Auth, and no reverse dependency exists', () => {
    const app = newApp();
    const props = makeProps('dev-a');
    const web = new WebStack(app, 'Web', props);
    const auth = new AuthStack(app, 'Auth', { ...props, consoleUrl: web.consoleUrl });
    const consumer = new cdk.Stack(app, 'Consumer', { env: props.env });
    const role = new iam.Role(consumer, 'Role', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });
    role.addToPolicy(
      new iam.PolicyStatement({ actions: ['cognito-idp:DescribeUserPool'], resources: [auth.userPool.userPoolArn] }),
    );
    app.synth();
    expect(auth.dependencies).toContain(web);
    expect(web.dependencies).not.toContain(auth);
    expect(consumer.dependencies).toContain(auth);
    expect(auth.dependencies).not.toContain(consumer);
  }, 120_000);

  it('AuthStack is assignable to AuthResources, every field is defined and the strings have the documented form', () => {
    expectTypeOf<AuthStack>().toMatchTypeOf<AuthResources>();
    const app = newApp();
    const props = makeProps('dev-a');
    const web = new WebStack(app, 'Web', props);
    const auth = new AuthStack(app, 'Auth', { ...props, consoleUrl: web.consoleUrl });
    const resources: AuthResources = auth;
    const fields: (keyof AuthResources)[] = [
      'userPool',
      'appClient',
      'userPoolId',
      'appClientId',
      'issuerUrl',
      'cognitoDomain',
    ];
    for (const f of fields) expect(resources[f], f).toBeDefined();
    // Values are CDK tokens at synth time, so check the literal parts around the token.
    expect(resources.issuerUrl.startsWith('https://cognito-idp.us-east-1.amazonaws.com/')).toBe(true);
    expect(resources.cognitoDomain).toMatch(/^claims-dev-a-[0-9a-f]{8}\.auth\.us-east-1\.amazoncognito\.com$/);
  }, 120_000);

  it('buildApp creates the seven stacks with unchanged names', () => {
    const app = newApp();
    buildApp(app, makeProps('dev-a'));
    const names = app.node.children
      .filter((c): c is cdk.Stack => cdk.Stack.isStack(c))
      .map((s) => s.node.id)
      .sort();
    expect(names).toEqual(['Agent', 'Api', 'Auth', 'Foundation', 'Ops', 'Processing', 'Web']);
    const stackNames = app.node.children
      .filter((c): c is cdk.Stack => cdk.Stack.isStack(c))
      .map((s) => s.stackName)
      .sort();
    expect(stackNames).toEqual(
      ['Agent', 'Api', 'Auth', 'Foundation', 'Ops', 'Processing', 'Web'].map((n) => `ClaimsAgent-dev-a-${n}`),
    );
  }, 120_000);
});

describe('auth source scan', () => {
  const platformDir = path.join(LIB_DIR, 'constructs/platform');
  const files = [
    path.join(LIB_DIR, 'stacks/auth-stack.ts'),
    ...['auth-model.ts', 'cognito-domain.ts', 'app-client-urls.ts'].map((f) => path.join(platformDir, f)),
  ];

  it('finds the stack file and the helper files', () => {
    expect(files).toHaveLength(4);
    for (const f of files) expect(fs.existsSync(f), f).toBe(true);
  });

  const forbidden: [string, RegExp][] = [
    ['importValue', /importValue/],
    ['exportName', /exportName/],
    ['arn:aws', /arn:aws/],
    ['12-digit number', /(?<!\d)\d{12}(?!\d)/],
    ['web-stack, foundation-stack or api-stack import', /from\s+['"][^'"]*(web-stack|foundation-stack|api-stack)(\.js)?['"]/],
  ];
  for (const file of files) {
    for (const [label, re] of forbidden) {
      it(`${path.basename(file)} has no ${label}`, () => {
        expect(fs.readFileSync(file, 'utf8')).not.toMatch(re);
      });
    }
  }
});
