import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, Layers, LocateFixed, MapPin, Navigation } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export const Route = createFileRoute("/map")({
  head: () => ({
    meta: [
      { title: "Mapa | Calendário" },
      {
        name: "description",
        content:
          "Visualize seus eventos e compromissos com localização em um mapa interativo.",
      },
    ],
  }),
  component: MapPage,
});

// ---- Types mirroring those in routes/index.tsx ----
type EventLocation = { address: string; lat?: number; lng?: number };
type Recurrence = { freq: string };
type EventDef = {
  id: string;
  date: string;
  title: string;
  start: number;
  end: number;
  color: string;
  recurrence: Recurrence;
  kind?: "informative" | "report";
  location?: EventLocation;
};

const STORAGE_KEY = "calendar.events.v3";

const minutesToLabel = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

type MapType = "roadmap" | "satellite" | "hybrid" | "terrain";
type Period = "day" | "week" | "month" | "all";

// ── Google Maps script loader ──
let mapsLoadingPromise: Promise<void> | null = null;
function loadGoogleMaps(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if ((window as any).google?.maps) return Promise.resolve();
  if (mapsLoadingPromise) return mapsLoadingPromise;
  const key = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY;
  const channel = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID;
  mapsLoadingPromise = new Promise<void>((resolve, reject) => {
    (window as any).__initGoogleMap = () => resolve();
    const s = document.createElement("script");
    const params = new URLSearchParams({
      key: key || "",
      loading: "async",
      callback: "__initGoogleMap",
      libraries: "places,geocoding",
      ...(channel ? { channel } : {}),
    });
    s.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    s.async = true;
    s.defer = true;
    s.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(s);
  });
  return mapsLoadingPromise;
}

