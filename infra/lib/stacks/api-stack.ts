import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
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

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export interface ApiStackProps extends BaseStackProps {
  /** Typed handles from the Auth stack. Never looked up by name. */
  auth: AuthResources;
}

export interface ApiResources {
  readonly httpApi: apigwv2.IHttpApi;
  readonly apiId: string;
  /** `https://<id>.execute-api.<region>.amazonaws.com`, no trailing slash. */
  readonly apiUrl: string;
  readonly customerFunction: lambda.IFunction;
  readonly adjusterFunction: lambda.IFunction;
}

// Owner: B (muzair110)
export class ApiStack extends cdk.Stack implements ApiResources {
  readonly removalPolicy: cdk.RemovalPolicy;
  readonly httpApi: apigwv2.IHttpApi;
  readonly apiId: string;
  readonly apiUrl: string;
  readonly customerFunction: lambda.IFunction;
  readonly adjusterFunction: lambda.IFunction;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, { ...props, stackName: stackName(props.stage, 'Api') });
    this.removalPolicy = props.removalPolicy;

    // 1. JWT audience: the console client, plus the verification client when it exists.
    const audience = buildAudience(props.auth.appClientId, props.auth.verificationClientId);

    // 2. Two functions, one role each. No data-service grants.
    const functions = {} as Record<FunctionKey, lambda.Function>;
    for (const key of Object.keys(FUNCTION_ENTRIES) as FunctionKey[]) {
      functions[key] = new ClaimsFunction(this, key, {
        entry: path.join(REPO_ROOT, FUNCTION_ENTRIES[key]),
        timeout: cdk.Duration.seconds(FUNCTION_SETTINGS.timeoutSeconds),
        memorySize: FUNCTION_SETTINGS.memorySize,
        environment: { POWERTOOLS_METRICS_NAMESPACE: METRICS_NAMESPACE },
      }).function;
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

    new cdk.CfnOutput(this, 'ApiUrl', { value: this.apiUrl });
    new cdk.CfnOutput(this, 'ApiId', { value: this.apiId });
    new cdk.CfnOutput(this, 'CustomerFunctionName', { value: this.customerFunction.functionName });
    new cdk.CfnOutput(this, 'AdjusterFunctionName', { value: this.adjusterFunction.functionName });
  }
}
