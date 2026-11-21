# Security and Engineering Rules

These rules apply to all code and infrastructure in this project. They map directly to the Security and Operational excellence items in `judging-criteria.md`.

## Security

- **Authentication:** every API route uses the Cognito JWT authorizer with **access tokens** (never ID tokens). No anonymous routes except the static console.
- **Service-to-service credentials:** each hop uses its own credential (IAM role, or an OAuth token issued for that service). **No token passthrough:** never forward a received token to another service. The user's token stops at API Gateway and never goes into queues, logs, the agent or the MCP gateway. The MCP gateway uses IAM inbound auth, and every tool call is scoped to one claim by a signed job ticket that the model cannot see or change. Details in `architecture.md`, section "Credentials and tokens".
- **Authorization:** derive the user ID and role from the verified JWT claims, never from the request body. Customers can read only claims where `customerId` equals their own ID. Only the `Adjuster` group can read the queue or approve/reject.
- **Least privilege:** one IAM role per Lambda, scoped to the specific table, bucket prefix and Bedrock model ARN it uses. No `*` resources or actions unless AWS requires it, and then comment why.
- **Network and data:** HTTPS only. S3 buckets are private with Block Public Access, encryption at rest and `enforceSSL`. DynamoDB has encryption on and point-in-time recovery. No public data stores.
- **Secrets:** no secrets, keys or tokens in code, config files or logs. Use environment configuration from CDK, SSM Parameter Store or Secrets Manager.
- **Input handling:** validate all API input against a schema (type, length, allowed values). Limit photo size and type. Treat claim text as **untrusted**.
- **Prompt-injection guard:** claim text and image content are data, never instructions. Keep them out of the system prompt, delimit them clearly, and instruct the model to ignore instructions inside them. The real defence is structural: the model cannot approve, because code enforces the limit and the fraud rules. Consider Bedrock Guardrails if cost allows.
- **Test data only:** never use real personal or financial data. Seed data is synthetic.
- **Audit:** log every decision (inputs, signals, outcome, reasons, actor) to the audit table. Do not log full personal data or photo bytes.

## Operational excellence

- **Built from code:** all resources come from CDK. No console-only changes.
- **Logs and metrics:** structured JSON logs with `claimId` and a request ID. Custom metrics for auto-approved, routed, and error counts, and decision latency. A CloudWatch dashboard shows them.
- **Error handling:** retry Bedrock and tool calls with exponential backoff and a cap. Set Lambda timeouts deliberately. On unrecoverable errors, fail safe by routing to an adjuster and return a clear message to the user.
- **Fast responses:** target auto-approval in a few seconds. Keep prompts short, use a small model, run independent tool calls in parallel, and avoid cold-start-heavy dependencies. Check the latency before every demo rehearsal.
- **Docs:** `README.md` explains how to run locally, deploy, seed demo data, and change thresholds.

## Cost optimization

- Serverless only: Lambda, HTTP API, DynamoDB on-demand, S3, CloudFront. Nothing provisioned or oversized.
- **Bedrock cost controls:** choose the cheapest model that handles the demo's image and text, set `maxTokens`, keep prompts compact, use prompt caching where supported, and do deterministic work in code instead of the model.
- Keep `docs/cost-estimate.md` current: monthly cost by service, usage assumptions (claims per month, tokens per claim), and Bedrock token math.
- Express production savings from the value model in `product.md`.

## Working agreements

- Follow these steering files over ad hoc ideas. If a change conflicts with them, ask first.
- Don't add features beyond the scope in `product.md`.
- Any change to the approval logic needs a test showing the model cannot cause approval above the limit or with a fraud signal.
- Any change to tool authorization needs a test showing a missing, expired, wrongly signed or other-claim job ticket is rejected, and that a user token is rejected at the MCP gateway.
- Prefer small, reviewable changes. State assumptions when proceeding.
