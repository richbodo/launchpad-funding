/**
 * Realtime fan-out load test.
 *
 * Opens N Supabase Realtime subscribers on the three broadcast channels the
 * live session uses (`chat:<id>`, `investments:<id>`, `participants:<id>`),
 * then a single publisher sends timestamped broadcast messages on each channel
 * at a steady rate. Each subscriber records the wall-clock delta between the
 * embedded `sent_at` and local receive time. At the end we print p50/p95/p99
 * latency and delivery ratio per channel.
 *
 * This exercises the same Realtime path the production app relies on for live
 * events, without touching Postgres rows — so it's safe to run against prod.
 *
 * Usage:
 *   SUBSCRIBERS=110 SESSION_ID=<uuid> DURATION_SECONDS=60 RATE_PER_SEC=2 \
 *     npx tsx scripts/loadtest-realtime.ts
 *
 * Env (all optional except where noted):
 *   VITE_SUPABASE_URL              required
 *   VITE_SUPABASE_PUBLISHABLE_KEY  required
 *   SESSION_ID                     defaults to a random uuid (channel name only)
 *   SUBSCRIBERS                    default 110
 *   DURATION_SECONDS               default 60
 *   RATE_PER_SEC                   broadcasts per channel per second, default 2
 *   CHANNELS                       comma list, default "chat,investments,participants"
 */
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY");
  process.exit(1);
}

const SESSION_ID = process.env.SESSION_ID ?? randomUUID();
const SUBSCRIBERS = Number(process.env.SUBSCRIBERS ?? 110);
const DURATION_SECONDS = Number(process.env.DURATION_SECONDS ?? 60);
const RATE_PER_SEC = Number(process.env.RATE_PER_SEC ?? 2);
const CHANNELS = (process.env.CHANNELS ?? "chat,investments,participants")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

interface Stats {
  sent: number;
  received: number;
  latencies: number[];
}
const stats: Record<string, Stats> = Object.fromEntries(
  CHANNELS.map((c) => [c, { sent: 0, received: 0, latencies: [] }]),
);

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function pct(arr: number[], p: number): number {
  if (arr.length === 0) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

async function makeSubscriber(idx: number) {
  const client = createClient(SUPABASE_URL!, SUPABASE_ANON!, {
    realtime: { params: { eventsPerSecond: 50 } },
  });
  const channels: RealtimeChannel[] = [];

  for (const name of CHANNELS) {
    const topic = `${name}:${SESSION_ID}`;
    const ch = client.channel(topic, { config: { broadcast: { self: false } } });
    ch.on("broadcast", { event: "load" }, (payload) => {
      const sentAt = (payload.payload as { sent_at?: number })?.sent_at;
      if (typeof sentAt === "number") {
        const latency = Date.now() - sentAt;
        stats[name].received += 1;
        stats[name].latencies.push(latency);
      }
    });
    await new Promise<void>((resolve, reject) => {
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
          reject(new Error(`subscriber ${idx} ${name}: ${status}`));
      });
    });
    channels.push(ch);
  }

  return { client, channels };
}

async function makePublisher() {
  const client = createClient(SUPABASE_URL!, SUPABASE_ANON!);
  const channels: Record<string, RealtimeChannel> = {};
  for (const name of CHANNELS) {
    const ch = client.channel(`${name}:${SESSION_ID}`, {
      config: { broadcast: { self: false, ack: false } },
    });
    await new Promise<void>((resolve, reject) => {
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
          reject(new Error(`publisher ${name}: ${status}`));
      });
    });
    channels[name] = ch;
  }
  return { client, channels };
}

async function main() {
  console.log(
    `[loadtest] url=${SUPABASE_URL} session=${SESSION_ID} subscribers=${SUBSCRIBERS} ` +
      `duration=${DURATION_SECONDS}s rate=${RATE_PER_SEC}/s channels=${CHANNELS.join(",")}`,
  );

  console.log("[loadtest] connecting subscribers...");
  const subs: Array<Awaited<ReturnType<typeof makeSubscriber>>> = [];
  const batchSize = 10;
  for (let i = 0; i < SUBSCRIBERS; i += batchSize) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(batchSize, SUBSCRIBERS - i) }, (_, k) =>
        makeSubscriber(i + k).catch((err) => {
          console.error(`  subscriber ${i + k} failed:`, err.message);
          return null;
        }),
      ),
    );
    for (const s of batch) if (s) subs.push(s);
    process.stdout.write(`  ${subs.length}/${SUBSCRIBERS}\r`);
  }
  console.log(`\n[loadtest] ${subs.length} subscribers connected.`);

  const pub = await makePublisher();
  console.log("[loadtest] publisher connected. Broadcasting...");

  const intervalMs = 1000 / RATE_PER_SEC;
  const endAt = Date.now() + DURATION_SECONDS * 1000;
  let tick = 0;
  while (Date.now() < endAt) {
    const sentAt = Date.now();
    await Promise.all(
      CHANNELS.map(async (name) => {
        const r = await pub.channels[name].send({
          type: "broadcast",
          event: "load",
          payload: { sent_at: sentAt, tick },
        });
        if (r === "ok") stats[name].sent += 1;
      }),
    );
    tick += 1;
    await sleep(intervalMs);
  }

  console.log("[loadtest] flush wait 3s...");
  await sleep(3000);

  console.log("\n=== Results ===");
  const expectedPerChan = (n: number) => n * subs.length;
  for (const name of CHANNELS) {
    const s = stats[name];
    const expected = expectedPerChan(s.sent);
    const ratio = expected > 0 ? (s.received / expected) * 100 : 0;
    console.log(
      `[${name}] sent=${s.sent} expected_recv=${expected} actual_recv=${s.received} ` +
        `delivery=${ratio.toFixed(2)}% ` +
        `p50=${pct(s.latencies, 50)}ms p95=${pct(s.latencies, 95)}ms p99=${pct(s.latencies, 99)}ms ` +
        `max=${Math.max(0, ...s.latencies)}ms`,
    );
  }

  console.log("[loadtest] tearing down...");
  for (const s of subs) {
    for (const ch of s.channels) await s.client.removeChannel(ch);
  }
  for (const name of CHANNELS) await pub.client.removeChannel(pub.channels[name]);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
