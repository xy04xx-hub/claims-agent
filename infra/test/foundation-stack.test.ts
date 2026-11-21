// Template assertions for the FoundationStack (T-05 task 4.3).
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { TABLE_SPECS } from '../lib/constructs/platform/data-model.js';
import { FoundationStack } from '../lib/stacks/foundation-stack.js';
import { CI_PLACEHOLDER_ACCOUNT } from '../lib/stage.js';
import { loadStageConfig, resolveRemovalPolicy, type StageConfig } from '../lib/stage-config.js';

const CONFIG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../config');

function build(
  stage: string,
  opts: { policy?: cdk.RemovalPolicy; config?: Partial<StageConfig> } = {},
): Template {
  const base = loadStageConfig(stage, CONFIG_DIR, () => undefined);
  const config = { ...base, ...opts.config };
  const removalPolicy = opts.policy ?? cdk.RemovalPolicy[resolveRemovalPolicy(stage, base)];
  const app = new cdk.App();
  const stack = new FoundationStack(app, 'Foundation', {
    stage,
    config,
    removalPolicy,
    env: { account: CI_PLACEHOLDER_ACCOUNT, region: 'us-east-1' },
  });
  return Template.fromStack(stack);
}

type Res = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const policyOf = (r: Res) => r.DeletionPolicy;

let dev: Template;
let demo: Template;
beforeAll(() => {
  dev = build('dev-a');
  demo = build('demo');
}, 60_000);

describe('data key', () => {
  it('is one symmetric rotating key with stage-dependent deletion', () => {
    for (const t of [dev, demo]) {
      t.resourceCountIs('AWS::KMS::Key', 1);
      t.hasResourceProperties('AWS::KMS::Key', { EnableKeyRotation: true });
    }
    const [d] = Object.values(dev.findResources('AWS::KMS::Key')) as Res[];
    const [m] = Object.values(demo.findResources('AWS::KMS::Key')) as Res[];
    expect(policyOf(d!)).toBe('Delete');
    expect(d!.Properties.PendingWindowInDays).toBe(7);
    expect(policyOf(m!)).toBe('Retain');
    const spec = d!.Properties.KeySpec;
    expect(spec === undefined || spec === 'SYMMETRIC_DEFAULT').toBe(true);
  });
  it('keeps the account-root statement in the key policy', () => {
    const [k] = Object.values(dev.findResources('AWS::KMS::Key')) as Res[];
    const stmts = k!.Properties.KeyPolicy.Statement as Res[];
    expect(stmts.some((s) => s.Action === 'kms:*' && s.Principal?.AWS !== undefined)).toBe(true);
  });
});

describe('tables', () => {
  it.each([
    ['dev-a', false],
    ['demo', true],
  ])('%s: five encrypted PITR on-demand tables, deletion protection=%s', (stage, protectedDel) => {
    const t = stage === 'demo' ? demo : dev;
    t.resourceCountIs('AWS::DynamoDB::Table', 5);
    const tables = Object.values(t.findResources('AWS::DynamoDB::Table')) as Res[];
    for (const r of tables) {
      const p = r.Properties;
      expect(p.TableName).toBeUndefined();
      expect(p.BillingMode).toBe('PAY_PER_REQUEST');
      expect(p.SSESpecification).toMatchObject({ SSEEnabled: true, SSEType: 'KMS' });
      expect(p.SSESpecification.KMSMasterKeyId).toBeDefined();
      expect(p.PointInTimeRecoverySpecification).toEqual({ PointInTimeRecoveryEnabled: true });
      expect(p.DeletionProtectionEnabled ?? false).toBe(protectedDel);
      expect(policyOf(r)).toBe(protectedDel ? 'Retain' : 'Delete');
      expect(p.KeySchema).toEqual([
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ]);
      for (const a of p.AttributeDefinitions) expect(a.AttributeType).toBe('S');
    }
  });

  it('matches TABLE_SPECS: tables, index names, keys and ALL projection', () => {
    const tables = Object.entries(dev.findResources('AWS::DynamoDB::Table')) as [string, Res][];
    expect(tables).toHaveLength(TABLE_SPECS.length);
    for (const spec of TABLE_SPECS) {
      const hit = tables.find(([id]) => id.startsWith(`${spec.id}Table`));
      expect(hit, `table ${spec.id}`).toBeDefined();
      const gsis = (hit![1].Properties.GlobalSecondaryIndexes ?? []) as Res[];
      expect(gsis.map((g) => g.IndexName).sort()).toEqual(spec.indexes.map((i) => i.name).sort());
      for (const idx of spec.indexes) {
        const g = gsis.find((x) => x.IndexName === idx.name)!;
        expect(g.Projection).toEqual({ ProjectionType: 'ALL' });
        const expected = [{ AttributeName: idx.pk, KeyType: 'HASH' }];
        if (idx.sk) expected.push({ AttributeName: idx.sk, KeyType: 'RANGE' });
        expect(g.KeySchema).toEqual(expected);
      }
    }
  });
});

