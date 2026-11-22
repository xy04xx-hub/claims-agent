# infra

Owner: B (muzair110)

CDK app (TypeScript) for the Instant Claims Agent. Deploy one stage at a time with `npm run deploy -- <stage>` and remove it with `npm run destroy -- <stage>` (stages: `dev-a`, `dev-b`, `demo`, `ci`). Stage settings live in `infra/config/<stage>.json`.

## Foundation stack

`ClaimsAgent-<stage>-Foundation` holds the shared data layer: one customer-managed KMS key (rotation on), five DynamoDB tables (`Policies`, `Claims`, `EvidenceIndex`, `ClaimTypePacks`, `AuditLog`; on-demand, KMS-encrypted, point-in-time recovery), one private S3 evidence bucket and five SSM parameters. Table keys and indexes follow `contracts/data-model.md`. Attribute names are `pk`, `sk`, `gsi1pk`, `gsi1sk`, `gsi2pk`, `gsi2sk`, `gsi3pk` (see `lib/constructs/platform/data-model.ts`).

The evidence bucket has Block Public Access, SSL-only access, SSE-KMS with the data key, no versioning, and EventBridge delivery turned on through the bucket's notification configuration. It has no notification targets. Later stacks add an EventBridge rule themselves.

### Config keys

Set these in the stage file. All four files ship the same defaults.

| Key | Default | Effect |
|---|---|---|
| `evidenceRetentionDays` | 90 | Evidence objects expire after this many days (1 to 3650). Incomplete multipart uploads are always aborted after 1 day. |
| `consoleOrigins` | `["http://localhost:5173"]` | Browser origins allowed by the bucket CORS rule (`POST` only, 1 to 5 entries). Each is `https://<host>` or `http://localhost[:port]`, with no path or wildcard. |
| `earlyClaimDays` | 14 | SSM `/claims/<stage>/earlyClaimDays`. Claims within this many days of policy start raise the early-claim signal. |
| `frequencyWindowDays` | 30 | SSM `/claims/<stage>/frequencyWindowDays`. Window for the claim-frequency signal. |
| `frequencyMaxClaims` | 3 | SSM `/claims/<stage>/frequencyMaxClaims`. Claims allowed in the window. |
| `outlierMultiple` | 2 | SSM `/claims/<stage>/outlierMultiple`. Amount outlier threshold as a multiple of the item's typical value. |

### Adding the CloudFront origin

The CloudFront domain exists only after the Web stack (T-07) is deployed, so Foundation reads origins from config. After the Web deploy:

1. Copy the origin (`https://<id>.cloudfront.net`, no trailing slash) into `consoleOrigins` in `infra/config/<stage>.json`.
2. Redeploy Foundation: `npm run deploy -- <stage>`.

Until then, browser uploads from the deployed console fail with a CORS error.

### Outputs

| Output | Value |
|---|---|
| `EvidenceBucketName` | Evidence bucket name |
| `ClaimsTableName` | `Claims` table name |
| `DataKeyArn` | Data key ARN |

Outputs have no export names. Other stacks receive the resources through stack props.

### Verify a deployment

```bash
STACK=ClaimsAgent-dev-b-Foundation
aws cloudformation describe-stacks --stack-name $STACK --query "Stacks[0].Outputs"

aws s3api get-public-access-block --bucket <EvidenceBucketName>          # four settings true
aws s3api get-bucket-policy --bucket <EvidenceBucketName>                # Deny when aws:SecureTransport is false
curl -i http://<EvidenceBucketName>.s3.amazonaws.com/x                   # 4xx, no object data
aws dynamodb describe-continuous-backups --table-name <ClaimsTableName>  # PointInTimeRecoveryStatus ENABLED
aws dynamodb describe-table --table-name <table>                         # SSEDescription: ENABLED, KMS, data key ARN
aws ssm get-parameter --name /claims/dev-b/autoApproveEnabled            # Value true
```

Run `describe-table` for each of the five tables (names from `aws cloudformation list-stack-resources --stack-name $STACK`).

### Kill switch

`/claims/<stage>/autoApproveEnabled` is `true` after deploy. To stop all auto-approvals without a deploy:

