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

1. Copy `ConsoleUrl` (no trailing slash) into `consoleOrigins` in `infra/config/<stage>.json` and redeploy Foundation (`npm run deploy -- <stage>`), so browser uploads pass the evidence bucket CORS rule.
2. Give `ConsoleUrl` to T-06 (Auth) for the Cognito callback and logout URLs. T-06 receives `web.consoleUrl` through stack props, or reads the output until then.

After the Api and Auth stacks are deployed, replace the default wildcard hosts in `cspApiOrigins`, `cspCognitoOrigins` and `cspEvidenceOrigins` with the exact API, Cognito and evidence bucket hosts in the stage file, then redeploy Web.

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
