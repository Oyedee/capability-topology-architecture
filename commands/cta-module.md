---
description: Scaffold one CTA module (contracts, handlers, operation seam, imports, surface)
argument-hint: <module name> <language/stack> [capability description]
---
Use the capability-topology-architecture skill (mode B: building a module) for: $ARGUMENTS

Read references/building-modules.md and the matching section of references/language-patterns.md. Produce the five declarations, one folder per use case, a single operation-interface dependency per handler (queries too), refusals returned as values with stable codes and a retryable flag, permissions/approval scopes declared on requests, a typed client in the contract package, in-memory defaults for imports, and contract tests that can run both in-process and remote.
