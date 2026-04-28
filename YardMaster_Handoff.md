# YardMaster — Technical Handoff Document

_Last updated: 2026-04-28_

---

## 1. Project Overview

**YardMaster** is an operational control-tower web application for yard / trailer logistics. It manages the full lifecycle of trucks moving through a distribution yard:

- **Gate** automation (check-in / check-out, OCR plate recognition, manual approvals).
- **Yard map** visibility (slot occupancy, smart auto-assignment, parking queue, predictive ETAs with confidence ranges).
- **Dock** scheduling and appointments (with carrier-category matching).
- **Weighbridge** capture with overweight / deviation flagging and an audit trail of overrides.
- **OCR review queue** with soft-locking to prevent concurrent admin edits + status workflow (`needs_review → approved / overridden / rejected`).
- **Tasks** (yard moves) with driver assignment, SLA tracking, and a live activity feed.
- **Analytics** dashboards: gate throughput, top carriers, dwell-time distribution, congestion heatmap with click-through drilldown.
- **AI Ops** assistant (Lovable AI gateway) for natural-language operational queries.
- **Driver self-service** PWA: QR check-in / check-out, installable on mobile.
- **Admin** screen for managing users and roles.
- **Twilio SMS** alerts to drivers on task assignment.

**Current state:** Feature-complete prototype with seeded demo data, RLS hardened, FK constraints, audit logging on weighbridge + OCR, and a soft-lock concurrency model. Ready for handoff to a developer for production hardening, deeper testing, and deployment.

---

## 2. Frontend Architecture

| Area | Choice | Version |
|------|--------|---------|
| Framework | **TanStack Start** (full-stack React, file-based routing, server functions) | `^1.167` |
| UI lib | **React** | `^19.2.0` |
| Build tool | **Vite** | `^7.3.1` |
| Styling | **Tailwind CSS v4** (via `@tailwindcss/vite`, configured in `src/styles.css` — no `tailwind.config.js`) | `^4.2.1` |
| Component primitives | **shadcn/ui** (New York style, slate base) on top of **Radix UI** | latest |
| Icons | **lucide-react** | `^0.575` |
| Forms | **react-hook-form** + **zod** + `@hookform/resolvers` | — |
| Data fetching | **@tanstack/react-query** | `^5.83` |
| Charts | **Recharts** | `^2.15` |
| Toasts | **Sonner** | `^2.0` |
| Date utils | **date-fns** | `^4.1` |
| QR codes | **qrcode** | `^1.5` |
| PDF export | **jspdf** + **jspdf-autotable** | — |
| Animations | `tw-animate-css` (Framer Motion is **not** used) | — |
| Carousel/drawer | embla-carousel-react, vaul | — |
| Deployment target | Cloudflare Workers (via `@cloudflare/vite-plugin`) | — |

Path alias: `@/*` → `src/*` (configured in `tsconfig.json` and `vite-tsconfig-paths`).

---

## 3. Supabase Schema

All tables live in the `public` schema. Roles enum: `app_role = ('admin','operator','driver')`.

