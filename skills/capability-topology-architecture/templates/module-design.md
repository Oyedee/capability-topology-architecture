# Module Design: <ModuleName>

**Owner (person/team who answers for the rule):** 
**One-sentence capability:** <what it is responsible for — e.g. "how a fee is worked out and recorded on a payment">

## Contracts (public surface — mapped requests only)
| Request (type name) | Kind | Fields | Result | Refusal codes (retryable?) | Permission | Approval scope |
|---|---|---|---|---|---|---|
| `charges.quote` | query | paymentType, amountMinor, tier | `{feeMinor}` | `charges.unknown-type` (no) | — (restrict at edge) | — |
| `charges.apply` | command | paymentId, amountMinor, … | `{feeMinor}` | `charges.invalid-amount` (no) | `charges.apply` | `fees.above-threshold` |

Idempotency key for each command: <field> — durable already-done check lives in: <table>

## Owned data
- Schema / store: 
- Tables / streams: 
- Event-sourced? <yes/no — which aggregates>
- Read models / projections: 
- Nothing outside this module reads or writes these.

## Imports (deployment must supply)
| Service | Required/optional | Local default for tests |
|---|---|---|

## Exports (host-wide subsystems this module owns — usually none)

## Plugin surface (only if it reaches external systems)
- Module-facing interface(s): e.g. `Biller { pay(...) }`
- Stays in the module (same for every system): retry policy, record of sent/received, mapping into module vocabulary
- Goes in each connector (differs per system): auth, payload shape, system-specific failures
- Hook placement: <last → plugins may replace module defaults | mid → they may not>
- Behaviour with no connector installed: explicit refusal `<code>`

## Calls to other modules (via their typed clients)
| Module.Request | Why | Consistency plan (check → invoke → commit → reconcile) |
|---|---|---|

## Published events (topics) — the translated, public facts
| Topic | Payload fields | Emitted when |
|---|---|---|

## Consumed events
| Topic | Handler | Idempotent by |
|---|---|---|

## Background jobs (declared; a host must be told to run them)

## Settings (durable configuration — not secrets)

## Open questions / costs accepted
