/**
 * Test harness for the full-session simulation.
 *
 * Responsibilities:
 *   - Seed a `[SIM]`-prefixed session and all participants directly via psql
 *     (matches the seeded-smoke pattern in scripts/smoke-edge-functions-seeded.sh).
 *   - Provide a tiny pure stage-machine mirror (`StageMachine`) that mimics the
 *     parts of `useSessionStages` that aren't React-bound, so the simulation
 *     can drive transitions without rendering the hook.
 *   - Cleanup all rows created by the simulation on teardown.
 *
 * Requires:
 *   - psql in PATH and PG* env vars set (matches the dev-server sandbox).
 *   - VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY in env (already in .env).
 */
import { execSync } from "node:child_process";
import { buildStages, type Stage } from "@/hooks/useSessionStages";

export const SIM_TAG = "[SIM]";

/**
 * Safety net: refuse to run against the production Supabase project. The
 * simulation seeds rows directly via psql (using whatever PG* env the shell
 * happens to have), so accidentally pointing it at prod would litter the
 * live database with `[SIM]` sessions. Bypass with FUNDFLOW_ALLOW_PROD=1
 * if you really mean it.
 */
const PROD_PROJECT_REF = "bjtnmtdmgjkdnztgbaau";
function assertNotProd(): void {
  if (process.env.FUNDFLOW_ALLOW_PROD === "1") return;
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const host = process.env.PGHOST || "";
  if (url.includes(PROD_PROJECT_REF) || host.includes(PROD_PROJECT_REF)) {
    throw new Error(
      `Refusing to run the [SIM] harness against the production Supabase project (${PROD_PROJECT_REF}). ` +
        `Point VITE_SUPABASE_URL / PGHOST at a dev project, or set FUNDFLOW_ALLOW_PROD=1 to override.`,
    );
  }
}

export interface SeededSession {
  sessionId: string;
  facilitator: { id: string; email: string; password: string };
  startups: Array<{ id: string; email: string; display_name: string; order: number }>;
  accredited: Array<{ id: string; email: string; display_name: string }>;
  community: Array<{ id: string; email: string; display_name: string }>;
}

function psql(sql: string): string {
  const out = execSync(`psql -tA -v ON_ERROR_STOP=1`, {
    encoding: "utf8",
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
  });
  // -tA still emits the trailing "INSERT 0 1" status line. Return the first
  // non-empty line that isn't a psql status (e.g. the RETURNING value).
  return (
    out
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !/^(INSERT|UPDATE|DELETE|SELECT)\s+\d/.test(l)) ?? ""
  );
}

/**
 * Insert one session and all participants. Returns identifiers so the
 * simulation can drive each actor without re-querying.
 *
 * The facilitator password is set in plaintext; the
 * `hash_participant_password` BEFORE INSERT trigger bcrypts it automatically.
 */
export function seedSession(runId: string): SeededSession {
  const sessionName = `${SIM_TAG} ${runId}`;
  const slug = `sim-${runId.toLowerCase()}`;

  // Session row.
  const sessionId = psql(`
    INSERT INTO public.sessions (name, slug, start_time, end_time, status, max_attendees)
    VALUES ('${sessionName}', '${slug}', now(), now() + interval '2 hours', 'live', 50)
    RETURNING id;
  `);

  const facEmail = `fac-${runId}@sim.test`;
  const facPass = `pw-${runId}`;
  const facilitatorId = psql(`
    INSERT INTO public.session_participants
      (session_id, email, role, display_name, password_hash, approved)
    VALUES ('${sessionId}', '${facEmail}', 'facilitator', 'Sim Facilitator', '${facPass}', true)
    RETURNING id;
  `);

  const startups = [1, 2, 3].map((n) => {
    const email = `startup${n}-${runId}@sim.test`;
    const display_name = `Sim Startup ${n}`;
    const id = psql(`
      INSERT INTO public.session_participants
        (session_id, email, role, display_name, presentation_order, approved,
         dd_room_link, website_link, funding_goal)
      VALUES ('${sessionId}', '${email}', 'startup', '${display_name}', ${n}, true,
              'https://dd.example/${n}', 'https://web.example/${n}', ${n * 100_000})
      RETURNING id;
    `);
    return { id, email, display_name, order: n };
  });

  const accredited = [1, 2].map((n) => {
    const email = `acc${n}-${runId}@sim.test`;
    const display_name = `Accredited ${n}`;
    const id = psql(`
      INSERT INTO public.session_participants
        (session_id, email, role, display_name, investor_class, approved)
      VALUES ('${sessionId}', '${email}', 'investor', '${display_name}', 'accredited', true)
      RETURNING id;
    `);
    return { id, email, display_name };
  });

  const community = [1, 2].map((n) => {
    const email = `com${n}-${runId}@sim.test`;
    const display_name = `Community ${n}`;
    const id = psql(`
      INSERT INTO public.session_participants
        (session_id, email, role, display_name, investor_class, approved)
      VALUES ('${sessionId}', '${email}', 'investor', '${display_name}', 'community', true)
      RETURNING id;
    `);
    return { id, email, display_name };
  });

  return {
    sessionId,
    facilitator: { id: facilitatorId, email: facEmail, password: facPass },
    startups,
    accredited,
    community,
  };
}

/**
 * Cascade-delete all rows tagged to this session. session_participants,
 * investments, chat_messages, and session_logs all reference sessions via FK
 * with ON DELETE CASCADE, so a single DELETE is enough.
 */
export function cleanup(sessionId: string): void {
  try {
    psql(`DELETE FROM public.sessions WHERE id = '${sessionId}';`);
  } catch {
    /* best-effort */
  }
}

/**
 * Pure mirror of useSessionStages' state machine. Mirrors only the transitions
 * the simulation needs: build, next, prev, goToStage, resetStage, tick.
 *
 * Keeping it as a plain class lets us assert on internal state without
 * mounting React.
 */
export class StageMachine {
  readonly stages: Stage[];
  index = 0;
  paused = true;
  remainingSeconds: number;

  constructor(startups: Array<{ email: string; display_name: string | null; presentation_order: number | null }>) {
    this.stages = buildStages(startups);
    this.remainingSeconds = this.stages[0]?.durationSeconds ?? 0;
  }

  get currentStage(): Stage {
    return this.stages[this.index];
  }

  next(): void {
    if (this.index < this.stages.length - 1) this.goToStage(this.index + 1);
  }

  prev(): void {
    if (this.index > 0) this.goToStage(this.index - 1);
  }

  goToStage(i: number): void {
    if (i < 0 || i >= this.stages.length) return;
    this.index = i;
    this.remainingSeconds = this.stages[i].durationSeconds;
    this.paused = true;
  }

  resetStage(): void {
    this.remainingSeconds = this.currentStage.durationSeconds;
    this.paused = true;
  }

  /** Simulate one second of clock ticking when unpaused. */
  tick(): void {
    if (this.paused) return;
    if (this.remainingSeconds > 1) {
      this.remainingSeconds -= 1;
      return;
    }
    // Advance, mirroring the hook's "stop at final stage" rule.
    if (this.index + 1 < this.stages.length) {
      this.index += 1;
      this.remainingSeconds = this.stages[this.index].durationSeconds;
    } else {
      this.paused = true;
      this.remainingSeconds = 0;
    }
  }
}
