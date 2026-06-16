import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  addMonths,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  addDays,
  parseISO,
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

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

type Event = {
  id: string;
  date: string; // yyyy-MM-dd
  title: string;
  time?: string;
};

const STORAGE_KEY = "calendar.events.v1";

function CalendarApp() {
  const [cursor, setCursor] = useState<Date>(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<Date>(new Date());
  const [events, setEvents] = useState<Event[]>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ title: "", time: "" });

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
  const selectedEvents = (eventsByDate.get(selectedKey) ?? []).sort((a, b) =>
    (a.time ?? "").localeCompare(b.time ?? ""),
  );

  const weekdays = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

  function addEvent() {
    if (!draft.title.trim()) return;
    setEvents((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        date: selectedKey,
        title: draft.title.trim(),
        time: draft.time || undefined,
      },
    ]);
    setDraft({ title: "", time: "" });
    setOpen(false);
  }

  function removeEvent(id: string) {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }

  return (
    <main className="min-h-screen bg-background px-4 py-10 md:py-16">
      <div className="mx-auto max-w-5xl">
        <header className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-display text-2xl tracking-tight">Agenda</h1>
              <p className="text-xs text-muted-foreground">Sua organização pessoal, sem ruído.</p>
            </div>
          </div>
          <p className="hidden text-sm text-muted-foreground md:block">
            {format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR })}
          </p>
        </header>

        <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
          {/* Calendar */}
          <section className="rounded-2xl border bg-card p-5 md:p-7">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="font-display text-2xl capitalize">
                {format(cursor, "MMMM yyyy", { locale: ptBR })}
              </h2>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const now = new Date();
                    setCursor(startOfMonth(now));
                    setSelected(now);
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

          {/* Day panel */}
          <section className="rounded-2xl border bg-card p-5 md:p-7">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  {format(selected, "EEEE", { locale: ptBR })}
                </p>
                <h3 className="font-display text-3xl tracking-tight">
                  {format(selected, "d 'de' MMMM", { locale: ptBR })}
                </h3>
              </div>
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1.5">
                    <Plus className="h-4 w-4" /> Novo
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle className="font-display text-xl">
                      Novo evento ·{" "}
                      <span className="text-muted-foreground">
                        {format(selected, "d MMM", { locale: ptBR })}
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
                        onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                        onKeyDown={(e) => e.key === "Enter" && addEvent()}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="time">Horário (opcional)</Label>
                      <Input
                        id="time"
                        type="time"
                        value={draft.time}
                        onChange={(e) => setDraft((d) => ({ ...d, time: e.target.value }))}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="ghost" onClick={() => setOpen(false)}>
                      Cancelar
                    </Button>
                    <Button onClick={addEvent}>Adicionar</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            {selectedEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-12 text-center">
                <p className="text-sm text-muted-foreground">Nada planejado por aqui.</p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  Clique em “Novo” para adicionar.
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {selectedEvents.map((e) => (
                  <li
                    key={e.id}
                    className="group flex items-center gap-3 rounded-xl border bg-background/50 p-3 transition hover:border-accent/40"
                  >
                    <div className="flex w-14 shrink-0 flex-col items-center">
                      <span className="font-display text-base tabular-nums">
                        {e.time || "—"}
                      </span>
                    </div>
                    <div className="h-8 w-px bg-border" />
                    <div className="flex-1">
                      <p className="text-sm font-medium leading-tight">{e.title}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="opacity-0 transition group-hover:opacity-100"
                      onClick={() => removeEvent(e.id)}
                      aria-label="Remover evento"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {events.length > 0 && (
              <div className="mt-8 border-t pt-4">
                <p className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">
                  Próximos
                </p>
                <ul className="space-y-1.5">
                  {events
                    .filter((e) => parseISO(e.date) >= new Date(new Date().toDateString()))
                    .sort(
                      (a, b) =>
                        a.date.localeCompare(b.date) ||
                        (a.time ?? "").localeCompare(b.time ?? ""),
                    )
                    .slice(0, 4)
                    .map((e) => (
                      <li
                        key={e.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="text-muted-foreground">
                          {format(parseISO(e.date), "d MMM", { locale: ptBR })}
                          {e.time && ` · ${e.time}`}
                        </span>
                        <span className="truncate pl-3 text-right">{e.title}</span>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
