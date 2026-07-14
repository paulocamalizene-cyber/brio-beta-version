/**
 * Google Calendar API helpers. Server-only.
 * Pushes app events into the user's primary calendar via the connector gateway.
 */
import { callAsAppUser } from "@/integrations/lovable/appUserConnector";
import { getConnectionKeyForUser } from "./appUserConnections.server";

export const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";
export const GOOGLE_CALENDAR_CONNECTOR_ID = "google_calendar";
const CALENDAR_ID = "primary";

export interface AppEventRow {
  id: string;
  title: string;
  description: string | null;
  location: { address?: string; lat?: number; lng?: number; name?: string } | null;
  start_date: string; // yyyy-mm-dd
  start_time: string | null; // HH:mm
  end_time: string | null; // HH:mm
  recurrence: string | null; // RRULE
  reminders:
    | { useDefault?: boolean; overrides?: Array<{ method: "email" | "popup"; minutes: number }> }
    | null;
  attendees: Array<{ email: string; displayName?: string }> | null;
  google_event_id: string | null;
  google_calendar_id: string | null;
}

interface GoogleEventResource {
  id: string;
  etag?: string;
  summary?: string;
  description?: string;
  location?: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  recurrence?: string[];
  reminders?: {
    useDefault?: boolean;
    overrides?: Array<{ method: string; minutes: number }>;
  };
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>;
}

function toGoogleResource(event: AppEventRow, timeZone: string): Partial<GoogleEventResource> {
  const resource: Partial<GoogleEventResource> = {
    summary: event.title,
    description: event.description ?? undefined,
    location: event.location?.address ?? event.location?.name ?? undefined,
  };

  if (event.start_time && event.end_time) {
    const startISO = `${event.start_date}T${padTime(event.start_time)}:00`;
    const endISO = `${event.start_date}T${padTime(event.end_time)}:00`;
    resource.start = { dateTime: startISO, timeZone };
    resource.end = { dateTime: endISO, timeZone };
  } else {
    resource.start = { date: event.start_date };
    // all-day events: end is exclusive next day
    const next = new Date(event.start_date + "T00:00:00Z");
    next.setUTCDate(next.getUTCDate() + 1);
    resource.end = { date: next.toISOString().slice(0, 10) };
  }

  if (event.recurrence) {
    const rrule = event.recurrence.startsWith("RRULE:")
      ? event.recurrence
      : `RRULE:${event.recurrence}`;
    resource.recurrence = [rrule];
  }

  if (event.reminders) {
    resource.reminders = {
      useDefault: event.reminders.useDefault ?? false,
      overrides: event.reminders.overrides,
    };
  }

  if (event.attendees && event.attendees.length > 0) {
    resource.attendees = event.attendees.map((a) => ({
      email: a.email,
      displayName: a.displayName,
    }));
  }

  return resource;
}

function padTime(t: string): string {
  // ensure HH:mm
  const [h, m] = t.split(":");
  return `${h.padStart(2, "0")}:${(m ?? "00").padStart(2, "0")}`;
}

async function getConnectionKeyOrNull(userId: string): Promise<string | null> {
  try {
    return await getConnectionKeyForUser(userId, GOOGLE_CALENDAR_CONNECTOR_ID);
  } catch {
    return null;
  }
}

export async function isGoogleConnected(userId: string): Promise<boolean> {
  return (await getConnectionKeyOrNull(userId)) !== null;
}

async function fetchTimeZone(connectionAPIKey: string): Promise<string> {
  try {
    const res = await callAsAppUser({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectionAPIKey,
      connectorId: GOOGLE_CALENDAR_CONNECTOR_ID,
      path: `/calendar/v3/users/me/settings/timezone`,
    });
    if (!res.ok) return "UTC";
    const body = (await res.json()) as { value?: string };
    return body.value ?? "UTC";
  } catch {
    return "UTC";
  }
}

export interface PushResult {
  ok: boolean;
  google_event_id?: string;
  google_calendar_id?: string;
  google_etag?: string;
  error?: string;
  errorStatus?: number;
}

