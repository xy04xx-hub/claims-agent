// Owner: B (muzair110)
// Template assertions for the AuthStack (T-06 task 6.5).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAppClientUrls } from '../lib/constructs/platform/app-client-urls.js';
import {
  CLIENT_ATTRIBUTES,
  GROUP_NAMES,
  PASSWORD_POLICY,
  TENANT,
  TRIGGER,
} from '../lib/constructs/platform/auth-model.js';
import { cognitoDomainPrefix } from '../lib/constructs/platform/cognito-domain.js';
import { CI_PLACEHOLDER_ACCOUNT } from '../lib/stage.js';
import { loadStageConfig, resolveRemovalPolicy, type StageConfig } from '../lib/stage-config.js';
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
const CONSOLE_URL = 'https://abc.example.com';
const REGION = 'us-east-1';

type Res = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Built {
  stack: AuthStack;
  template: Template;
  config: StageConfig;
  account: string;
}

function build(
  stage: string,
  opts: { config?: Partial<StageConfig>; account?: string } = {},
): Built {
  const base = loadStageConfig(stage, CONFIG_DIR, () => undefined);
  const config = { ...base, ...opts.config };
  const account = opts.account ?? CI_PLACEHOLDER_ACCOUNT;
  const app = new cdk.App({
    outdir: trackTmp(fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'cdk-test-'))),
  });
  const stack = new AuthStack(app, 'Auth', {
    stage,
    config,
    removalPolicy: cdk.RemovalPolicy[resolveRemovalPolicy(stage, base)],
    consoleUrl: CONSOLE_URL,
    env: { account, region: REGION },
  });
  return { stack, template: Template.fromStack(stack), config, account };
}

const all = (t: Template, type: string): Res[] => Object.values(t.findResources(type)) as Res[];
const only = (t: Template, type: string): Res => {
  const found = all(t, type);
  expect(found).toHaveLength(1);
  return found[0]!;
};
const byLogicalPrefix = (t: Template, type: string, prefix: string): Res => {
  const entries = Object.entries(t.findResources(type)).filter(([id]) => id.startsWith(prefix));
  expect(entries).toHaveLength(1);
  return entries[0]![1] as Res;
};

let devA: Built;
let devB: Built;
let demo: Built;
beforeAll(() => {
  devA = build('dev-a');
  devB = build('dev-b');
  demo = build('demo');
}, 180_000);

describe('user pool', () => {
  it('is one Essentials, admin-create-only, email-sign-in pool with the password policy', () => {
    for (const { template } of [devA, devB, demo]) {
      const p = only(template, 'AWS::Cognito::UserPool').Properties;
      expect(p.UserPoolTier).toBe('ESSENTIALS');
      expect(p.AdminCreateUserConfig.AllowAdminCreateUserOnly).toBe(true);
      expect(p.UsernameAttributes).toEqual(['email']);
      expect(p.MfaConfiguration).toBe('OFF');
      expect(p.Policies.PasswordPolicy).toEqual({
        MinimumLength: PASSWORD_POLICY.minLength,
        RequireLowercase: true,
        RequireUppercase: true,
        RequireNumbers: true,
        RequireSymbols: true,
        TemporaryPasswordValidityDays: PASSWORD_POLICY.tempPasswordValidityDays,
      });
      // AccountRecovery.NONE is emitted as the admin_only mechanism: no self-service recovery.
      expect(p.AccountRecoverySetting.RecoveryMechanisms).toEqual([
        { Name: 'admin_only', Priority: 1 },
      ]);
    }
  });

  it('declares an immutable tenantId attribute of 1 to 40 characters', () => {
    const schema = only(devA.template, 'AWS::Cognito::UserPool').Properties.Schema as Res[];
    const tenant = schema.filter((s) => s.Name === TENANT.attributeName);
    expect(tenant).toHaveLength(1);
    expect(tenant[0]!.Mutable).toBe(false);
    expect(tenant[0]!.AttributeDataType).toBe('String');
    expect(tenant[0]!.StringAttributeConstraints).toEqual({
      MinLength: String(TENANT.minLength),
      MaxLength: String(TENANT.maxLength),
    });
  });

  it('uses the V2_0 pre token generation trigger pointing at the one function', () => {
    for (const { template } of [devA, devB, demo]) {
      const cfg = only(template, 'AWS::Cognito::UserPool').Properties.LambdaConfig
        .PreTokenGenerationConfig;
      expect(cfg.LambdaVersion).toBe('V2_0');
      expect(JSON.stringify(cfg.LambdaArn)).toContain('PreTokenGeneration');
    }
  });

  it('protects and retains the pool only in demo', () => {
    const d = only(demo.template, 'AWS::Cognito::UserPool');
    expect(d.Properties.DeletionProtection).toBe('ACTIVE');
    expect(d.DeletionPolicy).toBe('Retain');
    expect(d.UpdateReplacePolicy).toBe('Retain');
    const a = only(devA.template, 'AWS::Cognito::UserPool');
    expect(a.Properties.DeletionProtection).toBe('INACTIVE');
    expect(a.DeletionPolicy).toBe('Delete');
  });
});