```bash
aws ssm put-parameter --name /claims/<stage>/autoApproveEnabled --value false --type String --overwrite
```

Readers cache the value for up to 60 s. A Foundation deploy writes the value from code and resets it to `true`, so do not redeploy Foundation during an incident.

### Destroy behaviour

- Stages with removal policy `DESTROY` (`dev-a`, `dev-b`, `ci`): `npm run destroy -- <stage>` deletes everything. The evidence bucket uses auto-delete, so it is emptied first, even when it holds evidence. The KMS key is scheduled for deletion with a 7-day window.
- `demo` (removal policy `RETAIN`): table deletion protection is on, so the stack cannot be destroyed until you turn it off on each table (`aws dynamodb update-table --table-name <table> --no-deletion-protection-enabled`). After a destroy, the retained tables, bucket, key and SSM parameters stay in the account. Redeploying the same stage then fails with "already exists" until you delete the leftovers.

## Web stack

`ClaimsAgent-<stage>-Web` serves the React console over HTTPS. It holds one private S3 console bucket (Block Public Access, SSL-only, SSE-S3, no website hosting), one CloudFront distribution that reads the bucket through Origin Access Control, one response headers policy and one `BucketDeployment` that uploads the console files and invalidates `/*`. The stack depends on no other stack.

The distribution redirects HTTP to HTTPS, allows `GET`, `HEAD` and `OPTIONS` only, uses `PriceClass_100`, and returns `/index.html` with status 200 for origin 403 and 404 (error caching time 0 s), so deep links work. Every response carries `Strict-Transport-Security` (2 years, includeSubDomains), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` and a `Content-Security-Policy`.

### Content Security Policy keys

The API, Cognito and evidence bucket hosts belong to stacks that depend on Web, so Web reads them from config. Set these in the stage file. All four files ship the same defaults. Each key is an array of 1 to 4 entries.

| Key | Default | Used in |
|---|---|---|
| `cspApiOrigins` | `["https://*.execute-api.us-east-1.amazonaws.com"]` | `connect-src` |
| `cspCognitoOrigins` | `["https://cognito-idp.us-east-1.amazonaws.com", "https://*.amazoncognito.com"]` | `connect-src` |
| `cspEvidenceOrigins` | `["https://*.s3.us-east-1.amazonaws.com"]` | `connect-src`, `img-src`, `form-action` |

Each entry is `https://<host>` with lowercase DNS labels, no path, port or trailing slash. A host wildcard is allowed only as one leading `*.` label followed by at least two more labels. A bare `*`, other schemes and CSP keywords are rejected, and the error names the file and the entry (for example `cspApiOrigins[1]`).

The resulting policy is `default-src 'none'`, `script-src 'self'`, `style-src 'self'`, `font-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'`, `object-src 'none'`, `img-src 'self' data:` plus the evidence origins, `form-action 'self'` plus the evidence origins, and `connect-src 'self'` plus the API, Cognito and evidence origins. There is no `'unsafe-inline'`, `'unsafe-eval'` or `blob:`. Changing a key and redeploying Web changes the header with no code edit.

### Console files and the placeholder

`BucketDeployment` uploads `frontend/dist` when `frontend/dist/index.html` exists. Otherwise it uploads the committed placeholder page `infra/assets/web-placeholder/index.html` and synth prints a warning. The placeholder has no script and no external reference. Synth never builds the console, so run the console build before `npm run deploy -- <stage>` to deploy the real console. A deploy from a checkout without `frontend/dist` replaces the console with the placeholder (`prune` removes other files).

### Hand-offs

After the first Web deploy:

1. For a long-lived stage (`demo`), copy `ConsoleUrl` (no trailing slash) into `consoleOrigins` in `infra/config/<stage>.json` and redeploy Foundation (`npm run deploy -- <stage>`), so browser uploads pass the evidence bucket CORS rule. `dev-a` and `dev-b` are destroyed after each check and keep the defaults (see "Which hosts are committed").
2. The Auth stack (T-06) receives `web.consoleUrl` through stack props, so the Cognito callback and logout URLs follow the CloudFront domain with no manual copy.

