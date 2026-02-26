
-- Create app_settings table for demo/production mode
CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Readable by all
CREATE POLICY "App settings readable by all"
ON public.app_settings
FOR SELECT
USING (true);

-- Updatable by all (facilitators manage via admin UI)
CREATE POLICY "App settings updatable by all"
ON public.app_settings
FOR UPDATE
USING (true);

-- Insertable by all
CREATE POLICY "App settings insertable by all"
ON public.app_settings
FOR INSERT
WITH CHECK (true);

-- Seed default mode to 'demo'
INSERT INTO public.app_settings (key, value) VALUES ('mode', 'demo');
