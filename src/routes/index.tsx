import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, format, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
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

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Agenda — Organização pessoal" },
      {
        name: "description",
        content:
          "Uma agenda diária minimalista para organizar seus compromissos por horário.",
      },
    ],
  }),
  component: CalendarApp,
});

type Category = "work" | "personal" | "study" | "health" | "social";

type Event = {
  id: string;
  date: string; // yyyy-MM-dd
  title: string;
  start: number; // minutes from 00:00
  end: number;
  category: Category;
};

const STORAGE_KEY = "calendar.events.v2";
const HOUR_HEIGHT = 60;
const DAY_MINUTES = 24 * 60;

/* ── iOS-style category colors ──────────────────────────── */
const CATEGORY_STYLES: Record<
  Category,
  { label: string; color: string; bgLight: string; bgDark: string }
> = {
  work: {
    label: "Trabalho",
    color: "#FF3B30",
    bgLight: "rgba(255, 59, 48, 0.12)",
    bgDark: "rgba(255, 69, 58, 0.20)",
  },
  personal: {
    label: "Pessoal",
    color: "#007AFF",
    bgLight: "rgba(0, 122, 255, 0.12)",
    bgDark: "rgba(10, 132, 255, 0.20)",
  },
  study: {
    label: "Estudo",
    color: "#AF52DE",
    bgLight: "rgba(175, 82, 222, 0.12)",
    bgDark: "rgba(191, 90, 242, 0.20)",
  },
  health: {
    label: "Saúde",
    color: "#34C759",
    bgLight: "rgba(52, 199, 89, 0.12)",
    bgDark: "rgba(48, 209, 88, 0.20)",
  },
  social: {
    label: "Social",
    color: "#FF9500",
    bgLight: "rgba(255, 149, 0, 0.12)",
    bgDark: "rgba(255, 159, 10, 0.20)",
  },
};

const minutesToLabel = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const snap = (min: number, step = 15) =>
  Math.max(0, Math.min(DAY_MINUTES, Math.round(min / step) * step));

const parseHM = (s: string) => {
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
};

/* ── Dark mode detection ────────────────────────────────── */
function useIsDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const check = () => {
      setDark(
        document.documentElement.classList.contains("dark") || mq.matches,
      );
    };
    check();
    mq.addEventListener("change", check);
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => {
      mq.removeEventListener("change", check);
      obs.disconnect();
    };
  }, []);
  return dark;
}

