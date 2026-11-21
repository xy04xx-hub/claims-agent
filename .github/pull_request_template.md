## Ticket

T-xx: <title>

## Summary

<!-- What changed and why. Keep PRs under about 400 changed lines (generated files excluded). -->

## Evidence

Paste command output or a link for each run that applies.

### cdk synth (`npx cdk synth -c stage=dev-a`)

```
```

### cdk list (`npx cdk list -c stage=dev-b`)

```
```

### deploy (`npm run deploy -- dev-b`)

```
```

### destroy (`npm run destroy -- dev-b`)

```
```

## Checklist

- [ ] `npm run lint && npm run typecheck && npm test && npm run synth` pass locally
- [ ] Only files I own were changed (or the other owner is requested as reviewer)
- [ ] No secrets, account IDs or personal data
