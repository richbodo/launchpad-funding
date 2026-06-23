# LiveKit Setup

FundFlow uses [LiveKit Cloud](https://livekit.io) for the live video / audio
streams that facilitators, startups, and investors share during a session.
LiveKit is the **only** external (non-Lovable) service you need to configure
when you remix this app — without it, the chat, scheduling, investment, and
funding-meter features still work, but the video panes stay dark.

LiveKit Cloud has a free tier that's more than enough for evaluation and
small live events.

## 1. Create a LiveKit Cloud project

1. Sign up at <https://cloud.livekit.io>.
2. Create a new **project**. Pick the region closest to your audience.
3. Once the project is created, open **Settings → Keys**.
4. Click **Add Key** (or copy the auto-created one). You need three values:
   - **API Key** (looks like `APIxxxxxxxxxxxx`)
   - **API Secret** (a longer random string — only shown once, copy it now)
   - **WebSocket URL** (looks like `wss://your-project-xxxxx.livekit.cloud`)

Keep this tab open — you'll paste the three values into Lovable next.

## 2. Add the secrets in Lovable

LiveKit credentials need to live in **two places**: as **backend secrets** so
the edge function that mints LiveKit access tokens can sign them, and as a
**frontend env var** so the browser knows which LiveKit server to connect to.

### Backend secrets (used by the `livekit-token` edge function)

In your Lovable project, open **Cloud → Secrets** (or ask Lovable in chat:
"Add LiveKit secrets") and add:

| Name                 | Value                                            |
| -------------------- | ------------------------------------------------ |
| `LIVEKIT_API_KEY`    | Your LiveKit API key                             |
| `LIVEKIT_API_SECRET` | Your LiveKit API secret                          |
| `LIVEKIT_WS_URL`     | Your LiveKit WebSocket URL (`wss://…livekit.cloud`) |

### Frontend env var

Edit `.env` in the project root and set:

```env
VITE_LIVEKIT_WS_URL="wss://your-project-xxxxx.livekit.cloud"
```

This must be the **same** URL you used for `LIVEKIT_WS_URL` above.

> The yellow "LiveKit is not configured" banner on `/admin` disappears once
> `VITE_LIVEKIT_WS_URL` is set.

## 3. Verify

1. Reload `/admin` — the LiveKit banner should be gone.
2. Sign in as a facilitator, create or open a session, and take it **Go
   Live**.
3. Open the session in a second browser as an investor or startup. You
   should see each other's video.

If video still doesn't appear, check the browser console and the
`livekit-token` edge function logs in Lovable for clues — the most common
issue is mismatched `LIVEKIT_WS_URL` / `VITE_LIVEKIT_WS_URL` values.

## Costs

LiveKit Cloud's free tier covers small evaluation events. For real demo
days check their pricing page — bandwidth is the primary driver. Nothing in
FundFlow locks you to LiveKit Cloud; if you'd rather self-host the LiveKit
server, just point `LIVEKIT_WS_URL` and `VITE_LIVEKIT_WS_URL` at your own
instance.
