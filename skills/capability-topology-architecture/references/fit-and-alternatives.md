# Does It Fit? And the Nearest Neighbours

Source: Proposition 04–05. Status of neighbours as checked by the docs on 26 Aug 2026 — re-verify before quoting to a user.

## The underlying test
*Do you have capabilities whose deployment shape you would like to decide separately from what they do?* If no, none of this earns its cost.

## Four situations
**Several subsidiaries, each with its own shape.** One build; each composes the modules it needs in its own shape. Regulatory differences (clearing system, sanctions provider) go into **plugins**, not forks. *Stops:* subsidiaries sharing a module share its release; holding an older version means forking — release calendar becomes a group-level agreement (organisational cost; decide you want that argument before you start).

**Multi-cloud, a different shape per cloud.** Same code, different composition list and topology per cloud. *Stops:* latency (physics), residency (law), egress (commerce) don't move. Code stops being one of four obstacles.

**Monorepo with shared capabilities.** A module cannot reach into another regardless of repo — the boundary belongs to the framework, not the file tree. Repo membership ≠ deployment membership. *Stops:* has no opinion on repo layout.

**Faster or slower?** Faster once modules exist, compounding (new product = composition list; shared rule written/changed once; approvals/scheduling/settings/workflow arrive with the module). *Stops:* first module is slower (plugin surface design); retrofitting harder. A single team, single product, one deployment shape pays and collects nothing. The first ninety days is the cheap experiment.

## Neighbours

| | Unit | A call names | Two units co-located | Unit owns its data | Status (Aug 2026) |
|---|---|---|---|---|---|
| **Service Weaver** (Google) | Go component | the component | direct method call | no | archived (dev ended 5 Dec 2024) |
| **Polylith** | component/brick | nothing — you write the call | no runtime, no answer | no | active |
| **Dapr** | your service | an app id | still via sidecar | no | CNCF graduated (12 Nov 2024) |
| **iii** (Motia) | a function (`content::classify`) | the function id | still via engine (JSON) | not stated | active; engine under Elastic License 2.0 |
| **CTA** | a module | module + request | direct call, no serialization | **yes, no tx spans two** | one runtime, unproven outside |

Per neighbour:
- **Service Weaver** — same claim (modular binary split by deployment). Better: zero contract work (plain Go method calls). Weaker: no data ownership. Died of adoption cost: required rewriting large parts of apps. CTA's answer is incremental migration — unproven externally.
- **Polylith** — same composition model (project = base + bricks ≈ host = list of modules). Better: much lighter, no runtime; excellent "development project" (all bricks in one dev experience). Weaker: no runtime → cross-deployable calls are yours to write at every site; no data boundary.
- **Dapr** — the runtime with no opinion on boundaries; sidecar, language-agnostic, rich building blocks (invocation, state, pub/sub, bindings, actors, secrets, config, locks, workflows, jobs, crypto). Better for polyglot estates, no in-process framework. Can't collapse two services into one process.
- **iii** — Function/Trigger/Worker, engine routes invocations; independently reached location transparency. Better: genuinely polyglot (Node, Python, Rust, browser), great onboarding (`iii worker add queue`). Weaker for this goal: every call mediated + serialized → no monolith end; data ownership not stated.

What CTA uniquely claims: the combination, plus **a module owns its data and no transaction spans two**, plus **the same call resolves in-process when co-located and over the network when not**, call site unchanged.

Could you use Polylith + Dapr? Mostly yes. You'd still build: in-process-when-co-located resolution; and the boundary rule as enforcement rather than review convention.

## When to recommend something else
- Polyglot estate / no framework in process → **Dapr**.
- Composition discipline with no runtime (esp. Clojure) → **Polylith**.
- Real problem is cross-language integration cost → **iii**.
- Go + automatic splitting with no contracts → was Service Weaver; archived — a closed road.

Honest reading: an in-process runtime buys the co-located call by giving up the language boundary (the "next runtime" design proposes Wasm components to break that trade — unbuilt).

## Pragmatic advice for small teams (adaptation)
Even when full CTA doesn't fit, these cheap parts pay off immediately in a single-deployable app: module folders with a public contract and private internals; per-module schemas; operation seam; returned refusals; outbox for any external side effect. They keep the door open to topology later at near-zero cost.
