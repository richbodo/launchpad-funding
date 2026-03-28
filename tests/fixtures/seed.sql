-- Test fixture: deterministic session with known credentials
-- Run against local Supabase after `supabase db reset`

-- Enable demo mode
INSERT INTO app_settings (key, value) VALUES ('mode', 'demo')
ON CONFLICT (key) DO UPDATE SET value = 'demo';

-- Test session: scheduled (facilitator sets to live during E2E)
INSERT INTO sessions (id, name, start_time, end_time, status, timezone)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '[TEST] E2E Session',
  now(),
  now() + interval '3 hours',
  'scheduled',
  'America/New_York'
);

-- Facilitators
INSERT INTO session_participants (session_id, email, display_name, role, password_hash, presentation_order)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'facilitator@test.com', 'Test Facilitator', 'facilitator', 'test123', NULL),
  ('00000000-0000-0000-0000-000000000001', 'facilitator-b@test.com', 'Co-Facilitator', 'facilitator', 'test123', NULL);

-- Startups (in presentation order)
INSERT INTO session_participants (session_id, email, display_name, role, presentation_order, website_link)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'startup-a@test.com', 'AlphaTech', 'startup', 1, 'https://example.com/alpha'),
  ('00000000-0000-0000-0000-000000000001', 'startup-b@test.com', 'BetaCorp',  'startup', 2, 'https://example.com/beta');

-- Investors
INSERT INTO session_participants (session_id, email, display_name, role, presentation_order)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'investor-1@test.com', 'Investor One', 'investor', NULL),
  ('00000000-0000-0000-0000-000000000001', 'investor-2@test.com', 'Investor Two', 'investor', NULL);
