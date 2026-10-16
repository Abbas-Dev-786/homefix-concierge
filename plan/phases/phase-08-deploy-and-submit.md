# Phase 8 — Manufact deployment and hackathon submission

## Goal

Deploy the verified HomeFix MCP App to Manufact and prepare a truthful, reproducible hackathon submission.

## Dependencies

- Phase 7 exit gate passes.
- Manufact workspace/project, Supabase project, Composio Taskrabbit connection, and required account access are available.
- No user secret is embedded in source or artifacts.

## Work

1. Create/configure the Manufact deployment using the documented project package scripts and the verified hosting flow.
2. Set server-only environment variables in Manufact. Configure Supabase Site URL, OAuth 2.1/DCR settings, ES256 signing, redirect allowlist, and the deployed `/oauth/consent` route.
3. Apply reviewed Supabase migrations. Confirm no test/demo records are inserted for the public walkthrough account; the walkthrough user signs in and supplies actual profile data.
4. Verify the deployed public HTTPS `/mcp` endpoint, protocol negotiation, authenticated tool access, dashboard View rendering, and live Composio Taskrabbit calls from Manufact Cloud Chat.
5. Walk through the full journey using the live provider: onboarding, repair intake, provider discovery/options, comparison, explicit external handoff, return, user-reported outcome, and persisted dashboard state.
6. Verify public errors and recovery when live dependencies are unavailable; demonstrate no fake option or handoff appears.
7. Prepare reviewer instructions, environment variable names, setup/run/migration commands, architecture summary, and a public English demo under three minutes.
8. Submit product/API/SDK feedback and friction-log entries based on actual experience only. Record task, steps, expected/actual result, severity, workaround, and actionable suggestion.
9. Capture final endpoint/version/capability/test evidence and list any remaining non-P0 limitations.

## Deliverables

- Public Manufact MCP App endpoint and working authenticated View.
- Final README/setup/deployment instructions and safe `.env.example`.
- Short truthful demo video and hackathon submission materials.
- Product feedback/friction log and final implementation report.

## Exit gate

- Public deployment passes protocol, auth, View, database isolation, and live Taskrabbit checks.
- The walkthrough completes with real user input and live provider data and never implies that an opened link equals a confirmed booking.
- Setup instructions work from a clean checkout without private credentials committed.
- Submission assets meet the hackathon format and clearly state what is verified versus user reported or unknown.

## Do not do in this phase

- Do not expose secrets in public source, video, logs, screenshots, or feedback.
- Do not represent an unverified native Alexa+ interface as built.
- Do not add optional P1 features until the P0 walkthrough and submission are complete.

