# The Architecture in Depth

Source pages: Proposition (00–03), Architecture (00–05) at cbans.netlify.app.

## Contents
1. The diagnosis
2. Why the usual answers fail
3. Boundaries
4. Composition
5. Location transparency
6. Topology
7. Where the architecture ends

---

## 1. The diagnosis

Running example: a bank with four payment products — **Bills Payment**, **Mobile Money**, **Bank Transfer**, **International Transfer**. Different traffic, owners, regulation. Deploying them independently was *right*.

Then shared rules arrive: transaction limits, charges, payment signatures, beneficiary cool-off, approval above threshold, fraud screening, validation. A regulator changes the daily ceiling for unverified customers → four teams implement it four ways, ship on four schedules, drift. **The bank can no longer say what its transaction limit is without reading four codebases.**

What got copied was **not the limit** (the limit may legitimately live in another team's service). What got copied is **how a payment has the rule applied to it**: fetching the ceiling, reading the tier, deciding what counts against today's total, what to do on timeout. That consumption is a capability of Payments that had no home.

Two different questions were answered with one line:
- **What belongs together?** (responsibility; where a rule lives)
- **What runs together?** (ships, scales, restarts as a unit)

Three symptoms of the weld:
1. One change lands in several services.
2. Teams can't ship on their own schedule ("independent" was defined by repository, not by capability).
3. No service can be deployed in part (it scales as one lump).

Not a payments problem: lending (affordability/disclosure), trading (pre-trade checks), claims (eligibility/fraud) — anywhere several deployables satisfy the same rules.

## 2. Why the usual answers fail

- **Split further**: multiplies places a rule *can* live, not places it *must* live. Four copies become seven.
- **Consolidate**: one home for the rule, but every team is back on a shared release train.
- Both treat capability and deployment as one dial. Release ceremony (calendars, trains, coordination meetings) makes coupling easier to live with without moving it.

Symptom 2 is produced by 1 and 3; cure those and it goes.

## 3. Boundaries

A module owns three unshared things:
- **Its own dependency container.** Separate object; no reference to host's or siblings' container. Two modules can register different implementations of the same interface.
- **Its own data.** Nothing else reads or writes it. Sharing a DB *server* is fine; sharing a *schema* is not. The boundary is about who may issue the query.
- **Its own contracts.** Declared by the owner, in its terms. Anything undeclared is *unreachable*, not discouraged.

Rule: **nothing reaches inside another module.**

Exactly two dependency seams:
- **Import** — module declares "this deployment must give me one of these" (a type, not a lookup; it never sees the host container). Can be **optional**.
- **Export** — module registers a host-wide subsystem it owns (e.g. approvals store). Rare. Never a way to publish state; if you reach for it to share data, the boundary is wrong.

The other two crossings (not dependency seams): typed contract calls; published events.

**Import order is load-bearing**: imports are applied *after* the module configures itself; last registration wins → deployment displaces the module's default. Module ships an in-memory/fake default so tests run with nothing else present; it never branches on which one it got. Optional imports wire only when the host registers that type, otherwise the fallback stays.

**What a deployment owes a module**: every required import is resolved at host start; missing → startup refusal naming module and service. Not opt-in, not per-environment.

What it buys: a shared rule changes in one place; blast radius = the contract; tests need one module; the boundary doesn't erode because reaching around it is impossible, not merely reviewed against.

## 4. Composition

A module ships as a **capability shape** with a typed hole — its **plugin surface**. Plugins = connectors, one per external system.

Mechanism:
1. Module *declares* it has a surface (most don't). Undeclared → nothing to fill.
2. Host declares, next to the module, which plugin family goes in.
3. Plugins register into the module's own container. Contracts, handlers, data unchanged; only the set of reachable external systems changes.

Bills Payment: "take an instruction to pay a bill, apply payment rules, reach the biller, record what was sent and what came back." Utility connectors → utility bills service. Airtime connectors → airtime top-up service. Reaching an external system is the one part of a payment type that can't be built once; that's what the hole is for.

Buys: one implementation of shared capability; new product = new list, not fork; variation lives at the edge.

Cost: the surface must be designed up front — deciding what's the same for every external system vs not. Retrofitting is harder. The architecture gives a target shape, not a shortcut.

## 5. Location transparency

A **contract** = named request + named fields → named result. It omits: address, transport, serializer, timeout, retry, auth plumbing. The route comes from **topology**.

Three transports (a deployment's choice, never a caller's):
- **In-process** — target composed in this host. Request object handed to that module's dispatcher in a fresh scope from its container. **No serialization.** This is what makes the monolith genuinely cheap.
- **HTTP** — serialize, post to the other host's module endpoint, dispatch, return. Caller code unchanged.
- **RPC** — same shape, binary protocol.

Selection: caller asks for "whichever is right" → optional route policy preference → topology settles (composed → in-process; not composed → configured transport). A caller *may* force a transport for diagnostics; doing it routinely gives everything back.

Without it: moving a module is a rewrite at every call site (address, serializer, timeout, retry, error path, test double, response envelope) — the most-used modules are the most expensive to move.

What it does **not** do (it hides the call, not the network):
- Remote calls time out, half-succeed, arrive twice → request must be idempotent (module's job).
- Remote calls cost more → a query in a loop is fine in-host, a problem across a network.
- A cross-module call is never part of the other module's transaction → consistency = repeatable second request + reconciliation.

"The caller does not need to know" is true; "there is nothing to know" is never true.

## 6. Topology

Two questions, configuration only:
1. Which modules does this host compose?
2. Where does everything else live (an address per non-composed module)?

Three arrangements of one system:
- **All in one host** — monolith; legitimate destination (on-prem, single-tenant, laptop, tests).
- **Fully split** — one module per host.
- **Hybrid** — the normal case: quiet modules share; a peak-carrying module with different cadence gets its own; a differently-regulated one gets its own.

Shared modules (Payment Rules, Charges) are *composed* by every host by default — that's what stops the rule being per-rail. A deployment may instead run Charges remotely (one fee history, scaled alone). Both legal; no call site differs. A rail that knows whether Charges is local has leaked a deployment fact. Request context carries identity, tenant, correlation — **no deployment facts**.

Decision is **late** (on evidence), **cheap to revise** (move a name, add an address), **per deployment** (same build, different shapes per customer).

Topology also carries: multiple instances per module; discovery with static fallback; failing addresses removed from rotation and probed back.

Doesn't decide: whether a call is wise at distance; idempotency; **release decoupling**. Routing is by contract type; rolling deploys put hosts at different versions → cross-host contracts change **additively** (new fields optional; nothing renamed/removed/re-meant). Non-additive → second contract beside the first, both answered until callers move. Skip that and hosts must ship together.

## 7. Where the architecture ends

Architecture = Boundaries + Composition + Topology + (call names module & request, never address).

Obligated, mechanism unspecified: reliable publication in the same commit; at-least-once delivery → idempotent receivers; reconciliation. Outbox, an equivalent-guarantee broker, or an existing trusted platform all qualify. Declining the obligation does not.

Runtime-only (fail the test, replaceable): approvals, event sourcing, projections & replay, real-time notification, durable settings, scheduling, workflow. Judge a runtime on whether it meets the obligations, not whether it meets them this way.
