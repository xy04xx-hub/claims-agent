# Requirements Document

## Introduction

This spec delivers the M1 claim flow end to end with a real, minimal Bedrock agent: a customer uploads evidence, submits a claim, the claim is queued, a Worker runs a bounded Claude Haiku 4.5 tool-use loop over read-only DynamoDB tools and calls the existing Decision Lambda, and the customer reads the final status. An adjuster can list the routed queue and resolve a claim. It combines T-09 (B's ticket: upload, submit, queue, status routes, `GET /me/policies`), T-15 (A's ticket: Worker), the agent part of T-19 in a reduced in-process form, and the two T-10 routes `GET /queue` and `POST /claims/{claimId}/resolution`.

Scope decisions agreed with the owner:

- Work is done by owner A on one PR. Files owned by B (the API stack, `backend/api`, queue infrastructure, `infra/bin/app.ts` stack wiring) are edited in place, and the PR description flags each cross-owner edit for B's review. The branch is the checked-out branch `a/T-09-15-19-claim-flow`, which already works; the requested name `a/T-09-claim-flow` is used only if the checked-out branch cannot be used.
- T-08 is built and merged into this branch. This spec reuses its HTTP API, Cognito JWT default authorizer, throttle, CORS, access logs, route table (`backend/api/routes.ts` and `API_ROUTES`) and middleware pipeline (access-token check, `sub`, `tenantId` and group checks, group gate, path and body validation against the contract schemas, 16 KiB body limit, error shape, Powertools logs and metrics). T-09 registers its handlers through `deps.handlers`, keyed by route key. T-08 gave the API roles no data-service permissions and gave `ApiStack` only an `auth` prop and no queue, so T-09 adds the `foundation` prop, environment variables, per-function IAM statements, the Job_Queue, the Dead_Letter_Queue and its alarm.
- Routes in scope: `POST /evidence/uploads`, `GET /me/policies`, `POST /claims`, `GET /claims`, `GET /claims/{claimId}`, `GET /queue`, `POST /claims/{claimId}/resolution`. `GET /impact` and `GET /claims/{claimId}/evidence/{evidenceId}` are out of scope.
- The agent is a Bedrock Converse tool-use loop inside the Worker. Its three tools are in-process functions that read DynamoDB only. The model input is text plus evidence content: claim fields, EvidenceIndex hashes and processing data, and the evidence files themselves (images as image blocks, PDFs as document blocks) that the Worker reads from S3 when they are within the size limit. The model reads identifiers, names and dates from that content and returns them in `Proposal.extracted` as a signal only.
- Out of scope (T-19 only): AgentCore Runtime, AgentCore Gateway, the Interceptor, the KMS job ticket and Guardrails.
- The end-to-end check is a script run against the deployed `dev-a` stage using a Cognito access token, submitting scenarios A and H. `dev-a` sets `enableVerificationClient` to false today, so the change sets it to true (the `demo` guard stays).
- Tests are a few unit tests plus the CDK assertion tests listed. No property-based tests and no README tests.

## Glossary

