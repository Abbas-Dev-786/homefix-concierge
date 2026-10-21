# Safe booking handoff

This workflow prepares a handoff; it does not book on the user's behalf.

1. Require the user to select a specific returned option.
2. Ensure the option is still fresh and has the required provider identifier.
3. Call `create_booking_handoff` to obtain and validate the live Taskrabbit URL. Never construct a substitute URL.
4. Present the selected service, known price/availability, source time, and the warning that booking will finish on Taskrabbit.
5. Open the URL only after the user activates a clearly labeled control such as “Continue to Taskrabbit.” The View then calls `record_handoff_opened` idempotently.
6. Treat `ready` and `opened` as handoff states, never as booking confirmation.
7. Ask the user to report `Booked`, `Not booked`, `Cancelled`, or `Need help / still deciding`, then call `record_booking_outcome` with the user's exact outcome and optional note.

Reject non-HTTPS or non-allowlisted URLs, stale results, missing provider identifiers, and failed link generation. Keep the repair available for retry without duplicating the handoff.