Cognito CSP: after the first Auth deploy of a long-lived stage (`demo`), read `CognitoDomain` from the Auth outputs and set `cspCognitoOrigins` in that stage file to `["https://cognito-idp.us-east-1.amazonaws.com", "https://<CognitoDomain>"]` (replacing the wildcard `https://*.amazoncognito.com`), then redeploy Web. The API and evidence bucket hosts (`cspApiOrigins`, `cspEvidenceOrigins`) keep their wildcard defaults until `demo` is deployed. For `demo`, set `cspApiOrigins` after the first Api deploy (see the Api stack hand-off).

#### Which hosts are committed

`dev-a` and `dev-b` are destroyed after each verification, and their CloudFront and API hosts change on every deploy. Their config files therefore keep the wildcard defaults and the local origin `http://localhost:5173`, and no ephemeral CloudFront, API or Cognito host is committed there. Only `demo`, the long-lived stage, gets exact hosts.

#### Placeholders that remain

- The console placeholder page `infra/assets/web-placeholder/index.html` is deployed until the console build exists. T-21 creates `frontend/dist`.
- The exact hosts in `consoleOrigins`, `cspApiOrigins`, `cspCognitoOrigins` and `cspEvidenceOrigins` for `demo` are filled in only when `demo` is deployed (T-29).

### Outputs

| Output | Value |
|---|---|
| `ConsoleUrl` | `https://<distribution domain>` |
| `DistributionDomainName` | CloudFront domain name |
| `DistributionId` | Distribution ID |
| `ConsoleBucketName` | Console bucket name |

Outputs have no export names.

### Verify a deployment

```bash
aws cloudformation describe-stacks --stack-name ClaimsAgent-dev-b-Web --query "Stacks[0].Outputs"

curl -sI <ConsoleUrl>/                                   # 200 with strict-transport-security, x-content-type-options, x-frame-options, referrer-policy, content-security-policy
curl -sI http://<DistributionDomainName>/                # 301 or 302, location starts with https://<DistributionDomainName>
curl -sI https://<ConsoleBucketName>.s3.amazonaws.com/index.html   # 403
curl -s <ConsoleUrl>/some/deep/route                     # 200, body is index.html
aws s3api get-public-access-block --bucket <ConsoleBucketName>     # four settings true
```

### Destroy behaviour

`dev-a`, `dev-b` and `ci`: `npm run destroy -- <stage>` deletes the stack. The console bucket uses auto-delete, so it is emptied first. `demo` keeps the console bucket after a destroy (removal policy `RETAIN`), so redeploying the same stage fails with "already exists" until you delete the leftover bucket. The distribution is always deleted.

### Limits and pilot items

- The default CloudFront certificate ignores the minimum TLS version. The stack sets `TLSv1.2_2021`, which takes effect once a custom domain with an ACM certificate is added.
- Not in the MVP, each with a written cdk-nag acknowledgment: WAF in front of CloudFront (`AwsSolutions-CFR2`), geo restriction (`-CFR1`), CloudFront access logging (`-CFR3`) and S3 server access logging for the console bucket (`-S1`). They are pilot items together with the custom domain and ACM certificate.
- The `BucketDeployment` handler and auto-delete provider are CDK-managed Lambda functions. Their cdk-nag findings are acknowledged on those constructs only.

## Auth stack

`ClaimsAgent-<stage>-Auth` holds sign-in for both roles. It depends on the Web stack only for the console URL, which `build-app.ts` passes as the prop `consoleUrl`. It has no identity pool, social or SAML provider, resource server or custom scope.