### Tables

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `profiles` | Extended user info (mirrors `auth.users`) | `id` (PK→auth.users), `full_name`, `company_name`, `phone`, `avatar_url` |
| `user_roles` | Role assignments (separate from profiles for security) | `id`, `user_id`, `role` (app_role) — unique on (user_id, role) |
| `trucks` | Master record of every truck visit | `id`, `plate`, `carrier`, `carrier_category`, `trailer_number`, `driver_name`, `driver_phone`, `gate`, `status` (truck_status), `appointment_at`, `checked_in_at`, `departed_at`, `expected_weight_kg` |
| `gate_events` | Append-only log of gate actions | `id`, `truck_id`, `event_type` (gate_event_type), `actor_id`, `ocr_confidence`, `notes` |
| `yard_slots` | Physical slots on the yard map | `id`, `code`, `zone`, `row_label`, `slot_number`, `slot_type` (parking/staging/dock), `status` (slot_status), `trailer_id`, `carrier_categories[]`, `x`, `y` |
| `trailer_moves` | Append-only log of slot changes | `id`, `trailer_id`, `from_slot_id`, `to_slot_id`, `action` (move_action), `actor_id` |
| `parking_queue` | FIFO queue when no slot is available | `id`, `truck_id`, `position`, `status`, `carrier_category`, `assigned_slot_id`, `assigned_at` |
| `docks` | Dock master data | `id`, `code`, `name`, `zone`, `status` (dock_status), `carrier_categories[]`, `display_order` |
| `dock_appointments` | Scheduled inbound/outbound appointments | `id`, `dock_id`, `truck_id`, `carrier`, `carrier_category`, `appointment_type`, `status`, `starts_at`, `ends_at`, `reference` |
| `appointment_qr_tokens` | Single-use QR tokens for self-service check-in/out | `id`, `token`, `purpose` (checkin/checkout), `scope` (appointment/truck), `appointment_id`, `truck_id`, `expires_at`, `single_use`, `used_at`, `used_by_driver` |
| `tasks` | Yard moves and other work | `id`, `title`, `task_type`, `priority`, `status`, `truck_id`, `slot_id`, `dock_id`, `trailer_number`, `assignee_id`, `created_by`, `due_at`, `started_at`, `completed_at`, `instructions` |
| `task_events` | Append-only log of task transitions | `id`, `task_id`, `event_type`, `actor_id`, `notes` |
| `weighbridge_readings` | Captured weights | `id`, `truck_id`, `direction`, `gross_kg`, `tare_kg`, `net_kg`, `expected_kg`, `deviation_pct`, `overweight`, `flagged`, `flag_reason`, `reviewed_by`, `override_reason` |
| `weighbridge_audit` | Trigger-driven audit log of weighbridge state changes | `id`, `reading_id`, `actor_id`, `action`, `before_state` (jsonb), `after_state` (jsonb), `reason` |
| `ocr_reads` | OCR captures (plate / container / trailer) | `id`, `truck_id`, `read_type`, `raw_value`, `normalized_value`, `expected_value`, `confidence`, `status` (ocr_read_status), `override_value`, `override_reason`, `reviewed_by`, `reviewed_at` |
| `ocr_review_audit` | Trigger-driven audit log of OCR status transitions | `id`, `ocr_read_id`, `actor_id`, `action`, `before_status`, `after_status`, `before_value`, `after_value`, `reason` |
| `ocr_review_locks` | Soft-lock to prevent concurrent admin edits (5-min TTL) | `ocr_read_id` (PK), `locked_by`, `locked_at`, `expires_at` |

### Relationships

Logical FKs (most enforced via DB FK constraints added in the latest hardening migration; `auth.users` references use `ON DELETE SET NULL` for actor / created_by columns and `ON DELETE CASCADE` for owner columns like `profiles.id` / `user_roles.user_id`):

```
auth.users 1───* profiles
auth.users 1───* user_roles
auth.users 1───* trucks.created_by, gate_events.actor_id, tasks.assignee_id/created_by,
                  trailer_moves.actor_id, dock_appointments.created_by,
                  weighbridge_readings.reviewed_by, ocr_reads.reviewed_by

trucks 1───* gate_events, ocr_reads, weighbridge_readings, dock_appointments,
              parking_queue, tasks, appointment_qr_tokens
trucks 1───1 yard_slots.trailer_id (current location)

yard_slots 1───* trailer_moves (from/to), tasks.slot_id, parking_queue.assigned_slot_id

docks 1───* dock_appointments, tasks.dock_id
dock_appointments 1───* appointment_qr_tokens

weighbridge_readings 1───* weighbridge_audit
ocr_reads 1───* ocr_review_audit
ocr_reads 1───1 ocr_review_locks
tasks 1───* task_events
```

### Database Functions (SECURITY DEFINER, search_path locked to public)

| Function | Purpose |
|----------|---------|
| `has_role(uuid, app_role) → bool` | RLS helper to check roles without recursion |
| `handle_new_user()` | Trigger on `auth.users` insert → creates profile + default role |
| `set_updated_at()` | Generic trigger to maintain `updated_at` |
| `auto_assign_yard_slot(truck, actor)` | Smart-assigns best matching empty slot, or enqueues |
| `promote_parking_queue(actor)` | Pops next queued truck and assigns a slot |
| `suggest_yard_slots(category, slot_types[], limit)` | Scored slot suggestions |
| `suggest_docks(category, starts_at, ends_at, limit)` | Scored dock suggestions with conflict detection |
| `validate_qr_token(token)` / `validate_qr_checkout(token)` | Read-only QR introspection for the driver UI |
| `consume_qr_checkin(token, driver_name)` / `consume_qr_checkout(...)` | Atomic state transitions for self-service |
| `acquire_ocr_lock(ocr_read_id)` / `release_ocr_lock(...)` | OCR review concurrency control |
| `weighbridge_audit_trigger()` / `ocr_audit_trigger()` | Trigger functions that populate the audit tables |

### Row-Level Security (RLS)

RLS is enabled on **every** table. Policy patterns used throughout:

