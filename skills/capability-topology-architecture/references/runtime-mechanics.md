# Runtime Mechanics

Source: "What the runtime brings" (mechanics 00–04) and "What the runtime provides". These are **runtime**, not architecture — but if you are building without the reference runtime, these are the shapes to copy, including the traps.

## Contents
1. Request pipeline
2. Governance (permissions, approvals, bypass)
3. Data & messaging (ownership, no distributed tx, events, outbox, real-time)
4. Event sourcing, projections, replay
5. Operation seam
6. Durable configuration
7. Scheduling
8. Workflow
9. Capability checklist (14 areas)

---

## 1. Request pipeline

Two request kinds: **commands** (change something; full pipeline) and **queries** (read; short path). Only declared requests are addressable.

Command path, in this exact order:
1. **Resolve handler** in the owning module's container. Undeclared → boundary error, before any machinery (a request reaching the wrong host is told plainly).
2. **Validate** — all validators, registration order, first refusal returns.
3. **Authorize** — same shape; declared **permission** checked here.
4. **Behaviour chain** — wraps the call. Registration order = nesting: first registered = outermost. Telemetry, tenancy, de-duplication, **approval gate** (innermost behaviour).
5. **Unit of work** — innermost of all; the handler runs inside the transaction. Always present (a no-op UoW when no store) so the shape never varies.

**Validation and authorization are NOT behaviours.** They can't be moved into the chain. Consequence: a refused request never reaches a gate, is never recorded as awaiting decision, never remembered by dedupe, never opens a transaction.
- Validation inside the chain → approval queue fills with requests that can never succeed (silently).
- Gate before authorization → unauthorized callers can put work in front of approvers.

Limits:
- Registration order is the only ordering (no priorities, no dependency declarations, nothing checks it). Swap two lines, silently swap runtime order.
- Validators see the request, not the world — data read in validation may change before the handler; write-time invariants belong in the **operation** (inside the transaction).
- Chain is per module; "the pipeline" is a shape, not one object.

Query path: resolve → behaviours → handler. **No validation, no permission check, no transaction.** A read that must be restricted is restricted at the edge that exposes it. Assuming symmetry builds an unguarded read path.

Remote requests run the same five steps in the target module; no thinner remote path.

## 2. Governance

A request declares two independent things:
- **Permission** — *may this caller ask?* Checked in authorization, before anything records the attempt.
- **Approval scope** — *has someone else agreed?* Names a *family* of decisions ("release a payment above its limit", "register a biller"). Policy is written per scope, so new requests in an existing family inherit the rule. Money-moving requests usually declare both.

**The gate holds; it does not queue.** First time, it stores the request content, scope and enough context to run it later, and returns a **transient refusal** (may succeed later without change). Decision can happen in another host, another hour; the captured request is what runs.

Placement: gate is the **innermost behaviour**; only the transaction is below it. Dedupe and tenancy run *before* anyone decides; a cleared decision goes straight into the transaction.

Policies (resolved per scope; a policy answers two questions: *may this decision from this person be recorded?* and *is the request now approved?*):
| Policy | Satisfied by |
|---|---|
| Ordered permission chain | One approval per named permission, in order; a decision from someone lacking the current step's permission is refused outright |
| Ordered role chain | Same, keyed on roles |
| Single approver | One approval from anyone entitled |

**Unconfigured scope**: framework default is "one approval from anyone" (dangerous — looks identical to deliberate config). The governance module replaces it with two refusals, **on by default**: host refuses to start if a reachable governed request's scope has no chain (naming the scope); any decision on an unconfigured-scope record is refused and it stays pending. Deployment safe by default; architecture is not — know which you're relying on.

**Controlled bypass** (for jobs/consumers with no user):
- Entered by the dispatching code; **never** requested by any field/header/param.
- Names which gate (approval vs permission stood down separately).
- Only policy gates; validation, dedupe, unit of work can never be stood down (correctness, not policy).
- Additive and restoring; nested dispatch inherits, can't re-gate caller or leave a gate open.
- Submitter becomes approver; which path the request arrived on is the record. At the edge: one request, two exposures — governed, and bypass with its own distinct permission.

Trap: two gate implementations (result-returning vs void requests). Change one, not the other → governance depends on return type. Test both.

Cannot do: a two-step chain where one person holds both permissions has one participant. **A held request may run more than once** (different host applies decision; at-least-once) → the request's own already-done check is required; the in-memory dedupe cache dies in the restart that causes the second run. Nothing checks this.

## 3. Data & messaging

**Ownership is structural**: storage definitions live inside the module and aren't referenceable by others — a sibling can't write the query because it can't name the thing. Own schema, migrations, connection; shared server OK. No cross-module joins.

**No distributed transactions** — a constraint imposed, not a problem solved. Flow: (1) module A checks, (2) calls B which commits, (3) A commits, (4) if 3 fails, nothing rolls back 2 → **reconcile**. B's request must be repeatable so "run it again" is safe. Accurate claim: a distributed tx is **not reachable by accident** — modules get a single-connection UoW; swapping to an ambient-transaction UoW is a visible line in that module's wiring. Cross-module calls inside an ambient transaction are refused outright.

