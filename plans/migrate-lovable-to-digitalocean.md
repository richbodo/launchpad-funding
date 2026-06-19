# Plan: Migrate FundFlow off Lovable Cloud to a DigitalOcean VM

**Status:** Proposed · **Owner:** Rich · **Created:** 2026-06-19

## Why

FundFlow's backend currently runs on **Lovable Cloud** — a Lovable-managed
Supabase instance (project ref `bjtnmtdmgjkdnztgbaau`). During scaling analysis
for the upcoming ~100-investor event we hit hard walls that come *specifically*
from the managed hosting, not the code:

- **No dashboard / no service-role key / no direct DB access.** We can't read
  live Realtime metrics, can't run migrations ourselves without going through
  Lovable's tooling, and can't directly upgrade the plan.
- **Realtime ceilings are tied to a tier we don't control** (~200 concurrent
  connections / ~100 messages/sec on the small tier) and can only be raised by
  a Lovable support ticket or a compute bump.
- **Email sends route through Lovable's own API** (`LOVABLE_API_KEY` +
  `LOVABLE_SEND_URL`) — a runtime dependency on Lovable even for transactional
  mail.

Owning the box on DigitalOcean gives us: direct SQL/migrations, our own Realtime
limits bounded only by the droplet, real metrics, our own email provider, and a
clean path to the 108-user target.

## Goal & success criteria

1. **Ported:** the app runs entirely on infrastructure we control (DigitalOcean
   + our own LiveKit + our own email provider), with **zero runtime dependency
   on Lovable**.
