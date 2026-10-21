# Intake and household memory

## New requests

- Start with `open_homefix_dashboard` or the appropriate context/list tools so the response uses the authenticated user's real state.
- Use `get_home_context` to retrieve saved non-sensitive home details. Do not ask the user to repeat details that are already available.
- If no household exists, use the explicit onboarding path: `create_household`, then `save_home_profile`. Do not create either record silently.
- Extract one independently trackable repair per issue. For example, a leaking tap and shelf mounting are two repairs.
- When several repairs come from one intake message, create one `create_repair_group` only when shared group metadata such as a total budget applies, then create each repair with `create_repair_request`.
- Ask for missing location, timing, service constraints, or budget information before external lookup when those fields are required.

## Returning users

- Load `list_maintenance_requests` and match by meaning, room, category, and current state—not merely by recency.
- If exactly one repair is an unambiguous match, update that record. If multiple records could match, ask the user which one before writing.
- Update existing records instead of creating duplicates unless the user clearly requests a new repair.
- Keep user-reported state distinct from provider-verified state. Opening a link is not booking, and saying a repair is done is a user report unless the provider independently confirms it.

Never store or request passwords, door codes, alarm codes, payment details, or other home-security secrets.
