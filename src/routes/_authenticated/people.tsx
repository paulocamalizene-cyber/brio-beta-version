import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav, BottomNavSpacer } from "@/components/BottomNav";
import { Search, Plus, X, Calendar as CalendarIcon, Users, Loader2, Mail, Phone, Building2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/people")({
  head: () => ({
    meta: [
      { title: "Contactos" },
      { name: "description", content: "Os teus contactos para agendar reuniões." },
    ],
  }),
  component: PeoplePage,
});

interface Contact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  avatar_url: string | null;
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() ?? "")
    .join("");
}

function PeoplePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "" });

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ["contacts"],
    queryFn: async (): Promise<Contact[]> => {
      const { data, error } = await supabase
        .from("contacts")
        .select("id, name, email, phone, company, avatar_url")
        .order("name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const addMutation = useMutation({
    mutationFn: async (payload: typeof form) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Sem sessão");
      const { error } = await supabase.from("contacts").insert({
        user_id: userId,
        name: payload.name.trim(),
        email: payload.email.trim() || null,
        phone: payload.phone.trim() || null,
        company: payload.company.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      setModalOpen(false);
      setForm({ name: "", email: "", phone: "", company: "" });
      toast.success("Contacto adicionado");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao adicionar"),
  });

  const q = search.toLowerCase();
  const filtered = contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      (c.email?.toLowerCase().includes(q) ?? false) ||
      (c.company?.toLowerCase().includes(q) ?? false),
  );

  const scheduleWith = (c: Contact) => {
    try {
      sessionStorage.setItem(
        "calendar.prefill",
        JSON.stringify({
          title: `Reunião com ${c.name}`,
          notes: [c.email, c.phone].filter(Boolean).join(" · "),
          location: c.company ?? "",
        }),
      );
    } catch {}
    navigate({ to: "/calendar" });
  };


  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    addMutation.mutate(form);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto max-w-md px-4 pt-6 pb-3">
        <h1 className="text-2xl font-semibold tracking-tight">Contactos</h1>
        <p className="text-sm text-muted-foreground">Toca num contacto para agendar.</p>
      </header>

      <div className="mx-auto max-w-md px-4">
        <div className="glass flex items-center gap-2 rounded-2xl px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Procurar contactos…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {search && (
            <button onClick={() => setSearch("")} aria-label="Limpar">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      <main className="mx-auto mt-4 max-w-md px-4 pb-8">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="glass rounded-2xl px-6 py-14 text-center">
            <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="font-medium">Nenhum contacto</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Adiciona pessoas para agendar reuniões rapidamente.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => scheduleWith(c)}
                  className="glass flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors hover:bg-white/30 dark:hover:bg-white/10"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-sm font-semibold text-primary">
                    {c.avatar_url ? (
                      <img src={c.avatar_url} alt={c.name} className="h-full w-full object-cover" />
                    ) : (
                      initials(c.name) || "?"
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.name}</p>
                    {c.email && (
                      <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        <Mail className="h-3 w-3" /> {c.email}
                      </p>
                    )}
                    {c.phone && (
                      <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        <Phone className="h-3 w-3" /> {c.phone}
                      </p>
                    )}
                    {c.company && (
                      <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        <Building2 className="h-3 w-3" /> {c.company}
                      </p>
                    )}
                  </div>
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary"
                    aria-label="Agendar"
                  >
                    <CalendarIcon className="h-4 w-4" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      <button
        onClick={() => setModalOpen(true)}
        className="fixed right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95"
        style={{ bottom: "calc(80px + env(safe-area-inset-bottom))" }}
        aria-label="Adicionar contacto"
      >
        <Plus className="h-6 w-6" />
      </button>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-t-3xl bg-background p-6 sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Novo contacto</h2>
              <button onClick={() => setModalOpen(false)} aria-label="Fechar">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
                placeholder="Nome *"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus
              />
              <input
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
                placeholder="E-mail"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
              <input
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
                placeholder="Telefone"
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
              <input
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
                placeholder="Empresa"
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
              />
              <button
                type="submit"
                disabled={addMutation.isPending}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {addMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Adicionar contacto
              </button>
            </form>
          </div>
        </div>
      )}

      <BottomNavSpacer />
      <BottomNav />
    </div>
  );
}
