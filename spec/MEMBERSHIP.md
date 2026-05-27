# MEMBERSHIP.md

**The Arty Club & CURE Club — membership system specification**
Single source of truth for the `arty-cure-membership` build. Every /goal command in Claude Code references this document. Treat it as canon.

Version: 2.0 · May 2026
Repository: `the-alcademy/arty-cure-membership` (PRIVATE)
Live URL (target): `member.theartyst.co.uk`

> **v2 note** — v2 restructures the CURE Club. Arty Club stays self-serve at £5/month, broad audience. CURE Club becomes a £50/month inner-circle membership, by application + a ~45-minute in-person conversation with Matthew. The old "Both Clubs" SKU is retired — CURE includes Arty by definition. A new **Founder** tier sits alongside, granted only by direct invitation, with no Stripe subscription. v1 §3.1 (migration 001) is unchanged; v2 layers a new migration 002 on top and adds new pages, endpoints, and a three-variant welcome email. The Stripe webhook continues to own `arty_active` / `cure_active` — `tier` and `founder_number` are supplementary fields managed by the application + admin flow.

---

## 1. Overview

A standalone Vercel app handling subscription signups, identity, lookup, applications, and admin tooling for the Artyst's two club memberships:

- **Arty Club** — Arts, £5/month. Self-serve via Stripe Checkout. Broad audience.
- **CURE Club** — Wellbeing, £50/month. By application + in-person conversation with Matthew. Inner circle.
- **Founder members** — by direct Matthew invitation only. Admin-only mechanism, `tier='cure_founder'`, `founder_number FND-XXXX`. No Stripe subscription. Not shown on the public site.

CURE includes Arty by definition: a CURE member (paid or founder) gets every Arty benefit automatically. There is no separate "Both" tier; the old `STRIPE_PRICE_BOTH` SKU is retired.

The app does seven things and nothing else:

1. Lets a person sign up for Arty Club via Stripe Checkout (self-serve).
2. Lets a person apply for CURE Club via a questionnaire + reviewed conversation (not self-serve).
3. Receives Stripe webhooks and maintains the source-of-truth `members` table in Supabase.
4. Exposes `GET /api/membership/check?email=...` — "is this person a member, and of what?"
5. Sends a welcome email via Resend after successful signup or CURE acceptance — three variants (see §7).
6. Provides `/manage` for self-service Stripe Customer Portal redirects.
7. Provides admin pages to review CURE applications and grant founder status.

**Out of scope for v2** (do not build, do not infer):

- Member portal beyond Stripe Customer Portal + the token-authenticated /manage view
- Event ticket purchase or pricing logic (lives in CA-017)
- Till discount application (lives in Epos Now, manual for v2)
- BedePlex / IC integration (later)
- Twyndle directory visibility (later)
- Member-only event programming (later)
- Bene multipliers, guest-pass tracking (layer-2 benefits)
- Email marketing beyond the welcome email (use existing list infrastructure)
- LoyaltyDog bridge (separate /goal, when API access lands)

---

## 2. Repository setup

### 2.1 Stack

- React 18 + Vite + TypeScript (matches CA-010, CA-017 convention)
- Vercel hosting + serverless functions (`api/` directory)
- Supabase for the database (shared project with other OtherSyde CAs)
- Stripe for subscriptions and webhooks
- Resend for transactional email

### 2.2 `.env.example`

This file lives at repo root. It documents the *names* of required environment variables. **It never contains real values.**

```
# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=        # server-only — writes to members table. NEVER expose client-side.

# Stripe
STRIPE_SECRET_KEY=                # sk_live_... or sk_test_...
STRIPE_WEBHOOK_SECRET=            # whsec_... from Stripe dashboard → Developers → Webhooks
STRIPE_PRICE_ARTY=                # price_... from "Arty Club Monthly" product
STRIPE_PRICE_CURE=                # price_... from "CURE Club Monthly" product (v2: £50/mo)
STRIPE_PRICE_BOTH=                # RETIRED in v2 — env var name preserved for backward compat; the
                                  # variable is no longer read by any code path. Safe to leave blank.

# Resend
RESEND_API_KEY=
RESEND_FROM_EMAIL=members@theartyst.co.uk

# Admin auth — guards /api/admin/* and the /admin/* pages.
# Long random hex (>= 32 chars). Sent as `Authorization: Bearer <token>`.
ADMIN_API_TOKEN=

# Member magic-link tokens — HMAC secret for /me + /manage?token= + cancel + upgrade.
MEMBER_TOKEN_SECRET=              # >= 32 chars random hex.

# Site
SITE_URL=https://member.theartyst.co.uk
```

### 2.3 `.gitignore`

This file lives at repo root. It exists from the first commit. Anything that could leak a secret stays out of Git, full stop.

```
# Dependencies
node_modules/
.pnp/

# Build output
dist/
build/
.vite/

# Environment variables — NEVER commit
.env
.env.local
.env.*.local
.env.development
.env.production

# Editor / OS
.vscode/
.idea/
*.swp
*.swo
.DS_Store
Thumbs.db

# Testing
coverage/
.nyc_output/

# Vercel
.vercel/

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
```

### 2.4 Directory layout

