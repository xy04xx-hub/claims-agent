import * as cdk from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import type { BaseStackProps } from '../stack-props.js';
import { stackName } from '../stage.js';

// Owner: B (muzair110)
export class WebStack extends cdk.Stack {
  readonly removalPolicy: cdk.RemovalPolicy;

  constructor(scope: Construct, id: string, props: BaseStackProps) {
    super(scope, id, { ...props, stackName: stackName(props.stage, 'Web') });
    this.removalPolicy = props.removalPolicy;
  }
}
