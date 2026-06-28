# FundFlow — Design Summary & Rationale

*A soft-commit live funding platform. Open-source, self-hosted, built for warm networks.*

## What it is

FundFlow runs live, demo-day-style funding sessions in the browser: startups pitch in real time, participants pledge against a live funding meter, and a facilitator hosts the flow. Pledges are **soft commitments** — non-binding expressions of interest. Nothing settles on the platform; negotiation, verification, and settlement happen out of band. This keeps the live session light and puts the actual money path outside the tool.

## Two roles, one pledge primitive

The soft-commit object is shared across audiences; only the downstream rail forks.

- **Registered investors (wholesale / accredited).** Log in as investors and soft-commit for equity. Equity is then negotiated and settled out of band under New Zealand's wholesale-investor exclusion. Verifying wholesale status is the startup's responsibility, agreed up front — the issuer relies on the exclusion, so the duty sits with them.
- **Community (donors).** Log in as donors and soft-commit for support with an *optional, best-effort gift* (e.g. a tote bag). No financial return. The gift is not tied to company performance — no better gift if the company succeeds, no worse if it struggles. Delivery is best-effort, with no timeframe, and may not happen if the company folds. This is reward / donation crowdfunding, which sits outside the financial-products regime.

The two roles stay **hard-separated**. That separation is the cheapest legal insurance available: no equity offer is ever extended to a non-wholesale person on the platform. It is a login branch already built — keep it, rather than collapsing it.

## Regulatory posture (New Zealand) — *not legal advice*

- Rewards / donation crowdfunding is not covered by the FMCA; the donor path needs no licence and no intermediary.
- Equity relies on the wholesale-investor exclusion, so the investor path is gated to accredited investors, verified by the startups.
- Wholesale and small offers carry an **advertising prohibition**: such offers must be made personally to people with an existing relationship or expressed interest, not advertised to the public. The equity pitch therefore stays inside closed, warm networks — public broadcast of the equity offer would risk the exclusion. The donor / support side may be shared more openly.
- A clickwrap agreement helps allocate liability and evidence intent, but does not override the FMCA — substance beats form. Get NZ startup counsel to bless the pledge wording, the donor acknowledgment, and the platform agreement before any real session.

## Engagement model: warm networks first

The first session is a friendly trial — invite-only, drawn from the personal networks of the founder and the participating startups. Low-pressure, by design.

Beyond that, growth is community-driven. Audience engagement is a human activity: warm, relationship-based audiences convert and bring goodwill; cold outreach is both counterproductive (a cold crowd can turn negative on a fundraise) and, for the equity side, legally misaligned with the advertising rules. The tool **amplifies** existing warm relationships — it does not manufacture them. It is also more fun, and less work, than coordinating a raise piecemeal over email.

## Why open-source and self-hosted

FundFlow is a free, open-source tool — a hammer, not a service. Each session is run by the startup or community that hosts it, which keeps the author a **toolmaker rather than a financial-service operator**. Hosting it as a SaaS for others would drift toward operator / intermediary territory, and is deliberately avoided.

## Why build it

A good open-source tool for this should exist. Running real sessions is also the best way to harden it — a live round surfaces failure modes (pledge race conditions, live moderation load, retractions, reconnections) that seeded demo data never will. Collaborators welcome if it proves useful.
