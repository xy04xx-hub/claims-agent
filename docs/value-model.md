# Value Model

Two layers. Section 1 lists **published results from real insurers**, with sources. Section 2 applies them to a reference customer using inputs that are **assumptions** until a design partner supplies data. Platform cost comes from `docs/cost-estimate.md`.

Some sources below are secondary (news and analyst write-ups that quote the insurer). They are marked. Check the primary document before the pitch.

## 1. What real organizations report

| Organization | Reported result | Why it applies | Source |
|---|---|---|---|
| **Allianz** (Project Nemo, food spoilage claims, launched July 2025) | About 80% reduction in processing and settlement time for eligible low-value claims (under about US$327), days down to hours. Seven task-specific agents with human oversight. | Closest match to our design: small, rule-checkable claims, agents plus a human for the rest | [Allianz Australia](https://www.allianz.com.au/about-us/media-hub/allianz-australia-wins-2026-canstar-innovation-awards.html) (primary). The US$327 threshold is from [Carpe](https://carpe.io/resources/press/artificial-intelligence-at-allianz-two-use-cases/) (secondary) |
| **Lemonade** | Loss adjustment expense ratio fell from 13% to 7% in the period reported for Q3 2025, which Lemonade credits to AI. About 55% of claims fully automated, 96% of first notices handled by AI. States it never lets AI auto-reject claims. | Same single decision (automatic or human) and the same no-auto-reject rule | [Beinsure on Lemonade Q3 2025](https://beinsure.com/news/lemonade-narrows-q3-loss-45/) (secondary). 55% and 96% from [imagine.ai summary of the FY2025 10-K](https://imagine.ai/research/lemonade) (secondary). No auto-reject: [Lemonade](https://www.lemonade.com/blog/lemonades-claim-automation/) (primary) |
| **Aviva** (motor claims, 80+ AI models) | Over £60 million saved in 2024. Liability assessment for complex cases cut by 23 days. Routing accuracy up 30%. Complaints down 65%. | Shows cycle-time and cost effect at a large carrier, though in complex motor claims, not small ones | [Thomson Reuters](https://blogs.thomsonreuters.com/legal-blog/ai-is-transforming-insurance-and-the-law-firms-that-serve-it-must-keep-pace/) and [ITIJ](https://www.itij.com/latest/long-read/using-ai-its-best-potential-part-two-customer-engagement-and-claims-automation) (both secondary) |
| **McKinsey** | 25 to 30% reduction in loss adjustment expense achievable from end-to-end claims digitization | Top-down range for the same lever | Quoted by [vsight.io](https://vsight.io/blog/reduce-claims-cycle-time-loss-adjustment-expense/) (secondary) |
| **KPMG** | AI can move claims from several days to one day or even hours | Cycle-time claim from an advisory report | [KPMG, Unlocking AI value in insurance](https://assets.kpmg.com/content/dam/kpmgsites/xx/pdf/2026/09/unlocking-ai-value-in-insurance.pdf) |
| **Industry baseline** | Claims adjustment expense typically 5 to 15% of premium for P&C. About $86 billion in 2025 for US P&C, roughly 9 cents per premium dollar. | Size of the cost pool | [analystinterview.com](https://www.analystinterview.com/article/claims-adjustment-expense-ratio-in-insurance-sector) and [ventavid.com](https://www.ventavid.com/blog/loss-adjustment-expense-cost-per-claim) (both secondary, the second cites NAIC) |
| **Fraud** | About 10% of P&C claims contain some element of fraud (NICB estimate). Aviva detected over 18,400 suspect claims in 2025, with AI-generated images and doctored documents a growing feature. | Size of the fraud pool, and a warning about forged evidence | [Gainsco on NICB](https://www.gainsco.com/news/insurance-fraud/) (secondary). [Aviva](https://aviva.com/newsroom/news-releases/2026/06/aviva-stops-record-levels-of-claims-fraud-as-scams-become-more-sophisticated) (primary). [The Register](https://www.theregister.com/ai-and-ml/2026/06/08/motor-insurance-frausters-abusing-ai-to-exaggerate-claims/5252024) (secondary) |

Content from these pages was paraphrased for licensing compliance.

## 2. Reference customer

A mid-size device, renters or travel insurer with 100,000 claims a year. **Inputs are assumptions.**

| Input | Conservative | Base | Basis |
|---|---|---|---|
| Claims per year | 100,000 | 100,000 | assumption |
| Share auto-handled | 20% | 40% | assumption. Lemonade reports about 55% after years of tuning |
| Adjuster minutes saved per auto-handled claim | 15 | 25 | assumption, validate with a time study |
| Loaded adjuster cost per hour | $35 | $40 | assumption |
| Share of claims flagged by risk signals | 2% | 3% | assumption. NICB's 10% covers every fraud element, we catch only rule-detectable ones |
| Share of flagged claims confirmed fraudulent | 25% | 40% | assumption |
| Average fraudulent claim | $250 | $350 | assumption |

| Result per year | Conservative | Base | Formula |
|---|---|---|---|
| Hours saved | 5,000 h | 16,667 h | claims x auto share x minutes / 60 |
| Equivalent adjuster capacity | about 2.4 FTE | about 8 FTE | hours / 2,080 |
| Adjuster time saved | $175,000 | $666,667 | hours x hourly cost |
| Fraud paid out and avoided | $125,000 | $420,000 | claims x flagged share x confirmed share x average fraud amount |
| **Total benefit** | **$300,000** | **$1,086,667** | sum |
| Platform cost (pilot volume) | about $600 | about $600 | `docs/cost-estimate.md`, about $49 a month |

Cost of one manually handled small claim in the base case: 25 min x $40/h = $16.67. The agent's variable cost is about $0.002 per claim.

## 3. Cross-check against the published ratios

Take the same carrier with an average paid claim of $400 (assumption) and a 70% loss ratio (assumption): paid losses $40.0M, premium about $57.1M.

| | Value |
|---|---|
| Claims adjustment expense at the 9% industry figure | about $5.1M |
| Same expense at Lemonade's 7% | about $4.0M |
| Difference (2 points of premium) | about **$1.1M** |
| Our base-case adjuster time saving as a share of premium | 1.2 points |
| McKinsey's 25 to 30% reduction applied to $5.1M | $1.3M to $1.5M, for full end-to-end digitization |

The bottom-up base case ($0.67M of adjuster time) sits inside the top-down range ($1.1M for a 2-point improvement, up to $1.5M for full digitization), and the conservative case ($0.18M) sits below it. That is the reason to present the base case as the planning figure and the conservative case as the floor.

## 4. Cycle time

Published: Allianz reports days down to hours for eligible claims, Lemonade reports payment in seconds for qualifying claims. Our demo shows the seconds side live (target p50 about 4 s). The "before" figure for the buyer's own process is measured in discovery.

## 5. Caveats

- "Fraud avoided" means routed to a person and not auto-paid. Humans may have caught some of these eventually, so this is the softer line.
- Theft auto-approvals carry a lower cap and higher QA sampling. Include the sampling effort (adjuster minutes) in the pilot.
- Published results come from large carriers with years of tuning. Our MVP threshold is deliberately conservative, and shadow mode in the pilot produces the buyer's own numbers.
- Commercial hypothesis to test: a per-auto-handled-claim fee at 10 to 15% of the $16.67 saving, about $2 per claim.
