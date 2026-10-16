create table if not exists public.intake_groups (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  group_budget_max numeric(12, 2) check (group_budget_max is null or group_budget_max >= 0),
  currency_code text,
  created_at timestamptz not null default now()
);

create table if not exists public.maintenance_requests (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  intake_group_id uuid references public.intake_groups(id) on delete set null,
  title text not null check (char_length(title) between 1 and 120),
  description text not null check (char_length(description) between 1 and 1500),
  room text,
  service_category text,
  urgency text not null check (urgency in ('routine', 'soon', 'urgent')),
  status text not null default 'new' check (status in ('new', 'searching', 'options_ready', 'awaiting_user_choice', 'handoff_ready', 'awaiting_outcome', 'booked_user_reported', 'in_progress_user_reported', 'resolved_user_reported', 'cancelled_user_reported', 'needs_attention', 'closed')),
  desired_date date,
  desired_time_window text,
  budget_max numeric(12, 2) check (budget_max is null or budget_max >= 0),
  currency_code text,
  status_source text not null default 'system' check (status_source in ('system', 'user_reported', 'provider_verified')),
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, idempotency_key)
);

create table if not exists public.service_searches (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  maintenance_request_id uuid not null references public.maintenance_requests(id) on delete cascade,
  source_mode text not null check (source_mode = 'live_taskrabbit'),
  location_snapshot jsonb not null default '{}'::jsonb,
  search_criteria jsonb not null default '{}'::jsonb,
  status text not null,
  result_count integer not null default 0 check (result_count >= 0),
  error_code text,
  retrieved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.service_options (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  service_search_id uuid not null references public.service_searches(id) on delete cascade,
  maintenance_request_id uuid not null references public.maintenance_requests(id) on delete cascade,
  provider_name text,
  title text not null,
  service_category text not null,
  location_label text,
  estimate_min numeric(12, 2),
  estimate_max numeric(12, 2),
  price_label text,
  currency_code text,
  availability_summary text,
  availability_slots jsonb not null default '[]'::jsonb,
  scoping_questions jsonb not null default '[]'::jsonb,
  task_template_id text,
  booking_url text,
  source_mode text not null check (source_mode = 'live_taskrabbit'),
  source_payload_sanitized jsonb,
  retrieved_at timestamptz not null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.booking_handoffs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  maintenance_request_id uuid not null references public.maintenance_requests(id) on delete cascade,
  service_option_id uuid not null references public.service_options(id) on delete cascade,
  status text not null check (status in ('draft', 'ready', 'opened', 'user_reported_booked', 'user_reported_not_booked', 'user_reported_cancelled', 'user_reported_needs_help', 'expired', 'error')),
  booking_url text not null,
  source_mode text not null check (source_mode = 'live_taskrabbit'),
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  outcome_reported_at timestamptz,
  user_reported_note text,
  idempotency_key text not null unique
);

create table if not exists public.maintenance_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  maintenance_request_id uuid references public.maintenance_requests(id) on delete cascade,
  booking_handoff_id uuid references public.booking_handoffs(id) on delete cascade,
  event_type text not null,
  actor_type text not null check (actor_type in ('user', 'agent', 'system', 'provider')),
  source_mode text not null,
  payload_sanitized jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists intake_groups_household_idx on public.intake_groups(household_id, created_at desc);
create index if not exists maintenance_requests_household_status_idx on public.maintenance_requests(household_id, status, updated_at desc);
create index if not exists service_searches_request_idx on public.service_searches(maintenance_request_id, created_at desc);
create index if not exists service_options_request_idx on public.service_options(maintenance_request_id, retrieved_at desc);
create index if not exists booking_handoffs_request_idx on public.booking_handoffs(maintenance_request_id, created_at desc);
create index if not exists maintenance_events_household_idx on public.maintenance_events(household_id, created_at desc);

drop trigger if exists maintenance_requests_set_updated_at on public.maintenance_requests;
create trigger maintenance_requests_set_updated_at
before update on public.maintenance_requests
for each row execute function public.set_updated_at();

do $$
declare
  table_name text;
begin
  foreach table_name in array array['intake_groups', 'maintenance_requests', 'service_searches', 'service_options', 'booking_handoffs', 'maintenance_events'] loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end;
$$;

drop policy if exists intake_groups_member_all on public.intake_groups;
create policy intake_groups_member_all on public.intake_groups
for all to authenticated
using (exists (select 1 from public.household_members hm where hm.household_id = intake_groups.household_id and hm.user_id = (select auth.uid())))
with check (exists (select 1 from public.household_members hm where hm.household_id = intake_groups.household_id and hm.user_id = (select auth.uid())));

drop policy if exists maintenance_requests_member_all on public.maintenance_requests;
create policy maintenance_requests_member_all on public.maintenance_requests
for all to authenticated
using (exists (select 1 from public.household_members hm where hm.household_id = maintenance_requests.household_id and hm.user_id = (select auth.uid())))
with check (exists (select 1 from public.household_members hm where hm.household_id = maintenance_requests.household_id and hm.user_id = (select auth.uid())));

drop policy if exists service_searches_member_all on public.service_searches;
create policy service_searches_member_all on public.service_searches
for all to authenticated
using (exists (select 1 from public.household_members hm where hm.household_id = service_searches.household_id and hm.user_id = (select auth.uid())))
with check (exists (select 1 from public.household_members hm where hm.household_id = service_searches.household_id and hm.user_id = (select auth.uid())));

drop policy if exists service_options_member_all on public.service_options;
create policy service_options_member_all on public.service_options
for all to authenticated
using (exists (select 1 from public.household_members hm where hm.household_id = service_options.household_id and hm.user_id = (select auth.uid())))
with check (exists (select 1 from public.household_members hm where hm.household_id = service_options.household_id and hm.user_id = (select auth.uid())));

drop policy if exists booking_handoffs_member_all on public.booking_handoffs;
create policy booking_handoffs_member_all on public.booking_handoffs
for all to authenticated
using (exists (select 1 from public.household_members hm where hm.household_id = booking_handoffs.household_id and hm.user_id = (select auth.uid())))
with check (exists (select 1 from public.household_members hm where hm.household_id = booking_handoffs.household_id and hm.user_id = (select auth.uid())));

drop policy if exists maintenance_events_member_all on public.maintenance_events;
create policy maintenance_events_member_all on public.maintenance_events
for all to authenticated
using (exists (select 1 from public.household_members hm where hm.household_id = maintenance_events.household_id and hm.user_id = (select auth.uid())))
with check (exists (select 1 from public.household_members hm where hm.household_id = maintenance_events.household_id and hm.user_id = (select auth.uid())));
