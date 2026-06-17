import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, format, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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

type Category = "work" | "personal" | "study" | "health" | "social";

type Event = {
  id: string;
  date: string; // yyyy-MM-dd
  title: string;
  start: number;
  end: number;
  category: Category;
};

const STORAGE_KEY = "calendar.events.v2";
const HOUR_HEIGHT = 56;
const DAY_MINUTES = 24 * 60;

const CATEGORY_STYLES: Record<
  Category,
  { label: string; color: string; bg: string; text: string }
> = {
  work: {
    label: "Trabalho",
    color: "oklch(0.62 0.22 27)", // red
    bg: "oklch(0.62 0.22 27 / 0.12)",
    text: "oklch(0.5 0.22 27)",
  },
  personal: {
    label: "Pessoal",
    color: "oklch(0.7 0.17 50)", // orange
    bg: "oklch(0.7 0.17 50 / 0.12)",
    text: "oklch(0.55 0.17 50)",
  },
  study: {
    label: "Estudo",
    color: "oklch(0.6 0.2 280)", // purple
    bg: "oklch(0.6 0.2 280 / 0.12)",
    text: "oklch(0.5 0.2 280)",
  },
  health: {
    label: "Saúde",
    color: "oklch(0.65 0.17 150)", // green
    bg: "oklch(0.65 0.17 150 / 0.12)",
    text: "oklch(0.5 0.17 150)",
  },
  social: {
    label: "Social",
    color: "oklch(0.65 0.16 235)", // blue
    bg: "oklch(0.65 0.16 235 / 0.12)",
    text: "oklch(0.5 0.16 235)",
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

function CalendarApp() {
  const [selected, setSelected] = useState<Date>(new Date());
  const [events, setEvents] = useState<Event[]>([]);
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; event: Event } | null
  >(null);
  const [draft, setDraft] = useState({
    title: "",
    start: "09:00",
    end: "10:00",
    category: "personal" as Category,
  });

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
    { id: string; start: number; end: number } | null
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
    <main className="flex h-screen flex-col bg-background text-foreground">
      {/* Top bar — Apple style */}
      <header className="flex items-center justify-between px-4 pb-1 pt-3">
        <button
          onClick={() => setSelected((d) => addDays(d, -1))}
          className="flex items-center gap-0.5 text-[17px] font-normal text-primary"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.5} />
          <span className="capitalize">
            {format(addDays(selected, -1), "MMM", { locale: ptBR })}
          </span>
        </button>
        <button
          onClick={() => setSelected(new Date())}
          className="font-display text-[17px] font-semibold capitalize"
        >
          {format(selected, "MMMM yyyy", { locale: ptBR })}
        </button>
        <div className="flex items-center gap-3 text-primary">
          <Search className="h-5 w-5" strokeWidth={2.25} />
          <button
            onClick={() => openCreate(9 * 60)}
            aria-label="Novo evento"
          >
            <Plus className="h-6 w-6" strokeWidth={2.25} />
          </button>
        </div>
      </header>

      {/* Week strip */}
      <div className="px-2 pb-2 pt-1">
        <div className="grid grid-cols-7">
          {stripDays.map((d) => {
            const isSel = isSameDay(d, selected);
            const today = isSameDay(d, now);
            return (
              <button
                key={d.toISOString()}
                onClick={() => setSelected(d)}
                className="flex flex-col items-center gap-1 py-1"
              >
                <span
                  className={[
                    "text-[11px] font-medium uppercase tracking-wide",
                    today ? "text-primary" : "text-muted-foreground",
                  ].join(" ")}
                >
                  {format(d, "EEEEE", { locale: ptBR }).toUpperCase()}
                </span>
                <span
                  className={[
                    "flex h-9 w-9 items-center justify-center rounded-full font-display text-[22px] font-light tabular-nums",
                    isSel && today
                      ? "bg-primary text-primary-foreground"
                      : isSel
                        ? "bg-foreground text-background"
                        : today
                          ? "text-primary"
                          : "text-foreground",
                  ].join(" ")}
                >
                  {format(d, "d")}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Day label bar — like Apple */}
      <div className="border-y border-border bg-secondary/60 px-4 py-1.5">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
          {isTodaySel ? "Hoje" : format(selected, "EEEE", { locale: ptBR })}
          <span className="ml-2 font-normal capitalize text-muted-foreground/70">
            {format(selected, "d 'de' MMMM", { locale: ptBR })}
          </span>
        </p>
      </div>

      {/* Agenda timeline */}
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={gridRef}
          className="h-full overflow-y-auto"
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
              {dayEvents.map((ev) => {
                const isGhost = ghost?.id === ev.id;
                const s = isGhost ? ghost!.start : ev.start;
                const e = isGhost ? ghost!.end : ev.end;
                const top = (s / 60) * HOUR_HEIGHT;
                const height = Math.max(
                  26,
                  ((e - s) / 60) * HOUR_HEIGHT - 2,
                );
                const c = CATEGORY_STYLES[ev.category];
                return (
                  <div
                    key={ev.id}
                    data-event-block
                    onPointerDown={(pe) => onBlockPointerDown(pe, ev)}
                    onClick={(ce) => {
                      ce.stopPropagation();
                      if (!movedRef.current) openEdit(ev);
                    }}
                    className={[
                      "absolute left-1 right-0 flex cursor-grab touch-none select-none overflow-hidden rounded-md py-1 pl-2 pr-2 text-xs transition active:cursor-grabbing",
                      isGhost ? "z-10 ring-2 ring-primary/50" : "",
                    ].join(" ")}
                    style={{
                      top,
                      height,
                      background: c.bg,
                      borderLeft: `3px solid ${c.color}`,
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className="truncate text-[13px] font-semibold leading-tight"
                        style={{ color: c.text }}
                      >
                        {ev.title}
                      </p>
                      <p
                        className="truncate text-[11px] tabular-nums leading-tight"
                        style={{ color: c.text, opacity: 0.8 }}
                      >
                        {minutesToLabel(s)} – {minutesToLabel(e)}
                      </p>
                    </div>
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
      </div>

      {/* Bottom bar — Apple-like */}
      <nav className="flex items-center justify-between border-t border-border bg-secondary/60 px-6 py-2 text-primary">
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
          onClick={() => openCreate(9 * 60)}
          className="text-[15px] font-semibold"
        >
          Caixa de entrada
        </button>
      </nav>

      {/* Dialog */}
      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              {dialog?.mode === "edit" ? "Editar evento" : "Novo evento"}
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
            <div className="space-y-2">
              <Label>Calendário</Label>
              <Select
                value={draft.category}
                onValueChange={(v) =>
                  setDraft((d) => ({ ...d, category: v as Category }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CATEGORY_STYLES) as Category[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ background: CATEGORY_STYLES[k].color }}
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
    </main>
  );
}