```
arty-cure-membership/
├── .env.example
├── .gitignore
├── README.md
├── package.json
├── vite.config.ts
├── tsconfig.json
├── vercel.json
├── spec/
│   └── MEMBERSHIP.md               (this file)
├── migrations/
│   ├── 001_membership.sql          (v1 — unchanged)
│   └── 002_cure_restructure.sql    (v2 — tier + founder_number + cure_applications)
├── scripts/
│   └── test-schema.ts
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── pages/
│   │   ├── index.tsx               (signup page — two cards in v2)
│   │   ├── welcome.tsx
│   │   ├── manage.tsx
│   │   ├── me.tsx                  (PWA member pass)
│   │   ├── apply.tsx               (new in v2 — CURE application, 5 questions)
│   │   ├── upgrade.tsx             (new in v2 — Arty → CURE upgrade, 3 questions)
│   │   └── admin/
│   │       ├── applications.tsx    (new in v2 — review queue)
│   │       └── grant-founder.tsx   (new in v2 — promote to cure_founder)
│   ├── lib/
│   │   ├── deriveTier.ts           (shared tier-derivation helper)
│   │   └── memberToken.ts          (HMAC sign/verify)
│   ├── styles/
│   │   ├── tokens.css              (CSS custom properties from CA-023)
│   │   └── global.css
│   └── content/
│       ├── clubs.json              (Arty / CURE descriptions — no "both" entry in v2)
│       ├── benefits.json           (per-tier benefits list)
│       └── apply-questions.json    (5 questions for /apply, 3 for /upgrade)
├── api/
│   ├── checkout/
│   │   └── create.ts               (Arty Stripe Checkout; CURE only after admin accept)
│   ├── membership/
│   │   ├── check.ts                (the hot path — lookup endpoint)
│   │   ├── by-session.ts           (welcome page polls this)
│   │   ├── manage.ts               (creates Customer Portal sessions)
│   │   ├── me.ts                   (token → pass data)
│   │   ├── cancel.ts               (token → cancel-at-period-end)
│   │   ├── apply.ts                (new in v2 — public CURE application)
│   │   └── upgrade.ts              (new in v2 — token-auth Arty → CURE upgrade)
│   ├── admin/
│   │   ├── applications.ts         (new in v2 — GET pending list, POST decide)
│   │   └── grant-founder.ts        (new in v2 — promote to cure_founder)
│   ├── _lib/
│   │   └── memberToken.ts          (same HMAC code, server-side import)
│   └── stripe-webhook.ts           (single webhook handler for all events)
└── tests/
    ├── api-check.test.ts
    ├── checkout.test.ts
    ├── webhook.test.ts
    ├── welcome.test.tsx
    ├── signup.test.tsx
    ├── api-manage.test.ts
    ├── api-by-session.test.ts
    ├── api-cancel.test.ts
    ├── api-apply.test.ts           (new in v2)
    ├── api-upgrade.test.ts         (new in v2)
    ├── api-admin-applications.test.ts   (new in v2)
    ├── api-admin-grant-founder.test.ts  (new in v2)
    ├── deriveTier.test.ts
    ├── manage.test.tsx
    └── fixtures/
        ├── subscription-created.json
        ├── subscription-updated.json
        ├── subscription-deleted.json
        ├── checkout-session-completed.json
        └── payment-failed.json
```

---

## 3. Database schema

All migrations are SQL files in `/migrations/`. Run them in numbered order via the Supabase SQL editor (manual) or via the `scripts/run-migrations.ts` helper (later).

### 3.1 `001_membership.sql`

**Unchanged from v1.** Establishes `members`, `membership_events`, `is_active_member()`. Re-stated here for completeness.

```sql
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
  signup_message                 text,
  notes                          text,
  ic_student_email               text,

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

-- Audit log
create table membership_events (
  id              uuid primary key default gen_random_uuid(),
  member_email    text references members(email) on delete set null,
  event_type      text not null,
  source          text,
  metadata        jsonb,
  created_at      timestamptz not null default now()
);

create index membership_events_member_email_idx
  on membership_events (member_email, created_at desc);

-- Hot path: every other system calls this.
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
```

### 3.2 `002_cure_restructure.sql`

New in v2. Adds the `tier` enum-as-CHECK, `founder_number`, links members to their CURE application, and creates the `cure_applications` table.

```sql
-- ============================================================================
-- Migration 002 — CURE restructure (May 2026)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- cure_applications — public-facing application queue for CURE Club.
-- Created BEFORE the FK on members.cure_application_id can reference it.
-- ----------------------------------------------------------------------------
create table cure_applications (
  id                      uuid primary key default gen_random_uuid(),
  email                   text not null,
  name                    text not null,

  -- For upgrades from Arty: the existing member's email. Null for fresh apps.
  existing_member_email   text references members(email) on delete set null,

  -- The 5 questions (or 3, for upgrades) as a JSON object keyed by question id.
  -- See src/content/apply-questions.json for canonical shape.
  questionnaire           jsonb not null,

  status                  text not null default 'pending'
                            check (status in ('pending', 'accepted', 'rejected', 'withdrawn')),

  decided_at              timestamptz,
  decided_by              text,                    -- admin identifier (e.g. 'matthew')
  decision_notes          text,                    -- internal-only context for the decision

  -- After accept: the Stripe Checkout session URL sent to the applicant.
  -- Null on pending / rejected / withdrawn. Useful for resend-on-request.
  checkout_session_url    text,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index cure_applications_status_created_idx
  on cure_applications (status, created_at desc);
create index cure_applications_email_lower_idx
  on cure_applications (lower(email));

-- Auto-touch updated_at (same pattern as members).
create trigger cure_applications_updated_at
  before update on cure_applications
  for each row
  execute function members_touch_updated_at();

-- ----------------------------------------------------------------------------
-- members — new columns
-- ----------------------------------------------------------------------------

-- Supplementary tier classifier. Set by the application + admin flow.
-- Distinct from arty_active / cure_active which remain the live "is this
-- person currently in good standing" signal driven by the Stripe webhook.
--   arty           — paid Arty subscriber (default tier on plain Arty signup)
--   cure           — paid CURE subscriber (admin-accepted application →
--                    Stripe Checkout success → tier flipped to 'cure')
--   cure_founder   — founder member, granted by Matthew. No Stripe sub.
alter table members
  add column tier text
    check (tier in ('arty', 'cure', 'cure_founder'));

-- Founder member number — separate sequence from MEM-XXXX.
-- Format: FND-XXXX, zero-padded to 4 digits. Null for non-founders.
alter table members
  add column founder_number text unique;

-- Link back to the cure_applications row, if the member came via an
-- application. Null for plain Arty signups and direct founder grants.
alter table members
  add column cure_application_id uuid
    references cure_applications(id) on delete set null;

create index members_tier_idx              on members (tier);
create index members_founder_number_idx    on members (founder_number);

-- Founder number generation: FND-0001, FND-0002, ...
create or replace function generate_founder_number()
returns trigger as $$
declare
  next_num int;
begin
  select coalesce(
    max(cast(substring(founder_number from 'FND-(\d+)') as int)),
    0
  ) + 1
    into next_num
    from members;
  new.founder_number := 'FND-' || lpad(next_num::text, 4, '0');
  return new;
end;
$$ language plpgsql;

-- Fires only when an admin sets tier='cure_founder' and founder_number is null.
create trigger members_set_founder_number
  before insert or update on members
  for each row
  when (new.tier = 'cure_founder' and new.founder_number is null)
  execute function generate_founder_number();

-- ----------------------------------------------------------------------------
-- Back-fill tier for the rows that exist before this migration runs.
-- arty_active && cure_active was the v1 "Both" case — collapse to 'cure',
-- because in v2 CURE includes Arty by definition.
-- ----------------------------------------------------------------------------
update members set tier = 'cure' where cure_active = true and tier is null;
update members set tier = 'arty' where arty_active = true and cure_active = false and tier is null;
```

