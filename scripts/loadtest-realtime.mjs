#!/usr/bin/env node
/**
 * Realtime load-test harness for FundFlow sessions.
 *
 * Simulates a live session's Realtime load: N "investor" subscriber clients
 * that mirror the app's channel set, plus a small pool of sender clients that
 * drive chat (and optionally investment) inserts via the anon key — exactly
 * the path the real browser uses. Measures connection success, message
 * delivery ratio, and end-to-end latency (insert -> received by subscribers).
 *
 * It uses ONLY the publishable/anon key and the same client API as the app,
 * so it exercises the real RLS + Realtime publication, not a privileged path.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * USAGE
 *
 *   # Against LOCAL test infra (safe; reads .env.test):
 *   ./scripts/test-infra.sh                       # start Supabase + LiveKit
 *   node --env-file=.env.test scripts/loadtest-realtime.mjs --session <SESSION_ID>
 *
 *   # Against the PRODUCTION (Lovable) backend — see the WARNING below:
 *   node --env-file=.env scripts/loadtest-realtime.mjs --session <SESSION_ID> \
 *        --subscribers 108 --senders 4 --chat-rate 2 --duration 90
 *
 * Required env (either VITE_ or bare names; --env-file=.env provides them):
 *   VITE_SUPABASE_URL                / SUPABASE_URL
 *   VITE_SUPABASE_PUBLISHABLE_KEY    / SUPABASE_KEY
 *
 * Flags (all optional except --session):
 *   --session <id>       Session UUID to load against            (required)
 *   --subscribers <n>    Subscriber (audience) clients           (default 108)
 *   --senders <n>        Chat sender clients                     (default 4)
 *   --chat-rate <n>      Chat inserts per second (total)         (default 2)
 *   --duration <sec>     How long to send traffic                (default 60)
 *   --channels <mode>    "full" (5 channels, like the app) | "chat"  (default full)
 *   --ramp-ms <ms>       Stagger between opening subscribers     (default 25)
 *   --invest             Also insert into `investments` (needs --startup-email)
 *   --startup-email <e>  startup_email for investment inserts
 *   --help               Show this help
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️  WARNING — running against production:
 *   • This INSERTS rows into chat_messages (and investments with --invest).
 *     The anon key cannot DELETE them, so use a THROWAWAY session and delete
 *     that session afterward (cascades), or have a facilitator use
 *     "Archive & Clear Chat" to clean up.
 *   • It consumes Realtime quota and counts toward the concurrent-connection
 *     ceiling for the duration of the run. Don't run it during a live event.
 *   • Opening 108 sockets stresses THIS machine too; --ramp-ms spreads it.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';

// ── Config ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const flags = new Set(['invest', 'help']);
    if (flags.has(key)) { out[key] = true; continue; }
    out[key] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv);

if (args.help) {
  // Print the header doc block and exit.
  console.log('See the header comment in scripts/loadtest-realtime.mjs for usage.');
  process.exit(0);
}

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SESSION_ID = args.session || process.env.SESSION_ID;

const SUBSCRIBERS = Number(args.subscribers ?? 108);
const SENDERS = Number(args.senders ?? 4);
const CHAT_RATE = Number(args['chat-rate'] ?? 2); // total inserts/sec
const DURATION = Number(args.duration ?? 60);     // seconds of traffic
const CHANNELS = (args.channels ?? 'full');        // 'full' | 'chat'
const RAMP_MS = Number(args['ramp-ms'] ?? 25);
const INVEST = Boolean(args.invest);
const STARTUP_EMAIL = args['startup-email'];

function fail(msg) { console.error(`\n✖ ${msg}\n`); process.exit(1); }

if (!URL || !KEY) fail('Missing SUPABASE_URL / SUPABASE_KEY. Pass --env-file=.env (or .env.test).');
if (!SESSION_ID) fail('Missing --session <id>.');
if (INVEST && !STARTUP_EMAIL) fail('--invest requires --startup-email <email>.');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROBE = '__probe__'; // prefix marking a measurable message

// ── Metrics ─────────────────────────────────────────────────────────────
const metrics = {
  subscribeOk: 0,
  subscribeErr: 0,
  channelErrors: 0,
  sent: 0,
  sendErrors: 0,
  delivered: 0,        // total probe deliveries across all subscribers
  latencies: [],       // ms, one per delivery
  connectMs: [],       // ms to reach SUBSCRIBED, per subscriber
};

function pct(arr, p) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

// ── Subscriber clients (the audience) ───────────────────────────────────
function newClient() {
  return createClient(URL, KEY, {
    realtime: { params: { eventsPerSecond: 200 } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function onChatPayload(payload) {
  const msg = payload?.new?.message;
  if (typeof msg !== 'string' || !msg.startsWith(PROBE)) return;
  try {
    const meta = JSON.parse(msg.slice(PROBE.length));
    const dt = Date.now() - meta.t0;
    metrics.delivered++;
    metrics.latencies.push(dt);
  } catch { /* ignore malformed */ }
}

