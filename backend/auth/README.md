# backend/auth
Owner: B (muzair110)
Cognito pre token generation trigger (event version V2_0).

Layout:
- `pre-token-generation/claim-mapping.ts`: pure function `addTenantClaim` that copies `custom:tenantId` from `request.userAttributes` into the access token claim `tenantId`. It never reads `request.clientMetadata`.
- `pre-token-generation/index.ts`: the Lambda handler. It calls the mapper, writes one JSON log line and rethrows on failure so Cognito issues no token.
