// Owner: B (muzair110)
// Template assertions for the WebStack (T-07 task 4.3).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import { buildCsp } from '../lib/constructs/platform/csp.js';
import { CI_PLACEHOLDER_ACCOUNT } from '../lib/stage.js';
import { loadStageConfig, resolveRemovalPolicy, type StageConfig } from '../lib/stage-config.js';
import { WebStack, type WebResources } from '../lib/stacks/web-stack.js';

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
const PLACEHOLDER_HTML = path.resolve(HERE, '../assets/web-placeholder');

type Res = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Built {
  app: cdk.App;
  stack: WebStack;
  template: Template;
  config: StageConfig;
}

function build(
  stage: string,
  opts: { policy?: cdk.RemovalPolicy; config?: Partial<StageConfig> } = {},
): Built {
  const base = loadStageConfig(stage, CONFIG_DIR, () => undefined);
  const config = { ...base, ...opts.config };
  const removalPolicy = opts.policy ?? cdk.RemovalPolicy[resolveRemovalPolicy(stage, base)];
  const app = new cdk.App();
  const stack = new WebStack(app, 'Web', {
    stage,
    config,
    removalPolicy,
    env: { account: CI_PLACEHOLDER_ACCOUNT, region: 'us-east-1' },
  });
  return { app, stack, template: Template.fromStack(stack), config };
}

const only = (t: Template, type: string): Res => {
  const found = Object.values(t.findResources(type)) as Res[];
  expect(found).toHaveLength(1);
  return found[0]!;
};

let dev: Built;
let demo: Built;
beforeAll(() => {
  dev = build('dev-a');
  demo = build('demo');
}, 120_000);

describe('console bucket', () => {
  it('is one private, SSL-only, SSE-S3 bucket without website or CORS', () => {
    for (const { template } of [dev, demo]) {
      template.resourceCountIs('AWS::S3::Bucket', 1);
      const b = only(template, 'AWS::S3::Bucket').Properties;
      expect(b.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
      expect(b.BucketEncryption.ServerSideEncryptionConfiguration).toEqual([
        { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
      ]);
      expect(b.OwnershipControls.Rules).toEqual([{ ObjectOwnership: 'BucketOwnerEnforced' }]);
      expect(b.BucketName).toBeUndefined();
      expect(b.WebsiteConfiguration).toBeUndefined();
      expect(b.CorsConfiguration).toBeUndefined();
    }
  });

  it('denies insecure transport and allows only CloudFront on the distribution ARN', () => {
    const policies = Object.values(dev.template.findResources('AWS::S3::BucketPolicy')) as Res[];
    expect(policies).toHaveLength(1);
    const stmts = policies[0]!.Properties.PolicyDocument.Statement as Res[];
    expect(
      stmts.some(
        (s) =>
          s.Effect === 'Deny' &&
          s.Condition?.Bool?.['aws:SecureTransport'] === 'false',
      ),
    ).toBe(true);
    const cf = stmts.filter((s) => s.Principal?.Service === 'cloudfront.amazonaws.com');
    expect(cf).toHaveLength(1);
    expect(cf[0]!.Effect).toBe('Allow');
    expect(cf[0]!.Condition.StringEquals['AWS:SourceArn']).toBeDefined();
    expect(JSON.stringify(cf[0]!.Condition)).toContain('Distribution');
    // No other statement may allow a principal outside the account root or the auto-delete role.
    const publicAllow = stmts.filter((s) => s.Effect === 'Allow' && s.Principal === '*');
    expect(publicAllow).toHaveLength(0);
  });
});

describe('distribution', () => {
  it('has one OAC origin, HTTPS redirect and read-only methods', () => {
    for (const { template } of [dev, demo]) {
      template.resourceCountIs('AWS::CloudFront::Distribution', 1);
      template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
      template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
        OriginAccessControlConfig: Match.objectLike({
          SigningBehavior: 'always',
          SigningProtocol: 'sigv4',
          OriginAccessControlOriginType: 's3',
        }),
      });
      const cfg = only(template, 'AWS::CloudFront::Distribution').Properties.DistributionConfig;
      expect(cfg.Origins).toHaveLength(1);
      expect(cfg.Origins[0].OriginAccessControlId).toBeDefined();
      expect(cfg.Origins[0].S3OriginConfig.OriginAccessIdentity).toBe('');
      expect(cfg.CacheBehaviors).toBeUndefined();
      const b = cfg.DefaultCacheBehavior;
      expect(b.ViewerProtocolPolicy).toBe('redirect-to-https');
      expect(b.AllowedMethods).toEqual(['GET', 'HEAD', 'OPTIONS']);
      expect(b.Compress).toBe(true);
      expect(b.ResponseHeadersPolicyId).toBeDefined();
      expect(cfg.DefaultRootObject).toBe('index.html');
      expect(cfg.PriceClass).toBe('PriceClass_100');
      expect(cfg.HttpVersion).toBe('http2and3');
      // The CDK omits the viewer certificate block with the default certificate, because CloudFront
      // ignores the minimum TLS version there (CFR4 is acknowledged). Whatever is emitted must be TLSv1.2_2021.
      expect(cfg.ViewerCertificate?.MinimumProtocolVersion ?? 'TLSv1.2_2021').toBe('TLSv1.2_2021');
      expect(cfg.ViewerCertificate?.AcmCertificateArn).toBeUndefined();
      expect(cfg.WebACLId).toBeUndefined();
      expect(cfg.Aliases).toBeUndefined();
      expect(cfg.Restrictions?.GeoRestriction?.RestrictionType ?? 'none').toBe('none');
      expect(cfg.Logging).toBeUndefined();
    }
  });

  it('returns /index.html with 200 and ttl 0 for 403 and 404 only', () => {
    const cfg = only(dev.template, 'AWS::CloudFront::Distribution').Properties.DistributionConfig;
    const errs = cfg.CustomErrorResponses as Res[];
    expect(errs).toHaveLength(2);
    expect(errs.map((e) => e.ErrorCode).sort()).toEqual([403, 404]);
    for (const e of errs) {
      expect(e.ResponseCode).toBe(200);
      expect(e.ResponsePagePath).toBe('/index.html');
      expect(e.ErrorCachingMinTTL).toBe(0);
    }
  });
});

