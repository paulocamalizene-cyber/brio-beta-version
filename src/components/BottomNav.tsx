import { Link } from "@tanstack/react-router";
import { Home, Calendar, Users, MapPin, Settings } from "lucide-react";

const items = [
  { to: "/", label: "Home", Icon: Home },
  { to: "/calendar", label: "Calendário", Icon: Calendar },
  { to: "/people", label: "Pessoas", Icon: Users },
  { to: "/map", label: "Mapa", Icon: MapPin },
  { to: "/profile", label: "Definições", Icon: Settings },
] as const;

export function BottomNav() {
  return (
    <nav
      className="glass-strong fixed inset-x-0 bottom-0 z-50"
      style={{ paddingBottom: "env(safe-area-inset-bottom)", borderTop: "1px solid var(--glass-border)" }}
      aria-label="Navegação principal"
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around px-2 py-2">
        {items.map(({ to, label, Icon }) => (
          <li key={to} className="flex-1">
            <Link
              to={to}
              activeOptions={{ exact: true }}
              aria-label={label}
              className="flex items-center justify-center rounded-xl px-2 py-2 text-muted-foreground transition-colors"
              activeProps={{ className: "text-primary" }}
            >
              <Icon className="h-6 w-6" strokeWidth={2} />
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
