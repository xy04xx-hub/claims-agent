// Owner: B (muzair110)
import type { HttpRouteIntegrationBindOptions } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration, type HttpLambdaIntegrationProps } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import { Stack } from 'aws-cdk-lib';

/**
 * Lambda proxy integration whose invoke permission names the stage (any), the HTTP method and the
 * route path. The stock HttpLambdaIntegration uses `*` for the method. Create one instance per route,
 * because the method is fixed per instance.
 */
export class RouteScopedLambdaIntegration extends HttpLambdaIntegration {
  // The base class fields `handler` and `props` are private, so this class keeps its own copies.
  private readonly target: lambda.IFunction;
  private readonly httpMethod: 'GET' | 'POST';
  private readonly integrationId: string;

  constructor(id: string, handler: lambda.IFunction, method: 'GET' | 'POST', props?: HttpLambdaIntegrationProps) {
    super(id, handler, props);
    this.target = handler;
    this.httpMethod = method;
    this.integrationId = id;
  }

  // Does not call super.completeBind: that would add the method-wildcard permission.
  protected override completeBind(options: HttpRouteIntegrationBindOptions): void {
    const route = options.route;
    this.target.addPermission(`${this.integrationId}-Permission`, {
      scope: options.scope,
      principal: new ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: Stack.of(route).formatArn({
        service: 'execute-api',
        resource: route.httpApi.apiId,
        resourceName: `*/${this.httpMethod}${route.path ?? ''}`,
      }),
    });
  }
}
