import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';
import { ClaimsFunction } from '../constructs/claims-function.js';
import {
  ACCESS_LOG_RETENTION_DAYS,
  API_ROUTES,
  CORS,
  FUNCTION_ENTRIES,
  FUNCTION_SETTINGS,
  INTEGRATION_TIMEOUT_SECONDS,
  METRICS_NAMESPACE,
  THROTTLE,
  accessLogFormat,
  buildAudience,
  routeConstructId,
  type FunctionKey,
} from '../constructs/platform/api-model.js';
import { RouteScopedLambdaIntegration } from '../constructs/platform/route-scoped-lambda-integration.js';
import type { BaseStackProps } from '../stack-props.js';
import { stackName } from '../stage.js';
import type { AuthResources } from './auth-stack.js';
import type { FoundationResources } from './foundation-stack.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export interface ApiStackProps extends BaseStackProps {
  /** Typed handles from the Auth stack. Never looked up by name. */
  auth: AuthResources;
  /** Typed handles from the Foundation stack (tables, key, evidence bucket). */
  foundation: FoundationResources;
}

export interface ApiResources {
  readonly httpApi: apigwv2.IHttpApi;
  readonly apiId: string;
  /** `https://<id>.execute-api.<region>.amazonaws.com`, no trailing slash. */
  readonly apiUrl: string;
  readonly customerFunction: lambda.IFunction;
  readonly adjusterFunction: lambda.IFunction;
  /** Claim jobs. Consumed by the Worker in the Processing stack. */
  readonly jobQueue: sqs.IQueue;
  /** Jobs that failed all receives. Consumed by the Decision Lambda in route-only mode. */
  readonly jobDlq: sqs.IQueue;
}