2. **Bugs fixed:** the trial-session bug milestone ([Investor run (week-out demo
   day)](https://github.com/richbodo/launchpad-funding/milestone/1), issues
   #32–#39) is addressable locally and in prod with full access.
3. **Scales to 108 concurrent users** (100 investors + 5 startups + 3
   facilitators) — validated with `scripts/loadtest-realtime.mjs`: 108
   subscribers connected, ~100% chat delivery, flat p95 latency, and LiveKit
   video stable.

## Sequence (high level)

```
Phase 0  Decide & prep (data export, DNS, accounts)
Phase 1  Stand up self-hosted Supabase on a DO droplet
Phase 2  Sever the other Lovable couplings (email, build tagger, hosting)
Phase 3  Repoint + host the frontend on DO
Phase 4  Do the scaling work we were blocked on (we can run migrations now)
Phase 5  Validate 108-user scale (load test + LiveKit)
Phase 6  Cutover (DNS) and decommission Lovable
Phase 7  Fix the trial-session bugs on the ported platform
```

Phases 1–3 are the port. Phase 4 is the scaling work (was blocked on Lovable
running migrations). Phase 7 (bug fixes) lands after the platform is ours.

---

## Current architecture & what's coupled to Lovable

| Concern | Today (Lovable) | Coupling to sever |
|---|---|---|
| Postgres + RLS | Lovable-managed Supabase | Self-host Supabase Postgres |
| Realtime (5 channels/client) | Lovable Supabase Realtime | Self-host Realtime |
| PostgREST / REST | Lovable Supabase | Self-host (Kong + PostgREST) |
| Edge Functions (Deno) | Lovable Supabase Edge | Self-host `edge-runtime` |
| Storage (`chat-archives` bucket) | Lovable Supabase Storage | Self-host Storage + bucket |
| **Transactional email** | **Lovable send API** (`LOVABLE_API_KEY`, `LOVABLE_SEND_URL`) | **Replace with a real ESP** |
| Build-time tagging | `lovable-tagger` vite plugin | Remove plugin + devDep |
| Frontend hosting | Lovable preview/deploy | Serve from DO |
| Source of truth | **Lovable pushes to GitHub `main`** (e.g. "Hardened auto-login flow", "/send to admin menu") | Stop Lovable→GitHub sync after cutover |
| Video (LiveKit Cloud) | `wss://launchpad-funding-lh2kozm1.livekit.cloud` | **Not Lovable** — keep as-is (see below) |

**The app is deeply tied to Supabase primitives** (supabase-js, Realtime
channels, RLS, edge functions). The right port is therefore **self-hosting the
Supabase stack** (not rewriting to a bespoke API), which keeps the application
code almost entirely unchanged — we mostly repoint `VITE_SUPABASE_URL` and the
anon key.

**LiveKit is independent of Lovable.** It already runs on LiveKit Cloud. For the
event, keep it on LiveKit Cloud (**Ship tier**, since 108 > the free tier's
100-participant cap). Self-hosting LiveKit on DO is a later cost optimization,
not part of this migration's critical path.

## Target architecture (DigitalOcean)

A single sized droplet running the Supabase self-host Docker Compose stack
behind a TLS reverse proxy, serving the built SPA, with LiveKit Cloud unchanged:

```
                      ┌──────────────── DigitalOcean Droplet ────────────────┐
  investor browser ──▶│  Caddy/nginx (TLS, Let's Encrypt)                    │
        │             │    ├── /            → built SPA (static)             │
        │             │    └── /  (api)     → Kong → PostgREST / Realtime /  │
        │             │                        Storage / Edge Runtime (Deno) │
        │             │  Postgres (wal_level=logical, supabase_realtime pub) │
        │             │  Docker Compose: supabase/* services                 │
        │             └───────────────────────────────────────────────────────┘
        │
        └── WebRTC ───▶ LiveKit Cloud (Ship tier) — unchanged
                        Email ─▶ Resend/Postmark/SES (replaces Lovable send API)
```

**Droplet sizing (starting point):** **4 vCPU / 8 GB** (DO "Premium"/"General
Purpose"). Rationale: Realtime + Postgres + edge runtime + nginx for ~108
WebSocket clients. Start here, **let the load test (Phase 5) be the gate**, and
resize up if p95 latency climbs. A 2 vCPU/4 GB box may suffice once chat is on
Broadcast, but 4/8 gives headroom for the event. Consider splitting Postgres to
a **DO Managed Postgres** later for backups/HA (adds setup complexity around
roles + `wal_level=logical`, so not for the first cut).

---

## Phase 0 — Decide & prep

- [ ] **Data export decision (biggest risk).** Lovable Cloud gives us no direct
      DB access, so we cannot `pg_dump` ourselves. Decide:
  - **(a) Fresh start** — recreate sessions/participants from scratch on the new
    box. The schema is fully reproducible from `supabase/migrations/`, so no
    export is needed if we accept losing existing rows (most current data is
    test/demo). **Preferred** if there's no production data worth keeping.
  - **(b) Export via Lovable support** — open a ticket asking Lovable for a
    `pg_dump` of project `bjtnmtdmgjkdnztgbaau` (schema + data), then restore
    into the self-host. Needed only if real participant/investment data must
    survive.
- [ ] Provision: DO account, droplet, a domain/subdomain (e.g. `app.fundflow…`
      and `api.fundflow…`), DNS records, firewall (allow 80/443/22 only).
- [ ] Pick the **email provider** (recommend **Resend** — the templates in
      `supabase/functions/_shared/transactional-email-templates/*.tsx` are
      React/TSX and map cleanly to Resend; Postmark/SES also fine).
- [ ] Confirm LiveKit Cloud is on **Ship** tier and the API key/secret are ours.

## Phase 1 — Self-hosted Supabase on the droplet

- [ ] Droplet: Ubuntu LTS, install Docker + Docker Compose, harden (ufw,
      fail2ban, unattended-upgrades, non-root deploy user).
- [ ] Clone the official Supabase self-host compose (`supabase/docker`).
      Generate **fresh secrets**: `POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`,
      `SERVICE_ROLE_KEY` (the latter two are JWTs signed with `JWT_SECRET`),
      `DASHBOARD_USERNAME/PASSWORD` for Studio.
- [ ] Bring up Postgres + Kong + PostgREST + Realtime + Storage + Studio +
      `edge-runtime`. Confirm `wal_level=logical` (Realtime needs it).
- [ ] **Apply our schema** from the repo with the Supabase CLI against the
      self-host DB: `supabase db push` (or replay `supabase/migrations/*.sql`).
      This recreates tables, enums, RLS, and the `supabase_realtime` publication
      our migrations configure.
- [ ] **Storage:** create the **`chat-archives`** bucket (used by
      `archive-chat`); set its access policy to facilitator-only as today.
- [ ] **Deploy edge functions:** copy `supabase/functions/*` into the
      edge-runtime volume; set per-function secrets (below). Honor the
      `verify_jwt` settings in `supabase/config.toml` (e.g.
      `process-email-queue`/`send-transactional-email` = true;
      `handle-email-*`/`email-logs`/`preview-*` = false).
- [ ] **Secrets to set on the new box** (inventoried from the functions):
  - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` → point at the self-host
  - `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_WS_URL` → LiveKit Cloud
  - **Replace** `LOVABLE_API_KEY` + `LOVABLE_SEND_URL` → the new ESP's key/URL
    (see Phase 2)
- [ ] (If data export chosen) restore the Lovable `pg_dump` after schema is in.

## Phase 2 — Sever the remaining Lovable couplings

- [ ] **Email provider swap (code change).** Update the send path
      (`supabase/functions/send-transactional-email/` and/or
      `process-email-queue/`) to call the chosen ESP instead of
      `LOVABLE_SEND_URL`. Keep the existing template registry
      (`_shared/transactional-email-templates/`). Verify the queue/suppression/
      unsubscribe flow end-to-end (`email_send_log`, `email_send_state`,
      `suppressed_emails`, `email_unsubscribe_tokens`).
- [ ] **Remove `lovable-tagger`:** delete the import + `componentTagger()` usage
      in `vite.config.ts` and drop the devDependency from `package.json`.
- [ ] Remove `.lovable/` and any Lovable-specific config from the repo.
- [ ] Note `supabase/config.toml` `project_id` no longer points anywhere we use;
      update or leave for local CLI only.

## Phase 3 — Repoint & host the frontend

- [ ] Update env: `VITE_SUPABASE_URL` → `https://api.<domain>`,
      `VITE_SUPABASE_PUBLISHABLE_KEY` → the new self-host **anon key**. Update
      `.env`, `.env.test` stays local. Regenerate
      `src/integrations/supabase/types.ts` from the new DB if desired.
- [ ] `npm run build`, serve `dist/` via Caddy/nginx on the droplet (Caddy gives
      automatic Let's Encrypt TLS with the least config). Alternative: DO App
      Platform or Spaces+CDN for the static SPA, droplet for the API only.
- [ ] Smoke test all roles (login, video join, chat, invest, admin) against the
      self-host.

## Phase 4 — Scaling work (now unblocked — we can run migrations)

This is the backend half we previously had to route through Lovable. With direct
DB access it's ours to run. (Frontend half is already in **PR #30**:
`adaptiveStream`/`dynacast`, investor join jitter, token retry — merge it.)

- [ ] **Indexes** (migration): `chat_messages(session_id, created_at)`,
      `investments(session_id)`, `session_participants(session_id, email, role)`.
- [ ] **Chat + investments → Realtime Broadcast.** Replace the `postgres_changes`
      subscriptions (`ChatPanel.tsx`, the `investments-${id}` block in
      `Session.tsx`) with Broadcast, fed by `realtime.broadcast_changes`
      triggers. Removes the single-threaded per-subscriber RLS authorization
      bottleneck — the deepest scaling risk, independent of host/tier.
- [ ] **Chat fetch:** cap to latest ~50 messages + dedupe by `id` (reconnect
      safety).
- [ ] **`participants` channel:** drop or column-filter so a login flipping
      `is_logged_in` doesn't wake all ~108 clients.
- [ ] **Funding-meter consistency:** subscribe before the initial total fetch and
      dedupe by `investments.id` (fixes drift/double-count).
- [ ] **Realtime config:** raise self-host connection limits as needed (now
      bounded by the droplet, not a tier cap). At 108 connections we're well
      within a 4/8 box.

> Note: there are **5** Realtime channels per client today — `chat`,
> `investments`, `session-status`, `participants` (all `postgres_changes`) +
> `stage-sync` (broadcast/presence). Moving the two hottest (`chat`,
> `investments`) to Broadcast is the priority.

## Phase 5 — Validate 108-user scale

- [ ] Run `scripts/loadtest-realtime.mjs` against the DO instance (see
      `docs/loadtest.md`):
  - Baseline `--subscribers 108 --chat-rate 2 --duration 90`
  - Burst `--chat-rate 6`
  - Re-run both **after** the Broadcast migration — expect ~100% delivery and
    flat p95.
- [ ] LiveKit: confirm Ship tier, `adaptiveStream`/`dynacast` on (PR #30), and
      8 publishers + ~100 view-only subscribers stable; sanity-check downstream
      bandwidth (~3.25 Mbps/investor optimized).
- [ ] **Go/no-go gate:** all three success criteria above met.

## Phase 6 — Cutover & decommission

- [ ] Final smoke test on the new stack; switch DNS to the droplet.
- [ ] **Stop the Lovable → GitHub sync** so `main` has a single source of truth
      (us). Coordinate so in-flight Lovable work is captured first.
- [ ] Keep Lovable read-only for a grace period; export anything outstanding;
      then decommission.
- [ ] Set up **backups** (nightly `pg_dump` to DO Spaces + droplet snapshots),
      basic monitoring/alerting (Realtime connection count, Postgres CPU, disk),
      and log rotation.

## Phase 7 — Fix the trial-session bugs

With the platform ours, work the milestone (#32–#39): magic-link login (note
Lovable's recent "Hardened auto-login flow" commit may already touch this),
video-on-join, timer/stage-sync, audio, screen-share quality, control clarity,
timer controls, durations. Reproduce locally against the self-host, fix, and
re-run the load test to confirm no regressions.

---

## Risks & open questions

- **Data export from Lovable** is the top unknown (no direct DB access). Resolve
  in Phase 0 — fresh start vs. support-ticket dump.
- **Edge-function parity** on the self-hosted Deno `edge-runtime` (esp. the
  email functions after the ESP swap). Test each function.
- **Email deliverability:** new ESP needs domain verification (SPF/DKIM/DMARC)
  before the event — start early.
- **Operational burden** we now own: TLS renewal, backups, security patching,
  monitoring, no managed dashboard. Budget time for this.
- **Lovable still owns `main` today.** Until Phase 6, Lovable may push commits;
  rebase/coordinate to avoid divergence (this plan branch is based on the latest
  `origin/main`).
- **Single droplet = single point of failure** for the event. Mitigate with a
  pre-event snapshot and a tested restore runbook; consider a standby.

## Rollback

Until Phase 6 DNS cutover, Lovable remains fully live and authoritative —
rollback is "don't switch DNS." Keep the Lovable project untouched through
Phase 5 so we can abort the migration with zero user impact.

## Effort estimate (rough)

| Phase | Effort |
|---|---|
| 0 Prep / decisions | 0.5 day |
| 1 Self-host Supabase | 1–2 days |
| 2 Sever couplings (email swap is the bulk) | 1 day |
| 3 Repoint + host SPA | 0.5 day |
| 4 Scaling migrations | 1 day |
| 5 Load test + tune | 0.5–1 day |
| 6 Cutover + ops hardening | 1 day |
| 7 Bug fixes | tracked separately (milestone #1) |

**Critical path to a scaled, owned platform: ~5–7 working days** before bug-fix
work, with email domain verification and the data-export decision as the long
poles to start first.
