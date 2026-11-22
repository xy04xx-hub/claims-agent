// T-14: the Decision Lambda's role and the rule that only it can write a decision status.
// T-13: the Evidence Processor, its EventBridge rule, dead-letter queue and role.
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { AgentStack } from '../lib/stacks/agent-stack.js';
import { ApiStack } from '../lib/stacks/api-stack.js';
import { AuthStack } from '../lib/stacks/auth-stack.js';
import { FoundationStack } from '../lib/stacks/foundation-stack.js';
import { OpsStack } from '../lib/stacks/ops-stack.js';
import { ProcessingStack } from '../lib/stacks/processing-stack.js';
import { WebStack } from '../lib/stacks/web-stack.js';
import { CI_PLACEHOLDER_ACCOUNT } from '../lib/stage.js';
import { loadStageConfig } from '../lib/stage-config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

interface Statement {
  Effect: string;
  Action: string | string[];
  Resource: unknown;
}

function build() {
  const app = new App();
  const config = loadStageConfig('dev-a', path.resolve(here, '../config'), () => undefined);
  const props = {
    stage: 'dev-a',
    config,
    removalPolicy: RemovalPolicy.DESTROY,
    env: { account: CI_PLACEHOLDER_ACCOUNT, region: 'us-east-1' },
  };
  const foundation = new FoundationStack(app, 'Foundation', props);
  const processing = new ProcessingStack(app, 'Processing', { ...props, foundation });
  const web = new WebStack(app, 'Web', props);
  const auth = new AuthStack(app, 'Auth', { ...props, consoleUrl: web.consoleUrl });
  const others: Stack[] = [
    foundation,
    auth,
    new ApiStack(app, 'Api', { ...props, auth }),
    web,
    new OpsStack(app, 'Ops', props),
    new AgentStack(app, 'Agent', props),
  ];
  return { processing, all: [...others, processing] };
}

/** Every IAM statement in a stack, from managed-by-CDK policies and inline role policies. */
function statements(stack: Stack): Statement[] {
  const t = Template.fromStack(stack);
  const out: Statement[] = [];
  for (const p of Object.values(t.findResources('AWS::IAM::Policy'))) {
    out.push(...(p.Properties.PolicyDocument.Statement as Statement[]));
  }
  for (const r of Object.values(t.findResources('AWS::IAM::Role'))) {
    for (const pol of (r.Properties.Policies ?? []) as { PolicyDocument: { Statement: Statement[] } }[]) {
      out.push(...pol.PolicyDocument.Statement);
    }
  }
  return out;
}
/** Statements of the role whose logical ID contains `needle` (the policy and the inline policies of that role). */
function statementsOf(stack: Stack, needle: string): Statement[] {
  const t = Template.fromStack(stack);
  const out: Statement[] = [];
  for (const [id, p] of Object.entries(t.findResources('AWS::IAM::Policy'))) {
    if (id.toLowerCase().includes(needle)) out.push(...(p.Properties.PolicyDocument.Statement as Statement[]));
  }
  for (const [id, r] of Object.entries(t.findResources('AWS::IAM::Role'))) {
    if (!id.toLowerCase().includes(needle)) continue;
    for (const pol of (r.Properties.Policies ?? []) as { PolicyDocument: { Statement: Statement[] } }[]) {
      out.push(...pol.PolicyDocument.Statement);
    }
  }
  return out;
}
const actions = (s: Statement) => (Array.isArray(s.Action) ? s.Action : [s.Action]);
const text = (v: unknown) => JSON.stringify(v);

