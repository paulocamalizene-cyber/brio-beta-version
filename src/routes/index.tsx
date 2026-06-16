import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  addMonths,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  addDays,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus, Trash2, CalendarDays } from "lucide-react";
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
      { title: "Calendário — Organização pessoal" },
      {
        name: "description",
        content:
          "Um calendário simples e minimalista para organizar seus eventos pessoais com foco e clareza.",
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
  end: number; // minutes from 00:00
  category: Category;
};

const STORAGE_KEY = "calendar.events.v2";
const HOUR_HEIGHT = 60; // px per hour
const DAY_MINUTES = 24 * 60;

const CATEGORY_STYLES: Record<
  Category,
  { label: string; bar: string; bg: string; text: string }
> = {
  work: {
    label: "Trabalho",
    bar: "bg-[oklch(0.72_0.12_25)]",
    bg: "bg-[oklch(0.72_0.12_25/0.18)]",
    text: "text-[oklch(0.85_0.08_25)]",
  },
  personal: {
    label: "Pessoal",
    bar: "bg-[oklch(0.78_0.12_85)]",
    bg: "bg-[oklch(0.78_0.12_85/0.18)]",
    text: "text-[oklch(0.88_0.08_85)]",
  },
  study: {
    label: "Estudo",
    bar: "bg-[oklch(0.7_0.13_290)]",
    bg: "bg-[oklch(0.7_0.13_290/0.2)]",
    text: "text-[oklch(0.85_0.09_290)]",
  },
  health: {
    label: "Saúde",
    bar: "bg-[oklch(0.75_0.13_160)]",
    bg: "bg-[oklch(0.75_0.13_160/0.18)]",
    text: "text-[oklch(0.86_0.09_160)]",
  },
  social: {
    label: "Social",
    bar: "bg-[oklch(0.74_0.13_220)]",
    bg: "bg-[oklch(0.74_0.13_220/0.18)]",
    text: "text-[oklch(0.86_0.09_220)]",
  },
};