- **User pool:** Essentials feature plan. Users sign in with their email address. Self sign-up is off (only administrators create users), MFA is off, account recovery is off (no email is sent), and passwords need 12 or more characters with a lowercase letter, an uppercase letter, a digit and a symbol. The pool name is generated by CloudFormation. `demo` has deletion protection and the `Retain` policy, the other stages have neither.
- **Groups:** `Customer` and `Adjuster`, with no IAM role and no precedence. They appear as `cognito:groups` in the access token.
- **Tenant:** the custom attribute `custom:tenantId` (1 to 40 characters, immutable). No app client can write it, and the app clients can write only `email` and `name` (Cognito requires a required attribute such as `email` to be writable). A pre token generation Lambda (event version V2_0, 5 s, 256 MB, no environment variables beyond the standard two, no IAM beyond its log group and X-Ray) copies it into the access token as the claim `tenantId`, because Cognito does not copy custom attributes into access tokens. It reads the value only from `request.userAttributes`, never from `clientMetadata`, and throws when the value is missing or invalid, so Cognito issues no token. Details in `backend/auth/README.md`.
- **Managed login:** a prefix domain `claims-<stage>-<8 hex characters>` (the hex characters come from a hash of account, region and stage, so the account ID is never written down) with managed login version 2 and Cognito's default branding.
- **Console client:** public (no secret), authorization code grant only, scopes `openid` and `email` only (not `aws.cognito.signin.user.admin`), identity provider `COGNITO` only. Access and ID tokens last 60 minutes, the refresh token 1 day. Token revocation and `PreventUserExistenceErrors` are on, and no password flow is enabled. Cognito does not force PKCE, so the client must send a `code_challenge` (the console in T-21 does; recipe C below does too).
- **Callback and logout URL:** `<origin>/` for the CloudFront console and for each entry of `authLocalOrigins`. Cognito checks the URL for an exact match, so `http://localhost:5173` without the trailing slash is rejected.

### Config keys

| Key | Default | Effect |
|---|---|---|
| `authLocalOrigins` | `["http://localhost:5173"]` (`[]` in `demo`) | Local development origins added to the callback and logout URLs. Each is `http://localhost[:port]`, at most 3 entries. 5173 is the port of the console's local development server (T-21), and no other origin goes here. |
| `enableVerificationClient` | `false` (`true` in `dev-b`) | Creates the test-only Verification client. It must stay `false` in `demo`: the stack refuses `true` there and throws before it creates anything. |

The Verification client has no OAuth and allows the password flow (`USER_PASSWORD_AUTH`). It has the same attribute permissions as the console client, so a check against it applies to both. It exists because `update-user-attributes` needs the scope `aws.cognito.signin.user.admin`, which a token from managed login does not carry and which the console client must not have.

### Outputs

| Output | Value |
|---|---|
| `UserPoolId` | User pool ID |
| `AppClientId` | Console client ID |
| `IssuerUrl` | `https://cognito-idp.us-east-1.amazonaws.com/<UserPoolId>` |
| `CognitoDomain` | `<prefix>.auth.us-east-1.amazoncognito.com` |
| `VerificationClientId` | Verification client ID (only when `enableVerificationClient` is `true`) |

Outputs have no export names and no `VITE_` prefix. T-21 maps them to its own variables, and the Api stack (T-08) receives the pool and client through stack props.

### Seed users

```bash
npm run seed-users -- <stage>      # for example: npm run seed-users -- dev-b
```

The script reads `UserPoolId` from the stack `ClaimsAgent-<stage>-Auth` and creates three synthetic users with `custom:tenantId` `t1`: `customer1@example.com` and `customer2@example.com` (group `Customer`) and `adjuster1@example.com` (group `Adjuster`). The `example.com` domain is reserved for documentation, and no email is sent. For each new user it prints a temporary password once, in a `CREATED <email> temporary password: <password>` line. Copy it then, because it is not stored anywhere. The first sign-in forces a new password. It then prints a table with email, group, tenant and `sub`. A re-run is safe: existing users keep their password and only the group membership is re-applied. If an existing user has another tenant, the script reports an error and changes nothing, because `tenantId` is immutable. Delete the user with `aws cognito-idp admin-delete-user` and run the script again. Owner A's seed (T-12) uses `sub` as `customerId`, so run `seed-users` first.

### Verify a deployment

Run these against `dev-b`, which has the Verification client. Shell variables only, nothing is committed.