function CalendarApp() {
  const [selected, setSelected] = useState<Date>(new Date());
  const [events, setEvents] = useState<Event[]>([]);
  const [dialog, setDialog] = useState<
    | { mode: "create" }
    | { mode: "edit"; event: Event }
    | null
  >(null);
  const [draft, setDraft] = useState({
    title: "",
    start: "09:00",
    end: "10:00",
    category: "personal" as Category,
  });

  const isDark = useIsDark();

  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setEvents(JSON.parse(raw));
    } catch {}
  }, []);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  }, [events]);

  const selectedKey = format(selected, "yyyy-MM-dd");
  const dayEvents = useMemo(
    () =>
      events
        .filter((e) => e.date === selectedKey)
        .sort((a, b) => a.start - b.start),
    [events, selectedKey],
  );

  // 7-day strip centered around selected
  const stripDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(selected, i - 3)),
    [selected],
  );

  function openCreate(startMin: number) {
    const s = snap(startMin);
    const e = Math.min(DAY_MINUTES, s + 60);
    setDraft({
      title: "",
      start: minutesToLabel(s),
      end: minutesToLabel(e),
      category: "personal",
    });
    setDialog({ mode: "create" });
  }

  function openEdit(ev: Event) {
    setDraft({
      title: ev.title,
      start: minutesToLabel(ev.start),
      end: minutesToLabel(ev.end),
      category: ev.category,
    });
    setDialog({ mode: "edit", event: ev });
  }

  function saveDraft() {
    if (!draft.title.trim() || !dialog) return;
    const s = parseHM(draft.start);
    let e = parseHM(draft.end);
    if (e <= s) e = Math.min(DAY_MINUTES, s + 30);
    if (dialog.mode === "create") {
      setEvents((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          date: selectedKey,
          title: draft.title.trim(),
          start: s,
          end: e,
          category: draft.category,
        },
      ]);
    } else {
      const id = dialog.event.id;
      setEvents((prev) =>
        prev.map((ev) =>
          ev.id === id
            ? {
                ...ev,
                title: draft.title.trim(),
                start: s,
                end: e,
                category: draft.category,
              }
            : ev,
        ),
      );
    }
    setDialog(null);
  }

  function deleteCurrent() {
    if (dialog?.mode !== "edit") return;
    const id = dialog.event.id;
    setEvents((prev) => prev.filter((e) => e.id !== id));
    setDialog(null);
  }

  // Drag / resize
  const gridRef = useRef<HTMLDivElement | null>(null);
  type Gesture =
    | { kind: "move"; id: string; grabOffset: number; duration: number }
    | { kind: "resize"; id: string; startMin: number };
  const gestureRef = useRef<Gesture | null>(null);
  const movedRef = useRef(false);
  const [ghost, setGhost] = useState<
    | { id: string; start: number; end: number }
    | null
  >(null);

  const pointerToMin = (clientY: number) => {
    const grid = gridRef.current;
    if (!grid) return 0;
    const rect = grid.getBoundingClientRect();
    return ((clientY - rect.top + grid.scrollTop) / HOUR_HEIGHT) * 60;
  };

  function onBlockPointerDown(e: React.PointerEvent, ev: Event) {
    e.stopPropagation();
    const min = pointerToMin(e.clientY);
    gestureRef.current = {
      kind: "move",
      id: ev.id,
      grabOffset: min - ev.start,
      duration: ev.end - ev.start,
    };
    movedRef.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onResizePointerDown(e: React.PointerEvent, ev: Event) {
    e.stopPropagation();
    gestureRef.current = { kind: "resize", id: ev.id, startMin: ev.start };
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
    // prevent click if dragged
    if (movedRef.current) {
      setTimeout(() => (movedRef.current = false), 0);
    }
  }

  function onGridClick(e: React.MouseEvent<HTMLDivElement>) {
    if (gestureRef.current) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-event-block]")) return;
    openCreate(pointerToMin(e.clientY));
  }

  const showNowLine = isSameDay(selected, now);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  return (
    <main className="flex h-screen flex-col bg-background">
      {/* ── iOS Navigation Bar ──────────────────────────── */}
      <header
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "0.5px solid var(--color-border)" }}
      >
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSelected((d) => addDays(d, -1))}
            className="flex h-8 w-8 items-center justify-center rounded-full text-primary transition-colors duration-200 hover:bg-secondary active:bg-secondary/70"
            aria-label="Dia anterior"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={2} />
          </button>
          <button
            onClick={() => setSelected(new Date())}
            className="px-2 text-[17px] font-semibold capitalize tracking-tight text-foreground transition-opacity duration-200 hover:opacity-70"
          >
            {format(selected, "d 'de' MMMM", { locale: ptBR })}
          </button>
          <button
            onClick={() => setSelected((d) => addDays(d, 1))}
            className="flex h-8 w-8 items-center justify-center rounded-full text-primary transition-colors duration-200 hover:bg-secondary active:bg-secondary/70"
            aria-label="Próximo dia"
          >
            <ChevronRight className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>
        <button
          onClick={() => setSelected(new Date())}
          className="rounded-full bg-primary/10 px-4 py-1.5 text-[13px] font-semibold text-primary transition-all duration-200 hover:bg-primary/20 active:scale-95"
        >
          Hoje
        </button>
      </header>

      {/* ── Day Strip (iOS style) ───────────────────────── */}
      <div
        className="flex items-center justify-around px-3 py-2"
        style={{ borderBottom: "0.5px solid var(--color-border)" }}
      >
        {stripDays.map((d) => {
          const isSel = isSameDay(d, selected);
          const isToday = isSameDay(d, now);
          return (
            <button
              key={d.toISOString()}
              onClick={() => setSelected(d)}
              className="group flex flex-col items-center gap-1 px-1 py-1 transition-all duration-200"
            >
              {/* Day name */}
              <span
                className="text-[11px] font-semibold uppercase tracking-wider transition-colors duration-200"
                style={{
                  color: isSel
                    ? "var(--color-primary)"
                    : isToday
                      ? "var(--color-primary)"
                      : "var(--color-muted-foreground)",
                }}
              >
                {format(d, "EEE", { locale: ptBR }).slice(0, 3)}
              </span>
              {/* Day number */}
              <span
                className="flex h-9 w-9 items-center justify-center rounded-full text-[16px] font-medium transition-all duration-200"
                style={{
                  backgroundColor: isSel ? "var(--color-primary)" : "transparent",
                  color: isSel
                    ? "#ffffff"
                    : isToday
                      ? "var(--color-primary)"
                      : "var(--color-foreground)",
                }}
              >
                {format(d, "d")}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Timeline Grid ───────────────────────────────── */}
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={gridRef}
          className="h-full overflow-y-auto"
          style={{ scrollBehavior: "smooth" }}
          onPointerMove={onGesturePointerMove}
          onPointerUp={onGesturePointerUp}
        >
          <div
            className="relative"
            style={{ height: 24 * HOUR_HEIGHT }}
            onClick={onGridClick}
          >
            {/* Hour rows */}
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="absolute left-0 right-0"
                style={{
                  top: h * HOUR_HEIGHT,
                  height: HOUR_HEIGHT,
                  borderTop: "0.33px solid var(--color-border)",
                }}
              >
                <span
                  className="absolute -top-[7px] left-0 w-[52px] pr-3 text-right text-[11px] font-light tabular-nums"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
                </span>
              </div>
            ))}

            {/* Now line */}
            {showNowLine && (
              <div
                className="pointer-events-none absolute z-20 flex items-center"
                style={{
                  top: (nowMin / 60) * HOUR_HEIGHT,
                  left: 52,
                  right: 12,
                }}
              >
                <span
                  className="shrink-0 rounded-full"
                  style={{
                    width: 8,
                    height: 8,
                    backgroundColor: "#FF3B30",
                    marginLeft: -4,
                  }}
                />
                <span
                  className="flex-1"
                  style={{
                    height: "1px",
                    backgroundColor: "#FF3B30",
                  }}
                />
              </div>
            )}

            {/* Events */}
            <div
              className="absolute inset-y-0"
              style={{ left: 56, right: 12 }}
            >
              {dayEvents.map((ev) => {
                const isGhost = ghost?.id === ev.id;
                const s = isGhost ? ghost!.start : ev.start;
                const e = isGhost ? ghost!.end : ev.end;
                const top = (s / 60) * HOUR_HEIGHT;
                const height = Math.max(26, ((e - s) / 60) * HOUR_HEIGHT - 2);
                const cat = CATEGORY_STYLES[ev.category];
                return (
                  <div
                    key={ev.id}
                    data-event-block
                    onPointerDown={(pe) => onBlockPointerDown(pe, ev)}
                    onClick={(ce) => {
                      ce.stopPropagation();
                      if (!movedRef.current) openEdit(ev);
                    }}
                    className="absolute left-0 right-0 flex cursor-grab touch-none select-none overflow-hidden rounded-lg transition-all duration-200 active:cursor-grabbing"
                    style={{
                      top,
                      height,
                      backgroundColor: isDark ? cat.bgDark : cat.bgLight,
                      boxShadow: isGhost
                        ? `0 0 0 2px ${cat.color}40`
                        : "0 0.5px 1px rgba(0,0,0,0.04)",
                      zIndex: isGhost ? 10 : 1,
                    }}
                  >
                    {/* Color bar */}
                    <span
                      className="shrink-0 rounded-full"
                      style={{
                        width: 3,
                        backgroundColor: cat.color,
                        margin: "4px 0 4px 3px",
                      }}
                    />
                    {/* Content */}
                    <div className="min-w-0 flex-1 px-2 py-1">
                      <p
                        className="truncate text-[13px] font-medium leading-tight"
                        style={{ color: cat.color }}
                      >
                        {ev.title}
                      </p>
                      <p
                        className="truncate text-[11px] tabular-nums"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        {minutesToLabel(s)} – {minutesToLabel(e)}
                      </p>
                    </div>
                    {/* Resize handle */}
                    <div
                      onPointerDown={(pe) => onResizePointerDown(pe, ev)}
                      onClick={(ce) => ce.stopPropagation()}
                      className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── FAB (iOS style) ─────────────────────────── */}
        <button
          onClick={() => openCreate(9 * 60)}
          className="absolute bottom-6 right-6 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-primary text-white shadow-lg transition-all duration-200 hover:bg-primary/85 hover:shadow-xl active:scale-95"
          aria-label="Novo evento"
          style={{
            boxShadow: "0 4px 14px rgba(0, 122, 255, 0.35)",
          }}
        >
          <Plus className="h-6 w-6" strokeWidth={2.5} />
        </button>
      </div>

      {/* ── Event Dialog (iOS Sheet style) ──────────────── */}
      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-[17px] font-semibold">
              {dialog?.mode === "edit" ? "Editar evento" : "Novo evento"}{" "}
              <span className="text-muted-foreground font-normal">
                · {format(selected, "d MMM", { locale: ptBR })}
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Title */}
            <div className="space-y-1.5">
              <Label
                htmlFor="title"
                className="text-[13px] font-medium text-muted-foreground"
              >
                Título
              </Label>
              <Input
                id="title"
                autoFocus
                placeholder="Ex.: Reunião com a equipe"
                value={draft.title}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, title: e.target.value }))
                }
                onKeyDown={(e) => e.key === "Enter" && saveDraft()}
                className="rounded-xl border-0 bg-secondary px-3 py-2.5 text-[15px] placeholder:text-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-primary/30"
              />
            </div>
            {/* Time */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label
                  htmlFor="start"
                  className="text-[13px] font-medium text-muted-foreground"
                >
                  Início
                </Label>
                <Input
                  id="start"
                  type="time"
                  value={draft.start}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, start: e.target.value }))
                  }
                  className="rounded-xl border-0 bg-secondary px-3 py-2.5 text-[15px] focus-visible:ring-2 focus-visible:ring-primary/30"
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="end"
                  className="text-[13px] font-medium text-muted-foreground"
                >
                  Fim
                </Label>
                <Input
                  id="end"
                  type="time"
                  value={draft.end}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, end: e.target.value }))
                  }
                  className="rounded-xl border-0 bg-secondary px-3 py-2.5 text-[15px] focus-visible:ring-2 focus-visible:ring-primary/30"
                />
              </div>
            </div>
            {/* Category */}
            <div className="space-y-1.5">
              <Label className="text-[13px] font-medium text-muted-foreground">
                Categoria
              </Label>
              <Select
                value={draft.category}
                onValueChange={(v) =>
                  setDraft((d) => ({ ...d, category: v as Category }))
                }
              >
                <SelectTrigger className="rounded-xl border-0 bg-secondary px-3 py-2.5 text-[15px] focus:ring-2 focus:ring-primary/30">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-0 bg-card shadow-xl">
                  {(Object.keys(CATEGORY_STYLES) as Category[]).map((k) => (
                    <SelectItem
                      key={k}
                      value={k}
                      className="rounded-lg text-[15px]"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{
                            backgroundColor: CATEGORY_STYLES[k].color,
                          }}
                        />
                        {CATEGORY_STYLES[k].label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="flex-row justify-between sm:justify-between">
            {dialog?.mode === "edit" ? (
              <button
                onClick={deleteCurrent}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[15px] font-medium text-destructive transition-all duration-200 hover:bg-destructive/10 active:scale-95"
              >
                <Trash2 className="h-4 w-4" /> Excluir
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setDialog(null)}
                className="rounded-lg px-4 py-1.5 text-[15px] font-medium text-primary transition-all duration-200 hover:bg-primary/10 active:scale-95"
              >
                Cancelar
              </button>
              <button
                onClick={saveDraft}
                className="rounded-lg bg-primary px-5 py-1.5 text-[15px] font-semibold text-white transition-all duration-200 hover:bg-primary/85 active:scale-95"
              >
                {dialog?.mode === "edit" ? "Salvar" : "Adicionar"}
              </button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
