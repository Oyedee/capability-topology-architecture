# Implementing CTA in Your Stack

> **This file is an adaptation, not part of the source docs.** The docs' reference runtime is .NET. The architecture is language-neutral: anything satisfying the 15 conformance rules conforms. Below is how to get there in common backend stacks, and a runnable zero-dependency TypeScript sketch in `assets/ts-minimal-runtime/`.

## The minimum you must build (if no runtime exists)

In priority order — the first four are the architecture, the rest are obligations or high-value conveniences.

1. **Module definition** — `name` (string value), `configure(builder)`, optional plugin hook.
2. **Per-module container** — a scoped DI container or a plain map of factories per module. Never one global container shared by modules.
3. **Host builder** — list of modules → configure each → apply exports → apply imports *after* configure → **refuse start on missing required imports, naming module + service** → build transport.
4. **Transport + topology** — `send(moduleName, request, ctx)`; in-process when composed (pass the object, no serialization), else HTTP/RPC to the configured address; one `/modules/{name}/execute` endpoint per host that opts in.
5. **Result type** with `{code, message, retryable}` refusals. No domain exceptions across modules.
6. **Pipeline** — resolve → validate → authorize → behaviours (approval gate innermost) → unit of work → handler. Queries: resolve → behaviours → handler.
7. **Outbox** — messages written in the same DB transaction as the state change; relay process; idempotent consumers keyed by message id.
8. **Idempotency store** per module (durable "already-done" by idempotency key/payment id).
9. **Reconciler** per multi-module flow (scheduled job comparing both sides; re-drives the idempotent step).

Defer until you need them: event sourcing, projections/replay, durable settings, workflow engine, real-time signals.

## Folder layout (any language)

```
src/
  modules/
    charges/
      contract/                 # PUBLIC: requests, results, refusal codes, typed client, module name
        apply-charge.ts
        charges-client.ts
      use-cases/
        apply-charge/           # one folder per use case
          handler.ts            # depends ONLY on operation.ts's interface
          operation.ts          # interface declared by this use case
          operation.impl.ts     # storage/outbound side of the seam
          validator.ts
          handler.test.ts       # one stand-in, no DB
      store/                    # schema, migrations — private to module
      module.ts                 # the five declarations
    bills-payment/
      contract/ ...
      plugins/                  # connector interfaces the module owns (IBiller)
      module.ts
  connectors/                   # plugin implementations, one external system each
    airtime-mtn/
    electricity-ikedc/
  hosts/
    payments-api.ts             # list of modules + plugins + deployment choices
    charges-api.ts
config/
  payments-api.topology.json    # addresses for non-composed modules
```

Enforce "nothing reaches inside" with tooling, not review:
- **TypeScript**: package `exports` per module (only `contract/` exported) in a pnpm/Nx/Turborepo workspace; ESLint `no-restricted-imports` or `eslint-plugin-boundaries`; Nx `enforce-module-boundaries`.
- **Python**: `import-linter` contracts (`forbidden`/`independence`) between `modules.*` packages; only `modules.x.contract` importable.
- **Go**: put internals under `modules/x/internal/` — the compiler forbids imports from outside `modules/x`.
- **Java/Kotlin**: Gradle/Maven module per CTA module with `api`/`implementation` separation, JPMS `exports` of the contract package only, or **Spring Modulith** (`ApplicationModules.verify()`), plus ArchUnit tests.
- **.NET**: `internal` + one assembly per module (the reference approach); NetArchTest.
- **Dart (shelf / dart_frog / serverpod)**: one package per module under `packages/`; only `lib/contract.dart` exported; internals under `lib/src/` (Dart convention: don't import another package's `src`); `custom_lint` rule to enforce.

Data: one schema (Postgres) or database per module, separate migration folder, separate DB role per module whose grants cover only its own schema — the strongest cheap enforcement of rule 5.

## TypeScript / Node

See `assets/ts-minimal-runtime/runtime.ts` (≈200 lines) and `demo.ts` (run `node demo.ts` on Node ≥ 22.18). The demo shows: startup refusal naming module and service; the same modules as one host and as two hosts over HTTP with identical results *and identical refusals*; approval hold returned as a retryable refusal; a module with no connector installed refusing explicitly.

Production choices: NestJS modules give per-module DI but share a global container by default — don't use `@Global()`, export only the contract client. Outbox: Postgres + a relay (pg-boss, Graphile Worker, or Debezium). Transport: plain `fetch` to `/modules/:name/execute` or gRPC (Connect). Validation: zod schemas as validators in the pipeline (before authorization, before the gate).

## Python

- Modules as packages; `configure(builder)` registers factories into a per-module `dict` container (or `dependency-injector` container per module).
- Pipeline as a list of async middlewares composed in registration order; validators and authorization run *before* it.
- Result: `@dataclass(frozen=True) class Refusal(code: str, message: str, retryable: bool)`; return `Ok | Refusal`.
- FastAPI host exposes `POST /modules/{name}/execute`; requests serialized with pydantic models keyed by contract `type`.
- Outbox: SQLAlchemy session — add `OutboxMessage` rows in the same `session.begin()` block.

## Go

- `type Module interface { Name() string; Configure(*Builder) }`; handlers are funcs taking the use case's operation interface.
- `internal/` packages enforce boundaries at compile time — the best free enforcement of any language here.
- Result: return `(T, *Refusal)` where refusals are values; reserve `error` for bugs and infrastructure faults that must not cross modules.
- Transport: in-process map lookup; remote via `net/http` or Connect-Go.

## Java / Kotlin

- Spring Modulith gets you boundary verification, `@ApplicationModuleListener`, and an event publication registry (outbox-like). Add the CTA pieces it lacks: a location-transparent `transport.send(module, request)` instead of direct bean calls across modules, and a per-module plugin surface.
- Use sealed classes / `Result` types for refusals.

## Dart backends (relevant for Flutter teams)

- A `ModuleHost` in Dart is straightforward: abstract `Module` with `name` + `configure(ModuleBuilder)`, `sealed class Result<T>` with `Ok`/`Refused`, contracts as `final class` with `toJson`/`fromJson` keyed by a `type` string.
- Host: `shelf` router with `/modules/<name>/execute`; in-process dispatch passes the object directly.
- Keep the Flutter app a *client of hosts*, never of modules' stores; the app talking to a host edge is the same as any external caller.

## Testing the claim

Rules 3, 4 and 15 are only proven if the same contract tests pass in **both** modes. Make a test harness that runs each module's contract test suite twice: once with all modules in one host, once with the module under test behind a real HTTP host. Diff success *and* refusal payloads.
