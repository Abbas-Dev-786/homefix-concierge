# Return-session follow-up

When a user returns after searching or opening a handoff:

1. Load the dashboard and maintenance list from Supabase.
2. Show the current repair, search, handoff, and outcome history.
3. Match the user's update to an existing repair. Ask for clarification if the match is not unique.
4. Use `record_booking_outcome` for explicit handoff outcomes and `update_maintenance_status` for valid maintenance-state changes.
5. Preserve each repair independently. If the user says one issue is resolved and another remains, update only the matching record.
6. Describe the resulting state as user-reported unless a verified provider response exists.

Use the visible follow-up queue when the product exposes one. Do not claim that an email, SMS, reminder, or background job was sent unless a real capability performed it.
