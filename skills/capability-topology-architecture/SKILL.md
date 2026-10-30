---
name: capability-topology-architecture
description: Design, build, review and migrate backend systems using Capability Topology Architecture (CTA, also called Cell-Based Architecture / CBANS) — capabilities built once as modules that own their data, composed into hosts at deployment time, so one codebase runs monolithic, distributed or mixed without changing a module. Use this skill whenever the user is designing a backend, splitting or merging services, choosing monolith vs microservices, drawing module/service boundaries, building a modular monolith, writing handlers/commands/queries, adding plugins/connectors for external systems (billers, payment providers, SMS, KYC), planning a migration off duplicated logic across services, or asks for an architecture review — even if they never name CTA. Also use when the user mentions modules, hosts, contracts, topology, location transparency, outbox, approval gates, or the cbans.netlify.app docs.
---

# Capability Topology Architecture (CTA)

Source: https://cbans.netlify.app (all 34 pages distilled here). This skill turns that documentation into a working method for building backend systems in any language.

## The one sentence

**Capability boundaries and deployment boundaries are two decisions. Keep them apart.**

Microservices weld them: one line in one design meeting decides both *what belongs together* and *what runs together*. The result is three symptoms — one change lands in several services; teams can't ship independently; no service can be deployed in part. Splitting further multiplies the copies; consolidating restores the release train. Both turn the same dial. CTA removes the dial.

## The six words (use them with exactly these meanings)

| Word | Meaning |
|---|---|
| **Module** | One capability, defined once. The *only* unit. Owns its container, its data, its contracts. Teams own modules, not hosts. |
| **Host** | A deployable process = a list of modules + a few deployment choices. No templates, no scaffolding. |
| **Contract** | A named, typed request one module answers for another. Says nothing about where either runs. |
| **Plugin** | What a deployment installs into a module to complete it. One plugin reaches one external system. |
| **Provider** | A system supplying a capability to someone else (e.g. a biller; or a deployment offering a plugin family). |
| **Topology** | Per host: which modules it composes + an address for every module it doesn't. Configuration, not code. |

## The architecture = three properties + one guarantee

1. **Boundaries** — a module owns capability, data, dependencies, contracts. Nothing reaches inside. Only two dependency seams: **import** (deployment supplies something the module declared) and **export** (rare: module installs a host-wide subsystem it owns). Cross-module calls go through contracts; async crossings go through published events.
2. **Composition** — a module ships as a capability *shape* with a declared, typed hole (its **plugin surface**). The deployment fills it. Same code → different product (utility bills vs airtime top-up) by installing a different connector family. No fork, no flag.
3. **Topology** — which modules run where is configuration, chosen late, per deployment, changed freely.
4. **Location transparency** (the guarantee under topology) — a call names *the module and the request, never an address*. In-process when co-located (no serialization), HTTP/RPC when remote, chosen by topology. Without this, topology is a setting that changes code.

**Test for "is this architecture or just runtime?"** — *If a different runtime implemented this without it, would capability and deployment boundaries weld back together?* Yes → architecture (non-negotiable). No → runtime convenience (replaceable). Everything else — approvals, event sourcing, scheduling, workflow, durable settings — is runtime. **A team can adopt the architecture and reject the platform.**

## Obligations the architecture forces (never skip these)

Because a module owns its data, **no transaction spans two modules**. Therefore:
1. A fact leaving a module is published **in the same commit** as the change (transactional outbox or equivalent).
2. Delivery is **at-least-once** → every consumer and every holdable/retryable request must be **idempotent via its own already-done check** (not an in-memory dedupe cache — it dies in exactly the restart that causes the re-drive).
3. **Somebody reconciles** when step 2 commits and step 1 later fails. This is staffed application work.

Cross-module write pattern: *check locally → invoke neighbour (it commits on its own) → commit locally → reconcile on failure.*

## How to work — pick the mode that matches the request

### A. Designing a new backend
1. Run the fit test (`references/fit-and-alternatives.md`): *do you have capabilities whose deployment shape you'd like to decide separately from what they do?* A single team, single product, deployed one way, pays the up-front cost and collects no return — say so honestly, and still recommend the cheap parts (module boundaries + operation seam) as a modular monolith.
2. List capabilities, not services. For each rule shared by several products (limits, charges, fees, KYC, signatures, notifications), ask: *where does the way a request **consumes** this rule live?* That consumption is a capability — give it a module.
3. For each module fill the design template (`templates/module-design.md`): name, contracts (commands + queries + results + refusal codes), owned data, imports (required/optional), exports, plugin surface (if it reaches external systems), published events (topics), permissions + approval scopes, jobs.
4. Decide plugin surfaces: split what's the same for every external system (retry, audit of sent/received, mapping into module vocabulary → **module**) from what differs (auth, payload shape, system-specific failures → **plugin**).
5. Start with **one host composing everything** (monolith is a legitimate destination, and the best dev loop). Write the topology so moving a module later is a list edit + an address. Use `templates/host-topology.md`.
6. Write the cross-module consistency plan: every multi-module flow gets outbox + idempotency key + reconciler.

