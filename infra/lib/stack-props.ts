import type * as cdk from 'aws-cdk-lib';
import type { StageConfig } from './stage-config.js';

/** Props shared by every stack. Later tickets extend this with typed cross-stack props. */
export interface BaseStackProps extends cdk.StackProps {
  stage: string;
  config: StageConfig;
  /** Resolved removal policy. Data resources call applyRemovalPolicy with it. */
  removalPolicy: cdk.RemovalPolicy;
}
