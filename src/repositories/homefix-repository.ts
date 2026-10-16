import { HomeFixError } from "../domain/errors.js";
import { SupabaseRestClient } from "../integrations/supabase-rest.js";

export type HomeProfileInput = {
  propertyType?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  countryCode?: string;
  currencyCode?: string;
  preferredServiceWindows?: unknown[];
  typicalBudgetAmount?: number;
  homeSummary?: string;
};

export type RepairRequestInput = {
  title: string;
  description: string;
  serviceCategory?: string;
  room?: string;
  urgency: "routine" | "soon" | "urgent";
  desiredDate?: string;
  desiredTimeWindow?: string;
  budgetMax?: number;
  currencyCode?: string;
  intakeGroupId?: string;
  idempotencyKey?: string;
};

export type HouseholdScope = {
  householdId: string;
  displayName: string;
  role: string;
};

type Row = Record<string, any>;

function first<T>(rows: T[] | undefined): T | undefined {
  return rows?.[0];
}

function profileFromRow(row: Row | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    propertyType: row.property_type ?? null,
    city: row.city ?? null,
    region: row.region ?? null,
    postalCode: row.postal_code ?? null,
    countryCode: row.country_code ?? null,
    currencyCode: row.currency_code ?? null,
    preferredServiceWindows: row.preferred_service_windows ?? [],
    typicalBudgetAmount: row.typical_budget_amount ?? null,
    homeSummary: row.home_summary ?? null,
    source: "supabase" as const,
  };
}

function requestFromRow(row: Row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    room: row.room ?? null,
    serviceCategory: row.service_category ?? null,
    urgency: row.urgency,
    status: row.status,
    desiredDate: row.desired_date ?? null,
    desiredTimeWindow: row.desired_time_window ?? null,
    budgetMax: row.budget_max ?? null,
    currencyCode: row.currency_code ?? null,
    statusSource: row.status_source,
    intakeGroupId: row.intake_group_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: "supabase" as const,
  };
}

export class HomeFixRepository {
  constructor(private readonly db: SupabaseRestClient) {}

  async resolveHousehold(userId: string): Promise<HouseholdScope | null> {
    const members = await this.db.select<Row>("household_members", {
      user_id: `eq.${userId}`,
      limit: "1",
    });
    const member = first(members);
    if (!member) return null;

    const households = await this.db.select<Row>("households", {
      id: `eq.${member.household_id}`,
      limit: "1",
    });
    const household = first(households);
    if (!household) {
      throw new HomeFixError("PERSISTENCE_UNAVAILABLE", "Household data is inconsistent. Please retry.", true);
    }
    return {
      householdId: household.id,
      displayName: household.display_name,
      role: member.role,
    };
  }

  async createHousehold(userId: string) {
    const rows = await this.db.rpc<Row>("create_household_for_user", { p_user_id: userId });
    const row = first(rows);
    if (!row) throw new HomeFixError("PERSISTENCE_UNAVAILABLE", "Household creation did not return a record.", true);
    return {
      householdId: row.household_id,
      displayName: row.display_name,
      role: row.member_role,
      source: "supabase" as const,
    };
  }

  async getProfile(scope: HouseholdScope) {
    const rows = await this.db.select<Row>("home_profiles", {
      household_id: `eq.${scope.householdId}`,
      limit: "1",
    });
    return profileFromRow(first(rows));
  }

  async saveProfile(scope: HouseholdScope, input: HomeProfileInput) {
    const row = first(await this.db.upsert<Row>("home_profiles", {
      household_id: scope.householdId,
      property_type: input.propertyType ?? null,
      city: input.city ?? null,
      region: input.region ?? null,
      postal_code: input.postalCode ?? null,
      country_code: input.countryCode ?? null,
      currency_code: input.currencyCode ?? null,
      preferred_service_windows: input.preferredServiceWindows ?? [],
      typical_budget_amount: input.typicalBudgetAmount ?? null,
      home_summary: input.homeSummary ?? null,
    }, "household_id"));
    if (!row) throw new HomeFixError("PERSISTENCE_UNAVAILABLE", "The home profile was not saved. Please retry.", true);
    return profileFromRow(row);
  }

