# Developer Setup Guide

## How this works

Everything runs on your Mac host — there are no VMs or containers to
shell into. The developer runs three tools as their normal macOS user:

1. **Docker runtime** — only used as a backend by the Supabase CLI. You never
   run `docker run`, `docker exec`, or interact with containers directly.
   The Supabase CLI manages its own containers (Postgres, Realtime, PostgREST,
   Edge Functions) automatically.

2. **Supabase CLI** (`supabase`) — runs on your Mac. Talks to Docker behind
   the scenes. Exposes local Supabase services on `localhost` ports.

3. **LiveKit server** (`livekit-server`) — runs natively on your Mac as a
   regular process. No Docker involved.

All three tools run as your normal Mac user. No root, no `sudo`, no special
service accounts (except one symlink setup in step 1). Every developer gets
the same local stack because the Supabase schema is defined by the migrations
in `supabase/migrations/` and the test data by `tests/fixtures/seed.sql`.

**Command prompt convention:** All commands in this guide run on your Mac
host. They are shown with the `mac%` prompt to make this explicit.

---

## Prerequisites

- macOS (Apple Silicon or Intel)
- [Homebrew](https://brew.sh/)
- Node.js (v18+) and npm
- Postgres client tools (`psql`):
  ```
  mac% brew install libpq && brew link --force libpq
  ```

Install project dependencies before anything else:

```
mac% cd ~/src/launchpad-funding
mac% npm install
```

---

## 1. Install Colima (Docker runtime)

The Supabase CLI needs a Docker-compatible runtime to manage its containers.
You never interact with Docker directly — `supabase start` handles everything.

[Colima](https://github.com/abiosoft/colima) is a lightweight, open-source
Docker runtime for macOS. CLI only, no GUI, no commercial licensing.

```
mac% brew install colima docker
```

Start the Colima VM (allocate enough resources for the Supabase stack):

```
mac% colima start --memory 4 --cpu 2
```

Colima must be running before any Supabase commands. You'll run
`colima start` at the beginning of each dev session and `colima stop`
when you're done.

### Fix the Docker socket path (required for Supabase)

The Supabase CLI bind-mounts the Docker socket into its containers. It
reads the socket path from the Docker context, but the Colima-specific
path (`~/.colima/default/docker.sock`) doesn't resolve correctly inside
Colima's Linux VM. The fix is to symlink the standard path to Colima's
socket — inside the VM, `/var/run/docker.sock` is the real Docker
socket, so both sides match.

This is the one command that requires `sudo`:

```
mac% sudo ln -sf ~/.colima/default/docker.sock /var/run/docker.sock
mac% export DOCKER_HOST=unix:///var/run/docker.sock
```

Add the `export` line to your shell profile so it persists across
terminal sessions:

```
mac% echo 'export DOCKER_HOST=unix:///var/run/docker.sock' >> ~/.zshrc
```

### Verify Docker is available

```
mac% docker info
```

You should see engine and server details. If this fails, run
`colima start` again and check the symlink:

```
mac% ls -la /var/run/docker.sock
```

It should point to `~/.colima/default/docker.sock`.

---

## 2. Install Supabase CLI

```
mac% brew install supabase/tap/supabase
```

Verify:

```
mac% supabase --version
```

---

## 3. Install LiveKit server

```
mac% brew install livekit
```

Verify:

```
mac% livekit-server --version
```

---

## 4. Start local Supabase

Run from the project root (`launchpad-funding/`):

```
mac% cd ~/src/launchpad-funding
mac% supabase start
```

**First run** pulls Docker images and takes 2-5 minutes. Subsequent starts
take seconds. When it finishes, it prints local credentials:

```
Authentication Keys
├─────────────┬──────────────────────────────────────────────┤
│ Publishable │ sb_publishable_...                            │
│ Secret      │ sb_secret_...                                 │
```

**Save the `Publishable` key** — you need it for `.env.test` in step 6.

> **Note:** Older Supabase CLI versions called this the "anon key."
> It's the same thing — the public key safe to embed in client code.

You can retrieve these values anytime:

```
mac% supabase status
```

### What `supabase start` does behind the scenes

It creates and runs several Docker containers (Postgres on port 54322,
PostgREST API on 54321, Realtime, GoTrue, etc.), applies all SQL
migrations from `supabase/migrations/`, and makes Edge Functions from
`supabase/functions/` available at `http://localhost:54321/functions/v1/<name>`.
You never need to manage these containers yourself.

### Useful Supabase commands

```
mac% supabase start            # Start all local services
mac% supabase stop             # Stop all containers (preserves data)
mac% supabase stop --no-backup # Stop and discard all data
mac% supabase db reset         # Drop DB and reapply all migrations from scratch
mac% supabase status           # Show URLs and keys
mac% supabase functions serve  # Serve Edge Functions locally (with hot reload)
```

---

## 5. Start local LiveKit

Open a **separate terminal tab** and run:

```
mac% livekit-server --dev
```

This runs natively on your Mac (no Docker). The `--dev` flag generates
an ephemeral API key and secret, printed on startup:

```
API Key:    devkey
API Secret: secret
Server URL: ws://localhost:7880
```

**Save the API Key and API Secret** — they go into `supabase/.env.local`
in step 6.

LiveKit uses three ports (all on localhost):
- `7880` — HTTP / WebSocket signaling
- `7881` — TCP media
- `7882/udp` — UDP media (WebRTC)

Leave this running in its own terminal tab.

---

## 6. Configure environment files

Two env files point the app and Edge Functions at the local services.
Both are gitignored — each developer creates their own from the values
printed in steps 4 and 5.

### `.env.test` — Vite test environment

Create this in the project root. Use the **Publishable** key from
`supabase status` output in step 4:

```
mac% cat > ~/src/launchpad-funding/.env.test <<'EOF'
VITE_SUPABASE_URL="http://127.0.0.1:54321"
VITE_SUPABASE_PUBLISHABLE_KEY="<Publishable key from step 4>"
VITE_LIVEKIT_WS_URL="ws://localhost:7880"
EOF
```

### `supabase/.env.local` — Edge Function secrets

Create this in the `supabase/` directory with values from
`livekit-server --dev` output in step 5:

```
mac% cat > ~/src/launchpad-funding/supabase/.env.local <<'EOF'
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
LIVEKIT_WS_URL=ws://localhost:7880
EOF
```

The Supabase CLI automatically reads `supabase/.env.local` when serving
Edge Functions, so the `livekit-token` function can sign JWTs with
the correct LiveKit credentials.

---

## 7. Seed test data

Reset the database (drops and reapplies all migrations) and load the
test fixture:

```
mac% cd ~/src/launchpad-funding
mac% supabase db reset
mac% psql "postgresql://postgres:postgres@localhost:54322/postgres" \
       -f tests/fixtures/seed.sql
```

This creates a deterministic test session with known credentials:

| Email | Role | Password |
|---|---|---|
| `facilitator@test.com` | facilitator | `test123` |
| `facilitator-b@test.com` | facilitator | `test123` |
| `startup-a@test.com` | startup | — |
| `startup-b@test.com` | startup | — |
| `investor-1@test.com` | investor | — |
| `investor-2@test.com` | investor | — |

---

## 8. Smoke test

Start the dev server against local services:

```
mac% cd ~/src/launchpad-funding
mac% npx vite --mode test --port 8080
```

The `--mode test` flag tells Vite to load `.env.test` instead of `.env`.

Open http://localhost:8080 and verify:
1. The login page loads and shows the "[TEST] E2E Session"
2. Enter `facilitator@test.com`, click Facilitator, enter password `test123`
3. You reach the session page with the 3-pane layout

---

## 9. Live video demo

Once everything is running, the best way to verify your full setup and
get a feel for the state of the app is the live demo call. This is also
a useful integration test — if this works, all your infrastructure
(Colima, Supabase, LiveKit, Edge Functions, Vite) is correctly wired up.

**Optional but recommended:** Install ffmpeg for visually distinct
synthetic video streams per participant:

```
mac% brew install ffmpeg
```

Then run:

```
mac% ./scripts/demo-call.sh
```

This script:
1. Generates video fixture files on first run (cached for future runs,
   requires ffmpeg; falls back to generic LiveKit demo streams without it)
2. Resets the test session to a clean state
3. Opens your browser and **auto-logs you in** as the facilitator (demo
   mode bypasses password)
4. You click "Start Call", allow camera+mic, and press ENTER in the terminal
5. The script injects three synthetic video participants via the `lk` CLI:
   - **Co-Facilitator** (left pane, SMPTE color bars)
   - **AlphaTech** startup (center pane, numbered test pattern)
   - **BetaCorp** startup (center pane, Mandelbrot fractal)
6. You see a live multi-person call: your camera + co-facilitator in the
   left pane, the active startup's video in the center pane

Use **Next/Previous** to switch between startup presentations and see each
startup's distinct video stream change in the center pane. Press ENTER in
the terminal when you're done to clean up.

Logs from each synthetic participant are saved in
`test-results/demo-logs/` for debugging.

---

## Automated setup (alternative to steps 4-7)

The script `scripts/test-infra.sh` automates steps 4 through 7. It starts
Supabase, starts LiveKit, writes both env files with the correct
credentials, resets the database, and seeds test data:

```
mac% cd ~/src/launchpad-funding
mac% ./scripts/test-infra.sh
```

Requires Colima running and steps 1-3 completed first.

---

## Shutting down

```
mac% # Stop LiveKit (if running in foreground, just Ctrl-C its terminal tab)
mac% # If running in background:
mac% kill $(lsof -ti :7880)

mac% # Stop Supabase (preserves data for next start)
mac% supabase stop

mac% # Or stop and wipe everything
mac% supabase stop --no-backup

mac% # Stop Colima when done for the day
mac% colima stop
```

---

## Troubleshooting

### `supabase start` fails with "error while creating mount source path"

This means the Docker socket path isn't set up correctly for Colima.
Run the socket fix from step 1:

```
mac% sudo ln -sf ~/.colima/default/docker.sock /var/run/docker.sock
mac% export DOCKER_HOST=unix:///var/run/docker.sock
mac% supabase start
```

### `supabase start` hangs or fails (other errors)

```
mac% colima status                                  # Is Colima running?
mac% colima start --memory 4 --cpu 2                # Start it if not
mac% docker info                                    # Can Docker connect?
mac% supabase stop --no-backup && supabase start    # Stale images? Reset.
```

### Edge Functions can't reach LiveKit

```
mac% curl -sf http://localhost:7880                  # Is LiveKit running?
mac% cat supabase/.env.local                         # Correct key/secret?
mac% supabase functions serve                        # Restart Edge Functions
```

### Port conflicts

Supabase uses ports 54321-54323 (API, DB, Studio).
LiveKit uses ports 7880-7882.

```
mac% lsof -ti :54321 | xargs kill                   # Free a Supabase port
mac% lsof -ti :7880 | xargs kill                    # Free a LiveKit port
```

### `psql` not found

Install it via the Prerequisites section at the top of this guide.
