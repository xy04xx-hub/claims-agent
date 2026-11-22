# infra/lib/stacks
Owner: B (muzair110) for Foundation, Auth, Api, Web, Ops. A for Processing and Agent.

CDK stacks. `../build-app.ts` is the only place that creates them.

| Stack | File | Owner | Ticket | Status as of T-08 |
|---|---|---|---|---|
| Foundation | `foundation-stack.ts` | B | T-05 | Merged. KMS key, five tables, evidence bucket, SSM parameters |
| Auth | `auth-stack.ts` | B | T-06 | Filled by T-06. User pool, groups, trigger, domain, clients |
| Api | `api-stack.ts` | B | T-08 | Filled by T-08. HTTP API with Cognito JWT authorizer, nine routes (all answer 501 until T-09 and T-10), two Lambdas (customer, adjuster), throttling, access logs, CORS |
| Web | `web-stack.ts` | B | T-07 | Merged. Console bucket, CloudFront, headers, deployment |
| Ops | `ops-stack.ts` | B | T-25 | Empty class |
| Processing | `processing-stack.ts` | A | T-14 | Decision Lambda merged. Worker, queue and evidence processor still to come |
| Agent | `agent-stack.ts` | A | T-16 onward | Empty class |

## How stacks share handles

Each stack exposes its resources through an interface (`FoundationResources`, `WebResources`, `AuthResources`). `build-app.ts` passes them to other stacks as typed props: Processing takes `foundation`, and Auth takes `consoleUrl` from Web. There is no `Fn.importValue` and no hand-written export name. CloudFormation creates the cross-stack references from the typed props.
