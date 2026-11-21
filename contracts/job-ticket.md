# Job ticket

A compact JWS signed by the Worker with the KMS asymmetric key (`ECC_NIST_P256`). The Interceptor verifies it locally with the cached public key. The model never sees it.

| Item | Value |
|---|---|
| Algorithm | `ES256` |
| Header | `{"alg":"ES256","typ":"JWT","kid":"<KMS key id>"}` |
| Transport | HTTP header `X-Claim-Ticket` on every MCP call, attached by the runtime code |
| Lifetime | `exp` = `iat` + 60 s. New ticket per attempt |

Claims:

| Claim | Type | Meaning |
|---|---|---|
| `claimId` | string | The one claim the tools may read |
| `tenantId` | string | Tenant scope |
| `attempt` | integer 1 to 3 | SQS attempt number |
| `jti` | string (UUID) | Unique ID, replay check, recorded in the audit log |
| `iat` | integer | Issued at, epoch seconds |
| `exp` | integer | Expiry, epoch seconds |

Example payload:

```json
{ "claimId": "CLM-2001", "tenantId": "t1", "attempt": 1, "jti": "9d1c2f0e-6a1b-4c1d-8e2a-0f7b5a3c1d44", "iat": 1795255200, "exp": 1795255260 }
```

The Interceptor rejects a missing, malformed, wrongly signed, expired or replayed ticket, and any claim whose status is not `PROCESSING`. It then overwrites `claimId` and `tenantId` in the tool arguments with the ticket values.
