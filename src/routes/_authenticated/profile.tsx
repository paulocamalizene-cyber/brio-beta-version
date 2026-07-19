import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BottomNav, BottomNavSpacer } from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import {
  User as UserIcon,
  Lock,
  Bell,
  Moon,
  Info,
  HelpCircle,
  Trash2,
  ChevronRight,
  LogOut,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Camera,
  CheckCircle2,
  XCircle,
} from "lucide-react";

const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Definições | Brio" },
      { name: "description", content: "Sua conta, preferências e integrações do Brio." },
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
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

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
      setAvatarUrl(
        (data.user?.user_metadata?.avatar_url as string | undefined) ??
          (data.user?.user_metadata?.picture as string | undefined) ??
          null,
      );
    });
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const isDark = stored === "dark";
    setDarkMode(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);

  function toggleDarkMode(value: boolean) {
    setDarkMode(value);
    document.documentElement.classList.toggle("dark", value);
    localStorage.setItem("theme", value ? "dark" : "light");
  }

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
        toast.warning("Conta conectada, mas sem acesso offline.");
        return;
      }
      await saveConnection({ data: { connectionAPIKey: result.connectionAPIKey } });
      toast.success("Google Calendar conectado");
      queryClient.invalidateQueries({ queryKey: ["gcal-status"] });
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
      const [pushRes, pullRes] = await Promise.all([syncPending(), pullFromGoogle()]);
      queryClient.invalidateQueries({ queryKey: ["events"] });
      const desc = `${pushRes.processed} enviado(s), ${pullRes.imported} importado(s), ${pullRes.updated} atualizado(s), ${pullRes.deleted} removido(s).`;
      if (pullRes.errors.length) {
        toast.warning("Sincronização parcial", { description: `${desc} Erros: ${pullRes.errors[0]}` });
      } else {
        toast.success("Sincronização concluída", { description: desc });
      }
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

  const menuItems: MenuItem[] = [
    {
      id: "profile",
      icon: UserIcon,
      title: "Detalhes do perfil",
      onClick: () => toast.info("Em breve"),
    },
    {
      id: "password",
      icon: Lock,
      title: "Palavra-passe",
      onClick: () => toast.info("Em breve"),
    },
    {
      id: "notifications",
      icon: Bell,
      title: "Notificações",
      isSwitch: true,
      value: notifications,
      onToggle: setNotifications,
    },
    {
      id: "darkmode",
      icon: Moon,
      title: "Modo escuro",
      isSwitch: true,
      value: darkMode,
      onToggle: toggleDarkMode,
    },
    {
      id: "about",
      icon: Info,
      title: "Sobre a aplicação",
      onClick: () => toast.info("Brio · v1.0.0"),
    },
    {
      id: "help",
      icon: HelpCircle,
      title: "Ajuda / FAQ",
      onClick: () => toast.info("Em breve"),
    },
    {
      id: "deactivate",
      icon: Trash2,
      title: "Desativar conta",
      danger: true,
      onClick: () => toast.error("Contate o suporte para desativar a conta."),
    },
  ];

  const initials =
    (name ?? email ?? "?")
      .split(" ")
      .map((s) => s[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  return (
    <main
      className="flex min-h-screen flex-col bg-background text-foreground"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <header className="px-5 pb-3 pt-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Definições</h1>
      </header>

      <section className="flex-1 space-y-6 px-5 pb-6">
        {/* Avatar / user */}
        <div className="flex flex-col items-center pt-2">
          <div className="relative">
            <Avatar className="h-20 w-20 ring-2 ring-white/40 dark:ring-white/10">
              {avatarUrl && <AvatarImage src={avatarUrl} alt={name ?? "avatar"} />}
              <AvatarFallback className="text-lg font-semibold">{initials}</AvatarFallback>
            </Avatar>
            <button
              type="button"
              onClick={() => toast.info("Em breve")}
              className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md ring-2 ring-background"
              aria-label="Alterar avatar"
            >
              <Camera className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-3 text-lg font-semibold">{name ?? "—"}</div>
          <div className="text-sm text-muted-foreground">{email ?? "—"}</div>
        </div>

        {/* Other settings */}
        <div>
          <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Outras definições
          </div>
          <ul className="glass overflow-hidden rounded-2xl">
            {menuItems.map((item, i) => {
              const Icon = item.icon;
              const isLast = i === menuItems.length - 1;
              const content = (
                <div className="flex w-full items-center justify-between px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <Icon
                      className={`h-5 w-5 ${item.danger ? "text-destructive" : "text-foreground/80"}`}
                      strokeWidth={2}
                    />
                    <span
                      className={`text-[15px] ${item.danger ? "text-destructive" : "text-foreground"}`}
                    >
                      {item.title}
                    </span>
                  </div>
                  {item.isSwitch ? (
                    <Switch checked={item.value} onCheckedChange={item.onToggle} />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              );
              return (
                <li
                  key={item.id}
                  className={!isLast ? "border-b border-white/20 dark:border-white/10" : ""}
                >
                  {item.isSwitch ? (
                    content
                  ) : (
                    <button
                      type="button"
                      onClick={item.onClick}
                      className="w-full text-left transition active:bg-white/20 dark:active:bg-white/5"
                    >
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Integrations */}
        <div>
          <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Integrações
          </div>
          <div className="glass rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-medium">
                <GoogleIcon className="h-4 w-4" />
                Google Calendar
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
                  O cliente OAuth do Google Calendar ainda não foi configurado. Um administrador
                  precisa aprovar para habilitar a sincronização.
                </div>
              </div>
            )}

            <p className="mt-3 text-xs text-muted-foreground">
              Ao conectar, os seus eventos são criados, atualizados e removidos no Google Calendar
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
        </div>

        {/* Sign out */}
        <Button variant="outline" className="w-full" onClick={handleSignOut}>
          <LogOut className="mr-2 h-4 w-4" />
          Sair
        </Button>

        <p className="pt-2 text-center text-xs text-muted-foreground">Versão 1.0.0</p>
      </section>

      <BottomNavSpacer />
      <BottomNav />
    </main>
  );
}

type MenuItem = {
  id: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  danger?: boolean;
} & (
  | { isSwitch: true; value: boolean; onToggle: (v: boolean) => void; onClick?: undefined }
  | { isSwitch?: false; onClick: () => void; value?: undefined; onToggle?: undefined }
);

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
        <Loader2 className="h-3 w-3 animate-spin" />…
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
