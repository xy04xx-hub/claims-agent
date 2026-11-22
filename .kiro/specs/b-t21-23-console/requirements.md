# Requirements: minimal console (T-21, T-22, T-23)

Source of truth for scope: `docs/plan/tickets/T-21-console-skeleton.md`, `T-22-customer-ui.md`, `T-23-adjuster-ui.md`. Minimal slice built in one timebox; items not listed here are not done (see `docs/STATUS.md`).

1. WHEN a user opens the console without a session THE SYSTEM SHALL show a sign-in button that starts the Cognito hosted UI authorization code flow with PKCE.
2. WHEN the hosted UI redirects back with a code THE SYSTEM SHALL exchange it for tokens, keep them in memory only, and send the access token as `Authorization: Bearer` on every API call.
3. WHEN the access token carries group `Adjuster` THE SYSTEM SHALL show the review queue. WHEN it carries `Customer` THE SYSTEM SHALL show the customer screen.
4. THE SYSTEM SHALL read the API URL, app client ID and Cognito domain from `frontend/.env.<stage>` (written by `npm run outputs`) at build time, with nothing hardcoded.
5. WHEN a customer opens the screen THE SYSTEM SHALL list their policies and items (`GET /me/policies`).
6. WHEN a customer submits a claim THE SYSTEM SHALL upload one evidence file with the presigned POST (including `x-amz-meta-kind`), call `POST /claims` with a generated `clientRequestId`, then poll `GET /claims/{id}` every 500 ms for 10 s and every 2 s after, and show status, decision and the customer message.
7. WHEN an adjuster opens the queue THE SYSTEM SHALL list routed claims with adjuster reasons and an evidence link (presigned GET), and offer Approve and Reject that call `POST /claims/{id}/resolution`. A 409 SHALL be shown as "already resolved".
8. THE SYSTEM SHALL be deployed through the Web stack (CloudFront, private S3).
