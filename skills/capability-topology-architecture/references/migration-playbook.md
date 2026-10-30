# Migration Playbook and the First Ninety Days

Source: Adopting it (migration, first ninety days, what it asks of a team).

The move is **not a rewrite**: one capability at a time — build it once as a module, point existing services at it, delete each service's copy. Services keep their hosts, repos, pipelines, owners. Finishing with the same services you started with is the intended result.

## Choosing the first capability
Read it off the change history: the capability where **the same rule** is implemented, changed and tested in several services.
- Prefer the duplicate with the **most change traffic** (return must be measurable within a quarter).
- Prefer one whose **callers you can reach** (stage 3 needs one code change per caller; unasked teams wait for the next increment).
- Avoid the worst, most entangled thing you own — it tests patience, not the architecture.

Worked example: **Charges** (how a fee is worked out), duplicated in Bills Payment, Bank Transfer, Mobile Money. International Transfer also has a copy but its team hasn't been asked — excluded.

## Five stages
1. **Name it and what it owns.** On paper: responsibility, data, requests. Hardest part = **data reconciliation**: the copies' tables have drifted; decide field by field whose data is authoritative (a business decision). Deliverables: request list + written authority decision.
2. **Build it once, behind a contract.** Own handlers, operation seam, own store. Tests run on local stand-ins (imports override later). Needs a host on day one: add to an existing host or a small own host — a config line, revisable. Not stage 5's question.
3. **Route the existing services' calls to it.** One changed line per caller, naming module + request only. Composed → in-process; not composed → transport via one topology entry. Callers ship in normal releases; nothing moves, splits, merges, gains a pipeline. **Run side by side and compare** the module's answer to the local copy in production — finds where copies diverged.
4. **Retire duplicates one at a time.** Delete the copy and its tests (deleted, not deprecated — a copy that compiles gets edited). Each deletion is when that service's behaviour becomes the module's. When the last goes, the rule changes once. The module's team now **owns** the rule; callers stop having an opinion — an organisational change.
5. **Only now, consider moving it.** With evidence: change frequency vs callers, independent scaling, compliance/ownership boundary, how chatty callers are. "Not yet" / "not ever" are legitimate. Move = list edit + address.

Why stage 5 is last: leading with re-deployment would put the weld back into the migration plan. **Being able to stop after stage 4 indefinitely is what the architecture is for.** If the benefit only appears after moving the module, look at the call sites — one names an address.

## Costs to budget
- **Reconciliation** across modules — staffed work.
- **Idempotency** of holdable/retryable requests — a review habit every time, invisible to type systems.
- **Stage 1 data reconciliation** takes longest; code is the smaller half.
- Twelve duplicated capabilities = twelve of these (the second is cheaper; it's still a repetition). Multiplying the first module's cost by twelve is planning a rewrite.

## The first ninety days (one team, one capability, one quarter)
Team: 3–5 engineers, **one named capability owner from day 1**, at least one engineer with commit rights in each calling service.

| Days | Work | Done when |
|---|---|---|
| 1–15 | Design: name, requests (quote "what would this cost?", charge "apply it", read "what was charged?"), owned data (fee schedule + record of every fee applied). Put the three fee tables side by side, decide every disagreement. | Request list + written field-by-field decisions |
| 16–45 | Build: the quiet four weeks. Handlers on operation seam; tests with no DB. Pipeline order and approvals come from the runtime ("fee above X needs a second pair of eyes" = a line on the request). Pick a host. | Charges answers its 3 requests in a running host, tests green |
| 46–75 | Wire up: add to module list; callers switch to `send(Charges, request)`. Compare answers in production. | Two services calling Charges in prod, copies still present, written record of every differing answer |
| 76–90 | Delete the copy in the service you're most confident about. | One duplicate gone; Charges carrying real traffic for one service |

Day-90 checks (binary, checkable):
1. Next fee-rule change touches only the module.
2. No caller names an address (including remote callers).
3. One copy **deleted**, not deprecated.
4. Same services, repos, pipelines, owners, hosts as day 1 (+ at most one small host).
Not on the list: latency, throughput, cost, host count — those are stage 5.

**Kill signal — check around day 70**: open the module's request type and count fields that exist only to tell one caller from another.
| Fields naming a caller | Meaning |
|---|---|
| 0 | What the approach predicts |
| 1 | A conversation |
| 2 | Each caller needed its own variant → the duplication was coincidental resemblance; the diagnosis doesn't apply; stop |

Back-out costs:
| Caller state | Cost |
|---|---|
| Never routed | Nothing |
| Routed, copy kept | Restore one call line |
| Routed, copy deleted | Restore from history + re-test: days |
Data reconciliation survives either way. Worst case spend: one team-quarter, and a specific answer.

Deliberately **not** in the first 90 days: a second module; moving anything between hosts; a platform team; rolling governance out everywhere (which requests need sign-off is an organisational decision).

## What it asks of a team
Three ideas to hold: what a module owns (reach it by asking); a module ships incomplete on purpose (differences go in plugins, not branches); shape is a separate decision (calls never name addresses).
Looks new but isn't: requests/handlers (naming), isolated container (one rule), operation interface (the seam for DB-free tests), composition lists/topology (config files).
Genuinely new habit: **every governed/holdable request must be safe to run twice** — a review question every time.
Compared with microservices: the difficulty moves from operational work spread across every service forever, to design work at a boundary done once in an editor. Not "easier in total".
Asks of the organisation: one owner per capability who answers for the rule.