```bash
STAGE=dev-b; STACK=ClaimsAgent-$STAGE-Auth
out() { aws cloudformation describe-stacks --stack-name $STACK --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
POOL=$(out UserPoolId); CLIENT=$(out AppClientId); VCLIENT=$(out VerificationClientId); DOMAIN=$(out CognitoDomain)
# Decode a token locally (no signature check, for reading claims only):
decode() { local p; p=$(printf %s "$1" | cut -d. -f2 | tr '_-' '/+'); while [ $(( ${#p} % 4 )) -ne 0 ]; do p="$p="; done; printf %s "$p" | base64 -d | jq '{sub, "cognito:groups", tenantId, client_id, scope, token_use}'; }
```

Run recipe C first for `customer1` and `adjuster1`, then A for all three users. Recipe A sets a permanent password, which would skip the first-sign-in password change that C shows.

**C. Managed login with PKCE** (the real console client):

```bash
VERIFIER=$(openssl rand -base64 48 | tr -d '=+/\n' | cut -c1-64)
CHALLENGE=$(printf %s "$VERIFIER" | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')
echo "https://$DOMAIN/oauth2/authorize?response_type=code&client_id=$CLIENT&redirect_uri=http%3A%2F%2Flocalhost%3A5173%2F&scope=openid+email&code_challenge=$CHALLENGE&code_challenge_method=S256"
# Open the URL, sign in with the temporary password and set a new one. The browser ends on
# http://localhost:5173/?code=... (the page may not load if no dev server runs). Copy the code from the address bar.
curl -s -X POST "https://$DOMAIN/oauth2/token" -H 'Content-Type: application/x-www-form-urlencoded' \
  -d "grant_type=authorization_code&client_id=$CLIENT&code=$CODE&redirect_uri=http%3A%2F%2Flocalhost%3A5173%2F&code_verifier=$VERIFIER" | jq -r .access_token
```

Decode the access token: `cognito:groups` is `["Customer"]` (or `["Adjuster"]`), `tenantId` is `t1`, `client_id` is `$CLIENT` and `scope` is `openid email`.

**A. Claims for all three users through the Verification client:**

```bash
PW="$(openssl rand -base64 18)Aa1!"        # throwaway, shell variable only
for U in customer1 customer2 adjuster1; do
  aws cognito-idp admin-set-user-password --user-pool-id $POOL --username $U@example.com --password "$PW" --permanent
  T=$(aws cognito-idp initiate-auth --auth-flow USER_PASSWORD_AUTH --client-id $VCLIENT \
      --auth-parameters USERNAME=$U@example.com,PASSWORD="$PW" --query AuthenticationResult.AccessToken --output text)
  echo "== $U"; decode "$T"
done
```

**B. Refresh keeps the claim:** `aws cognito-idp initiate-auth --auth-flow REFRESH_TOKEN_AUTH --client-id $VCLIENT --auth-parameters REFRESH_TOKEN=<refresh token>`, then `decode` the new access token. `tenantId` is still `t1`.

**D. Attribute protection**, with the Verification client token `$T` of `customer1`:

```bash
aws cognito-idp update-user-attributes --access-token "$T" --user-attributes Name=custom:tenantId,Value=t2   # expect an error
aws cognito-idp update-user-attributes --access-token "$T" --user-attributes Name=name,Value="Customer One"  # expect success (control)
aws cognito-idp admin-get-user --user-pool-id $POOL --username customer1@example.com --query "UserAttributes[?Name=='custom:tenantId']"   # still t1
aws cognito-idp admin-update-user-attributes --user-pool-id $POOL --username customer1@example.com --user-attributes Name=custom:tenantId,Value=t2   # expect an error (immutable)
```

The control call succeeds, so the first failure comes from the attribute permission and not from a bad token.

### Destroy behaviour

`dev-a`, `dev-b` and `ci`: `npm run destroy -- <stage>` deletes the pool, its users, the domain and the clients. `demo` keeps the user pool after a destroy (removal policy `Retain`) and has deletion protection, so turn that off on the pool before the stack can be destroyed. Redeploying `demo` after a destroy fails with "already exists" until the leftover pool is deleted.