describe('groups', () => {
  it('has exactly Customer and Adjuster, with no role and no precedence', () => {
    const groups = all(devA.template, 'AWS::Cognito::UserPoolGroup');
    expect(groups.map((g) => g.Properties.GroupName).sort()).toEqual(
      [GROUP_NAMES.adjuster, GROUP_NAMES.customer].sort(),
    );
    for (const g of groups) {
      expect(g.Properties.RoleArn).toBeUndefined();
      expect(g.Properties.Precedence).toBeUndefined();
    }
  });
});

describe('pre token generation function', () => {
  it('is one Node.js 22 ARM64 function with the configured limits and no extra variables', () => {
    const fn = only(devA.template, 'AWS::Lambda::Function').Properties;
    expect(fn.Runtime).toBe('nodejs22.x');
    expect(fn.Architectures).toEqual(['arm64']);
    expect(fn.Timeout).toBe(TRIGGER.timeoutSeconds);
    expect(fn.MemorySize).toBe(TRIGGER.memorySize);
    expect(Object.keys(fn.Environment.Variables).sort()).toEqual([
      'AWS_NODEJS_CONNECTION_REUSE_ENABLED',
      'POWERTOOLS_SERVICE_NAME',
    ]);
  });

  it('has one permission for cognito-idp scoped to the pool', () => {
    const perm = only(devA.template, 'AWS::Lambda::Permission').Properties;
    expect(perm.Principal).toBe('cognito-idp.amazonaws.com');
    expect(perm.Action).toBe('lambda:InvokeFunction');
    expect(JSON.stringify(perm.SourceArn)).toContain('UserPool');
    expect(perm.SourceArn['Fn::GetAtt']?.[1]).toBe('Arn');
  });

  it('has an IAM role limited to logs and X-Ray, with no data-store action anywhere', () => {
    const role = only(devA.template, 'AWS::IAM::Role').Properties;
    const inline = (role.Policies as Res[]).flatMap((p) => p.PolicyDocument.Statement as Res[]);
    // Active tracing makes the CDK add a default policy with the same two X-Ray actions.
    const attached = all(devA.template, 'AWS::IAM::Policy').flatMap(
      (p) => p.Properties.PolicyDocument.Statement as Res[],
    );
    const actions = new Set([...inline, ...attached].flatMap((s) => [s.Action].flat() as string[]));
    expect([...actions].sort()).toEqual([
      'logs:CreateLogStream',
      'logs:PutLogEvents',
      'xray:PutTelemetryRecords',
      'xray:PutTraceSegments',
    ]);
    expect(JSON.stringify(devA.template.toJSON())).not.toMatch(
      /"(dynamodb|s3|kms|ssm|sqs|bedrock)[:*]/i,
    );
  });
});

