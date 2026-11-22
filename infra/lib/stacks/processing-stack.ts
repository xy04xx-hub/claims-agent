import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as destinations from 'aws-cdk-lib/aws-lambda-destinations';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';
import { ClaimsFunction } from '../constructs/claims-function.js';
import type { BaseStackProps } from '../stack-props.js';
import { stackName } from '../stage.js';
import type { ApiResources } from './api-stack.js';
import type { FoundationResources } from './foundation-stack.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export interface ProcessingStackProps extends BaseStackProps {
  /** Typed handles from the Foundation stack (tables, key, SSM parameters). */
  readonly foundation: FoundationResources;
  /** Handles from the Api stack. Task 4.1 adds the job queue; the Worker (6.1) consumes it. */
  readonly api?: ApiResources;
}

// Owner: A
export class ProcessingStack extends cdk.Stack {
  readonly removalPolicy: cdk.RemovalPolicy;
  /** The only function allowed to write a decision. The Worker (T-15) is granted invoke on it. */
  readonly decisionFunction: lambda.IFunction;
  /** Hashes and EXIF-dates every evidence upload and writes the EvidenceIndex rows (T-13). */
  readonly evidenceProcessorFunction: lambda.IFunction;

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

    // --- Evidence Processor (T-13): S3 upload -> EventBridge -> Lambda -> EvidenceIndex rows ---
    const processor = new ClaimsFunction(this, 'evidence-processor', {
      entry: path.join(REPO_ROOT, 'backend/processing/evidence-processor/index.ts'),
      // PNG decoding is CPU bound and a 5 MB PNG can hold about 16 million pixels, so memory is generous.
      timeout: cdk.Duration.seconds(20),
      memorySize: 1024,
      environment: {
        EVIDENCE_INDEX_TABLE: f.evidenceIndexTable.tableName,
        EVIDENCE_BUCKET: f.evidenceBucket.bucketName,
        // Objects that bypassed the presigned size limit are skipped without being read.
        MAX_OBJECT_BYTES: String(props.config.maxUploadBytes * 2),
      },
    });
    this.evidenceProcessorFunction = processor.function;