### 3.3 Verification script — `scripts/test-schema.ts`

Run with: `npx tsx scripts/test-schema.ts`. Connects to the test Supabase project (env vars), runs both migrations in order, performs the following assertions, exits 0 on success or non-zero on first failure:

1. After `insert into members (email, name, arty_active) values ('test1@example.com', 'Test One', true)` — the inserted row has `member_number = 'MEM-0001'`.
2. A second insert produces `MEM-0002`.
3. `select * from is_active_member('test1@example.com')` returns `{ is_member: true, arty: true, cure: false, member_number: 'MEM-0001', name: 'Test One' }`.
4. Case-insensitive: `select * from is_active_member('TEST1@EXAMPLE.COM')` returns the same row.
5. Unknown email: `select * from is_active_member('nobody@example.com')` returns zero rows.
6. Setting `arty_active = false` flips `is_active_member.is_member` to `false`.
7. Inserting a member with `tier = 'cure_founder'` and `founder_number = null` triggers the founder-number trigger and assigns `FND-0001`.
8. Inserting a second cure_founder produces `FND-0002`. (Independent sequence from MEM-XXXX.)
9. Inserting a `cure_applications` row with status omitted defaults to `'pending'`.
10. Setting status to a value outside the four-valued enum raises a CHECK violation.

---

## 4. Stripe configuration

Created manually in the Stripe dashboard before any /goal runs.

### 4.1 Products

| Product name | Price | Recurrence | Metadata | Env var holding price ID |
|---|---|---|---|---|
| Arty Club Monthly | £5.00 GBP | Monthly | `club: arty` | `STRIPE_PRICE_ARTY` |
| CURE Club Monthly | £50.00 GBP | Monthly | `club: cure` | `STRIPE_PRICE_CURE` |