### Email is writable
- `custom:tenantId` stays unwritable: it is immutable and not in the client write list. The write list is `email` and `name`, because Cognito rejects app clients whose write attributes omit the required attribute `email`.
- Only a token with the `aws.cognito.signin.user.admin` scope can call `update-user-attributes`. That is the dev-only Verification client. The console client token lacks that scope.
- A user holding such a token can move their login email to an unverified address (`email_verified` becomes false). Never use `email` as an identity or authorization input. Use `sub`, `cognito:groups` and `tenantId`.
- Hardening for pilot: turn on Cognito "keep original attribute value active until verified" (`UserAttributeUpdateSettings`).
### Limits and pilot items

- MFA and the Plus plan (threat protection) are off. Both are acknowledged in cdk-nag (`AwsSolutions-COG2`, `-COG8`) and are pilot items.
- PKCE is applied by the client, not enforced by Cognito.
- Cognito Essentials costs $0.015 per monthly active user, already counted in `docs/cost-estimate.md`.

## Api stack

`ClaimsAgent-<stage>-Api` is the HTTP API in front of the claims backend. It depends on the Auth stack only, through the typed `auth` prop (`AuthResources`). Nothing depends on it yet. In T-08 every route is wired and protected, and every route answers `501 NOT_IMPLEMENTED` after the checks pass. T-09, T-10 and T-24 add the real handlers.

The stack holds:

- one HTTP API with no default route and a `$default` stage with auto-deploy;
- one JWT authorizer, used by every route;
- two Lambda functions, `api-customer` and `api-adjuster`, each with its own role (Node.js 22, ARM64, 10 s, 256 MB, no data-service permission);
- nine routes, each with its own integration and its own `lambda:InvokeFunction` permission, limited to one method and one path;
- one access log group (14 days retention, deleted with the stack).

The function code is in `backend/api` (see its README). The route table is in `lib/constructs/platform/api-model.ts` (`API_ROUTES`) and is repeated in `backend/api/routes.ts`. A test keeps the two in sync.

### Routes

| Route | Function | Groups | Implemented by |
|---|---|---|---|
| `GET /me/policies` | `api-customer` | Customer | T-09 |
| `POST /evidence/uploads` | `api-customer` | Customer | T-09 |
| `POST /claims` | `api-customer` | Customer | T-09 |
| `GET /claims` | `api-customer` | Customer | T-09 |
| `GET /claims/{claimId}` | `api-customer` | Customer, Adjuster | T-09 |
| `GET /claims/{claimId}/evidence/{evidenceId}` | `api-customer` | Customer, Adjuster | T-10 |
| `GET /queue` | `api-adjuster` | Adjuster | T-10 |
| `POST /claims/{claimId}/resolution` | `api-adjuster` | Adjuster | T-10 |
| `GET /impact` | `api-adjuster` | Adjuster | T-24 |

### Authentication and middleware

The JWT authorizer checks the signature, the issuer (the user pool `IssuerUrl`), expiry and the audience. The audience is the console client. In `dev-b` it also holds the Verification client, so curl checks with `USER_PASSWORD_AUTH` tokens pass. In `dev-a`, `demo` and `ci` it holds the console client only. The identity source is the `Authorization` header.

API Gateway cannot tell an access token from an ID token, because both carry the audience or client ID in a form it accepts. The Lambda middleware therefore rejects a token whose `token_use` is not `access` with `401 UNAUTHORIZED` ("An access token is required"). No route reads the ID token.

Every request goes through the same middleware, in this order:

1. request ID (from the API Gateway request context);
2. claims: `token_use` is `access`, `sub`, `tenantId` and exactly one known group (`Customer` or `Adjuster`) in `cognito:groups`. Role and tenant come only from the verified claims, never from the body, a header or the query string;
3. route lookup (`404 NOT_FOUND` for an unknown route key);
4. group gate: `403 FORBIDDEN` when the group is not allowed for the route. This runs before any body check;
5. path parameters (`claimId` matches `CLM-...`, `evidenceId` matches `EVD-...`);
6. body: at most 16 KiB, `application/json`, validated against the `contracts/api` schema, undeclared properties rejected (so `tenantId`, `role` or `customerId` in a body gives 400);
7. dispatch: `501 NOT_IMPLEMENTED` until T-09, T-10 or T-24 register a handler. A handler that throws gives `500 INTERNAL_ERROR` with a fixed message.

