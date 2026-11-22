// Owner: B (muzair110)
// Synth test for RouteScopedLambdaIntegration (T-08, task 4.3).
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { afterAll, describe, expect, it } from 'vitest';
import { RouteScopedLambdaIntegration } from '../lib/constructs/platform/route-scoped-lambda-integration.js';

const tmpDirs: string[] = [];
afterAll(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function synth(): Template {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-test-'));
  tmpDirs.push(outdir);
  const app = new cdk.App({ outdir });
  const stack = new cdk.Stack(app, 'T', { env: { account: '111122223333', region: 'us-east-1' } });
  const fn = new lambda.Function(stack, 'Fn', {
    runtime: lambda.Runtime.NODEJS_22_X,
    handler: 'index.handler',
    code: lambda.Code.fromInline('exports.handler = async () => ({})'),
  });
  const api = new HttpApi(stack, 'Api');
  api.addRoutes({
    path: '/claims/{claimId}',
    methods: [HttpMethod.GET],
    integration: new RouteScopedLambdaIntegration('GetClaim', fn, 'GET'),
  });
  api.addRoutes({
    path: '/claims',
    methods: [HttpMethod.POST],
    integration: new RouteScopedLambdaIntegration('PostClaims', fn, 'POST'),
  });
  return Template.fromStack(stack);
}

describe('RouteScopedLambdaIntegration', () => {
  const template = synth();
  const permissions = Object.values(template.findResources('AWS::Lambda::Permission'));
  const sourceArns = permissions.map((p) => JSON.stringify(p.Properties.SourceArn));

  it('adds exactly one permission per route', () => {
    expect(permissions).toHaveLength(2);
  });

  it('names the method and the literal path template in the source ARN', () => {
    const get = sourceArns.filter((s) => s.includes('/*/GET/claims/{claimId}'));
    const post = sourceArns.filter((s) => s.includes('/*/POST/claims'));
    expect(get).toHaveLength(1);
    expect(post).toHaveLength(1);
    for (const arn of sourceArns) {
      expect(arn).toContain(':execute-api:us-east-1:111122223333:');
      expect(arn).not.toContain('/*/*');
    }
  });

  it('keeps the proxy integration with payload format 2.0', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Integration', {
      IntegrationType: 'AWS_PROXY',
      PayloadFormatVersion: '2.0',
    });
  });
});
