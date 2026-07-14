import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { z } from "zod";

const search = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar | Brio" },
      { name: "description", content: "Acesse sua conta Brio para sincronizar seu calendário." },
    ],
  }),
  validateSearch: search,
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { redirect } = useSearch({ from: "/auth" });
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        navigate({ to: safeRedirect(redirect) as string, replace: true });
      } else {
        setChecked(true);
      }
    });
  }, [navigate, redirect]);

  async function onGoogle() {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + "/auth",
    });
    if (result.error) {
      toast.error("Falha ao entrar com Google", { description: String(result.error.message ?? result.error) });
      setLoading(false);
      return;
    }
    if (result.redirected) return;
    navigate({ to: safeRedirect(redirect) as string, replace: true });
  }

  async function onEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin + "/auth",
            data: { full_name: name },
          },
        });
        if (error) throw error;
        toast.success("Conta criada", { description: "Confirme seu e-mail para entrar." });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: safeRedirect(redirect) as string, replace: true });
      }
    } catch (err) {
      toast.error(mode === "signup" ? "Falha no cadastro" : "Falha ao entrar", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <h1 className="font-display text-3xl font-semibold tracking-tight">Brio</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "signin" ? "Entre para acessar seu calendário." : "Crie sua conta para começar."}
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          className="mt-8 w-full"
          onClick={onGoogle}
          disabled={loading}
        >
          <GoogleIcon className="mr-2 h-4 w-4" />
          Continuar com Google
        </Button>

        <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          ou
          <div className="h-px flex-1 bg-border" />
        </div>

        <form className="space-y-3" onSubmit={onEmail}>
          {mode === "signup" && (
            <div className="space-y-1.5">
              <Label htmlFor="name">Nome</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === "signin" ? "Entrar" : "Criar conta"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {mode === "signin" ? (
            <>
              Não tem conta?{" "}
              <button className="font-medium text-foreground underline" onClick={() => setMode("signup")}>
                Cadastrar
              </button>
            </>
          ) : (
            <>
              Já tem conta?{" "}
              <button className="font-medium text-foreground underline" onClick={() => setMode("signin")}>
                Entrar
              </button>
            </>
          )}
        </p>

        <div className="mt-8 text-center">
          <Link to="/" className="text-xs text-muted-foreground underline">
            Voltar
          </Link>
        </div>
      </div>
    </main>
  );
}

function safeRedirect(value: string | undefined): string {
  if (!value) return "/calendar";
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return "/calendar";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/calendar";
  }
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.9 3.5 14.7 2.5 12 2.5 6.8 2.5 2.7 6.7 2.7 12s4.1 9.5 9.3 9.5c5.4 0 8.9-3.8 8.9-9.1 0-.6-.1-1-.2-1.5H12z"/>
    </svg>
  );
}
