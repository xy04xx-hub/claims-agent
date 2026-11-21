---
inclusion: auto
name: architecture-diagram
description: Rules and workflow for creating or changing the AWS architecture diagram (docs/architecture.drawio and docs/architecture.png). Use whenever the user asks to add, change, redraw, export or review the architecture diagram, or when a change to architecture.md adds, removes or renames a component.
---

# Architecture Diagram Rules

This file is the single source for how the project's architecture diagram looks and how it is produced. The user's reference diagram is captured below in words and numbers, so the user does not need to supply it again. If the reference screenshot is present at `refs/Screenshot 2026-11-13 150439.png` (git-ignored, local only), it may be viewed to confirm the style, but nothing here depends on it.

The diagram must always match `.kiro/steering/architecture.md`. If they disagree, `architecture.md` wins and the diagram is fixed.

## 1. Mandatory workflow

1. **Edit the spec, never the XML.** The diagram is generated from `tools/diagram/claims_architecture.py` using `tools/diagram/diagram_lib.py`. Add or change groups with `group(...)`, icons with `icon(...)`, edges with `edge(...)`. Do not hand-edit `docs/architecture.drawio`; the next build would overwrite it.
2. **Build:** `tools/diagram/build.sh` (add `--jpeg` to also write a JPEG). It runs three steps and stops at the first failure:
   1. the layout checker in the spec (must report `errors: 0` and no label failures),
   2. the official validator `.kiro/skills/aws-architecture-diagram/scripts/lib/validate_drawio.py` (must print `VALIDATION PASSED`),
   3. the renderer `tools/diagram/render.mjs`, which writes `docs/architecture.png`.
3. **Always produce the image.** Every time the diagram changes, `docs/architecture.drawio` and `docs/architecture.png` are regenerated together and committed together. Never leave a stale PNG. Never report the diagram as done without the PNG.
4. **Look at the PNG** (open `docs/architecture.png`) and check it against section 5 before reporting. The checker proves geometry, not readability.
5. **Keep text in sync:** if the diagram changes, update the request flow and component table in `architecture.md`, and the cost or value docs if a billable component was added or removed.
6. If rendering fails, fix the cause (section 7). Do not skip the PNG. If it truly cannot be fixed, say so plainly and do not leave an outdated image in place.

## 2. Verified skill and precedence

The official AWS Labs skill `aws-architecture-diagram` is installed in the workspace at `.kiro/skills/aws-architecture-diagram` (provenance, licence and review notes are in its `SOURCE.md`). Use it for:

- valid shape names: `references/aws4-shapes-services.md`, `references/aws4-shapes-resources.md`, `scripts/lib/aws4-shapes.json`, `references/general-icons.md` for non-AWS items. Never invent a `mxgraph.aws4.*` name,
- XML well-formedness rules in `references/xml-rules.md`,
- validation with `validate_drawio.py`.

**Where the skill and this file disagree, this file wins.** The differences that matter:

| Skill default | This project |
|---|---|
| 48x48 icon in a 120x120 tinted container | 48x48 icon with no container, label beside or below |
| 180 px / 120 px spacing, teal numbered badges, right sidebar legend | Compact spacing and legend as in section 4. Step numbers are part of edge labels |
| Title block at the top, Helvetica, `light-dark()` colours | No title block. Colours as in section 3 |
| Leave out IAM, CloudWatch, CloudTrail, KMS unless asked | A "Security & ops" group is **required**, as in the reference |
| Prefers its own examples over the user's style | The reference in section 3 is authoritative |

Do **not** run the skill's auto-fixers (`post_process_drawio.py`, `fix_nesting.py`, `fix_icon_colors.py`, `fix_step_badges.py`). They relocate and recolour elements and would break the spacing rules. Run `validate_drawio.py` only. If a newer verified skill for diagrams appears, review it the same way (publisher, licence, contents), install it into `.kiro/skills/`, record it in a `SOURCE.md`, and keep this file's precedence rule.

## 3. Reference style (from the user's reference architecture)

The reference is a wide, landscape AWS diagram for a note-generation system (audio transcripts in, notes out, with agents and tool servers). Reproduce its structure and look:

**Containment, outside in**

