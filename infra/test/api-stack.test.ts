// Owner: B (muzair110)
// Template assertions for the ApiStack (T-08 task 8.2).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACCESS_LOG_FIELDS,
  API_ROUTES,
  CORS,
  type FunctionKey,
} from '../lib/constructs/platform/api-model.js';
import { CI_PLACEHOLDER_ACCOUNT } from '../lib/stage.js';
import { loadStageConfig, resolveRemovalPolicy, type StageConfig } from '../lib/stage-config.js';
import { ApiStack } from '../lib/stacks/api-stack.js';
import { AuthStack } from '../lib/stacks/auth-stack.js';

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
const CONSOLE_URL = 'https://abc.example.com';
const REGION = 'us-east-1';

type Res = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Built {
  stack: ApiStack;
  template: Template;
  config: StageConfig;
}

function build(stage: string, opts: { config?: Partial<StageConfig> } = {}): Built {
  const base = loadStageConfig(stage, CONFIG_DIR, () => undefined);
  const config = { ...base, ...opts.config };
  const removalPolicy = cdk.RemovalPolicy[resolveRemovalPolicy(stage, base)];
  const env = { account: CI_PLACEHOLDER_ACCOUNT, region: REGION };
  const app = new cdk.App({
    outdir: trackTmp(fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'cdk-test-'))),
  });
  const auth = new AuthStack(app, 'Auth', { stage, config, removalPolicy, consoleUrl: CONSOLE_URL, env });
  const stack = new ApiStack(app, 'Api', { stage, config, removalPolicy, auth, env });
  return { stack, template: Template.fromStack(stack), config };
}

const all = (t: Template, type: string): Res[] => Object.values(t.findResources(type)) as Res[];
const only = (t: Template, type: string): Res => {
  const found = all(t, type);
  expect(found).toHaveLength(1);
  return found[0]!;
};

let devA: Built;
let devB: Built;
let demo: Built;
let moved: Built;
const ORIGINS = ['http://localhost:5173', 'https://d111111abcdef8.cloudfront.net'];
beforeAll(() => {
  devA = build('dev-a');
  devB = build('dev-b');
  demo = build('demo');
  moved = build('dev-a', { config: { consoleOrigins: ORIGINS } });
}, 300_000);

const builds = (): Built[] => [devA, devB, demo];
const ROUTES_BY_KEY = new Map(API_ROUTES.map((r) => [r.routeKey, r]));

describe('http api', () => {
  it('is one HTTP API with no REST API, domain name or VPC link', () => {
    for (const { template } of builds()) {
      template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
      expect(only(template, 'AWS::ApiGatewayV2::Api').Properties.ProtocolType).toBe('HTTP');
      template.resourceCountIs('AWS::ApiGateway::RestApi', 0);
      template.resourceCountIs('AWS::ApiGatewayV2::DomainName', 0);
      template.resourceCountIs('AWS::ApiGatewayV2::VpcLink', 0);
      template.resourceCountIs('AWS::ApiGatewayV2::ApiMapping', 0);
    }
  });
});

describe('jwt authorizer', () => {
  it('is one JWT authorizer on the Authorization header with the Auth issuer', () => {
    for (const { template } of builds()) {
      const a = only(template, 'AWS::ApiGatewayV2::Authorizer').Properties;
      expect(a.AuthorizerType).toBe('JWT');
      expect(a.IdentitySource).toEqual(['$request.header.Authorization']);
      expect(a.JwtConfiguration.Issuer).not.toBeTypeOf('string');
      expect(JSON.stringify(a.JwtConfiguration.Issuer)).toContain('Fn::ImportValue');
    }
  });

  it('has one audience entry in dev-a and demo and two in dev-b', () => {
    expect(only(devA.template, 'AWS::ApiGatewayV2::Authorizer').Properties.JwtConfiguration.Audience).toHaveLength(1);
    expect(only(demo.template, 'AWS::ApiGatewayV2::Authorizer').Properties.JwtConfiguration.Audience).toHaveLength(1);
    expect(only(devB.template, 'AWS::ApiGatewayV2::Authorizer').Properties.JwtConfiguration.Audience).toHaveLength(2);
  });
});

describe('routes', () => {
  it('has nine routes, all JWT, no scopes, no NONE and no $default route', () => {
    for (const { template } of builds()) {
      const routes = all(template, 'AWS::ApiGatewayV2::Route');
      expect(routes).toHaveLength(9);
      expect(routes.map((r) => r.Properties.RouteKey as string).sort()).toEqual(
        API_ROUTES.map((r) => r.routeKey).sort(),
      );
      for (const r of routes) {
        expect(r.Properties.AuthorizationType).toBe('JWT');
        expect(r.Properties.AuthorizerId).toBeDefined();
        expect(r.Properties.AuthorizationScopes).toBeUndefined();
        expect(r.Properties.RouteKey).not.toBe('$default');
      }
    }
  });

  it('has nine AWS_PROXY 2.0 integrations with a 10 s timeout', () => {
    for (const { template } of builds()) {
      const ints = all(template, 'AWS::ApiGatewayV2::Integration');
      expect(ints).toHaveLength(9);
      for (const i of ints) {
        expect(i.Properties.IntegrationType).toBe('AWS_PROXY');
        expect(i.Properties.PayloadFormatVersion).toBe('2.0');
        expect(i.Properties.TimeoutInMillis).toBe(10000);
      }
    }
  });
});

