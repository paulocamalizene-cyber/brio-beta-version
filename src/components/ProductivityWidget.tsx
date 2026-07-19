import { useEffect, useMemo, useState } from "react";
import {
  addDays,
  differenceInCalendarDays,
  format,
  isSameDay,
  parseISO,
  startOfWeek,
} from "date-fns";
import { Flame, Clock, CheckCircle2 } from "lucide-react";

// ─── Types mirrored from the calendar route (kept minimal on purpose) ───
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
  byWeekday?: number[];
  interval?: number;
  unit?: "day" | "week" | "month";
  until?: string | null;
  count?: number | null;
};
type EventDef = {
  id: string;
  date: string;
  title: string;
  start: number;
  end: number;
  color: string;
  recurrence: Recurrence;
  statuses?: Record<string, Status>;
  exceptions?: string[];
  kind?: "informative" | "report";
};

const STORAGE_KEY = "calendar.events.v3";
const DEFAULT_RECURRENCE: Recurrence = { freq: "none" };

function occursOn(ev: EventDef, dateKey: string): boolean {
  if (ev.exceptions?.includes(dateKey)) return false;
  const start = parseISO(ev.date);
  const target = parseISO(dateKey);
  const diff = differenceInCalendarDays(target, start);
  if (diff < 0) return false;
  const r = ev.recurrence ?? DEFAULT_RECURRENCE;
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
        return Math.floor(diff / 7) % interval === 0;
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

const fmtKey = (d: Date) => format(d, "yyyy-MM-dd");

type DayStat = {
  date: Date;
  key: string;
  total: number;
  done: number;
  status: "none" | "partial" | "complete";
};

function computeDayStat(events: EventDef[], date: Date): DayStat {
  const key = fmtKey(date);
  let total = 0;
  let done = 0;
  for (const ev of events) {
    if (!occursOn(ev, key)) continue;
    total++;
    const explicit = ev.statuses?.[key];
    if (explicit === "done") done++;
    else if (!explicit && ev.kind === "informative") done++;
  }
  const status: DayStat["status"] =
    total === 0 ? "none" : done >= total ? "complete" : "partial";
  return { date, key, total, done, status };
}

function computeStreak(events: EventDef[]): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let streak = 0;
  for (let i = 0; i < 366; i++) {
    const d = addDays(today, -i);
    const s = computeDayStat(events, d);
    if (s.total === 0) continue; // sem eventos: não quebra
    if (s.status === "complete") {
      streak++;
      continue;
    }
    // Parcial: hoje ainda não conta como quebra
    if (i === 0) continue;
    break;
  }
  return streak;
}

export function ProductivityWidget() {
  const [events, setEvents] = useState<EventDef[]>([]);

  useEffect(() => {
    const load = () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        setEvents(raw ? (JSON.parse(raw) as EventDef[]) : []);
      } catch {
        setEvents([]);
      }
    };
    load();
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) load();
    };
    const onFocus = () => load();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    const iv = setInterval(load, 30_000);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      clearInterval(iv);
    };
  }, []);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const streak = useMemo(() => computeStreak(events), [events]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(today, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) =>
      computeDayStat(events, addDays(start, i)),
    );
  }, [events, today]);

  const todayStat = useMemo(
    () => computeDayStat(events, today),
    [events, today],
  );
  const pending = Math.max(0, todayStat.total - todayStat.done);
  const percent = todayStat.total
    ? Math.round((todayStat.done / todayStat.total) * 100)
    : 0;

  const dayLabels = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

  return (
    <section
      aria-label="Widget de produtividade"
      className="mx-5 mt-2 rounded-2xl border border-border bg-card/80 p-4 shadow-sm backdrop-blur"
    >
      {/* Streak */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Streak
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-3xl font-semibold tracking-tight">
              {streak}
            </span>
            <span className="text-sm font-medium text-muted-foreground">
              {streak === 1 ? "dia" : "dias"}
            </span>
          </div>
        </div>
        <div
          className="flex h-11 w-11 items-center justify-center rounded-full"
          style={{
            background:
              streak > 0
                ? "color-mix(in oklab, var(--primary) 15%, transparent)"
                : "var(--muted)",
          }}
        >
          <Flame
            className="h-5 w-5"
            style={{
              color:
                streak > 0 ? "var(--primary)" : "var(--muted-foreground)",
            }}
          />
        </div>
      </div>

      {/* Week dots */}
      <div className="mt-4 grid grid-cols-7 gap-1.5">
        {weekDays.map((d, i) => {
          const isToday = isSameDay(d.date, today);
          const bg =
            d.status === "complete"
              ? "bg-emerald-500"
              : d.status === "partial"
                ? "bg-amber-400"
                : "bg-muted";
          const fg =
            d.status === "none"
              ? "text-muted-foreground"
              : "text-white";
          return (
            <div key={d.key} className="flex flex-col items-center gap-1.5">
              <span className="text-[10px] font-medium text-muted-foreground">
                {dayLabels[i]}
              </span>
              <div
                className={`relative flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${bg} ${fg} ${
                  isToday
                    ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                    : ""
                }`}
              >
                {format(d.date, "d")}
              </div>
            </div>
          );
        })}
      </div>

      {/* Today progress */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Hoje</span>
          </div>
          <span className="font-medium text-foreground">
            {todayStat.done}/{todayStat.total || 0} · {percent}%
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
        {pending > 0 && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span>
              {pending} {pending === 1 ? "pendente" : "pendentes"}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
