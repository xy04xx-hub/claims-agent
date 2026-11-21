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
