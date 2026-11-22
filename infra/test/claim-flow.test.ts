// T-09 task 7.6: CDK assertions for the claim flow (job queue, DLQ, Worker, mappings). Requirement 13.7.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../lib/build-app.js';
import { CI_PLACEHOLDER_ACCOUNT } from '../lib/stage.js';
import { loadStageConfig, resolveRemovalPolicy } from '../lib/stage-config.js';

interface Statement {
  Effect: string;
  Action: string | string[];
  Resource: unknown;
  Condition?: unknown;
}
type Res = { Properties: { [key: string]: unknown; RedrivePolicy: { maxReceiveCount: number; deadLetterTargetArn: unknown } } };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const text = (v: unknown) => JSON.stringify(v);
const actions = (s: Statement) => (Array.isArray(s.Action) ? s.Action : [s.Action]);

let outdir: string;
let api: Template;
let processing: Template;

beforeAll(() => {
  outdir = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'cdk-test-'));
  const app = new cdk.App({ outdir });
  const config = loadStageConfig('dev-a', path.resolve(HERE, '../config'), () => undefined);
  buildApp(app, {
    stage: 'dev-a',
    config,
    removalPolicy: cdk.RemovalPolicy[resolveRemovalPolicy('dev-a', config)],
    env: { account: CI_PLACEHOLDER_ACCOUNT, region: 'us-east-1' },
  });
  const stack = (id: string) => app.node.children.find((c) => cdk.Stack.isStack(c) && c.node.id === id) as cdk.Stack;
  api = Template.fromStack(stack('Api'));
  processing = Template.fromStack(stack('Processing'));
}, 120_000);
afterAll(() => fs.rmSync(outdir, { recursive: true, force: true }));

const byId = (t: Template, type: string, needle: string): Res => {
  const hit = Object.entries(t.findResources(type)).find(([id]) => id.toLowerCase().includes(needle.toLowerCase()));
  expect(hit, `${type} ${needle}`).toBeDefined();
  return hit![1] as Res;
};

describe('claim flow: Api stack queues', () => {
  it('job queue: visibility 360 s, maxReceiveCount 3, SSE-KMS', () => {
    const q = byId(api, 'AWS::SQS::Queue', 'JobQueue').Properties;
    expect(q.VisibilityTimeout).toBe(360);
    expect(q.RedrivePolicy.maxReceiveCount).toBe(3);
    expect(text(q.RedrivePolicy.deadLetterTargetArn)).toContain('JobDlq');
    expect(q.KmsMasterKeyId).toBeDefined();
  });

  it('DLQ: 14 days retention, SSE-KMS', () => {
    const q = byId(api, 'AWS::SQS::Queue', 'JobDlq').Properties;
    expect(q.MessageRetentionPeriod).toBe(1209600);
    expect(q.KmsMasterKeyId).toBeDefined();
  });

  it('both queues have a TLS-only policy', () => {
    const policies = Object.values(api.findResources('AWS::SQS::QueuePolicy')) as Res[];
    for (const name of ['JobQueue', 'JobDlq']) {
      const p = policies.find((x) => text(x.Properties.Queues).includes(name));
      expect(p, name).toBeDefined();
      const doc = text(p!.Properties.PolicyDocument);
      expect(doc).toContain('aws:SecureTransport');
      expect(doc).toContain('Deny');
    }
  });

  it('DLQ alarm fires above 0 visible messages', () => {
    const a = byId(api, 'AWS::CloudWatch::Alarm', 'JobDlqNotEmpty').Properties;
    expect(a.Threshold).toBe(0);
    expect(a.ComparisonOperator).toBe('GreaterThanThreshold');
    expect(text(a.Dimensions)).toContain('JobDlq');
  });

  it('every route uses the JWT authorizer', () => {
    const routes = Object.values(api.findResources('AWS::ApiGatewayV2::Route')) as Res[];
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      expect(r.Properties.AuthorizationType).toBe('JWT');
      expect(r.Properties.AuthorizerId).toBeDefined();
    }
  });
});

describe('claim flow: Processing stack Worker', () => {
  it('Worker timeout is 60 s', () => {
    expect(byId(processing, 'AWS::Lambda::Function', 'worker').Properties.Timeout).toBe(60);
  });

  it('job queue mapping: batch 1, max concurrency 5, partial batch responses', () => {
    const m = byId(processing, 'AWS::Lambda::EventSourceMapping', 'WorkerJobQueueMapping').Properties;
    expect(m.BatchSize).toBe(1);
    expect(m.ScalingConfig).toEqual({ MaximumConcurrency: 5 });
    expect(m.FunctionResponseTypes).toEqual(['ReportBatchItemFailures']);
  });

  it('DLQ mapping targets the Decision function with partial batch responses', () => {
    const m = byId(processing, 'AWS::Lambda::EventSourceMapping', 'DecisionDlqMapping').Properties;
    const target = text(m.FunctionName).toLowerCase();
    expect(target).toContain('decisionfunction');
    expect(target).not.toContain('worker');
    expect(m.FunctionResponseTypes).toEqual(['ReportBatchItemFailures']);
  });

  describe('Worker role', () => {
    const roleStatements = (): Statement[] => {
      const out: Statement[] = [];
      for (const [id, p] of Object.entries(processing.findResources('AWS::IAM::Policy'))) {
        if (id.toLowerCase().includes('worker')) out.push(...(p.Properties.PolicyDocument.Statement as Statement[]));
      }
      return out;
    };

    it('limits Bedrock to InvokeModel on one inference profile and its foundation model, conditioned on the profile', () => {
      const bedrock = roleStatements().filter((s) => actions(s).some((a) => a.startsWith('bedrock')));
      expect(bedrock).toHaveLength(2);
      for (const s of bedrock) expect(actions(s)).toEqual(['bedrock:InvokeModel']);
      const profile = bedrock.find((s) => text(s.Resource).includes('inference-profile/'))!;
      const model = bedrock.find((s) => text(s.Resource).includes('foundation-model/'))!;
      expect(profile).toBeDefined();
      expect(model).toBeDefined();
      expect(profile.Condition).toBeUndefined();
      expect(text(model.Condition)).toContain('bedrock:InferenceProfileArn');
      expect(text(model.Condition)).toContain('inference-profile/');
    });

    it('has no wildcard action', () => {
      for (const s of roleStatements()) {
        expect(actions(s).filter((a) => a === '*' || a.endsWith(':*')), text(s)).toEqual([]);
      }
    });

    it('has no Audit table access and no write action on any DynamoDB table', () => {
      const stmts = roleStatements();
      expect(stmts.filter((s) => text(s.Resource).includes('AuditLog'))).toEqual([]);
      const ddb = stmts.flatMap(actions).filter((a) => a.startsWith('dynamodb:'));
      expect(ddb.length).toBeGreaterThan(0);
      for (const a of ddb) expect(['dynamodb:GetItem', 'dynamodb:Query']).toContain(a);
    });
  });
});
