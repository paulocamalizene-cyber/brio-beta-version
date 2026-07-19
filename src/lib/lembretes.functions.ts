import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const lembreteInput = z.object({
  id: z.string().uuid().optional(),
  evento_id: z.string().uuid().nullable().optional(),
  titulo: z.string().min(1).max(300),
  descricao: z.string().max(5000).nullable().optional(),
  data_hora: z.string().datetime(),
});

export type LembreteInput = z.infer<typeof lembreteInput>;

export const listLembretes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("lembretes")
      .select("*")
      .order("data_hora", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listLembretesPendentes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("lembretes")
      .select("*")
      .eq("notificado", false)
      .order("data_hora", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertLembrete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => lembreteInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context;
    const row = {
      user_id: userId,
      evento_id: data.evento_id ?? null,
      titulo: data.titulo,
      descricao: data.descricao ?? null,
      data_hora: data.data_hora,
    };
    if (data.id) {
      const { data: updated, error } = await supabase
        .from("lembretes")
        .update(row)
        .eq("id", data.id)
        .eq("user_id", userId)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return updated;
    }
    const { data: inserted, error } = await supabase
      .from("lembretes")
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return inserted;
  });

export const marcarLembreteNotificado = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("lembretes")
      .update({ notificado: true, notificado_em: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteLembrete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("lembretes")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listSyncLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("logs_sincronizacao")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
