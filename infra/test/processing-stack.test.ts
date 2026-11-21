// T-14: the Decision Lambda's role and the rule that only it can write a decision status.
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
  const others: Stack[] = [
    foundation,
    new AuthStack(app, 'Auth', props),
    new ApiStack(app, 'Api', props),
    new WebStack(app, 'Web', props),
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
const actions = (s: Statement) => (Array.isArray(s.Action) ? s.Action : [s.Action]);
const text = (v: unknown) => JSON.stringify(v);

describe('Processing stack: decision function', () => {
  const { processing, all } = build();
  const t = Template.fromStack(processing);

  it('is one Node.js 22 ARM64 function with a deliberate timeout and the table, parameter and threshold variables', () => {
    t.resourceCountIs('AWS::Lambda::Function', 1);
    t.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
      Timeout: 15,
      MemorySize: 512,
    });
    const [fn] = Object.values(t.findResources('AWS::Lambda::Function'));
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
    for (const s of statements(processing)) {
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
      for (const s of statements(processing).filter((x) => text(x.Resource).includes(name))) {
        expect(actions(s).sort(), name).toEqual(['dynamodb:GetItem', 'dynamodb:Query']);
      }
    }
  });
});