describe('lambda permissions', () => {
  it('has one method-scoped permission per route on the right function', () => {
    for (const { template } of builds()) {
      // Map logical function ID to its function key through POWERTOOLS_SERVICE_NAME.
      const keyById = new Map<string, FunctionKey>();
      for (const [id, fn] of Object.entries(template.findResources('AWS::Lambda::Function'))) {
        keyById.set(id, (fn as Res).Properties.Environment.Variables.POWERTOOLS_SERVICE_NAME as FunctionKey);
      }
      const perms = all(template, 'AWS::Lambda::Permission');
      expect(perms).toHaveLength(9);
      const seen = new Set<string>();
      for (const p of perms) {
        expect(p.Properties.Action).toBe('lambda:InvokeFunction');
        expect(p.Properties.Principal).toBe('apigateway.amazonaws.com');
        const arn = JSON.stringify(p.Properties.SourceArn);
        expect(arn).not.toContain('/*/*');
        // The closing quote makes '/claims' not match '/claims/{claimId}'.
        const exact = API_ROUTES.filter((r) => arn.includes(`/*/${r.method}${r.path}"`));
        expect(exact).toHaveLength(1);
        const route = exact[0]!;
        seen.add(route.routeKey);
        const target = JSON.stringify(p.Properties.FunctionName);
        const fnId = [...keyById.keys()].find((id) => target.includes(`"${id}"`));
        expect(fnId).toBeDefined();
        expect(keyById.get(fnId!)).toBe(ROUTES_BY_KEY.get(route.routeKey)!.function);
      }
      expect(seen.size).toBe(9);
      const customer = API_ROUTES.filter((r) => r.function === 'api-customer').length;
      expect(customer).toBe(6);
      expect(API_ROUTES.length - customer).toBe(3);
    }
  });
});

describe('stage', () => {
  it('is $default with throttle 20/40 and a JSON access log of eleven fields', () => {
    for (const { template } of builds()) {
      const s = only(template, 'AWS::ApiGatewayV2::Stage').Properties;
      expect(s.StageName).toBe('$default');
      expect(s.DefaultRouteSettings.ThrottlingRateLimit).toBe(20);
      expect(s.DefaultRouteSettings.ThrottlingBurstLimit).toBe(40);
      const format = JSON.parse(s.AccessLogSettings.Format as string) as Record<string, string>;
      expect(Object.keys(format).sort()).toEqual(Object.keys(ACCESS_LOG_FIELDS).sort());
      expect(Object.keys(format)).toHaveLength(11);
      const text = s.AccessLogSettings.Format as string;
      for (const forbidden of [
        'identity',
        'sourceIp',
        'authorizer.claims',
        'authorizer.principalId',
        'requestOverride',
        'responseOverride',
        'request.header',
        'request.querystring',
        'request.path',
        'path',
        'body',
        'userAgent',
      ]) {
        expect(text).not.toContain(forbidden);
      }
    }
  });

  it('writes access logs to one 14 day group that is deleted with the stack', () => {
    for (const { template } of builds()) {
      // The function log groups keep two weeks too, so find the one the stage points to.
      const stage = only(template, 'AWS::ApiGatewayV2::Stage').Properties;
      const dest = JSON.stringify(stage.AccessLogSettings.DestinationArn);
      const entry = Object.entries(template.findResources('AWS::Logs::LogGroup')).filter(([id]) =>
        dest.includes(`"${id}"`),
      );
      expect(entry).toHaveLength(1);
      const group = entry[0]![1] as Res;
      expect(group.Properties.RetentionInDays).toBe(14);
      expect(group.DeletionPolicy).toBe('Delete');
    }
  });
});

describe('cors', () => {
  it('equals consoleOrigins with the fixed settings and no wildcard', () => {
    for (const { template, config } of [...builds(), moved]) {
      const c = only(template, 'AWS::ApiGatewayV2::Api').Properties.CorsConfiguration;
      expect(c.AllowOrigins).toEqual(config.consoleOrigins);
      expect(c.AllowMethods).toEqual([...CORS.allowMethods]);
      expect(c.AllowHeaders).toEqual([...CORS.allowHeaders]);
      expect(c.ExposeHeaders).toEqual([...CORS.exposeHeaders]);
      expect(c.MaxAge).toBe(CORS.maxAgeSeconds);
      expect(c.AllowCredentials).toBeFalsy();
      expect(JSON.stringify(c)).not.toContain('*');
    }
  });

  it('follows a changed consoleOrigins list', () => {
    const c = only(moved.template, 'AWS::ApiGatewayV2::Api').Properties.CorsConfiguration;
    expect(c.AllowOrigins).toEqual(ORIGINS);
  });
});

