# Requirements: T-02 Contracts

Source: `docs/plan/tickets/T-02-contracts.md`. Scope is the ticket's scope.

## User story
As a developer on either side of the A/B boundary, I want agreed schemas and examples, so that API, queue, worker, decision and tools can be built in parallel against stubs.

## Acceptance criteria (EARS)

1. WHEN a route, message, tool or record is listed in `architecture.md`, THE SYSTEM SHALL provide a JSON Schema (draft 2020-12) and one example for it under `contracts/`.
2. WHEN a request body is defined, THE SYSTEM SHALL enforce the security-rule limits in its schema: description at most 1,000 characters, at most 6 evidence IDs, file size at most 5 MB, content types JPEG, PNG and PDF only.
3. WHEN a tool input schema is defined, THE SYSTEM SHALL NOT contain a claim ID or customer ID property.
4. WHEN the SQS job message is defined, THE SYSTEM SHALL allow only `tenantId`, `claimId`, `attempt` and `requestId`.
5. WHEN a decision is defined, THE SYSTEM SHALL allow only the outcomes `AUTO_APPROVED` and `ROUTED_TO_ADJUSTER`.
6. WHEN the audit record is defined, THE SYSTEM SHALL exclude photo bytes and full personal data.
7. WHEN the job ticket is documented, THE SYSTEM SHALL state ES256, the claims `claimId`, `tenantId`, `attempt`, `jti`, `iat`, `exp`, and the MCP header name.
8. WHEN every DynamoDB table is documented in `data-model.md`, THE SYSTEM SHALL list keys prefixed with `tenantId`, GSIs, attributes and access patterns, including the `tenantId#status#shard` queue index.
9. WHEN the contracts change, THE SYSTEM SHALL carry a version in `contracts/VERSION`, and the change SHALL need a PR approved by both owners.
10. WHEN the contract tests run, THE SYSTEM SHALL validate every example against its schema.
11. WHEN a model is named in an example, THE SYSTEM SHALL use Claude Haiku 4.5 and treat the `model` field as a plain string.