- **Claim_API**: The `api-customer` Lambda function (T-08) that serves the customer routes and `GET /claims/{claimId}` for both the Customer and Adjuster groups behind the HTTP_API. T-09 registers its handlers. The shared route is served by this one function, which branches on the verified group.
- **Adjuster_API**: The `api-adjuster` Lambda function with its own IAM role. It serves `GET /queue` and `POST /claims/{claimId}/resolution` for the Adjuster group.
- **HTTP_API**: The T-08 API Gateway HTTP API with the Cognito JWT authorizer as default authorizer.
- **Authorizer**: The T-08 JWT authorizer. It validates issuer, audience and signature but cannot tell an access token from an ID token.
- **Request_Router**: The T-08 middleware pipeline in `backend/api/middleware` (`handleRequest`) that wraps every Claim_API and Adjuster_API handler. It checks `token_use`, `sub`, `tenantId` and group, gates the route by group, validates path and body, and maps errors. A handler receives `ctx.caller`, `requestId`, `pathParameters` and `body`.
- **Foundation_Resources**: The typed handles of the Foundation stack (tables, evidence bucket, data key) passed to `ApiStack` as the `foundation` prop.
- **Job_Queue**: The SQS standard queue that carries job messages (`contracts/job-message.schema.json`).
- **Dead_Letter_Queue**: The SQS queue that receives jobs after the third failed receive.
- **Worker**: The Lambda function that processes one claim per invocation and holds no decision-write permission.
- **Agent_Loop**: The bounded Bedrock Converse tool-use loop that runs inside the Worker.
- **Agent_Tools**: The in-process Worker functions `lookup_policy`, `check_fraud_signals` and `verify_evidence`, which read DynamoDB only, and `submit_proposal`, which writes nothing and returns the model's Proposal to the Agent_Loop.
- **Worker_Context**: The `claimId` and `tenantId` held by the Worker for the current job. Agent_Tools take these values from the Worker_Context.
- **Agent_Input**: The content sent to the model: text with the claim fields and, per evidence item, the kind, hashes and processing status read from EvidenceIndex, plus the image or document block of each evidence item that is within the Evidence_Size_Limit. An item that is not sent is listed as "not shown to the model: too large" (or "not shown to the model: type not allowed").
- **Evidence_Size_Limit**: The stage config value `maxEvidenceImageBytes` (3670016 bytes, 3.5 MiB), passed to the Worker as an environment variable.
- **Untrusted_Text**: The customer's claim description and any other claimant-supplied free text.
- **Model_Id**: The Bedrock inference profile ID in the stage config key `bedrockModelId` (`infra/config/<stage>.json`), passed to the Worker as an environment variable.
- **Decision_Lambda**: The existing Lambda from T-14. It exposes `approveWithinLimit`, a route mode and a `routeOnly` handler, and is the only writer of decision status.
- **Route_Mode**: The Decision_Lambda mode that sets `ROUTED_TO_ADJUSTER` with a given reason and never approves.
- **EvidenceIndex**: The DynamoDB table of evidence rows (`contracts/data-model.md`).
- **Claims_Table**: The DynamoDB table of claims (`contracts/data-model.md`).
- **Pack_Table**: The `ClaimTypePacks` DynamoDB table.
- **Audit_Table**: The append-only `AuditLog` DynamoDB table.
- **Proposal**: A JSON object that conforms to `contracts/proposal.schema.json`.
- **Queue_Shard_Function**: The function `queueShard` and constant `QUEUE_SHARDS` in `backend/processing/decision/keys.ts`, which define the adjuster queue partition keys `tenantId#status#shard`.
- **Claim_Status**: One of `PROCESSING`, `AUTO_APPROVED`, `ROUTED_TO_ADJUSTER`, `APPROVED_BY_ADJUSTER`, `REJECTED_BY_ADJUSTER`.
- **Final_Status**: Any Claim_Status other than `PROCESSING`.
- **Verified_Claims**: The `sub`, `cognito:groups` and `custom:tenantId` values from `event.requestContext.authorizer.jwt.claims`.
- **E2E_Script**: The script `scripts/e2e-claim-flow.ts` that submits scenarios through the deployed `dev-a` API.
- **Stage_Latency_Metric**: The CloudWatch custom metric `StageLatencyMs` in namespace `ClaimsAgent`, with a `Stage` dimension.
- **Scenario_A**: Seed scenario A, a phone accidental-damage claim expected to be `AUTO_APPROVED`.
- **Scenario_H**: Seed scenario H, a phone theft claim whose IMEI was already claimed, expected to be `ROUTED_TO_ADJUSTER` with a reason that names `CLM-1042`.

## Requirements

### Requirement 1: Authenticated API (provided by T-08)

**User Story:** As a customer, I want every API route to keep requiring a valid sign-in, so that only authenticated users reach claim data.

#### Acceptance Criteria

1. THE T-09 handlers SHALL leave the T-08 authorizer, throttle, CORS, access logs, route table and Request_Router pipeline unchanged in behaviour.
2. THE Claim_API and THE Adjuster_API handlers SHALL read the customer ID, role and tenant ID only from `ctx.caller`.
3. IF a request body or query string contains a tenant ID, customer ID or role, THEN THE Claim_API SHALL ignore those values.
4. THE Claim_API and THE Adjuster_API SHALL each run under a separate IAM role whose statements name only the tables, bucket prefix, queue and data key that the function uses.
5. THE Claim_API and THE Adjuster_API SHALL write structured JSON logs that include `requestId`, and `claimId` when one exists.

