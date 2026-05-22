# MEMBERSHIP.md

**The Arty Club & CURE Club — membership system specification**
Single source of truth for the `arty-cure-membership` build. Every /goal command in Claude Code references this document. Treat it as canon.

Version: 1.0 · May 2026
Repository: `the-alcademy/arty-cure-membership` (PRIVATE)
Live URL (target): `member.theartyst.co.uk`

---

## 1. Overview

A standalone Vercel app handling subscription signups, identity, and lookup for two club memberships at the Artyst:

- **Arty Club** — Arts, £5/month
- **CURE Club** — Wellbeing, £5/month
- **Both Clubs** — £8/month (saves £2 vs separate subscriptions)

The app does five things and nothing else:

1. Lets a person sign up for one of the three subscriptions via Stripe Checkout.
2. Receives Stripe webhooks and maintains the source-of-truth `members` table in Supabase.
3. Exposes a `GET /api/membership/check?email=...` endpoint that any other system can ask "is this person a member, and of what?"
4. Sends a welcome email via Resend after successful signup.
5. Provides a `/manage` route that redirects to the Stripe Customer Portal for self-service.

**Out of scope for v1** (do not build, do not infer):

- Member portal beyond Stripe Customer Portal
- Event ticket purchase or pricing logic (lives in CA-017)
- Till discount application (lives in Epos Now, manual for v1)
- BedePlex / IC integration (later)
- Twyndle directory visibility (later)
- Member-only event programming (later)
- Founder badges, Bene multipliers, guest passes (layer-2 benefits, not v1)
- Email marketing beyond the welcome email (use existing list infrastructure)

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
STRIPE_PRICE_CURE=                # price_... from "CURE Club Monthly" product
STRIPE_PRICE_BOTH=                # price_... from "Both Clubs Monthly" product

# Resend
RESEND_API_KEY=
RESEND_FROM_EMAIL=members@theartyst.co.uk

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
│   └── 001_membership.sql
├── scripts/
│   └── test-schema.ts
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── pages/
│   │   ├── index.tsx               (signup page)
│   │   ├── welcome.tsx
│   │   └── manage.tsx
│   ├── styles/
│   │   ├── tokens.css              (CSS custom properties from CA-023)
│   │   └── global.css
│   └── content/
│       ├── clubs.json              (Arty / CURE descriptions)
│       └── benefits.json           (benefits list)
├── api/
│   ├── checkout/
│   │   └── create.ts               (creates Stripe Checkout sessions)
│   ├── membership/
│   │   ├── check.ts                (the hot path — lookup endpoint)
│   │   ├── by-session.ts           (welcome page polls this)
│   │   └── manage.ts               (creates Customer Portal sessions)
│   └── stripe-webhook.ts           (single webhook handler for all events)
└── tests/
    ├── api-check.test.ts
    ├── checkout.test.ts
    ├── webhook.test.ts
    ├── welcome.test.tsx
    ├── signup.test.tsx
    └── fixtures/
        ├── subscription-created-arty.json
        ├── subscription-created-cure.json
        ├── subscription-created-both.json
        ├── subscription-deleted.json
        └── payment-failed.json
```

---

## 3. Database schema

All migrations are SQL files in `/migrations/`. Run them in numbered order via the Supabase SQL editor (manual) or via the `scripts/run-migrations.ts` helper (later).

### 3.1 `001_membership.sql`

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
```

### 3.2 Verification script — `scripts/test-schema.ts`

Run with: `npx tsx scripts/test-schema.ts`. Connects to the test Supabase project (env vars), runs the migration, performs the following assertions, exits 0 on success or non-zero on first failure:

1. After `insert into members (email, name, arty_active) values ('test1@example.com', 'Test One', true)` — the inserted row has `member_number = 'MEM-0001'`.
2. A second insert produces `MEM-0002`.
3. `select * from is_active_member('test1@example.com')` returns `{ is_member: true, arty: true, cure: false, member_number: 'MEM-0001', name: 'Test One' }`.
4. `select * from is_active_member('TEST1@EXAMPLE.COM')` returns the same row (case-insensitive).
5. `select * from is_active_member('nobody@example.com')` returns zero rows.
6. Updating `arty_active = false` and selecting via `is_active_member` returns `is_member: false`.

---

## 4. Stripe configuration

Created manually in the Stripe dashboard before any /goal runs.

### 4.1 Products