**v2 migration step** — in the Stripe dashboard, archive the existing £5 CURE price and create a new £50 price under the same product (so the product's identity carries over for analytics). Update the `STRIPE_PRICE_CURE` env var in Vercel to point at the new price ID. The old £5 CURE subscribers continue on the old price until they cancel / their next renewal; no migration of their billing happens in this build. The £8 "Both Clubs" product is archived in the dashboard — `STRIPE_PRICE_BOTH` is left defined in `.env.example` for backward compat but is no longer read by any code path.

The `metadata.club` field is set on the **product**. When the webhook handler receives an event, it reads `subscription.items.data[0].price.metadata.club` to determine which booleans to flip.

### 4.2 Customer Portal configuration

In Stripe dashboard → Settings → Customer Portal:

- **Cancellation:** at period end (the `/manage` token-context view now drives in-house cancel-at-period-end via `/api/membership/cancel`; the Customer Portal cancel option is kept available as a fallback).
- **Plan switching:** disabled. A v1 Arty subscriber wanting CURE goes through `/upgrade` instead of the portal.
- **Update payment method:** Enabled.
- **Update billing address:** Enabled.
- **Invoice history:** Visible.

### 4.3 Webhook configuration

In Stripe dashboard → Developers → Webhooks → Add endpoint:

- Endpoint URL: `https://member.theartyst.co.uk/api/stripe-webhook`
- Events listened for:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
- Signing secret stored as `STRIPE_WEBHOOK_SECRET` in Vercel env vars.

---

## 5. API contracts

All endpoints are Vercel serverless functions. All write paths use the Supabase **service role key** server-side. The anon key is not used in this project — there are no direct client-to-Supabase calls.

Auth model recap:
- Public endpoints (`/api/checkout/create`, `/api/membership/check`, `/api/membership/by-session`, `/api/membership/manage`, `/api/membership/apply`) — unauthenticated; rely on rate limiting and validation.
- Token-authenticated endpoints (`/api/membership/me`, `/api/membership/cancel`, `/api/membership/upgrade`) — caller passes the HMAC magic-link token issued in the welcome email.
- Admin endpoints (`/api/admin/*`) — caller passes `Authorization: Bearer <ADMIN_API_TOKEN>`.

### 5.1 `POST /api/checkout/create`

Creates a Stripe Checkout session for a new subscription. **v2 note:** `product` is restricted to `'arty'` for public callers. A CURE checkout is only created by the admin "accept application" flow (§5.7), which sets `product: 'cure'` server-side; this endpoint rejects external `product: 'cure'` requests to prevent bypassing the application.

**Request body:**
```json
{
  "product": "arty",
  "name": "string (1-100 chars)",
  "email": "string (valid email)",
  "signup_message": "string (optional, max 500 chars)",
  "marketing_consent": "boolean (default false)"
}
```

**Response (200):**
```json
{ "url": "https://checkout.stripe.com/c/pay/cs_test_..." }
```

**Response (400):** validation error
```json
{ "error": "invalid_email" | "invalid_product" | "missing_field" }
```

**Behaviour:**
- Resolves `product` to the matching `STRIPE_PRICE_*` env var. `product='cure'` is rejected for public callers (`invalid_product`).
- Creates a Checkout session with:
  - `mode: 'subscription'`
  - `customer_email: email`
  - `line_items: [{ price: priceId, quantity: 1 }]`
  - `success_url: ${SITE_URL}/welcome?session_id={CHECKOUT_SESSION_ID}`
  - `cancel_url: ${SITE_URL}/`
  - `metadata: { name, email, club: product, signup_message, marketing_consent }`
  - `subscription_data.metadata: { club: product, name, email }`
- Returns the session URL. Does NOT write to Supabase. The webhook is the only writer.

### 5.2 `POST /api/stripe-webhook`

Single handler for all Stripe events. Must verify signature using `STRIPE_WEBHOOK_SECRET`. Idempotent (re-receiving the same event ID is a no-op).

**Event handling:**

| Stripe event | Action |
|---|---|
| `checkout.session.completed` | Upsert `members` row with email, name, stripe_customer_id from session. Set the right boolean(s) based on `metadata.club`. Set `*_joined_at = now()`. Set `tier = 'arty'` if club=arty AND tier is null; set `tier = 'cure'` if club=cure (CURE always wins). Write `joined_arty` / `joined_cure` to `membership_events`. Trigger welcome email via Resend (variant by tier — see §7). |
| `customer.subscription.created` | Backup safety — if the row doesn't exist yet (rare race), create it. Otherwise no-op. |
| `customer.subscription.updated` | Read new price ID, determine new club, update booleans accordingly. Update `stripe_*_subscription_id` fields. |
| `customer.subscription.deleted` | Set the matching boolean(s) to `false`, set `*_cancelled_at = now()`. Write `cancelled_arty` / `cancelled_cure` event. Do NOT delete the row. Do NOT change `tier` — historical record. |
| `invoice.payment_failed` | Write `payment_failed` event. Do not change booleans on first failure — Stripe retries automatically. |

The v1 `joined_both` / `cancelled_both` / `switched_to_both` / `switched_to_solo` event types remain valid in the audit log for historical rows; they are no longer emitted by the webhook in v2 because there is no `both` SKU.

**Response:** Always 200 if signature verifies and event is processed (or correctly ignored). 400 only on signature failure.

### 5.3 `GET /api/membership/check?email=...`

The hot-path lookup endpoint. Other CAs (CA-017, future till lookup, future CA-013 integration) call this. **Unchanged from v1.**

**Request:** `?email=foo@example.com`

**Response (200):**
```json
{
  "is_member": false,
  "arty": false,
  "cure": false,
  "member_number": null,
  "name": null
}
```

or, for a member:

```json
{
  "is_member": true,
  "arty": true,
  "cure": false,
  "member_number": "MEM-0042",
  "name": "Jane Doe"
}
```

Implementation: a single call to `is_active_member(p_email)`. No conditional logic in the endpoint itself. `tier` and `founder_number` are deliberately NOT exposed here — this endpoint is consumed by external systems that only need the live access signal.

**Response (400):** missing or invalid email parameter.

### 5.4 `GET /api/membership/by-session?session_id=...`

Used by the `/welcome` page to poll for member creation after Stripe Checkout completes. **Unchanged from v1.**

**Request:** `?session_id=cs_test_...`

**Response (200) — member exists:**
```json
{
  "ready": true,
  "name": "Jane Doe",
  "member_number": "MEM-0042",
  "arty": true,
  "cure": false
}
```

**Response (200) — webhook not yet processed:**
```json
{ "ready": false }
```

### 5.5 `POST /api/membership/manage`

Creates a Stripe Customer Portal session for self-service. **Unchanged from v1.**

**Request body:**
```json
{ "email": "string" }
```

**Response (200):**
```json
{ "url": "https://billing.stripe.com/p/session/..." }
```

**Response (404):** no member found for that email.

### 5.6 `POST /api/membership/apply`

New in v2. Public endpoint that creates a `cure_applications` row, status `pending`. No payment is taken here — payment only happens after admin acceptance, via the Stripe Checkout link returned by `/api/admin/applications/:id/decide`.

**Request body:**
```json
{
  "name": "string (1-100 chars)",
  "email": "string (valid email)",
  "questionnaire": {
    "q1": "string (free text)",
    "q2": "string",
    "q3": "string",
    "q4": "string",
    "q5": "string"
  },
  "marketing_consent": "boolean (default false)"
}
```

Question text is canonical in `src/content/apply-questions.json` (§8.3); the keys `q1`..`q5` are the only thing the API contracts on. Frontend renders the labels; backend stores the dictionary as JSON.

**Response (201):**
```json
{ "application_id": "uuid", "status": "pending" }
```

**Response (400):** `invalid_email`, `missing_field`, or `questionnaire_incomplete` (any of `q1`..`q5` blank).

**Response (409):** `existing_application` — an application with the same email already exists in `pending` or `accepted` status. The applicant should be told to wait for a decision or contact `matthew@othersyde.co.uk`.

**Behaviour:**
- Validates inputs.
- Inserts a row into `cure_applications` with `status='pending'`, `existing_member_email=null` (this endpoint is for non-members; existing-member upgrades use `/upgrade`).
- Triggers a notification email to `matthew@othersyde.co.uk` (Resend, plain text, "New CURE application from {name} <{email}>") — best-effort; failure to send doesn't roll back the insert.
- Returns the application id so the frontend can render a "We've got it" acknowledgement.

### 5.7 `POST /api/membership/upgrade`

New in v2. Token-authenticated. An existing Arty member applying to upgrade to CURE. Same questionnaire as `/apply` but only three of the five questions (q3, q4, q5 — the new context-light questions are skipped because the system already knows who they are).

**Request body:**
```json
{
  "token": "string (HMAC magic-link token)",
  "questionnaire": {
    "q3": "string",
    "q4": "string",
    "q5": "string"
  }
}
```

**Response (201):**
```json
{ "application_id": "uuid", "status": "pending" }
```

**Response (400):** `token_required`, `questionnaire_incomplete`.
**Response (401):** `invalid_token`.
**Response (404):** `member_not_found`.
**Response (409):** `existing_application` (same dedupe rule as `/apply`), or `already_cure` if the member already has `cure_active=true` or `tier='cure'`/`'cure_founder'`.

**Behaviour:**
- Verifies the token, resolves to `member_number`, looks up the member.
- Inserts a `cure_applications` row with `existing_member_email = <member email>`, `name = <member name>`, `questionnaire = { q1: <auto-filled from members>, q2: <auto-filled>, q3, q4, q5 }`. The auto-filled `q1`/`q2` values are placeholders documenting "this came from /upgrade" — the canonical content lives in the three answered questions.
- Returns the application id.

### 5.8 `GET /api/admin/applications`

New in v2. Admin auth (`Authorization: Bearer <ADMIN_API_TOKEN>`). Lists pending CURE applications, oldest first.

**Query params:** `?status=pending|accepted|rejected|withdrawn` (default `pending`).

**Response (200):**
```json
{
  "applications": [
    {
      "id": "uuid",
      "name": "string",
      "email": "string",
      "existing_member_email": "string | null",
      "questionnaire": { "q1": "...", "q2": "...", "q3": "...", "q4": "...", "q5": "..." },
      "status": "pending",
      "created_at": "ISO-8601"
    }
  ]
}
```

**Response (401):** `unauthorized` if the Bearer token is missing or wrong.

### 5.9 `POST /api/admin/applications/:id/decide`

New in v2. Admin auth. Records an accept/reject decision on a single application.

**URL param:** `:id` — the application uuid.

**Request body:**
```json
{
  "decision": "accepted" | "rejected",
  "decision_notes": "string (optional)",
  "decided_by": "string (admin identifier, e.g. 'matthew')"
}
```

**Response (200) — accept:**
```json
{
  "application_id": "uuid",
  "status": "accepted",
  "checkout_session_url": "https://checkout.stripe.com/c/pay/cs_test_..."
}
```

**Response (200) — reject:**
```json
{ "application_id": "uuid", "status": "rejected" }
```

**Response (400):** invalid decision value, missing required fields.
**Response (401):** unauthorized.
**Response (404):** application not found.
**Response (409):** application not in `pending` status.

**Behaviour:**
- Loads the application; rejects if `status != 'pending'`.
- Sets `status`, `decided_at = now()`, `decided_by`, `decision_notes`.
- **On accept:** creates a Stripe Checkout session for the CURE Club price (`STRIPE_PRICE_CURE`, the £50/month one). `customer_email = application.email`. `metadata.club = 'cure'`. `metadata.cure_application_id = application.id`. The webhook's `checkout.session.completed` handler reads that metadata and stamps `cure_application_id` onto the new `members` row. Stores the session URL on the application row for resend-on-request and emails the applicant the link (Resend, "CURE Club — you're in. Subscribe here: {url}").
- **On reject:** sends a short Resend email to the applicant (no harsh template — see §7 for tone notes).

### 5.10 `POST /api/admin/grant-founder`

New in v2. Admin auth. Promotes an existing member to `cure_founder`, or creates a new member row with founder tier if no member exists for the supplied email.

**Request body:**
```json
{
  "email": "string (valid email)",
  "name": "string (used only when no member row exists)",
  "decided_by": "string (admin identifier)",
  "notes": "string (optional, written to members.notes)"
}
```

**Response (200) — promotion (existing member):**
```json
{
  "member_number": "MEM-0042",
  "founder_number": "FND-0003",
  "tier": "cure_founder",
  "promoted": true
}
```

**Response (201) — new founder row created:**
```json
{
  "member_number": "MEM-0123",
  "founder_number": "FND-0003",
  "tier": "cure_founder",
  "promoted": false
}
```

**Response (400):** invalid email or missing name (when no member exists).
**Response (401):** unauthorized.

**Behaviour:**
- Looks up `members` by `lower(email)`.
- If found: sets `tier = 'cure_founder'`, sets `cure_active = true`, sets `cure_joined_at = coalesce(cure_joined_at, now())`. The trigger assigns `founder_number = FND-XXXX`. Writes `granted_founder` to `membership_events`. Returns 200.
- If not found: inserts a new `members` row with the email, name, `tier = 'cure_founder'`, `cure_active = true`, `cure_joined_at = now()`, no Stripe IDs. Returns 201.
- Sends the founder welcome email (§7).

---

## 6. Pages

### 6.1 `/` — Signup

**Visual structure (top to bottom):**

1. **Hero**
   - Headline (display serif, large): `The Arty Club & CURE Club`
   - Subhead (body serif, smaller): `Two clubs at the Artyst. One conviction: arts and wellbeing are inseparable.`

2. **Two club paragraphs** (side by side on desktop, stacked on mobile)
   - Content sourced from `src/content/clubs.json` (§8.1). No "both" entry exists in v2.

3. **Two pricing cards** (no longer a radio group — distinct calls to action)
   - **Arty Club · £5/month** — CTA: `Join the Arty Club · £5/month →`. Reveals the inline signup form (same fields as v1).
   - **CURE Club · £50/month** — CTA: `Apply →`. Navigates to `/apply` rather than opening Stripe Checkout. Small caption beneath: `By application + in-person conversation. Includes Arty benefits.`

4. **Arty signup form** (revealed when the Arty card is selected)
   - `name`, `email`, `signup_message`, `marketing_consent` — same shape as v1.

5. **Benefits list** — read from `src/content/benefits.json` (§8.2). Per-tier rendering: Arty benefits shown next to the Arty card, CURE benefits next to the CURE card.

6. **Submit button** (Arty form)
   - Label: `Join the Arty Club · £5/month →`. POST to `/api/checkout/create` with `product: 'arty'`, redirect to the returned URL.

7. **Footer**
   - One line: `Already running events at the Artyst? Membership is required for event runners — same signup.`
   - Terms link (placeholder for v2).
   - FAQ link (placeholder for v2).

**Styling:** unchanged CSS custom properties from v1 (§6.1 of v1; preserved in `src/styles/tokens.css`).

### 6.2 `/welcome` — Post-payment confirmation

**Behaviour:** identical to v1, except the headline copy adapts to the new tier rules:

- Arty-only: `Welcome to the Arty Club, {name}.`
- CURE (paid): `Welcome to the CURE Club, {name}.`
- Founders never see this page — they receive their founder welcome email directly (§7.3).

The "Welcoming you in…" polling, 30-second fallback, member number + QR rendering, and benefits list are unchanged from v1.

### 6.3 `/manage` — Token-context member view + email-fallback gateway

**Behaviour:**

1. On mount, read `?token=...` from the URL.
2. **Token branch:** fetch `/api/membership/me?token=...`. On 200, render the member-context view (name, member number, tier badge via `deriveTier`, active/inactive pill, joined date, three actions: Update payment method, View invoices, Cancel subscription). On any error, fall through to the email form.
3. **Email branch (no token, or token branch failed):** the v1 email form — type email → POST to `/api/membership/manage` → redirect to Stripe Customer Portal.

The token-context cancel button opens a modal that POSTs to `/api/membership/cancel` (token-authenticated, cancels-at-period-end via Stripe).

### 6.4 `/me` — PWA member pass

**URL pattern:** `/me?token=<HMAC>`.

Renders the member pass card: name, member number, tier badge (via `deriveTier`), active/inactive pill, QR code (server-generated by `/api/membership/me`). Footer link "Manage subscription" forwards the same token to `/manage?token=...`. Designed to be installed to the home screen as a PWA.

### 6.5 `/apply` — CURE application (5-question questionnaire)

**URL:** `/apply`. Public, no auth required.

**Visual structure:**

1. **Hero**
   - Headline: `Apply to the CURE Club`
   - Subhead: `CURE is by application. After you send this, Matthew will be in touch to arrange a ~45-minute conversation in person at the Artyst. Subscription is £50 a month and starts only if you choose to continue after that conversation.`

2. **Identity fields**
   - `name` (required), `email` (required), `marketing_consent` (optional checkbox).

3. **Five questions** — text from `src/content/apply-questions.json` (§8.3). Each is a multi-line textarea, required.

4. **Submit**
   - Label: `Send application →`. POST to `/api/membership/apply`. On 201, navigate to a short acknowledgement view: `Thanks, {first name}. We've got your application. Matthew will be in touch within a week.`

5. **Footer** — terms / FAQ links as on `/`.

### 6.6 `/upgrade` — Arty → CURE upgrade (3-question questionnaire)

**URL pattern:** `/upgrade?token=<HMAC>` (token issued in the Arty welcome email so an existing member can apply without retyping anything). With token absent, render an inline notice: `Open this page from the link in your Arty welcome email, or apply for CURE here: /apply`.

**Visual structure:**

1. **Hero**
   - Headline: `Upgrade to CURE`
   - Subhead: `You're already an Arty member. CURE is the inner-circle membership — £50/month, by application + an in-person conversation. CURE includes everything you already get with Arty.`

2. **Pre-filled identity** (read-only banner)
   - Shows the member's name + member number + email, fetched via `/api/membership/me?token=...`.

3. **Three questions** — questions q3, q4, q5 from `src/content/apply-questions.json`. Multi-line textareas, all required.

4. **Submit**
   - Label: `Send application →`. POST to `/api/membership/upgrade` with the token + the three answers. Acknowledgement copy: `Thanks, {first name}. We've got your application. Matthew will be in touch within a week. Your Arty membership continues unchanged in the meantime.`

### 6.7 `/admin/applications` — Application review queue

**URL:** `/admin/applications`. Admin only.

**Auth:** the page asks for the admin token once (text input → stored in `sessionStorage`). Subsequent API calls include `Authorization: Bearer <token>`. No cookies, no sessions; admin closes the tab and the token's gone.

**Layout:**

- **Filter row** — Pending / Accepted / Rejected / Withdrawn tabs (default Pending).
- **List of applications** — each row shows name, email, age (e.g. "3 days ago"), and whether they're an existing Arty member (small badge).
- **Detail panel** — click a row to expand: full questionnaire answers, an "internal notes" textarea, and two buttons:
  - `Accept → send Stripe Checkout link` — disabled while submitting. POSTs `decision: 'accepted'`, `decision_notes` from the textarea, `decided_by` from the env-set admin name. On success, shows the generated Checkout URL with a copy-to-clipboard button (Matthew can paste it into a personal email to the applicant if preferred).
  - `Reject` — POSTs `decision: 'rejected'` + notes.

### 6.8 `/admin/grant-founder` — Promote to cure_founder

**URL:** `/admin/grant-founder`. Admin only (same `sessionStorage` token pattern as §6.7).

**Layout:**

- Single form: `email` (required), `name` (required only if no member exists), `notes` (optional textarea), `decided_by`.
- Submit POSTs to `/api/admin/grant-founder`. On 200 / 201, shows the assigned `FND-XXXX` number and a confirmation: `{name} is now CURE Founder {FND-XXXX}. Their founder welcome email has been sent.`

---

## 7. Welcome email (Resend)

Triggered after a membership state change. Plain HTML, no marketing imagery, no excessive styling. Reads like a personal note from the venue.

**From:** `members@theartyst.co.uk` (or wherever `RESEND_FROM_EMAIL` points)
**Reply-To:** `matthew@othersyde.co.uk`

Three variants. The webhook / admin endpoint chooses the variant by tier at the moment of send.

### 7.1 Arty welcome — `tier = 'arty'`

**Trigger:** `checkout.session.completed` with `metadata.club = 'arty'`.
**Subject:** `Welcome to the Arty Club, {first name}`

**Critical:** this email does **NOT** mention CURE. No upsell on signup. Arty is the broad-base tier; CURE is an invitation-only inner circle. Existing Arty members can later apply to upgrade via `/upgrade`, but that path is not surfaced in the welcome message — Matthew chooses how and when to surface it.

```
Welcome to the Arty Club, {first name}.

You're member MEM-XXXX. Here's what that means in practice:

· 10% off all food and drink at the Artyst — show this email or your member number at the bar.
· Member pricing on every event we run — look for the "members £X" line on event pages.
· 5-day priority booking on capacity events.
· One free guest pass per month.
· The right to host your own event at the Artyst under house terms — get in touch when you have something in mind.

Your QR code (attached) does the same job as your member number — easier to show on your phone than to remember.

Your pass page lives at {SITE_URL}/me?token=<token>. Bookmark it or add it to your home screen.

To manage your subscription, change your card details, or cancel, open: {SITE_URL}/manage?token=<token>

Welcome in.

Matthew
The Artyst · 54-56 Chesterton Road · Cambridge CB4 1EN
```

QR code attached as inline image generated from member number.

### 7.2 CURE paid welcome — `tier = 'cure'` (via accepted application)

**Trigger:** `checkout.session.completed` with `metadata.club = 'cure'`. The applicant has paid the first £50 after Matthew accepted their application.
**Subject:** `Welcome to the CURE Club, {first name}`

```
Welcome to the CURE Club, {first name}.

You're member MEM-XXXX. CURE is an inner-circle membership at the Artyst — a smaller room, a longer conversation, all the Arty benefits and more besides.

Here's what comes with it:

· Everything the Arty Club provides — 10% off F&B, member pricing on events, 5-day priority booking, guest pass, the right to host your own event under house terms.
· Private invitations to CURE-only conversations and events as they're scheduled.
· A direct line to Matthew on programme matters — replies to this email reach him.
· Recognition at the bar and in the room as a CURE member.

Your QR code (attached) carries your member number. Your pass page is at {SITE_URL}/me?token=<token>.

To manage your subscription, open: {SITE_URL}/manage?token=<token>

Welcome in,

Matthew
The Artyst · 54-56 Chesterton Road · Cambridge CB4 1EN
```

### 7.3 CURE founder welcome — `tier = 'cure_founder'` (granted, not paid)

**Trigger:** `/api/admin/grant-founder` success.
**Subject:** `Welcome, founder {first name}`

```
{First name},

You're founder member FND-XXXX of the CURE Club at the Artyst.

That word — founder — names the actual relationship: you're not subscribing, you're being invited in. The CURE Club is being shaped with people like you in the room. There's no recurring charge for founders; if and when that changes, you'll know first.

In practice you get everything the CURE Club provides, plus the recognition that comes with being among the first invited:

· All Arty benefits — 10% off F&B, member pricing on events, 5-day priority booking, guest pass.
· CURE-only conversations, including the early shape-the-club sessions.
· A standing line to Matthew on what CURE is becoming.

Your member number is MEM-XXXX. Your founder number is FND-XXXX. Both refer to the same person — the MEM-XXXX is the working one for day-to-day; the FND-XXXX is for the record.

Your pass page is at {SITE_URL}/me?token=<token>. Welcome in.

Matthew
```

No QR code attachment on the founder welcome is mandatory but the pass page at `/me?token=...` carries the same QR code as for any other member.

### 7.4 Reject email — CURE application not accepted

**Trigger:** `/api/admin/applications/:id/decide` with `decision = 'rejected'`.
**Subject:** `About your CURE Club application`

Short, plain, respectful. Avoids over-explaining. The actual rejection wording is held in a small template; the spec mandates only that it: (a) thanks the applicant by name, (b) confirms the decision in plain English, (c) does not promise a future application can be made unless Matthew's `decision_notes` indicate otherwise, (d) closes with Matthew's name and venue address.

---

## 8. Canonical copy

### 8.1 `src/content/clubs.json`

```json
{
  "arty": {
    "name": "The Arty Club",
    "tagline": "Arts",
    "price_pence": 500,
    "stripe_env_var": "STRIPE_PRICE_ARTY",
    "cta": "Join the Arty Club",
    "join_via": "stripe",
    "description": "The Arts side of the Artyst. Programming rooted in PsychoNautics — performance, exhibitions, conversation about the work that matters. Drawing on the venue's Syd Barrett heritage and the city's wider artistic tradition. Members shape the programme by attending, by suggesting, and by hosting their own events under house terms."
  },
  "cure": {
    "name": "CURE Club",
    "tagline": "Wellbeing · by application",
    "price_pence": 5000,
    "stripe_env_var": "STRIPE_PRICE_CURE",
    "cta": "Apply",
    "join_via": "application",
    "description": "The Cambridge Underground Research Exploratorium. The inner-circle membership — Wellbeing rooted in PsychoTherapeutics with secondary links to PsychoAlchemy and PsychoNautics. A lineage that runs from 60s counter-culture through Syd Barrett to Newton's alchemical interests — taking the word 'cure' seriously. By application followed by an in-person conversation with Matthew. CURE includes everything the Arty Club provides."
  }
}
```

The v1 `both` entry is removed.

### 8.2 `src/content/benefits.json`

```json
{
  "arty": [
    "10% off all food and drink at the Artyst",
    "Member pricing on every event — typically £2-5 off ticket price",
    "5-day priority booking on capacity events before they open to the public",
    "One free guest pass per month — bring someone at member rate",
    "Right to host your own events at the Artyst under house terms"
  ],
  "cure": [
    "Everything the Arty Club provides",
    "Private invitations to CURE-only conversations and events",
    "A direct line to Matthew on programme matters",
    "Recognition at the bar and in the room as a CURE member"
  ],
  "cure_founder": [
    "Everything the CURE Club provides",
    "No recurring charge — founder status is granted, not subscribed",
    "Voice in the early shape-the-club sessions",
    "Recognised on the record as among the first invited"
  ]
}
```

### 8.3 `src/content/apply-questions.json`

The five CURE application questions. `/apply` shows all five; `/upgrade` shows only `q3`/`q4`/`q5`.

```json
{
  "questions": [
    {
      "id": "q1",
      "label": "Tell us a bit about yourself.",
      "help": "Anything you'd like us to know — what you do, where you spend time, what you're working on.",
      "shown_on": ["apply"]
    },
    {
      "id": "q2",
      "label": "How did you come across the Artyst or the CURE Club?",
      "help": "Just so we know.",
      "shown_on": ["apply"]
    },
    {
      "id": "q3",
      "label": "What draws you to the CURE Club specifically?",
      "help": "CURE is a smaller, slower room than the Arty Club. What in it speaks to you?",
      "shown_on": ["apply", "upgrade"]
    },
    {
      "id": "q4",
      "label": "What would you bring to the room?",
      "help": "Not a CV — interests, questions, practices, anything you'd want to put in the air.",
      "shown_on": ["apply", "upgrade"]
    },
    {
      "id": "q5",
      "label": "Anything you'd want to ask before applying?",
      "help": "Optional in spirit, required by the form. 'Nothing right now' is a fine answer.",
      "shown_on": ["apply", "upgrade"]
    }
  ]
}
```

---

## 9. Naming conventions

- **Member numbers:** `MEM-XXXX` zero-padded to 4 digits (`MEM-0001` through `MEM-9999`). Beyond 9999 the function overflows the padding — fine for v2 (the venue holds 45).
- **Founder numbers:** `FND-XXXX` zero-padded to 4 digits. Independent sequence from MEM-XXXX. Each founder has both a MEM-XXXX (their underlying member row) and an FND-XXXX (their founder badge).
- **Tier values:** `'arty'`, `'cure'`, `'cure_founder'`. Stored as `text` with a CHECK constraint; not a Postgres enum (the project-wide convention is "enum-as-CHECK" so future values are an `alter table … drop constraint … add constraint …`, not an `alter type`).
- **Application status values:** `'pending'`, `'accepted'`, `'rejected'`, `'withdrawn'`. Same enum-as-CHECK convention.
- **Table names:** snake_case, plural (`members`, `membership_events`, `cure_applications`).
- **Column names:** snake_case (`member_number`, `arty_active`, `created_at`, `founder_number`, `cure_application_id`).
- **Env vars:** SCREAMING_SNAKE_CASE. Stripe price env vars suffix is club name uppercase (`STRIPE_PRICE_ARTY`, `STRIPE_PRICE_CURE`; `STRIPE_PRICE_BOTH` retired but preserved).
- **Stripe metadata fields:** lowercase (`club`, `name`, `email`, `cure_application_id`).
- **Audit event_types:** snake_case past tense (`joined_arty`, `cancelled_cure`, `payment_failed`, `granted_founder`, `application_received`, `application_accepted`, `application_rejected`).

---

## 10. Test coverage requirements

Each /goal builds toward verifiable test coverage. The boss checks tests pass before considering a goal met.

**Schema tests** (`scripts/test-schema.ts`): 10 assertions listed in §3.3.

**API tests:**
- `api-check.test.ts` — non-existent email, Arty-only active, cancelled member, case-insensitive lookup.
- `checkout.test.ts` — Arty product produces correct price ID and metadata; public-caller `product: 'cure'` is rejected with `invalid_product`.
- `webhook.test.ts` — each of the 5 Stripe events asserts correct database state. Use fixtures in `tests/fixtures/`. Adds an assertion that a `cure` checkout completion sets `tier = 'cure'`.
- `api-manage.test.ts` — email-form path to Stripe Customer Portal (existing).
- `api-by-session.test.ts` — poll behaviour (existing).
- `api-cancel.test.ts` — token verification + Stripe cancel-at-period-end + members row stamping (existing).
- `api-apply.test.ts` — new in v2: validation failures, successful insertion of `cure_applications` row, dedupe rejects duplicate pending/accepted applications.
- `api-upgrade.test.ts` — new in v2: token verification, dedupe rejection when member is already CURE, successful insertion with `existing_member_email` set.
- `api-admin-applications.test.ts` — new in v2: unauthorized without Bearer, returns pending list with correct shape, decide-accept produces a Checkout session URL and flips status, decide-reject flips status without a Checkout URL, decide on already-decided application returns 409.
- `api-admin-grant-founder.test.ts` — new in v2: unauthorized, promotion of existing member sets `tier='cure_founder'` and assigns a `founder_number`, creation of brand-new founder row when no member exists, idempotent on re-running.

**Page tests:**
- `signup.test.tsx` — Arty card renders + submits to checkout endpoint; CURE card CTA navigates to `/apply` (no Stripe call).
- `welcome.test.tsx` — polling behaviour, ready-state rendering (existing).
- `manage.test.tsx` — token-context view renders member info + three actions; email fallback renders when no token.
- `apply.test.tsx` — new in v2: all five questions render, submit POSTs to `/api/membership/apply`, acknowledgement view appears on 201.
- `upgrade.test.tsx` — new in v2: pre-filled identity banner appears given a token, three questions render, submit POSTs to `/api/membership/upgrade`.
- `admin-applications.test.tsx` — new in v2: token prompt, applications list renders, accept and reject buttons hit the right endpoints.
- `admin-grant-founder.test.tsx` — new in v2: form submits, success message includes the assigned FND-XXXX.
- `deriveTier.test.ts` — CURE wins, Arty only, both inactive (existing).

All tests use Vitest. Run with `npm run test`.

---

## 11. Decisions still open (DO NOT GUESS — defer or ask)

1. **Stripe migration of existing CURE subscribers.** The eight existing £5 CURE subscribers are not migrated to the £50 price in this build. Confirmed with Matthew: they grandfather on the old price until they cancel. A separate /goal can do a bulk migration later if wanted.
2. **WhatsApp group automation.** Matthew adds new CURE members (paid and founder) to the consumer WhatsApp group by hand for now. Automation lands once Claude Dispatch is wired (separate /goal).
3. **LoyaltyDog bridge.** A separate /goal will mirror subscription create/cancel events to LoyaltyDog once their API conversation lands.
4. **`/admin/*` page-level auth UX.** v2 uses a sessionStorage Bearer token entered on first load. Long-term we may move to a magic-link-from-email pattern, but not in this build.
5. **Founder renumbering / withdrawal.** A founder cannot currently be demoted by the admin tool; `decision_notes` on the audit event is the only record if it ever happens. Add a `/api/admin/revoke-founder` if/when the need arises.

---

## 12. Build order (for /goal commands)

Each goal references this spec. Goals 1-7 from v1 are already built. v2 adds the CURE-restructure work as goals 8 onwards.

1. **Goal 1** — Schema and core function (§3.1)
2. **Goal 2** — `/api/membership/check` endpoint (§5.3)
3. **Goal 3** — `/api/checkout/create` endpoint (§5.1)
4. **Goal 4** — `/api/stripe-webhook` handler (§5.2)
5. **Goal 5** — `/` signup page (§6.1)
6. **Goal 6** — `/welcome` page + Resend Arty email (§6.2, §7.1)
7. **Goal 7** — `/manage` redirect (§6.3, §5.5)
   --- v2 begins ---
8. **Goal 8** — Migration 002 (§3.2) + `tier` back-fill + verification (§3.3, items 7-10).
9. **Goal 9** — Stripe restructure: archive old CURE price + Both SKU; create £50 CURE price; update `STRIPE_PRICE_CURE`. Update `/api/checkout/create` to reject public `product: 'cure'` requests (§5.1).
10. **Goal 10** — `/api/membership/apply` (§5.6) + `/apply` page (§6.5) + `apply.test.tsx` + `api-apply.test.ts`.
11. **Goal 11** — `/api/membership/upgrade` (§5.7) + `/upgrade` page (§6.6) + tests.
12. **Goal 12** — Admin: `/api/admin/applications` (§5.8) + `/api/admin/applications/:id/decide` (§5.9) + `/admin/applications` page (§6.7) + tests.
13. **Goal 13** — Admin: `/api/admin/grant-founder` (§5.10) + `/admin/grant-founder` page (§6.8) + tests. Promote MEM-0001 (Matthew) and MEM-0002 (Sven) to founder after the tool is live.
14. **Goal 14** — Welcome email variants (§7.2 CURE paid, §7.3 founder, §7.4 reject) wired into the webhook + admin endpoints.
15. **Goal 15** — Signup page restructure: two cards, CURE CTA = "Apply" (§6.1). Update `signup.test.tsx`.

End-to-end smoke test (manual, after Goals 8-15): apply via `/apply`; accept in `/admin/applications`; pay the resulting Stripe link in test mode; receive CURE-paid welcome; confirm `tier='cure'`, `cure_application_id` populated. Separately: grant a founder via `/admin/grant-founder`; confirm `FND-XXXX` assigned, founder welcome arrives.

---

*Specification v2.0. May 2026. The Alcademy / OtherSyde Ltd.*
*Ad Recte Cogitandum in Mundo Obliquo.*
