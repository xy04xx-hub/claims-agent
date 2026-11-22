// Stack, synth and nag assertions for T-04 (tasks 4.6). Builds the app in memory with the real stack classes.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp as buildStacks } from '../lib/build-app.js';
import { applyNag } from '../lib/nag.js';
import { AgentStack } from '../lib/stacks/agent-stack.js';
import { ApiStack } from '../lib/stacks/api-stack.js';
import { AuthStack } from '../lib/stacks/auth-stack.js';
import { FoundationStack } from '../lib/stacks/foundation-stack.js';
import { OpsStack } from '../lib/stacks/ops-stack.js';
import { ProcessingStack } from '../lib/stacks/processing-stack.js';
import { WebStack } from '../lib/stacks/web-stack.js';
import { CI_PLACEHOLDER_ACCOUNT } from '../lib/stage.js';
import { loadStageConfig, resolveRemovalPolicy } from '../lib/stage-config.js';
import type { BaseStackProps } from '../lib/stack-props.js';

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
const STACK_DIR = path.resolve(HERE, '../lib/stacks');

const OWNER_B = '// Owner: B (muzair110)';
const OWNER_A = '// Owner: A';
const STACKS = [
  { file: 'foundation-stack.ts', cls: 'FoundationStack', owner: OWNER_B, ctor: FoundationStack, id: 'Foundation' },
  { file: 'auth-stack.ts', cls: 'AuthStack', owner: OWNER_B, ctor: AuthStack, id: 'Auth' },
  { file: 'api-stack.ts', cls: 'ApiStack', owner: OWNER_B, ctor: ApiStack, id: 'Api' },
  { file: 'web-stack.ts', cls: 'WebStack', owner: OWNER_B, ctor: WebStack, id: 'Web' },
  { file: 'ops-stack.ts', cls: 'OpsStack', owner: OWNER_B, ctor: OpsStack, id: 'Ops' },
  { file: 'processing-stack.ts', cls: 'ProcessingStack', owner: OWNER_A, ctor: ProcessingStack, id: 'Processing' },
  { file: 'agent-stack.ts', cls: 'AgentStack', owner: OWNER_A, ctor: AgentStack, id: 'Agent' },
] as const;

const DENY_LIST = [
  'AWS::DynamoDB::Table',
  'AWS::S3::Bucket',
  'AWS::SQS::Queue',
  'AWS::Lambda::Function',
  'AWS::Cognito::UserPool',
  'AWS::CloudFront::Distribution',
  'AWS::KMS::Key',
  'AWS::IAM::Role',
  'AWS::ApiGatewayV2::Api',
  'AWS::ApiGateway::RestApi',
];

function buildApp(stage: string, removalPolicy?: cdk.RemovalPolicy) {
  const app = new cdk.App({ outdir: trackTmp(fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'cdk-test-'))) });
  const config = loadStageConfig(stage, CONFIG_DIR, () => undefined);
  const resolved = removalPolicy ?? cdk.RemovalPolicy[resolveRemovalPolicy(stage, config)];
  const props: BaseStackProps = {
    stage,
    config,
    removalPolicy: resolved,
    env: { account: CI_PLACEHOLDER_ACCOUNT, region: 'us-east-1' },
  };
  buildStacks(app, props);
  const stacks = STACKS.map((s) => app.node.findChild(s.id) as cdk.Stack);
  return { app, stacks, props };
}

describe('stack owner comments', () => {
  for (const s of STACKS) {
    it(`${s.cls} has "${s.owner}" directly above the class`, () => {
      const file = path.join(STACK_DIR, s.file);
      expect(fs.existsSync(file), `${s.cls}: file ${s.file} missing`).toBe(true);
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      const i = lines.findIndex((l) => new RegExp(`^export class ${s.cls}\\b`).test(l));
      expect(i, `${s.cls}: class declaration not found`).toBeGreaterThan(0);
      expect(lines[i - 1]?.trim(), `${s.cls}: expected owner comment "${s.owner}" directly above the class`).toBe(s.owner);
    });
  }
});

