/**
 * Lightweight actor wrappers for the session simulation. Each actor owns a
 * Supabase JS client (anon key — same trust model as the browser) and exposes
 * exactly the operations the React UI would trigger on the user's behalf.
 *
 * Investment / pledge writes mirror `InvestDialog.handleInvest` precisely:
 *   1) insert into `investments`
 *   2) insert the `__COMMIT__::` chat message
 *   3) insert a `session_logs` row with `event_type='investment'`
 *
 * `pledge()` enforces the same $100-per-pledge cap the dialog enforces
 * client-side (`amt <= GIFT_MAX_USD`).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_ANON) {
  throw new Error("Simulation requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in env.");
}

export const GIFT_MAX_USD = 100;

export type Role = "facilitator" | "startup" | "investor";

export interface ActorInit {
  sessionId: string;
  id: string;
  email: string;
  displayName: string;
  role: Role;
  /** Only set for investor actors. */
  investorClass?: "accredited" | "community";
}

export class Actor {
  readonly sessionId: string;
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: Role;
  readonly investorClass?: "accredited" | "community";
  protected client: SupabaseClient;

  constructor(init: ActorInit) {
    this.sessionId = init.sessionId;
    this.id = init.id;
    this.email = init.email;
    this.displayName = init.displayName;
    this.role = init.role;
    this.investorClass = init.investorClass;
    this.client = createClient(SUPABASE_URL, SUPABASE_ANON);
  }

  /** Flip presence on. Mirrors the Login flow's call to `participant-presence`. */
  async login(): Promise<void> {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/participant-presence`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify({ participant_id: this.id, logged_in: true }),
    });
    if (!res.ok) throw new Error(`login failed for ${this.email}: ${res.status} ${await res.text()}`);
    // Mirror Login.tsx: write a `login` event to session_logs.
    const log = await this.client.from("session_logs").insert({
      session_id: this.sessionId,
      event_type: "login",
      event_data: {
        email: this.email,
        role: this.role,
        investor_class: this.investorClass ?? null,
      },
      actor_email: this.email,
    });
    if (log.error) throw new Error(`login session_logs insert failed: ${log.error.message}`);
  }

  /** Flip presence off. Mirrors the beforeunload handler in Session.tsx. */
  async logout(): Promise<void> {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/participant-presence`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify({ participant_id: this.id, logged_in: false }),
    });
    if (!res.ok) throw new Error(`logout failed for ${this.email}: ${res.status} ${await res.text()}`);
    // Mirror Session.tsx handleLogout: write a `logout` event to session_logs.
    const log = await this.client.from("session_logs").insert({
      session_id: this.sessionId,
      event_type: "logout",
      event_data: { email: this.email, role: this.role },
      actor_email: this.email,
    });
    if (log.error) throw new Error(`logout session_logs insert failed: ${log.error.message}`);
  }

  /** Convenience alias — same wire call as login(). */
  rejoin(): Promise<void> {
    return this.login();
  }


  async postChat(message: string): Promise<void> {
    const { error } = await this.client.from("chat_messages").insert({
      session_id: this.sessionId,
      sender_email: this.email,
      sender_name: this.displayName,
      sender_role: this.role,
      message,
    });
    if (error) throw new Error(`postChat failed for ${this.email}: ${error.message}`);
  }
}

export class FacilitatorActor extends Actor {
  readonly password: string;
  /** HMAC bearer returned by participant-login, used for admin-action calls. */
  adminToken: string | null = null;

  constructor(init: ActorInit & { password: string }) {
    super({ ...init, role: "facilitator" });
    this.password = init.password;
  }

