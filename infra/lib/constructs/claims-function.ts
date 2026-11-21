// Owner: B (muzair110). SHARED FILE: changes to this file need review by BOTH owners
// (see CODEOWNERS and repository.md section 2). Keep PRs that touch it small.
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

/**
 * Props for ClaimsFunction. `runtime`, `architecture` and `role` are deliberately
 * absent: every Lambda uses Node.js 22, ARM64 and its own dedicated role.
 */
export interface ClaimsFunctionProps {
  /** Handler source file, for example backend/api/api-customer/index.ts. */
  readonly entry: string;
  /** Required, no default. 1 to 900 seconds. */
  readonly timeout: cdk.Duration;
  /** Required, no default. 128 to 10,240 MB. */
  readonly memorySize: number;
  /** Caller's variables. Only the two standard variables are added to them. */
  readonly environment?: Record<string, string>;
  /** Exported handler name. Defaults to 'handler'. */
  readonly handler?: string;
}

export class ClaimsFunction extends Construct {
  readonly function: lambda.Function;

  constructor(scope: Construct, id: string, props: ClaimsFunctionProps) {
    super(scope, id);

    const seconds = props.timeout.toSeconds();
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 900) {
      throw new Error(`ClaimsFunction "${id}": timeout must be between 1 and 900 seconds, got ${seconds}`);
    }
    if (!Number.isFinite(props.memorySize) || props.memorySize < 128 || props.memorySize > 10240) {
      throw new Error(`ClaimsFunction "${id}": memorySize must be between 128 and 10240 MB, got ${props.memorySize}`);
    }

    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // logs are not data worth retaining
    });

    const role = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        Basic: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
              resources: [logGroup.logGroupArn],
            }),
            new iam.PolicyStatement({
              // X-Ray does not support resource-level permissions, so '*' is required by AWS.
              actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    this.function = new NodejsFunction(this, 'Function', {
      entry: props.entry,
      handler: props.handler ?? 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      tracing: lambda.Tracing.ACTIVE,
      timeout: props.timeout,
      memorySize: props.memorySize,
      role,
      logGroup,
      // Set by hand below so the variable list stays exact.
      awsSdkConnectionReuse: false,
      environment: {
        ...props.environment,
        POWERTOOLS_SERVICE_NAME: id,
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      },
      bundling: {
        target: 'node22',
        // Powertools is bundled; the runtime provides the AWS SDK.
        externalModules: ['@aws-sdk/*'],
      },
    });
  }
}
