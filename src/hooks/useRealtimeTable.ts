import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

type Handler = (payload: unknown) => void;

/**
 * Subscribes to realtime changes on a table for the current user.
 * Automatically tears down on unmount.
 */
export function useRealtimeTable(
  table: "events" | "lembretes" | "logs_sincronizacao",
  userId: string | null,
  onChange: Handler,
) {
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`rt-${table}-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `user_id=eq.${userId}` },
        (payload) => onChange(payload),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, userId, onChange]);
}
