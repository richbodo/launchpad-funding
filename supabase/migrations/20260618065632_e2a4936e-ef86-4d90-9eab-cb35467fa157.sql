REVOKE EXECUTE ON FUNCTION public.broadcast_chat_message_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.broadcast_investment_insert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.broadcast_chat_message_insert() TO service_role;
GRANT EXECUTE ON FUNCTION public.broadcast_investment_insert() TO service_role;