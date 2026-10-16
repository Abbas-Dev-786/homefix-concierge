create extension if not exists pgcrypto;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (user_id)
);

create table if not exists public.home_profiles (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null unique references public.households(id) on delete cascade,
  property_type text,
  city text,
  region text,
  postal_code text,
  country_code text,
  currency_code text,
  preferred_service_windows jsonb not null default '[]'::jsonb,
  typical_budget_amount numeric(12, 2) check (typical_budget_amount is null or typical_budget_amount >= 0),
  home_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint home_profiles_no_sensitive_fields check (
    home_summary is null or (
      home_summary !~* '(password|passcode|access code|door code|alarm code|credit card|cvv|payment|ssn|social security)'
    )
  )
);

create index if not exists household_members_user_id_idx on public.household_members(user_id);
create index if not exists home_profiles_household_id_idx on public.home_profiles(household_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists households_set_updated_at on public.households;
create trigger households_set_updated_at
before update on public.households
for each row execute function public.set_updated_at();

drop trigger if exists home_profiles_set_updated_at on public.home_profiles;
create trigger home_profiles_set_updated_at
before update on public.home_profiles
for each row execute function public.set_updated_at();

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.home_profiles enable row level security;

drop policy if exists households_member_select on public.households;
create policy households_member_select on public.households
for select to authenticated
using (exists (
  select 1 from public.household_members hm
  where hm.household_id = households.id and hm.user_id = (select auth.uid())
));

drop policy if exists household_members_self_select on public.household_members;
create policy household_members_self_select on public.household_members
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists home_profiles_member_select on public.home_profiles;
create policy home_profiles_member_select on public.home_profiles
for select to authenticated
using (exists (
  select 1 from public.household_members hm
  where hm.household_id = home_profiles.household_id and hm.user_id = (select auth.uid())
));

drop policy if exists home_profiles_member_insert on public.home_profiles;
create policy home_profiles_member_insert on public.home_profiles
for insert to authenticated
with check (exists (
  select 1 from public.household_members hm
  where hm.household_id = home_profiles.household_id and hm.user_id = (select auth.uid())
));

drop policy if exists home_profiles_member_update on public.home_profiles;
create policy home_profiles_member_update on public.home_profiles
for update to authenticated
using (exists (
  select 1 from public.household_members hm
  where hm.household_id = home_profiles.household_id and hm.user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.household_members hm
  where hm.household_id = home_profiles.household_id and hm.user_id = (select auth.uid())
));

create or replace function public.create_household_for_user(p_user_id uuid)
returns table (household_id uuid, display_name text, member_role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select hm.household_id into v_household_id
  from public.household_members hm
  where hm.user_id = p_user_id
  limit 1;

  if v_household_id is null then
    insert into public.households(display_name)
    values ('My household')
    returning id into v_household_id;

    insert into public.household_members(household_id, user_id, role)
    values (v_household_id, p_user_id, 'owner')
    on conflict (user_id) do nothing;

    select hm.household_id into v_household_id
    from public.household_members hm
    where hm.user_id = p_user_id
    limit 1;
  end if;

  return query
  select h.id, h.display_name, hm.role
  from public.households h
  join public.household_members hm on hm.household_id = h.id
  where h.id = v_household_id and hm.user_id = p_user_id;
end;
$$;

revoke all on function public.create_household_for_user(uuid) from public, anon, authenticated;
grant execute on function public.create_household_for_user(uuid) to service_role;