### Requirement 2: Evidence upload

**User Story:** As a customer, I want to upload photos and documents straight to storage with strict limits, so that evidence is accepted safely.

#### Acceptance Criteria

1. WHEN a customer calls `POST /evidence/uploads` with a valid body, THE Claim_API SHALL return one `evidenceId` and one presigned POST per file.
2. THE Claim_API SHALL set on each presigned POST a content type allow-list of `image/jpeg`, `image/png` and `application/pdf`, a content-length range of 1 byte to 5 MB, the exact object key `tenantId/customerId/evidenceId`, and an expiry of 5 minutes.
3. WHEN the Claim_API issues a presigned POST, THE Claim_API SHALL write an EvidenceIndex row for that evidence with `processingStatus` `PENDING` and upload status `UPLOADING`.
4. IF a request body fails the schema in `contracts/api/evidence-upload.request.schema.json`, THEN THE Claim_API SHALL return status 400 with field errors.
5. WHEN a browser uploads a file larger than 5 MB or with a content type outside the allow-list, THE evidence bucket SHALL reject the upload.

### Requirement 3: Own policies

**User Story:** As a customer, I want to see my active policies and the evidence each cause requires, so that I can fill in a correct claim.

#### Acceptance Criteria

1. WHEN a customer calls `GET /me/policies`, THE Claim_API SHALL return the caller's policies that are active on the current date, with insured items and covered causes.
2. WHEN a customer calls `GET /me/policies`, THE Claim_API SHALL return, for each covered cause, the required evidence read from the latest version of the matching pack in the Pack_Table.
3. THE Claim_API SHALL return a `GET /me/policies` response that conforms to `contracts/api/me-policies.response.schema.json`.
4. THE Claim_API SHALL query only policies whose customer ID equals the verified customer ID within the verified tenant.
5. WHEN the caller has no active policy, THE Claim_API SHALL return an empty list with status 200.

### Requirement 4: Claim submit

**User Story:** As a customer, I want to submit a claim once and have it queued reliably, so that a repeated click does not create a duplicate.

#### Acceptance Criteria

1. WHEN a customer calls `POST /claims` with a valid body, THE Claim_API SHALL write a claim with Claim_Status `PROCESSING`, send one job message to the Job_Queue and return status 202 with `claimId` and Claim_Status `PROCESSING`.
2. THE Claim_API SHALL validate the request body against `contracts/api/claim-create.request.schema.json`, and return status 400 with field errors on failure.
3. IF the policy or item does not belong to the verified customer and tenant, THEN THE Claim_API SHALL return status 403.
4. IF any `evidenceId` does not belong to the verified customer and tenant, THEN THE Claim_API SHALL return status 403.
5. WHEN a second request arrives with the same `clientRequestId` from the same customer, THE Claim_API SHALL return the original `claimId` and, if the first request already sent the job message, send no further job message.
6. THE Claim_API SHALL perform the idempotency write on `clientRequestId` as a conditional write.
7. THE Claim_API SHALL write on the claim the fields `policyVersion`, `slaDueAt`, `createdAt`, the queue index attributes that the Decision_Lambda expects, and the `byRequest` idempotency key.
8. THE Claim_API SHALL build the job message from `tenantId`, `claimId`, `attempt` 1 and `requestId` only, with no personal data and no token.
9. IF sending the job message fails, THEN THE Claim_API SHALL return status 500 with a generic error code and leave the claim retrievable by a repeat request with the same `clientRequestId`.
10. THE Claim_API SHALL resolve the policy version in force on the loss date from the Policies table.

### Requirement 5: Claim status

**User Story:** As a customer or adjuster, I want to read a claim's status and my own claim list, so that I can see the outcome.

#### Acceptance Criteria