describe('headers policy', () => {
  it('sets the five security headers with override and no CORS or custom headers', () => {
    for (const { template, config } of [dev, demo]) {
      template.resourceCountIs('AWS::CloudFront::ResponseHeadersPolicy', 1);
      const c = only(template, 'AWS::CloudFront::ResponseHeadersPolicy').Properties
        .ResponseHeadersPolicyConfig;
      expect(c.SecurityHeadersConfig).toEqual({
        StrictTransportSecurity: {
          AccessControlMaxAgeSec: 63072000,
          IncludeSubdomains: true,
          Preload: false,
          Override: true,
        },
        ContentTypeOptions: { Override: true },
        FrameOptions: { FrameOption: 'DENY', Override: true },
        ReferrerPolicy: { ReferrerPolicy: 'strict-origin-when-cross-origin', Override: true },
        ContentSecurityPolicy: { ContentSecurityPolicy: buildCsp(config), Override: true },
      });
      expect(c.CorsConfig).toBeUndefined();
      expect(c.CustomHeadersConfig).toBeUndefined();
    }
  });

  it('carries a changed config origin into the template CSP', () => {
    const extra = 'https://api2.example.com';
    const { template } = build('dev-a', {
      config: { cspApiOrigins: ['https://*.execute-api.us-east-1.amazonaws.com', extra] },
    });
    const c = only(template, 'AWS::CloudFront::ResponseHeadersPolicy').Properties
      .ResponseHeadersPolicyConfig;
    expect(c.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy).toContain(extra);
  }, 60_000);
});

describe('console deployment', () => {
  it('prunes, invalidates /* and retains on delete only in demo', () => {
    const d = only(dev.template, 'Custom::CDKBucketDeployment').Properties;
    const m = only(demo.template, 'Custom::CDKBucketDeployment').Properties;
    for (const p of [d, m]) {
      expect(p.Prune).toBe(true);
      expect(p.DistributionPaths).toEqual(['/*']);
      expect(p.DistributionId).toBeDefined();
    }
    expect(d.RetainOnDelete).toBe(false);
    expect(m.RetainOnDelete).toBe(true);
  });

  it('warns that the placeholder is deployed when frontend/dist is missing', () => {
    expect(fs.existsSync(path.resolve(HERE, '../../frontend/dist/index.html'))).toBe(false);
    Annotations.fromStack(dev.stack).hasWarning(
      '*',
      Match.stringLikeRegexp('placeholder page'),
    );
  });

  it('ships a placeholder with exactly index.html and no script, style or remote reference', () => {
    expect(fs.readdirSync(PLACEHOLDER_HTML)).toEqual(['index.html']);
    const html = fs.readFileSync(path.join(PLACEHOLDER_HTML, 'index.html'), 'utf8');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<style/i);
    expect(html).not.toMatch(/\sstyle=/i);
    expect(html).not.toMatch(/\son\w+=/i);
    expect(html).not.toMatch(/http/i);
  });
});