describe('dev-a synth', () => {
  it('has no deny-list resources and no nag errors or suppressions', () => {
    const { app } = buildApp('dev-a');
    const assembly = app.synth();
    expect(assembly.stacks).toHaveLength(7);
    for (const st of assembly.stacks) {
      const types = Object.values((st.template.Resources ?? {}) as Record<string, { Type: string }>).map((r) => r.Type);
      // Foundation (T-05), Auth (T-06), Api (T-08), Web (T-07) and Processing (T-14) hold resources; Ops and Agent hold only metadata.
      if (
        !st.stackName.endsWith('-Foundation') &&
        !st.stackName.endsWith('-Auth') &&
        !st.stackName.endsWith('-Api') &&
        !st.stackName.endsWith('-Web') &&
        !st.stackName.endsWith('-Processing')
      ) {
        const bad = types.filter((t) => DENY_LIST.includes(t));
        expect(bad, `${st.stackName} has deny-listed resources`).toEqual([]);
        const extra = types.filter((t) => t !== 'AWS::CDK::Metadata');
        expect(extra, `${st.stackName} has resources other than AWS::CDK::Metadata`).toEqual([]);
      }
      const errors = st.messages.filter((m) => m.level === 'error');
      expect(errors, `${st.stackName} nag errors`).toEqual([]);
      expect(JSON.stringify(st.template)).not.toContain('cdk_nag');
    }
  });

  it('records only the known Foundation, Auth, Api, Web and Processing acknowledgments', () => {
    const { app } = buildApp('dev-a');
    const found: Array<{ path: string; ids: string[] }> = [];
    for (const c of app.node.findAll()) {
      for (const m of c.node.metadata) {
        if (!/nag|acknowledg|suppress/i.test(m.type)) continue;
        found.push({ path: c.node.path, ids: Object.keys((m.data ?? {}) as Record<string, unknown>) });
      }
    }
    const flat = found
      .flatMap((f) => f.ids.map((id) => `${f.path} ${id.replace('Annotation::AwsSolutions-', '')}`))
      .sort();
    const handler = 'Web/Custom::CDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C';
    const expected = [
      'Foundation/EvidenceBucket S1',
      'Web/ConsoleBucket S1',
      'Web/Distribution CFR1',
      'Web/Distribution CFR2',
      'Web/Distribution CFR3',
      'Web/Distribution CFR4',
      `${handler} L1`,
      `${handler}/ServiceRole IAM4`,
      `${handler}/ServiceRole/DefaultPolicy IAM5`,
      'Processing/decision IAM5',
      'Processing/decision L1',
      'Processing/evidence-processor IAM5',
      'Processing/evidence-processor L1',
      'Processing/EvidenceEventsDlq SQS3',
      'Auth/UserPool COG2',
      'Auth/UserPool COG8',
      'Auth/PreTokenGeneration IAM5[Resource::*]',
      'Auth/PreTokenGeneration L1',
      'Api/api-customer IAM5[Resource::*]',
      'Api/api-customer L1',
      'Api/api-adjuster IAM5[Resource::*]',
      'Api/api-adjuster L1',
    ].sort();
    expect(flat).toEqual(expected);
  });
});

describe('nag failure reporting', () => {
  function badApp(opts: { publicBucket?: boolean; ackReason?: string }) {
    const app = new cdk.App({ outdir: trackTmp(fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'cdk-test-'))) });
    const stack = new cdk.Stack(app, 'Bad', { env: { account: CI_PLACEHOLDER_ACCOUNT, region: 'us-east-1' } });
    if (opts.publicBucket) {
      new s3.Bucket(stack, 'PublicBucket', { publicReadAccess: true, blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS_ONLY });
    }
    if (opts.ackReason !== undefined) {
      cdk.Validations.of(new Construct(stack, 'Acked')).acknowledge({ id: 'AwsSolutions-S1', reason: opts.ackReason });
    }
    applyNag(app);
    return app;
  }

  function failureText(fn: () => unknown): string {
    try {
      const out = fn() as { stacks?: { messages: { level: string; entry: { data?: unknown } }[] }[] };
      return JSON.stringify(out?.stacks?.flatMap((s) => s.messages) ?? '');
    } catch (e) {
      return e instanceof Error ? `${e.message}\n${JSON.stringify((e as { errors?: unknown }).errors ?? '')}` : String(e);
    }
  }

  it('reports the rule ID and construct path for a public bucket', () => {
    const text = failureText(() => badApp({ publicBucket: true }).synth());
    expect(text).toMatch(/AwsSolutions-S/);
    expect(text).toContain('PublicBucket');
  });

  it('fails a suppression with a 3-character reason', () => {
    const text = failureText(() => badApp({ ackReason: 'abc' }).synth());
    expect(text).toContain('needs a reason of at least 10 characters');
    expect(text).toContain('Bad/Acked');
  });

  it('accepts a suppression with a 10-character reason', () => {
    const text = failureText(() => badApp({ ackReason: 'long enough reason' }).synth());
    expect(text).not.toContain('needs a reason');
  });
});

describe('app source scan', () => {
  // The stack blocks live in lib/build-app.ts (extracted from bin/app.ts); scan both files.
  const src = ['../bin/app.ts', '../lib/build-app.ts'].map((f) => fs.readFileSync(path.resolve(HERE, f), 'utf8')).join('\n');
  it('has seven banner blocks', () => {
    const banners = src.match(/^\s*\/\/ ---- \w+: owner (A|B \(muzair110\)) ----$/gm) ?? [];
    expect(banners).toHaveLength(7);
  });
  it('has no importValue, 12-digit number or arn:aws', () => {
    expect(src).not.toMatch(/importValue/);
    expect(src).not.toMatch(/(?<!\d)\d{12}(?!\d)/);
    expect(src).not.toMatch(/arn:aws/);
  });
});

describe('removal policy propagation', () => {
  for (const policy of [cdk.RemovalPolicy.DESTROY, cdk.RemovalPolicy.RETAIN, cdk.RemovalPolicy.SNAPSHOT]) {
    it(`passes ${policy} to every stack`, () => {
      const { stacks } = buildApp('dev-a', policy);
      for (const st of stacks) {
        expect((st as unknown as { removalPolicy: cdk.RemovalPolicy }).removalPolicy, st.node.id).toBe(policy);
      }
    });
  }
  it('resolves RETAIN for demo and DESTROY for dev stages', () => {
    expect(buildApp('demo').stacks.every((s) => (s as unknown as { removalPolicy: unknown }).removalPolicy === cdk.RemovalPolicy.RETAIN)).toBe(true);
    expect(buildApp('dev-a').stacks.every((s) => (s as unknown as { removalPolicy: unknown }).removalPolicy === cdk.RemovalPolicy.DESTROY)).toBe(true);
  }, 60_000); // two full app builds bundle the Lambda entries; the 10 s default is too tight under load
});
