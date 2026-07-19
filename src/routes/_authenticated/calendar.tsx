import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { BottomNav } from "@/components/BottomNav";

import { useEffect, useMemo, useRef, useState } from "react";
import { useEventsSync, type SyncInfo } from "@/hooks/useEventsSync";
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Plus,
  Repeat,
  Search,
  Trash2,
  Users,
  X,
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  Loader2,
} from "lucide-react";

import { geocodeAddress } from "@/lib/geocode.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({
    meta: [
      { title: "Calendário" },
      {
        name: "description",
        content:
          "Calendário pessoal minimalista, no estilo do Calendário da Apple.",
      },
    ],
  }),
  component: CalendarApp,
});

// ───────────────────────── types ─────────────────────────

type Status = "done" | "missed" | "pending";

type Freq =
  | "none"
  | "daily"
  | "weekdays"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "yearly"
  | "custom";

type Recurrence = {
  freq: Freq;
  byWeekday?: number[]; // 0..6 (sun..sat), for custom
  interval?: number; // for custom (every N units)
  unit?: "day" | "week" | "month";
  until?: string | null; // yyyy-MM-dd
  count?: number | null;
};

type EventLocation = {
  address: string;
  lat?: number;
  lng?: number;
};

type EventDef = {
  id: string;
  date: string; // first occurrence yyyy-MM-dd
  title: string;
  start: number; // minutes from midnight
  end: number;
  color: string; // hex
  recurrence: Recurrence;
  statuses?: Record<string, Status>; // per-occurrence date -> status
  exceptions?: string[]; // dates removed from the series
  kind?: "informative" | "report"; // informational or requires report
  notifications?: number[];
  notes?: string;
  location?: EventLocation;
};

type Occurrence = {
  ev: EventDef;
  date: string;
  start: number;
  end: number;
  status: Status;
  statusExplicit: boolean;
  isPast: boolean;
  isRecurring: boolean;
};

const STORAGE_KEY = "calendar.events.v3";
const FAV_KEY = "calendar.favColors.v1";
const HOUR_HEIGHT = 56;
const DAY_MINUTES = 24 * 60;
const DEFAULT_COLOR = "#ef4444";

const DEFAULT_RECURRENCE: Recurrence = { freq: "none" };

// ───────────────────────── utils ─────────────────────────

const minutesToLabel = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const snap = (min: number, step = 15) =>
  Math.max(0, Math.min(DAY_MINUTES, Math.round(min / step) * step));

const parseHM = (s: string) => {
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
};

const fmtKey = (d: Date) => format(d, "yyyy-MM-dd");

function hexWithAlpha(hex: string, alpha: number) {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function readableText(hex: string) {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return l > 0.6 ? "#1a1a1a" : "#ffffff";
}

// occurrence test for a given date relative to a series
function occursOn(ev: EventDef, dateKey: string): boolean {
  if (ev.exceptions?.includes(dateKey)) return false;
  const start = parseISO(ev.date);
  const target = parseISO(dateKey);
  const diff = differenceInCalendarDays(target, start);
  if (diff < 0) return false;
  const r = ev.recurrence ?? DEFAULT_RECURRENCE;
  // until / count windowing (count is best-effort: counts elapsed potential dates)
  if (r.until) {
    const until = parseISO(r.until);
    if (differenceInCalendarDays(target, until) > 0) return false;
  }
  switch (r.freq) {
    case "none":
      return diff === 0;
    case "daily":
      return true;
    case "weekdays": {
      const w = target.getDay();
      return w >= 1 && w <= 5;
    }
    case "weekly":
      return diff % 7 === 0;
    case "biweekly":
      return diff % 14 === 0;
    case "monthly":
      return target.getDate() === start.getDate();
    case "yearly":
      return (
        target.getDate() === start.getDate() &&
        target.getMonth() === start.getMonth()
      );
    case "custom": {
      const unit = r.unit ?? "week";
      const interval = Math.max(1, r.interval ?? 1);
      if (unit === "day") return diff % interval === 0;
      if (unit === "week") {
        const wd = target.getDay();
        const days = r.byWeekday?.length ? r.byWeekday : [start.getDay()];
        if (!days.includes(wd)) return false;
        const weekDiff = Math.floor(diff / 7);
        return weekDiff % interval === 0;
      }
      if (unit === "month") {
        if (target.getDate() !== start.getDate()) return false;
        const months =
          (target.getFullYear() - start.getFullYear()) * 12 +
          (target.getMonth() - start.getMonth());
        return months % interval === 0;
      }
      return false;
    }
  }
}

function describeRecurrence(r: Recurrence): string {
  switch (r.freq) {
    case "none":
      return "Não repete";
    case "daily":
      return "Todos os dias";
    case "weekdays":
      return "Dias úteis";
    case "weekly":
      return "Semanalmente";
    case "biweekly":
      return "Quinzenalmente";
    case "monthly":
      return "Mensalmente";
    case "yearly":
      return "Anualmente";
    case "custom":
      return `A cada ${r.interval ?? 1} ${
        r.unit === "day" ? "dia(s)" : r.unit === "month" ? "mês(es)" : "semana(s)"
      }`;
  }
}

// Lane packing for overlapping events
function layoutColumns(occs: Occurrence[]) {
  const sorted = [...occs].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  );
  const result = new Map<string, { col: number; total: number }>();
  let group: Occurrence[] = [];
  let groupEnd = -1;
  const flush = () => {
    if (!group.length) return;
    const cols: Occurrence[][] = [];
    for (const ev of group) {
      let placed = false;
      for (let i = 0; i < cols.length; i++) {
        const last = cols[i][cols[i].length - 1];
        if (last.end <= ev.start) {
          cols[i].push(ev);
          result.set(keyOf(ev), { col: i, total: 0 });
          placed = true;
          break;
        }
      }
      if (!placed) {
        cols.push([ev]);
        result.set(keyOf(ev), { col: cols.length - 1, total: 0 });
      }
    }
    for (const ev of group) {
      const r = result.get(keyOf(ev))!;
      r.total = cols.length;
    }
    group = [];
    groupEnd = -1;
  };
  for (const ev of sorted) {
    if (group.length && ev.start >= groupEnd) flush();
    group.push(ev);
    groupEnd = Math.max(groupEnd, ev.end);
  }
  flush();
  return result;
}
const keyOf = (o: Occurrence) => `${o.ev.id}|${o.date}`;

