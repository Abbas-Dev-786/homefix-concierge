import assert from "node:assert/strict";
import { test } from "node:test";

import { HomeFixError } from "../src/domain/errors.js";
import { assertMaintenanceTransition } from "../src/domain/maintenance-state.js";
import { HomeFixRepository, type HouseholdScope } from "../src/repositories/homefix-repository.js";

type Row = Record<string, any>;

const scopeA: HouseholdScope = { householdId: "household-a", displayName: "A", role: "owner" };

function requestRow(overrides: Row = {}): Row {
  return {
    id: "request-a",
    household_id: "household-a",
    title: "Leaking tap",
    description: "Kitchen tap is leaking",
    room: "Kitchen",
    service_category: "plumbing",
    urgency: "routine",
    status: "new",
    desired_date: null,
    desired_time_window: null,
    budget_max: null,
    currency_code: null,
    status_source: "system",
    intake_group_id: null,
    idempotency_key: "repair-key-1",
    created_at: "2026-10-16T00:00:00.000Z",
    updated_at: "2026-10-16T00:00:00.000Z",
    ...overrides,
  };
}

class FakeDb {
  rows: Record<string, Row[]> = {
    household_members: [
      { household_id: "household-a", user_id: "user-a", role: "owner" },
      { household_id: "household-b", user_id: "user-b", role: "owner" },
    ],
    households: [
      { id: "household-a", display_name: "A" },
      { id: "household-b", display_name: "B" },
    ],
    home_profiles: [],
    maintenance_requests: [],
    booking_handoffs: [],
    maintenance_events: [],
    intake_groups: [],
    service_searches: [],
    service_options: [],
  };
  forceConflict = false;
  private sequence = 0;

  async select<T>(table: string, query: Record<string, string>): Promise<T[]> {
    let result = [...(this.rows[table] ?? [])];
    for (const [column, expression] of Object.entries(query)) {
      if (["limit", "order", "select"].includes(column)) continue;
      if (expression.startsWith("eq.")) result = result.filter((row) => String(row[column]) === expression.slice(3));
      if (expression.startsWith("in.(")) {
        const values = expression.slice(4, -1).split(",");
        result = result.filter((row) => values.includes(String(row[column])));
      }
      if (expression.startsWith("not.in.(")) {
        const values = expression.slice(8, -1).split(",");
        result = result.filter((row) => !values.includes(String(row[column])));
      }
    }
    if (query.limit === "1") result = result.slice(0, 1);
    return result as T[];
  }

  async insert<T>(table: string, row: Row): Promise<T[]> {
    if (table === "maintenance_requests" && row.idempotency_key) {
      const duplicate = this.rows[table].find((item) => item.household_id === row.household_id && item.idempotency_key === row.idempotency_key);
      if (duplicate || this.forceConflict) {
        this.forceConflict = false;
        throw new HomeFixError("CONFLICT", "duplicate", false);
      }
    }
    const stored = { id: row.id ?? `${table}-${++this.sequence}`, ...row };
    this.rows[table] ??= [];
    this.rows[table].push(stored);
    return [stored] as T[];
  }

  async upsert<T>(table: string, row: Row, conflictColumn: string): Promise<T[]> {
    const existing = this.rows[table].find((item) => item[conflictColumn] === row[conflictColumn]);
    if (existing) Object.assign(existing, row);
    else {
      const stored = { id: `${table}-${++this.sequence}`, ...row };
      this.rows[table].push(stored);
      return [stored] as T[];
    }
    return [existing] as T[];
  }

  async update<T>(table: string, query: Record<string, string>, patch: Row): Promise<T[]> {
    const matches = await this.select<Row>(table, query);
    for (const match of matches) Object.assign(match, patch);
    return matches as T[];
  }

  async delete<T>(table: string, query: Record<string, string>): Promise<T[]> {
    const matches = await this.select<Row>(table, query);
    this.rows[table] = (this.rows[table] ?? []).filter((row) => !matches.includes(row));
    return matches as T[];
  }

  async rpc<T>(functionName: string, body: Row): Promise<T[]> {
    assert.equal(functionName, "create_household_for_user");
    const member = this.rows.household_members.find((item) => item.user_id === body.p_user_id);
    if (member) return [{ household_id: member.household_id, display_name: "A", member_role: member.role }] as T[];
    throw new Error("test fixture only supports existing members");
  }
}

function repository(db: FakeDb) {
  return new HomeFixRepository(db as never);
}

