# YardMaster — Full Project Review

A senior look at the current state and what's worth adding next. No code changes yet — pick what you want and I'll build it.

---

## What's already strong
- Solid module coverage: Gate, Yard, Dock, Tasks, Analytics, AI Ops, Driver self-service.
- Real backend: 12 tables with RLS, security-definer functions for QR check-in/out, smart slot assignment, parking queue.
- Realtime everywhere (yard, tasks, dashboard tiles).
- Predictive ETAs, congestion drilldown, live activity feed already shipped.
- Clean role model (admin / operator / driver) with route guards.

---

## High-impact gaps (recommended next)

### 1. Missing operational modules
- **Weighbridge page** — `weighbridge_readings` table exists and is seeded, but there's no UI to capture/review readings, approve overweight overrides, or see deviation trends.
- **OCR review queue** — `ocr_reads` with `needs_review` status has no dedicated triage screen. Operators currently can't action low-confidence reads.
- **Carriers / Customers master data** — carriers are free-text strings. A `carriers` table with SLAs, contact info, and category defaults would unlock real reporting.
- **Appointments calendar view** — dock page is list-based; a day/week timeline (Gantt) per dock would be much faster for scheduling.
- **Admin: Users & Roles** — no UI to invite operators/drivers or change roles. Currently requires DB access.

### 2. Driver experience
- **Driver mobile home** — `/dashboard/self` exists but there's no PWA manifest, no install prompt, no offline cache for the QR scan flow.
- **Push / SMS notifications on assignment** — Twilio secret is configured but unused for "your dock is ready" / "move to slot B-07" alerts.
- **In-app QR scanner** for operators (camera-based) instead of token URL only.

### 3. Data integrity & safety
- **No FK constraints** declared on any table (per schema dump). Add FKs: `trucks.created_by → auth.users`, `dock_appointments.truck_id → trucks`, `yard_slots.trailer_id → trucks`, `tasks.truck_id → trucks`, etc. Prevents orphans.
- **No audit trail table** for sensitive changes (role changes, slot OOS, appointment cancel). Add `audit_log`.
- **Validation triggers** for: appointment `ends_at > starts_at`, no double-booking same dock window, can't depart a truck not checked in (already in fn, but raw UPDATE bypasses).
- **Soft-delete** on trucks/appointments instead of hard delete (admins currently can DELETE, losing history).

### 4. Security review needed
- `Authenticated can view qr tokens` policy is `USING true` — any logged-in user can read any active QR token and self-check-in someone else. Should restrict to operators/admins or filter by ownership.
- All "Authenticated can view…" policies are wide open. Drivers can read every truck, every appointment, every weighbridge reading. Tighten with per-role visibility (driver sees only their assigned tasks/trucks).
- Run the Lovable security scanner and address findings.

### 5. AI Ops depth
- **LLM-generated daily ops report** (end of shift summary, emailed/exported PDF).
- **Anomaly detection** — flag carriers/drivers with consistent late patterns, weight deviations, repeat OCR failures.
- **What-if simulator** — "if I close Zone B for 2h, what happens to throughput?" using current data.
- **Voice briefing** — TTS of the AI Ops briefing for radio handoff.

### 6. Analytics improvements
- **Date-range picker** + compare-to-previous-period.
- **CSV / PDF export** of any chart.
- **Saved views / dashboards** per user.
- **SLA leaderboard per carrier** (on-time %, avg dwell, incident rate) — needs the carriers table first.
- **Cost view** — detention $, demurrage $, idle-trailer cost (needs rate config).

### 7. UX polish
- **Global command palette** (⌘K) — jump to truck by plate, dock by code, slot by code.
- **Toast/notification center** for realtime events (currently silent).
- **Empty states** with sample-data CTAs on first load.
- **Loading skeletons** instead of "Loading…" text.
- **Dark mode** (industrial control-room aesthetic would fit).
- **Keyboard shortcuts** on Yard map (arrow keys to move selection, R to relocate, X for OOS).

### 8. Developer hygiene
- Route files are large (gate=1254, analytics=1270, dock=892 lines). Extract sub-components into `src/components/{gate,yard,dock,...}/` for maintainability.
- No tests. Add Vitest unit tests for ETA computation, slot scoring, and SLA logic — these are easy to break silently.
- No error tracking (Sentry/PostHog). Currently failures are invisible.
- No `.env.example` documenting expected secrets.
- API route `api.ai.ops.ts` is unauthenticated — should require auth or at least an internal token.

### 9. Integrations worth wiring
- **Twilio SMS** (secret already set) for driver alerts.
- **Email** (transactional) for appointment confirmations / daily report.
- **Webhook out** so external TMS/WMS systems can react to gate events.
- **Webhook in** (`/api/public/...`) so carriers can push appointment updates.
- **Calendar (.ics) export** for dock appointments.

### 10. Performance / scale
- Many client queries fetch up to 5000 rows then aggregate in JS. Move to SQL views or RPCs (`get_zone_metrics`, `get_throughput_buckets`) — faster, cheaper, paginatable.
- Add DB indexes on hot filters: `gate_events(created_at)`, `gate_events(truck_id)`, `trailer_moves(trailer_id, created_at desc)`, `dock_appointments(starts_at)`, `weighbridge_readings(truck_id, created_at)`.
- Realtime subscribes globally on dashboard tiles — debounce reload to avoid query storms during seed/bulk events.

---

## Prioritized recommendation (top 5 to do next)

1. **Tighten RLS** (especially QR tokens + driver visibility) and add **FK constraints** — biggest risk reduction.
2. **Weighbridge UI + OCR review queue** — completes the operational loop; data already exists.
3. **Admin Users & Roles screen** — required before anyone else can realistically use the app.
4. **Twilio SMS on key events** + **PWA install for driver self-service** — turns it into a real field tool.
5. **Refactor large route files into components + add SQL RPCs for analytics** — sets up everything else to scale.

---

## What I'd skip for now
- Dark mode, command palette, voice briefing — nice but cosmetic until the above ship.
- Advanced ML anomaly detection — current heuristics are good enough; revisit with more historical data.

---

Tell me which item(s) you want to tackle and I'll move into build mode and implement them. A good first batch would be **#1 (security) + #2 (weighbridge + OCR review)** in one pass.