// ───────────────────────── component ─────────────────────────

function CalendarApp() {
  const [selected, setSelected] = useState<Date>(new Date());
  const [events, setEvents] = useState<EventDef[]>([]);
  const [favColors, setFavColors] = useState<string[]>([]);
  const [dialog, setDialog] = useState<
    | { mode: "create" }
    | { mode: "edit"; ev: EventDef; occurrenceDate: string }
    | null
  >(null);
  const [editScope, setEditScope] = useState<"single" | "series">("series");
  const [askScope, setAskScope] = useState<
    null | { kind: "edit" | "delete"; ev: EventDef; date: string }
  >(null);
  const [statsOpen, setStatsOpen] = useState(false);

  const [draft, setDraft] = useState({
    title: "",
    date: fmtKey(new Date()),
    start: "09:00",
    end: "10:00",
    color: DEFAULT_COLOR,
    recurrence: { ...DEFAULT_RECURRENCE } as Recurrence,
    kind: "informative" as "informative" | "report",
    notifications: [] as number[],
    notes: "",
    location: "",
    locationCoords: null as { lat: number; lng: number } | null,
  });
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);

  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // load
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setEvents(JSON.parse(raw));
      const fav = localStorage.getItem(FAV_KEY);
      if (fav) setFavColors(JSON.parse(fav));
    } catch {}
  }, []);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  }, [events]);
  useEffect(() => {
    localStorage.setItem(FAV_KEY, JSON.stringify(favColors));
  }, [favColors]);

  const navigate = useNavigate();

  // Prefill from Contacts: if a contact was picked on /people, open the
  // create dialog with its info pre-populated.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("calendar.prefill");
      if (!raw) return;
      sessionStorage.removeItem("calendar.prefill");
      const p = JSON.parse(raw) as {
        title?: string;
        notes?: string;
        location?: string;
      };
      const s = snap(9 * 60);
      const e = Math.min(DAY_MINUTES, s + 60);
      setDraft({
        title: p.title ?? "",
        date: fmtKey(new Date()),
        start: minutesToLabel(s),
        end: minutesToLabel(e),
        color: DEFAULT_COLOR,
        recurrence: { ...DEFAULT_RECURRENCE },
        kind: "informative",
        notifications: [],
        notes: p.notes ?? "",
        location: p.location ?? "",
        locationCoords: null,
      });
      setGeocodeError(null);
      setEditScope("series");
      setDialog({ mode: "create" });
    } catch {}
  }, []);


  const { statuses: syncStatuses } = useEventsSync(events);

  const selectedKey = fmtKey(selected);

  // Compute occurrences for selected day with auto-pending
  const dayOccurrences: Occurrence[] = useMemo(() => {
    const out: Occurrence[] = [];
    const selDate = parseISO(selectedKey);
    for (const ev of events) {
      if (!occursOn(ev, selectedKey)) continue;
        const explicit = ev.statuses?.[selectedKey];
      const endDate = new Date(selDate);
      endDate.setHours(0, 0, 0, 0);
      endDate.setMinutes(ev.end);
      const past = now.getTime() >= endDate.getTime();
      let status: Status;
      let statusExplicit = false;
        if (ev.kind && ev.kind !== "report") {
          // informative events don't require reporting; keep as done for stats but not marked explicitly
          status = "done";
          statusExplicit = false;
        } else {
          if (explicit) {
            status = explicit;
            statusExplicit = true;
          } else if (past) {
            status = "pending";
          } else {
            status = "pending"; // future shows neutral indicator; treat as pending visually but not stored
          }
        }
      out.push({
        ev,
        date: selectedKey,
        start: ev.start,
        end: ev.end,
        status,
        statusExplicit,
        isPast: past,
        isRecurring: ev.recurrence.freq !== "none",
      });
    }
    return out;
  }, [events, selectedKey, now]);

  const layout = useMemo(() => layoutColumns(dayOccurrences), [dayOccurrences]);

  const stripDays = useMemo(() => {
    const start = startOfWeek(selected, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [selected]);

  const weekEventsCount = useMemo(() => {
    let count = 0;
    for (const d of stripDays) {
      const key = fmtKey(d);
      for (const ev of events) if (occursOn(ev, key)) count++;
    }
    return count;
  }, [stripDays, events]);

  // ── dialog ──
  function openCreate(startMin: number) {
    const s = snap(startMin);
    const e = Math.min(DAY_MINUTES, s + 60);
    setDraft({
      title: "",
      date: selectedKey,
      start: minutesToLabel(s),
      end: minutesToLabel(e),
      color: DEFAULT_COLOR,
      recurrence: { ...DEFAULT_RECURRENCE },
      kind: "informative",
      notifications: [],
      notes: "",
      location: "",
      locationCoords: null,
    });
    setGeocodeError(null);
    setEditScope("series");
    setDialog({ mode: "create" });
  }

  function openEdit(ev: EventDef, date: string) {
    if (ev.recurrence.freq !== "none") {
      setAskScope({ kind: "edit", ev, date });
      return;
    }
    actuallyOpenEdit(ev, date, "series");
  }

  function actuallyOpenEdit(
    ev: EventDef,
    date: string,
    scope: "single" | "series",
  ) {
    setDraft({
      title: ev.title,
      date: scope === "single" ? date : ev.date,
      start: minutesToLabel(ev.start),
      end: minutesToLabel(ev.end),
      color: ev.color,
      recurrence: scope === "single" ? { freq: "none" } : { ...ev.recurrence },
      kind: ev.kind ?? "informative",
      notifications: ev.notifications ?? [],
      notes: ev.notes ?? "",
      location: ev.location?.address ?? "",
      locationCoords:
        ev.location?.lat != null && ev.location?.lng != null
          ? { lat: ev.location.lat, lng: ev.location.lng }
          : null,
    });
    setGeocodeError(null);
    setEditScope(scope);
    setDialog({ mode: "edit", ev, occurrenceDate: date });
  }

  async function runGeocode() {
    const addr = draft.location.trim();
    if (!addr) {
      setDraft((d) => ({ ...d, locationCoords: null }));
      setGeocodeError(null);
      return;
    }
    setGeocoding(true);
    setGeocodeError(null);
    try {
      const r = await geocodeAddress({ data: { address: addr } });
      if (r.ok) {
        setDraft((d) => ({
          ...d,
          location: r.address,
          locationCoords: { lat: r.lat, lng: r.lng },
        }));
      } else {
        setGeocodeError("Endereço não encontrado");
        setDraft((d) => ({ ...d, locationCoords: null }));
      }
    } catch (err) {
      setGeocodeError("Falha ao localizar endereço");
    } finally {
      setGeocoding(false);
    }
  }

  function buildLocation(): EventLocation | undefined {
    const addr = draft.location.trim();
    if (!addr) return undefined;
    return draft.locationCoords
      ? { address: addr, lat: draft.locationCoords.lat, lng: draft.locationCoords.lng }
      : { address: addr };
  }

  function saveDraft() {
    if (!draft.title.trim() || !dialog) return;
    const s = parseHM(draft.start);
    let e = parseHM(draft.end);
    if (e <= s) e = Math.min(DAY_MINUTES, s + 30);
    const location = buildLocation();

    if (dialog.mode === "create") {
      setEvents((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          date: draft.date || selectedKey,
          title: draft.title.trim(),
          start: s,
          end: e,
          color: draft.color,
          recurrence: draft.recurrence,
          statuses: {},
          exceptions: [],
          kind: draft.kind,
          notifications: draft.notifications,
          notes: draft.notes,
          location,
        },
      ]);
    } else {
      const { ev, occurrenceDate } = dialog;
      if (editScope === "single" && ev.recurrence.freq !== "none") {
        // exclude this date from series, add a new standalone event
        setEvents((prev) => [
          ...prev.map((x) =>
            x.id === ev.id
              ? {
                  ...x,
                  exceptions: [...(x.exceptions ?? []), occurrenceDate],
                }
              : x,
          ),
          {
            id: crypto.randomUUID(),
            date: occurrenceDate,
            title: draft.title.trim(),
            start: s,
            end: e,
            color: draft.color,
            recurrence: { freq: "none" },
            statuses: {},
            exceptions: [],
            kind: draft.kind,
            notifications: draft.notifications,
            notes: draft.notes,
            location,
          },
        ]);
      } else {
        setEvents((prev) =>
          prev.map((x) =>
            x.id === ev.id
              ? {
                  ...x,
                  date: draft.date || x.date,
                  title: draft.title.trim(),
                  start: s,
                  end: e,
                  color: draft.color,
                  recurrence: draft.recurrence,
                  kind: draft.kind,
                  notifications: draft.notifications,
                  notes: draft.notes,
                  location,
                }
              : x,
          ),
        );
      }
    }
    setDialog(null);
  }

  function deleteCurrent() {
    if (dialog?.mode !== "edit") return;
    const { ev, occurrenceDate } = dialog;
    if (ev.recurrence.freq !== "none" && editScope === "single") {
      setEvents((prev) =>
        prev.map((x) =>
          x.id === ev.id
            ? { ...x, exceptions: [...(x.exceptions ?? []), occurrenceDate] }
            : x,
        ),
      );
    } else {
      setEvents((prev) => prev.filter((x) => x.id !== ev.id));
    }
    setDialog(null);
  }

  function setStatus(ev: EventDef, date: string, status: Status | null) {
    setEvents((prev) =>
      prev.map((x) => {
        if (x.id !== ev.id) return x;
        const statuses = { ...(x.statuses ?? {}) };
        if (status === null) delete statuses[date];
        else statuses[date] = status;
        return { ...x, statuses };
      }),
    );
  }

  function toggleFavColor(c: string) {
    setFavColors((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [c, ...prev].slice(0, 12),
    );
  }

  // ── Drag / resize (operates on the underlying series for non-recurring; for recurring, it shifts the whole series time) ──
  const gridRef = useRef<HTMLDivElement | null>(null);
  type Gesture =
    | { kind: "move"; id: string; grabOffset: number; duration: number }
    | { kind: "resize"; id: string; startMin: number };
  const gestureRef = useRef<Gesture | null>(null);
  const movedRef = useRef(false);
  const [ghost, setGhost] = useState<
    { id: string; start: number; end: number } | null
  >(null);

  const pointerToMin = (clientY: number) => {
    const grid = gridRef.current;
    if (!grid) return 0;
    const rect = grid.getBoundingClientRect();
    return ((clientY - rect.top + grid.scrollTop) / HOUR_HEIGHT) * 60;
  };

  function onBlockPointerDown(e: React.PointerEvent, o: Occurrence) {
    e.stopPropagation();
    const min = pointerToMin(e.clientY);
    gestureRef.current = {
      kind: "move",
      id: o.ev.id,
      grabOffset: min - o.start,
      duration: o.end - o.start,
    };
    movedRef.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onResizePointerDown(e: React.PointerEvent, o: Occurrence) {
    e.stopPropagation();
    gestureRef.current = { kind: "resize", id: o.ev.id, startMin: o.start };
    movedRef.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onGesturePointerMove(e: React.PointerEvent) {
    const g = gestureRef.current;
    if (!g) return;
    const min = pointerToMin(e.clientY);
    movedRef.current = true;
    if (g.kind === "move") {
      const newStart = snap(min - g.grabOffset);
      const clamped = Math.max(0, Math.min(DAY_MINUTES - g.duration, newStart));
      setGhost({ id: g.id, start: clamped, end: clamped + g.duration });
    } else {
      const newEnd = snap(min);
      const clamped = Math.max(g.startMin + 15, Math.min(DAY_MINUTES, newEnd));
      setGhost({ id: g.id, start: g.startMin, end: clamped });
    }
  }

  function onGesturePointerUp(e: React.PointerEvent) {
    const g = gestureRef.current;
    if (!g) return;
    if (movedRef.current && ghost && ghost.id === g.id) {
      setEvents((prev) =>
        prev.map((ev) =>
          ev.id === g.id ? { ...ev, start: ghost.start, end: ghost.end } : ev,
        ),
      );
    }
    gestureRef.current = null;
    setGhost(null);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    if (movedRef.current) setTimeout(() => (movedRef.current = false), 0);
  }

  function onGridClick(e: React.MouseEvent<HTMLDivElement>) {
    if (gestureRef.current) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-event-block]")) return;
    openCreate(pointerToMin(e.clientY));
  }

  const showNowLine = isSameDay(selected, now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const isTodaySel = isSameDay(selected, now);

  return (
    <main className="flex h-screen flex-col bg-background text-foreground md:flex-row">
      {/* Desktop sidebar with month calendar */}
      <MonthSidebar
        selected={selected}
        now={now}
        onSelect={setSelected}
        events={events}
      />

      <div className="flex min-w-0 flex-1 flex-col">
      {/* Top widget (mobile) — Apple Calendar-style header */}
      <div className="md:hidden">
        <div className="bg-card text-card-foreground border-b border-border px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] dark:bg-neutral-900 dark:text-white dark:border-white/10">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSelected(new Date())}
              className="font-display text-[22px] font-semibold capitalize leading-none"
            >
              {format(selected, "MMMM", { locale: ptBR })}
            </button>
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-muted-foreground dark:text-white/60">
                {weekEventsCount} {weekEventsCount === 1 ? "event" : "events"}
              </span>
              <div className="flex items-center gap-1 pl-1 text-primary">
                <button
                  onClick={() => setStatsOpen(true)}
                  aria-label="Estatísticas"
                  className="p-1"
                >
                  <BarChart3 className="h-4 w-4" strokeWidth={2.25} />
                </button>
                <button
                  onClick={() => navigate({ to: "/people" })}
                  aria-label="Adicionar a partir de contacto"
                  className="p-1"
                >
                  <Users className="h-4 w-4" strokeWidth={2.25} />
                </button>
                <button
                  onClick={() => openCreate(9 * 60)}
                  aria-label="Novo evento"
                  className="p-1"
                >
                  <Plus className="h-5 w-5" strokeWidth={2.25} />
                </button>
              </div>
            </div>
          </div>

          {/* Weekday labels */}
          <div className="mt-3 grid grid-cols-7">
            {stripDays.map((d) => (
              <div
                key={`lbl-${d.toISOString()}`}
                className="text-center text-[12px] font-medium text-muted-foreground dark:text-white/60"
              >
                {format(d, "EEEEEE", { locale: ptBR })
                  .replace(/\.$/, "")
                  .replace(/^./, (c) => c.toUpperCase())}
              </div>
            ))}
          </div>

          {/* Day numbers */}
          <div className="mt-1 grid grid-cols-7">
            {stripDays.map((d) => {
              const isSel = isSameDay(d, selected);
              const today = isSameDay(d, now);
              return (
                <button
                  key={d.toISOString()}
                  onClick={() => setSelected(d)}
                  className="flex items-center justify-center py-1"
                >
                  <span
                    className={[
                      "flex h-8 w-8 items-center justify-center rounded-full text-[15px] font-medium tabular-nums transition-colors",
                      isSel
                        ? "bg-foreground text-background dark:bg-white dark:text-black"
                        : today
                          ? "text-primary"
                          : "text-foreground dark:text-white",
                    ].join(" ")}
                  >
                    {format(d, "d")}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>


      {/* Day label bar (desktop only) */}
      <div className="hidden border-y border-border bg-secondary/60 px-4 py-1.5 md:block md:border-t-0 md:bg-transparent md:px-6 md:py-4">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground md:text-[11px]">
          {isTodaySel ? "Hoje" : format(selected, "EEEE", { locale: ptBR })}
          <span className="ml-2 font-normal capitalize text-muted-foreground/70">
            {format(selected, "d 'de' MMMM yyyy", { locale: ptBR })}
          </span>
        </p>
      </div>

      {/* Agenda timeline */}
      <div className="relative flex-1 overflow-hidden pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-0">
        <div
          ref={gridRef}
          className="h-full overflow-y-auto scroll-smooth"
          onPointerMove={onGesturePointerMove}
          onPointerUp={onGesturePointerUp}
        >
          <div
            className="relative"
            style={{ height: 24 * HOUR_HEIGHT }}
            onClick={onGridClick}
          >
            {/* Hours */}
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="absolute left-0 right-0"
                style={{ top: h * HOUR_HEIGHT, height: HOUR_HEIGHT }}
              >
                <div className="absolute -top-2 left-0 w-14 pr-2 text-right text-[11px] font-medium tabular-nums text-muted-foreground">
                  {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
                </div>
                <div className="absolute left-14 right-0 top-0 h-px bg-border" />
              </div>
            ))}

            {/* Now line */}
            {showNowLine && (
              <div
                className="pointer-events-none absolute left-14 right-0 z-20 flex items-center"
                style={{ top: (nowMin / 60) * HOUR_HEIGHT }}
              >
                <span
                  className="-ml-1.5 h-3 w-3 rounded-full"
                  style={{ background: "var(--primary)" }}
                />
                <span
                  className="h-[2px] flex-1"
                  style={{ background: "var(--primary)" }}
                />
              </div>
            )}

            {/* Events */}
            <div className="absolute inset-y-0 left-14 right-2">
              {dayOccurrences.map((o) => {
                const isGhost = ghost?.id === o.ev.id;
                const s = isGhost ? ghost!.start : o.start;
                const e = isGhost ? ghost!.end : o.end;
                const top = (s / 60) * HOUR_HEIGHT;
                const height = Math.max(
                  26,
                  ((e - s) / 60) * HOUR_HEIGHT - 2,
                );
                const lay = layout.get(keyOf(o)) ?? { col: 0, total: 1 };
                const widthPct = 100 / lay.total;
                const leftPct = widthPct * lay.col;
                const color = o.ev.color;
                const bg = hexWithAlpha(color, 0.16);
                const text = readableText(bg.replace(/rgba?\([^)]+\)/, color));
                return (
                  <EventCard
                    key={keyOf(o)}
                    o={o}
                    s={s}
                    e={e}
                    top={top}
                    height={height}
                    widthPct={widthPct}
                    leftPct={leftPct}
                    color={color}
                    bg={bg}
                    text={text}
                    isGhost={isGhost}
                    onPointerDown={onBlockPointerDown}
                    onResizePointerDown={onResizePointerDown}
                    onOpenEdit={() => {
                      if (!movedRef.current) openEdit(o.ev, o.date);
                    }}
                    onSetStatus={(st) => setStatus(o.ev, o.date, st)}
                    syncInfo={syncStatuses.get(o.ev.id) ?? null}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <nav className="flex items-center justify-between border-t border-border bg-secondary/60 px-6 py-2 text-primary md:hidden">
        <button
          onClick={() => setSelected(new Date())}
          className="text-[15px] font-semibold"
        >
          Hoje
        </button>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setSelected((d) => addDays(d, -1))}
            aria-label="Anterior"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={2.5} />
          </button>
          <button
            onClick={() => setSelected((d) => addDays(d, 1))}
            aria-label="Próximo"
          >
            <ChevronRight className="h-5 w-5" strokeWidth={2.5} />
          </button>
        </div>
        <button
          onClick={() => setStatsOpen(true)}
          className="text-[15px] font-semibold"
        >
          Estatísticas
        </button>
      </nav>
      </div>


      {/* Scope picker for recurring */}
      <AlertDialog
        open={!!askScope}
        onOpenChange={(o) => !o && setAskScope(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Evento recorrente</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja {askScope?.kind === "delete" ? "excluir" : "editar"} apenas
              este evento ou toda a série?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row justify-end gap-2">
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!askScope) return;
                if (askScope.kind === "edit") {
                  actuallyOpenEdit(askScope.ev, askScope.date, "single");
                } else {
                  setEvents((prev) =>
                    prev.map((x) =>
                      x.id === askScope.ev.id
                        ? {
                            ...x,
                            exceptions: [
                              ...(x.exceptions ?? []),
                              askScope.date,
                            ],
                          }
                        : x,
                    ),
                  );
                }
                setAskScope(null);
              }}
            >
              Apenas este
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                if (!askScope) return;
                if (askScope.kind === "edit") {
                  actuallyOpenEdit(askScope.ev, askScope.date, "series");
                } else {
                  setEvents((prev) =>
                    prev.filter((x) => x.id !== askScope.ev.id),
                  );
                }
                setAskScope(null);
              }}
            >
              Toda a série
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Stats dialog */}
      <StatsDialog
        open={statsOpen}
        onOpenChange={setStatsOpen}
        events={events}
        now={now}
      />

      {/* Create / edit dialog */}
      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              {dialog?.mode === "edit"
                ? editScope === "single"
                  ? "Editar este evento"
                  : "Editar série"
                : "Novo evento"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="title">Título</Label>
              <Input
                id="title"
                autoFocus
                placeholder="Título do evento"
                value={draft.title}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, title: e.target.value }))
                }
                onKeyDown={(e) => e.key === "Enter" && saveDraft()}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="date">Data</Label>
              <Input
                id="date"
                type="date"
                value={draft.date}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, date: e.target.value }))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="start">Início</Label>
                <Input
                  id="start"
                  type="time"
                  value={draft.start}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, start: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end">Fim</Label>
                <Input
                  id="end"
                  type="time"
                  value={draft.end}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, end: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select
                  value={draft.kind}
                  onValueChange={(v) => setDraft((d) => ({ ...d, kind: v as "informative" | "report" }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="informative">Informativo</SelectItem>
                    <SelectItem value="report">Com relatório</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Notificações (min antes)</Label>
                <Input
                  placeholder="Ex.: 10,30"
                  value={(draft.notifications || []).join(",")}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, notifications: e.target.value.split(",").map((s:any)=>parseInt(s||"0",10)).filter(Boolean) }))
                  }
                />
              </div>
            </div>

            {/* Color */}
            <div className="space-y-2">
              <Label>Cor</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={draft.color}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, color: e.target.value }))
                  }
                  className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent"
                />
                <Input
                  value={draft.color}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, color: e.target.value }))
                  }
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => toggleFavColor(draft.color)}
                >
                  {favColors.includes(draft.color) ? "★" : "☆"}
                </Button>
              </div>
              {favColors.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {favColors.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, color: c }))}
                      className="h-6 w-6 rounded-full border border-border"
                      style={{ background: c }}
                      aria-label={`Cor ${c}`}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Recurrence */}
            <div className="space-y-2">
              <Label>Repetição</Label>
              <Select
                value={draft.recurrence.freq}
                onValueChange={(v) =>
                  setDraft((d) => ({
                    ...d,
                    recurrence: {
                      ...d.recurrence,
                      freq: v as Freq,
                      unit: v === "custom" ? d.recurrence.unit ?? "week" : d.recurrence.unit,
                      interval:
                        v === "custom" ? d.recurrence.interval ?? 1 : d.recurrence.interval,
                    },
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Não repete</SelectItem>
                  <SelectItem value="daily">Todos os dias</SelectItem>
                  <SelectItem value="weekdays">Dias úteis</SelectItem>
                  <SelectItem value="weekly">Semanalmente</SelectItem>
                  <SelectItem value="biweekly">Quinzenalmente</SelectItem>
                  <SelectItem value="monthly">Mensalmente</SelectItem>
                  <SelectItem value="yearly">Anualmente</SelectItem>
                  <SelectItem value="custom">Personalizada</SelectItem>
                </SelectContent>
              </Select>

              {draft.recurrence.freq === "custom" && (
                <div className="space-y-2 rounded-md border border-border p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">A cada</span>
                    <Input
                      type="number"
                      min={1}
                      value={draft.recurrence.interval ?? 1}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          recurrence: {
                            ...d.recurrence,
                            interval: Math.max(1, parseInt(e.target.value || "1", 10)),
                          },
                        }))
                      }
                      className="w-20"
                    />
                    <Select
                      value={draft.recurrence.unit ?? "week"}
                      onValueChange={(v) =>
                        setDraft((d) => ({
                          ...d,
                          recurrence: {
                            ...d.recurrence,
                            unit: v as "day" | "week" | "month",
                          },
                        }))
                      }
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="day">Dias</SelectItem>
                        <SelectItem value="week">Semanas</SelectItem>
                        <SelectItem value="month">Meses</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {draft.recurrence.unit === "week" && (
                    <div className="flex flex-wrap gap-1">
                      {["D", "S", "T", "Q", "Q", "S", "S"].map((l, i) => {
                        const active = draft.recurrence.byWeekday?.includes(i);
                        return (
                          <button
                            type="button"
                            key={i}
                            onClick={() =>
                              setDraft((d) => {
                                const cur = d.recurrence.byWeekday ?? [];
                                const next = cur.includes(i)
                                  ? cur.filter((x) => x !== i)
                                  : [...cur, i];
                                return {
                                  ...d,
                                  recurrence: { ...d.recurrence, byWeekday: next },
                                };
                              })
                            }
                            className={[
                              "h-8 w-8 rounded-full border text-xs font-medium",
                              active
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border",
                            ].join(" ")}
                          >
                            {l}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {draft.recurrence.freq !== "none" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Termina em</Label>
                    <Input
                      type="date"
                      value={draft.recurrence.until ?? ""}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          recurrence: {
                            ...d.recurrence,
                            until: e.target.value || null,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Ocorrências</Label>
                    <Input
                      type="number"
                      min={1}
                      placeholder="—"
                      value={draft.recurrence.count ?? ""}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          recurrence: {
                            ...d.recurrence,
                            count: e.target.value
                              ? Math.max(1, parseInt(e.target.value, 10))
                              : null,
                          },
                        }))
                      }
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="location">Local</Label>
              <div className="flex gap-2">
                <Input
                  id="location"
                  placeholder="Endereço ou nome do local"
                  value={draft.location}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDraft((d) => ({
                      ...d,
                      location: v,
                      locationCoords: null,
                    }));
                    setGeocodeError(null);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={runGeocode}
                  disabled={geocoding || !draft.location.trim()}
                >
                  <MapPin className="mr-1.5 h-4 w-4" />
                  {geocoding ? "..." : "Localizar"}
                </Button>
              </div>
              {draft.locationCoords && (
                <p className="text-xs text-muted-foreground">
                  Coordenadas: {draft.locationCoords.lat.toFixed(4)},{" "}
                  {draft.locationCoords.lng.toFixed(4)}
                </p>
              )}
              {geocodeError && (
                <p className="text-xs text-destructive">{geocodeError}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notas</Label>
              <Textarea
                id="notes"
                placeholder="Detalhes, lembretes, links..."
                value={draft.notes}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, notes: e.target.value }))
                }
                rows={3}
              />
            </div>
          </div>
          <DialogFooter className="flex-row justify-between sm:justify-between">
            {dialog?.mode === "edit" ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={deleteCurrent}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="mr-1.5 h-4 w-4" /> Excluir
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setDialog(null)}>
                Cancelar
              </Button>
              <Button onClick={saveDraft}>
                {dialog?.mode === "edit" ? "Salvar" : "Adicionar"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="md:hidden">
        <BottomNav />
      </div>
    </main>
  );
}

// ───────────────────────── EventCard ─────────────────────────

function StatusBadge({ status }: { status: Status }) {
  if (status === "done")
    return (
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full"
        style={{ background: "#22c55e", color: "white" }}
        aria-label="Concluído"
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
    );
  if (status === "missed")
    return (
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full"
        style={{ background: "#ef4444", color: "white" }}
        aria-label="Não realizado"
      >
        <X className="h-3 w-3" strokeWidth={3} />
      </span>
    );
  return (
    <span
      className="flex h-5 w-5 items-center justify-center rounded-full"
      style={{ background: "#eab308", color: "white" }}
      aria-label="Pendente"
    >
      <AlertTriangle className="h-3 w-3" strokeWidth={2.5} />
    </span>
  );
}

function EventCard(props: {
  o: Occurrence;
  s: number;
  e: number;
  top: number;
  height: number;
  widthPct: number;
  leftPct: number;
  color: string;
  bg: string;
  text: string;
  isGhost: boolean;
  onPointerDown: (e: React.PointerEvent, o: Occurrence) => void;
  onResizePointerDown: (e: React.PointerEvent, o: Occurrence) => void;
  onOpenEdit: () => void;
  onSetStatus: (s: Status | null) => void;
  syncInfo?: SyncInfo | null;
}) {
  const {
    o,
    s,
    e,
    top,
    height,
    widthPct,
    leftPct,
    color,
    bg,
    isGhost,
    onPointerDown,
    onResizePointerDown,
    onOpenEdit,
    onSetStatus,
    syncInfo,
  } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const text = readableText(color);
  const showStatus = (o.ev.kind === "report") && (o.statusExplicit || o.isPast);
  return (
    <div
      data-event-block
      onPointerDown={(pe) => onPointerDown(pe, o)}
      onClick={(ce) => {
        ce.stopPropagation();
        onOpenEdit();
      }}
      className={[
        "absolute flex cursor-grab touch-none select-none overflow-hidden rounded-xl py-1 pl-2 pr-1.5 text-xs transition active:cursor-grabbing",
        isGhost ? "z-10 ring-2 ring-primary/50" : "",
      ].join(" ")}
      style={{
        top,
        height,
        left: `calc(${leftPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
        background: bg,
        borderLeft: `3px solid ${color}`,
        color: text,
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <p
            className="truncate text-[13px] font-semibold leading-tight"
            style={{ color }}
          >
            {o.ev.title}
          </p>
          {o.isRecurring && (
            <Repeat
              className="h-3 w-3 shrink-0 opacity-70"
              style={{ color }}
            />
          )}
          <SyncBadge info={syncInfo} color={color} />
        </div>
        <p
          className="truncate text-[11px] tabular-nums leading-tight opacity-80"
          style={{ color }}
        >
          {minutesToLabel(s)} – {minutesToLabel(e)}
        </p>
      </div>
      {showStatus && (
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button
              onClick={(ev) => {
                ev.stopPropagation();
                setMenuOpen(true);
              }}
              onPointerDown={(ev) => ev.stopPropagation()}
              className="ml-1 shrink-0 self-start"
              aria-label="Estado"
            >
              <StatusBadge status={o.status} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-44 p-1"
            onClick={(ev) => ev.stopPropagation()}
            onPointerDown={(ev) => ev.stopPropagation()}
          >
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-secondary"
              onClick={() => {
                onSetStatus("done");
                setMenuOpen(false);
              }}
            >
              <StatusBadge status="done" /> Concluído
            </button>
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-secondary"
              onClick={() => {
                onSetStatus("missed");
                setMenuOpen(false);
              }}
            >
              <StatusBadge status="missed" /> Não realizado
            </button>
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-secondary"
              onClick={() => {
                onSetStatus(null);
                setMenuOpen(false);
              }}
            >
              <StatusBadge status="pending" /> Pendente
            </button>
          </PopoverContent>
        </Popover>
      )}
      <div
        onPointerDown={(pe) => onResizePointerDown(pe, o)}
        onClick={(ce) => ce.stopPropagation()}
        className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize"
      />
    </div>
  );
}

// ───────────────────────── Stats ─────────────────────────

function StatsDialog({
  open,
  onOpenChange,
  events,
  now,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  events: EventDef[];
  now: Date;
}) {
  const stats = useMemo(() => {
    let done = 0,
      missed = 0,
      pending = 0,
      total = 0;
    const daySet = new Set<string>();
    const doneDays = new Set<string>();
    const earliest = events.reduce<Date | null>((min, ev) => {
      const d = parseISO(ev.date);
      return !min || d < min ? d : min;
    }, null);
    if (!earliest) return { done, missed, pending, total, rate: 0, streak: 0, weekRate: 0, days: 0 };
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const startDay = new Date(earliest);
    startDay.setHours(0, 0, 0, 0);
    for (
      let d = new Date(startDay);
      d <= today;
      d = addDays(d, 1)
    ) {
      const key = fmtKey(d);
      let dayDone = false;
      let dayHas = false;
      for (const ev of events) {
        if (!occursOn(ev, key)) continue;
        if (ev.kind && ev.kind !== "report") continue;
        // end datetime for the occurrence
        const endDT = new Date(d);
        endDT.setHours(0, 0, 0, 0);
        endDT.setMinutes(ev.end);
        if (endDT.getTime() > now.getTime()) continue; // not finished yet
        dayHas = true;
        total++;
        const st = ev.statuses?.[key];
        if (st === "done") {
          done++;
          dayDone = true;
        } else if (st === "missed") {
          missed++;
        } else {
          pending++;
        }
      }
      if (dayHas) daySet.add(key);
      if (dayDone) doneDays.add(key);
    }
    const rate = total ? (done / total) * 100 : 0;
    // streak: consecutive days ending at today (or yesterday) where day had events and at least one done
    let streak = 0;
    for (let d = new Date(today); ; d = addDays(d, -1)) {
      const k = fmtKey(d);
      if (!daySet.has(k)) {
        if (streak === 0 && k === fmtKey(today)) continue; // skip today if no events
        break;
      }
      if (doneDays.has(k)) streak++;
      else break;
    }
    // week rate: last 7 days
    let wDone = 0,
      wTotal = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(today, -i);
      const key = fmtKey(d);
      for (const ev of events) {
        if (ev.kind && ev.kind !== "report") continue;
        if (!occursOn(ev, key)) continue;
        const endDT = new Date(d);
        endDT.setHours(0, 0, 0, 0);
        endDT.setMinutes(ev.end);
        if (endDT.getTime() > now.getTime()) continue;
        wTotal++;
        if (ev.statuses?.[key] === "done") wDone++;
      }
    }
    const weekRate = wTotal ? (wDone / wTotal) * 100 : 0;
    return {
      done,
      missed,
      pending,
      total,
      rate,
      streak,
      weekRate,
      days: daySet.size,
    };
  }, [events, now]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            Estatísticas
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <StatCard
            label="Taxa de conclusão"
            value={`${stats.rate.toFixed(0)}%`}
          />
          <StatCard
            label="Consistência semanal"
            value={`${stats.weekRate.toFixed(0)}%`}
          />
          <StatCard label="Sequência" value={`${stats.streak} d`} />
          <StatCard label="Dias com eventos" value={`${stats.days}`} />
          <StatCard
            label="Concluídos"
            value={`${stats.done}`}
            color="#22c55e"
          />
          <StatCard
            label="Não realizados"
            value={`${stats.missed}`}
            color="#ef4444"
          />
          <StatCard
            label="Pendentes"
            value={`${stats.pending}`}
            color="#eab308"
          />
          <StatCard label="Total" value={`${stats.total}`} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className="font-display text-2xl font-semibold tabular-nums"
        style={color ? { color } : undefined}
      >
        {value}
      </p>
    </div>
  );
}

// ───────────────────────── MonthSidebar ─────────────────────────

function MonthSidebar({
  selected,
  now,
  onSelect,
  events,
}: {
  selected: Date;
  now: Date;
  onSelect: (d: Date) => void;
  events: EventDef[];
}) {
  const [cursor, setCursor] = useState<Date>(startOfMonth(selected));

  useEffect(() => {
    setCursor(startOfMonth(selected));
  }, [selected]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const weekdayLabels = useMemo(() => {
    const base = startOfWeek(new Date(), { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) =>
      format(addDays(base, i), "EEEEE", { locale: ptBR }).toUpperCase(),
    );
  }, []);

  const hasEvent = (d: Date) => {
    const key = fmtKey(d);
    return events.some((ev) => occursOn(ev, key));
  };

  return (
    <aside className="hidden shrink-0 flex-col border-r border-border bg-secondary/40 md:flex md:w-[300px] lg:w-[340px]">
      <div className="px-6 pb-4 pt-6">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Agenda
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">
          {format(now, "EEEE, d 'de' MMM", { locale: ptBR })}
        </h1>
      </div>

      <div className="flex items-center justify-between px-6 pb-3">
        <button
          onClick={() => setCursor((c) => addMonths(c, -1))}
          className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label="Mês anterior"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
        </button>
        <button
          onClick={() => setCursor(startOfMonth(now))}
          className="font-display text-base font-semibold capitalize"
        >
          {format(cursor, "MMMM yyyy", { locale: ptBR })}
        </button>
        <button
          onClick={() => setCursor((c) => addMonths(c, 1))}
          className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label="Próximo mês"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>

      <div className="grid grid-cols-7 px-4 pb-1">
        {weekdayLabels.map((w, i) => (
          <div
            key={i}
            className="flex items-center justify-center py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-1 px-4 pb-4">
        {days.map((d) => {
          const inMonth = isSameMonth(d, cursor);
          const isSel = isSameDay(d, selected);
          const isToday = isSameDay(d, now);
          const marker = hasEvent(d);
          return (
            <button
              key={d.toISOString()}
              onClick={() => onSelect(d)}
              className="flex flex-col items-center py-0.5"
            >
              <span
                className={[
                  "flex h-9 w-9 items-center justify-center rounded-full text-[14px] font-medium tabular-nums transition-colors",
                  isSel
                    ? "bg-primary text-primary-foreground"
                    : isToday
                      ? "text-primary"
                      : inMonth
                        ? "text-foreground hover:bg-secondary"
                        : "text-muted-foreground/50 hover:bg-secondary",
                ].join(" ")}
              >
                {format(d, "d")}
              </span>
              <span
                className={[
                  "mt-0.5 h-1 w-1 rounded-full",
                  marker && !isSel ? "bg-primary" : "bg-transparent",
                ].join(" ")}
              />
            </button>
          );
        })}
      </div>

      <div className="mt-auto border-t border-border px-6 py-4">
        <button
          onClick={() => onSelect(new Date())}
          className="text-sm font-semibold text-primary"
        >
          Ir para hoje
        </button>
      </div>
    </aside>
  );
}

// ───────────────────────── SyncBadge ─────────────────────────
function SyncBadge({ info, color }: { info: SyncInfo | null | undefined; color: string }) {
  if (!info) return null;
  const commonCls = "h-3 w-3 shrink-0";
  const title = (() => {
    switch (info.status) {
      case "synced":
        return "Sincronizado com o Google Calendar";
      case "pending":
        return "Sincronização pendente";
      case "error":
        return info.error ? `Erro: ${info.error.slice(0, 120)}` : "Erro na sincronização";
      case "local":
      default:
        return "Somente local (Google Calendar não conectado)";
    }
  })();
  const icon = (() => {
    switch (info.status) {
      case "synced":
        return <CheckCircle2 className={commonCls} style={{ color }} />;
      case "pending":
        return <Loader2 className={`${commonCls} animate-spin opacity-70`} style={{ color }} />;
      case "error":
        return <AlertTriangle className={commonCls} style={{ color: "#dc2626" }} />;
      case "local":
      default:
        return <CloudOff className={`${commonCls} opacity-60`} style={{ color }} />;
    }
  })();
  return (
    <span title={title} aria-label={title}>
      {icon}
    </span>
  );
}