| Product name | Price | Recurrence | Metadata | Env var holding price ID |
|---|---|---|---|---|
| Arty Club Monthly | £5.00 GBP | Monthly | `club: arty` | `STRIPE_PRICE_ARTY` |
| CURE Club Monthly | £5.00 GBP | Monthly | `club: cure` | `STRIPE_PRICE_CURE` |
| Both Clubs Monthly | £8.00 GBP | Monthly | `club: both` | `STRIPE_PRICE_BOTH` |

The `metadata.club` field is set on the **product**. When the webhook handler receives an event, it reads `subscription.items.data[0].price.metadata.club` to determine which booleans to flip.

### 4.2 Customer Portal configuration

In Stripe dashboard → Settings → Customer Portal:

- **Cancellation:** Immediate (not at period end). No proration on cancellation.
- **Plan switching:** Enabled, between Arty / CURE / Both. Proration enabled.
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

### 5.1 `POST /api/checkout/create`

Creates a Stripe Checkout session for a new subscription.

**Request body:**
```json
{
  "product": "arty" | "cure" | "both",
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
- Resolves `product` to the matching `STRIPE_PRICE_*` env var.
- Creates a Checkout session with:
  - `mode: 'subscription'`
  - `customer_email: email`
  - `line_items: [{ price: priceId, quantity: 1 }]`
  - `success_url: \`${SITE_URL}/welcome?session_id={CHECKOUT_SESSION_ID}\``
  - `cancel_url: \`${SITE_URL}/\``
  - `metadata: { name, email, club: product, signup_message, marketing_consent }`
  - `subscription_data.metadata: { club: product, name, email }`
- Returns the session URL. Does NOT write to Supabase. The webhook is the only writer.

### 5.2 `POST /api/stripe-webhook`

Single handler for all Stripe events. Must verify signature using `STRIPE_WEBHOOK_SECRET`. Idempotent (re-receiving the same event ID is a no-op).

**Event handling:**

| Stripe event | Action |
|---|---|
| `checkout.session.completed` | Upsert `members` row with email, name, stripe_customer_id from session. Set the right boolean(s) based on `metadata.club`. Set `*_joined_at = now()`. Write `joined_arty` / `joined_cure` / `joined_both` to `membership_events`. Trigger welcome email via Resend. |
| `customer.subscription.created` | Backup safety — if the row doesn't exist yet (rare race), create it. Otherwise no-op. |
| `customer.subscription.updated` | Read new price ID, determine new club, update booleans accordingly. If a switch occurred (e.g. Arty → Both), write `switched_to_both` event. Update `stripe_*_subscription_id` fields. |
| `customer.subscription.deleted` | Set the matching boolean(s) to `false`, set `*_cancelled_at = now()`. Write `cancelled_arty` / `cancelled_cure` / `cancelled_both` event. Do NOT delete the row. |
| `invoice.payment_failed` | Write `payment_failed` event. Do not change booleans on first failure — Stripe retries automatically. (Status changes happen via subscription.updated when sub goes past_due → canceled.) |

**Response:** Always 200 if signature verifies and event is processed (or correctly ignored). 400 only on signature failure.

### 5.3 `GET /api/membership/check?email=...`

The hot-path lookup endpoint. Other CAs (CA-017, future till lookup, future CA-013 integration) call this.

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

Implementation: a single call to `is_active_member(p_email)`. No conditional logic in the endpoint itself.

**Response (400):** missing or invalid email parameter.

### 5.4 `GET /api/membership/by-session?session_id=...`

Used by the `/welcome` page to poll for member creation after Stripe Checkout completes.

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

Implementation: retrieves the Checkout session from Stripe, gets the customer_email, calls `is_active_member`. If active, returns full info. If not (webhook race not yet resolved), returns `ready: false`.

### 5.5 `POST /api/membership/manage`

Creates a Stripe Customer Portal session for self-service.

**Request body:**
```json
{ "email": "string" }
```

**Response (200):**
```json
{ "url": "https://billing.stripe.com/p/session/..." }
```

**Response (404):** no member found for that email.

Implementation: looks up `stripe_customer_id` for the email, calls Stripe `billingPortal.sessions.create({ customer, return_url: \`${SITE_URL}/manage\` })`.

---

## 6. Pages

### 6.1 `/` — Signup

**Visual structure (top to bottom):**

1. **Hero**
   - Headline (display serif, large): `The Arty Club & CURE Club`
   - Subhead (body serif, smaller): `Two clubs at the Artyst. One conviction: arts and wellbeing are inseparable.`

2. **Two club paragraphs** (side by side on desktop, stacked on mobile)
   - Content sourced from `src/content/clubs.json` — see §10.1.

3. **Three pricing cards** (radio group)
   - Arty Club · £5/month
   - CURE Club · £5/month
   - Both Clubs · £8/month — small subtext `Saves £2/month vs joining separately`
   - Selecting a card highlights it. Default selection: none. User must pick before form submission.