1. WHEN a customer calls `GET /claims/{claimId}` for a claim of the verified customer, THE Claim_API SHALL return the claim status, decision, checks and reasons without internal signals.
2. IF a customer calls `GET /claims/{claimId}` for another customer's claim or an unknown claim, THEN THE Claim_API SHALL return status 404.
3. WHEN an adjuster calls `GET /claims/{claimId}` for a claim in the verified tenant, THE Claim_API SHALL return the claim including internal signals (`adjusterReasons`, `riskSignals`, `informationalFlags`).
4. IF an adjuster calls `GET /claims/{claimId}` for a claim in another tenant or an unknown claim, THEN THE Claim_API SHALL return status 404.
5. WHEN a customer calls `GET /claims`, THE Claim_API SHALL return only the verified customer's claims, newest first, with cursor paging.
6. THE Claim_API SHALL return responses that conform to `contracts/api/claim-get.response.schema.json` and `contracts/api/claims-list.response.schema.json`.

### Requirement 6: Queue and dead-letter queue

**User Story:** As an operator, I want a reliable queue with a dead-letter queue, so that no claim is lost and failures end with a human.

#### Acceptance Criteria

1. THE Job_Queue SHALL use server-side encryption with the Foundation data key.
2. THE Job_Queue SHALL set the visibility timeout to 360 seconds.
3. THE Job_Queue SHALL set `maxReceiveCount` to 3 with the Dead_Letter_Queue as the target.
4. THE Dead_Letter_Queue SHALL retain messages for 14 days and use server-side encryption with the Foundation data key.
5. THE Job_Queue and THE Dead_Letter_Queue SHALL enforce TLS-only access.
6. THE Dead_Letter_Queue SHALL have a CloudWatch alarm that fires when its depth is above 0.
7. THE ApiStack SHALL create the Job_Queue, the Dead_Letter_Queue and the alarm, and expose both queues in `ApiResources` to the ProcessingStack through typed stack props.
8. THE Claim_API role SHALL hold send permission on the Job_Queue only.
9. THE ApiStack SHALL accept a typed `foundation` prop with the Foundation_Resources, set the table, bucket and queue names as environment variables on the API functions, and give each function explicit IAM statements for the resources it uses.
10. THE test in `infra/test/api-stack.test.ts` that bans dynamodb, s3, sqs and kms actions on the API roles SHALL be replaced by assertions of the new least-privilege grants.

### Requirement 7: Worker

**User Story:** As an operator, I want a Worker that processes one claim per invocation, so that claims reach a final status with bounded load.

#### Acceptance Criteria

1. THE Worker SHALL use the Job_Queue as event source with batch size 1, partial batch responses enabled and maximum concurrency 5.
2. THE Worker SHALL have a timeout of 60 seconds.
3. WHEN the Worker receives a job message, THE Worker SHALL validate it against `contracts/job-message.schema.json`, load the claim from the Claims_Table and set the Worker_Context from the job message.
4. WHEN a claim has evidence rows whose `processingStatus` is not `READY`, THE Worker SHALL poll EvidenceIndex for up to 5 seconds.
5. IF an evidence row is still not `READY` after 5 seconds, THEN THE Worker SHALL invoke the Decision_Lambda in Route_Mode with the reason "evidence not ready".
6. THE Worker SHALL build the Agent_Input from claim fields and, for each evidence item, its kind, hashes, `exifDate` and any `IDENTIFIER` row from EvidenceIndex (or "none"), and the evidence content block defined in criterion 7.
7. WHEN an evidence row has a content type of `image/jpeg` or `image/png` and `sizeBytes` not above the Evidence_Size_Limit, THE Worker SHALL read the object from the evidence bucket and send it as a Converse image block. WHEN an evidence row has content type `application/pdf` and `sizeBytes` not above the Evidence_Size_Limit, THE Worker SHALL send it as a Converse document block. T-13 produces no normalized copy, so the Worker reads the original object.
8. IF an evidence item is above the Evidence_Size_Limit or has a content type outside the allow-list, THEN THE Worker SHALL not read or send it and SHALL list it in the Agent_Input as "not shown to the model: too large" (or "not shown to the model: type not allowed"), so that the claim routes through the decision rules.
9. THE Worker SHALL keep evidence bytes out of logs, the Job_Queue and error messages.
10. WHEN the Agent_Loop returns a Proposal that validates against `contracts/proposal.schema.json`, THE Worker SHALL invoke the Decision_Lambda with the claim and the Proposal.
11. THE Worker role SHALL hold read permission on the Claims_Table, EvidenceIndex, Policies table and Pack_Table, and no permission on the Audit_Table (no Agent_Tool reads it), receive permission on the Job_Queue, and invoke permission on the Decision_Lambda, and SHALL hold no write permission on any Claims_Table decision attribute.
12. THE Worker role SHALL hold `s3:GetObject` on the evidence bucket resource `bucket/*/*/*` only, decrypt permission on the Foundation data key, and no S3 write permission.
13. WHEN the claim status is already a Final_Status, THE Worker SHALL skip processing and report success for the message.

