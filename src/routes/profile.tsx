import { createFileRoute } from "@tanstack/react-router";
import { BottomNav, BottomNavSpacer } from "@/components/BottomNav";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Perfil | Agenda" },
      { name: "description", content: "Sua área de perfil." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  return (
    <main
      className="flex min-h-screen flex-col bg-background text-foreground"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <header className="px-5 pb-3 pt-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Perfil
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Em breve.
        </p>
      </header>
      <section className="flex-1 px-5">
        {/* Estrutura preparada para futuras configurações. */}
      </section>
      <BottomNavSpacer />
      <BottomNav />
    </main>
  );
}