export async function pushCreate(userId: string, event: AppEventRow): Promise<PushResult> {
  const connectionAPIKey = await getConnectionKeyOrNull(userId);
  if (!connectionAPIKey) return { ok: false, error: "not_connected" };
  const timeZone = await fetchTimeZone(connectionAPIKey);
  const body = toGoogleResource(event, timeZone);
  const res = await callAsAppUser({
    gatewayBaseUrl: GATEWAY_BASE_URL,
    connectionAPIKey,
    connectorId: GOOGLE_CALENDAR_CONNECTOR_ID,
    path: `/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: text || res.statusText, errorStatus: res.status };
  }
  const json = (await res.json()) as GoogleEventResource;
  return {
    ok: true,
    google_event_id: json.id,
    google_calendar_id: CALENDAR_ID,
    google_etag: json.etag,
  };
}

export async function pushUpdate(userId: string, event: AppEventRow): Promise<PushResult> {
  if (!event.google_event_id) return pushCreate(userId, event);
  const connectionAPIKey = await getConnectionKeyOrNull(userId);
  if (!connectionAPIKey) return { ok: false, error: "not_connected" };
  const timeZone = await fetchTimeZone(connectionAPIKey);
  const body = toGoogleResource(event, timeZone);
  const calId = event.google_calendar_id ?? CALENDAR_ID;
  const res = await callAsAppUser({
    gatewayBaseUrl: GATEWAY_BASE_URL,
    connectionAPIKey,
    connectorId: GOOGLE_CALENDAR_CONNECTOR_ID,
    path: `/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(event.google_event_id)}`,
    init: {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: text || res.statusText, errorStatus: res.status };
  }
  const json = (await res.json()) as GoogleEventResource;
  return {
    ok: true,
    google_event_id: json.id,
    google_calendar_id: calId,
    google_etag: json.etag,
  };
}

export async function pushDelete(
  userId: string,
  googleEventId: string,
  googleCalendarId: string | null,
): Promise<PushResult> {
  const connectionAPIKey = await getConnectionKeyOrNull(userId);
  if (!connectionAPIKey) return { ok: false, error: "not_connected" };
  const calId = googleCalendarId ?? CALENDAR_ID;
  const res = await callAsAppUser({
    gatewayBaseUrl: GATEWAY_BASE_URL,
    connectionAPIKey,
    connectorId: GOOGLE_CALENDAR_CONNECTOR_ID,
    path: `/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(googleEventId)}`,
    init: { method: "DELETE" },
  });
  if (!res.ok && res.status !== 410 && res.status !== 404) {
    const text = await res.text();
    return { ok: false, error: text || res.statusText, errorStatus: res.status };
  }
  return { ok: true };
}

export interface PullResult {
  imported: number;
  updated: number;
  deleted: number;
  errors: string[];
}

/**
 * Manual pull: fetches events from the user's primary Google Calendar and
 * upserts them into public.events. Uses syncToken for incremental sync when
 * available; falls back to a time-bounded window on first run or when the
 * token expires.
 */
export async function pullFromGoogle(userId: string): Promise<PullResult> {
  const result: PullResult = { imported: 0, updated: 0, deleted: 0, errors: [] };
  const connectionAPIKey = await getConnectionKeyOrNull(userId);
  if (!connectionAPIKey) {
    result.errors.push("Não conectado ao Google Calendar");
    return result;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Load stored syncToken
  const { data: conn } = await supabaseAdmin
    .from("app_user_connections")
    .select("google_sync_token")
    .eq("user_id", userId)
    .eq("connector_id", GOOGLE_CALENDAR_CONNECTOR_ID)
    .maybeSingle();

  let syncToken: string | null = conn?.google_sync_token ?? null;
  let pageToken: string | null = null;
  let nextSyncToken: string | null = null;

  const timeMin = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString();
  })();
  const timeMax = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 365);
    return d.toISOString();
  })();

  let tokenReset = false;
  for (let i = 0; i < 20; i++) {
    const params = new URLSearchParams();
    params.set("singleEvents", "true");
    params.set("maxResults", "250");
    if (syncToken && !tokenReset) {
      params.set("syncToken", syncToken);
    } else {
      params.set("timeMin", timeMin);
      params.set("timeMax", timeMax);
    }
    if (pageToken) params.set("pageToken", pageToken);

    const res = await callAsAppUser({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectionAPIKey,
      connectorId: GOOGLE_CALENDAR_CONNECTOR_ID,
      path: `/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events?${params.toString()}`,
    });

    if (res.status === 410 && syncToken && !tokenReset) {
      // syncToken expired — restart with full window
      tokenReset = true;
      syncToken = null;
      pageToken = null;
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      result.errors.push(`Google API ${res.status}: ${text.slice(0, 200)}`);
      break;
    }
    const body = (await res.json()) as {
      items?: Array<{
        id: string;
        status?: string;
        summary?: string;
        description?: string;
        location?: string;
        start?: { date?: string; dateTime?: string };
        end?: { date?: string; dateTime?: string };
        recurrence?: string[];
        etag?: string;
        updated?: string;
        reminders?: {
          useDefault?: boolean;
          overrides?: Array<{ method: string; minutes: number }>;
        };
        attendees?: Array<{ email: string; displayName?: string }>;
      }>;
      nextPageToken?: string;
      nextSyncToken?: string;
    };

    for (const item of body.items ?? []) {
      try {
        if (item.status === "cancelled") {
          const { error, count } = await supabaseAdmin
            .from("events")
            .delete({ count: "exact" })
            .eq("user_id", userId)
            .eq("google_event_id", item.id);
          if (error) throw error;
          if (count) result.deleted += count;
          continue;
        }

        // Check for existing local row + conflict resolution
        const { data: existing } = await supabaseAdmin
          .from("events")
          .select("id, updated_at")
          .eq("user_id", userId)
          .eq("google_event_id", item.id)
          .maybeSingle();

        const googleUpdated = item.updated ? new Date(item.updated).getTime() : 0;
        const localUpdated = existing?.updated_at ? new Date(existing.updated_at).getTime() : 0;

        if (existing && localUpdated > googleUpdated) {
          // local is newer — skip
          continue;
        }

        const isAllDay = !!item.start?.date;
        const start_date =
          item.start?.date ??
          (item.start?.dateTime ? item.start.dateTime.slice(0, 10) : null);
        if (!start_date) continue;

        const timeFrom = (iso?: string) => (iso ? iso.slice(11, 16) : null);
        const row = {
          user_id: userId,
          title: item.summary ?? "(sem título)",
          description: item.description ?? null,
          location: item.location ? { address: item.location } : null,
          color: null,
          start_date,
          start_time: isAllDay ? null : timeFrom(item.start?.dateTime),
          end_time: isAllDay ? null : timeFrom(item.end?.dateTime),
          recurrence: item.recurrence?.[0]?.replace(/^RRULE:/, "") ?? null,
          reminders: item.reminders ?? null,
          attendees: item.attendees ?? null,
          google_event_id: item.id,
          google_calendar_id: CALENDAR_ID,
          google_etag: item.etag ?? null,
          sync_status: "synced" as const,
          sync_error: null,
          last_synced_at: new Date().toISOString(),
        };

        if (existing) {
          const { error } = await supabaseAdmin
            .from("events")
            .update(row)
            .eq("id", existing.id);
          if (error) throw error;
          result.updated++;
        } else {
          const { error } = await supabaseAdmin.from("events").insert(row);
          if (error) throw error;
          result.imported++;
        }
      } catch (e) {
        result.errors.push(e instanceof Error ? e.message : String(e));
      }
    }

    pageToken = body.nextPageToken ?? null;
    nextSyncToken = body.nextSyncToken ?? nextSyncToken;
    if (!pageToken) break;
  }

  if (nextSyncToken) {
    await supabaseAdmin
      .from("app_user_connections")
      .update({ google_sync_token: nextSyncToken, last_full_sync_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("connector_id", GOOGLE_CALENDAR_CONNECTOR_ID);
  }

  return result;
}