Errors from the Lambdas use the schema `contracts/api/error.response.schema.json`: `{ "error": "<CODE>", "message": "...", "requestId": "...", "fields": [{ "path", "message" }] }`. `fields` appears for 400 only, holds at most 20 entries and never repeats the submitted value. The response always carries `x-request-id`. Codes: `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `NOT_IMPLEMENTED`, `INTERNAL_ERROR`.

### Throttling, access logs and CORS

- **Throttling:** the `$default` stage allows 20 requests per second with a burst of 40, for all routes. The values are `THROTTLE` in `lib/constructs/platform/api-model.ts`. Change them there and redeploy.
- **Access log:** one JSON record per request in the `AccessLogs` group, with these eleven fields: `requestId`, `requestTime`, `httpMethod`, `routeKey`, `status`, `responseLength`, `responseLatency`, `integrationLatency`, `integrationStatus`, `errorMessage`, `authorizerError`. There is no source IP, token, claim, header, query string, path or body. The list is `ACCESS_LOG_FIELDS` in `api-model.ts`.
- **CORS:** allowed origins come from `consoleOrigins` in the stage file (the same list the evidence bucket uses). Methods `GET`, `POST`, `OPTIONS`. Request headers `Authorization` and `Content-Type`. Exposed header `x-request-id`. No credentials. Max age 600 s. API Gateway answers preflight requests itself, and also adds the CORS headers to its own 401 response.

### Outputs

| Output | Value |
|---|---|
| `ApiUrl` | `https://<id>.execute-api.us-east-1.amazonaws.com`, no trailing slash |
| `ApiId` | HTTP API ID |
| `CustomerFunctionName` | `api-customer` function name |
| `AdjusterFunctionName` | `api-adjuster` function name |

Outputs have no export names.

### Hand-off after the first deploy

For a long-lived stage (`demo`), after the first Api deploy:

1. Copy the exact host of `ApiUrl` (`https://<id>.execute-api.us-east-1.amazonaws.com`) into `cspApiOrigins` in `infra/config/<stage>.json` and redeploy Web, so the console CSP allows calls to the API.
2. Copy the exact console host (`ConsoleUrl`, no trailing slash) into `consoleOrigins` and redeploy Foundation and Api, so the evidence bucket and the API CORS rule accept the console origin.

`dev-a` and `dev-b` keep the wildcard defaults and `http://localhost:5173`, and no ephemeral host is committed. A console served from an ephemeral dev CloudFront host needs a local, uncommitted `consoleOrigins` edit and an Api redeploy before the browser can call the dev API. Curl checks do not need it.

### Permissions that T-09 and T-10 add

T-08 gives the two functions only logging, X-Ray and Powertools metrics. The later tickets add (the stack takes the tables, queue and key as typed props then, with no name lookup):

- **T-09, `api-customer`:** `dynamodb:GetItem`, `Query` and `PutItem` on the named tables (and their indexes where queried); `sqs:SendMessage` on the job queue; presigning of uploads, which needs `s3:PutObject` on the evidence key prefix; and the data key actions (`kms:GenerateDataKey`, `kms:Decrypt`) for the encrypted tables, queue and bucket.
- **T-10, `api-adjuster` (and the evidence read on `api-customer`):** the conditional update of the claim status, the audit `PutItem`, and the presigned read of evidence (`s3:GetObject` on the evidence key prefix, with the data key).

### Verify a deployment

Run these against `dev-b`. Shell variables only. Passwords and tokens stay in your shell and are never committed. The seeded users come from `npm run seed-users -- dev-b`, and the Verification client exists in `dev-b` only.

