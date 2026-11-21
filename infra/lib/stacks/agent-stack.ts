import * as cdk from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import type { BaseStackProps } from '../stack-props.js';
import { stackName } from '../stage.js';

// Owner: A
export class AgentStack extends cdk.Stack {
  readonly removalPolicy: cdk.RemovalPolicy;

  constructor(scope: Construct, id: string, props: BaseStackProps) {
    super(scope, id, { ...props, stackName: stackName(props.stage, 'Agent') });
    this.removalPolicy = props.removalPolicy;
  }
}
