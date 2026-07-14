import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const locationSchema = z
  .object({
    address: z.string().optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
    name: z.string().optional(),
  })
  .nullable()
  .optional();

const reminderSchema = z
  .object({
    useDefault: z.boolean().optional(),
    overrides: z
      .array(z.object({ method: z.enum(["email", "popup"]), minutes: z.number().int().min(0) }))
      .optional(),
  })
  .nullable()
  .optional();

const attendeesSchema = z
  .array(z.object({ email: z.string().email(), displayName: z.string().optional() }))
  .nullable()
  .optional();

const eventInput = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1).max(300),
  description: z.string().max(5000).nullable().optional(),
  location: locationSchema,
  color: z.string().max(30).nullable().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  end_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  recurrence: z.string().max(500).nullable().optional(),
  reminders: reminderSchema,
  attendees: attendeesSchema,
  status_map: z.record(z.string(), z.string()).optional(),
});

export type EventInput = z.infer<typeof eventInput>;

export const listEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("events")
      .select("*")
      .order("start_date", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => eventInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context;
    const row = {
      user_id: userId,
      title: data.title,
      description: data.description ?? null,
      location: data.location ?? null,
      color: data.color ?? null,
      start_date: data.start_date,
      start_time: data.start_time ?? null,
      end_time: data.end_time ?? null,
      recurrence: data.recurrence ?? null,
      reminders: data.reminders ?? null,
      attendees: data.attendees ?? null,
      status_map: data.status_map ?? {},
      sync_status: "pending" as const,
    };

    let eventId: string;
    if (data.id) {
      const { data: updated, error } = await supabase
        .from("events")
        .update(row)
        .eq("id", data.id)
        .eq("user_id", userId)
        .select()
        .single();
      if (error) throw new Error(error.message);
      eventId = updated.id;
    } else {
      const { data: inserted, error } = await supabase
        .from("events")
        .insert(row)
        .select()
        .single();
      if (error) throw new Error(error.message);
      eventId = inserted.id;
    }

    // Fire-and-forget push to Google. Errors update sync_status but do not fail the mutation.
    void syncEventToGoogleInternal(userId, eventId);

    return { id: eventId };
  });

export const deleteEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context;
    // Snapshot to know if we need to delete from Google
    const { data: existing } = await supabase
      .from("events")
      .select("google_event_id, google_calendar_id")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();

    const { error } = await supabase
      .from("events")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);

    if (existing?.google_event_id) {
      void (async () => {
        const { pushDelete } = await import("./googleCalendar.server");
        await pushDelete(userId, existing.google_event_id!, existing.google_calendar_id ?? null);
      })();
    }

    return { ok: true };
  });

async function syncEventToGoogleInternal(userId: string, eventId: string) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("events")
      .select("*")
      .eq("id", eventId)
      .eq("user_id", userId)
      .single();
    if (error || !row) return;

    const { pushCreate, pushUpdate, isGoogleConnected } = await import("./googleCalendar.server");
    if (!(await isGoogleConnected(userId))) {
      await supabaseAdmin
        .from("events")
        .update({ sync_status: "local", sync_error: null })
        .eq("id", eventId);
      return;
    }
    const result = row.google_event_id ? await pushUpdate(userId, row) : await pushCreate(userId, row);
    if (result.ok) {
      await supabaseAdmin
        .from("events")
        .update({
          sync_status: "synced",
          sync_error: null,
          google_event_id: result.google_event_id ?? row.google_event_id,
          google_calendar_id: result.google_calendar_id ?? row.google_calendar_id,
          google_etag: result.google_etag ?? null,
          last_synced_at: new Date().toISOString(),
        })
        .eq("id", eventId);
    } else {
      await supabaseAdmin
        .from("events")
        .update({ sync_status: "error", sync_error: result.error ?? "unknown" })
        .eq("id", eventId);
    }
  } catch (e) {
    console.error("syncEventToGoogleInternal failed", e);
  }
}

export const retrySyncEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await syncEventToGoogleInternal(context.userId, data.id);
    return { ok: true };
  });

export const syncAllPending = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("events")
      .select("id, sync_status")
      .in("sync_status", ["pending", "error", "local"]);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      await syncEventToGoogleInternal(context.userId, row.id);
    }
    return { processed: data?.length ?? 0 };
  });
