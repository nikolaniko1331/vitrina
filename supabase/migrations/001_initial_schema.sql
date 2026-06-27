-- Vitrina: Multi-tenant booking SaaS
-- Migration 001: Initial schema

-- ── BUSINESSES ────────────────────────────────────────────────────────────────
create table businesses (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  owner_id    uuid references auth.users(id),
  name        text not null,
  config      jsonb not null default '{}',
  created_at  timestamptz default now()
);

-- ── STAFF ─────────────────────────────────────────────────────────────────────
create table staff (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name        text not null,
  color       text default '#888888',
  active      boolean default true
);

-- ── SERVICES ──────────────────────────────────────────────────────────────────
create table services (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  name         text not null,
  duration_min integer not null default 60,
  price        numeric(10,2),
  pool         jsonb not null default '[]',  -- array of staff ids
  active       boolean default true
);

-- ── BOOKINGS ──────────────────────────────────────────────────────────────────
create type booking_status as enum ('pending', 'confirmed', 'cancelled');

create table bookings (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  service_id    uuid references services(id),
  staff_id      uuid references staff(id),
  client_name   text not null,
  client_phone  text not null,
  client_email  text not null,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  status        booking_status default 'pending',
  note          text,
  created_at    timestamptz default now()
);

-- ── STAFF BLOCKS (vacation, lunch, etc.) ─────────────────────────────────────
create table staff_blocks (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references staff(id) on delete cascade,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  reason      text
);

-- ── ROW LEVEL SECURITY ────────────────────────────────────────────────────────
alter table businesses   enable row level security;
alter table staff        enable row level security;
alter table services     enable row level security;
alter table bookings     enable row level security;
alter table staff_blocks enable row level security;

-- Owners can manage their own business
create policy "owner manages business"
  on businesses for all
  using (owner_id = auth.uid());

-- Staff/services/blocks: owner of the parent business
create policy "owner manages staff"
  on staff for all
  using (business_id in (select id from businesses where owner_id = auth.uid()));

create policy "owner manages services"
  on services for all
  using (business_id in (select id from businesses where owner_id = auth.uid()));

create policy "owner manages bookings"
  on bookings for all
  using (business_id in (select id from businesses where owner_id = auth.uid()));

create policy "owner manages blocks"
  on staff_blocks for all
  using (staff_id in (
    select s.id from staff s
    join businesses b on b.id = s.business_id
    where b.owner_id = auth.uid()
  ));

-- Anonymous read: widget needs to fetch config + staff + services by slug
create policy "public reads business config"
  on businesses for select
  using (true);

create policy "public reads staff"
  on staff for select
  using (active = true);

create policy "public reads services"
  on services for select
  using (active = true);

-- Anonymous insert: clients can create bookings
create policy "public creates bookings"
  on bookings for insert
  with check (true);

-- Public read bookings (for availability check — only starts_at, ends_at, staff_id)
create policy "public reads bookings for availability"
  on bookings for select
  using (status != 'cancelled');

-- ── SEED: Salon Mia ───────────────────────────────────────────────────────────
insert into businesses (slug, name, config) values (
  'salon-mia',
  'Салон Миа',
  '{
    "tagline": "Убавина со страст",
    "subtitle": "Стручни стилисти · Луксузно искуство",
    "ctaLabel": "Резервирај термин",
    "city": "Скопје",
    "hours": "до 19:00",
    "rating": "4.9",
    "reviews": "127",
    "primaryColor": "#6B3F6E",
    "primaryTint": "#F3EBF4",
    "accentColor": "#C9A96E",
    "darkColor": "#1A0F1B",
    "approvalMode": false,
    "whatsapp": "38971000000"
  }'
);
