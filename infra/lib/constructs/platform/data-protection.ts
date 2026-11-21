// Owner: B (muzair110)
import * as cdk from 'aws-cdk-lib';

export interface DataProtection {
  /** DynamoDB, S3 and KMS do not support Snapshot, so it maps to RETAIN. */
  removalPolicy: cdk.RemovalPolicy.DESTROY | cdk.RemovalPolicy.RETAIN;
  /** Table deletion protection: on only in the demo stage. */
  deletionProtection: boolean;
  /** Bucket autoDeleteObjects: only when resources are destroyed with the stack. */
  autoDeleteObjects: boolean;
}

export function resolveDataProtection(
  stage: string,
  removalPolicy: cdk.RemovalPolicy,
): DataProtection {
  const destroy = removalPolicy === cdk.RemovalPolicy.DESTROY;
  return {
    removalPolicy: destroy ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
    deletionProtection: stage === 'demo',
    autoDeleteObjects: destroy,
  };
}
