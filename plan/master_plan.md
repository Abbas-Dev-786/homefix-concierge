# HomeFix Concierge — Master Implementation Plan

## Purpose

This directory turns the requirements in `docs/PRD.md`, `docs/TECHNICAL_SPEC.md`, and `docs/CODING_HARNESS_INSTRUCTIONS.md` into a gated, phase-by-phase implementation path. Complete the phases in order. Each phase plan describes the work, artifacts, and exit gate needed before moving on.

The product is a persistent home-repair coordination MCP App. Its primary UI is the React MCP App View rendered by the connected MCP host. The MVP uses Manufact Cloud for the MCP server and View deployment, Supabase for OAuth and Postgres, and live Taskrabbit capabilities through Composio MCP.

## Current repository starting point

- The repository is a TypeScript `mcp-use` starter (`mcp-use` 2.10.0) with `index.ts` and `views/my-view/`.
- The server currently exposes generic `show-app` and `say-hello` examples. The View is a demo counter and must be replaced before any product walkthrough.
- The package currently has build, dev, start, deploy, and typecheck scripts. It does not yet contain HomeFix domain tools, Supabase/Composio dependencies, app migrations, or a product README/configuration.
- Existing product decisions and detailed requirements live in the three source documents listed above. Read them before each implementation phase and resolve any new contradiction in those source documents before coding around it.

## Current implementation status

- Phase 0 local baseline is complete.
- Phase 1 is complete: local and deployed protocol/OAuth checks passed, and manual Inspector/Manufact host verification was confirmed.
- Phase 2/3 implementation and local automated checks are complete; applying the Supabase migrations and running the deployed two-user data-flow verifier remain pending before those phases can be marked complete.
- Phase 4/5 implementation and local automated checks are complete; the deployed live Composio contract and authenticated host walkthrough remain pending before those phases can be marked complete.
- Evidence is recorded under `plan/evidence/`.

## Fixed product and architecture decisions

- Use a real self-hosted Streamable HTTP MCP server on the Alexa+ hackathon route, with actual protocol support for MCP `2025-11-25` or later.
- Use Manufact `mcp-use` for the TypeScript MCP server and MCP App Views if the protocol compatibility gate passes. If it fails, use the official MCP TypeScript SDK for the protocol server while keeping the deployment on Manufact where compatible.
- Use the Manufact MCP App View as the product UI. Do not create a standalone React/Vite simulator, browser REST app, or second chat agent.
- Use Manufact Cloud Chat for the deployed walkthrough and the mcp-use Inspector for local View development and debugging. Native Alexa+ device/add-on UI integration is outside P0.
- Use Supabase Auth OAuth 2.1 with Dynamic Client Registration, verified by mcp-use's Supabase provider; host the minimal consent route on the same deployment. Use the verified `ctx.auth.user.id` for all household authorization.
- P0 is one household and one home profile per authenticated user. Create the household only through explicit, idempotent onboarding.
- Use Supabase Postgres for durable user-owned state and Composio MCP for live Taskrabbit discovery, option lookups, and deep-link generation. Discover real Composio tools and schemas; do not guess them.
- Never ship fabricated user, household, provider, price, availability, link, trace, or booking data. Test doubles may be used only in isolated tests. If a live dependency fails, report an actionable error and do not substitute results.
- A provider result is eligible for handoff only while its age is less than 15 minutes. At exactly 15 minutes it is expired and requires a new live lookup.
- A handoff is an explicit user-approved external link. Opening it is not proof of booking; only a verified provider response could establish provider-confirmed booking.
- Do not use AWS services, collect payment details, or store sensitive home-access information.

## Phase sequence