  async listRequests(scope: HouseholdScope, openOnly = false) {
    const query: Record<string, string> = {
      household_id: `eq.${scope.householdId}`,
      order: "updated_at.desc",
    };
    if (openOnly) query.status = "not.in.(closed,cancelled_user_reported,resolved_user_reported)";
    const rows = await this.db.select<Row>("maintenance_requests", query);
    return rows.map(requestFromRow);
  }

  async dashboard(userId: string) {
    const scope = await this.resolveHousehold(userId);
    if (!scope) {
      return {
        onboardingRequired: true,
        household: null,
        profile: null,
        openRequests: [],
        source: "supabase" as const,
      };
    }
    return {
      onboardingRequired: false,
      household: { id: scope.householdId, displayName: scope.displayName, role: scope.role },
      profile: await this.getProfile(scope),
      openRequests: await this.listRequests(scope, true),
      source: "supabase" as const,
    };
  }

  async createRepairGroup(scope: HouseholdScope, groupBudgetMax?: number, currencyCode?: string) {
    const row = first(await this.db.insert<Row>("intake_groups", {
      household_id: scope.householdId,
      group_budget_max: groupBudgetMax ?? null,
      currency_code: currencyCode ?? null,
    }));
    if (!row) throw new HomeFixError("PERSISTENCE_UNAVAILABLE", "The repair group was not saved. Please retry.", true);
    return { id: row.id, groupBudgetMax: row.group_budget_max, currencyCode: row.currency_code, source: "supabase" as const };
  }

  async createRepairRequest(scope: HouseholdScope, input: RepairRequestInput) {
    if (input.idempotencyKey) {
      const existing = await this.db.select<Row>("maintenance_requests", {
        household_id: `eq.${scope.householdId}`,
        idempotency_key: `eq.${input.idempotencyKey}`,
        limit: "1",
      });
      const existingRow = first(existing);
      if (existingRow) return requestFromRow(existingRow);
    }

    if (input.intakeGroupId) {
      const groups = await this.db.select<Row>("intake_groups", {
        id: `eq.${input.intakeGroupId}`,
        household_id: `eq.${scope.householdId}`,
        limit: "1",
      });
      if (!first(groups)) throw new HomeFixError("FORBIDDEN", "That repair group is not part of your household.", false, "choose_your_repair_group");
    }

    const row = first(await this.db.insert<Row>("maintenance_requests", {
      household_id: scope.householdId,
      intake_group_id: input.intakeGroupId ?? null,
      title: input.title,
      description: input.description,
      room: input.room ?? null,
      service_category: input.serviceCategory ?? null,
      urgency: input.urgency,
      desired_date: input.desiredDate ?? null,
      desired_time_window: input.desiredTimeWindow ?? null,
      budget_max: input.budgetMax ?? null,
      currency_code: input.currencyCode ?? null,
      status: "new",
      status_source: "system",
      idempotency_key: input.idempotencyKey ?? null,
    }));
    if (!row) throw new HomeFixError("PERSISTENCE_UNAVAILABLE", "The repair request was not saved. Please retry.", true);
    await this.recordEvent(scope, row.id, "repair_request_created", "agent", "supabase", { status: "new" });
    return requestFromRow(row);
  }

  async updateRequestStatus(scope: HouseholdScope, requestId: string, status: string, note?: string) {
    const rows = await this.db.update<Row>("maintenance_requests", {
      id: `eq.${requestId}`,
      household_id: `eq.${scope.householdId}`,
    }, {
      status,
      status_source: "user_reported",
    });
    const row = first(rows);
    if (!row) throw new HomeFixError("NOT_FOUND", "That maintenance request was not found in your household.", false, "refresh_dashboard");
    await this.recordEvent(scope, requestId, "maintenance_status_updated", "user", "user_reported", { status, note: note ?? null });
    return requestFromRow(row);
  }

