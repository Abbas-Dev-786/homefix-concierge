# Phase 6 — Manufact MCP App View

## Goal

Replace the generic starter counter with the polished HomeFix React MCP App View rendered in the selected MCP host.

## Dependencies

- Phase 1 proves View rendering and host bridge behavior.
- Phase 2 onboarding outputs and Phase 3/4/5 tool contracts are stable.
- Follow `.agents/skills/mcp-apps-builder/references/views.md` and `verification.md`.

## Work

1. Replace the `views/my-view` demo and generic `show-app` tool with a HomeFix dashboard bound to `open_homefix_dashboard` (or the final agreed entrypoint tool); align directory name, `view.name`, exported tool ref, output schema, and structured result exactly.
2. Build the PRD's desktop-first responsive layout: HomeFix header/identity context, home profile summary/edit, repair intake, open repairs and history, live Taskrabbit results, activity/status timeline, and explicit handoff controls.
3. Invoke server tools only through exported `mcp-use/react` bridge hooks. Keep all durable workflow state in server/Supabase; use local View state only for transient selections, open panels, and form drafts.
4. Show real onboarding for no-household users, with explicit household creation and profile save. Never prefill fake repairs or provider cards.
5. Implement pending, success, empty, validation, unauthorized, host-action rejection, integration unavailable, stale-result, and retry states. Distinguish live provider data, HomeFix calculations, user-reported outcomes, and unavailable values.
6. Guard host capabilities with host context; call `useOpenExternal` only after an explicit click on a validated provider link. Handle host rejection and keep handoff state truthful.
7. Include accessible labels, keyboard operation, visible focus, responsive sizing, sensible theme behavior, and clear unknown/unavailable language.
8. Declare only needed CSP origins and use public asset paths supported by the framework. Do not expose secrets or unnecessary provider payloads in model-visible state.
9. Render the bound dashboard tool in the Inspector and test each critical UI state and bridge interaction; then verify the same behavior in Manufact Cloud Chat.

## Deliverables

- HomeFix View source/styles/components under the MCP server's `views/` tree.
- Dashboard rendering tool ref with matching typed `outputSchema` and `structuredContent`.
- View interaction wiring for onboarding, repair actions, live options, handoff, and outcome updates.
- View verification notes/screenshots from the actual host, containing no secrets or fabricated records.

## Exit gate

- No starter counter, generic greeting, fake activity, placeholder provider options, or static demo success remains in the product View.
- All rendered records originate from the authenticated user's database or actual live provider results.
- The View renders pending, ready, empty, and error states and invokes real server tools correctly.
- The outbound Taskrabbit link is validated, user activated, and host mediated.
- Inspector and deployed Manufact Cloud Chat behavior have been checked for the required flow.

## Do not do in this phase

- Do not build a standalone React/Vite app or REST-backed frontend.
- Do not put durable data, auth secrets, provider secrets, or business authorization in View code.
- Do not call browser `window.open` or bypass the MCP host external-link API.