### B. Building a module (code)
Read `references/building-modules.md`, then `references/language-patterns.md` for the user's stack. A module is **five declarations**: name, contracts, handlers, imports, mapped surface. Non-negotiables in code:
- One folder per use case: request, result, operation interface, handler, tests. Handlers and operations internal; only requests/results/module declaration/typed client public.
- **Handler depends on exactly one thing: its use case's own operation interface** (the operation seam). Same for reads.
- **Refusals are returned values** (stable code + retryable flag), never thrown. Exceptions are for bugs only.
- Permissions and approval scopes are **declared on the request**, not checked in the handler.
- Imports applied **after** module configures itself → deployment's implementation displaces the module's local default (keep in-memory fakes as defaults for tests; never branch on which you got).
- Missing required import → **host refuses to start**, naming module *and* service.
- Callers use the neighbour's **typed client**, which ships in the neighbour's contract package and calls `transport.send(ModuleName, request)`.

### C. Building the request pipeline (if no runtime exists)
Order is load-bearing (`references/runtime-mechanics.md`):
**resolve handler → validate (short-circuit) → authorize/permission (short-circuit) → behaviour chain [outer behaviours such as telemetry, tenancy, dedupe (registration order) → approval gate (always innermost behaviour) → unit of work → handler]**.
Validation and permission are **not behaviours** and run before any gate records the request. Reads take a shorter path (resolve → behaviours) — **no permission check**, so restrict reads at the edge that exposes them. Remote requests run the identical pipeline.

### D. Deploying / changing topology
Moving a module = three edits, zero module code: new host lists it and exposes transport; old host drops it; old host gets the address in config. Before moving, check the three bites: chatty call patterns (loops) become expensive; remote calls half-succeed → idempotency; a missing topology entry fails at first call, not startup — verify the address book by hand. Cross-host contracts change **additively only**; breaking change = a second contract beside the first until callers move.

### E. Reviewing an existing codebase or design
Run `scripts/cta_boundary_check.py` if code is available (heuristic static check), then walk the 15 conformance rules in `references/conformance-rules.md`, each with its falsifier. Report with `templates/review-report.md`. Always check the two obligations no checker can discharge (idempotent held requests; reconciliation).

### F. Migrating from duplicated microservices
Follow `references/migration-playbook.md`: pick the capability the change history points at (same rule implemented in several services, most change traffic, reachable callers) → 1 name it & reconcile data → 2 build once behind a contract → 3 route callers (one line each, compare side-by-side) → 4 retire copies one at a time → 5 **only now** consider moving it. Being able to stop after stage 4 forever is the point. Kill signal at ~day 70: count request fields that exist only to tell one caller from another (0 good, 1 conversation, 2+ = the duplication was coincidence; stop).

## Red flags to call out immediately
- A call site containing a URL, serializer, timeout, retry policy, or transport name → location leak (rule 3).
- A module importing another module's internals / querying its tables / cross-module JOIN → boundary breach (rules 2, 5).
- One transaction or ambient/distributed transaction across two modules' stores (rule 6).
- `if (provider == "X")` / naming a plugin family inside a module; a default connector registered inside the module (rule 10).
- A header/field like `skipApproval`, `isAdmin`, `bypass` that changes gating (rule 9).
- Validation placed inside the behaviour chain after the approval gate (rule 11).
- Thrown domain exceptions crossing module boundaries (rule 15).
- A host that runs jobs without being told to; several hosts with different schedule stores (rule 13).
- Write + message publish not in one commit (rule 7).
- "Shared contracts" project every module depends on (contracts live beside the module that answers them).
- A per-host settings cache with TTL (must be shared and invalidated on change).

## Honesty rules for this skill
- State costs where you make choices: plugin surfaces must be designed up front (first module is slower); reconciliation is your work; cross-host releases need additive contracts; shared modules mean shared releases across subsidiaries.
- The `references/next-runtime-design.md` material (WIT contracts, Wasm components, slices, sockets, placement constraints, detached triggers, `cta` CLI) is a **proposed, unbuilt design** — present it as such.
- Don't claim CTA is easier overall; claim the difficulty moves from operations-forever to design-once.

## Reference map (read only what the task needs)
| File | Read when |
|---|---|
| `references/architecture.md` | Explaining/justifying the design; boundaries, composition, location transparency, topology in depth |
| `references/runtime-mechanics.md` | Implementing pipeline, governance/approvals, outbox/messaging, event sourcing, projections, real-time signals, settings, scheduling, workflow |
| `references/building-modules.md` | Writing module/plugin/host code (reference .NET code from the docs) |
| `references/language-patterns.md` | Implementing in TypeScript/Node, Python, Go, Java/Kotlin, Dart — minimal runtime sketch |
| `references/conformance-rules.md` | Any review, audit, PR check, or "is this conformant?" |
| `references/migration-playbook.md` | Migrating existing services; 90-day plan; back-out costs |
| `references/fit-and-alternatives.md` | "Should we use this?", comparisons with Service Weaver, Polylith, Dapr, iii |
| `references/next-runtime-design.md` | Polyglot/Wasm, manifests, slices, sockets, placement constraints, triggers (unbuilt) |
| `templates/*.md` | Producing a module design, host topology, or review report |
| `assets/ts-minimal-runtime/` | Need working code to copy or show: zero-dependency TS runtime + demo (`node demo.ts`, Node ≥ 22.18) proving monolith and split give identical results and refusals |
| `scripts/cta_boundary_check.py <modules_dir>` | Any review with code present: heuristic scan for rules 2, 3, 5, 6, 9, 10 (exit 1 on High) |