1. **External systems on the left (and right if needed), outside AWS.** Rounded group with a grey-blue border (`#4B5A78`, 1.5 px) and light grey fill (`#F2F4F8`), bold title top-left. Holds the client and any non-AWS services, with generic icons (laptop for the web app, server for an API, database for MongoDB). A lone cloud-upload icon for a third-party service sits left of it.
2. **"AWS Cloud" group** (AWS cloud shape with logo, dark border `#232F3E`, no fill). Contains one account group.
3. **Account and Region group**, titled `<name> AWS account · us-east-1` (AWS account group shape, pink-red border `#CD2264`, no fill). Contains everything below.
4. Inside the account, from top to bottom:
   - a **top band of loose stores and queues** that are not inside a group (S3, queues, DynamoDB), with icon labels above or beside them,
   - a **middle band of groups side by side**, left to right in request order: Edge, compute (VPC or serverless backend), Bedrock AgentCore, Bedrock,
   - a **bottom "Security & ops" group** spanning the width, with its icons in one evenly spaced row.

**Group styles** (rounded rectangle, `arcSize=2`, bold 12 px title top-left in the border colour):

| Group | Border | Fill | Title colour |
|---|---|---|---|
| External, Edge, Browser | `#4B5A78` | `#F2F4F8` (external) or white (Edge) | `#3C4A66` |
| Compute (VPC or serverless backend) | `#8C4FFF` | `#F7F4FF` | `#7B3FF2` |
| Bedrock AgentCore, Bedrock | `#01A88D` | `#F1FBF8` | `#067F6B` |
| Security & ops | `#DD344C` | `#FFF5F6` | `#DD344C` |
| Gateway targets (tool Lambdas) | `#ED7100` | `#FFF8F0` | `#C25E00` |
| Account | `#CD2264` | none | `#CD2264` |
| AWS Cloud | `#232F3E` | none | `#232F3E` |

**Icons:** current AWS Architecture Icons as draw.io `resourceIcon` shapes, 48x48, label in regular 11 px dark text (`#232F3E`), service name on the first line and a short role (two or three words) on the second. Group titles 11 px bold. Category fill: compute `#D05C17`, storage `#277116`, database `#3334B9`, networking `#5A30B5`, security `#C7131F`, management and integration `#BC1356`, AI and ML `#116D5B` (the standard AWS category colours, applied through the gradient). AgentCore uses `bedrock_agentcore`, not `bedrock`. Non-AWS items use a neutral `#232F3E` standalone shape.

**Edges:** orthogonal, dark `#232F3E`, 1.25 px, filled block arrowheads. Every edge label is 10 px with a **white background** and sits on a clear stretch of its own line. Labels carry the step number and, where useful, the protocol or auth, for example `1 presigned POST`, `4 run`. Solid line for a request or synchronous call, **dashed** for asynchronous, telemetry or fail-safe paths. Crossings use jump arcs (`jumpStyle=arc`).

**Legend** below the AWS Cloud group, outside every group: the word Legend, a solid arrow (request / sync call), a dashed arrow (async / telemetry / fail-safe), and a one-line note on the numbered steps and any items not drawn (pilot items).

**Spacing and feel:** the reference is **dense**. Icons sit close together, groups are only as big as their content, groups are separated by narrow gutters, and there is very little empty canvas. Long edges run along those gutters instead of through empty space. There is no title block and no decorative shading.

## 4. Spacing rules: compact, with no overlaps

"Negative space" here means **empty canvas**. The user wants as little of it as possible, as long as no line, label or icon touches another. Both halves are rules.

**Compact (no wasted space):**

- Icons 48x48. Centre-to-centre distance between neighbours in a row is **about 95 to 112 px**, and between rows **about 100 to 120 px**. Use the smallest value that keeps the labels clear.
- Every group is sized to its content: about **12 px** of padding on the sides and bottom, and a **30 px** title zone at the top. No group may have an empty row or column.
- Groups in the same band share top and bottom edges and sit **12 px** apart. That gap is the routing gutter for long edges (for example the DynamoDB bus).
- The diagram fills a wide landscape canvas of roughly **1,100 x 700 px** for about 25 icons. If the build reports a larger canvas, compress it before reporting.
- Labels are short: at most two lines, at most about 20 characters per line. Leave detail to `architecture.md`.
- Only label edges that need it: step numbers, and the protocol or reason where it adds meaning. A step number alone (for example `4`) is fine where space is tight.
- The legend sits directly under the AWS Cloud group. The note is at most two lines.

