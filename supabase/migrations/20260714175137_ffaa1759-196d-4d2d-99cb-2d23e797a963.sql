
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE POLICY "Deny direct access to connections" ON public.app_user_connections
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
