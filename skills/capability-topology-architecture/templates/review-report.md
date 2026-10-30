# CTA Conformance Review: <system / PR>

**Scope reviewed:** 
**Verdict:** <Conformant | Conformant with findings | Non-conformant>
**Top risk in one sentence:** 

## Findings (most severe first)
| # | Rule | Severity | Evidence (file:line / design ref) | Why it matters | Fix |
|---|---|---|---|---|---|
| 1 | 6 — no tx spans two modules | High | `orders/service.ts:88` opens one tx writing `orders` and `billing` tables | partial failure can't be reconciled; boundary meaningless | split into local commit + call Billing via client + reconciler |

Severity guide: **High** = breaks a property (rules 2, 3, 4, 5, 6, 7, 9, 11, 15) or a missing obligation (idempotency, reconciliation). **Medium** = erodes over time (operation seam, plugin leaks, shared contracts project). **Low** = hygiene.

## The 15 rules
| # | Status | Note |
|---|---|---|
| 1 Own container + imports | | |
| 2 Declared requests only | | |
| 3 No address at call site | | |
| 4 Moving edits no module | | |
| 5 Own stored state | | |
| 6 No cross-module tx | | |
| 7 State + messages commit together | | |
| 8 Deployment displaces defaults | | |
| 9 No request-borne gate bypass | | |
| 10 Deployment picks external systems | | |
| 11 Validate + permit before gates | | |
| 12 Missing dependency stops startup | | |
| 13 Deployment owns the clock | | |
| 14 Events matched by name | | |
| 15 Refusals returned | | |

## Obligations no checker can discharge
- Idempotent held/retried requests: 
- Reconciliation per multi-module flow: 

## Static scan output (scripts/cta_boundary_check.py)

## Recommended next step (one)
