import { Link } from "@tanstack/react-router";
import { Home, Calendar, Map, User } from "lucide-react";

const items = [
  { to: "/", label: "Home", Icon: Home },
  { to: "/calendar", label: "Calendário", Icon: Calendar },
  { to: "/map", label: "Mapa", Icon: Map },
  { to: "/profile", label: "Perfil", Icon: User },
] as const;

export function BottomNav() {
  return (
    <nav
      className="glass-strong fixed inset-x-0 bottom-0 z-50"
      style={{ paddingBottom: "env(safe-area-inset-bottom)", borderTop: "1px solid var(--glass-border)" }}
      aria-label="Navegação principal"
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around px-2 py-1.5">
        {items.map(({ to, label, Icon }) => (
          <li key={to} className="flex-1">
            <Link
              to={to}
              activeOptions={{ exact: true }}
              className="flex flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors"
              activeProps={{ className: "text-primary bg-white/25 dark:bg-white/10" }}
            >
              <Icon className="h-6 w-6" strokeWidth={2} />
              <span>{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Spacer to keep page content above the fixed BottomNav. */
export function BottomNavSpacer() {
  return (
    <div
      aria-hidden
      style={{ height: "calc(64px + env(safe-area-inset-bottom))" }}
    />
  );
}