describe('managed login domain and branding', () => {
  it('has one prefix domain with managed login v2', () => {
    for (const b of [devA, devB, demo]) {
      const d = only(b.template, 'AWS::Cognito::UserPoolDomain').Properties;
      const stage = b.stack.stackName.replace(/^ClaimsAgent-/, '').replace(/-Auth$/, '');
      expect(d.Domain).toBe(cognitoDomainPrefix(stage, b.account, REGION));
      expect(d.ManagedLoginVersion).toBe(2);
    }
  });

  it('creates one branding with Cognito-provided values', () => {
    const b = only(devA.template, 'AWS::Cognito::ManagedLoginBranding');
    expect(b.Properties.UseCognitoProvidedValues).toBe(true);
    expect(JSON.stringify(b.DependsOn)).toContain('Domain');
  });
});

describe('console client', () => {
  const consoleClient = (t: Template): Res => byLogicalPrefix(t, 'AWS::Cognito::UserPoolClient', 'UserPoolConsoleClient');

  it('uses the code flow with openid and email only and no secret', () => {
    for (const { template } of [devA, devB, demo]) {
      const c = consoleClient(template).Properties;
      expect(c.GenerateSecret).toBeFalsy();
      expect(c.AllowedOAuthFlowsUserPoolClient).toBe(true);
      expect(c.AllowedOAuthFlows).toEqual(['code']);
      expect([...c.AllowedOAuthScopes].sort()).toEqual(['email', 'openid']);
      expect(c.SupportedIdentityProviders).toEqual(['COGNITO']);
    }
  });

  it('has no password flow', () => {
    for (const { template } of [devA, devB, demo]) {
      const flows = (consoleClient(template).Properties.ExplicitAuthFlows ?? []) as string[];
      expect(flows).not.toContain('ALLOW_USER_PASSWORD_AUTH');
      expect(flows).not.toContain('ALLOW_ADMIN_USER_PASSWORD_AUTH');
    }
  });

  it('uses callback and logout URLs from the builder', () => {
    for (const { template, config } of [devA, devB, demo]) {
      const urls = buildAppClientUrls(CONSOLE_URL, config.authLocalOrigins);
      const c = consoleClient(template).Properties;
      expect(c.CallbackURLs).toEqual(urls.callbackUrls);
      expect(c.LogoutURLs).toEqual(urls.logoutUrls);
      expect(c.CallbackURLs[0]).toBe(`${CONSOLE_URL}/`);
    }
  });

  it('sets token validity, revocation and hidden user existence', () => {
    const c = consoleClient(devA.template).Properties;
    expect(c.AccessTokenValidity).toBe(60);
    expect(c.IdTokenValidity).toBe(60);
    // The CDK expresses the 1-day refresh validity as 1440 minutes (one unit for all three tokens).
    expect(c.RefreshTokenValidity).toBe(1440);
    expect(c.TokenValidityUnits).toEqual({
      AccessToken: 'minutes',
      IdToken: 'minutes',
      RefreshToken: 'minutes',
    });
    expect(c.EnableTokenRevocation).toBe(true);
    expect(c.PreventUserExistenceErrors).toBe('ENABLED');
  });

  it('keeps read and write attributes in step with CLIENT_ATTRIBUTES', () => {
    const c = consoleClient(devA.template).Properties;
    expect([...c.ReadAttributes].sort()).toEqual([...CLIENT_ATTRIBUTES.read].sort());
    expect([...c.WriteAttributes].sort()).toEqual([...CLIENT_ATTRIBUTES.write].sort());
    // The tenant attribute is read-only for every client.
    expect(c.WriteAttributes).not.toContain(TENANT.userAttribute);
  });
});

