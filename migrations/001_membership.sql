-- ============================================================================
-- Migration 001 — Arty Club & CURE Club membership
-- ============================================================================

-- Core members table — one row per person, regardless of club configuration.
create table members (
  email                          text primary key,
  member_number                  text unique not null,
  name                           text not null,

  -- Club state. Two booleans handle solo / dual cleanly.
  arty_active                    boolean not null default false,
  cure_active                    boolean not null default false,
  arty_joined_at                 timestamptz,
  cure_joined_at                 timestamptz,
  arty_cancelled_at              timestamptz,
  cure_cancelled_at              timestamptz,

  -- Stripe identity
  stripe_customer_id             text,
  stripe_arty_subscription_id    text,
  stripe_cure_subscription_id    text,

  -- Soft data
  marketing_consent              boolean not null default false,
  signup_message                 text,             -- optional textarea content from signup form
  notes                          text,             -- staff notes
  ic_student_email               text,             -- nullable; links to students.email when same person

  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now()
);

create index members_member_number_idx        on members (member_number);
create index members_stripe_customer_id_idx   on members (stripe_customer_id);
create index members_email_lower_idx          on members (lower(email));

-- Member number generation: MEM-0001, MEM-0002, ...
create or replace function generate_member_number()
returns trigger as $$
declare
  next_num int;
begin
  select coalesce(
    max(cast(substring(member_number from 'MEM-(\d+)') as int)),
    0
  ) + 1
    into next_num
    from members;
  new.member_number := 'MEM-' || lpad(next_num::text, 4, '0');
  return new;
end;
$$ language plpgsql;

create trigger members_set_number
  before insert on members
  for each row
  when (new.member_number is null)
  execute function generate_member_number();

-- Auto-touch updated_at
create or replace function members_touch_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger members_updated_at
  before update on members
  for each row
  execute function members_touch_updated_at();

-- ----------------------------------------------------------------------------
-- Audit log
-- ----------------------------------------------------------------------------
create table membership_events (
  id              uuid primary key default gen_random_uuid(),
  member_email    text references members(email) on delete set null,
  event_type      text not null,
  -- event_type values used by the webhook:
  --   joined_arty            joined_cure            joined_both
  --   cancelled_arty         cancelled_cure         cancelled_both
  --   switched_to_both       switched_to_solo
  --   payment_failed         reinstated
  source          text,           -- 'stripe_webhook' | 'admin' | 'direct'
  metadata        jsonb,          -- raw Stripe event payload or admin context
  created_at      timestamptz not null default now()
);

create index membership_events_member_email_idx
  on membership_events (member_email, created_at desc);

-- ----------------------------------------------------------------------------
-- The hot path: every other system calls this.
-- ----------------------------------------------------------------------------
create or replace function is_active_member(p_email text)
returns table (
  is_member       boolean,
  arty            boolean,
  cure            boolean,
  member_number   text,
  name            text
) as $$
  select
    (m.arty_active or m.cure_active)  as is_member,
    m.arty_active                     as arty,
    m.cure_active                     as cure,
    m.member_number,
    m.name
  from members m
  where lower(m.email) = lower(p_email);
$$ language sql stable;
