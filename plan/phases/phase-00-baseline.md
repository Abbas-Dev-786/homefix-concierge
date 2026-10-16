# Phase 0 — Repository baseline and delivery setup

## Goal

Understand the starter and convert the existing repository into a safe, reproducible HomeFix implementation workspace without claiming any product functionality yet.

## Read first

- `docs/PRD.md` sections 0, 10, 12, and 15.
- `docs/TECHNICAL_SPEC.md` sections 0, 3, 10, 11, and 14.
- `docs/CODING_HARNESS_INSTRUCTIONS.md` in full.
- `.agents/skills/mcp-apps-builder/SKILL.md`; use its server, view, auth, and verification references when those phases start.

## Work

1. Inventory the project files, package manager/lockfile, Node requirement, `mcp-use` version, scripts, starter tools, View assets, and environment loading behavior.
2. Mark `show-app`, `say-hello`, the counter UI, starter branding, and any starter-only host assumptions as scaffolding to replace. Do not present them as HomeFix behavior.
3. Identify missing implementation foundations: test/lint scripts, environment schema, database migration location, server-side module boundaries, and README setup instructions.
4. Establish a small-slice workflow and a place to record phase evidence/decisions. Preserve useful starter configuration and avoid unnecessary package upgrades.
5. Confirm the final project remains a single Manufact MCP App deployment with a View; no separate SPA, REST API, or duplicate conversational agent is added.

## Deliverables

- A repository inventory and short list of confirmed gaps.
- Agreed locations/conventions for server modules, migrations, and tests.
- A list of environment variable names only; no real secrets committed.
- An implementation checklist mapped to the P0 acceptance criteria.

## Exit gate

- The active package versions and available commands are known.
- The starter demo is clearly identified for replacement and cannot be mistaken for product-ready functionality.
- No architecture choice conflicts with the fixed decisions in `plan/master_plan.md`.
- A clean baseline typecheck/build result is recorded if the existing starter supports those commands.

## Completion note

Completed in [`../evidence/phase-00-baseline.md`](../evidence/phase-00-baseline.md). The generic starter was replaced by a labeled compatibility surface while preserving the single-server/single-View deployment shape.

## Do not do in this phase

- Do not seed demo household or provider data.
- Do not start implementing the full View before protocol/host compatibility is proven.
- Do not upgrade packages speculatively or add a standalone frontend.

