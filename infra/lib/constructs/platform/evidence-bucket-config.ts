// Owner: B (muzair110)
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';

/** One CORS rule: POST only (presigned POST uploads), no wildcard origin. */
export function buildCorsRule(origins: readonly string[]): s3.CorsRule {
  return {
    allowedMethods: [s3.HttpMethods.POST],
    allowedOrigins: [...origins],
    allowedHeaders: ['*'],
    exposedHeaders: ['ETag'],
    maxAge: 3000,
  };
}

export function buildLifecycleRules(retentionDays: number): s3.LifecycleRule[] {
  return [
    { id: 'expire-evidence', expiration: cdk.Duration.days(retentionDays) },
    {
      id: 'abort-incomplete-uploads',
      abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
    },
  ];
}