    // Events that EventBridge could not deliver, and events the function failed on after its retries.
    // SQS-managed encryption: a KMS key here would need a key policy entry from the Foundation key (a cross-stack cycle).
    // The messages hold only the bucket, the key and the size.
    const evidenceDlq = new sqs.Queue(this, 'EvidenceEventsDlq', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: cdk.Duration.days(14),
    });

    // Evidence keys are <tenantId>/<customerId>/<evidenceId>, so the shape `*/*/*` selects exactly the uploads.
    // The handler parses the key again as a second check.
    const uploaded = new events.Rule(this, 'EvidenceUploaded', {
      description: 'Evidence uploaded to the evidence bucket (T-13)',
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: { name: [f.evidenceBucket.bucketName] },
          object: { key: [{ wildcard: '*/*/*' }] },
        },
      },
    });
    uploaded.addTarget(new targets.LambdaFunction(processor.function, {
      retryAttempts: 2,
      maxEventAge: cdk.Duration.minutes(5),
      deadLetterQueue: evidenceDlq,
    }));
    processor.function.configureAsyncInvoke({
      retryAttempts: 2,
      maxEventAge: cdk.Duration.minutes(5),
      onFailure: new destinations.SqsDestination(evidenceDlq),
    });

    // Least privilege, exact ARNs. Explicit statements, not grantRead/key.grant: those edit the Foundation resource
    // policies and would create a cross-stack dependency cycle.
    const pf = processor.function;
    pf.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [`${f.evidenceBucket.bucketArn}/*/*/*`], // <tenant>/<customer>/<evidence>
    }));
    pf.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:PutItem'], resources: [f.evidenceIndexTable.tableArn] }));
    pf.addToRolePolicy(new iam.PolicyStatement({
      actions: ['kms:Decrypt', 'kms:GenerateDataKey', 'kms:DescribeKey'],
      resources: [f.dataKey.keyArn],
    }));

    cdk.Validations.of(processor).acknowledge({
      id: 'AwsSolutions-IAM5',
      reason:
        'Two wildcards. X-Ray has no resource-level permissions. The S3 object ARN is bucket/*/*/* because tenant and customer IDs are not known at deploy time. That statement allows only s3:GetObject. DynamoDB, KMS and SQS statements name exact ARNs.',
    });
    cdk.Validations.of(processor).acknowledge({
      id: 'AwsSolutions-L1',
      reason:
        'The project standard is Node.js 22 on ARM64 (repository.md, .nvmrc). Moving to a newer runtime is a platform decision for both owners, not part of T-13.',
    });
    cdk.Validations.of(evidenceDlq).acknowledge({
      id: 'AwsSolutions-SQS3',
      reason: 'This queue is itself the dead-letter queue for failed evidence events, so it has no dead-letter queue of its own.',
    });

    // --- Worker (T-15 / T-09): SQS job queue -> Worker -> Bedrock -> Decision Lambda ---
    // The Api stack is optional only so older stack tests can build Processing alone. build-app always passes it.
    if (props.api) this.addWorker(props, props.api);
  }

  private addWorker(props: ProcessingStackProps, api: ApiResources): void {
    const f = props.foundation;
    const worker = new ClaimsFunction(this, 'worker', {
      entry: path.join(REPO_ROOT, 'backend/processing/worker/index.ts'),
      timeout: cdk.Duration.seconds(props.config.workerTimeoutSeconds),
      memorySize: 512,
      environment: {
        CLAIMS_TABLE: f.claimsTable.tableName,
        POLICIES_TABLE: f.policiesTable.tableName,
        PACKS_TABLE: f.claimTypePacksTable.tableName,
        EVIDENCE_INDEX_TABLE: f.evidenceIndexTable.tableName,
        EVIDENCE_BUCKET: f.evidenceBucket.bucketName,
        DECISION_FUNCTION_NAME: this.decisionFunction.functionName,
        BEDROCK_MODEL_ID: props.config.bedrockModelId,
        MAX_TOKENS: String(props.config.maxTokens),
        MAX_EVIDENCE_IMAGE_BYTES: String(props.config.maxEvidenceImageBytes),
        FREQUENCY_WINDOW_DAYS: String(props.config.frequencyWindowDays),
        INJECT_BEDROCK_FAILURE: String(props.config.injectBedrockFailure ?? false),
      },
    });
    const wf = worker.function;

    // Explicit statements (not grant helpers): grants would edit Foundation/Api resource policies across stacks.
    const allow = (actions: string[], resources: string[], conditions?: Record<string, Record<string, string>>) =>
      wf.addToRolePolicy(new iam.PolicyStatement({ effect: iam.Effect.ALLOW, actions, resources, conditions }));
    const read = ['dynamodb:GetItem', 'dynamodb:Query'];
    // Read only. No Audit table access, no write action on any table.
    allow(read, [f.claimsTable.tableArn, `${f.claimsTable.tableArn}/index/byCustomer`]); // byCustomer: countRecentClaims
    allow(read, [f.policiesTable.tableArn]);
    allow(read, [f.claimTypePacksTable.tableArn]);
    allow(read, [f.evidenceIndexTable.tableArn, `${f.evidenceIndexTable.tableArn}/index/byEvidence`]);
    allow(['s3:GetObject'], [`${f.evidenceBucket.bucketArn}/*/*/*`]); // <tenant>/<customer>/<evidence>
    allow(
      ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes', 'sqs:ChangeMessageVisibility'],
      [api.jobQueue.queueArn],
    );
    allow(['kms:Decrypt', 'kms:DescribeKey'], [f.dataKey.keyArn]);
    allow(['lambda:InvokeFunction'], [this.decisionFunction.functionArn]);

    // Converse is authorized by bedrock:InvokeModel. The model ID is a cross-region inference profile.
    const modelId = props.config.bedrockModelId;
    const baseModelId = modelId.replace(/^(global|us)\./, '');
    const profileArn = `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${modelId}`;
    allow(['bedrock:InvokeModel'], [profileArn]);
    // A global profile routes to any Region, and its foundation-model ARN has an empty Region, so the Region part is a
    // wildcard (it also matches the empty form). The condition makes the foundation model usable only through this profile.
    allow(['bedrock:InvokeModel'], [`arn:aws:bedrock:*::foundation-model/${baseModelId}`], {
      StringEquals: { 'bedrock:InferenceProfileArn': profileArn },
    });

    // Explicit mapping: no queue policy or key policy edit crosses stacks.
    new lambda.EventSourceMapping(this, 'WorkerJobQueueMapping', {
      target: wf,
      eventSourceArn: api.jobQueue.queueArn,
      batchSize: 1,
      maxConcurrency: 5,
      reportBatchItemFailures: true,
    });

    // DLQ -> Decision (route-only mode). The single handler dispatches SQS events (Records) to routeOnly.
    // Explicit statements for the same cross-stack reason as above.
    this.decisionFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes', 'sqs:ChangeMessageVisibility'],
      resources: [api.jobDlq.queueArn],
    }));
    // The decision role already has kms:Decrypt on the data key (the DLQ uses the same key).
    new lambda.EventSourceMapping(this, 'DecisionDlqMapping', {
      target: this.decisionFunction,
      eventSourceArn: api.jobDlq.queueArn,
      batchSize: 10,
      reportBatchItemFailures: true,
    });

    cdk.Validations.of(worker).acknowledge({
      id: 'AwsSolutions-IAM5',
      reason:
        'Wildcards: X-Ray has no resource-level permissions. The S3 object ARN is bucket/*/*/* because tenant and customer IDs are not known at deploy time (s3:GetObject only). The Bedrock foundation-model ARN has a Region wildcard because a global inference profile routes to any Region, and a condition limits it to this one profile. DynamoDB index ARNs name exact indexes. Everything else names an exact ARN.',
    });
    cdk.Validations.of(worker).acknowledge({
      id: 'AwsSolutions-L1',
      reason:
        'The project standard is Node.js 22 on ARM64 (repository.md, .nvmrc). Moving to a newer runtime is a platform decision for both owners, not part of T-15.',
    });
  }
}