function minutesToLabel(m: number) {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function snap(min: number, step = 15) {
  return Math.max(0, Math.min(DAY_MINUTES, Math.round(min / step) * step));
}

function CalendarApp() {
  const [cursor, setCursor] = useState<Date>(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<Date>(new Date());
  const [events, setEvents] = useState<Event[]>([]);
  const [dialog, setDialog] = useState<
    | { mode: "create"; start: number; end: number }
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

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 });
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [cursor]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, Event[]>();
    for (const e of events) {
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    return map;
  }, [events]);

  const selectedKey = format(selected, "yyyy-MM-dd");
  const dayEvents = (eventsByDate.get(selectedKey) ?? []).sort(
    (a, b) => a.start - b.start,
  );

  const weekdays = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

  function openCreate(startMin: number) {
    const s = snap(startMin);
    const e = Math.min(DAY_MINUTES, s + 60);
    setDraft({
      title: "",
      start: minutesToLabel(s),
      end: minutesToLabel(e),
      category: "personal",
    });
    setDialog({ mode: "create", start: s, end: e });
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

  function parseHM(s: string) {
    const [h, m] = s.split(":").map((n) => parseInt(n, 10));
    return (h || 0) * 60 + (m || 0);
  }

  function saveDraft() {
    if (!draft.title.trim() || !dialog) return;
    let s = parseHM(draft.start);
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

  // Drag handling
  const gridRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    id: string;
    grabOffset: number;
    duration: number;
  } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ id: string; start: number } | null>(
    null,
  );

  function onPointerDownEvent(
    e: React.PointerEvent<HTMLDivElement>,
    ev: Event,
  ) {
    e.stopPropagation();
    const grid = gridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const min = (y / HOUR_HEIGHT) * 60;
    dragRef.current = {
      id: ev.id,
      grabOffset: min - ev.start,
      duration: ev.end - ev.start,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMoveEvent(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current || !gridRef.current) return;
    const rect = gridRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const min = (y / HOUR_HEIGHT) * 60;
    const newStart = snap(min - dragRef.current.grabOffset);
    setDragPreview({ id: dragRef.current.id, start: newStart });
  }

  function onPointerUpEvent(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    const moved = dragPreview && dragPreview.id === d.id;
    if (moved) {
      const newStart = Math.max(
        0,
        Math.min(DAY_MINUTES - d.duration, dragPreview!.start),
      );
      setEvents((prev) =>
        prev.map((ev) =>
          ev.id === d.id
            ? { ...ev, start: newStart, end: newStart + d.duration }
            : ev,
        ),
      );
    }
    dragRef.current = null;
    setDragPreview(null);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  }

  function onGridClick(e: React.MouseEvent<HTMLDivElement>) {
    if (dragRef.current) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-event-block]")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const min = (y / HOUR_HEIGHT) * 60;
    openCreate(min);
  }

  const showNowLine = isSameDay(selected, now);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  return (
    <main className="min-h-screen bg-background px-4 py-8 md:py-12">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-2xl tracking-tight">Agenda</h1>
              <p className="truncate text-xs text-muted-foreground">
                Sua organização pessoal, sem ruído.
              </p>
            </div>
          </div>
          <p className="hidden text-sm text-muted-foreground md:block">
            {format(now, "EEEE, d 'de' MMMM", { locale: ptBR })}
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          {/* Calendar */}
          <section className="rounded-2xl border bg-card p-5 md:p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-display text-xl capitalize md:text-2xl">
                {format(cursor, "MMMM yyyy", { locale: ptBR })}
              </h2>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const n = new Date();
                    setCursor(startOfMonth(n));
                    setSelected(n);
                  }}
                >
                  Hoje
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCursor((c) => addMonths(c, -1))}
                  aria-label="Mês anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCursor((c) => addMonths(c, 1))}
                  aria-label="Próximo mês"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[11px] uppercase tracking-widest text-muted-foreground">
              {weekdays.map((d) => (
                <div key={d} className="py-2">
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {days.map((day) => {
                const inMonth = isSameMonth(day, cursor);
                const isSel = isSameDay(day, selected);
                const today = isToday(day);
                const key = format(day, "yyyy-MM-dd");
                const count = eventsByDate.get(key)?.length ?? 0;
                return (
                  <button
                    key={key}
                    onClick={() => setSelected(day)}
                    className={[
                      "group relative flex aspect-square flex-col items-center justify-center rounded-lg text-sm transition",
                      inMonth ? "text-foreground" : "text-muted-foreground/40",
                      isSel
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-secondary",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "font-display text-lg leading-none",
                        today && !isSel ? "text-accent" : "",
                      ].join(" ")}
                    >
                      {format(day, "d")}
                    </span>
                    {count > 0 && (
                      <span
                        className={[
                          "absolute bottom-1.5 h-1 w-1 rounded-full",
                          isSel ? "bg-primary-foreground" : "bg-accent",
                        ].join(" ")}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Day timeline */}
          <section className="relative rounded-2xl border bg-card p-5 md:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  {format(selected, "EEEE", { locale: ptBR })}
                </p>
                <h3 className="font-display text-2xl tracking-tight md:text-3xl">
                  {format(selected, "d 'de' MMMM", { locale: ptBR })}
                </h3>
              </div>
              <p className="text-xs text-muted-foreground">
                {dayEvents.length} {dayEvents.length === 1 ? "evento" : "eventos"}
              </p>
            </div>

            <div className="relative max-h-[70vh] overflow-y-auto rounded-xl border bg-background/40">
              <div
                ref={gridRef}
                onClick={onGridClick}
                className="relative"
                style={{ height: 24 * HOUR_HEIGHT }}
              >
                {/* Hour rows */}
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 flex border-t border-border/60"
                    style={{ top: h * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                  >
                    <div className="w-14 shrink-0 pt-1 text-right pr-2 text-[11px] tabular-nums text-muted-foreground">
                      {String(h).padStart(2, "0")}:00
                    </div>
                    <div className="flex-1" />
                  </div>
                ))}

                {/* Now line */}
                {showNowLine && (
                  <div
                    className="pointer-events-none absolute left-14 right-2 z-20 flex items-center"
                    style={{ top: (nowMin / 60) * HOUR_HEIGHT }}
                  >
                    <span className="-ml-1.5 h-3 w-3 rounded-full bg-accent shadow-[0_0_0_3px_oklch(from_var(--accent)_l_c_h/0.25)]" />
                    <span className="h-px flex-1 bg-accent" />
                  </div>
                )}

                {/* Events */}
                <div className="absolute inset-y-0 left-14 right-2">
                  {dayEvents.map((ev) => {
                    const isDragging = dragPreview?.id === ev.id;
                    const startMin = isDragging ? dragPreview!.start : ev.start;
                    const dur = ev.end - ev.start;
                    const top = (startMin / 60) * HOUR_HEIGHT;
                    const height = Math.max(22, (dur / 60) * HOUR_HEIGHT - 2);
                    const c = CATEGORY_STYLES[ev.category];
                    return (
                      <div
                        key={ev.id}
                        data-event-block
                        onPointerDown={(e) => onPointerDownEvent(e, ev)}
                        onPointerMove={onPointerMoveEvent}
                        onPointerUp={onPointerUpEvent}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isDragging) openEdit(ev);
                        }}
                        className={[
                          "absolute left-0 right-0 flex cursor-grab touch-none select-none overflow-hidden rounded-lg pl-2 pr-2 py-1.5 text-xs shadow-sm transition active:cursor-grabbing",
                          c.bg,
                          isDragging ? "ring-2 ring-accent/60 z-10" : "",
                        ].join(" ")}
                        style={{ top, height }}
                      >
                        <span
                          className={[
                            "mr-2 w-1 shrink-0 rounded-full",
                            c.bar,
                          ].join(" ")}
                        />
                        <div className="min-w-0 flex-1">
                          <p className={`truncate font-medium ${c.text}`}>
                            {ev.title}
                          </p>
                          <p className="truncate text-[11px] tabular-nums text-muted-foreground">
                            {minutesToLabel(ev.start)} – {minutesToLabel(ev.end)}
                          </p>
                        </div>
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
              className="absolute bottom-5 right-5 h-12 w-12 rounded-full shadow-lg md:bottom-6 md:right-6"
              aria-label="Novo evento"
            >
              <Plus className="h-5 w-5" />
            </Button>
          </section>
        </div>
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
