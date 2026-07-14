import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BottomNav, BottomNavSpacer } from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { connectAppUser } from "@/integrations/lovable/appUserConnectorClient";
import {
  startGoogleCalendarConnect,
  saveGoogleCalendarConnection,
  disconnectGoogleCalendar,
  getGoogleCalendarStatus,
  pullGoogleCalendar,
} from "@/lib/googleConnect.functions";
import { syncAllPending } from "@/lib/events.functions";
import { toast } from "sonner";
import { CheckCircle2, LogOut, RefreshCw, XCircle, Loader2, AlertTriangle } from "lucide-react";

const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Perfil | Brio" },
      { name: "description", content: "Sua conta e integrações do Brio." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const getStatus = useServerFn(getGoogleCalendarStatus);
  const startConnect = useServerFn(startGoogleCalendarConnect);
  const saveConnection = useServerFn(saveGoogleCalendarConnection);
  const disconnect = useServerFn(disconnectGoogleCalendar);
  const syncPending = useServerFn(syncAllPending);
  const pullFromGoogle = useServerFn(pullGoogleCalendar);
  const [email, setEmail] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const statusQuery = useQuery({
    queryKey: ["gcal-status"],
    queryFn: () => getStatus(),
  });

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
      setName(
        (data.user?.user_metadata?.full_name as string | undefined) ??
          (data.user?.user_metadata?.name as string | undefined) ??
          data.user?.email?.split("@")[0] ??
          null,
      );
    });
  }, []);

  async function handleConnect() {
    setConnecting(true);
    try {
      const result = await connectAppUser({
        connectorId: "google_calendar",
        gatewayBaseUrl: GATEWAY_BASE_URL,
        start: (targetOrigin) => startConnect({ data: { targetOrigin } }),
      });
      if (!result.success) {
        toast.error("Falha ao conectar Google Calendar", { description: result.error });
        return;
      }
      if (!result.connectionAPIKey) {
        toast.warning("Conta conectada, mas sem acesso offline. Sincronização não estará disponível.");
        return;
      }
      await saveConnection({ data: { connectionAPIKey: result.connectionAPIKey } });
      toast.success("Google Calendar conectado");
      queryClient.invalidateQueries({ queryKey: ["gcal-status"] });
      // Sync any pending local events
      await syncPending();
      queryClient.invalidateQueries({ queryKey: ["events"] });
    } catch (e) {
      toast.error("Erro ao conectar", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    try {
      await disconnect();
      queryClient.invalidateQueries({ queryKey: ["gcal-status"] });
      toast.success("Google Calendar desconectado");
    } catch (e) {
      toast.error("Erro ao desconectar", { description: e instanceof Error ? e.message : String(e) });
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const r = await syncPending();
      queryClient.invalidateQueries({ queryKey: ["events"] });
      toast.success(`Sincronização concluída`, {
        description: `${r.processed} evento(s) processado(s).`,
      });
    } catch (e) {
      toast.error("Erro na sincronização", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSyncing(false);
    }
  }

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const connected = statusQuery.data?.connected ?? false;
  const clientConfigured = statusQuery.data?.clientConfigured ?? false;

  return (
    <main
      className="flex min-h-screen flex-col bg-background text-foreground"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <header className="px-5 pb-3 pt-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Perfil</h1>
        <p className="mt-1 text-sm text-muted-foreground">Conta e integrações.</p>
      </header>
      <section className="flex-1 space-y-6 px-5 pb-6">
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Conta
          </div>
          <div className="mt-2 font-medium">{name ?? "—"}</div>
          <div className="text-sm text-muted-foreground">{email ?? "—"}</div>
          <Button
            variant="outline"
            className="mt-4 w-full"
            onClick={handleSignOut}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sair
          </Button>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Integração
              </div>
              <div className="mt-1 flex items-center gap-2 font-medium">
                <GoogleIcon className="h-4 w-4" />
                Google Calendar
              </div>
            </div>
            <StatusBadge
              loading={statusQuery.isLoading}
              connected={connected}
              clientConfigured={clientConfigured}
            />
          </div>

          {!clientConfigured && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                O cliente OAuth do Google Calendar ainda não foi configurado no workspace.
                Um administrador precisa aprovar o App User Connector para habilitar a sincronização.
              </div>
            </div>
          )}

          <p className="mt-3 text-xs text-muted-foreground">
            Ao conectar, seus eventos serão criados, atualizados e removidos no seu Google Calendar
            automaticamente.
          </p>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            {connected ? (
              <>
                <Button className="flex-1" onClick={handleSync} disabled={syncing}>
                  {syncing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Sincronizar agora
                </Button>
                <Button variant="outline" onClick={handleDisconnect}>
                  Desconectar
                </Button>
              </>
            ) : (
              <Button
                className="flex-1"
                onClick={handleConnect}
                disabled={connecting || !clientConfigured}
              >
                {connecting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <GoogleIcon className="mr-2 h-4 w-4" />
                )}
                Conectar Google Calendar
              </Button>
            )}
          </div>
        </div>
      </section>
      <BottomNavSpacer />
      <BottomNav />
    </main>
  );
}

function StatusBadge({
  loading,
  connected,
  clientConfigured,
}: {
  loading: boolean;
  connected: boolean;
  clientConfigured: boolean;
}) {
  if (loading)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        …
      </span>
    );
  if (!clientConfigured)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-800 dark:text-amber-200">
        <AlertTriangle className="h-3 w-3" /> Setup pendente
      </span>
    );
  if (connected)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-800 dark:text-emerald-200">
        <CheckCircle2 className="h-3 w-3" /> Conectado
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      <XCircle className="h-3 w-3" /> Não conectado
    </span>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.9 3.5 14.7 2.5 12 2.5 6.8 2.5 2.7 6.7 2.7 12s4.1 9.5 9.3 9.5c5.4 0 8.9-3.8 8.9-9.1 0-.6-.1-1-.2-1.5H12z" />
    </svg>
  );
}
