# T-07: Web stack: CloudFront, OAC, private bucket

| Field | Value |
|---|---|
| Owner | B |
| Milestone | M1 |
| Depends on | T-04 |
| Judging items | SEC4, OE1 |
| Estimate | 2 h |
| Status | Todo |
| Branch | `<A|B>/T-07-web` |

## Why

The console must be served over HTTPS from a private bucket.

## Tasks

- [ ] Private S3 bucket (Block Public Access, `enforceSSL`), CloudFront distribution with Origin Access Control, HTTPS redirect, default root `index.html`, SPA fallback for 403/404 to `index.html`.
- [ ] Response headers policy: HSTS, `X-Content-Type-Options`, `X-Frame-Options DENY`, a Content Security Policy that allows only the API, Cognito and S3 evidence origins.
- [ ] `BucketDeployment` of `frontend/dist` with CloudFront invalidation. Output the distribution URL (feeds Cognito callback URLs).

## Acceptance criteria

- [ ] Console URL loads over HTTPS. HTTP redirects to HTTPS.
- [ ] Direct S3 object URL is denied.

## Verification

- [ ] `curl -I http://<dist>.cloudfront.net` returns a redirect to HTTPS.
- [ ] `curl -I https://<bucket>.s3.amazonaws.com/index.html` returns 403.
- [ ] Check the security headers with `curl -I https://<dist>.cloudfront.net`.

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