### Requirement 8: Bedrock agent loop

**User Story:** As an operator, I want a real, bounded Bedrock agent that only proposes, so that claims are assessed by a model while code keeps the decision.

#### Acceptance Criteria

1. THE Worker SHALL call Amazon Bedrock Converse with the model identified by the Model_Id.
2. THE Worker SHALL read the Model_Id from an environment variable that the CDK stack sets from the `bedrockModelId` key of the stage config, with value `global.anthropic.claude-haiku-4-5-20251001-v1:0` in `dev-a`.
3. THE Worker SHALL set `maxTokens` on every Converse call, with the value taken from stage config.
4. THE Worker SHALL expose to the model the Agent_Tools `lookup_policy`, `check_fraud_signals`, `verify_evidence` and `submit_proposal`, each implemented in-process, the first three reading DynamoDB only.
5. WHEN the model calls an Agent_Tool, THE Worker SHALL take `claimId` and `tenantId` from the Worker_Context and ignore any `claimId`, `tenantId` or `customerId` in the model's tool arguments.
6. THE Agent_Loop SHALL stop after at most 4 model turns.
7. IF the Agent_Loop reaches the turn limit without a final Proposal, THEN THE Worker SHALL invoke the Decision_Lambda in Route_Mode with the reason "automatic check unavailable".
8. THE Worker SHALL send the model the Agent_Input, with the Untrusted_Text enclosed in delimiters that mark it as untrusted data.
9. THE Worker SHALL instruct the model in the system prompt to treat delimited text as data and to ignore any instruction inside it.
10. THE Worker SHALL require the model to return its Proposal by calling `submit_proposal`, with the identifier, name and dates it read from the evidence in `Proposal.extracted` as a signal only, and SHALL validate it against `contracts/proposal.schema.json` before use.
11. IF the Proposal fails schema validation, THEN THE Worker SHALL invoke the Decision_Lambda in Route_Mode with the reason "automatic check unavailable".
12. THE Worker SHALL expose no tool that writes data (`submit_proposal` only returns the Proposal to the Agent_Loop) and no tool that sets a decision, so that the model cannot approve a claim.
13. IF a Bedrock call fails or times out, THEN THE Worker SHALL retry it up to 3 tries in total with exponential backoff, jitter and a delay cap of 4 seconds.
14. IF all 3 tries of a Bedrock call fail, THEN THE Worker SHALL invoke the Decision_Lambda in Route_Mode with the reason "automatic check unavailable" and report success for the message.
15. WHERE the stage config sets a failure-injection flag, THE Worker SHALL fail every Bedrock call.
16. THE Worker role SHALL allow only the action `bedrock:InvokeModel` (the Converse API is authorized by it, and `bedrock:Converse` is not an IAM action) and only on the inference profile ARN and the foundation model ARNs of the Model_Id, the foundation model statement carrying a `bedrock:InferenceProfileArn` condition for that profile, and SHALL hold read-only DynamoDB permission on the tables that the Agent_Tools read.

### Requirement 9: Fail-safe routing

**User Story:** As an operator, I want failed jobs to end with a human, so that failures never approve a claim.

#### Acceptance Criteria

