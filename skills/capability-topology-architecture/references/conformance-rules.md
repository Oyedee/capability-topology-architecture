# Conformance Rules (15) and Review Checklist

Language-neutral. Each rule: statement → what falsifies it → note. Numbers are stable (cited across the docs), grouped in five families.

| # | Phrase | Family |
|---|---|---|
| 1 | Own container, plus declared imports | Boundaries |
| 2 | Reachable only through a declared request | Boundaries |
| 3 | A call site carries no address | Topology |
| 4 | Moving a module edits no module | Topology |
| 5 | A module's stored state is its own | Boundaries |
| 6 | No transaction spans two modules | Boundaries |
| 7 | State and its messages commit together | Crossing |
| 8 | A deployment's dependency displaces the module's | Composition |
| 9 | Nothing on a request stands a gate down | Governance |
| 10 | The deployment decides which external systems | Composition |
| 11 | Validation and permission precede any gate | Governance |
| 12 | A missing required dependency stops startup | Composition |
| 13 | The deployment decides who runs the clock | Composition |
| 14 | Events match by name, not by artefact | Crossing |
| 15 | A refusal is returned, not raised | Crossing |

## Boundaries
**1.** A module resolves dependencies from its own container plus declared imports; it cannot reach another's container.
*Falsified by:* obtaining an undeclared service, or resolving from a sibling's container. Two modules in one host must be able to register different implementations of one interface. Shared host-wide capabilities are declared at both ends (export + import).

**2.** A module reaches another only through a request the other declared callable.
*Falsified by:* a successful call to an undeclared request, a handler, a store or tables directly. A module with 100 internal operations and 6 declared requests has a surface of 6.

**5.** A module's stored state is readable/writable only by that module.
*Falsified by:* any outside query reading/writing it, including cross-module joins. Shared server ≠ shared schema.

**6.** No transaction spans two modules.
*Falsified by:* one commit covering writes owned by two modules. Replacement = rule 7 + reconciliation (team work).

## Topology
**3.** A call site names target module and request; carries no address, wire format, transport choice, or retry policy.
*Falsified by:* needing a URL, serializer or transport to reach a non-composed module. About what the call site *expresses*.

**4.** Moving a module changes deployment configuration only.
*Falsified by:* editing any source file inside any module (mover or callers) to move it.

Rules 3 and 4 hold easily on the success path and are lost on the **refusal path** → see 15.

## Composition
**8.** Deployment-supplied dependencies apply after module self-configuration and displace its defaults.
*Falsified by:* a module keeping its local default for a type the deployment also supplied.

**10.** Reachable external systems are decided by the deployment's installed plugins, not a branch in the module.
*Falsified by:* a module that names, tests for or switches on the installed plugin family.

**12.** Missing required dependency → refused at startup naming module and dependency.
*Falsified by:* host starting, passing health check, failing at first request. Optional imports must exist.

**13.** Modules declare background work; whether it runs in a host is the deployment's decision.
*Falsified by:* two hosts composing a module each running its schedule without being told to.

## Governance
**9.** Nothing on a request (field, header, parameter) can stand a policy gate down.
*Falsified by:* request content changing whether permission is checked or approval held. Only dispatching code can stand down *policy* gates; validation, dedupe and transaction can never be stood down.

**11.** Validation and permission complete before any policy gate records the request.
*Falsified by:* a malformed or unpermitted request appearing in an approval queue.

## Crossing a boundary
**7.** A state change and its integration messages both commit or neither.
*Falsified by:* durable state change with no queued message, or a queued message whose change rolled back. Delivery may still repeat.

**14.** Published events match consumers by a name on the message, not a shared code artefact.
*Falsified by:* a consumer that must compile against the producer's declaration. Sharing is allowed, not required.

**15.** Domain refusals are returned as values on the normal result path.
*Falsified by:* a refusal reaching the caller as a thrown exception. Thrown refusals don't cross process boundaries intact → caller error handling changes when the module moves (breaks 4) and caller can tell local from remote (breaks 3). Exceptions stay for bugs/broken invariants/missing dependencies, and never cross a module boundary.

## Deliberately open
Language, container, storage engine, serialization, broker, number of hosts; how many gates and over what (governance is mechanism, not policy); how big a module is.

## Two obligations no checker discharges
1. **Holdable/resumable requests are safe to run more than once** — own already-done check; in-memory dedupe doesn't count.
2. **Somebody reconciles** cross-module partial failures.

---

## Review checklist (use with templates/review-report.md)

For each item mark PASS / FAIL / N/A with file:line evidence.

**Boundaries**
- [ ] Each module has its own DI/container scope; no global service locator used across modules (1)
- [ ] No imports of another module's internal namespaces/packages — only its public contract package (2)
- [ ] Each module has its own schema/migrations; no cross-module SQL/ORM joins or foreign keys into another module (5)
- [ ] No transaction/unit of work spanning two modules; no XA/ambient distributed transaction (6)
- [ ] Contracts live beside their owning module, not in a shared "Contracts/Common" project

**Topology**
- [ ] Call sites use `send(Module, Request)`/typed client; no URLs, HTTP clients, serializers, timeouts or retries in module code (3)
- [ ] Topology lives in config (module list per host + address map) (4)
- [ ] Cross-host contracts evolve additively; breaking changes use a second contract/topic

**Composition**
- [ ] Module defaults registered before deployment imports; imports win (8)
- [ ] No `if provider == ...` / vendor names inside the module; no default connector inside the module (10)
- [ ] Shared behaviour (retry, audit, mapping) in module; auth/payload/failure quirks in connectors
- [ ] Startup validates required imports with module + service names (12)
- [ ] Only explicitly-designated hosts run jobs; one schedule store; claim-by-conditional-write, lease, advance-on-completion (13)

**Governance & pipeline**
- [ ] Permissions/approval scopes declared on requests, not coded in handlers
- [ ] Order: resolve → validate → authorize → behaviours (… → approval gate) → unit of work → handler (11)
- [ ] No request field/header can bypass gates; bypass only via dispatcher with its own permissioned exposure (9)
- [ ] Every governed scope has a configured policy; unconfigured scope refuses start
- [ ] Reads restricted at the exposing edge (pipeline does not check permission on queries)
- [ ] Both gate code paths (result/void) share the same rule

**Crossing**
- [ ] Outbox (or equivalent) writes messages in the same commit as the state change (7)
- [ ] Consumers match on topic; no required compile dependency on producer types (14)
- [ ] Domain refusals returned as Result/Either with stable code + retryable flag (15)
- [ ] Consumers and holdable requests idempotent with a durable already-done check
- [ ] A reconciliation job/process exists for each multi-module flow
- [ ] Consumers that publish go through a request/unit of work, not direct saves

**Seams & runtime**
- [ ] Every handler (commands AND queries) depends on exactly one use-case operation interface
- [ ] Settings cache shared across hosts and invalidated on change; secrets not in settings store
- [ ] Real-time push sends signals (module, kind, correlation, time), never payloads
- [ ] Workflow "resume" not assumed from re-running a run
