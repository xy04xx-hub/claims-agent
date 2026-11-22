// Owner: B (muzair110)
// Wiring tests for the Api stack (T-08, task 8.4): dependency direction, exposed handles, source scan, buildApp.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import { afterAll, describe, expect, expectTypeOf, it } from 'vitest';
import { buildApp } from '../lib/build-app.js';
import { CI_PLACEHOLDER_ACCOUNT } from '../lib/stage.js';
import { loadStageConfig, resolveRemovalPolicy } from '../lib/stage-config.js';
import type { BaseStackProps } from '../lib/stack-props.js';
import { ApiStack, type ApiResources, type ApiStackProps } from '../lib/stacks/api-stack.js';
import type { AuthResources } from '../lib/stacks/auth-stack.js';

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

function stacksOf(app: cdk.App): Map<string, cdk.Stack> {
  const map = new Map<string, cdk.Stack>();
  for (const c of app.node.children) if (cdk.Stack.isStack(c)) map.set(c.node.id, c);
  return map;
}

describe('api wiring', () => {
  it('Api depends on Auth and Foundation only, and neither depends on Api', () => {
    const app = newApp();
    buildApp(app, makeProps('dev-a'));
    app.synth();
    const stacks = stacksOf(app);
    const api = stacks.get('Api')!;
    const auth = stacks.get('Auth')!;
    expect(api.dependencies).toContain(auth);
    expect(api.dependencies).toContain(stacks.get('Foundation')!);
    expect(stacks.get('Foundation')!.dependencies).not.toContain(api);
    expect(auth.dependencies).not.toContain(api);
    for (const other of ['Web', 'Processing', 'Agent', 'Ops']) {
      expect(api.dependencies, other).not.toContain(stacks.get(other)!);
    }
  }, 240_000);

  it('ApiStack is assignable to ApiResources, every field is defined and apiUrl has the documented form', () => {
    expectTypeOf<ApiStack>().toMatchTypeOf<ApiResources>();
    expectTypeOf<ApiStackProps['auth']>().toEqualTypeOf<AuthResources>();
    const app = newApp();
    buildApp(app, makeProps('dev-a'));
    const api = stacksOf(app).get('Api') as ApiStack;
    const resources: ApiResources = api;
    const fields: (keyof ApiResources)[] = ['httpApi', 'apiId', 'apiUrl', 'customerFunction', 'adjusterFunction'];
    for (const f of fields) expect(resources[f], f).toBeDefined();
    // `apiEndpoint` is the HTTP API's own `ApiEndpoint` attribute: a token that CloudFormation fills in with
    // `https://<id>.execute-api.<region>.amazonaws.com` (no trailing slash). The literal form cannot be seen at
    // synth time, so check that the token is that attribute of this API, not a hand-built string.
    expect(cdk.Token.isUnresolved(resources.apiUrl)).toBe(true);
    const url = api.resolve(resources.apiUrl) as { 'Fn::GetAtt'?: [string, string] };
    expect(url['Fn::GetAtt']?.[1]).toBe('ApiEndpoint');
    const apiId = api.resolve(resources.apiId) as { Ref?: string };
    expect(apiId.Ref).toBe(url['Fn::GetAtt']?.[0]);
  }, 240_000);

  it('buildApp creates the seven stacks with unchanged names', () => {
    const app = newApp();
    buildApp(app, makeProps('dev-a'));
    const stacks = [...stacksOf(app).values()];
    expect(stacks.map((s) => s.node.id).sort()).toEqual([
      'Agent',
      'Api',
      'Auth',
      'Foundation',
      'Ops',
      'Processing',
      'Web',
    ]);
    expect(stacks.map((s) => s.stackName).sort()).toEqual(
      ['Agent', 'Api', 'Auth', 'Foundation', 'Ops', 'Processing', 'Web'].map((n) => `ClaimsAgent-dev-a-${n}`),
    );
  }, 240_000);
});

describe('api source scan', () => {
  const platformDir = path.join(LIB_DIR, 'constructs/platform');
  const files = [
    path.join(LIB_DIR, 'stacks/api-stack.ts'),
    ...['api-model.ts', 'route-scoped-lambda-integration.ts'].map((f) => path.join(platformDir, f)),
  ];

  it('finds the stack file and the helper files', () => {
    expect(files).toHaveLength(3);
    for (const f of files) expect(fs.existsSync(f), f).toBe(true);
  });

  const forbidden: [string, RegExp][] = [
    ['importValue', /importValue/],
    ['exportName', /exportName/],
    ['arn:aws', /arn:aws/],
    ['12-digit number', /(?<!\d)\d{12}(?!\d)/],
    [
      'import of another stack',
      /from\s+['"][^'"]*(web-stack|processing-stack|agent-stack|ops-stack)(\.js)?['"]/,
    ],
    ['value import of auth-stack', /^import\s+(?!type\b)[^;]*from\s+['"][^'"]*auth-stack(\.js)?['"]/m],
    ['value import of foundation-stack', /^import\s+(?!type\b)[^;]*from\s+['"][^'"]*foundation-stack(\.js)?['"]/m],
  ];
  for (const file of files) {
    for (const [label, re] of forbidden) {
      it(`${path.basename(file)} has no ${label}`, () => {
        expect(fs.readFileSync(file, 'utf8')).not.toMatch(re);
      });
    }
  }
});