| Phase | Plan | Outcome / exit gate |
| --- | --- | --- |
| 0 | [Repository baseline and delivery setup](phases/phase-00-baseline.md) | Starter inventory, agreed configuration approach, and clean implementation checklist. |
| 1 | [MCP, View-host, and OAuth compatibility spike](phases/phase-01-compatibility-spike.md) | Real protocol version and Streamable HTTP behavior proven; Manufact host/View and Supabase OAuth path validated or a documented compatible fallback selected. |
| 2 | [Supabase foundation and authenticated onboarding](phases/phase-02-auth-and-data-foundation.md) | Authenticated, isolated one-household-per-user persistence and real onboarding work without seeded user data. |
| 3 | [HomeFix domain and MCP tool contract](phases/phase-03-domain-and-mcp-tools.md) | Validated domain model, state transitions, persistence services, and authenticated HomeFix tools are implemented. |
| 4 | [Live Taskrabbit through Composio](phases/phase-04-composio-taskrabbit.md) | Actual Composio Taskrabbit tools are discovered and mapped; live results/errors are normalized with provenance and expiry. |
| 5 | [End-to-end repair workflow and orchestration](phases/phase-05-repair-workflow.md) | Host model can drive real intake, lookup, comparison, handoff, return, and outcome updates through tools. |
| 6 | [Manufact MCP App View](phases/phase-06-mcp-app-view.md) | Starter View is replaced by the polished, accessible HomeFix View with real tool data and user-approved actions. |
| 7 | [Security, reliability, and full verification](phases/phase-07-hardening-and-verification.md) | P0 behavior passes unit, integration, protocol, View, privacy, failure, and no-dummy-data gates. |
| 8 | [Manufact deployment and hackathon submission](phases/phase-08-deploy-and-submit.md) | Public deployment is verified; setup, short live demo, source, and product feedback are submission-ready. |

## Dependency path

`0 Baseline -> 1 Compatibility gate -> 2 Auth/data -> 3 Domain/tools -> 4 Composio -> 5 Complete workflow -> 6 View -> 7 Hardening -> 8 Deploy/submit`

Do not build downstream features on an unproven protocol or host capability. Some UI sketches and copy can be prepared earlier, but a phase is only complete when its exit gate is met and its plan records the evidence. If a gate fails, fix the issue inside the current phase or record an explicit implementation decision and revise affected plans before proceeding.

## Work discipline

1. Start each phase by rereading its plan and the relevant source sections of the PRD and technical spec.
2. Inspect installed package versions, exported types, and official current documentation before relying on API shapes, especially for mcp-use, Supabase OAuth, Composio, and host bridge actions.
3. Implement in small slices. Keep domain behavior server-side and keep durable state in Supabase; use View state only for ephemeral UI state.
4. Keep secrets in server-only environment settings. Never commit real keys or expose tokens, provider payloads, or service-role credentials in View output, logs, screenshots, or examples.
5. Do not add a fake provider mode or scripted “success” path. When a real integration is unavailable, surface an error and preserve the actual incomplete state.
6. Run the checks specified by the active phase, record results in that phase's completion notes, and do not call a phase done because code merely compiles.
7. Do not deploy or mutate external services until the deployment phase explicitly calls for it. Use test Supabase accounts and isolated test records for verification.
8. Update this master plan and affected phase plans when a verified SDK, provider capability, Manufact host limitation, or project decision changes.

## Project completion definition

The project is complete only when all P0 PRD acceptance criteria pass, the public Manufact MCP endpoint passes the required protocol test, a signed-in user can complete the live Taskrabbit journey through the MCP host and HomeFix View, state persists and is correctly isolated, handoff/outcome claims remain truthful, live failures never fall back to dummy data, the deployed View behaves in the named host, and the repository contains accurate setup and hackathon submission materials.

## Source of truth

- Product scope and acceptance criteria: [`../docs/PRD.md`](../docs/PRD.md)
- Architecture, tool contracts, schema, and verification detail: [`../docs/TECHNICAL_SPEC.md`](../docs/TECHNICAL_SPEC.md)
- Coding-agent sequencing and invariants: [`../docs/CODING_HARNESS_INSTRUCTIONS.md`](../docs/CODING_HARNESS_INSTRUCTIONS.md)
- MCP Apps implementation rules: [`.agents/skills/mcp-apps-builder/SKILL.md`](../.agents/skills/mcp-apps-builder/SKILL.md) and its `references/` files

