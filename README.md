# Capability Topology Architecture — Claude Code plugin

Teaches Claude to design, build, review and migrate backend systems where **capability boundaries and deployment boundaries are two separate decisions**. Capabilities are built once as modules that own their data, then composed into hosts at deployment time — so the same codebase runs as a monolith, as distributed services, or as a mix, without changing a module.

Distilled from the *Capability Topology Architecture* documentation at [cbans.netlify.app](https://cbans.netlify.app). All credit for the architecture belongs to its authors; this plugin is an independent, unofficial adaptation for AI-assisted engineering.

## Install

```bash
claude plugin marketplace add oyedee/capability-topology-architecture
claude plugin install capability-topology-architecture@howfar-plugins
```

Or inside a Claude Code session:

```
/plugin marketplace add oyedee/capability-topology-architecture
/plugin install capability-topology-architecture@howfar-plugins
```

Update later with `claude plugin update capability-topology-architecture@howfar-plugins`.

## What you get

- **Skill** (`skills/capability-topology-architecture/`) — loads automatically when you work on backend architecture: module boundaries, monolith vs microservices, plugins/connectors for external systems, outbox and idempotency, approval gates, migrations, and architecture reviews.
- **Commands** — `/capability-topology-architecture:cta-design`, `:cta-module`, `:cta-review`, `:cta-migrate`.
- **The 15 conformance rules** with a falsifiable test for each, plus a review checklist and report template.
- **Runnable TypeScript reference runtime** (`assets/ts-minimal-runtime/`, `node demo.ts`, Node ≥ 22.18) showing the same modules running as one host and as two hosts over HTTP with identical results.
- **Static boundary checker** (`scripts/cta_boundary_check.py <modules_dir>`) for any language.

## What it runs, sends or fetches

Nothing automatically. The plugin contains instructions, templates and two scripts that run only when you or Claude invoke them locally. `cta_boundary_check.py` reads files in the directory you pass it and prints a report; it makes no network calls. `demo.ts` starts a temporary HTTP server on `127.0.0.1` (random port) to demonstrate a remote module call, then shuts it down. No data leaves your machine and no credentials are read.

## License

MIT — see [LICENSE](LICENSE).
