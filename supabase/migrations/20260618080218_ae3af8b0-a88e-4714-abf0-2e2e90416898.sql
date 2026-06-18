-- Sessions: public-read policy
GRANT SELECT ON public.sessions TO anon, authenticated;
GRANT ALL ON public.sessions TO service_role;

-- Session participants: public-read policy
GRANT SELECT ON public.session_participants TO anon, authenticated;
GRANT ALL ON public.session_participants TO service_role;

-- Chat messages: public-read + anon/authenticated insert
GRANT SELECT, INSERT ON public.chat_messages TO anon, authenticated;
GRANT ALL ON public.chat_messages TO service_role;

-- Investments: public-read + anon/authenticated insert
GRANT SELECT, INSERT ON public.investments TO anon, authenticated;
GRANT ALL ON public.investments TO service_role;

-- Session logs: authenticated read, anon/authenticated insert
GRANT SELECT, INSERT ON public.session_logs TO authenticated;
GRANT INSERT ON public.session_logs TO anon;
GRANT ALL ON public.session_logs TO service_role;

-- App settings: public-read
GRANT SELECT ON public.app_settings TO anon, authenticated;
GRANT ALL ON public.app_settings TO service_role;

-- Email tables: service-role only
GRANT ALL ON public.email_send_log TO service_role;
GRANT ALL ON public.email_send_state TO service_role;
GRANT ALL ON public.email_unsubscribe_tokens TO service_role;
GRANT ALL ON public.suppressed_emails TO service_role;