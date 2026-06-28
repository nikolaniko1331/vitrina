-- Migration 002: Push subscriptions for PWA notifications

create table push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  created_at   timestamptz default now()
);

alter table push_subscriptions enable row level security;

-- Anyone can insert their own subscription
create policy "public inserts push subscription"
  on push_subscriptions for insert
  with check (true);

-- Owner can read subscriptions for their business
create policy "owner reads push subscriptions"
  on push_subscriptions for select
  using (business_id in (select id from businesses where owner_id = auth.uid()));

-- Allow anonymous delete by endpoint (for unsubscribe)
create policy "public deletes own subscription"
  on push_subscriptions for delete
  using (true);
