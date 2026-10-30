# Designing the Next Runtime (PROPOSED — NOT BUILT)

Source: "Designing the next runtime" tier (8 pages). **Everything here is a proposed design.** Only one measurement has been done. Present it to users as an argument, not a capability.

## Borrowed mechanisms
| From | Mechanism | Why |
|---|---|---|
| Service Weaver | Colocation groups | Placement wants to express *why* things are together, more granular than a host list |
| Polylith | Bricks + development project | Modules assembled from parts; one monolithic dev experience |
| Dapr | Pluggable components behind stable contracts | Runtime capabilities become sockets, not wired decisions |
| iii | Function / trigger / worker + manifest | Separate *what runs* from *what causes it to run* |
| wasmCloud | Components over a lattice + capability providers | Proof a component runtime can be polyglot and distributed |
| WebAssembly Component Model | **WIT** (language-neutral IDL), worlds (exports/imports), **WAC** `plug` | The socket/plug mechanism, specified, cross-language |

Not borrowed: iii/Dapr mediated invocation (kills the co-located call); wasmCloud stateless components (kills data ownership); Weaver's automatic placement (separate, large project).

## 1. Contract in a neutral IDL (WIT)
```wit
package payments:rules@1.0.0;

interface limits {
    record payment {
        customer: string,
        amount-minor: u64,
        currency: string,
        captured-at: string,
    }

    variant refusal {
        over-daily-ceiling(u64),
        tier-unknown,
        source-unavailable,
    }

    apply-daily-ceiling: func(p: payment) -> result<_, refusal>;
}

world payment-rules {
    export limits;
    import ceiling-source;
}
```
One definition → native binding, component binding (Rust/Go/Python/JS/C#), and wire format. Versioned package identity makes contracts **diffable** → CI can refuse destructive cross-host changes (machinery for the additive rule).
Costs: second language for contracts; less expressive (no inheritance/generics/attributes); a build step that must fail on drift; bet on a moving spec (WASI 0.3 async).

## 2. Three ways to satisfy a contract (caller can't tell)
- **Native, in-process** — direct call (default).
- **Component, in-process** — Wasm component in any language; costs an argument/result copy, not a network hop.
- **Remote** — serialized over transport.

Measured 27 Aug 2026 (Rust guest, wasm32-wasip2, wasmtime 27; 300k iterations; small ~60-byte payload):
| Leg | Per call |
|---|---|
| Native | ~1 ns |
| Component in-process | 204–216 ns |
| Remote loopback JSON (warm) | 55,600–64,700 ns |
Component is 258–317× cheaper than remote (~5M calls/s/thread). Instantiation ~10.6 ms once; 16 KB component. Unmeasured: payload-size scaling (canonical ABI copies).

Blockers: **.NET hosts can't instantiate components today** (tooling produces components from C#, doesn't host them). WASI lacks threads; async only in 0.3; componentize-py modules 15–30 MB with slow cold starts; TinyGo GC pauses. Right for CPU-bound, self-contained modules (pricing, risk, parsers, rules engines, foreign domain code). Wrong for threads, long-lived connections, heavy I/O. Graceful degradation: can't be a component → becomes remote.
Costs: three code paths must be observably identical (run contract tests in all three modes); debugging across component boundary; traps must be translated into the same `Result`.

## 3. A module is a manifest; slices are what it's made of
Manifest declares: **owns** (store, schema, migrations), **exports** (contract), **imports** (holes), **assembled from** (slices).
**Slice** = one request + handler + data it touches + tests. Can move between modules by editing two manifests; can be shared (rarely); makes the boundary revisable.
A slice must not own data (its module does; moving it is a data migration), must not be externally addressable, must not be a deployment unit (that's microservices again).
Costs: manifest can disagree with code (build must fail); "where is this handled" becomes two steps; over-decomposition; shared slice = coupled releases. Rule: a one-slice module is normal; small manifests are four lines.

## 4. Plug and socket, all the way down
| CTA | Component Model |
|---|---|
| module with a hole | component declares an import |
| deployment fills hole | `wac plug` |
| plugin | plug component |
| module's contract | socket's exports |
| composed deployment | composed component |
Buys: declarative, checkable before start, language-neutral.
Bigger gap: runtime capabilities are wired, not plugged. Make them sockets:
```
approval-store      socket   ->  plug: durable-postgres | in-memory | your own
event-log           socket   ->  plug: marten | eventstore | your own
scheduler           socket   ->  plug: in-host | quartz | your own
integration-bus     socket   ->  plug: cap-rabbit | cap-azure | your own
```
Plug kinds: native, component, remote. **Every socket ships a default plug**; deployments declare only what they replace; no sensible default → it's a manifest decision, not a socket. Costs: graph needed at build time (limits dynamic loading); each socket is a versioned additive surface — keep the count small.

## 5. Placement is a constraint; triggers are attached
```yaml
placement:
  together:
    - [payments:rules, payments:charges]   # every rail composes both; splitting them
                                           # would put a network hop on every payment
  apart:
    - [payments:mobile-money]              # different release cadence, and it carries
                                           # the afternoon peak
  anywhere:
    - [payments:international-transfer]
```
Reason survives, checkable in CI, pairwise constraints compose; host list becomes derived. Placement stays human — no runtime solver.
```yaml
triggers:
  - http:  POST /payments/{id}/apply-rules  ->  payments:rules/apply-daily-ceiling
  - cron:  0 2 * * *                        ->  payments:rules/rebuild-tier-cache
  - queue: payment.submitted                ->  payments:rules/apply-daily-ceiling
```
Entry points become enumerable from config. Costs: constraints harder to read (tooling must print resolved list); over-constraint errors must name the unsatisfiable pair; handlers no longer show callers; **security: the function declares what it requires and no trigger can weaken it.**

## 6. Ease of use is the constraint
Service Weaver died of adoption cost. Rule: **every mechanism optional; the default path looks like today.**
| Mechanism | Opt in by | If never |
|---|---|---|
| Neutral contracts | writing `.wit` | native types |
| Component impl | building as component | all native |
| Slices | >1 slice in manifest | one-slice module |
| Sockets | naming a plug | default plug |
| Placement constraints | `together`/`apart` | host list |
| Detached triggers | declaring one | endpoint binds in code |
One dev host:
```
> cta dev
  composing 6 modules, 14 slices, native mode
  sockets on defaults: approval-store, event-log, scheduler, integration-bus
  triggers attached: 9 http, 2 cron, 3 queue
  one process, one debugger, one log stream
```
One-line composition:
```
> cta add module payments:rules       # writes a four-line manifest and a native skeleton
> cta add slice apply-daily-ceiling   # a contract stub, a handler, a failing test
> cta add trigger http POST /payments/{id}/apply-rules -> payments:rules/apply-daily-ceiling
> cta add plug approval-store durable-postgres
```
Generator output must be ordinary, hand-maintainable files. Refused shortcuts: inferring contracts from code; advisory boundary rules. Costs: surface area grows; CLI version becomes part of the build; "looks like today" must be a test (build with every mechanism declined).

## 7. Four invariants it refuses to give up
1. A module owns its data; no transaction spans two.
2. A call names module + request, never an address (all three modes invisible).
3. A co-located call resolves in-process.
4. Deployment shape is configuration (constraints resolve to a start-time topology).

The bet: component boundary is cheap enough in-process **and** the Component Model matures on schedule. If not, the residue (better contract language, slices, sockets, constraints) still stands.
Settling it: (1) boundary cost — **done, passed**; (2) a real module in another language doing real I/O; (3) a team new to it building one module with the CLI and one-host dev loop.
