# Realtime Load Testing

`scripts/loadtest-realtime.mjs` simulates a live session's Realtime load so we
can validate capacity **before** an event instead of discovering limits during
one. It opens N subscriber clients that mirror the app's per-client channel set
and drives chat (and optionally investment) inserts through the **anon key** —
the exact path a real browser uses — then reports connection success, message
delivery ratio, and end-to-end latency.

## What it measures

- **Subscribers connected** — how many of N clients reached `SUBSCRIBED`. Failures
  here mean you hit the **concurrent-connection ceiling**.
- **Delivery ratio** — deliveries received ÷ (messages sent × subscribers). Below
  ~99% means messages were **dropped** (rate cap / `postgres_changes` backpressure).
- **End-to-end latency** (p50/p95/p99) — insert → received by a subscriber. p95
  climbing through the run means the single-threaded `postgres_changes`
  authorization is **falling behind**.

This is the harness to run before/after the chat+investments → Broadcast
migration to prove the change helps.

## Prerequisites

Requires **Node ≥ 20** (uses `--env-file`). No build step; uses the
`@supabase/supabase-js` already in the project.

## Run against local infra (safe default)

```bash
./scripts/test-infra.sh                 # start Supabase + LiveKit locally
# find a session id (or seed one), then:
npm run loadtest -- --session <SESSION_ID> --subscribers 108 --senders 4 --chat-rate 2 --duration 60
```

`npm run loadtest` reads `.env.test` (local `127.0.0.1` backend), so it can't
touch production.

## Run against the production (Lovable) backend

> ⚠️ Inserts real rows the anon key can't delete, consumes Realtime quota, and
> counts toward the concurrent-connection ceiling. **Use a throwaway session**,
> never run it during a live event, and clean up afterward (delete the test
> session — cascades — or have a facilitator "Archive & Clear Chat").

```bash
node --env-file=.env scripts/loadtest-realtime.mjs --session <THROWAWAY_SESSION_ID> \
     --subscribers 108 --senders 4 --chat-rate 2 --duration 90
```

## Useful flags

| Flag | Default | Meaning |
|------|---------|---------|
| `--session <id>` | — | **Required.** Session UUID to load against. |
| `--subscribers <n>` | 108 | Audience clients (each opens 1 Realtime socket). |
| `--senders <n>` | 4 | Chat-sender clients. |
| `--chat-rate <n>` | 2 | Chat inserts per second (total). |
| `--duration <sec>` | 60 | How long to send traffic. |
| `--channels full\|chat` | full | `full` mirrors all 5 app channels; `chat` isolates the hot path. |
| `--ramp-ms <ms>` | 25 | Stagger between opening subscribers. |
| `--invest` + `--startup-email <e>` | off | Also insert into `investments`. |

## Suggested runs for the ~108-user event

1. **Baseline (current `postgres_changes`):** `--subscribers 108 --chat-rate 2 --duration 90`.
   Note the delivery ratio and p95 latency.
2. **Burst:** bump `--chat-rate 6` to simulate everyone reacting to a pitch; watch
   for the ratio dropping / latency climbing.
3. **After the Broadcast migration:** repeat #1 and #2 — delivery ratio should
   hold ~100% and latency stay flat.
