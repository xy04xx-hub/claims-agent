# Value Model

Every input is an **assumption** to replace with a design partner's data. Context figures and sources are in `docs/product-architecture-deep-dive.md`, section 2.

Reference customer: a mid-size device, renters or travel insurer, 100,000 claims a year.

## Inputs

| Input | Conservative | Base | Source |
|---|---|---|---|
| Claims per year | 100,000 | 100,000 | assumption |
| Share auto-handled | 20% | 40% | assumption. Lemonade reports about 55% after years of tuning |
| Adjuster minutes saved per auto-handled claim | 15 | 25 | assumption, validate with a time study |
| Loaded adjuster cost per hour | $35 | $40 | assumption |
| Share of claims flagged by risk signals | 2% | 3% | assumption. NICB's 10% covers every fraud element. We catch only rule-detectable ones |
| Share of flagged claims confirmed fraudulent | 25% | 40% | assumption |
| Average fraudulent claim | $250 | $350 | assumption |

## Formulas and results

| Result per year | Conservative | Base | Formula |
|---|---|---|---|
| Hours saved | 5,000 h | 16,667 h | claims x auto share x minutes / 60 |
| Adjuster time saved | $175,000 | $666,667 | hours saved x hourly cost |
| Fraud paid out and avoided | $125,000 | $420,000 | claims x flagged share x confirmed share x average fraud amount |
| **Total benefit** | **$300,000** | **$1,086,667** | sum |
| Platform variable cost | about $5,000 | about $5,000 | assumed at most $0.05 per claim. Replace with `docs/cost-estimate.md` after checking current Bedrock and AgentCore pricing |

- Cost of one manually handled small claim in the base case: 25 min x $40/h = $16.67.
- Cycle time: auto-handled claims go from the carrier's current settlement time (measure in discovery) to seconds.
- "Fraud avoided" means routed to a person and not auto-paid. Humans might have caught some of these eventually, so this is the softer line.
- Theft auto-approvals carry a lower cap and higher audit sampling. Include the sampling cost in the pilot (adjuster minutes spent on QA of auto-approved claims).
- Commercial hypothesis to test: a per-auto-handled-claim fee at 10 to 15% of the $16.67 saving, about $2 per claim.
