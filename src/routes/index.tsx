import { createFileRoute } from "@tanstack/react-router";
import { BottomNav, BottomNavSpacer } from "@/components/BottomNav";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Home | Agenda" },
      { name: "description", content: "Página inicial do seu app de agenda." },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  return (
    <main
      className="flex min-h-screen flex-col bg-background text-foreground"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <header className="px-5 pb-3 pt-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Home
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bem-vindo de volta.
        </p>
      </header>
      <section className="flex-1" />
      <BottomNavSpacer />
      <BottomNav />
    </main>
  );
}
