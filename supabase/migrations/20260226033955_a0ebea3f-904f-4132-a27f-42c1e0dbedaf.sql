
-- Session status enum
CREATE TYPE public.session_status AS ENUM ('draft', 'scheduled', 'live', 'completed');

-- Participant role enum
CREATE TYPE public.participant_role AS ENUM ('facilitator', 'startup', 'investor');

-- Sessions table
CREATE TABLE public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  status session_status NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Session participants
CREATE TABLE public.session_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role participant_role NOT NULL,
  display_name TEXT,
  password_hash TEXT, -- only for facilitators
  presentation_order INT, -- only for startups
  is_logged_in BOOLEAN NOT NULL DEFAULT false,
  logged_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(session_id, email)
);

-- Investments
CREATE TABLE public.investments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  investor_email TEXT NOT NULL,
  investor_name TEXT,
  startup_email TEXT NOT NULL,
  startup_name TEXT,
  amount NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chat messages
CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  sender_email TEXT NOT NULL,
  sender_name TEXT,
  sender_role participant_role NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Session logs (for facilitator review)
CREATE TABLE public.session_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_data JSONB DEFAULT '{}',
  actor_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_logs ENABLE ROW LEVEL SECURITY;

-- Sessions: readable by all authenticated, writable by facilitators (handled in app)
CREATE POLICY "Sessions are readable by everyone" ON public.sessions FOR SELECT USING (true);
CREATE POLICY "Sessions are insertable by authenticated" ON public.sessions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Sessions are updatable by authenticated" ON public.sessions FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Sessions are deletable by authenticated" ON public.sessions FOR DELETE TO authenticated USING (true);

-- Participants: readable by all (for session context), manageable by facilitators
CREATE POLICY "Participants readable by all" ON public.session_participants FOR SELECT USING (true);
CREATE POLICY "Participants insertable by authenticated" ON public.session_participants FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Participants updatable by authenticated" ON public.session_participants FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Participants deletable by authenticated" ON public.session_participants FOR DELETE TO authenticated USING (true);
-- Allow anon to update login status
CREATE POLICY "Anon can update login status" ON public.session_participants FOR UPDATE TO anon USING (true);
CREATE POLICY "Anon can read participants" ON public.session_participants FOR SELECT TO anon USING (true);

-- Investments: readable by all, insertable by anyone (investors aren't auth'd users)
CREATE POLICY "Investments readable by all" ON public.investments FOR SELECT USING (true);
CREATE POLICY "Investments insertable by anon" ON public.investments FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Investments insertable by authenticated" ON public.investments FOR INSERT TO authenticated WITH CHECK (true);

-- Chat messages: readable and insertable by all
CREATE POLICY "Chat readable by all" ON public.chat_messages FOR SELECT USING (true);
CREATE POLICY "Chat insertable by anon" ON public.chat_messages FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Chat insertable by authenticated" ON public.chat_messages FOR INSERT TO authenticated WITH CHECK (true);

-- Session logs: readable by authenticated (facilitators), insertable by all
CREATE POLICY "Logs readable by authenticated" ON public.session_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Logs insertable by anon" ON public.session_logs FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Logs insertable by authenticated" ON public.session_logs FOR INSERT TO authenticated WITH CHECK (true);

-- Enable realtime for investments and chat
ALTER PUBLICATION supabase_realtime ADD TABLE public.investments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;

-- Updated at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_sessions_updated_at
  BEFORE UPDATE ON public.sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