**Two kinds of event**:
- **Domain events** — internal vocabulary, build own read models, never leave.
- **Published (integration) events** — facts others may act on. A **translation step** chooses which domain events become published facts, so internals can restructure silently.

Matching is by **topic** (string), consumer holds its own payload description; no shared compiled artifact required (allowed as convenience when shipping together). Additive changes safe; removals invisible until runtime → anything non-additive needs a new topic.

**Change + messages commit together** (outbox): messages collected during the request, written in the same transaction.
- Same DB as messaging store → hand messages to the messaging layer on the same transaction.
- Different DBs → write rows to the module's own DB in the same tx, relay later.
- Nowhere to stage rows → **commit refused**, saying what to add (never silently falls back).
Guarantee is about commit, not delivery; delivery is at-least-once → consumers idempotent.

**Real-time to browsers**: host tails each module's outbox from a saved position and broadcasts a small signal: **module, event kind, correlation id, timestamp — not the change**. Client re-reads through the normal read path (normal permission checks). Safe to broadcast to all. Limits: arrives on an interval after commit; can't address one user (do that in application code after refetch). Transport (held connection vs SSE-like stream) is a deployment choice.

Handed back to you: **reconciliation**; and **writes outside a request** (consumer saving directly) have no UoW → nothing commits alongside; fine for record-only consumers, wrong the moment that consumer needs to publish — and nothing warns.

## 4. Event sourcing, projections, replay

- **Event sourcing**: aggregate raises an event instead of changing a row; repository appends; state rebuilt from events. Store is the module's data.
- **Projections**: read models updated **inside the transaction** appending the events — no window between.
- **Replay**: batch runner reads event store forward from a stored position, dispatches to projections, saves position. Where the position lives is the module's decision; if none, refuse **by name** (module, missing store, two ways to supply one).

## 5. Operation seam

Rule: **a handler depends on exactly one thing — an operation interface its own use case declares**, in the use case's words, implemented on the other side where storage and network live. One per use case, not a general storage abstraction. Handler body ≈ unpack → call operation → return.

Cross-module calls are behind the operation too, so the handler never learns local vs remote.

Why: one stand-in per test, no container, no DB; keeps infrastructure out of the pipeline (handler is innermost, inside every behaviour); storage choices don't spread; preconditions live where every entry point (endpoint, job, consumer) passes.

Applies to **reads too** (most-skipped part; then every read holds a DB session and the seam is gone for a third of the code).

Honesty: it's a **convention held by review**; nothing refuses a second dependency. Make it the easy path: interface lives in the use-case folder beside request and handler.

## 6. Durable configuration

- Settings in a store **layered over** config files: unedited keys come from file; first operator edit moves that one key to the store. No migration step. Takes effect without restart, survives restart.
- A **schema per settings group**, derived from the same declaration (key, type, editable?, permitted values/bounds) → generic editor UI + validation; adding a setting adds it to the editor.
- Cache **shared across hosts and cleared on change** — never a per-host TTL cache (looks like "the change didn't work" on other hosts).
- Configuration, **not secrets**.

## 7. Scheduling

- Modules **declare** jobs; installing the runner is a host choice (`RunsScheduledJobs(store)`). No host told → jobs never run. Several hosts → all must name the **same schedule store**.
- **Occurrence** = one scheduled instant of one job.
- **Claim in one conditional write** → one winner.
- **Lease** renewed while working; expires if host dies.
- **Only a completed run advances next-due** (written with the outcome). Advancing on claim → a crash silently skips a run.
- Run record: started/finished, success, summary, skipped-occurrence count, consecutive failures. Failures recorded as failed runs, not escaped exceptions.

## 8. Workflow

- Multi-step run recorded as events: started, one per step outcome, ended. Answers which steps succeeded, attempts each, which step stopped it and why.
- Transient step failure → retry up to a step-level or inherited limit; non-transient → stop; remaining steps don't run.
- Caller may supply the run id; history is complete enough to drive a resume — **but the runner does not resume**; it starts at step one. Build resume on the history yourself. "Event-sourced" ≠ "resumable".

## 9. The 14 capability areas (design question each answers)

Architecture (3):
1. **Composition & isolation** — two modules need different services of the same type; each gets its own.
2. **Location-transparent transport** — a call says module + request, nothing else.
3. **Topology & resilience** — four addresses, one failing: topology decides, caller doesn't.

Runtime (11):
4. **Request pipeline** — where does validate/permission/transaction order live? In the installed pipeline.
5. **Governance** — second-person agreement without per-team checks.
6. **Event sourcing** — history where current state isn't the whole answer.
7. **Integration messaging** — fact leaves without naming listeners (obligation met one way).
8. **Projections** — read model updated in the same tx.
9. **Projection replay** — rebuild from history with stored position.
10. **Real-time notifications** — signal, not payload.
11. **Operation seam** — what a handler may depend on.
12. **Durable configuration** — live, all hosts, survives restart.
13. **Scheduling** — exactly one host runs a due occurrence.
14. **Workflow** — what can be found out after step 3 fails.
