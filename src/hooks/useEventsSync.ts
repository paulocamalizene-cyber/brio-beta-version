import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { upsertEvent, deleteEvent, listEvents } from "@/lib/events.functions";

export type SyncStatus = "local" | "pending" | "synced" | "error";
export interface SyncInfo {
  status: SyncStatus;
  error?: string | null;
  lastSyncedAt?: string | null;
}

// Shape produced by src/routes/_authenticated/calendar.tsx (kept loose to avoid import cycles)
interface Recurrence {
  freq: string;
  byWeekday?: number[];
  interval?: number;
  unit?: "day" | "week" | "month";
  until?: string | null;
  count?: number | null;
}
interface LocalEvent {
  id: string;
  title: string;
  notes?: string;
  location?: { address?: string; lat?: number; lng?: number };
  color?: string;
  date: string; // yyyy-mm-dd (occurrence base date)
  start?: number; // minutes
  end?: number; // minutes
  recurrence?: Recurrence;
  notifications?: number[];
  statuses?: Record<string, string>;
}

function recurrenceToRRule(r?: Recurrence): string | null {
  if (!r || r.freq === "none") return null;
  const parts: string[] = [];
  const untilPart = r.until ? `;UNTIL=${r.until.replace(/-/g, "")}T235959Z` : "";
  const countPart = r.count ? `;COUNT=${r.count}` : "";
  switch (r.freq) {
    case "daily":
      parts.push("FREQ=DAILY");
      break;
    case "weekdays":
      parts.push("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
      break;
    case "weekly":
      parts.push("FREQ=WEEKLY");
      break;
    case "biweekly":
      parts.push("FREQ=WEEKLY;INTERVAL=2");
      break;
    case "monthly":
      parts.push("FREQ=MONTHLY");
      break;
    case "yearly":
      parts.push("FREQ=YEARLY");
      break;
    case "custom": {
      const days = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
      const unit = r.unit === "day" ? "DAILY" : r.unit === "month" ? "MONTHLY" : "WEEKLY";
      parts.push(`FREQ=${unit};INTERVAL=${r.interval ?? 1}`);
      if (r.byWeekday && r.byWeekday.length) {
        parts.push(`BYDAY=${r.byWeekday.map((d) => days[d]).join(",")}`);
      }
      break;
    }
    default:
      return null;
  }
  return parts.join(";") + untilPart + countPart;
}


function minToTime(m?: number): string | null {
  if (m == null) return null;
  const h = Math.floor(m / 60)
    .toString()
    .padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
}

function serialize(e: LocalEvent) {
  return JSON.stringify({
    t: e.title,
    d: e.notes ?? "",
    l: e.location ?? null,
    c: e.color ?? "",
    dt: e.date,
    s: e.start ?? null,
    en: e.end ?? null,
    r: e.recurrence ?? null,
    n: e.notifications ?? null,
  });
}


export function useAuthedUserId() {
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (mounted) setUserId(data.user?.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return userId;
}

/**
 * Mirrors local calendar events to the backend and Google Calendar.
 * Returns a map of eventId -> sync info driven by the backend row.
 */
export function useEventsSync(events: LocalEvent[] | null | undefined) {
  const upsert = useServerFn(upsertEvent);
  const del = useServerFn(deleteEvent);
  const list = useServerFn(listEvents);
  const userId = useAuthedUserId();
  const lastSnapshot = useRef<Map<string, string>>(new Map());
  const [statuses, setStatuses] = useState<Map<string, SyncInfo>>(new Map());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch statuses from the server periodically to reflect Google push outcomes.
  const refresh = () => {
    if (!userId) return;
    list()
      .then((rows) => {
        const map = new Map<string, SyncInfo>();
        for (const r of rows as Array<{
          id: string;
          sync_status: SyncStatus;
          sync_error: string | null;
          last_synced_at: string | null;
        }>) {
          map.set(r.id, {
            status: r.sync_status,
            error: r.sync_error,
            lastSyncedAt: r.last_synced_at,
          });
        }
        setStatuses(map);
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (!userId) {
      setStatuses(new Map());
      lastSnapshot.current.clear();
      return;
    }
    refresh();
    const iv = setInterval(refresh, 15_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (!userId || !events) return;

    const current = new Map<string, LocalEvent>();
    for (const e of events) current.set(e.id, e);

    const prev = lastSnapshot.current;

    // Deletions
    for (const id of prev.keys()) {
      if (!current.has(id)) {
        del({ data: { id } }).catch(() => {});
      }
    }

    // Upserts (only if changed)
    for (const [id, e] of current) {
      const s = serialize(e);
      if (prev.get(id) === s) continue;
      const payload = {
        id,
        title: e.title || "Sem título",
        description: e.notes ?? null,
        location: e.location
          ? { address: e.location.address, lat: e.location.lat, lng: e.location.lng }
          : null,
        color: e.color ?? null,
        start_date: e.date,
        start_time: minToTime(e.start),
        end_time: minToTime(e.end),
        recurrence: recurrenceToRRule(e.recurrence),
        reminders:
          e.notifications && e.notifications.length
            ? {
                useDefault: false,
                overrides: e.notifications.map((m) => ({
                  method: "popup" as const,
                  minutes: m,
                })),
              }
            : null,
        attendees: null,
        status_map: e.statuses ?? {},
      };
      upsert({ data: payload })
        .then(() => {
          if (refreshTimer.current) clearTimeout(refreshTimer.current);
          refreshTimer.current = setTimeout(refresh, 1500);
        })
        .catch(() => {});
    }

    // Snapshot
    const next = new Map<string, string>();
    for (const [id, e] of current) next.set(id, serialize(e));
    lastSnapshot.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, userId]);

  return { statuses, isAuthed: !!userId, refresh };
}
