# API test fixtures

`jwt-claims.fixture.json` is a hand-written fixture in the documented form
(`"cognito:groups": "[Customer]"`). Verified against dev-b: real Cognito access
tokens for a Customer and an Adjuster user passed the group gate (501, not 403),
so the real claims serialization is parsed correctly. The claims block itself was
not logged or recorded, because the middleware logs no claims by design. The
`sub` and `tenantId` values are fake.
