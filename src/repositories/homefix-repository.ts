import { HomeFixError } from "../domain/errors.js";
import { assertMaintenanceTransition, type MaintenanceStatus } from "../domain/maintenance-state.js";
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

export type ServiceSearchRecordInput = {
  requestId: string;
  locationSnapshot: Record<string, string>;
  searchCriteria: Record<string, unknown>;
  status: "completed" | "empty" | "error";
  resultCount: number;
  errorCode?: string;
  retrievedAt?: string;
};

export type ServiceOptionRecordInput = {
  serviceSearchId: string;
  requestId: string;
  providerName: string | null;
  title: string;
  serviceCategory: string;
  locationLabel: string | null;
  estimateMin: number | null;
  estimateMax: number | null;
  priceLabel: string | null;
  currencyCode: string | null;
  availabilitySummary: string | null;
  availabilitySlots: unknown[];
  scopingQuestions: unknown[];
  taskTemplateId: string | null;
  retrievedAt: string;
  expiresAt: string;
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

function optionFromRow(row: Row) {
  return {
    id: row.id,
    searchId: row.service_search_id,
    requestId: row.maintenance_request_id,
    title: row.title,
    providerName: row.provider_name ?? null,
    serviceCategory: row.service_category,
    locationLabel: row.location_label ?? null,
    estimateMin: row.estimate_min ?? null,
    estimateMax: row.estimate_max ?? null,
    priceLabel: row.price_label ?? null,
    currencyCode: row.currency_code ?? null,
    availabilitySummary: row.availability_summary ?? null,
    availabilitySlots: row.availability_slots ?? [],
    scopingQuestions: row.scoping_questions ?? [],
    taskTemplateId: row.task_template_id ?? null,
    retrievedAt: row.retrieved_at,
    expiresAt: row.expires_at ?? null,
    source: "live_taskrabbit" as const,
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
    const existing = first(await this.db.select<Row>("home_profiles", {
      household_id: `eq.${scope.householdId}`,
      limit: "1",
    }));
    const row = first(await this.db.upsert<Row>("home_profiles", {
      household_id: scope.householdId,
      property_type: input.propertyType ?? existing?.property_type ?? null,
      city: input.city ?? existing?.city ?? null,
      region: input.region ?? existing?.region ?? null,
      postal_code: input.postalCode ?? existing?.postal_code ?? null,
      country_code: input.countryCode ?? existing?.country_code ?? null,
      currency_code: input.currencyCode ?? existing?.currency_code ?? null,
      preferred_service_windows: input.preferredServiceWindows ?? existing?.preferred_service_windows ?? [],
      typical_budget_amount: input.typicalBudgetAmount ?? existing?.typical_budget_amount ?? null,
      home_summary: input.homeSummary ?? existing?.home_summary ?? null,
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

    let row: Row | undefined;
    try {
      row = first(await this.db.insert<Row>("maintenance_requests", {
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
    } catch (error) {
      if (input.idempotencyKey && error instanceof HomeFixError && error.code === "CONFLICT") {
        const existing = await this.db.select<Row>("maintenance_requests", {
          household_id: `eq.${scope.householdId}`,
          idempotency_key: `eq.${input.idempotencyKey}`,
          limit: "1",
        });
        const existingRow = first(existing);
        if (existingRow) return requestFromRow(existingRow);
      }
      throw error;
    }
    if (!row) throw new HomeFixError("PERSISTENCE_UNAVAILABLE", "The repair request was not saved. Please retry.", true);
    await this.recordEvent(scope, row.id, "repair_request_created", "agent", "supabase", { status: "new" });
    return requestFromRow(row);
  }

  async updateRequestStatus(scope: HouseholdScope, requestId: string, status: MaintenanceStatus, note?: string, statusSource: "system" | "user_reported" = "user_reported", actorType: "user" | "agent" = "user", sourceMode = "user_reported") {
    const currentRows = await this.db.select<Row>("maintenance_requests", {
      id: `eq.${requestId}`,
      household_id: `eq.${scope.householdId}`,
      limit: "1",
    });
    const current = first(currentRows);
    if (!current) throw new HomeFixError("NOT_FOUND", "That maintenance request was not found in your household.", false, "refresh_dashboard");
    if (current.status === status) return requestFromRow(current);
    assertMaintenanceTransition(current.status, status);
    const rows = await this.db.update<Row>("maintenance_requests", {
      id: `eq.${requestId}`,
      household_id: `eq.${scope.householdId}`,
      status: `eq.${current.status}`,
    }, {
      status,
      status_source: statusSource,
    });
    const row = first(rows);
    if (!row) throw new HomeFixError("CONFLICT", "That maintenance request changed in another session. Refresh and choose the next status again.", true, "refresh_dashboard");
    await this.recordEvent(scope, requestId, "maintenance_status_updated", actorType, sourceMode, { status, note: note ?? null });
    return requestFromRow(row);
  }

  async getRequest(scope: HouseholdScope, requestId: string) {
    const row = first(await this.db.select<Row>("maintenance_requests", {
      id: `eq.${requestId}`,
      household_id: `eq.${scope.householdId}`,
      limit: "1",
    }));
    return row ? requestFromRow(row) : null;
  }

  async createServiceSearch(scope: HouseholdScope, input: ServiceSearchRecordInput) {
    const row = first(await this.db.insert<Row>("service_searches", {
      household_id: scope.householdId,
      maintenance_request_id: input.requestId,
      source_mode: "live_taskrabbit",
      location_snapshot: input.locationSnapshot,
      search_criteria: input.searchCriteria,
      status: input.status,
      result_count: input.resultCount,
      error_code: input.errorCode ?? null,
      retrieved_at: input.retrievedAt ?? new Date().toISOString(),
    }));
    if (!row) throw new HomeFixError("PERSISTENCE_UNAVAILABLE", "The live Taskrabbit search could not be saved.", true, "retry_persistence");
    return { id: row.id, status: row.status, resultCount: row.result_count, retrievedAt: row.retrieved_at, source: "supabase" as const };
  }

  async createServiceOptions(scope: HouseholdScope, options: ServiceOptionRecordInput[]) {
    const saved = [];
    for (const input of options) {
      const row = first(await this.db.insert<Row>("service_options", {
        household_id: scope.householdId,
        service_search_id: input.serviceSearchId,
        maintenance_request_id: input.requestId,
        provider_name: input.providerName,
        title: input.title,
        service_category: input.serviceCategory,
        location_label: input.locationLabel,
        estimate_min: input.estimateMin,
        estimate_max: input.estimateMax,
        price_label: input.priceLabel,
        currency_code: input.currencyCode,
        availability_summary: input.availabilitySummary,
        availability_slots: input.availabilitySlots,
        scoping_questions: input.scopingQuestions,
        task_template_id: input.taskTemplateId,
        source_mode: "live_taskrabbit",
        retrieved_at: input.retrievedAt,
        expires_at: input.expiresAt,
      }));
      if (!row) throw new HomeFixError("PERSISTENCE_UNAVAILABLE", "A live Taskrabbit option could not be saved.", true, "retry_persistence");
      saved.push(optionFromRow(row));
    }
    return saved;
  }

  async latestSearch(scope: HouseholdScope, requestId: string) {
    const row = first(await this.db.select<Row>("service_searches", {
      household_id: `eq.${scope.householdId}`,
      maintenance_request_id: `eq.${requestId}`,
      order: "created_at.desc",
      limit: "1",
    }));
    return row ?? null;
  }

  async evaluateGroupBudget(scope: HouseholdScope, groupId: string, selections: Array<{ requestId: string; optionId: string }>) {
    const group = first(await this.db.select<Row>("intake_groups", {
      id: `eq.${groupId}`,
      household_id: `eq.${scope.householdId}`,
      limit: "1",
    }));
    if (!group) throw new HomeFixError("NOT_FOUND", "That repair group was not found in your household.", false, "refresh_dashboard");
    const requestIds = [...new Set(selections.map((selection) => selection.requestId))];
    if (requestIds.length !== selections.length) throw new HomeFixError("INVALID_INPUT", "Choose only one option per repair in a group comparison.", false, "choose_one_option_per_repair");
    const requests = await this.db.select<Row>("maintenance_requests", {
      household_id: `eq.${scope.householdId}`,
      id: `in.(${requestIds.join(",")})`,
    });
    if (requests.length !== requestIds.length || requests.some((request) => request.intake_group_id !== groupId)) {
      throw new HomeFixError("FORBIDDEN", "Every selected repair must belong to that household repair group.", false, "choose_group_repairs");
    }
    const options = [];
    for (const selection of selections) {
      const selected = await this.listOptions(scope, selection.requestId, [selection.optionId]);
      options.push(selected[0]);
    }
    const currencies = options.map((option) => option.currencyCode).filter((currency): currency is string => Boolean(currency));
    const commonCurrency = currencies.length === options.length && new Set(currencies).size === 1 ? currencies[0] : null;
    const completeEstimates = options.every((option) => typeof option.estimateMax === "number" && Number.isFinite(option.estimateMax));
    const budgetComparable = Boolean(completeEstimates && commonCurrency && (!group.currency_code || group.currency_code === commonCurrency));
    const totalEstimateMax = budgetComparable ? options.reduce((total, option) => total + (option.estimateMax ?? 0), 0) : null;
    const budgetMax = typeof group.group_budget_max === "number" ? group.group_budget_max : null;
    return {
      groupId,
      currencyCode: commonCurrency ?? group.currency_code ?? null,
      budgetMax,
      totalEstimateMax,
      fitsBudget: totalEstimateMax !== null && budgetMax !== null ? totalEstimateMax <= budgetMax : null,
      status: totalEstimateMax === null ? "unknown" as const : "known" as const,
      source: "supabase" as const,
    };
  }

  async listOptions(scope: HouseholdScope, requestId: string, optionIds: string[]) {
    const rows = await this.db.select<Row>("service_options", {
      household_id: `eq.${scope.householdId}`,
      maintenance_request_id: `eq.${requestId}`,
      id: `in.(${optionIds.join(",")})`,
      order: "retrieved_at.desc",
    });
    if (rows.length !== new Set(optionIds).size) {
      throw new HomeFixError("NOT_FOUND", "One or more service options were not found for this repair.", false, "refresh_options");
    }
    return rows.map(optionFromRow);
  }

  async createBookingHandoff(scope: HouseholdScope, requestId: string, optionId: string, bookingUrl: string, idempotencyKey: string, retrievedAt: string) {
    const existing = await this.existingBookingHandoff(scope, idempotencyKey);
    if (existing) return { id: existing.id, status: existing.status, bookingUrl: existing.bookingUrl, retrievedAt, source: "supabase" as const };

    const request = await this.getRequest(scope, requestId);
    if (!request) throw new HomeFixError("NOT_FOUND", "That maintenance request was not found in your household.", false, "refresh_dashboard");
    const option = first(await this.db.select<Row>("service_options", {
      id: `eq.${optionId}`,
      household_id: `eq.${scope.householdId}`,
      maintenance_request_id: `eq.${requestId}`,
      source_mode: "eq.live_taskrabbit",
      limit: "1",
    }));
    if (!option) throw new HomeFixError("NOT_FOUND", "That live service option was not found for this repair.", false, "refresh_options");
    assertMaintenanceTransition(request.status, "handoff_ready");
    const updatedRequest = await this.db.update<Row>("maintenance_requests", {
      id: `eq.${requestId}`,
      household_id: `eq.${scope.householdId}`,
      status: `eq.${request.status}`,
    }, { status: "handoff_ready", status_source: "system" });
    if (!first(updatedRequest)) throw new HomeFixError("CONFLICT", "That repair changed in another session. Refresh and select the option again.", true, "refresh_options");
    let row: Row | undefined;
    try {
      row = first(await this.db.insert<Row>("booking_handoffs", {
        household_id: scope.householdId,
        maintenance_request_id: requestId,
        service_option_id: optionId,
        status: "ready",
        booking_url: bookingUrl,
        source_mode: "live_taskrabbit",
        idempotency_key: idempotencyKey,
      }));
    } catch (error) {
      if (error instanceof HomeFixError && error.code === "CONFLICT") {
        const concurrent = await this.existingBookingHandoff(scope, idempotencyKey);
        if (concurrent) return { id: concurrent.id, status: concurrent.status, bookingUrl: concurrent.bookingUrl, retrievedAt, source: "supabase" as const };
      }
      throw error;
    }
    if (!row) throw new HomeFixError("PERSISTENCE_UNAVAILABLE", "The booking handoff could not be saved.", true, "retry_persistence");
    await this.recordEvent(scope, requestId, "handoff_prepared", "agent", "live_taskrabbit", { handoffId: row.id, optionId, retrievedAt }, row.id);
    return { id: row.id, status: row.status, bookingUrl: row.booking_url, retrievedAt, source: "supabase" as const };
  }

  async existingBookingHandoff(scope: HouseholdScope, idempotencyKey: string) {
    const row = first(await this.db.select<Row>("booking_handoffs", {
      household_id: `eq.${scope.householdId}`,
      idempotency_key: `eq.${idempotencyKey}`,
      limit: "1",
    }));
    return row ? { id: row.id, status: row.status, bookingUrl: row.booking_url, retrievedAt: row.created_at ?? new Date().toISOString(), source: "supabase" as const } : null;
  }

  async listEvents(scope: HouseholdScope, requestId?: string) {
    const query: Record<string, string> = { household_id: `eq.${scope.householdId}`, order: "created_at.desc" };
    if (requestId) query.maintenance_request_id = `eq.${requestId}`;
    return this.db.select<Row>("maintenance_events", query);
  }

  async getHandoff(scope: HouseholdScope, handoffId: string) {
    const rows = await this.db.select<Row>("booking_handoffs", {
      id: `eq.${handoffId}`,
      household_id: `eq.${scope.householdId}`,
      limit: "1",
    });
    return first(rows);
  }

  async markHandoffOpened(scope: HouseholdScope, handoffId: string, idempotencyKey: string) {
    const rows = await this.db.update<Row>("booking_handoffs", {
      id: `eq.${handoffId}`,
      household_id: `eq.${scope.householdId}`,
      status: "eq.ready",
    }, { status: "opened", opened_at: new Date().toISOString() });
    let row = first(rows);
    if (!row) {
      const existing = await this.db.select<Row>("booking_handoffs", {
        id: `eq.${handoffId}`,
        household_id: `eq.${scope.householdId}`,
        limit: "1",
      });
      const alreadyOpened = first(existing);
      if (alreadyOpened?.status === "opened" || alreadyOpened?.status?.startsWith("user_reported_")) {
        return { id: alreadyOpened.id, status: "opened" as const, openedAt: alreadyOpened.opened_at, source: "supabase" as const };
      }
      throw new HomeFixError("NOT_FOUND", "That booking handoff is not ready or does not belong to your household.", false, "refresh_dashboard");
    }
    const requestRows = await this.db.select<Row>("maintenance_requests", {
      id: `eq.${row.maintenance_request_id}`,
      household_id: `eq.${scope.householdId}`,
      limit: "1",
    });
    const request = first(requestRows);
    if (!request) throw new HomeFixError("PERSISTENCE_UNAVAILABLE", "The handoff is missing its maintenance request.", true, "retry_persistence");
    assertMaintenanceTransition(request.status, "awaiting_outcome");
    const updatedRequests = await this.db.update<Row>("maintenance_requests", {
      id: `eq.${request.id}`,
      household_id: `eq.${scope.householdId}`,
    }, { status: "awaiting_outcome", status_source: "user_reported" });
    if (!first(updatedRequests)) throw new HomeFixError("PERSISTENCE_UNAVAILABLE", "The handoff opened, but the repair state could not be updated.", true, "retry_persistence");
    await this.recordEvent(scope, row.maintenance_request_id, "maintenance_status_updated", "user", "user_initiated", { status: "awaiting_outcome" });
    await this.recordEvent(scope, row.maintenance_request_id, "handoff_opened", "user", "user_initiated", { handoffId, idempotencyKey }, row.id);
    return { id: row.id, status: row.status, openedAt: row.opened_at, source: "supabase" as const };
  }

  async recordBookingOutcome(scope: HouseholdScope, handoffId: string, status: string, requestStatus: string, note?: string) {
    const handoffRows = await this.db.update<Row>("booking_handoffs", {
      id: `eq.${handoffId}`,
      household_id: `eq.${scope.householdId}`,
      status: "in.(opened,user_reported_not_booked,user_reported_needs_help)",
    }, { status, outcome_reported_at: new Date().toISOString(), user_reported_note: note ?? null });
    let handoff = first(handoffRows);
    if (!handoff) {
      const existing = first(await this.db.select<Row>("booking_handoffs", {
        id: `eq.${handoffId}`,
        household_id: `eq.${scope.householdId}`,
        limit: "1",
      }));
      if (!existing) throw new HomeFixError("NOT_FOUND", "That booking handoff was not found in your household.", false, "refresh_dashboard");
      if (existing.status !== status) throw new HomeFixError("INVALID_STATE", "That booking outcome has already been recorded.", false, "refresh_dashboard");
      const currentRequest = first(await this.db.select<Row>("maintenance_requests", {
        id: `eq.${existing.maintenance_request_id}`,
        household_id: `eq.${scope.householdId}`,
        limit: "1",
      }));
      if (!currentRequest || currentRequest.status !== requestStatus) throw new HomeFixError("PERSISTENCE_UNAVAILABLE", "The booking outcome is inconsistent with its repair state.", true, "retry_persistence");
      return { handoffId, handoffStatus: existing.status, maintenanceStatus: currentRequest.status, source: "supabase" as const };
    }
    const requestBeforeUpdate = first(await this.db.select<Row>("maintenance_requests", {
      id: `eq.${handoff.maintenance_request_id}`,
      household_id: `eq.${scope.householdId}`,
      limit: "1",
    }));
    if (!requestBeforeUpdate) throw new HomeFixError("PERSISTENCE_UNAVAILABLE", "The handoff is missing its maintenance request.", true, "retry_persistence");
    assertMaintenanceTransition(requestBeforeUpdate.status, requestStatus as MaintenanceStatus);
    const requestRows = await this.db.update<Row>("maintenance_requests", {
      id: `eq.${handoff.maintenance_request_id}`,
      household_id: `eq.${scope.householdId}`,
    }, { status: requestStatus, status_source: "user_reported" });
    if (!first(requestRows)) throw new HomeFixError("PERSISTENCE_UNAVAILABLE", "The booking outcome could not update the maintenance request.", true);
    await this.recordEvent(scope, handoff.maintenance_request_id, "booking_outcome_reported", "user", "user_reported", { handoffId, status, note: note ?? null }, handoff.id);
    return { handoffId, handoffStatus: status, maintenanceStatus: requestStatus, source: "supabase" as const };
  }

  async recordEvent(scope: HouseholdScope, maintenanceRequestId: string | null, eventType: string, actorType: string, sourceMode: string, payload: unknown, bookingHandoffId?: string) {
    await this.db.insert("maintenance_events", {
      household_id: scope.householdId,
      maintenance_request_id: maintenanceRequestId,
      booking_handoff_id: bookingHandoffId ?? null,
      event_type: eventType,
      actor_type: actorType,
      source_mode: sourceMode,
      payload_sanitized: payload,
    });
  }
}