1. IF the Worker fails on a Bedrock error, timeout, schema failure or loop overrun, THEN THE Worker SHALL route the claim to an adjuster through the Decision_Lambda in Route_Mode instead of throwing for retry.
2. WHEN a job message has been received 3 times without success because the Worker crashed, THE Job_Queue SHALL move it to the Dead_Letter_Queue.
3. THE ProcessingStack SHALL wire the Dead_Letter_Queue as an event source of the Decision_Lambda `routeOnly` handler.
4. WHEN the `routeOnly` handler receives a dead-lettered job, THE Decision_Lambda SHALL set the claim to `ROUTED_TO_ADJUSTER` with the fail-safe reason "automatic check unavailable".
5. WHEN the failure-injection flag is set and a claim is submitted, THE Worker SHALL end with that claim in `ROUTED_TO_ADJUSTER` without a Dead_Letter_Queue delivery.

### Requirement 10: Adjuster queue and resolution

**User Story:** As an adjuster, I want to list the routed claims of my tenant and resolve one, so that a human decides everything the agent routed.

#### Acceptance Criteria

1. WHEN an adjuster calls `GET /queue`, THE Adjuster_API SHALL read all `QUEUE_SHARDS` partitions `tenantId#ROUTED_TO_ADJUSTER#shard` in parallel, using the Queue_Shard_Function key format.
2. THE Adjuster_API SHALL merge the shard results oldest first and return at most 25 items with a `nextCursor` for the next page.
3. THE Adjuster_API SHALL return a `GET /queue` response that conforms to `contracts/api/claims-list.response.schema.json` and contains only claims of the verified tenant.
4. WHEN an adjuster calls `POST /claims/{claimId}/resolution` with a body that conforms to `contracts/api/resolution.request.schema.json`, THE Adjuster_API SHALL set the claim status to `APPROVED_BY_ADJUSTER` for `APPROVE` or `REJECTED_BY_ADJUSTER` for `REJECT` with a conditional write that requires the status `ROUTED_TO_ADJUSTER`, and return the claim ID and new status.
5. IF the claim status is not `ROUTED_TO_ADJUSTER` when the resolution is written, THEN THE Adjuster_API SHALL return status 409 and leave the claim unchanged.
6. IF the claim does not exist in the verified tenant, THEN THE Adjuster_API SHALL return status 404.
7. IF the resolution body fails the schema, THEN THE Adjuster_API SHALL return status 400 with field errors.
8. WHEN a resolution is written, THE Adjuster_API SHALL write an Audit_Table record with the adjuster's verified `sub` as actor, the decision, the `reasonCode` and the previous and new status.
9. THE Adjuster_API role SHALL hold write permission on the Claims_Table status attributes and the Audit_Table, and SHALL hold no permission on the Job_Queue.

### Requirement 11: Latency metrics and logs

**User Story:** As an operator, I want per-stage latency metrics and logs, so that the 4 s target can be measured.

#### Acceptance Criteria

1. THE Worker SHALL publish the Stage_Latency_Metric in milliseconds with a `Stage` dimension for each of the steps `LoadClaim`, `WaitEvidence`, `BuildInput`, `Agent`, `ValidateProposal` and `Decision`.
2. THE Worker SHALL write structured JSON logs with `claimId` and `requestId` for each step.
3. THE Worker logs SHALL exclude evidence bytes, full descriptions and personal data.
4. WHEN a claim reaches a Final_Status within the Worker invocation, THE Worker SHALL publish a total latency value from job receipt to Decision_Lambda return.

### Requirement 12: Deploy and end-to-end check

**User Story:** As the owner of the change, I want it deployed to dev-a and checked from outside, so that I can show real results.

#### Acceptance Criteria