// Owner: B (muzair110)
export class ApiStack extends cdk.Stack implements ApiResources {
  readonly removalPolicy: cdk.RemovalPolicy;
  readonly httpApi: apigwv2.IHttpApi;
  readonly apiId: string;
  readonly apiUrl: string;
  readonly customerFunction: lambda.IFunction;
  readonly adjusterFunction: lambda.IFunction;
  readonly jobQueue: sqs.IQueue;
  readonly jobDlq: sqs.IQueue;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, { ...props, stackName: stackName(props.stage, 'Api') });
    this.removalPolicy = props.removalPolicy;

    // 1. JWT audience: the console client, plus the verification client when it exists.
    const audience = buildAudience(props.auth.appClientId, props.auth.verificationClientId);

    // 2. Two functions, one role each. Explicit statements below, no grant* helpers.
    const f = props.foundation;

    // Job queue and DLQ. Passing the Foundation key only sets encryption; CDK does not edit the key policy for a
    // Queue, and the key policy delegates to IAM, so the consumers' role statements are enough.
    const jobDlq = new sqs.Queue(this, 'JobDlq', {
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: f.dataKey,
      enforceSSL: true,
      retentionPeriod: cdk.Duration.days(14),
    });
    cdk.Validations.of(jobDlq).acknowledge({
      id: 'AwsSolutions-SQS3',
      reason: 'This queue is the dead-letter queue for the job queue.',
    });
    const jobQueue = new sqs.Queue(this, 'JobQueue', {
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: f.dataKey,
      enforceSSL: true,
      // At least 6 times the Worker timeout (architecture.md).
      visibilityTimeout: cdk.Duration.seconds(props.config.workerTimeoutSeconds * 6),
      deadLetterQueue: { queue: jobDlq, maxReceiveCount: props.config.sqsMaxReceiveCount },
    });
    new cloudwatch.Alarm(this, 'JobDlqNotEmptyAlarm', {
      alarmDescription: 'A claim job reached the dead-letter queue.',
      metric: jobDlq.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(1),
        statistic: 'Maximum',
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const environments: Record<FunctionKey, Record<string, string>> = {
      'api-customer': {
        CLAIMS_TABLE: f.claimsTable.tableName,
        POLICIES_TABLE: f.policiesTable.tableName,
        PACKS_TABLE: f.claimTypePacksTable.tableName,
        EVIDENCE_INDEX_TABLE: f.evidenceIndexTable.tableName,
        EVIDENCE_BUCKET: f.evidenceBucket.bucketName,
        MAX_UPLOAD_BYTES: String(props.config.maxUploadBytes),
        MAX_DESCRIPTION_LENGTH: String(props.config.maxDescriptionLength),
        MAX_EVIDENCE_FILES: String(props.config.maxEvidenceFilesPerClaim),
        JOB_QUEUE_URL: jobQueue.queueUrl,
      },
      // The adjuster repository is built on the decision store, which takes all five table names.
      // Only Claims and AuditLog are reachable by IAM below.
      'api-adjuster': {
        CLAIMS_TABLE: f.claimsTable.tableName,
        POLICIES_TABLE: f.policiesTable.tableName,
        PACKS_TABLE: f.claimTypePacksTable.tableName,
        EVIDENCE_INDEX_TABLE: f.evidenceIndexTable.tableName,
        AUDIT_TABLE: f.auditLogTable.tableName,
      },
    };
    const functions = {} as Record<FunctionKey, lambda.Function>;
    const claimsFunctions = {} as Record<FunctionKey, ClaimsFunction>;
    for (const key of Object.keys(FUNCTION_ENTRIES) as FunctionKey[]) {
      const claimsFunction = new ClaimsFunction(this, key, {
        entry: path.join(REPO_ROOT, FUNCTION_ENTRIES[key]),
        timeout: cdk.Duration.seconds(FUNCTION_SETTINGS.timeoutSeconds),
        memorySize: FUNCTION_SETTINGS.memorySize,
        environment: { POWERTOOLS_METRICS_NAMESPACE: METRICS_NAMESPACE, ...environments[key] },
      });
      claimsFunctions[key] = claimsFunction;
      functions[key] = claimsFunction.function;
    }

    // Least privilege. Explicit PolicyStatements, not grant*/key.grant: those edit the Foundation resource policies
    // and would create a cross-stack dependency cycle (see processing-stack.ts).
    const dataKeyActions = ['kms:Decrypt', 'kms:GenerateDataKey', 'kms:DescribeKey'];
    const claimsArn = f.claimsTable.tableArn;

    const customer = functions['api-customer'];
    const allowCustomer = (actions: string[], resources: string[], conditions?: Record<string, Record<string, unknown>>) =>
      customer.addToRolePolicy(new iam.PolicyStatement({ actions, resources, ...(conditions ? { conditions } : {}) }));
    allowCustomer(['dynamodb:GetItem', 'dynamodb:PutItem'], [claimsArn]);
    allowCustomer(['dynamodb:Query'], [`${claimsArn}/index/byCustomer`]);
    // The only update the customer role may make: stamping enqueuedAt after the job is sent.
    // dynamodb:Attributes also lists the key attributes and those named in the condition expression, so pk and sk
    // must be allowed. UpdateItem cannot modify key attributes, so this does not widen what can be written.
    allowCustomer(['dynamodb:UpdateItem'], [claimsArn], {
      'ForAllValues:StringEquals': { 'dynamodb:Attributes': ['pk', 'sk', 'enqueuedAt'] },
    });
    allowCustomer(['dynamodb:GetItem', 'dynamodb:Query'], [f.policiesTable.tableArn, `${f.policiesTable.tableArn}/index/byCustomer`]);
    allowCustomer(['dynamodb:GetItem', 'dynamodb:Query'], [f.claimTypePacksTable.tableArn]);
    allowCustomer(['dynamodb:GetItem', 'dynamodb:PutItem'], [f.evidenceIndexTable.tableArn]);
    allowCustomer(['dynamodb:Query'], [`${f.evidenceIndexTable.tableArn}/index/byEvidence`]);
    // The presigned POST is signed with this role. Keys are <tenantId>/<customerId>/<evidenceId>.
    allowCustomer(['s3:PutObject'], [`${f.evidenceBucket.bucketArn}/*/*/*`]);
    allowCustomer(['sqs:SendMessage'], [jobQueue.queueArn]);
    allowCustomer(dataKeyActions, [f.dataKey.keyArn]);

    const adjuster = functions['api-adjuster'];
    const allowAdjuster = (actions: string[], resources: string[], conditions?: Record<string, Record<string, unknown>>) =>
      adjuster.addToRolePolicy(new iam.PolicyStatement({ actions, resources, ...(conditions ? { conditions } : {}) }));
    allowAdjuster(['dynamodb:GetItem'], [claimsArn]);
    allowAdjuster(['dynamodb:Query'], [`${claimsArn}/index/byQueue`]);
    // Resolution writes only. The status, the resolution record and the queue keys (removed on resolve).
    allowAdjuster(['dynamodb:UpdateItem'], [claimsArn], {
      'ForAllValues:StringEquals': { 'dynamodb:Attributes': ['pk', 'sk', 'status', 'resolution', 'gsi2pk', 'gsi2sk'] },
    });
    allowAdjuster(['dynamodb:PutItem'], [f.auditLogTable.tableArn]);
    allowAdjuster(dataKeyActions, [f.dataKey.keyArn]);

    cdk.Validations.of(claimsFunctions['api-customer']).acknowledge({
      id: 'AwsSolutions-IAM5',
      reason:
        'The only added wildcard is the S3 object ARN bucket/*/*/* (s3:PutObject only), because tenant, customer and evidence IDs are not known at deploy time. Every DynamoDB, index and KMS statement names an exact ARN.',
    });

    // cdk-nag acknowledgments, each on the ClaimsFunction construct that carries the finding.
    for (const claimsFunction of Object.values(claimsFunctions)) {
      cdk.Validations.of(claimsFunction).acknowledge({
        id: 'AwsSolutions-IAM5[Resource::*]',
        reason:
          'The X-Ray write actions do not support resource-level permissions, so AWS requires a wildcard. The statement comes from the shared ClaimsFunction.',
      });
      cdk.Validations.of(claimsFunction).acknowledge({
        id: 'AwsSolutions-L1',
        reason:
          'The project standard is Node.js 22 on ARM64 (repository.md, .nvmrc). Raising the runtime is a project-wide decision for both owners.',
      });
    }

    // 3. Access log group.
    const accessLogGroup = new logs.LogGroup(this, 'AccessLogs', {
      retention: ACCESS_LOG_RETENTION_DAYS as logs.RetentionDays,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // logs are not data worth retaining
    });

    // 4. JWT authorizer (Cognito access tokens).
    const defaultAuthorizer = new HttpJwtAuthorizer('JwtAuthorizer', props.auth.issuerUrl, {
      jwtAudience: audience,
      authorizerName: 'cognito-access-token',
    });

    // 5. HTTP API with CORS. No default integration, no $default route.
    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: stackName(props.stage, 'Api'),
      createDefaultStage: false,
      defaultAuthorizer,
      corsPreflight: {
        allowOrigins: props.config.consoleOrigins,
        allowMethods: CORS.allowMethods.map((m) => m as apigwv2.CorsHttpMethod),
        allowHeaders: [...CORS.allowHeaders],
        exposeHeaders: [...CORS.exposeHeaders],
        allowCredentials: CORS.allowCredentials,
        maxAge: cdk.Duration.seconds(CORS.maxAgeSeconds),
      },
    });

    // 6. $default stage with throttling and JSON access logs.
    httpApi.addStage('DefaultStage', {
      stageName: '$default',
      autoDeploy: true,
      throttle: { ...THROTTLE },
      accessLogSettings: {
        destination: new apigwv2.LogGroupLogDestination(accessLogGroup),
        format: apigateway.AccessLogFormat.custom(accessLogFormat()),
      },
    });

    // 7. One route and one method-scoped integration per row. The default authorizer applies.
    for (const route of API_ROUTES) {
      httpApi.addRoutes({
        path: route.path,
        methods: [route.method as apigwv2.HttpMethod],
        integration: new RouteScopedLambdaIntegration(
          routeConstructId(route),
          functions[route.function],
          route.method,
          { timeout: cdk.Duration.seconds(INTEGRATION_TIMEOUT_SECONDS) },
        ),
      });
    }

    // 9. Handles and outputs (no export names).
    this.httpApi = httpApi;
    this.apiId = httpApi.apiId;
    this.apiUrl = httpApi.apiEndpoint;
    this.customerFunction = functions['api-customer'];
    this.adjusterFunction = functions['api-adjuster'];
    this.jobQueue = jobQueue;
    this.jobDlq = jobDlq;

    new cdk.CfnOutput(this, 'JobQueueUrl', { value: jobQueue.queueUrl });
    new cdk.CfnOutput(this, 'JobDlqUrl', { value: jobDlq.queueUrl });
    new cdk.CfnOutput(this, 'ApiUrl', { value: this.apiUrl });
    new cdk.CfnOutput(this, 'ApiId', { value: this.apiId });
    new cdk.CfnOutput(this, 'CustomerFunctionName', { value: this.customerFunction.functionName });
    new cdk.CfnOutput(this, 'AdjusterFunctionName', { value: this.adjusterFunction.functionName });
  }
}
