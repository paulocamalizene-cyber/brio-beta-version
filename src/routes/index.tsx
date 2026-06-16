import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, format, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
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
const HOUR_HEIGHT = 64;
const DAY_MINUTES = 24 * 60;

const CATEGORY_STYLES: Record<
  Category,
  { label: string; bar: string; bg: string; text: string }
> = {
  work: {
    label: "Trabalho",
    bar: "bg-[oklch(0.72_0.12_25)]",
    bg: "bg-[oklch(0.72_0.12_25/0.18)]",
    text: "text-[oklch(0.88_0.08_25)]",
  },
  personal: {
    label: "Pessoal",
    bar: "bg-[oklch(0.78_0.12_85)]",
    bg: "bg-[oklch(0.78_0.12_85/0.18)]",
    text: "text-[oklch(0.9_0.08_85)]",
  },
  study: {
    label: "Estudo",
    bar: "bg-[oklch(0.7_0.13_290)]",
    bg: "bg-[oklch(0.7_0.13_290/0.2)]",
    text: "text-[oklch(0.88_0.09_290)]",
  },
  health: {
    label: "Saúde",
    bar: "bg-[oklch(0.75_0.13_160)]",
    bg: "bg-[oklch(0.75_0.13_160/0.18)]",
    text: "text-[oklch(0.88_0.09_160)]",
  },
  social: {
    label: "Social",
    bar: "bg-[oklch(0.74_0.13_220)]",
    bg: "bg-[oklch(0.74_0.13_220/0.18)]",
    text: "text-[oklch(0.88_0.09_220)]",
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
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSelected((d) => addDays(d, -1))}
            aria-label="Dia anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <button
            onClick={() => setSelected(new Date())}
            className="font-display text-lg capitalize tracking-tight"
          >
            {format(selected, "d 'de' MMMM", { locale: ptBR })}
          </button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSelected((d) => addDays(d, 1))}
            aria-label="Próximo dia"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSelected(new Date())}
        >
          Hoje
        </Button>
      </header>

      {/* Day strip */}
      <div className="flex gap-1 overflow-x-auto border-b border-border/60 px-2 py-2">
        {stripDays.map((d) => {
          const isSel = isSameDay(d, selected);
          const today = isSameDay(d, now);
          return (
            <button
              key={d.toISOString()}
              onClick={() => setSelected(d)}
              className={[
                "flex min-w-[56px] flex-1 flex-col items-center rounded-xl px-2 py-2 text-xs transition",
                isSel
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-secondary",
              ].join(" ")}
            >
              <span
                className={[
                  "uppercase tracking-widest",
                  isSel ? "" : "text-muted-foreground",
                ].join(" ")}
              >
                {format(d, "EEE", { locale: ptBR }).slice(0, 3)}
              </span>
              <span
                className={[
                  "font-display text-xl leading-none",
                  today && !isSel ? "text-accent" : "",
                ].join(" ")}
              >
                {format(d, "d")}
              </span>
            </button>
          );
        })}
      </div>

      {/* Agenda */}
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
            {/* Hour rows */}
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="absolute left-0 right-0 border-t border-border/50"
                style={{ top: h * HOUR_HEIGHT, height: HOUR_HEIGHT }}
              >
                <div className="absolute -top-2 left-0 w-14 pr-2 text-right text-[11px] tabular-nums text-muted-foreground">
                  {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
                </div>
              </div>
            ))}

            {/* Now line */}
            {showNowLine && (
              <div
                className="pointer-events-none absolute left-14 right-3 z-20 flex items-center"
                style={{ top: (nowMin / 60) * HOUR_HEIGHT }}
              >
                <span className="-ml-1.5 h-3 w-3 rounded-full bg-accent" />
                <span className="h-px flex-1 bg-accent" />
              </div>
            )}

            {/* Events */}
            <div className="absolute inset-y-0 left-14 right-3">
              {dayEvents.map((ev) => {
                const isGhost = ghost?.id === ev.id;
                const s = isGhost ? ghost!.start : ev.start;
                const e = isGhost ? ghost!.end : ev.end;
                const top = (s / 60) * HOUR_HEIGHT;
                const height = Math.max(28, ((e - s) / 60) * HOUR_HEIGHT - 2);
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
                      "absolute left-0 right-0 flex cursor-grab touch-none select-none overflow-hidden rounded-xl py-1.5 pl-2 pr-2 text-xs shadow-sm transition active:cursor-grabbing",
                      c.bg,
                      isGhost ? "z-10 ring-2 ring-accent/60" : "",
                    ].join(" ")}
                    style={{ top, height }}
                  >
                    <span className={`mr-2 w-1 shrink-0 rounded-full ${c.bar}`} />
                    <div className="min-w-0 flex-1">
                      <p className={`truncate font-medium ${c.text}`}>
                        {ev.title}
                      </p>
                      <p className="truncate text-[11px] tabular-nums text-muted-foreground">
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

        {/* FAB */}
        <Button
          size="icon"
          onClick={() => openCreate(9 * 60)}
          className="absolute bottom-5 right-5 h-14 w-14 rounded-full shadow-lg"
          aria-label="Novo evento"
        >
          <Plus className="h-6 w-6" />
        </Button>
      </div>

      {/* Dialog */}
      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              {dialog?.mode === "edit" ? "Editar evento" : "Novo evento"}{" "}
              <span className="text-muted-foreground">
                · {format(selected, "d MMM", { locale: ptBR })}
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="title">Título</Label>
              <Input
                id="title"
                autoFocus
                placeholder="Ex.: Reunião com a equipe"
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
              <Label>Categoria</Label>
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
                      {CATEGORY_STYLES[k].label}
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