describe('Processing stack: decision function', () => {
  const { processing, all } = build();
  const t = Template.fromStack(processing);

  it('is a Node.js 22 ARM64 function with a deliberate timeout and the table, parameter and threshold variables', () => {
    t.resourceCountIs('AWS::Lambda::Function', 2); // the decision function and the evidence processor (T-13)
    t.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
      Timeout: 15,
      MemorySize: 512,
    });
    const fn = Object.values(t.findResources('AWS::Lambda::Function')).find((f) => f.Properties.Timeout === 15)!;
    const env = Object.keys(fn.Properties.Environment.Variables as Record<string, unknown>);
    expect(env).toEqual(expect.arrayContaining([
      'CLAIMS_TABLE', 'POLICIES_TABLE', 'PACKS_TABLE', 'EVIDENCE_INDEX_TABLE', 'AUDIT_TABLE', 'AUTO_APPROVE_PARAMETER',
      'EARLY_CLAIM_DAYS', 'OUTLIER_MULTIPLE', 'FREQUENCY_WINDOW_DAYS', 'FREQUENCY_MAX_CLAIMS',
    ]));
  });

  it('only the decision role has UpdateItem on the Claims table, in the whole app', () => {
    const holders = all.flatMap((stack) =>
      statements(stack)
        .filter((s) => actions(s).some((a) => a === 'dynamodb:UpdateItem' || a === 'dynamodb:*' || a === '*'))
        .map(() => stack.node.id),
    );
    expect(holders).toEqual(['Processing']);
    const [update] = statements(processing).filter((s) => actions(s).includes('dynamodb:UpdateItem'));
    expect(text(update.Resource)).toContain('ClaimsTable');
    expect(text(update.Resource)).not.toContain('index');
  });

  it('can only put (not update or delete) audit records', () => {
    const audit = statements(processing).filter((s) => text(s.Resource).includes('AuditLogTable'));
    expect(audit).toHaveLength(1);
    expect(actions(audit[0])).toEqual(['dynamodb:PutItem']);
  });

  it('can read only the one SSM parameter and nothing else in SSM', () => {
    const ssm = statements(processing).filter((s) => actions(s).some((a) => a.startsWith('ssm:')));
    expect(ssm).toHaveLength(1);
    expect(actions(ssm[0])).toEqual(['ssm:GetParameter']);
    expect(text(ssm[0].Resource)).toContain('autoApproveEnabled');
  });

  it('has no wildcard action and no wildcard resource except X-Ray', () => {
    for (const s of statementsOf(processing, 'decision')) {
      expect(actions(s).filter((a) => a === '*' || a.endsWith(':*')), text(s)).toEqual([]);
      if (s.Resource === '*') {
        expect(actions(s).every((a) => a.startsWith('xray:')), text(s)).toBe(true);
      } else {
        expect(text(s.Resource), text(s)).not.toMatch(/\*/);
      }
    }
  });

  it('grants no write on Policies, ClaimTypePacks or EvidenceIndex', () => {
    for (const name of ['PoliciesTable', 'ClaimTypePacksTable', 'EvidenceIndexTable']) {
      for (const s of statementsOf(processing, 'decision').filter((x) => text(x.Resource).includes(name))) {
        expect(actions(s).sort(), name).toEqual(['dynamodb:GetItem', 'dynamodb:Query']);
      }
    }
  });
});

