import { useEffect, useState } from "react";
import { X, Download, Share } from "lucide-react";

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "brio.installPromptDismissedAt";
const DISMISS_DAYS = 7;

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // @ts-expect-error iOS Safari
    window.navigator.standalone === true
  );
}

function isIOS(): boolean {
  if (typeof window === "undefined") return false;
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent) &&
    // @ts-expect-error MSStream
    !window.MSStream;
}

function recentlyDismissed(): boolean {
  try {
    const v = localStorage.getItem(DISMISS_KEY);
    if (!v) return false;
    const days = (Date.now() - Number(v)) / (1000 * 60 * 60 * 24);
    return days < DISMISS_DAYS;
  } catch {
    return false;
  }
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [show, setShow] = useState(false);
  const [showIOS, setShowIOS] = useState(false);

  useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return;

    const onBIP = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onBIP);

    if (isIOS()) {
      const t = setTimeout(() => setShowIOS(true), 2500);
      return () => {
        clearTimeout(t);
        window.removeEventListener("beforeinstallprompt", onBIP);
      };
    }

    return () => window.removeEventListener("beforeinstallprompt", onBIP);
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {}
    setShow(false);
    setShowIOS(false);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    setShow(false);
  };

  if (!show && !showIOS) return null;

  return (
    <div
      className="fixed left-1/2 z-50 w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 rounded-2xl border border-border bg-card p-4 shadow-2xl"
      style={{
        bottom: `calc(72px + env(safe-area-inset-bottom) + 0.75rem)`,
      }}
    >
      <button
        aria-label="Fechar"
        onClick={dismiss}
        className="absolute right-2 top-2 rounded-full p-1.5 text-muted-foreground hover:bg-accent"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <img
          src="/icon-192.png"
          alt=""
          width={44}
          height={44}
          className="h-11 w-11 rounded-xl"
        />
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">Instale o Brio</p>
          {show ? (
            <>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Acesso rápido na tela inicial, com experiência de app nativo.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={install}
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground"
                >
                  <Download className="h-3.5 w-3.5" />
                  Instalar
                </button>
                <button
                  onClick={dismiss}
                  className="rounded-full px-3 py-1.5 text-xs text-muted-foreground"
                >
                  Agora não
                </button>
              </div>
            </>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Toque em <Share className="inline h-3.5 w-3.5 align-text-bottom" />{" "}
              <span className="font-medium">Compartilhar</span> e depois em{" "}
              <span className="font-medium">"Adicionar à Tela de Início"</span>.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
