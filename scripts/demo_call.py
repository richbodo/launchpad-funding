#!/usr/bin/env python3
"""
Launches a live demo call for manual testing.

Opens your browser and auto-logs you in as the selected role. Injects
synthetic video participants so the session feels realistic. Supports
testing from any role's perspective.

Usage:
    mac% ./scripts/demo_call.py                     # facilitator (default)
    mac% ./scripts/demo_call.py --role investor      # investor perspective
    mac% ./scripts/demo_call.py --role startup       # startup perspective
    mac% ./scripts/demo_call.py --role all           # all 3 roles in separate tabs

Prerequisites:
    - Supabase and LiveKit running (via ./scripts/test-infra.sh)
    - lk CLI installed (brew install livekit-cli)
    - Vite dev server running (npx vite --mode test --port 8080)
    - ffmpeg (optional, for distinct video streams; falls back to --publish-demo)
"""

import argparse
import datetime
import shutil
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

# ── Constants ──────────────────────────────────────────────────────────

PROJECT_DIR = Path(__file__).resolve().parent.parent
VIDEO_DIR = PROJECT_DIR / "test-results" / "demo-videos"
LOG_DIR = PROJECT_DIR / "test-results" / "demo-logs"
ENV_FILE = PROJECT_DIR / "supabase" / ".env.local"

SESSION_ID = "00000000-0000-0000-0000-000000000001"
ROOM_NAME = f"session-{SESSION_ID}"
LK_URL = "ws://localhost:7880"
DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
VIDEO_DURATION = 300  # seconds — long enough for any demo session

# (identity, display_name, ffmpeg_filter)
ALL_SYNTHETIC_PARTICIPANTS = [
    ("facilitator-b@test.com", "Co-Facilitator B", "smptebars=size=320x240:rate=15"),
    ("facilitator-c@test.com", "Co-Facilitator C", "color=c=blue:size=320x240:rate=15,drawtext=text='Facilitator C':fontsize=24:fontcolor=white:x=(w-tw)/2:y=(h-th)/2"),
    ("startup-a@test.com", "AlphaTech", "testsrc=size=320x240:rate=15"),
    ("startup-b@test.com", "BetaCorp", "mandelbrot=size=320x240:rate=15"),
]


def get_synthetic_participants(role: str) -> list[tuple[str, str, str]]:
    """Return only the synthetic participants to inject for the given role.

    Human-controlled identities are excluded so the human's browser tab
    is the real participant, not a synthetic stream.
    """
    human_identities = {
        "facilitator": {"facilitator@test.com"},
        "investor":    {"facilitator@test.com", "investor-1@test.com"},
        "startup":     {"facilitator@test.com", "startup-a@test.com"},
        "all":         {"facilitator@test.com", "investor-1@test.com", "startup-a@test.com"},
    }
    exclude = human_identities[role]
    return [p for p in ALL_SYNTHETIC_PARTICIPANTS if p[0] not in exclude]


def get_browser_tabs(role: str) -> list[tuple[str, str]]:
    """Return (url, description) pairs for browser tabs to open."""
    base = "http://localhost:8080/login?autoLogin=true"
    tabs = {
        "facilitator": [
            (f"{base}&email=facilitator@test.com&role=facilitator", "facilitator"),
        ],
        "investor": [
            (f"{base}&email=facilitator@test.com&role=facilitator", "facilitator (for Start Call)"),
            (f"{base}&email=investor-1@test.com&role=investor", "investor-1"),
        ],
        "startup": [
            (f"{base}&email=facilitator@test.com&role=facilitator", "facilitator (for Start Call)"),
            (f"{base}&email=startup-a@test.com&role=startup", "startup-a (AlphaTech)"),
        ],
        "all": [
            (f"{base}&email=facilitator@test.com&role=facilitator", "facilitator"),
            (f"{base}&email=investor-1@test.com&role=investor", "investor-1"),
            (f"{base}&email=startup-a@test.com&role=startup", "startup-a (AlphaTech)"),
        ],
    }
    return tabs[role]

# ── Module-level process tracking (for signal handler) ─────────────────