  /**
   * Real participant-login call — verifies the bcrypt-hashed password and
   * returns the short-lived admin_token. Then flips presence on like other actors.
   */
  async login(): Promise<void> {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/participant-login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify({
        session_id: this.sessionId,
        email: this.email,
        password: this.password,
      }),
    });
    const body = (await res.json()) as { success?: boolean; admin_token?: string; error?: string };
    if (!res.ok || !body.success || !body.admin_token) {
      throw new Error(`facilitator login failed: ${res.status} ${JSON.stringify(body)}`);
    }
    this.adminToken = body.admin_token;
    await super.login();
  }

  /**
   * Write a `stage_change` row to session_logs. The facilitator owns stage
   * transitions in the running app; the simulation mirrors that ownership.
   * `event_data.configured_duration_seconds` records the timer the stage was
   * configured with so the test can later verify wall-clock deltas between
   * consecutive transitions match the configured timers (scaled).
   */
  async logStageChange(opts: {
    fromIndex: number;
    toIndex: number;
    stageType: string;
    configuredDurationSeconds: number;
  }): Promise<void> {
    const { error } = await this.client.from("session_logs").insert({
      session_id: this.sessionId,
      event_type: "stage_change",
      event_data: {
        from_index: opts.fromIndex,
        to_index: opts.toIndex,
        stage_type: opts.stageType,
        configured_duration_seconds: opts.configuredDurationSeconds,
      },
      actor_email: this.email,
    });
    if (error) throw new Error(`stage_change session_logs insert failed: ${error.message}`);
  }
}


export class StartupActor extends Actor {
  constructor(init: ActorInit) {
    super({ ...init, role: "startup" });
  }

  /**
   * Update startup-presented metadata (dd room, website, funding goal).
   * In the running app this is the Admin / EventLanding admin card path.
   */
  async updateMetadata(patch: { dd_room_link?: string; website_link?: string; funding_goal?: number }): Promise<void> {
    const { error } = await this.client
      .from("session_participants")
      .update(patch)
      .eq("id", this.id);
    if (error) throw new Error(`updateMetadata failed for ${this.email}: ${error.message}`);
  }
}

export class InvestorActor extends Actor {
  constructor(init: ActorInit & { investorClass: "accredited" | "community" }) {
    super({ ...init, role: "investor" });
  }

  /**
   * Equity commitment — accredited investors only. No cap (matches
   * InvestDialog's `pledgeType='equity'` branch).
   */
  async invest(startup: { email: string; display_name: string }, amount: number): Promise<void> {
    if (this.investorClass !== "accredited") {
      throw new Error(`invest() requires accredited investor; ${this.email} is ${this.investorClass}`);
    }
    if (!(amount > 0)) throw new Error(`invest() requires positive amount, got ${amount}`);
    await this.writeCommitment(startup, amount, "equity");
  }

  /**
   * Gift pledge — both accredited and community can call. Enforces the same
   * $100-per-pledge cap as InvestDialog (GIFT_MAX_USD). Multiple pledges per
   * startup per session are intentionally allowed (no DB unique constraint
   * either) — see the user's investment-scheme spec.
   */
  async pledge(startup: { email: string; display_name: string }, amount: number): Promise<void> {
    if (!(amount > 0)) throw new Error(`pledge() requires positive amount, got ${amount}`);
    if (amount > GIFT_MAX_USD) {
      throw new Error(`pledge cap exceeded: ${amount} > ${GIFT_MAX_USD}`);
    }
    await this.writeCommitment(startup, amount, "gift");
  }

  /** Three-write transaction mirroring InvestDialog exactly. */
  private async writeCommitment(
    startup: { email: string; display_name: string },
    amount: number,
    pledgeType: "equity" | "gift",
  ): Promise<void> {
    const ins = await this.client.from("investments").insert({
      session_id: this.sessionId,
      investor_email: this.email,
      investor_name: this.displayName,
      startup_email: startup.email,
      startup_name: startup.display_name,
      amount,
      pledge_type: pledgeType,
    });
    if (ins.error) throw new Error(`investment insert failed: ${ins.error.message}`);

    const chat = await this.client.from("chat_messages").insert({
      session_id: this.sessionId,
      sender_email: this.email,
      sender_name: this.displayName,
      sender_role: this.role,
      message: `__COMMIT__::${amount}::${startup.display_name}::${pledgeType}`,
    });
    if (chat.error) throw new Error(`commit chat insert failed: ${chat.error.message}`);

    const log = await this.client.from("session_logs").insert({
      session_id: this.sessionId,
      event_type: "investment",
      event_data: { investor: this.email, startup: startup.email, amount, pledge_type: pledgeType },
      actor_email: this.email,
    });
    if (log.error) throw new Error(`session_logs insert failed: ${log.error.message}`);
  }
}
