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

    this.consoleBucket = bucket;
    this.distribution = distribution;
    this.distributionDomainName = distribution.distributionDomainName;
    this.consoleUrl = `https://${distribution.distributionDomainName}`;

    new cdk.CfnOutput(this, 'ConsoleUrl', { value: this.consoleUrl });
    new cdk.CfnOutput(this, 'DistributionDomainName', { value: this.distributionDomainName });
    new cdk.CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new cdk.CfnOutput(this, 'ConsoleBucketName', { value: bucket.bucketName });
  }
}