4. **Form** (revealed once a card is selected)
   - `name` — text input, required, max 100 chars
   - `email` — email input, required, validated client-side
   - `signup_message` — textarea, optional, label `Anything you'd like us to know? (optional)`, max 500 chars
   - `marketing_consent` — checkbox, default unchecked, label `I'd like to hear about Artyst events, tours and programmes by email`

5. **Benefits list** — read from `src/content/benefits.json` — see §10.2.

6. **Submit button**
   - Label updates by selection:
     - Arty selected → `Join the Arty Club · £5/month →`
     - CURE selected → `Join the CURE Club · £5/month →`
     - Both selected → `Join Both Clubs · £8/month →`
   - On click: POST to `/api/checkout/create`, then `window.location.href = response.url`.

7. **Footer**
   - One line: `Already running events at the Artyst? Membership is required for event runners — same signup, same price.`
   - Terms link (placeholder for v1).
   - FAQ link (placeholder for v1).

**Styling:** CSS custom properties from `src/styles/tokens.css`. Use the Artyst's default theme from CA-023:

```css
:root {
  --color-bg:       #f7f5f2;
  --color-surface:  #ffffff;
  --color-text:     #1a1714;
  --color-muted:    #3d3530;
  --color-faint:    #7a6e65;
  --color-border:   #d8d0c8;
  --color-primary:  #9b2335;
  --color-accent:   #5a3e0a;
  --font-body:      'Georgia', serif;
  --font-display:   'Georgia', serif;
}
```

### 6.2 `/welcome` — Post-payment confirmation

**URL pattern:** `/welcome?session_id=cs_test_xxx`

**Behaviour:**

1. On mount, read `session_id` from URL params.
2. Poll `GET /api/membership/by-session?session_id=...` every 2 seconds.
3. While polling, show a small status message: `Welcoming you in...`
4. After 30 seconds without `ready: true`, show a fallback: `We're processing your subscription. Check your inbox for confirmation — if you don't see it within 5 minutes, contact matthew@othersyde.co.uk.`
5. When `ready: true`, render:
   - Headline: `Welcome to the {Arty Club | CURE Club | Arty Club & CURE Club}, {name}.`
   - Member number prominently: `Your member number is MEM-XXXX`
   - QR code (client-side generated from member number as plain text using the `qrcode` package)
   - One sentence: `Show this number or QR at the bar for your 10% discount on food and drink. Check your email — your welcome message and a link to manage your subscription are on the way.`
   - Benefits list (same as signup page)

### 6.3 `/manage` — Self-service redirect

**Behaviour:**

1. Simple email-entry form.
2. On submit, POST to `/api/membership/manage`.
3. If response 200, redirect to Stripe Customer Portal URL.
4. If response 404, show: `We couldn't find a membership for that email. Check the email address or contact matthew@othersyde.co.uk.`

---

## 7. Welcome email (Resend)

Triggered by the webhook handler on `checkout.session.completed`. Plain HTML, no marketing imagery, no excessive styling. Reads like a personal note from the venue.

**From:** `members@theartyst.co.uk` (or wherever `RESEND_FROM_EMAIL` points)
**Reply-To:** `matthew@othersyde.co.uk`
**Subject:** `Welcome to the {Arty Club | CURE Club | Clubs}, {first name}`

**Body (canonical copy — adapt name and club):**

```
Welcome to the Arty Club, {first name}.

You're member MEM-XXXX. Here's what that means in practice:

· 10% off all food and drink at the Artyst — show this email or your member number at the bar.
· Member pricing on every event we run — look for the "members £X" line on event pages.
· 5-day priority booking on capacity events.
· One free guest pass per month.
· The right to host your own event at the Artyst under house terms — get in touch when you have something in mind.

Your QR code (attached) does the same job as your member number — easier to show on your phone than to remember.

To manage your subscription, change your card details, or switch clubs, use this link any time:
{SITE_URL}/manage

Welcome in.

Matthew
The Artyst · 54-56 Chesterton Road · Cambridge CB4 1EN
```

QR code attached as inline image generated from member number.

For Both Clubs members, the opening line becomes `Welcome to the Arty Club and CURE Club, {first name}.` and a small additional bullet appears: `· Full access to both clubs' programmes wherever they're held in the building.`

