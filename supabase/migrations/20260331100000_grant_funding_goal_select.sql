-- Grant SELECT on funding_goal column to anon and authenticated roles.
-- The column-level GRANT in the previous migration omitted this column.
GRANT SELECT (funding_goal) ON public.session_participants TO anon, authenticated;
