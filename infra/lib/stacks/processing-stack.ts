import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import type { Construct } from 'constructs';
import { ClaimsFunction } from '../constructs/claims-function.js';
import type { BaseStackProps } from '../stack-props.js';
import { stackName } from '../stage.js';
import type { FoundationResources } from './foundation-stack.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export interface ProcessingStackProps extends BaseStackProps {
  /** Typed handles from the Foundation stack (tables, key, SSM parameters). */
  readonly foundation: FoundationResources;
}

// Owner: A
export class ProcessingStack extends cdk.Stack {
  readonly removalPolicy: cdk.RemovalPolicy;
  /** The only function allowed to write a decision. The Worker (T-15) is granted invoke on it. */
  readonly decisionFunction: lambda.IFunction;

  constructor(scope: Construct, id: string, props: ProcessingStackProps) {
    super(scope, id, { ...props, stackName: stackName(props.stage, 'Processing') });
    this.removalPolicy = props.removalPolicy;
    const f = props.foundation;

    const decision = new ClaimsFunction(this, 'decision', {
      entry: path.join(REPO_ROOT, 'backend/processing/decision/index.ts'),
      timeout: cdk.Duration.seconds(15),
      memorySize: 512,
      environment: {
        CLAIMS_TABLE: f.claimsTable.tableName,
        POLICIES_TABLE: f.policiesTable.tableName,
        PACKS_TABLE: f.claimTypePacksTable.tableName,
        EVIDENCE_INDEX_TABLE: f.evidenceIndexTable.tableName,
        AUDIT_TABLE: f.auditLogTable.tableName,
        AUTO_APPROVE_PARAMETER: f.parameterNames.autoApproveEnabled,
        // Global defaults from the stage config. Only the kill switch is read from SSM at runtime.
        EARLY_CLAIM_DAYS: String(props.config.earlyClaimDays),
        OUTLIER_MULTIPLE: String(props.config.outlierMultiple),
        FREQUENCY_WINDOW_DAYS: String(props.config.frequencyWindowDays),
        FREQUENCY_MAX_CLAIMS: String(props.config.frequencyMaxClaims),
      },
    });
    const fn = decision.function;
    this.decisionFunction = fn;

    // Least privilege: exact tables, exact indexes, exact actions. No wildcards.
    const allow = (actions: string[], resources: string[]) =>
      fn.addToRolePolicy(new iam.PolicyStatement({ effect: iam.Effect.ALLOW, actions, resources }));
    const read = ['dynamodb:GetItem', 'dynamodb:Query'];
    allow(read, [f.policiesTable.tableArn]);
    allow(read, [f.claimTypePacksTable.tableArn]);
    allow(read, [f.evidenceIndexTable.tableArn, `${f.evidenceIndexTable.tableArn}/index/byEvidence`]);
    allow(read, [f.claimsTable.tableArn, `${f.claimsTable.tableArn}/index/byCustomer`]);
    // Only this role can write a decision status on a claim.
    allow(['dynamodb:UpdateItem'], [f.claimsTable.tableArn]);
    allow(['dynamodb:PutItem'], [f.auditLogTable.tableArn]);
    allow(['ssm:GetParameter'], [f.autoApproveEnabledParameter.parameterArn]);
    // The tables are encrypted with the customer-managed data key.
    allow(['kms:Decrypt', 'kms:GenerateDataKey', 'kms:DescribeKey'], [f.dataKey.keyArn]);

    // cdk-nag acknowledgments, each with its reason.
    cdk.Validations.of(decision).acknowledge({
      id: 'AwsSolutions-IAM5',
      reason:
        'The only wildcard is X-Ray (PutTraceSegments, PutTelemetryRecords), which AWS does not support at resource level. Every DynamoDB, SSM and KMS statement names an exact ARN.',
    });
    cdk.Validations.of(decision).acknowledge({
      id: 'AwsSolutions-L1',
      reason:
        'The project standard is Node.js 22 on ARM64 (repository.md, .nvmrc). Moving to a newer runtime is a platform decision for both owners, not part of T-14.',
    });

    new cdk.CfnOutput(this, 'DecisionFunctionName', { value: fn.functionName });
  }
}