**No overlaps (all enforced by the checker in `diagram_lib.py`; the build fails otherwise):**

- Icon to icon: at least **14 px** clear.
- Icons and icon labels stay inside their group with 12 px padding, below the title zone.
- No icon label touches another label, an icon, a group title, a group border or an edge. The checker searches label positions (below, above, right, left and the four corners) with backtracking and fails if no combination works. Then move an icon or shorten a label.
- No edge passes through an icon, an icon label or a group title.
- Every edge label sits on a clear stretch of its own line: no other edge and no group border runs through it. Lines that share a trunk (same source fanning out) count as one line.
- Sibling groups at least 12 px apart. A child group sits at least 12 px inside its parent and 30 px below the parent's top edge.
- Edges are orthogonal with **explicit waypoints**, leave and enter at icon side centres, and use jump arcs where they must cross.
- Single flow direction, left to right. The main request path stays on one row (`SP` in the spec) so its edges are straight.

The build prints the canvas size and how full each group is. Use it to spot slack.

## 5. Visual checklist before reporting

Look at `docs/architecture.png` and confirm all of these:

1. Every component in the request flow of `architecture.md` appears, with the same name, and nothing appears that is not built or decided. Pilot items are mentioned only in the legend note.
2. The numbered steps run in order and match the flow in `architecture.md`.
3. Nothing overlaps or touches, no label sits on an icon, no line runs through an icon or a label, and no label sits on a group border.
4. There is no large empty area: no empty row or column inside a group, gutters about 12 px, canvas roughly 1,100 x 700 px.
5. Groups have the right colour and a bold coloured title, and the structure is Browser, AWS Cloud, account, Edge, backend, AgentCore, Bedrock, Security & ops.
6. Icons render as official AWS icons (not blank boxes or text placeholders).
7. The legend is directly below the AWS Cloud group and clear of its border.

## 6. Components and icon names used today

`client` (standalone), `cloudfront`, `s3`, `cognito`, `api_gateway`, `lambda`, `sqs`, `dynamodb`, `bedrock_agentcore` (Gateway, Runtime, Observability), `bedrock` (Claude, Guardrails), `cloudwatch_2`, `cloudtrail`, `key_management_service`, `identity_and_access_management`, `systems_manager`. Add new ones only after checking the skill's shape lists.

Adding a component: add `icon(...)` on an existing row (`RA`, `SP`, `RC`, `TOP`, `BY`) at the same spacing as its neighbours, add its `edge(...)` with waypoints, give it a step number if it is part of the claim flow, then build. Widen only the group that holds it. If the checker reports a clash, run `python3.11 tools/diagram/claims_architecture.py --diagnose` to see which labels block each other, then shorten a label or move one icon. Never fix a clash by adding large gaps.

## 7. Rendering setup and failures

`render.mjs` draws the diagram with the draw.io viewer in headless Chrome (puppeteer), so the icons are the real AWS icons. It downloads the viewer script on first use to `tools/diagram/.cache` and needs network access to `viewer.diagrams.net` for the icon stencils.

- First time on a machine: `tools/diagram/setup.sh` (installs puppeteer and `defusedxml`; on Amazon Linux without root it unpacks Chrome's missing libraries into `tools/diagram/.libs`). `node_modules`, `.cache` and `.libs` are git-ignored.
- Use the headless shell (`headless: 'shell'`). The full Chrome build needs extra libraries.
- Blank icons or a clipped image: raise the wait in `render.mjs` (stencils load lazily) and rerun.
- Output sizes: PNG at 2x scale by default. `--scale 3` for slides, `--jpeg` for a JPEG next to the PNG.
- draw.io desktop CLI is an alternative (`drawio -x -f png -s 2 -o docs/architecture.png docs/architecture.drawio`) if it is ever installed. It is not required.

## 8. Accuracy rules

- The diagram shows what is built or agreed. Do not draw VPC endpoints, WAF, Fargate or similar pilot items as if they existed.
- Every Lambda is drawn as its own icon only when it is its own function in the CDK stack. When two functions are drawn as one icon, say so in the label or the legend note.
- Numbers and names in labels (queue max receive, model name, cache) must match `architecture.md` and `docs/cost-estimate.md`.
- When the user supplies a new reference image, update section 3 of this file from it, then rebuild.