_stop_event = threading.Event()
_active_processes: list[subprocess.Popen] = []
_active_threads: list[threading.Thread] = []
_lock = threading.Lock()


# ── Helpers ────────────────────────────────────────────────────────────

def _ts() -> str:
    return datetime.datetime.now().strftime("%H:%M:%S")


def info(msg: str):
    print(f"[{_ts()}] ==> {msg}")


def debug(msg: str):
    print(f"[{_ts()}]     {msg}")


def die(msg: str):
    print(f"[{_ts()}] ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def check_command(name: str, install_hint: str):
    if not shutil.which(name):
        die(f"{name} not found. Install: {install_hint}")


def check_service(url: str, name: str, hint: str):
    try:
        urlopen(url, timeout=2)
        debug(f"{name} OK ({url})")
    except HTTPError:
        debug(f"{name} OK ({url}, non-2xx but responding)")
    except (URLError, OSError) as e:
        die(f"{name} not running at {url}: {e}. Run: {hint}")


def parse_env_file(path: Path) -> dict:
    defaults = {"LIVEKIT_API_KEY": "devkey", "LIVEKIT_API_SECRET": "secret"}
    if not path.exists():
        debug(f"Env file not found ({path}), using defaults")
        return defaults
    env = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip()
    merged = {**defaults, **env}
    debug(f"LiveKit creds: API_KEY={merged['LIVEKIT_API_KEY']}, URL={LK_URL}")
    return merged


def role_for_identity(identity: str) -> str:
    if identity.startswith("facilitator"):
        return "facilitator"
    if identity.startswith("startup"):
        return "startup"
    return "investor"


def run_psql(sql: str, query=False):
    result = subprocess.run(
        ["psql", DB_URL, "-qtAc" if query else "-qc", sql],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 and result.stderr.strip():
        debug(f"psql error: {result.stderr.strip()}")
    return result.stdout.strip() if query else None


# ── Video generation ───────────────────────────────────────────────────

def generate_videos(participants) -> bool:
    if not shutil.which("ffmpeg"):
        info("ffmpeg not found -- will use generic --publish-demo streams (all look the same).")
        info("Install ffmpeg for distinct per-participant videos: brew install ffmpeg")
        return False

    VIDEO_DIR.mkdir(parents=True, exist_ok=True)

    needs_gen = any(
        not (VIDEO_DIR / f"{ident.split('@')[0]}.ivf").exists()
        for ident, _, _ in participants
    )

    if needs_gen:
        info("One-time video fixture generation (cached for future runs)...")
        for ident, name, ffmpeg_filter in participants:
            safe_name = ident.split("@")[0]
            outfile = VIDEO_DIR / f"{safe_name}.ivf"
            if outfile.exists():
                continue
            info(f"  Generating {name} (~5s)...")
            subprocess.run(
                [
                    "ffmpeg", "-y", "-f", "lavfi", "-i", ffmpeg_filter,
                    "-t", str(VIDEO_DURATION), "-c:v", "libvpx", "-b:v", "500k",
                    str(outfile),
                ],
                capture_output=True,
            )
        info("Video fixtures cached in test-results/demo-videos/")

    return True


# ── Database reset ─────────────────────────────────────────────────────

def reset_test_session(participants):
    info("Resetting test session to 'scheduled' status...")
    run_psql(f"UPDATE sessions SET status = 'scheduled' WHERE id = '{SESSION_ID}';")
    debug("Session status set to 'scheduled'")
    run_psql(f"UPDATE session_participants SET is_logged_in = false WHERE session_id = '{SESSION_ID}';")
    debug("Cleared login flags")
    run_psql(f"DELETE FROM investments WHERE session_id = '{SESSION_ID}';")
    debug("Cleared investments")

    # Funding goals for startups (keyed by identity prefix)
    funding_goals = {
        "startup-a@test.com": 125000,
        "startup-b@test.com": 200000,
    }

    for ident, name, _ in participants:
        role = role_for_identity(ident)
        password_clause = "'test123'" if role == "facilitator" else "NULL"
        goal = funding_goals.get(ident)
        goal_clause = str(goal) if goal else "NULL"
        run_psql(
            f"INSERT INTO session_participants (session_id, email, display_name, role, password_hash, funding_goal) "
            f"VALUES ('{SESSION_ID}', '{ident}', '{name}', '{role}', {password_clause}, {goal_clause}) "
            f"ON CONFLICT (session_id, email) DO UPDATE SET funding_goal = EXCLUDED.funding_goal;"
        )
        debug(f"Ensured participant: {ident} ({role})")


# ── Process management ─────────────────────────────────────────────────

def publish_loop(identity: str, video_file: Path, log_path: Path, lk_creds: dict):
    iteration = 0
    with open(log_path, "a") as log_fh:
        while not _stop_event.is_set():
            iteration += 1
            cmd = [
                "lk", "room", "join",
                "--url", LK_URL,
                "--api-key", lk_creds["LIVEKIT_API_KEY"],
                "--api-secret", lk_creds["LIVEKIT_API_SECRET"],
                "--identity", identity,
                "--publish", str(video_file), "--fps", "15",
                "--exit-after-publish",
                ROOM_NAME,
            ]
            if iteration == 1:
                debug(f"[{identity}] lk room join --publish {video_file.name} (room={ROOM_NAME})")
            else:
                debug(f"[{identity}] re-publishing video (iteration {iteration})")
            proc = subprocess.Popen(
                cmd,
                stdout=log_fh,
                stderr=subprocess.STDOUT,
            )
            with _lock:
                _active_processes.append(proc)
            proc.wait()
            exit_code = proc.returncode
            with _lock:
                if proc in _active_processes:
                    _active_processes.remove(proc)
            if exit_code != 0:
                debug(f"[{identity}] lk exited with code {exit_code} — stopping re-publish (likely replaced by browser)")
                try:
                    tail = log_path.read_text().splitlines()[-5:]
                    for line in tail:
                        debug(f"[{identity}] LOG: {line}")
                except Exception:
                    pass
                break
            else:
                debug(f"[{identity}] publish complete (exit 0)")
            if _stop_event.wait(timeout=1):
                break


def inject_participants(has_ffmpeg: bool, lk_creds: dict, participants):
    info(f"Injecting {len(participants)} synthetic participants into room {ROOM_NAME}")
    for ident, name, _ in participants:
        safe_name = ident.split("@")[0]
        log_path = LOG_DIR / f"lk-{safe_name}.log"

        info(f"Injecting {name} ({ident})...")

        video_file = VIDEO_DIR / f"{safe_name}.ivf"
        if has_ffmpeg and video_file.exists():
            debug(f"[{ident}] Using pre-baked video: {video_file.name} ({video_file.stat().st_size} bytes)")
            t = threading.Thread(
                target=publish_loop,
                args=(ident, video_file, log_path, lk_creds),
                daemon=True,
                name=f"publish-{safe_name}",
            )
            t.start()
            with _lock:
                _active_threads.append(t)
        else:
            debug(f"[{ident}] Using --publish-demo (generic stream)")
            log_fh = open(log_path, "w")
            cmd = [
                "lk", "room", "join",
                "--url", LK_URL,
                "--api-key", lk_creds["LIVEKIT_API_KEY"],
                "--api-secret", lk_creds["LIVEKIT_API_SECRET"],
                "--identity", ident,
                "--publish-demo",
                ROOM_NAME,
            ]
            debug(f"[{ident}] lk room join --publish-demo (room={ROOM_NAME})")
            proc = subprocess.Popen(
                cmd,
                stdout=log_fh,
                stderr=subprocess.STDOUT,
            )
            with _lock:
                _active_processes.append(proc)
            # Check if it died immediately
            time.sleep(0.5)
            if proc.poll() is not None:
                debug(f"[{ident}] WARNING: lk exited immediately with code {proc.returncode}")
                try:
                    log_fh.flush()
                    for line in log_path.read_text().splitlines()[-5:]:
                        debug(f"[{ident}] LOG: {line}")
                except Exception:
                    pass

        time.sleep(2)


# ── Verification ───────────────────────────────────────────────────────

def check_room(lk_creds: dict) -> bool:
    result = subprocess.run(
        [
            "lk", "room", "list",
            "--url", LK_URL,
            "--api-key", lk_creds["LIVEKIT_API_KEY"],
            "--api-secret", lk_creds["LIVEKIT_API_SECRET"],
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        debug(f"lk room list failed (exit {result.returncode}): {result.stderr.strip()}")
    found = ROOM_NAME in result.stdout
    if found:
        # Show participant count from room list output
        for line in result.stdout.splitlines():
            if ROOM_NAME in line:
                debug(f"Room found: {line.strip()}")
                break
    return found


def wait_for_call_start(lk_creds: dict, timeout=120) -> bool:
    """Poll LiveKit until the facilitator's room appears.

    The app updates sessions.status via the Supabase JS client using the
    anon key, but RLS restricts writes to the 'authenticated' role — so
    the status never actually changes in the DB.  Instead we poll LiveKit
    directly: when the facilitator clicks 'Start Call', the browser
    connects to LiveKit and the room is created.  That's the reliable
    signal.
    """
    info("Waiting for facilitator to click 'Start Call'...")
    debug(f"Polling LiveKit for room '{ROOM_NAME}' every 2s (timeout {timeout}s)")
    start = time.time()
    while time.time() - start < timeout:
        if check_room(lk_creds):
            info("Facilitator connected — LiveKit room is ready.")
            return True
        elapsed = int(time.time() - start)
        if elapsed > 0 and elapsed % 10 == 0:
            debug(f"Still waiting for room ({elapsed}s elapsed)...")
        time.sleep(2)
    debug(f"Room not found after {timeout}s")
    return False


def verify_participants(participants):
    info("Checking participant status...")
    for ident, name, _ in participants:
        safe_name = ident.split("@")[0]
        log_path = LOG_DIR / f"lk-{safe_name}.log"

        if not log_path.exists():
            print(f"    WAIT: {name} -- no log file yet")
            continue

        log_text = log_path.read_text()
        if "published track" in log_text:
            print(f"    OK:   {name} -- track published")
        elif "error" in log_text.lower():
            print(f"    FAIL: {name} -- check {log_path}")
            for line in log_text.splitlines():
                if "error" in line.lower():
                    print(f"          {line.strip()}")
        else:
            print(f"    WAIT: {name} -- still connecting (check {log_path})")


# ── Cleanup ────────────────────────────────────────────────────────────

def cleanup():
    with _lock:
        n_procs = len(_active_processes)
        n_threads = len(_active_threads)
    info(f"Stopping synthetic participants ({n_procs} processes, {n_threads} threads)...")
    _stop_event.set()

    with _lock:
        for proc in _active_processes:
            try:
                debug(f"Terminating PID {proc.pid}")
                proc.terminate()
            except OSError:
                pass

    for t in _active_threads:
        debug(f"Joining thread {t.name}...")
        t.join(timeout=5)
        if t.is_alive():
            debug(f"Thread {t.name} did not exit in 5s")

    with _lock:
        for proc in _active_processes:
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                debug(f"Force-killing PID {proc.pid}")
                proc.kill()

    debug("Cleanup complete")


def _signal_handler(signum, frame):
    cleanup()
    sys.exit(0)


# ── Main ───────────────────────────────────────────────────────────────

def main():
    signal.signal(signal.SIGINT, _signal_handler)
    signal.signal(signal.SIGTERM, _signal_handler)

    # Parse arguments
    parser = argparse.ArgumentParser(
        description="Launch a live demo call for manual testing.",
    )
    parser.add_argument(
        "--role",
        choices=["facilitator", "investor", "startup", "all"],
        default="facilitator",
        help="Which role to test in the browser (default: facilitator)",
    )
    args = parser.parse_args()
    role = args.role

    # Determine participants and browser tabs for this role
    participants = get_synthetic_participants(role)
    tabs = get_browser_tabs(role)

    # Prerequisite checks
    check_command("lk", "brew install livekit-cli")
    check_command("psql", "brew install libpq && brew link --force libpq")
    check_service("http://127.0.0.1:54321", "Supabase", "./scripts/test-infra.sh")
    check_service("http://localhost:7880", "LiveKit", "livekit-server --dev")
    check_service("http://localhost:8080", "Vite dev server", "npx vite --mode test --port 8080")

    # LiveKit credentials
    lk_creds = parse_env_file(ENV_FILE)

    # Video fixtures
    has_ffmpeg = generate_videos(participants)

    # Prepare log directory
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    for f in LOG_DIR.glob("*.log"):
        f.unlink()

    # Reset test session
    reset_test_session(participants)

    # Open browser tabs
    opener = "open" if sys.platform == "darwin" else "xdg-open"
    for url, desc in tabs:
        info(f"Opening browser tab: {desc}")
        subprocess.run([opener, url])
        time.sleep(1)

    print()
    print("=" * 60)
    if role == "facilitator":
        print("  Browser opened -- you are the FACILITATOR.")
        print("  Click 'Start Call' and allow camera+mic.")
    elif role == "investor":
        print("  Two tabs opened:")
        print("    Tab 1: Facilitator -- click 'Start Call' here first")
        print("    Tab 2: Investor -- will auto-connect after Start Call")
        print("  After you click Start Call, the investor tab auto-joins.")
    elif role == "startup":
        print("  Two tabs opened:")
        print("    Tab 1: Facilitator -- click 'Start Call' here first")
        print("    Tab 2: Startup (AlphaTech) -- click 'Join Call' when prompted")
        print("  After Start Call, switch to the startup tab and click 'Join Call'.")
        print("  Allow camera/mic access when prompted.")
    elif role == "all":
        print("  Three tabs opened:")
        print("    Tab 1: Facilitator -- click 'Start Call' here first")
        print("    Tab 2: Investor -- will auto-connect after Start Call")
        print("    Tab 3: Startup (AlphaTech) -- click 'Join Call' when prompted")
        print("  After Start Call, the investor auto-joins. Switch to the startup")
        print("  tab and click 'Join Call'. Allow camera/mic when prompted.")
    print("  Synthetic participants will be injected after Start Call.")
    print("=" * 60)
    print()

    # Wait for the facilitator to click 'Start Call' (detected via LiveKit room)
    if not wait_for_call_start(lk_creds):
        die("Timed out waiting for LiveKit room. Did you click 'Start Call'?")

    # Set session status to 'live' directly via psql — the app's Supabase JS
    # update is silently rejected by RLS (anon key lacks UPDATE permission).
    # This triggers Realtime subscriptions so investor tabs auto-join and
    # startup tabs enable their "Join Call" button.
    if role != "facilitator":
        info("Setting session status to 'live' via database...")
        run_psql(f"UPDATE sessions SET status = 'live' WHERE id = '{SESSION_ID}';")
        time.sleep(1)  # Let Realtime propagate to browser tabs

    # Inject synthetic participants
    inject_participants(has_ffmpeg, lk_creds, participants)

    # Verify
    time.sleep(3)
    verify_participants(participants)

    print()
    info("Demo call is live!")
    print()
    for _, desc in tabs:
        print(f"    You:        {desc}")
    for ident, name, _ in participants:
        print(f"    Synthetic:  {name} ({ident})")
    print()
    if role in ("facilitator", "all"):
        print("    Use Next/Previous to switch between startup presentations.")
    if role in ("investor", "all"):
        print("    Use the Invest button during startup presentations.")
    if role in ("startup", "all"):
        print("    Switch to the startup tab and click 'Join Call' (allow camera/mic).")
    print()
    print(f"    Logs: {LOG_DIR}/")
    print()
    print("    Press ENTER to end the demo and clean up.")
    print()

    try:
        input("Press ENTER to stop synthetic participants...")
    except EOFError:
        pass

    cleanup()

    info("Demo ended. The browser session is still active -- click 'End Call' to finish.")
    info(f"Logs saved in: {LOG_DIR}/")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        cleanup()
