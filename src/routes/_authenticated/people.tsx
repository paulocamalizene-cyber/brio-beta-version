import { createFileRoute } from "@tanstack/react-router";
import { BottomNav, BottomNavSpacer } from "@/components/BottomNav";
import { Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/people")({
  head: () => ({
    meta: [
      { title: "Contactos" },
      { name: "description", content: "Os teus contactos e pessoas." },
    ],
  }),
  component: PeoplePage,
});

function PeoplePage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto max-w-md px-4 pt-6 pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Contactos</h1>
        <p className="text-sm text-muted-foreground">As pessoas da tua rede.</p>
      </header>
      <main className="mx-auto max-w-md px-4">
        <div className="glass rounded-2xl p-8 text-center">
          <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Ainda não tens contactos. Em breve poderás adicionar pessoas aqui.
          </p>
        </div>
      </main>
      <BottomNavSpacer />
      <BottomNav />
    </div>
  );
}
