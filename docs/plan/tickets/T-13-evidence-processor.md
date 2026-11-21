# T-13: Evidence Processor: hashes, EXIF, normalized image

| Field | Value |
|---|---|
| Owner | A |
| Milestone | M2 |
| Depends on | T-05 |
| Judging items | SEC5, OE4, BIZ-C |
| Estimate | 4 h |
| Status | Todo |
| Branch | `a/T-13-evidence-processor` |

## Why

Duplicate-photo detection must be deterministic and must already be done when the claim is processed.

## Tasks

- [ ] Lambda in the Processing stack, triggered by an EventBridge rule on `Object Created` in the evidence bucket.
- [ ] Compute SHA-256 and a 64-bit perceptual hash (pHash), read EXIF capture time, strip EXIF and write a normalized JPEG (max 1568 px long side, at most 3.5 MB) under `normalized/`. Use `sharp` (ARM64 build), check the cold start.
- [ ] PDF: SHA-256 only, store as-is (the agent reads PDFs as documents).
- [ ] Write `EvidenceIndex`: status `READY` (or `REJECTED` for unreadable files), `SHA256#<hash>` and `PHASH#<hash>` items pointing to the claim or evidence.
- [ ] Near-duplicate lookup: Hamming distance at most the configured threshold (start with 10 of 64 bits) against the tenant's pHashes. A simple scan is fine at MVP size; note the BK-tree option for scale.
- [ ] Unit tests: same image gives the same SHA-256; a resized or re-encoded copy has pHash distance within the threshold; different images exceed it.

## Acceptance criteria

- [ ] Uploading the `CLM-1042` photo again is detected as exact duplicate, a resized copy as near-duplicate.
- [ ] Processing finishes in under 2 s per image.

## Verification

- [ ] Upload the seeded duplicate via the API and check the `EvidenceIndex` items.
- [ ] Check the Lambda's duration in CloudWatch Logs Insights.

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