describe('functions and roles', () => {
  it('are two Node.js 22 ARM64 functions with the exact settings and environment', () => {
    for (const { template } of builds()) {
      const fns = all(template, 'AWS::Lambda::Function');
      expect(fns).toHaveLength(2);
      for (const f of fns) {
        const p = f.Properties;
        expect(p.Runtime).toBe('nodejs22.x');
        expect(p.Architectures).toEqual(['arm64']);
        expect(p.Timeout).toBe(10);
        expect(p.MemorySize).toBe(256);
        expect(p.TracingConfig).toEqual({ Mode: 'Active' });
        expect(Object.keys(p.Environment.Variables).sort()).toEqual([
          'AWS_NODEJS_CONNECTION_REUSE_ENABLED',
          'POWERTOOLS_METRICS_NAMESPACE',
          'POWERTOOLS_SERVICE_NAME',
        ]);
      }
      expect(fns.map((f) => f.Properties.Environment.Variables.POWERTOOLS_SERVICE_NAME).sort()).toEqual([
        'api-adjuster',
        'api-customer',
      ]);
    }
  });

  it('use two different roles that allow only logs and X-Ray actions', () => {
    for (const { template } of builds()) {
      const fns = all(template, 'AWS::Lambda::Function');
      const roles = fns.map((f) => JSON.stringify(f.Properties.Role));
      expect(new Set(roles).size).toBe(2);
      const statements: Res[] = [];
      for (const role of all(template, 'AWS::IAM::Role')) {
        for (const pol of (role.Properties.Policies ?? []) as Res[]) {
          statements.push(...(pol.PolicyDocument.Statement as Res[]));
        }
      }
      for (const pol of all(template, 'AWS::IAM::Policy')) {
        statements.push(...(pol.Properties.PolicyDocument.Statement as Res[]));
      }
      expect(statements.length).toBeGreaterThan(0);
      for (const s of statements) {
        const actions = ([] as string[]).concat(s.Action as string | string[]);
        for (const action of actions) {
          expect(action).toMatch(/^(logs|xray):/);
          expect(action).not.toBe('*');
        }
      }
      const text = JSON.stringify(statements);
      for (const banned of ['dynamodb', 's3:', 'sqs', 'ssm', 'kms', 'bedrock', 'cognito-idp', 'iam:PassRole']) {
        expect(text).not.toContain(banned);
      }
    }
  });
});

describe('resources and outputs', () => {
  it('holds only allow-listed resource types', () => {
    const allowed = new Set([
      'AWS::ApiGatewayV2::Api',
      'AWS::ApiGatewayV2::Authorizer',
      'AWS::ApiGatewayV2::Integration',
      'AWS::ApiGatewayV2::Route',
      'AWS::ApiGatewayV2::Stage',
      'AWS::Lambda::Function',
      'AWS::Lambda::Permission',
      'AWS::IAM::Role',
      'AWS::IAM::Policy', // X-Ray statements added by active tracing; the actions test covers them
      'AWS::Logs::LogGroup',
    ]);
    for (const { template } of builds()) {
      const types = Object.values(template.toJSON().Resources as Res).map((r) => r.Type as string);
      for (const type of types) expect(allowed).toContain(type);
    }
  });

  it('has exactly four outputs and no exports', () => {
    for (const { template } of builds()) {
      const outputs = (template.toJSON().Outputs ?? {}) as Res;
      expect(Object.keys(outputs).sort()).toEqual([
        'AdjusterFunctionName',
        'ApiId',
        'ApiUrl',
        'CustomerFunctionName',
      ]);
      for (const o of Object.values(outputs)) expect(o.Export).toBeUndefined();
    }
  });
});

describe('source scan', () => {
  const files = [
    path.join(LIB_DIR, 'stacks/api-stack.ts'),
    path.join(LIB_DIR, 'constructs/platform/api-model.ts'),
    path.join(LIB_DIR, 'constructs/platform/route-scoped-lambda-integration.ts'),
  ];

  it.each(files)('%s has no imports by name, ARNs, account numbers or NONE authorization', (file) => {
    const src = fs.readFileSync(file, 'utf8');
    expect(src).not.toMatch(/importValue/i);
    expect(src).not.toMatch(/exportName/i);
    expect(src).not.toContain('arn:aws');
    expect(src).not.toMatch(/\b\d{12}\b/);
    expect(src).not.toMatch(/\bNONE\b/);
  });
});
