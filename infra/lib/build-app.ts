import * as cdk from 'aws-cdk-lib';
import { applyNag } from './nag.js';
import type { BaseStackProps } from './stack-props.js';
import { AgentStack } from './stacks/agent-stack.js';
import { ApiStack } from './stacks/api-stack.js';
import { AuthStack } from './stacks/auth-stack.js';
import { FoundationStack } from './stacks/foundation-stack.js';
import { OpsStack } from './stacks/ops-stack.js';
import { ProcessingStack } from './stacks/processing-stack.js';
import { WebStack } from './stacks/web-stack.js';

/** Creates the seven stacks, applies tags and cdk-nag. Does not synthesize. */
export function buildApp(app: cdk.App, props: BaseStackProps): void {
  // ---- Foundation: owner B (muzair110) ----
  new FoundationStack(app, 'Foundation', props);
  // ---- Auth: owner B (muzair110) ----
  new AuthStack(app, 'Auth', props);
  // ---- Api: owner B (muzair110) ----
  new ApiStack(app, 'Api', props);
  // ---- Web: owner B (muzair110) ----
  new WebStack(app, 'Web', props);
  // ---- Ops: owner B (muzair110) ----
  new OpsStack(app, 'Ops', props);
  // ---- Processing: owner A ----
  new ProcessingStack(app, 'Processing', props);
  // ---- Agent: owner A ----
  new AgentStack(app, 'Agent', props);

  cdk.Tags.of(app).add('project', 'claims-agent');
  cdk.Tags.of(app).add('stage', props.stage);
  applyNag(app);
}
