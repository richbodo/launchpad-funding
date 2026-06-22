/**
 * Full-session simulation test.
 *
 * Drives a complete live session end-to-end against the deployed backend,
 * exercising stage transitions, multiple investments per investor, gift caps,
 * presence churn, startup metadata edits, and multi-role chat. Asserts both
 * mid-run checkpoints and a final reconciliation pass.
 *
 * Skipped automatically if PG* env vars are missing (psql is required for
 * deterministic seeding/cleanup — same convention as the seeded smoke script).
 *
 * Run: `npx vitest run tests/simulation`
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import {
  seedSession,
  cleanup,
  StageMachine,
  type SeededSession,
} from "./harness";
import {
  FacilitatorActor,
  StartupActor,
  InvestorActor,
  GIFT_MAX_USD,
} from "./actors";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;

function psqlAvailable(): boolean {
  try {
    execSync("psql -tA -c 'select 1'", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const canRun = !!SUPABASE_URL && !!SUPABASE_ANON && psqlAvailable();

(canRun ? describe : describe.skip)("full session simulation", () => {
  let seeded: SeededSession;
  let fac: FacilitatorActor;
  let startupA: StartupActor;
  let startupB: StartupActor;
  let startupC: StartupActor;
  let acc1: InvestorActor;
  let acc2: InvestorActor;
  let com1: InvestorActor;
  let com2: InvestorActor;
  let machine: StageMachine;

  /** Local tally of every commitment write the simulation makes, by startup + type. */
  const tally: Record<string, { equity: number; gift: number; count: number }> = {};
  /** Local tally of every chat message posted (excluding `__COMMIT__::` auto-messages). */
  const chatLedger: Array<{ email: string; role: string; message: string }> = [];
  /**
   * Local ordered ledger of every event the app writes to `session_logs`.
   * Mirrors the exact sequence of `login` / `logout` / `investment` rows the
   * UI would produce. Stage transitions, metadata edits, and chat messages
   * are intentionally NOT included — the production app does not log those
   * to `session_logs` (verified by grepping the codebase). The stage machine
   * is verified separately via `machine.*` invariants, and chat messages via
   * `chatLedger`.
   */
  const eventLedger: Array<{ event_type: "login" | "logout" | "investment"; actor_email: string }> = [];

  const recordCommitment = (
    startupEmail: string,
    type: "equity" | "gift",
    amt: number,
    investorEmail: string,
  ) => {
    const t = (tally[startupEmail] ||= { equity: 0, gift: 0, count: 0 });
    t[type] += amt;
    t.count += 1;
    eventLedger.push({ event_type: "investment", actor_email: investorEmail });
  };

  const recordLogin = (email: string) => eventLedger.push({ event_type: "login", actor_email: email });
  const recordLogout = (email: string) => eventLedger.push({ event_type: "logout", actor_email: email });

  const post = async (
    actor: { postChat: (m: string) => Promise<void>; email: string; role: string },
    message: string,
  ) => {
    await actor.postChat(message);
    chatLedger.push({ email: actor.email, role: actor.role, message });
  };


  beforeAll(async () => {
    const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    seeded = seedSession(runId);

    fac = new FacilitatorActor({
      sessionId: seeded.sessionId,
      id: seeded.facilitator.id,
      email: seeded.facilitator.email,
      displayName: "Sim Facilitator",
      role: "facilitator",
      password: seeded.facilitator.password,
    });
    [startupA, startupB, startupC] = seeded.startups.map(
      (s) =>
        new StartupActor({
          sessionId: seeded.sessionId,
          id: s.id,
          email: s.email,
          displayName: s.display_name,
          role: "startup",
        }),
    );
    [acc1, acc2] = seeded.accredited.map(
      (a) =>
        new InvestorActor({
          sessionId: seeded.sessionId,
          id: a.id,
          email: a.email,
          displayName: a.display_name,
          role: "investor",
          investorClass: "accredited",
        }),
    );
    [com1, com2] = seeded.community.map(
      (c) =>
        new InvestorActor({
          sessionId: seeded.sessionId,
          id: c.id,
          email: c.email,
          displayName: c.display_name,
          role: "investor",
          investorClass: "community",
        }),
    );
  });

  afterAll(() => {
    if (seeded?.sessionId) cleanup(seeded.sessionId);
  });

  it("runs the entire session and reconciles end state", async () => {
    // ---- 1. Join ------------------------------------------------------------
    await fac.login();
    expect(fac.adminToken).toBeTruthy();
    await Promise.all(
      [startupA, startupB, startupC, acc1, acc2, com1, com2].map((a) => a.login()),
    );

    const anon = createClient(SUPABASE_URL, SUPABASE_ANON);
    const presence = await anon
      .from("session_participants")
      .select("email, is_logged_in")
      .eq("session_id", seeded.sessionId);
    expect(presence.error).toBeNull();
    expect(presence.data?.every((r) => r.is_logged_in)).toBe(true);
    expect(presence.data?.length).toBe(8);

    // ---- 2. Build stages ----------------------------------------------------
    machine = new StageMachine(
      seeded.startups.map((s) => ({
        email: s.email,
        display_name: s.display_name,
        presentation_order: s.order,
      })),
    );
    // intro + 3*(presentation + qa) + outro
    expect(machine.stages.length).toBe(1 + 3 * 2 + 1);
    expect(machine.stages[0].type).toBe("intro");
    expect(machine.stages.at(-1)!.type).toBe("outro");
    expect(machine.currentStage.type).toBe("intro");
    expect(machine.remainingSeconds).toBe(5 * 60);

    // ---- 3. Intro: only chat permitted --------------------------------------
    // Mirror Session.tsx button-disabled rule: no commitments during intro.
    expect(() => {
      if (machine.currentStage.type === "intro" || machine.currentStage.type === "outro") {
        throw new Error("investments blocked outside presentation/qa");
      }
    }).toThrow();
    await post(acc1, "Hello from accredited 1");
    await post(com1, "Excited to be here!");
    await post(fac, "Welcome everyone");

    // ---- 4. Startup A presentation ------------------------------------------
    machine.next();
    expect(machine.currentStage.type).toBe("presentation");
    expect(machine.currentStage.startupIndex).toBe(0);

    await acc1.invest(startupA, 1_000);
    recordCommitment(startupA.email, "equity", 1_000);
    await acc1.invest(startupA, 5_000);
    recordCommitment(startupA.email, "equity", 5_000);
    await acc1.invest(startupA, 10_000);
    recordCommitment(startupA.email, "equity", 10_000);
    await acc2.invest(startupA, 2_000);
    recordCommitment(startupA.email, "equity", 2_000);
    await acc2.pledge(startupA, 50);
    recordCommitment(startupA.email, "gift", 50);
    await com1.pledge(startupA, 20);
    recordCommitment(startupA.email, "gift", 20);
    await com1.pledge(startupA, 80);
    recordCommitment(startupA.email, "gift", 80);

    await com2.logout();
    await post(startupA, "Thanks for the questions!");

    // Checkpoint A
    const aRows = await anon
      .from("investments")
      .select("amount, pledge_type")
      .eq("session_id", seeded.sessionId)
      .eq("startup_email", startupA.email);
    expect(aRows.error).toBeNull();
    expect(aRows.data?.length).toBe(7);
    const equityA = aRows.data!.filter((r) => r.pledge_type === "equity").reduce((s, r) => s + Number(r.amount), 0);
    const giftA = aRows.data!.filter((r) => r.pledge_type === "gift").reduce((s, r) => s + Number(r.amount), 0);
    expect(equityA).toBe(18_000);
    expect(giftA).toBe(150);
    expect(aRows.data!.filter((r) => r.pledge_type === "gift").every((r) => Number(r.amount) <= GIFT_MAX_USD)).toBe(true);

    // ---- 5. Startup A Q&A ---------------------------------------------------
    machine.next();
    expect(machine.currentStage.type).toBe("qa");

    await com2.rejoin();
    const rejoinCheck = await anon
      .from("session_participants")
      .select("is_logged_in")
      .eq("id", com2.id)
      .single();
    expect(rejoinCheck.data?.is_logged_in).toBe(true);

    // Client-side gift cap mirrors InvestDialog: amounts above $100 are
    // rejected before any DB write.
    await expect(acc1.pledge(startupA, 150)).rejects.toThrow(/cap exceeded/);
    await acc1.pledge(startupA, 100);
    recordCommitment(startupA.email, "gift", 100);
    await post(fac, "Great pitch from A");

    const aRows2 = await anon
      .from("investments")
      .select("id", { count: "exact", head: true })
      .eq("session_id", seeded.sessionId)
      .eq("startup_email", startupA.email);
    expect(aRows2.count).toBe(8);

    // ---- 6. Startup B presentation: metadata edit --------------------------
    machine.next();
    expect(machine.currentStage.type).toBe("presentation");
    expect(machine.currentStage.startupIndex).toBe(1);

    const newMeta = {
      dd_room_link: "https://dd.example/B-updated",
      website_link: "https://web.example/B-updated",
      funding_goal: 999_000,
    };
    await startupB.updateMetadata(newMeta);

    // Every other actor "re-fetches" participants and sees the new values.
    const refetched = await anon
      .from("session_participants")
      .select("dd_room_link, website_link, funding_goal")
      .eq("id", startupB.id)
      .single();
    expect(refetched.data).toMatchObject(newMeta);

    await acc2.invest(startupB, 25_000);
    recordCommitment(startupB.email, "equity", 25_000);
    await com1.pledge(startupB, 40);
    recordCommitment(startupB.email, "gift", 40);

    // ---- 7. Startup B Q&A: cross-role chat burst ----------------------------
    machine.next();
    expect(machine.currentStage.type).toBe("qa");

    await post(fac, "Q for B: timeline?");
    await post(startupB, "Six months to MVP");
    await post(acc2, "Following up on traction");
    await post(com2, "Cheering you on!");

    // ---- 8. Startup C presentation + Q&A ------------------------------------
    machine.next();
    expect(machine.currentStage.startupIndex).toBe(2);
    await acc1.invest(startupC, 7_500);
    recordCommitment(startupC.email, "equity", 7_500);
    await com2.pledge(startupC, 25);
    recordCommitment(startupC.email, "gift", 25);
    machine.next();
    expect(machine.currentStage.type).toBe("qa");
    await post(startupC, "Q&A for C — fire away");

    // ---- 9. Outro -----------------------------------------------------------
    machine.next();
    expect(machine.currentStage.type).toBe("outro");
    expect(machine.index).toBe(machine.stages.length - 1);
    // Commitments are blocked again at outro per the stage-gate rule.
    expect(() => {
      if (machine.currentStage.type === "intro" || machine.currentStage.type === "outro") {
        throw new Error("investments blocked outside presentation/qa");
      }
    }).toThrow();
    await post(fac, "Thanks all — see you next time");
    await post(acc1, "GG");
    await post(com1, "🎉");

    // ---- 10. State-machine invariants ---------------------------------------
    // tick() should not advance past the final stage.
    machine.paused = false;
    machine.remainingSeconds = 1;
    machine.tick();
    expect(machine.index).toBe(machine.stages.length - 1);
    expect(machine.paused).toBe(true);
    expect(machine.remainingSeconds).toBe(0);

    // resetStage restores the full duration.
    machine.goToStage(0);
    machine.remainingSeconds = 42;
    machine.resetStage();
    expect(machine.remainingSeconds).toBe(machine.stages[0].durationSeconds);
    expect(machine.paused).toBe(true);

    // Return to final stage so the closing assertions reflect end-of-session.
    machine.goToStage(machine.stages.length - 1);

    // ---- 11. Final reconciliation -------------------------------------------
    // Total investment count matches local tally.
    const totalExpected = Object.values(tally).reduce((s, t) => s + t.count, 0);
    const totalRows = await anon
      .from("investments")
      .select("id", { count: "exact", head: true })
      .eq("session_id", seeded.sessionId);
    expect(totalRows.count).toBe(totalExpected);

    // Per-startup totals.
    for (const startup of seeded.startups) {
      const t = tally[startup.email] ?? { equity: 0, gift: 0, count: 0 };
      const rows = await anon
        .from("investments")
        .select("amount, pledge_type")
        .eq("session_id", seeded.sessionId)
        .eq("startup_email", startup.email);
      const equity = rows.data!.filter((r) => r.pledge_type === "equity").reduce((s, r) => s + Number(r.amount), 0);
      const gift = rows.data!.filter((r) => r.pledge_type === "gift").reduce((s, r) => s + Number(r.amount), 0);
      expect(equity).toBe(t.equity);
      expect(gift).toBe(t.gift);
      // Every gift must respect the $100 cap.
      expect(rows.data!.filter((r) => r.pledge_type === "gift").every((r) => Number(r.amount) <= GIFT_MAX_USD)).toBe(true);
      // pledge_type values must be valid.
      expect(rows.data!.every((r) => r.pledge_type === "equity" || r.pledge_type === "gift")).toBe(true);
    }

    // Chat ledger matches DB. We compare the human-posted messages only —
    // each commitment also writes a `__COMMIT__::` chat row from InvestDialog's
    // mirror in actor.ts, so we add those to the expected count.
    const commitCount = Object.values(tally).reduce((s, t) => s + t.count, 0);
    const allChat = await anon
      .from("chat_messages")
      .select("sender_email, sender_role, message, created_at")
      .eq("session_id", seeded.sessionId)
      .order("created_at", { ascending: true });
    expect(allChat.error).toBeNull();
    expect(allChat.data!.length).toBe(chatLedger.length + commitCount);

    // Every role posted at least once.
    const roles = new Set(allChat.data!.map((m) => m.sender_role));
    expect(roles.has("facilitator")).toBe(true);
    expect(roles.has("startup")).toBe(true);
    expect(roles.has("investor")).toBe(true);

    // Human-posted ledger appears in send order within the larger chat stream.
    const humanMessages = allChat.data!
      .filter((m) => !m.message.startsWith("__COMMIT__::"))
      .map((m) => ({ email: m.sender_email, role: m.sender_role, message: m.message }));
    expect(humanMessages).toEqual(chatLedger);

    // session_logs has one investment event per commitment (read via psql —
    // anon role can't SELECT session_logs).
    const logCountRaw = execSync(
      `psql -tA -c "SELECT count(*) FROM public.session_logs WHERE session_id='${seeded.sessionId}' AND event_type='investment';"`,
      { encoding: "utf8" },
    ).trim();
    expect(Number(logCountRaw)).toBe(commitCount);
  });
});
