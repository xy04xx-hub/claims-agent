import * as fs from 'node:fs';
import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';
import {
  FRONTEND_DIST,
  PLACEHOLDER_DIR,
  resolveConsoleAssetDir,
} from '../constructs/platform/console-assets.js';
import { buildCsp } from '../constructs/platform/csp.js';
import { resolveDataProtection } from '../constructs/platform/data-protection.js';
import type { BaseStackProps } from '../stack-props.js';
import { stackName } from '../stage.js';

/** Typed handles that later stacks (for example Auth) receive through stack props. */
export interface WebResources {
  readonly consoleBucket: s3.IBucket;
  readonly distribution: cloudfront.IDistribution;
  readonly distributionDomainName: string;
  readonly consoleUrl: string;
}

// Owner: B (muzair110)
export class WebStack extends cdk.Stack implements WebResources {
  readonly removalPolicy: cdk.RemovalPolicy;
  readonly consoleBucket: s3.IBucket;
  readonly distribution: cloudfront.IDistribution;
  readonly distributionDomainName: string;
  readonly consoleUrl: string;

  constructor(scope: Construct, id: string, props: BaseStackProps) {
    super(scope, id, { ...props, stackName: stackName(props.stage, 'Web') });
    this.removalPolicy = props.removalPolicy;
    const protection = resolveDataProtection(props.stage, props.removalPolicy);

    const bucket = new s3.Bucket(this, 'ConsoleBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: protection.removalPolicy,
      autoDeleteObjects: protection.autoDeleteObjects,
    });

    const headersPolicy = new cloudfront.ResponseHeadersPolicy(this, 'HeadersPolicy', {
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.seconds(63072000),
          includeSubdomains: true,
          preload: false,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        contentSecurityPolicy: { contentSecurityPolicy: buildCsp(props.config), override: true },
      },
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        responseHeadersPolicy: headersPolicy,
      },
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 200,
        responsePagePath: '/index.html',
        ttl: cdk.Duration.seconds(0),
      })),
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    });

    const assets = resolveConsoleAssetDir(FRONTEND_DIST, PLACEHOLDER_DIR, fs.existsSync);
    new s3deploy.BucketDeployment(this, 'ConsoleDeployment', {
      sources: [s3deploy.Source.asset(assets.dir)],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/*'],
      prune: true,
      retainOnDelete: protection.removalPolicy === cdk.RemovalPolicy.RETAIN,
    });
    if (assets.isPlaceholder) {
      cdk.Annotations.of(this).addWarning(
        'Web: deploying the placeholder page because frontend/dist/index.html does not exist.',
      );
    }

    this.acknowledgeNagFindings(bucket, distribution);

    this.consoleBucket = bucket;
    this.distribution = distribution;
    this.distributionDomainName = distribution.distributionDomainName;
    this.consoleUrl = `https://${distribution.distributionDomainName}`;

    new cdk.CfnOutput(this, 'ConsoleUrl', { value: this.consoleUrl });
    new cdk.CfnOutput(this, 'DistributionDomainName', { value: this.distributionDomainName });
    new cdk.CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new cdk.CfnOutput(this, 'ConsoleBucketName', { value: bucket.bucketName });
  }

  /** Each acknowledgment sits on the narrowest construct that cdk-nag reports the finding on. */
  private acknowledgeNagFindings(bucket: s3.Bucket, distribution: cloudfront.Distribution): void {
    cdk.Validations.of(bucket).acknowledge({
      id: 'AwsSolutions-S1',
      reason:
        'Server access logging is deferred to the pilot. The bucket holds only public console files and is reachable only through CloudFront.',
    });
    const distributionReasons: Record<string, string> = {
      'AwsSolutions-CFR1':
        'Geo restriction is not a requirement for the demo. Users sign in through Cognito, and a country allow-list is a pilot item.',
      'AwsSolutions-CFR2':
        'WAF is a documented non-goal for the MVP (architecture.md). It is a pilot hardening item in front of CloudFront.',
      'AwsSolutions-CFR3':
        'CloudFront access logging needs a log bucket that would itself need logging. Deferred to the pilot.',
      'AwsSolutions-CFR4':
        'The default CloudFront certificate ignores the minimum TLS version. A custom domain with an ACM certificate is a pilot item.',
    };
    for (const [id, reason] of Object.entries(distributionReasons)) {
      cdk.Validations.of(distribution).acknowledge({ id, reason });
    }

    // The BucketDeployment handler is a CDK-managed singleton under this stack, found by id prefix
    // so no generated hash is hard-coded.
    const handlers = this.node
      .findAll()
      .filter(
        (c) => c.node.scope === this && c.node.id.startsWith('Custom::CDKBucketDeployment'),
      );
    for (const handler of handlers) {
      const role = handler.node.tryFindChild('ServiceRole');
      const policy = role?.node.tryFindChild('DefaultPolicy');
      if (!role || !policy) {
        throw new Error(`Web: unexpected BucketDeployment handler layout at ${handler.node.path}`);
      }
      cdk.Validations.of(handler).acknowledge({
        id: 'AwsSolutions-L1',
        reason:
          'The CDK-managed BucketDeployment handler runtime is chosen by aws-cdk-lib, not by this project. It follows CDK upgrades.',
      });
      cdk.Validations.of(role).acknowledge({
        id: 'AwsSolutions-IAM4',
        reason:
          'The CDK-managed BucketDeployment handler role uses AWSLambdaBasicExecutionRole for log writes. The policy is chosen by aws-cdk-lib.',
      });
      // Base rule ID: the Resource:: findings for the CDK assets bucket contain the account ID,
      // which differs per account and must not be written into the repo.
      cdk.Validations.of(policy).acknowledge({
        id: 'AwsSolutions-IAM5',
        reason:
          'The CDK-managed BucketDeployment handler needs s3 wildcard actions on the asset and console buckets and cloudfront:CreateInvalidation on *. The policy is generated by aws-cdk-lib.',
      });
    }
  }
}