describe('evidence bucket', () => {
  const bucketProps = (t: Template): Res =>
    (Object.values(t.findResources('AWS::S3::Bucket')) as Res[])[0]!.Properties;

  it('is private, SSL-only, KMS encrypted, unversioned, owner enforced', () => {
    for (const t of [dev, demo]) {
      t.resourceCountIs('AWS::S3::Bucket', 1);
      const p = bucketProps(t);
      expect(p.BucketName).toBeUndefined();
      expect(p.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
      const enc = p.BucketEncryption.ServerSideEncryptionConfiguration[0];
      expect(enc.ServerSideEncryptionByDefault.SSEAlgorithm).toBe('aws:kms');
      expect(enc.ServerSideEncryptionByDefault.KMSMasterKeyID).toBeDefined();
      expect(enc.BucketKeyEnabled).toBe(true);
      expect(p.VersioningConfiguration).toBeUndefined();
      expect(p.OwnershipControls.Rules).toEqual([{ ObjectOwnership: 'BucketOwnerEnforced' }]);
      t.hasResourceProperties('AWS::S3::BucketPolicy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Deny',
              Action: 's3:*',
              Condition: { Bool: { 'aws:SecureTransport': 'false' } },
            }),
          ]),
        },
      });
    }
  });

  it('has lifecycle, a POST-only CORS rule and native EventBridge notifications', () => {
    const p = bucketProps(dev);
    const rules = p.LifecycleConfiguration.Rules as Res[];
    expect(rules.find((r) => r.ExpirationInDays !== undefined)!.ExpirationInDays).toBe(90);
    expect(
      rules.find((r) => r.AbortIncompleteMultipartUpload)!.AbortIncompleteMultipartUpload,
    ).toEqual({ DaysAfterInitiation: 1 });
    const cors = p.CorsConfiguration.CorsRules as Res[];
    expect(cors).toHaveLength(1);
    expect(cors[0]!.AllowedMethods).toEqual(['POST']);
    expect(cors[0]!.AllowedOrigins).toEqual(['http://localhost:5173']);
    expect(p.NotificationConfiguration).toEqual({
      EventBridgeConfiguration: { EventBridgeEnabled: true },
    });
    dev.resourceCountIs('Custom::S3BucketNotifications', 0);
    const ids = Object.keys(dev.toJSON().Resources);
    expect(ids.some((i) => i.startsWith('BucketNotificationsHandler'))).toBe(false);
  });

  it('auto-deletes objects in dev-a only, and deletes or retains by stage', () => {
    dev.resourceCountIs('Custom::S3AutoDeleteObjects', 1);
    demo.resourceCountIs('Custom::S3AutoDeleteObjects', 0);
    const [d] = Object.values(dev.findResources('AWS::S3::Bucket')) as Res[];
    const [m] = Object.values(demo.findResources('AWS::S3::Bucket')) as Res[];
    expect(policyOf(d!)).toBe('Delete');
    expect(policyOf(m!)).toBe('Retain');
  });
});

