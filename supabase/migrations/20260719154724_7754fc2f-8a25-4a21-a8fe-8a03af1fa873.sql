
-- LEMBRETES
CREATE TABLE public.lembretes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  evento_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  descricao text,
  data_hora timestamptz NOT NULL,
  notificado boolean NOT NULL DEFAULT false,
  notificado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lembretes TO authenticated;
GRANT ALL ON public.lembretes TO service_role;

ALTER TABLE public.lembretes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own lembretes" ON public.lembretes
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own lembretes" ON public.lembretes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own lembretes" ON public.lembretes
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own lembretes" ON public.lembretes
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_lembretes_user_pending ON public.lembretes(user_id, notificado, data_hora);
CREATE INDEX idx_lembretes_evento ON public.lembretes(evento_id);

CREATE TRIGGER trg_lembretes_updated_at
  BEFORE UPDATE ON public.lembretes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- LOGS DE SINCRONIZAÇÃO
CREATE TABLE public.logs_sincronizacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  evento_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  acao text NOT NULL,           -- e.g. 'create', 'update', 'pull', 'skip_delete'
  status text NOT NULL,         -- 'success' | 'error' | 'info'
  mensagem text,
  google_event_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.logs_sincronizacao TO authenticated;
GRANT ALL ON public.logs_sincronizacao TO service_role;

ALTER TABLE public.logs_sincronizacao ENABLE ROW LEVEL SECURITY;

-- Logs são escritos apenas pelo servidor (service_role); utilizador só lê os seus
CREATE POLICY "Users read own sync logs" ON public.logs_sincronizacao
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_logs_sinc_user_created ON public.logs_sincronizacao(user_id, created_at DESC);

-- REALTIME
ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.lembretes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.logs_sincronizacao;

ALTER TABLE public.events REPLICA IDENTITY FULL;
ALTER TABLE public.lembretes REPLICA IDENTITY FULL;