describe('verification client', () => {
  const clients = (t: Template): Res[] => all(t, 'AWS::Cognito::UserPoolClient');

  it('exists only in dev-b, with password auth, no OAuth and the same attributes', () => {
    expect(clients(devA.template)).toHaveLength(1);
    expect(clients(demo.template)).toHaveLength(1);
    expect(clients(devB.template)).toHaveLength(2);
    const v = byLogicalPrefix(devB.template, 'AWS::Cognito::UserPoolClient', 'UserPoolVerificationClient')
      .Properties;
    const c = byLogicalPrefix(devB.template, 'AWS::Cognito::UserPoolClient', 'UserPoolConsoleClient')
      .Properties;
    expect(v.ExplicitAuthFlows).toContain('ALLOW_USER_PASSWORD_AUTH');
    expect(v.AllowedOAuthFlowsUserPoolClient).toBeFalsy();
    expect(v.AllowedOAuthFlows).toBeUndefined();
    expect(v.AllowedOAuthScopes).toBeUndefined();
    expect(v.CallbackURLs).toBeUndefined();
    expect(v.ReadAttributes).toEqual(c.ReadAttributes);
    expect(v.WriteAttributes).toEqual(c.WriteAttributes);
    expect(v.AccessTokenValidity).toBe(c.AccessTokenValidity);
    expect(v.TokenValidityUnits).toEqual(c.TokenValidityUnits);
  });

  it('is refused in demo when the flag is true', () => {
    expect(() => build('demo', { config: { enableVerificationClient: true } })).toThrow(
      /enableVerificationClient.*demo/,
    );
  });
});

describe('outputs', () => {
  it('has the four outputs (plus the verification client id in dev-b) and no exports', () => {
    const names = (b: Built): string[] =>
      Object.keys((b.template.toJSON() as Res).Outputs ?? {}).sort();
    const base = ['AppClientId', 'CognitoDomain', 'IssuerUrl', 'UserPoolId'];
    expect(names(devA)).toEqual(base);
    expect(names(demo)).toEqual(base);
    expect(names(devB)).toEqual([...base, 'VerificationClientId'].sort());
    for (const b of [devA, devB, demo]) {
      for (const o of Object.values((b.template.toJSON() as Res).Outputs as Record<string, Res>)) {
        expect(o.Export).toBeUndefined();
      }
    }
  });
});

describe('resource allow-list and account hiding', () => {
  const ALLOWED = new Set([
    'AWS::Cognito::UserPool',
    'AWS::Cognito::UserPoolGroup',
    'AWS::Cognito::UserPoolDomain',
    'AWS::Cognito::ManagedLoginBranding',
    'AWS::Cognito::UserPoolClient',
    'AWS::Lambda::Function',
    'AWS::Lambda::Permission',
    'AWS::IAM::Role',
    'AWS::IAM::Policy',
    'AWS::Logs::LogGroup',
    'AWS::CDK::Metadata',
  ]);

  it('contains only the allowed resource types', () => {
    for (const { template } of [devA, devB, demo]) {
      const types = Object.values((template.toJSON() as Res).Resources as Record<string, Res>).map(
        (r) => r.Type as string,
      );
      expect(types.filter((t) => !ALLOWED.has(t))).toEqual([]);
    }
  });

  it('does not write a test account ID into the template, except the CDK asset bucket name', () => {
    const fake = '987654321098';
    const { template } = build('dev-a', { account: fake });
    const json = template.toJSON() as Res;
    // The bootstrap asset bucket name (Lambda Code.S3Bucket) contains the account when the
    // environment is concrete. That is added by the CDK synthesizer, not by the stack.
    for (const r of Object.values(json.Resources as Record<string, Res>)) {
      if (r.Type === 'AWS::Lambda::Function') {
        expect(r.Properties.Code.S3Bucket).toContain(fake);
        delete r.Properties.Code.S3Bucket;
      }
    }
    expect(JSON.stringify(json)).not.toContain(fake);
  }, 60_000);
});