describe('removal policy', () => {
  const policyOf = (t: Template, type: string) => only(t, type).DeletionPolicy;

  it('deletes the bucket in dev-a and retains it in demo', () => {
    expect(policyOf(dev.template, 'AWS::S3::Bucket')).toBe('Delete');
    expect(policyOf(demo.template, 'AWS::S3::Bucket')).toBe('Retain');
  });

  it('enables auto-delete only where the bucket is deleted', () => {
    dev.template.resourceCountIs('Custom::S3AutoDeleteObjects', 1);
    demo.template.resourceCountIs('Custom::S3AutoDeleteObjects', 0);
  });

  it('always deletes the distribution, headers policy and OAC', () => {
    for (const { template } of [dev, demo]) {
      for (const type of [
        'AWS::CloudFront::Distribution',
        'AWS::CloudFront::ResponseHeadersPolicy',
        'AWS::CloudFront::OriginAccessControl',
      ]) {
        const p = only(template, type).DeletionPolicy;
        expect(p === undefined || p === 'Delete', type).toBe(true);
      }
    }
  });

  it('maps RETAIN and SNAPSHOT overrides in dev-a to Retain without auto-delete', () => {
    for (const policy of [cdk.RemovalPolicy.RETAIN, cdk.RemovalPolicy.SNAPSHOT]) {
      const { template } = build('dev-a', { policy });
      expect(policyOf(template, 'AWS::S3::Bucket')).toBe('Retain');
      template.resourceCountIs('Custom::S3AutoDeleteObjects', 0);
    }
  }, 60_000);
});

describe('outputs and resources', () => {
  it('has four outputs and no export', () => {
    for (const { template } of [dev, demo]) {
      const outputs = template.toJSON().Outputs as Res;
      expect(Object.keys(outputs).sort()).toEqual([
        'ConsoleBucketName',
        'ConsoleUrl',
        'DistributionDomainName',
        'DistributionId',
      ]);
      for (const o of Object.values(outputs)) expect((o as Res).Export).toBeUndefined();
    }
  });

  it('creates only the allowed resource types', () => {
    const allowed = new Set([
      'AWS::S3::Bucket',
      'AWS::S3::BucketPolicy',
      'AWS::CloudFront::Distribution',
      'AWS::CloudFront::OriginAccessControl',
      'AWS::CloudFront::ResponseHeadersPolicy',
      'Custom::CDKBucketDeployment',
      'Custom::S3AutoDeleteObjects',
      'AWS::Lambda::Function',
      'AWS::Lambda::LayerVersion',
      'AWS::IAM::Role',
      'AWS::IAM::Policy',
      'AWS::CDK::Metadata',
    ]);
    for (const { template } of [dev, demo]) {
      const types = new Set(
        Object.values(template.toJSON().Resources as Res).map((r) => (r as Res).Type as string),
      );
      for (const t of types) expect(allowed.has(t), t).toBe(true);
    }
  });

  it('only CDK-managed functions exist: deployment handler (and auto-delete in dev-a)', () => {
    const ids = (t: Template) => Object.keys(t.findResources('AWS::Lambda::Function'));
    expect(ids(dev.template)).toHaveLength(2);
    expect(ids(demo.template)).toHaveLength(1);
    expect(ids(demo.template)[0]).toMatch(/^CustomCDKBucketDeployment/);
  });
});

describe('wiring', () => {
  it('is assignable to WebResources with every field defined', () => {
    expectTypeOf<WebStack>().toMatchTypeOf<WebResources>();
    const resources: WebResources = dev.stack;
    for (const f of ['consoleBucket', 'distribution', 'distributionDomainName', 'consoleUrl'] as const) {
      expect(resources[f], f).toBeDefined();
    }
  });

  it('consumer depends on Web and Web depends on nothing', () => {
    const config = loadStageConfig('dev-a', CONFIG_DIR, () => undefined);
    const env = { account: CI_PLACEHOLDER_ACCOUNT, region: 'us-east-1' };
    const app = new cdk.App({ outdir: trackTmp(fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'cdk-test-'))) });
    const stack = new WebStack(app, 'Web', {
      stage: 'dev-a',
      config,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      env,
    });
    const consumer = new cdk.Stack(app, 'Consumer', { env });
    new cdk.CfnOutput(consumer, 'Url', { value: stack.consoleUrl });
    app.synth();
    expect(consumer.dependencies).toContain(stack);
    expect(stack.dependencies).toHaveLength(0);
  }, 60_000);
});

describe('web source scan', () => {
  const files = [
    path.join(LIB_DIR, 'stacks/web-stack.ts'),
    path.join(LIB_DIR, 'constructs/platform/csp.ts'),
    path.join(LIB_DIR, 'constructs/platform/console-assets.ts'),
  ];
  const forbidden: [string, RegExp][] = [
    ['importValue', /importValue/],
    ['exportName', /exportName/],
    ['arn:aws', /arn:aws/],
    ['12-digit number', /(?<!\d)\d{12}(?!\d)/],
    [
      'other stack import',
      /from\s+['"][^'"]*(foundation-stack|auth-stack|api-stack|processing-stack|agent-stack|ops-stack)(\.js)?['"]/,
    ],
  ];
  for (const file of files) {
    for (const [label, re] of forbidden) {
      it(`${path.basename(file)} has no ${label}`, () => {
        expect(fs.readFileSync(file, 'utf8')).not.toMatch(re);
      });
    }
  }
});