  async listOptions(scope: HouseholdScope, requestId: string, optionIds: string[]) {
    const rows = await this.db.select<Row>("service_options", {
      household_id: `eq.${scope.householdId}`,
      maintenance_request_id: `eq.${requestId}`,
      id: `in.(${optionIds.join(",")})`,
      order: "retrieved_at.desc",
    });
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      providerName: row.provider_name ?? null,
      serviceCategory: row.service_category,
      locationLabel: row.location_label ?? null,
      estimateMin: row.estimate_min ?? null,
      estimateMax: row.estimate_max ?? null,
      priceLabel: row.price_label ?? null,
      currencyCode: row.currency_code ?? null,
      availabilitySummary: row.availability_summary ?? null,
      retrievedAt: row.retrieved_at,
      expiresAt: row.expires_at ?? null,
      source: "live_taskrabbit" as const,
    }));
  }

  async getHandoff(scope: HouseholdScope, handoffId: string) {
    const rows = await this.db.select<Row>("booking_handoffs", {
      id: `eq.${handoffId}`,
      household_id: `eq.${scope.householdId}`,
      limit: "1",
    });
    return first(rows);
  }

  async markHandoffOpened(scope: HouseholdScope, handoffId: string) {
    const rows = await this.db.update<Row>("booking_handoffs", {
      id: `eq.${handoffId}`,
      household_id: `eq.${scope.householdId}`,
      status: "eq.ready",
    }, { status: "opened", opened_at: new Date().toISOString() });
    const row = first(rows);
    if (!row) throw new HomeFixError("NOT_FOUND", "That booking handoff is not ready or does not belong to your household.", false, "refresh_dashboard");
    await this.recordEvent(scope, row.maintenance_request_id, "handoff_opened", "user", "user_initiated", { handoffId });
    return { id: row.id, status: row.status, openedAt: row.opened_at, source: "supabase" as const };
  }

  async recordBookingOutcome(scope: HouseholdScope, handoffId: string, status: string, requestStatus: string, note?: string) {
    const handoffRows = await this.db.update<Row>("booking_handoffs", {
      id: `eq.${handoffId}`,
      household_id: `eq.${scope.householdId}`,
      status: "in.(opened,ready,user_reported_not_booked,user_reported_needs_help)",
    }, { status, outcome_reported_at: new Date().toISOString(), user_reported_note: note ?? null });
    const handoff = first(handoffRows);
    if (!handoff) throw new HomeFixError("NOT_FOUND", "That booking handoff was not found in your household.", false, "refresh_dashboard");
    const requestRows = await this.db.update<Row>("maintenance_requests", {
      id: `eq.${handoff.maintenance_request_id}`,
      household_id: `eq.${scope.householdId}`,
    }, { status: requestStatus, status_source: "user_reported" });
    if (!first(requestRows)) throw new HomeFixError("PERSISTENCE_UNAVAILABLE", "The booking outcome could not update the maintenance request.", true);
    await this.recordEvent(scope, handoff.maintenance_request_id, "booking_outcome_reported", "user", "user_reported", { handoffId, status, note: note ?? null });
    return { handoffId, handoffStatus: status, maintenanceStatus: requestStatus, source: "supabase" as const };
  }

  async recordEvent(scope: HouseholdScope, maintenanceRequestId: string | null, eventType: string, actorType: string, sourceMode: string, payload: unknown) {
    await this.db.insert("maintenance_events", {
      household_id: scope.householdId,
      maintenance_request_id: maintenanceRequestId,
      event_type: eventType,
      actor_type: actorType,
      source_mode: sourceMode,
      payload_sanitized: payload,
    });
  }
}