describe('parameters and outputs', () => {
  it('creates five String parameters with stage names and config values', () => {
    for (const [t, stage] of [[dev, 'dev-a'], [demo, 'demo']] as const) {
      t.resourceCountIs('AWS::SSM::Parameter', 5);
      const expected: Record<string, string> = {
        autoApproveEnabled: 'true',
        earlyClaimDays: '14',
        frequencyWindowDays: '30',
        frequencyMaxClaims: '3',
        outlierMultiple: '2',
      };
      for (const [k, v] of Object.entries(expected)) {
        t.hasResourceProperties('AWS::SSM::Parameter', {
          Name: `/claims/${stage}/${k}`,
          Type: 'String',
          Value: v,
        });
      }
    }
    const params = Object.values(demo.findResources('AWS::SSM::Parameter')) as Res[];
    for (const r of params) expect(policyOf(r)).toBe('Retain');
  });

  it('has three outputs and no exports', () => {
    for (const t of [dev, demo]) {
      const out = t.toJSON().Outputs as Res;
      expect(Object.keys(out).sort()).toEqual(['ClaimsTableName', 'DataKeyArn', 'EvidenceBucketName']);
      for (const o of Object.values(out)) expect(o.Export).toBeUndefined();
    }
  });
});

describe('resource allow-list', () => {
  const types = (t: Template) =>
    new Set(Object.values(t.toJSON().Resources as Res).map((r) => r.Type as string));
  const base = [
    'AWS::KMS::Key',
    'AWS::DynamoDB::Table',
    'AWS::S3::Bucket',
    'AWS::S3::BucketPolicy',
    'AWS::SSM::Parameter',
  ];
  it('demo holds only the data resources', () => {
    expect([...types(demo)].sort()).toEqual([...base].sort());
  });
  it('dev-a adds only the auto-delete provider', () => {
    const allowed = new Set([
      ...base,
      'Custom::S3AutoDeleteObjects',
      'AWS::Lambda::Function',
      'AWS::IAM::Role',
    ]);
    for (const x of types(dev)) expect(allowed.has(x), x).toBe(true);
    expect(types(dev).has('Custom::S3AutoDeleteObjects')).toBe(true);
  });
});

describe('overrides', () => {
  it('RETAIN override in dev-a retains everything and drops auto-delete', () => {
    const t = build('dev-a', { policy: cdk.RemovalPolicy.RETAIN });
    t.resourceCountIs('Custom::S3AutoDeleteObjects', 0);
    for (const type of ['AWS::KMS::Key', 'AWS::DynamoDB::Table', 'AWS::S3::Bucket']) {
      for (const r of Object.values(t.findResources(type)) as Res[]) {
        expect(policyOf(r), type).toBe('Retain');
      }
    }
  });
  it('SNAPSHOT override maps to Retain', () => {
    const t = build('dev-a', { policy: cdk.RemovalPolicy.SNAPSHOT });
    t.resourceCountIs('Custom::S3AutoDeleteObjects', 0);
    for (const type of ['AWS::KMS::Key', 'AWS::DynamoDB::Table', 'AWS::S3::Bucket']) {
      for (const r of Object.values(t.findResources(type)) as Res[]) {
        expect(policyOf(r), type).toBe('Retain');
      }
    }
  });
  it('retention 30 days and a second origin reach lifecycle and CORS', () => {
    const origins = ['http://localhost:5173', 'https://d111111abcdef8.cloudfront.net'];
    const t = build('dev-a', { config: { evidenceRetentionDays: 30, consoleOrigins: origins } });
    const [b] = Object.values(t.findResources('AWS::S3::Bucket')) as Res[];
    const rules = b!.Properties.LifecycleConfiguration.Rules as Res[];
    expect(rules.find((r) => r.ExpirationInDays !== undefined)!.ExpirationInDays).toBe(30);
    expect(b!.Properties.CorsConfiguration.CorsRules[0].AllowedOrigins).toEqual(origins);
  });
});
