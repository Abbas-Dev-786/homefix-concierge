# Phase 2 evidence — Supabase foundation and authenticated onboarding

Status: implementation complete locally; Supabase migration application and authenticated data-flow verification remain pending.

## Implemented

- Added versioned SQL migrations for `households`, `household_members`, and `home_profiles`.
- Added one-household-per-user uniqueness and an advisory-lock-protected idempotent household creation function.
- Added timestamps, foreign keys, indexes, sensitive-field checks, and RLS policies.
- Added a server-only Supabase REST repository using the service-role key.
- Every repository operation resolves household scope from the verified MCP user ID and membership.
- Added `create_household`, `save_home_profile`, `open_homefix_dashboard`, `get_home_context`, and `list_maintenance_requests`.
- Missing households return explicit onboarding state without creating records implicitly.
- Profile validation rejects unknown fields and sensitive home-access/payment/credential data.

## Local evidence

- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run verify:protocol`: passed with persistence readiness configured and unauthenticated protected tools rejected.

## Required activation

Apply `supabase/migrations/20261016000000_phase2_foundation.sql` and then verify onboarding with two isolated Supabase Auth users. The migrations are intentionally not applied automatically because that changes the external Supabase project.

Phase 2 exit-gate checks still required after migration:

- first-user onboarding and repeated/concurrent household creation;
- profile create/update and no fabricated defaults;
- user isolation across two authenticated accounts;
- persistence across server restart.
