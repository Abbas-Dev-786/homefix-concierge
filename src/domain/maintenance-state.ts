import { HomeFixError } from "./errors.js";

export const maintenanceStatuses = [
  "new",
  "searching",
  "options_ready",
  "awaiting_user_choice",
  "handoff_ready",
  "awaiting_outcome",
  "booked_user_reported",
  "in_progress_user_reported",
  "resolved_user_reported",
  "cancelled_user_reported",
  "needs_attention",
  "closed",
] as const;

export type MaintenanceStatus = (typeof maintenanceStatuses)[number];

const transitions: Record<MaintenanceStatus, readonly MaintenanceStatus[]> = {
  new: ["searching", "cancelled_user_reported", "needs_attention"],
  searching: ["options_ready", "needs_attention", "cancelled_user_reported"],
  options_ready: ["awaiting_user_choice", "handoff_ready", "searching", "cancelled_user_reported", "needs_attention"],
  awaiting_user_choice: ["handoff_ready", "searching", "cancelled_user_reported", "needs_attention"],
  handoff_ready: ["awaiting_outcome", "searching", "cancelled_user_reported", "needs_attention"],
  awaiting_outcome: ["booked_user_reported", "cancelled_user_reported", "needs_attention", "awaiting_user_choice"],
  booked_user_reported: ["in_progress_user_reported", "resolved_user_reported", "needs_attention", "closed"],
  in_progress_user_reported: ["resolved_user_reported", "needs_attention", "cancelled_user_reported"],
  resolved_user_reported: ["closed", "needs_attention"],
  cancelled_user_reported: ["closed", "needs_attention"],
  needs_attention: ["searching", "awaiting_user_choice", "cancelled_user_reported", "closed"],
  closed: [],
};

export function assertMaintenanceTransition(current: string, next: MaintenanceStatus) {
  if (!maintenanceStatuses.includes(current as MaintenanceStatus)) {
    throw new HomeFixError("INVALID_STATE", "The current maintenance state is invalid.", false, "refresh_dashboard");
  }
  if (!transitions[current as MaintenanceStatus].includes(next)) {
    throw new HomeFixError(
      "INVALID_STATE",
      `A maintenance request cannot move from ${current} to ${next}.`,
      false,
      "choose_a_valid_next_state"
    );
  }
}
