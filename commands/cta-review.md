---
description: Review a codebase or design against the 15 CTA conformance rules
argument-hint: [path to modules directory or design doc]
---
Use the capability-topology-architecture skill (mode E: review) on: $ARGUMENTS

If code is present, run scripts/cta_boundary_check.py on the modules directory first, then read the code to confirm each hit. Walk every rule in references/conformance-rules.md with file:line evidence, check the two obligations no checker discharges (idempotent held requests, reconciliation), and report using templates/review-report.md with one recommended next step.
