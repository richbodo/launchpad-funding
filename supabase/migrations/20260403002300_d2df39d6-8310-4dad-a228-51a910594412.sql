
-- Re-grant SELECT on all safe columns for anon and authenticated
GRANT SELECT (id, session_id, email, display_name, role, presentation_order, dd_room_link, website_link, funding_goal, is_logged_in, logged_in_at, created_at) ON public.session_participants TO anon, authenticated;

-- Also ensure INSERT/UPDATE still work for the roles that need them
GRANT INSERT ON public.session_participants TO anon, authenticated;
GRANT UPDATE (is_logged_in, logged_in_at, dd_room_link, website_link, funding_goal) ON public.session_participants TO anon, authenticated;