function MapPage() {
  const [events, setEvents] = useState<EventDef[]>([]);
  const [period, setPeriod] = useState<Period>("all");
  const [colorFilter, setColorFilter] = useState<string>("all");
  const [mapType, setMapType] = useState<MapType>("roadmap");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const trafficRef = useRef<any>(null);
  const [trafficOn, setTrafficOn] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load events from localStorage + listen to changes
  useEffect(() => {
    const read = () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        setEvents(raw ? JSON.parse(raw) : []);
      } catch {
        setEvents([]);
      }
    };
    read();
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) read();
    };
    window.addEventListener("storage", onStorage);
    const t = setInterval(read, 2000);
    return () => {
      window.removeEventListener("storage", onStorage);
      clearInterval(t);
    };
  }, []);

  // Init the map
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const google = (window as any).google;
        mapRef.current = new google.maps.Map(containerRef.current, {
          center: { lat: -23.5505, lng: -46.6333 }, // São Paulo as a fallback
          zoom: 12,
          mapTypeId: mapType,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: true,
        });
        setReady(true);
      })
      .catch((err) => {
        console.error(err);
        setError("Não foi possível carregar o mapa.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply map type changes
  useEffect(() => {
    if (mapRef.current) mapRef.current.setMapTypeId(mapType);
  }, [mapType]);

  // Traffic layer toggle
  useEffect(() => {
    if (!ready) return;
    const google = (window as any).google;
    if (trafficOn) {
      if (!trafficRef.current) trafficRef.current = new google.maps.TrafficLayer();
      trafficRef.current.setMap(mapRef.current);
    } else if (trafficRef.current) {
      trafficRef.current.setMap(null);
    }
  }, [trafficOn, ready]);

  // Available colors for filter
  const availableColors = useMemo(() => {
    const set = new Set<string>();
    events.forEach((e) => set.add(e.color));
    return Array.from(set);
  }, [events]);

  // Filter events by period & color
  const filteredEvents = useMemo(() => {
    const now = new Date();
    let interval: { start: Date; end: Date } | null = null;
    if (period === "day") {
      const s = new Date(now);
      s.setHours(0, 0, 0, 0);
      const e = new Date(now);
      e.setHours(23, 59, 59, 999);
      interval = { start: s, end: e };
    } else if (period === "week") {
      interval = {
        start: startOfWeek(now, { weekStartsOn: 0 }),
        end: endOfWeek(now, { weekStartsOn: 0 }),
      };
    } else if (period === "month") {
      interval = { start: startOfMonth(now), end: endOfMonth(now) };
    }
    return events.filter((e) => {
      if (!e.location?.lat || !e.location?.lng) return false;
      if (colorFilter !== "all" && e.color !== colorFilter) return false;
      if (!interval) return true;
      const d = parseISO(e.date);
      return isWithinInterval(d, interval);
    });
  }, [events, period, colorFilter]);

  const selected = useMemo(
    () => filteredEvents.find((e) => e.id === selectedId) || null,
    [filteredEvents, selectedId],
  );

  // Render markers
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const google = (window as any).google;
    const map = mapRef.current;
    const seen = new Set<string>();
    const bounds = new google.maps.LatLngBounds();
    let any = false;
    for (const ev of filteredEvents) {
      const loc = ev.location!;
      const key = ev.id;
      seen.add(key);
      let marker = markersRef.current.get(key);
      const pos = { lat: loc.lat!, lng: loc.lng! };
      if (!marker) {
        marker = new google.maps.Marker({
          position: pos,
          map,
          title: ev.title,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 9,
            fillColor: ev.color,
            fillOpacity: 1,
            strokeColor: "#fff",
            strokeWeight: 2,
          },
        });
        marker.addListener("click", () => setSelectedId(ev.id));
        markersRef.current.set(key, marker);
      } else {
        marker.setPosition(pos);
        marker.setTitle(ev.title);
        marker.setIcon({
          path: google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: ev.color,
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
        });
      }
      bounds.extend(pos);
      any = true;
    }
    // remove markers no longer present
    for (const [id, m] of markersRef.current) {
      if (!seen.has(id)) {
        m.setMap(null);
        markersRef.current.delete(id);
      }
    }
    if (any && !selectedId) {
      try {
        map.fitBounds(bounds, 80);
        if (filteredEvents.length === 1) map.setZoom(14);
      } catch {}
    }
  }, [filteredEvents, ready, selectedId]);

  // Locate me
  function locateMe() {
    if (!ready || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        mapRef.current.setCenter(p);
        mapRef.current.setZoom(14);
      },
      () => {},
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  // Search via Geocoder
  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = search.trim();
    if (!q || !ready) return;
    const google = (window as any).google;
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ address: q }, (results: any, status: string) => {
      if (status === "OK" && results?.[0]) {
        const loc = results[0].geometry.location;
        mapRef.current.setCenter(loc);
        mapRef.current.setZoom(14);
      }
    });
  }

  function openRoute(ev: EventDef) {
    if (!ev.location?.lat || !ev.location?.lng) return;
    const dest = `${ev.location.lat},${ev.location.lng}`;
    window.open(
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`,
      "_blank",
    );
  }

  return (
    <main className="relative flex h-screen flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="z-10 flex items-center gap-2 border-b border-border/60 bg-background/90 px-3 py-2 backdrop-blur">
        <div className="flex h-9 items-center px-1 font-display text-base font-semibold">
          Mapa
        </div>
        <form onSubmit={runSearch} className="flex-1">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar endereço ou local"
            className="h-9"
          />
        </form>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 px-2">
              <Layers className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-2">
            <div className="space-y-1">
              {([
                { v: "roadmap", label: "🗺️ Padrão" },
                { v: "satellite", label: "🛰️ Satélite" },
                { v: "hybrid", label: "🌍 Híbrido" },
                { v: "terrain", label: "🏔️ Terreno" },
              ] as { v: MapType; label: string }[]).map((o) => (
                <button
                  key={o.v}
                  onClick={() => setMapType(o.v)}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent ${
                    mapType === o.v ? "bg-accent font-medium" : ""
                  }`}
                >
                  {o.label}
                </button>
              ))}
              <div className="my-1 h-px bg-border" />
              <button
                onClick={() => setTrafficOn((v) => !v)}
                className={`w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent ${
                  trafficOn ? "bg-accent font-medium" : ""
                }`}
              >
                🚗 Trânsito {trafficOn ? "(on)" : ""}
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </header>

      {/* Filters */}
      <div className="z-10 flex items-center gap-2 border-b border-border/60 bg-background/90 px-3 py-2">
        <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <SelectTrigger className="h-8 w-[110px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="day">Hoje</SelectItem>
            <SelectItem value="week">Semana</SelectItem>
            <SelectItem value="month">Mês</SelectItem>
          </SelectContent>
        </Select>
        <Select value={colorFilter} onValueChange={setColorFilter}>
          <SelectTrigger className="h-8 w-[140px] text-xs">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as cores</SelectItem>
            {availableColors.map((c) => (
              <SelectItem key={c} value={c}>
                <span className="inline-flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ background: c }}
                  />
                  {c}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">
          {filteredEvents.length} evento{filteredEvents.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Map container */}
      <div className="relative flex-1">
        <div ref={containerRef} className="absolute inset-0" />
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 px-6 text-center text-sm text-muted-foreground">
            {error}
          </div>
        )}
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Carregando mapa…
          </div>
        )}

        {/* Floating locate button */}
        <button
          onClick={locateMe}
          className="absolute right-4 bottom-[calc(96px+env(safe-area-inset-bottom))] flex h-11 w-11 items-center justify-center rounded-full bg-background shadow-lg ring-1 ring-border hover:bg-accent"
          aria-label="Minha localização"
        >
          <LocateFixed className="h-5 w-5 text-primary" />
        </button>

        {/* Selected event card */}
        {selected && (
          <div className="absolute bottom-4 left-4 right-4 z-10 rounded-2xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur">
            <div className="flex items-start gap-3">
              <span
                className="mt-1 inline-block h-3 w-3 flex-shrink-0 rounded-full"
                style={{ background: selected.color }}
              />
              <div className="min-w-0 flex-1">
                <div className="font-display text-base font-semibold">
                  {selected.title}
                </div>
                <div className="text-xs text-muted-foreground">
                  {format(parseISO(selected.date), "EEE, d 'de' MMM", {
                    locale: ptBR,
                  })}{" "}
                  · {minutesToLabel(selected.start)}–
                  {minutesToLabel(selected.end)}
                </div>
                {selected.location?.address && (
                  <div className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
                    <MapPin className="mt-0.5 h-3 w-3 flex-shrink-0" />
                    <span className="truncate">{selected.location.address}</span>
                  </div>
                )}
              </div>
              <button
                onClick={() => setSelectedId(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Fechar
              </button>
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                className="flex-1"
                onClick={() => openRoute(selected)}
              >
                <Navigation className="mr-1.5 h-4 w-4" />
                Rotas
              </Button>
              <Link to="/" className="flex-1">
                <Button size="sm" variant="outline" className="w-full">
                  Ver detalhes
                </Button>
              </Link>
            </div>
          </div>
        )}
      </div>
      <BottomNav />
    </main>
  );
}
