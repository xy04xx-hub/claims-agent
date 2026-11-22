# infra/lib/constructs/platform
Owner: B (muzair110)

Platform helpers used by the stacks. Most are pure functions with no AWS resources, so they can be tested without synthesizing a stack.

| File | Purpose |
|---|---|
| `app-client-urls.ts` | Builds the Cognito callback and logout URLs from the console URL and the local origins. |
| `auth-model.ts` | Constants for the Auth stack: group names, tenant attribute and pattern, password policy, token lifetimes, trigger settings. Imports nothing from `aws-cdk-lib`, so scripts can use it. |
| `cognito-domain.ts` | Derives the Cognito domain prefix `claims-<stage>-<8 hex>` from account, region and stage, and rejects reserved words. |
| `console-assets.ts` | Chooses `frontend/dist` or the placeholder page as the console content. |
| `csp.ts` | Builds the Content-Security-Policy header from the three CSP config keys. |
| `data-model.ts` | DynamoDB key and index attribute names for the five tables. |
| `data-protection.ts` | Removal policy and deletion protection by stage. |
| `evidence-bucket-config.ts` | CORS rule and lifecycle rules for the evidence bucket. |
| `ssm-parameters.ts` | Names and values of the SSM parameters, including the kill switch. |

Helpers for the claims engine live in `../engine` (owner A). Add a row here when you add a helper to this folder.
