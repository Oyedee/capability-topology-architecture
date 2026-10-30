# Capability Topology Architecture — Claude plugin

Distilled from https://cbans.netlify.app (all 34 pages). Teaches Claude to design, build, review and migrate backend systems where capability boundaries and deployment boundaries are separate decisions.

- Skill: `skills/capability-topology-architecture/` (triggers automatically on backend architecture work)
- Commands: `/cta-design`, `/cta-module`, `/cta-review`, `/cta-migrate`
- Runnable demo: `skills/capability-topology-architecture/assets/ts-minimal-runtime/` → `node demo.ts` (Node ≥ 22.18)
- Static scan: `python3 skills/capability-topology-architecture/scripts/cta_boundary_check.py <modules_dir>`

Install in Claude Code: `/plugin marketplace add <path-or-repo>` then `/plugin install capability-topology-architecture`, or copy the skill folder into `~/.claude/skills/`.