1. WHEN the owner runs `cdk deploy` for all stacks of stage `dev-a`, THE stacks SHALL deploy without manual console changes.
2. WHEN the owner runs the seed users script and then the seed script for `dev-a` with `SEED_CUSTOMER_ID` set to the `sub` of the demo customer, THE seed scripts SHALL create the demo customer and adjuster users and the seed policies, packs, `CLM-1042` and scenario evidence for that customer ID. WHERE `SEED_CUSTOMER_ID` is not set, THE seed script SHALL use `cust-demo`.
3. WHEN the owner runs the E2E_Script for `dev-a`, THE E2E_Script SHALL obtain a Cognito access token for the demo customer, call `GET /me/policies`, create the scenario's evidence through `POST /evidence/uploads`, upload the seed evidence file with the presigned POST, submit the claim with `POST /claims` and poll `GET /claims/{claimId}`. The E2E_Script SHALL not write an EvidenceIndex `IDENTIFIER` row by default, because the model reads the identifier from the evidence (Requirement 7.7).
   - IF `GET /me/policies` returns no policy, THEN THE E2E_Script SHALL exit with a non-zero code and a message that names `SEED_CUSTOMER_ID`.
   - WHERE the `--identifier-fallback` flag is given, THE E2E_Script SHALL write an EvidenceIndex `IDENTIFIER` row for the evidence with the insured item's identifier using the developer's own AWS credentials, and SHALL print a line saying the row is a stand-in for image reading, for use only if image reading fails in `dev-a`.
4. WHEN the E2E_Script submits Scenario_A, THE E2E_Script SHALL report PASS if Claim_Status becomes `AUTO_APPROVED` with the expected payout within 10 seconds.
5. WHEN the E2E_Script submits Scenario_H, THE E2E_Script SHALL report PASS if Claim_Status becomes `ROUTED_TO_ADJUSTER` and the adjuster reasons on the stored claim (`decision.reasons.adjuster`, read with the developer's AWS credentials because the customer view hides them) name `CLM-1042`.
6. THE E2E_Script SHALL print the per-scenario elapsed time and the final status, and exit with a non-zero code if any scenario fails.
7. THE E2E_Script SHALL keep the access token out of its output and logs.
8. WHEN the same `clientRequestId` is submitted twice by the E2E_Script, THE E2E_Script SHALL report whether both responses carried the same `claimId`.
9. IF the stage argument is missing or the stack outputs are missing, THEN THE E2E_Script SHALL exit with a non-zero code and a message that names the missing item.

### Requirement 13: Tests and PR

**User Story:** As a reviewer, I want minimal tests and a PR that flags cross-owner edits, so that the change is reviewable.

#### Acceptance Criteria

1. THE change SHALL include unit tests for customer ownership checks of policy, item and evidence on `POST /claims`.
2. THE change SHALL include a unit test that a repeated `clientRequestId` returns the same claim and sends one job message.
3. THE change SHALL include a unit test that a customer token on `GET /claims/{claimId}` for another customer's claim returns 404, and a unit test that a token with `token_use` `id` returns 401.
4. THE change SHALL include a unit test that a second resolution of the same claim returns 409.
5. THE change SHALL include a unit test that the Worker invokes the Decision_Lambda in Route_Mode when Bedrock fails after 3 tries.
6. THE change SHALL include a unit test that a model response that fails `contracts/proposal.schema.json` leads to Route_Mode.
7. THE change SHALL include CDK assertion tests for the queue settings (visibility timeout 360 seconds, `maxReceiveCount` 3, DLQ retention 14 days), the Worker settings (timeout 60 seconds, batch size 1, maximum concurrency 5, partial batch responses), the JWT authorizer on every route and the Worker's Bedrock permission scoped to one inference profile.
8. THE change SHALL pass `npm run lint`, `npm run typecheck`, `npm test` and `npx cdk synth -c stage=ci` before the PR opens.
9. THE PR description SHALL list every file owned by B that the change edits, mark `GET /me/policies`, `GET /queue` and the resolution route as included from T-09 and T-10, and include the dev-a verification output.
10. THE change SHALL update the READMEs of `backend/api`, `backend/processing` and `scripts` and the status of tickets T-09, T-10 and T-15.
11. THE change SHALL set `enableVerificationClient` to true in `infra/config/dev-a.json` so that the E2E_Script can sign in, and SHALL keep the guard that disables the verification client in the `demo` stage.
12. THE change SHALL update the "Implemented by" status in the READMEs of `backend/api` and `backend/processing`.
13. THE change SHALL include one unit test that the Worker puts an image block in the Converse request for an evidence file under the Evidence_Size_Limit and omits it for a file over the limit.