```bash
STACK=ClaimsAgent-dev-b
out() { aws cloudformation describe-stacks --stack-name "$1" --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text; }
API=$(out $STACK-Api ApiUrl); API_ID=$(out $STACK-Api ApiId); VCID=$(out $STACK-Auth VerificationClientId)
tok() { aws cognito-idp initiate-auth --client-id "$VCID" --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters "USERNAME=$1,PASSWORD=$2" --query "AuthenticationResult.$3" --output text; }
CUST_ACCESS=$(tok "$CUSTOMER1_EMAIL" "$CUSTOMER1_PASSWORD" AccessToken)
CUST_ID=$(tok "$CUSTOMER1_EMAIL" "$CUSTOMER1_PASSWORD" IdToken)
ADJ_ACCESS=$(tok "$ADJUSTER1_EMAIL" "$ADJUSTER1_PASSWORD" AccessToken)
BODY=$(cat contracts/api/claim-create.request.example.json)
```

1. No token gives 401 from API Gateway:
   `curl -s -w '\n%{http_code}\n' "$API/me/policies"` prints `{"message":"Unauthorized"}` and 401.
2. An ID token gives 401 from the middleware:
   `curl -s -w '\n%{http_code}\n' -H "Authorization: Bearer $CUST_ID" "$API/me/policies"` prints 401 with `UNAUTHORIZED` and "An access token is required".
3. A customer on an adjuster route gives 403:
   `curl -s -w '\n%{http_code}\n' -H "Authorization: Bearer $CUST_ACCESS" "$API/queue"` prints 403 with `FORBIDDEN`.
4. An adjuster on `/impact` reaches the Lambda and gives 501:
   `curl -s -w '\n%{http_code}\n' -H "Authorization: Bearer $ADJ_ACCESS" "$API/impact"` prints 501 with `NOT_IMPLEMENTED`.
5. An invalid body gives 400 with the field named:
   `curl -s -w '\n%{http_code}\n' -H "Authorization: Bearer $CUST_ACCESS" -H 'Content-Type: application/json' -d "$(echo "$BODY" | jq '. + {tenantId:"x"}')" "$API/claims"` prints 400 and `fields` holds `/tenantId`. The unchanged `$BODY` gives 501.
6. Both `{claimId}` routes reach the Lambda (501, not 404). The first uses the id from the example file, the second a made-up id:
   `curl -s -w '\n%{http_code}\n' -H "Authorization: Bearer $CUST_ACCESS" "$API/claims/CLM-1042"` and
   `curl -s -w '\n%{http_code}\n' -H "Authorization: Bearer $CUST_ACCESS" "$API/claims/CLM-1042/evidence/EVD-1"`.
7. CORS on the 401 response and on preflight, using an allowed origin (`http://localhost:5173`):
   `curl -si -H 'Origin: http://localhost:5173' "$API/me/policies" | grep -i '^access-control-allow-origin'` prints the origin.
   `curl -si -X OPTIONS "$API/claims" -H 'Origin: http://localhost:5173' -H 'Access-Control-Request-Method: POST' | grep -i '^access-control'` prints the allow headers.
   An origin not in `consoleOrigins` gets no `access-control-allow-origin` header.
8. Access log and permissions:
   ```bash
   LOG_ARN=$(aws apigatewayv2 get-stage --api-id "$API_ID" --stage-name '$default' --query 'AccessLogSettings.DestinationArn' --output text)
   aws logs tail "${LOG_ARN#*log-group:}" --since 10m        # eleven fields, no token, claim or address
   aws lambda get-policy --function-name "$(out $STACK-Api CustomerFunctionName)" --query Policy --output text | jq '.Statement[].Condition.ArnLike'
   ```

### Destroy behaviour

All Api resources are deleted with the stack in every stage, including `demo`: the API, the functions, their log groups and the access log group hold no data. CloudFormation deletes the Api stack before the Auth stack, because Api uses the Auth outputs.

### Limits and pilot items

- No WAF in front of the API, and no custom domain or ACM certificate. Both are pilot items. The API is reachable at the default `execute-api` host.
- Throttling is one stage-wide default. There is no usage plan or per-client quota, because HTTP APIs do not support them. Per-caller limits would need a WAF rate rule or a REST API.
- The 401 for a missing or invalid token comes from API Gateway, with the body `{"message":"Unauthorized"}`. It does not follow the project error schema, and has no `requestId` in the body. Every error from the Lambdas (including the 401 for an ID token) uses the project schema.
- Every route returns 501 until T-09, T-10 and T-24 land. The group and body checks already work.