- **Public read for operational tables** (`trucks`, `yard_slots`, `docks`, `dock_appointments`, `gate_events`, `tasks`, `task_events`, `trailer_moves`, `weighbridge_readings`, `ocr_reads`, `parking_queue`): any authenticated user can `SELECT`. This supports cross-role visibility.
- **Operator/Admin write**: `INSERT` and `UPDATE` gated by `has_role(auth.uid(),'operator') OR has_role(auth.uid(),'admin')`.
- **Admin-only delete**: `DELETE` gated by `has_role(auth.uid(),'admin')`.
- **Sensitive tables** (`appointment_qr_tokens`, `weighbridge_audit`, `ocr_review_audit`): `SELECT` restricted to operator + admin.
- **`profiles`**: users see/update only their own row; admins can see/update all.
- **`user_roles`**: users can read their own roles; only admins can read all, insert, update, or delete. **Roles live in their own table** (never on `profiles`) to prevent privilege escalation.
- **`tasks` UPDATE**: operator, admin, OR the assignee (so drivers can mark their own task done).
- **`task_events` INSERT**: operator, admin, OR the assignee of the parent task.
- **`ocr_review_locks`**: any authenticated user can SELECT (to know who holds the lock); only operators/admins can write.

Audit-log tables (`weighbridge_audit`, `ocr_review_audit`) are **append-only** at the policy level (no UPDATE/DELETE).

---

## 4. Edge Functions & Server-Side Logic

This project does **not** use Supabase Edge Functions. All server-side logic uses **TanStack Start server functions** (`createServerFn`) and **server routes** (`createFileRoute` with `server.handlers`). They run on Cloudflare Workers.

| File | Purpose |
|------|---------|
| `src/server/sms.functions.ts` | `sendDriverSms` — sends SMS via Twilio through the Lovable connector gateway. Triggered when a task is assigned to a driver with a phone number. |
| `src/server/notifications.functions.ts` | In-app notification helpers. |
| `src/routes/api.ai.ops.ts` | Server route for the AI Ops assistant. Calls **Lovable AI gateway** (`google/gemini-2.5-flash` / `openai/gpt-5-mini`) using `LOVABLE_API_KEY`. No user-supplied API key required. |

There are **no** scheduled cron jobs and **no** Stripe / OpenAI direct integrations. AI calls go through Lovable AI Gateway.

Database-side automation:
- Trigger `weighbridge_audit_trigger` → on `weighbridge_readings` INSERT/UPDATE.
- Trigger `ocr_audit_trigger` → on `ocr_reads` UPDATE.
- Trigger `handle_new_user` → on `auth.users` INSERT.
- Trigger `set_updated_at` → on tables with `updated_at`.

---

## 5. State Management

- **Server state**: `@tanstack/react-query` is the source of truth for all data fetched from Supabase. `QueryClient` is created per-request inside the router factory in `src/router.tsx` and provided via `QueryClientProvider` in `src/routes/__root.tsx`.
- **Auth state**: a single React Context (`src/auth/AuthProvider.tsx`) exposes `user`, `session`, `roles`, `loading`, `signOut`, `refreshRoles`. It subscribes to `supabase.auth.onAuthStateChange` BEFORE calling `getSession()` (TanStack Start best practice). Roles are loaded from `user_roles` and cached in state.
- **Realtime**: Supabase Realtime channels are used in the dashboard (Yard map, Tasks feed, Gate) via `supabase.channel(...).on('postgres_changes', ...)`.
- **Local UI state**: standard React `useState` / `useReducer`. No Redux / Zustand / Jotai.
- **Forms**: `react-hook-form` with `zod` validation.
- **Toasts**: `sonner`.

---

## 6. Authentication Flow

- **Provider**: Supabase Auth (Lovable Cloud). Email + password is the primary method; **Google OAuth** is enabled via `@lovable.dev/cloud-auth-js`.
- **Sign-up** (`/sign-up`): captures email, password, full name, company, phone, role. The DB trigger `handle_new_user` creates a `profiles` row and a default `user_roles` row (defaults to `driver`; sign-up form can request a different role).
- **Sign-in** (`/sign-in`): `supabase.auth.signInWithPassword` or `lovable.auth.signInWithOAuth('google', { redirect_uri })`.
- **Session persistence**: browser client uses `localStorage` (auto-refresh on).
- **Protected routes**: `src/routes/dashboard.tsx` is the gate. It:
  1. Redirects to `/sign-in` when not authenticated.
  2. Loads `roles` from context.
  3. Uses a `ROUTE_ACCESS` matrix to decide which child routes the user can hit; redirects unauthorized users to a permitted fallback (`/dashboard/self` for drivers, `/dashboard` for everyone else).
  4. Filters the nav bar to only show links the user can access.
