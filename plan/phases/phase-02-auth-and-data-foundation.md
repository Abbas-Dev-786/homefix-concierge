# Phase 2 — Supabase foundation and authenticated onboarding

## Goal

Create the secure persistence foundation and let a real authenticated user explicitly create and edit one household profile.

## Dependencies

- Phase 1 protocol, host, and OAuth compatibility gate passed.
- Supabase project and server-only credentials configured outside source control.

## Work

1. Add startup environment validation for runtime, Supabase URL, server-side service credential, OAuth configuration, and future Composio configuration. Fail startup clearly when required configuration is absent.
2. Configure Supabase Auth OAuth 2.1 and DCR, mcp-use `oauthSupabaseProvider`, ES256 signing, and the same-deployment consent route.
3. Implement SQL migrations for `households`, `household_members`, and `home_profiles`, including one user per household in P0, one profile per household, foreign keys, timestamps, checks, and indexes.
4. Enable RLS and define least-privilege policies. Because server service-role credentials bypass RLS, ensure repository methods resolve the household through the verified MCP user ID and membership on every operation.
5. Implement authenticated repository methods with explicit ownership scope; do not provide generic SQL/query operations.
6. Add `create_household` as a transactional, idempotent operation with no caller-supplied user/household ID. Handle concurrent/repeated requests without duplicate household or membership rows.
7. Add `save_home_profile` as create/update for the authenticated user's single household profile. Validate allowed non-sensitive fields; reject access codes, credentials, payment data, and unknown fields.
8. Add `open_homefix_dashboard` (or the agreed entrypoint tool) so a user without a household sees `onboardingRequired: true` and empty collections, with no implicit record creation.
9. Add database/repository tests for isolation, duplicate onboarding, invalid fields, RLS assumptions, deletion behavior, and user-without-household behavior.

## Deliverables

- Versioned Supabase migrations and migration instructions.
- Auth provider setup and same-deployment consent route.
- Household/profile repositories and schemas.
- Authenticated onboarding and profile tools, with no seeded user rows.
- `.env.example` containing names and safe placeholders only.

## Exit gate

- Two authenticated users cannot read or mutate each other's household/profile data.
- A user with no household receives an explicit empty onboarding state.
- Repeated and concurrent household creation leave one household and one owner membership for that user.
- Profile create/update is scoped to the caller and never fills missing values with invented data.
- Migration, authorization, and onboarding behavior pass their automated checks.

## Do not do in this phase

- Do not seed fake households or repairs.
- Do not expose Supabase service-role credentials to the View or host model.
- Do not add multi-member/shared-household functionality to P0.