describe('Processing stack: evidence processor (T-13)', () => {
  const { processing } = build();
  const t = Template.fromStack(processing);
  const fnId = Object.keys(t.findResources('AWS::Lambda::Function')).find((id) => id.toLowerCase().includes('evidenceprocessor'))!;
  const fn = t.findResources('AWS::Lambda::Function')[fnId];
  const stmts = statementsOf(processing, 'evidenceprocessor');

  it('is a Node.js 22 ARM64 function with a deliberate timeout, memory and its three variables', () => {
    expect(fn.Properties).toMatchObject({ Runtime: 'nodejs22.x', Architectures: ['arm64'], Timeout: 20, MemorySize: 1024 });
    const env = fn.Properties.Environment.Variables as Record<string, unknown>;
    expect(Object.keys(env)).toEqual(expect.arrayContaining(['EVIDENCE_INDEX_TABLE', 'EVIDENCE_BUCKET', 'MAX_OBJECT_BYTES']));
    expect(env.MAX_OBJECT_BYTES).toBe('10485760'); // twice the 5 MB upload limit
  });

  it('is triggered by Object Created events of the evidence bucket, for keys of the shape */*/*', () => {
    const [rule] = Object.values(t.findResources('AWS::Events::Rule'));
    expect(rule.Properties.EventPattern).toMatchObject({
      source: ['aws.s3'],
      'detail-type': ['Object Created'],
      detail: { object: { key: [{ wildcard: '*/*/*' }] } },
    });
    expect(text(rule.Properties.EventPattern.detail.bucket.name)).toContain('EvidenceBucket');
  });

  it('has one target with a short retry policy and a dead-letter queue', () => {
    const [rule] = Object.values(t.findResources('AWS::Events::Rule'));
    expect(rule.Properties.Targets).toHaveLength(1);
    const target = rule.Properties.Targets[0];
    expect(target.RetryPolicy).toEqual({ MaximumEventAgeInSeconds: 300, MaximumRetryAttempts: 2 });
    expect(text(target.DeadLetterConfig)).toContain('EvidenceEventsDlq');
  });

  it('retries failed invocations twice and then sends the event to the dead-letter queue', () => {
    const [cfg] = Object.values(t.findResources('AWS::Lambda::EventInvokeConfig'));
    expect(cfg.Properties).toMatchObject({ MaximumRetryAttempts: 2, MaximumEventAgeInSeconds: 300 });
    expect(text(cfg.Properties.DestinationConfig.OnFailure.Destination)).toContain('EvidenceEventsDlq');
  });

  it('has an encrypted, SSL-only dead-letter queue that keeps messages 14 days', () => {
    t.hasResourceProperties('AWS::SQS::Queue', { SqsManagedSseEnabled: true, MessageRetentionPeriod: 14 * 24 * 3600 });
    const policies = Object.values(t.findResources('AWS::SQS::QueuePolicy')).map(text).join('');
    expect(policies).toContain('aws:SecureTransport');
  });

  it('reads only evidence objects, writes only EvidenceIndex rows, uses only the data key, and may send to the one queue', () => {
    const byAction = (a: string) => stmts.filter((s) => actions(s).includes(a));
    expect(byAction('s3:GetObject')).toHaveLength(1);
    expect(actions(byAction('s3:GetObject')[0])).toEqual(['s3:GetObject']);
    expect(text(byAction('s3:GetObject')[0].Resource)).toContain('/*/*/*');
    const put = byAction('dynamodb:PutItem');
    expect(put).toHaveLength(1);
    expect(actions(put[0])).toEqual(['dynamodb:PutItem']);
    expect(text(put[0].Resource)).toContain('EvidenceIndexTable');
    expect(text(put[0].Resource)).not.toContain('index/');
    expect(actions(byAction('kms:Decrypt')[0]).sort()).toEqual(['kms:Decrypt', 'kms:DescribeKey', 'kms:GenerateDataKey']);
    expect(text(byAction('kms:Decrypt')[0].Resource)).toContain('DataKey');
    const sqsStmts = stmts.filter((s) => actions(s).some((a) => a.startsWith('sqs:')));
    // SendMessage, plus the two read-only queue lookups CDK adds for a failure destination.
    expect(sqsStmts.flatMap(actions).sort()).toEqual(['sqs:GetQueueAttributes', 'sqs:GetQueueUrl', 'sqs:SendMessage']);
    expect(text(sqsStmts[0].Resource)).toContain('EvidenceEventsDlq');
  });

  it('has no wildcard action, and no wildcard resource except X-Ray and the evidence object ARN', () => {
    for (const s of stmts) {
      expect(actions(s).filter((a) => a === '*' || a.endsWith(':*')), text(s)).toEqual([]);
      if (s.Resource === '*') expect(actions(s).every((a) => a.startsWith('xray:')), text(s)).toBe(true);
      else if (actions(s).includes('s3:GetObject')) expect(text(s.Resource)).toMatch(/"\/\*\/\*\/\*"/);
      else expect(text(s.Resource), text(s)).not.toMatch(/\*/);
    }
  });

  it('cannot read or write claims, policies, packs, audit records or parameters', () => {
    for (const name of ['ClaimsTable', 'PoliciesTable', 'ClaimTypePacksTable', 'AuditLogTable']) {
      expect(stmts.filter((s) => text(s.Resource).includes(name)), name).toEqual([]);
    }
    expect(stmts.flatMap(actions).filter((a) => a.startsWith('ssm:') || a.startsWith('lambda:') || a.startsWith('bedrock'))).toEqual([]);
  });
});
