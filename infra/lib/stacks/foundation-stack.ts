import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { TABLE_SPECS, KEY_ATTR, type TableSpec } from '../constructs/platform/data-model.js';
import { resolveDataProtection } from '../constructs/platform/data-protection.js';
import {
  buildCorsRule,
  buildLifecycleRules,
} from '../constructs/platform/evidence-bucket-config.js';
import {
  buildParameters,
  PARAMETER_KEYS,
  type ParameterKey,
} from '../constructs/platform/ssm-parameters.js';
import type { BaseStackProps } from '../stack-props.js';
import { stackName } from '../stage.js';

/** Typed handles that later stacks receive through stack props. */
export interface FoundationResources {
  readonly dataKey: kms.IKey;
  readonly policiesTable: dynamodb.ITable;
  readonly claimsTable: dynamodb.ITable;
  readonly evidenceIndexTable: dynamodb.ITable;
  readonly claimTypePacksTable: dynamodb.ITable;
  readonly auditLogTable: dynamodb.ITable;
  readonly evidenceBucket: s3.IBucket;
  readonly autoApproveEnabledParameter: ssm.IStringParameter;
  readonly earlyClaimDaysParameter: ssm.IStringParameter;
  readonly frequencyWindowDaysParameter: ssm.IStringParameter;
  readonly frequencyMaxClaimsParameter: ssm.IStringParameter;
  readonly outlierMultipleParameter: ssm.IStringParameter;
  readonly parameterNames: Record<ParameterKey, string>;
}

// Owner: B (muzair110)
export class FoundationStack extends cdk.Stack implements FoundationResources {
  readonly removalPolicy: cdk.RemovalPolicy;
  readonly dataKey: kms.IKey;
  readonly policiesTable: dynamodb.ITable;
  readonly claimsTable: dynamodb.ITable;
  readonly evidenceIndexTable: dynamodb.ITable;
  readonly claimTypePacksTable: dynamodb.ITable;
  readonly auditLogTable: dynamodb.ITable;
  readonly evidenceBucket: s3.IBucket;
  readonly autoApproveEnabledParameter: ssm.IStringParameter;
  readonly earlyClaimDaysParameter: ssm.IStringParameter;
  readonly frequencyWindowDaysParameter: ssm.IStringParameter;
  readonly frequencyMaxClaimsParameter: ssm.IStringParameter;
  readonly outlierMultipleParameter: ssm.IStringParameter;
  readonly parameterNames: Record<ParameterKey, string>;

  constructor(scope: Construct, id: string, props: BaseStackProps) {
    super(scope, id, { ...props, stackName: stackName(props.stage, 'Foundation') });
    this.removalPolicy = props.removalPolicy;
    const protection = resolveDataProtection(props.stage, props.removalPolicy);
    const destroy = protection.removalPolicy === cdk.RemovalPolicy.DESTROY;

    const dataKey = new kms.Key(this, 'DataKey', {
      description: `Claims data key (${props.stage})`,
      enableKeyRotation: true,
      removalPolicy: protection.removalPolicy,
      ...(destroy ? { pendingWindow: cdk.Duration.days(7) } : {}),
    });
    this.dataKey = dataKey;

    const makeTable = (spec: TableSpec): dynamodb.Table => {
      const table = new dynamodb.Table(this, `${spec.id}Table`, {
        partitionKey: { name: KEY_ATTR.pk, type: dynamodb.AttributeType.STRING },
        sortKey: { name: KEY_ATTR.sk, type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
        encryptionKey: dataKey,
        pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
        deletionProtection: protection.deletionProtection,
        removalPolicy: protection.removalPolicy,
      });
      for (const index of spec.indexes) {
        table.addGlobalSecondaryIndex({
          indexName: index.name,
          partitionKey: { name: index.pk, type: dynamodb.AttributeType.STRING },
          ...(index.sk
            ? { sortKey: { name: index.sk, type: dynamodb.AttributeType.STRING } }
            : {}),
          projectionType: dynamodb.ProjectionType.ALL,
        });
      }
      return table;
    };
    const tables = Object.fromEntries(TABLE_SPECS.map((s) => [s.id, makeTable(s)])) as Record<
      TableSpec['id'],
      dynamodb.Table
    >;
    this.policiesTable = tables.Policies;
    this.claimsTable = tables.Claims;
    this.evidenceIndexTable = tables.EvidenceIndex;
    this.claimTypePacksTable = tables.ClaimTypePacks;
    this.auditLogTable = tables.AuditLog;

    const bucket = new s3.Bucket(this, 'EvidenceBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: dataKey,
      bucketKeyEnabled: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      cors: [buildCorsRule(props.config.consoleOrigins)],
      lifecycleRules: buildLifecycleRules(props.config.evidenceRetentionDays),
      removalPolicy: protection.removalPolicy,
      autoDeleteObjects: protection.autoDeleteObjects,
    });
    // Native EventBridge notifications. The `eventBridgeEnabled` prop would add a
    // Custom::S3BucketNotifications resource and a handler Lambda with its own role.
    (bucket.node.defaultChild as s3.CfnBucket).notificationConfiguration = {
      eventBridgeConfiguration: { eventBridgeEnabled: true },
    };
    this.evidenceBucket = bucket;
    cdk.Validations.of(bucket).acknowledge({
      id: 'AwsSolutions-S1',
      reason:
        'Server access logging is deferred to the pilot. Object access is recorded by CloudTrail data events instead, and the bucket holds only synthetic demo evidence.',
    });

    const specs = buildParameters(props.stage, props.config);
    const params = {} as Record<ParameterKey, ssm.StringParameter>;
    const names = {} as Record<ParameterKey, string>;
    for (const key of PARAMETER_KEYS) {
      const p = new ssm.StringParameter(this, `Param-${key}`, {
        parameterName: specs[key].name,
        stringValue: specs[key].value,
      });
      p.applyRemovalPolicy(protection.removalPolicy);
      params[key] = p;
      names[key] = specs[key].name;
    }
    this.autoApproveEnabledParameter = params.autoApproveEnabled;
    this.earlyClaimDaysParameter = params.earlyClaimDays;
    this.frequencyWindowDaysParameter = params.frequencyWindowDays;
    this.frequencyMaxClaimsParameter = params.frequencyMaxClaims;
    this.outlierMultipleParameter = params.outlierMultiple;
    this.parameterNames = names;

    new cdk.CfnOutput(this, 'EvidenceBucketName', { value: bucket.bucketName });
    new cdk.CfnOutput(this, 'ClaimsTableName', { value: tables.Claims.tableName });
    new cdk.CfnOutput(this, 'DataKeyArn', { value: dataKey.keyArn });
  }
}
