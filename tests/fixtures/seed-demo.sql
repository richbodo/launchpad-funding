-- Demo-mode seed data — offline equivalent of the `seed-demo-data` Edge Function.
--
-- The Admin UI's "Seed Demo Data" button calls that Edge Function, but the local
-- Deno edge runtime fetches its imports from esm.sh and cannot reach the network
-- inside Colima, so it fails offline. This SQL produces the same end state and
-- runs fully offline via psql (which connects as the `postgres` superuser and
-- therefore bypasses RLS). Demo facilitator passwords are stored in plaintext
-- here and hashed on insert by the hash_participant_password trigger.
--
-- Usage:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f tests/fixtures/seed-demo.sql
--
-- Safe to re-run: it clears existing [DEMO] data first.

-- 1. Turn demo mode on.
INSERT INTO app_settings (key, value) VALUES ('mode', 'demo')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- 2. Clear any previous demo data (children first to satisfy FKs).
DELETE FROM chat_messages        WHERE session_id IN (SELECT id FROM sessions WHERE name LIKE '[DEMO]%');
DELETE FROM investments          WHERE session_id IN (SELECT id FROM sessions WHERE name LIKE '[DEMO]%');
DELETE FROM session_logs         WHERE session_id IN (SELECT id FROM sessions WHERE name LIKE '[DEMO]%');
DELETE FROM session_participants WHERE session_id IN (SELECT id FROM sessions WHERE name LIKE '[DEMO]%');
DELETE FROM sessions             WHERE name LIKE '[DEMO]%';

-- 3. Sessions (times relative to now, mirroring the Edge Function).
INSERT INTO sessions (id, name, start_time, end_time, status, timezone) VALUES
  ('a0000000-0000-0000-0000-000000000001', '[DEMO] Demo Day Alpha', now() - interval '1 hour',  now() + interval '2 hours',  'live',      'America/New_York'),
  ('b0000000-0000-0000-0000-000000000002', '[DEMO] Demo Day Beta',  now() - interval '25 hours', now() - interval '22 hours', 'completed', 'America/New_York'),
  ('c0000000-0000-0000-0000-000000000003', '[DEMO] Demo Day Gamma', now() - interval '49 hours', now() - interval '46 hours', 'completed', 'America/New_York');

-- 4. Participants.
INSERT INTO session_participants
  (session_id, email, display_name, role, password_hash, presentation_order, website_link, dd_room_link, funding_goal) VALUES
  -- Alpha (live)
  ('a0000000-0000-0000-0000-000000000001', 'facilitator@demo.com', 'Facilitator 1', 'facilitator', 'demo123', NULL, NULL, NULL, NULL),
  ('a0000000-0000-0000-0000-000000000001', 'admin@demo.com',       'Facilitator 2', 'facilitator', 'demo123', NULL, NULL, NULL, NULL),
  ('a0000000-0000-0000-0000-000000000001', 'acme@demo.com',  'AcmeTech',  'startup', NULL, 1, 'https://acmetech.io', 'https://drive.google.com/acme',  2000000),
  ('a0000000-0000-0000-0000-000000000001', 'nova@demo.com',  'NovaPay',   'startup', NULL, 2, 'https://novapay.com', 'https://drive.google.com/nova',  5000000),
  ('a0000000-0000-0000-0000-000000000001', 'green@demo.com', 'GreenGrid', 'startup', NULL, 3, 'https://greengrid.co','https://drive.google.com/green', 3000000),
  ('a0000000-0000-0000-0000-000000000001', 'alice@investor.com', 'Alice Chen',    'investor', NULL, NULL, NULL, NULL, NULL),
  ('a0000000-0000-0000-0000-000000000001', 'bob@investor.com',   'Bob Martinez',  'investor', NULL, NULL, NULL, NULL, NULL),
  ('a0000000-0000-0000-0000-000000000001', 'carol@investor.com', 'Carol Nguyen',  'investor', NULL, NULL, NULL, NULL, NULL),
  ('a0000000-0000-0000-0000-000000000001', 'dave@investor.com',  'Dave Wilson',   'investor', NULL, NULL, NULL, NULL, NULL),
  -- Beta (completed yesterday)
  ('b0000000-0000-0000-0000-000000000002', 'facilitator@demo.com', 'Facilitator 1', 'facilitator', 'demo123', NULL, NULL, NULL, NULL),
  ('b0000000-0000-0000-0000-000000000002', 'admin@demo.com',       'Facilitator 2', 'facilitator', 'demo123', NULL, NULL, NULL, NULL),
  ('b0000000-0000-0000-0000-000000000002', 'cloud@demo.com', 'CloudSync', 'startup', NULL, 1, 'https://cloudsync.dev','https://drive.google.com/cloudsync', 1500000),
  ('b0000000-0000-0000-0000-000000000002', 'forge@demo.com', 'DataForge', 'startup', NULL, 2, 'https://dataforge.ai', 'https://drive.google.com/dataforge', 4000000),
  ('b0000000-0000-0000-0000-000000000002', 'pixel@demo.com', 'PixelAI',   'startup', NULL, 3, 'https://pixelai.co',   'https://drive.google.com/pixelai',   2500000),
  ('b0000000-0000-0000-0000-000000000002', 'eve@investor.com',   'Eve Park',  'investor', NULL, NULL, NULL, NULL, NULL),
  ('b0000000-0000-0000-0000-000000000002', 'frank@investor.com', 'Frank Liu', 'investor', NULL, NULL, NULL, NULL, NULL),
  -- Gamma (completed 2 days ago)
  ('c0000000-0000-0000-0000-000000000003', 'facilitator@demo.com', 'Facilitator 1', 'facilitator', 'demo123', NULL, NULL, NULL, NULL),
  ('c0000000-0000-0000-0000-000000000003', 'admin@demo.com',       'Facilitator 2', 'facilitator', 'demo123', NULL, NULL, NULL, NULL),
  ('c0000000-0000-0000-0000-000000000003', 'solar@demo.com', 'SolarWave', 'startup', NULL, 1, 'https://solarwave.energy','https://drive.google.com/solarwave', 6000000),
  ('c0000000-0000-0000-0000-000000000003', 'finly@demo.com', 'Finly',     'startup', NULL, 2, 'https://finly.io',        'https://drive.google.com/finly',     1000000),
  ('c0000000-0000-0000-0000-000000000003', 'mediq@demo.com', 'MediQ',     'startup', NULL, 3, 'https://mediq.health',    'https://drive.google.com/mediq',     8000000),
  ('c0000000-0000-0000-0000-000000000003', 'ivan@investor.com',  'Ivan Petrov',  'investor', NULL, NULL, NULL, NULL, NULL),
  ('c0000000-0000-0000-0000-000000000003', 'julia@investor.com', 'Julia Santos', 'investor', NULL, NULL, NULL, NULL, NULL),
  ('c0000000-0000-0000-0000-000000000003', 'kyle@investor.com',  'Kyle Brown',   'investor', NULL, NULL, NULL, NULL, NULL);