For CURE-only, opening line is `Welcome to the CURE Club, {first name}.`

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
    "description": "The Arts side of the Artyst. Programming rooted in PsychoNautics — performance, exhibitions, conversation about the work that matters. Drawing on the venue's Syd Barrett heritage and the city's wider artistic tradition. Members shape the programme by attending, by suggesting, and by hosting their own events under house terms."
  },
  "cure": {
    "name": "CURE Club",
    "tagline": "Wellbeing",
    "price_pence": 500,
    "stripe_env_var": "STRIPE_PRICE_CURE",
    "description": "The Cambridge Underground Research Exploratorium. The Wellbeing side, rooted in PsychoTherapeutics with secondary links to PsychoAlchemy and PsychoNautics. A lineage that runs from 60s counter-culture through Syd Barrett to Newton's alchemical interests — taking the word 'cure' seriously. The basement is its natural home when the basement is finished; until then, anywhere in the building."
  },
  "both": {
    "name": "Both Clubs",
    "tagline": "Arts and Wellbeing",
    "price_pence": 800,
    "stripe_env_var": "STRIPE_PRICE_BOTH",
    "description": "Full access to the programmes of both clubs. Saves £2/month versus joining each separately. The natural choice for anyone who shares the founding conviction that arts and wellbeing are inseparable."
  }
}
```

### 8.2 `src/content/benefits.json`

```json
{
  "benefits": [
    "10% off all food and drink at the Artyst",
    "Member pricing on every event — typically £2-5 off ticket price",
    "5-day priority booking on capacity events before they open to the public",
    "One free guest pass per month — bring someone at member rate",
    "Right to host your own events at the Artyst under house terms",
    "5% discount on all artworks exhibited at the Artyst",
    "Invitations to member-only events, including private views"
  ]
}
```

---

## 9. Naming conventions

- **Member numbers:** `MEM-XXXX` zero-padded to 4 digits (`MEM-0001` through `MEM-9999`). Beyond 9999, the function will overflow the padding — fine for v1, the venue holds 45.
- **Table names:** snake_case, plural (`members`, `membership_events`).
- **Column names:** snake_case (`member_number`, `arty_active`, `created_at`).
- **Env vars:** SCREAMING_SNAKE_CASE. Stripe price env vars suffix is club name uppercase (`STRIPE_PRICE_ARTY`, `STRIPE_PRICE_CURE`, `STRIPE_PRICE_BOTH`).
- **Stripe metadata fields:** lowercase (`club`, `name`, `email`).
- **Audit event_types:** snake_case past tense (`joined_arty`, `cancelled_cure`, `payment_failed`).

---

## 10. Test coverage requirements

Each /goal builds toward verifiable test coverage. The boss checks tests pass before considering a goal met.

**Schema tests** (`scripts/test-schema.ts`): 6 assertions listed in §3.2.

**API tests:**
- `api-check.test.ts` — non-existent email, Arty-only active, cancelled member, case-insensitive lookup.
- `checkout.test.ts` — each product type produces correct price ID and metadata.
- `webhook.test.ts` — each of the 5 event types asserts correct database state. Use fixtures in `tests/fixtures/`.

**Page tests:**
- `signup.test.tsx` — all three cards render with correct prices, button label updates, form submits to checkout endpoint.
- `welcome.test.tsx` — polling behaviour, ready state rendering.

All tests use Vitest. Run with `npm run test`.

---

## 11. Decisions still open (DO NOT GUESS — defer or ask)

1. **Member price for £5 floor events.** £3? £4? Free entry? Decide before first £5 event is ticketed in CA-017. Does not block this build.
2. **QR code verification flow.** v1 spec is "QR encodes member number as plain text." Future: a verify URL with signed token. Not part of this build.
3. **Email verification before checkout.** Currently none — Stripe handles via the magic-link mechanic on the Checkout page. Sufficient for v1.

---

## 12. Build order (for /goal commands)

Each goal references this spec. The order matters — later goals depend on artefacts from earlier ones.

1. **Goal 1** — Schema and core function (§3)
2. **Goal 2** — `/api/membership/check` endpoint (§5.3)
3. **Goal 3** — `/api/checkout/create` endpoint (§5.1)
4. **Goal 4** — `/api/stripe-webhook` handler (§5.2) ← largest, most subtle
5. **Goal 5** — `/` signup page (§6.1)
6. **Goal 6** — `/welcome` page + Resend email (§6.2, §7)
7. **Goal 7** — `/manage` redirect (§6.3, §5.5)

End-to-end smoke test (manual, after all goals): create a real Stripe test-mode subscription, watch the row appear in Supabase, see the welcome email arrive, hit /manage and confirm the portal opens.

---

*Specification v1.0. May 2026. The Alcademy / OtherSyde Ltd.*
*Ad Recte Cogitandum in Mundo Obliquo.*