- **Server-side auth**: server functions that need user context use the `requireSupabaseAuth` middleware in `src/integrations/supabase/auth-middleware.ts`, which provides an authenticated supabase client where RLS still applies as that user. Admin / service-role operations use `supabaseAdmin` from `src/integrations/supabase/client.server.ts`.
- **Email confirmation**: enabled (default). Users must verify before signing in.

---

## 7. Environment Variables

Two `.env` files are needed depending on context. **Lovable manages `.env` automatically** in this project, but for local dev outside Lovable a developer needs:

### Frontend / build-time (must be `VITE_*` prefixed)

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<supabase anon/publishable key>
VITE_SUPABASE_PROJECT_ID=<project ref>
```

### Server-side / runtime (Cloudflare Workers / Node)

```env
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<same as VITE_SUPABASE_PUBLISHABLE_KEY>
SUPABASE_SERVICE_ROLE_KEY=<service role key — NEVER expose to client>
SUPABASE_DB_URL=postgresql://...   # only if running local migrations / scripts

# Lovable AI Gateway (for AI Ops assistant)
LOVABLE_API_KEY=<lovable api key>

# Twilio SMS (driver alerts)
TWILIO_API_KEY=<twilio key — managed via Lovable connector in cloud>
TWILIO_FROM_NUMBER=+15551234567
```

### Notes
- The current Supabase project ref is `livywfxwddbaogcabkro` and the publishable key is already in `.env`. The developer should **rotate the service-role key** after handoff and store it only on the server.
- `TWILIO_API_KEY` in Lovable Cloud is provided by the Twilio connector — for self-hosted dev, the developer needs their own Twilio account SID + auth token and to adapt `src/server/sms.functions.ts` to call Twilio directly instead of the connector gateway URL `https://connector-gateway.lovable.dev/twilio`.
- `LOVABLE_API_KEY` is Lovable-specific; for self-hosted dev replace the AI route (`src/routes/api.ai.ops.ts`) with direct OpenAI/Google API calls.

---

## 8. Local Setup Instructions

Prerequisites: **Node 20+**, **bun** (or npm/pnpm) recommended, and a Supabase project (or use the existing one).

```bash
# 1. Clone the repo (after exporting from Lovable to GitHub)
git clone <your-repo-url>
cd <repo>

# 2. Install dependencies (bun is fastest; npm/pnpm also work)
bun install
# or:  npm install

# 3. Create .env at project root with the variables listed in section 7
cp .env.example .env   # if you create one; otherwise create manually
# then edit .env

# 4. (Optional) Apply database migrations to your own Supabase project
#    Migrations live in supabase/migrations/*.sql.
#    Easiest path: install Supabase CLI, link, push.
brew install supabase/tap/supabase   # macOS; see supabase docs for other OS
supabase login
supabase link --project-ref <your-project-ref>
supabase db push

# 5. Run the dev server (Vite + TanStack Start, http://localhost:5173)
bun run dev
# or:  npm run dev

# 6. Build for production
bun run build

# 7. Preview the production build locally
bun run preview

# 8. Lint / format
bun run lint
bun run format
```

### Deploying

The project targets **Cloudflare Workers** via `@cloudflare/vite-plugin`. After `bun run build`, deploy with:

```bash
npx wrangler deploy
```

`wrangler.jsonc` is already configured. The developer must add the runtime secrets (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LOVABLE_API_KEY, TWILIO_*) via:

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# repeat for each secret
```

### Critical files NOT to edit manually
- `src/integrations/supabase/client.ts` — auto-generated.
- `src/integrations/supabase/types.ts` — generated from DB schema. Regenerate with `supabase gen types typescript --project-id <ref> > src/integrations/supabase/types.ts`.
- `src/routeTree.gen.ts` — generated by the TanStack Router Vite plugin.
- `supabase/config.toml` — project-level settings.

---

## 9. Recommended Next Steps for the New Developer

1. Rotate `SUPABASE_SERVICE_ROLE_KEY`, `LOVABLE_API_KEY`, and Twilio credentials.
2. Replace Lovable-specific gateways (AI Gateway, Twilio connector) with direct vendor SDK calls if moving off Lovable.
3. Add automated tests (Vitest + Playwright are not yet wired up).
4. Set up CI (GitHub Actions) for lint + typecheck + build on PRs.
5. Add observability (Sentry / Logflare) — server function logs currently only go to the Worker log stream.
6. Review the seed-data scripts before running against a production database.

---

_End of handoff document._