async function startSubscriber(i) {
  const client = newClient();
  const t0 = Date.now();

  // Channel 1 — chat (the hot path we measure)
  const chat = client.channel(`chat-${SESSION_ID}`).on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `session_id=eq.${SESSION_ID}` },
    onChatPayload,
  );

  const channels = [chat];

  if (CHANNELS === 'full') {
    // Mirror the rest of the app's per-client channel set so the backend
    // sees realistic fan-out, even though we only measure chat latency.
    channels.push(
      client.channel(`investments-${SESSION_ID}`).on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'investments', filter: `session_id=eq.${SESSION_ID}` },
        () => {},
      ),
      client.channel(`session-status-${SESSION_ID}`).on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${SESSION_ID}` },
        () => {},
      ),
      client.channel(`participants-${SESSION_ID}`).on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'session_participants', filter: `session_id=eq.${SESSION_ID}` },
        () => {},
      ),
      client.channel(`stage-sync-${SESSION_ID}`).on('broadcast', { event: 'stage_state' }, () => {}),
    );
  }

  let settled = false;
  await Promise.all(channels.map((ch) => new Promise((resolve) => {
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (!settled) { settled = true; metrics.connectMs.push(Date.now() - t0); resolve(); }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        metrics.channelErrors++;
        if (!settled) { settled = true; resolve(); }
      }
    });
    // Safety timeout so one stuck channel doesn't hang the run.
    setTimeout(() => { if (!settled) { settled = true; resolve(); } }, 15000);
  })));

  if (settled && metrics.connectMs.length > metrics.subscribeOk) metrics.subscribeOk++;
  else if (!settled) metrics.subscribeErr++;

  return { client, channels };
}

// ── Sender clients (chat / investment inserts) ──────────────────────────
let seq = 0;
async function sendChat(client, fromIdx) {
  const t0 = Date.now();
  const body = `${PROBE}${JSON.stringify({ id: ++seq, t0, from: fromIdx })}`;
  const { error } = await client.from('chat_messages').insert({
    session_id: SESSION_ID,
    sender_email: `loadtest-${fromIdx}@example.com`,
    sender_name: `LoadTest ${fromIdx}`,
    sender_role: 'investor',
    message: body,
  });
  if (error) { metrics.sendErrors++; if (metrics.sendErrors <= 3) console.error('  send error:', error.message); }
  else metrics.sent++;
}

async function sendInvestment(client, fromIdx) {
  const { error } = await client.from('investments').insert({
    session_id: SESSION_ID,
    investor_email: `loadtest-${fromIdx}@example.com`,
    investor_name: `LoadTest ${fromIdx}`,
    startup_email: STARTUP_EMAIL,
    startup_name: 'LoadTest Startup',
    amount: 1000,
  });
  if (error) { metrics.sendErrors++; if (metrics.sendErrors <= 3) console.error('  invest error:', error.message); }
}

// ── Run ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('FundFlow Realtime load test');
  console.log(`  target      : ${URL}`);
  console.log(`  session     : ${SESSION_ID}`);
  console.log(`  subscribers : ${SUBSCRIBERS} (${CHANNELS} channel set)`);
  console.log(`  senders     : ${SENDERS} @ ${CHAT_RATE} chat msg/s for ${DURATION}s${INVEST ? ' (+ investments)' : ''}`);
  console.log('');

  // 1) Open subscribers with a ramp so we don't self-throttle the machine.
  console.log(`Opening ${SUBSCRIBERS} subscribers (ramp ${RAMP_MS}ms)...`);
  const subs = [];
  const opening = [];
  for (let i = 0; i < SUBSCRIBERS; i++) {
    opening.push(startSubscriber(i).then((s) => subs.push(s)));
    if (RAMP_MS) await sleep(RAMP_MS);
  }
  await Promise.all(opening);
  console.log(`  subscribed  : ${metrics.subscribeOk}/${SUBSCRIBERS}  (errors: ${metrics.subscribeErr}, channel errors: ${metrics.channelErrors})`);
  if (metrics.connectMs.length) {
    console.log(`  connect ms  : p50 ${pct(metrics.connectMs, 50)} / p95 ${pct(metrics.connectMs, 95)} / max ${Math.max(...metrics.connectMs)}`);
  }

  if (metrics.subscribeOk === 0) fail('No subscribers connected — check the URL/key, that the session exists, and that the tables are in the Realtime publication.');

  // 2) Open senders and drive traffic.
  const senders = Array.from({ length: SENDERS }, () => newClient());
  console.log(`\nSending chat for ${DURATION}s...`);
  const intervalMs = Math.max(5, Math.floor(1000 / Math.max(1, CHAT_RATE)));
  let tick = 0;
  const startedAt = Date.now();
  const timer = setInterval(() => {
    const s = senders[tick % senders.length];
    sendChat(s, tick % senders.length);
    if (INVEST && tick % 5 === 0) sendInvestment(s, tick % senders.length);
    tick++;
  }, intervalMs);

  // Progress heartbeat
  const hb = setInterval(() => {
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    process.stdout.write(`\r  ${elapsed}s  sent=${metrics.sent}  delivered=${metrics.delivered}  errors=${metrics.sendErrors}   `);
  }, 1000);

  await sleep(DURATION * 1000);
  clearInterval(timer);

  // 3) Drain: wait for in-flight deliveries.
  console.log('\nDraining (3s)...');
  await sleep(3000);
  clearInterval(hb);

  // 4) Report.
  const expected = metrics.sent * metrics.subscribeOk;
  const ratio = expected ? ((metrics.delivered / expected) * 100).toFixed(1) : 'n/a';
  console.log('\n──────────── RESULTS ────────────');
  console.log(`subscribers connected : ${metrics.subscribeOk}/${SUBSCRIBERS}`);
  console.log(`channel errors        : ${metrics.channelErrors}`);
  console.log(`chat messages sent    : ${metrics.sent}  (send errors: ${metrics.sendErrors})`);
  console.log(`deliveries received   : ${metrics.delivered}  (expected ~${expected})`);
  console.log(`delivery ratio        : ${ratio}%   ← want ~100%`);
  if (metrics.latencies.length) {
    console.log(`end-to-end latency ms : p50 ${pct(metrics.latencies, 50)} / p95 ${pct(metrics.latencies, 95)} / p99 ${pct(metrics.latencies, 99)} / max ${Math.max(...metrics.latencies)}`);
  }
  console.log('─────────────────────────────────');
  console.log('\nInterpretation:');
  console.log('  • delivery ratio < ~99%  → messages dropped (rate cap / postgres_changes backpressure).');
  console.log('  • p95 latency climbing through the run → single-threaded authorization falling behind.');
  console.log('  • subscribe errors / channel errors → hit the concurrent-connection ceiling.');

  // Teardown.
  for (const s of subs) { try { for (const ch of s.channels) await s.client.removeChannel(ch); } catch { /* noop */ } }
  process.exit(0);
}

process.on('SIGINT', () => { console.log('\nInterrupted — partial run, exiting.'); process.exit(130); });

main().catch((e) => fail(e?.message || String(e)));