test("verified user scope isolates households", async () => {
  const db = new FakeDb();
  const repo = repository(db);
  assert.deepEqual(await repo.resolveHousehold("user-a"), scopeA);
  assert.equal(await repo.resolveHousehold("unknown-user"), null);
  assert.notDeepEqual(await repo.resolveHousehold("user-a"), await repo.resolveHousehold("user-b"));
});

test("partial profile edits preserve previously saved fields", async () => {
  const db = new FakeDb();
  db.rows.home_profiles.push({
    id: "profile-a",
    household_id: "household-a",
    property_type: "townhouse",
    city: "Pune",
    region: "MH",
    postal_code: "411001",
    country_code: "IN",
    currency_code: "INR",
    preferred_service_windows: ["Saturday morning"],
    typical_budget_amount: 250,
    home_summary: "Two-floor home",
  });
  const saved = await repository(db).saveProfile(scopeA, { city: "Mumbai" });
  assert.ok(saved);
  assert.equal(saved.city, "Mumbai");
  assert.equal(saved.propertyType, "townhouse");
  assert.equal(saved.typicalBudgetAmount, 250);
});

test("repair request idempotency returns the committed row after a conflict", async () => {
  const db = new FakeDb();
  const repo = repository(db);
  const input = { title: "Leaking tap", description: "Kitchen tap is leaking", urgency: "routine" as const, idempotencyKey: "repair-key-1" };
  db.rows.maintenance_requests.push(requestRow());
  db.forceConflict = true;
  const result = await repo.createRepairRequest(scopeA, input);
  assert.equal(result.id, "request-a");
  assert.equal(db.rows.maintenance_requests.length, 1);
});

test("repository enforces legal maintenance transitions", async () => {
  const db = new FakeDb();
  db.rows.maintenance_requests.push(requestRow());
  await assert.rejects(
    () => repository(db).updateRequestStatus(scopeA, "request-a", "closed"),
    (error: unknown) => error instanceof HomeFixError && error.code === "INVALID_STATE"
  );
  assertMaintenanceTransition("new", "searching");
});

test("opening a handoff updates the repair and is safe to repeat", async () => {
  const db = new FakeDb();
  db.rows.maintenance_requests.push(requestRow({ status: "handoff_ready", idempotency_key: null }));
  db.rows.booking_handoffs.push({
    id: "handoff-a",
    household_id: "household-a",
    maintenance_request_id: "request-a",
    status: "ready",
    opened_at: null,
  });
  const repo = repository(db);
  const firstOpen = await repo.markHandoffOpened(scopeA, "handoff-a", "open-key-1");
  const secondOpen = await repo.markHandoffOpened(scopeA, "handoff-a", "open-key-1");
  assert.equal(firstOpen.status, "opened");
  assert.equal(secondOpen.status, "opened");
  assert.equal(db.rows.maintenance_requests[0].status, "awaiting_outcome");
  assert.equal(db.rows.booking_handoffs.length, 1);
});

test("user reported booking outcome is recorded once and remains truthful", async () => {
  const db = new FakeDb();
  db.rows.maintenance_requests.push(requestRow({ status: "awaiting_outcome", idempotency_key: null }));
  db.rows.booking_handoffs.push({
    id: "handoff-a",
    household_id: "household-a",
    maintenance_request_id: "request-a",
    status: "opened",
  });
  const repo = repository(db);
  const firstOutcome = await repo.recordBookingOutcome(scopeA, "handoff-a", "user_reported_booked", "booked_user_reported");
  const repeatedOutcome = await repo.recordBookingOutcome(scopeA, "handoff-a", "user_reported_booked", "booked_user_reported");
  assert.equal(firstOutcome.handoffStatus, "user_reported_booked");
  assert.equal(repeatedOutcome.maintenanceStatus, "booked_user_reported");
  assert.equal(db.rows.booking_handoffs[0].status, "user_reported_booked");
});

test("household export and deletion stay within the verified household scope", async () => {
  const db = new FakeDb();
  db.rows.home_profiles.push({ household_id: "household-a", home_summary: "Safe summary" });
  db.rows.maintenance_events.push({ household_id: "household-a", payload_sanitized: { authorization: "Bearer hidden" } });
  const repo = repository(db);
  const exported = await repo.exportHouseholdData(scopeA);
  assert.equal(exported.household?.id, "household-a");
  assert.equal(exported.homeProfiles.length, 1);
  assert.deepEqual(exported.maintenanceEvents[0]?.payload_sanitized, { authorization: "[REDACTED]" });
  const deleted = await repo.deleteHousehold(scopeA);
  assert.equal(deleted.deleted, true);
  assert.equal(db.rows.households.some((row) => row.id === "household-a"), false);
  assert.equal(db.rows.households.some((row) => row.id === "household-b"), true);
});
