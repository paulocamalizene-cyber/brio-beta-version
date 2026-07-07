import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Compass, Layers, LocateFixed, MapPin, Minus, Navigation, Plus } from "lucide-react";
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
  const [showLayers, setShowLayers] = useState(false);
  const [trafficOn, setTrafficOn] = useState(false);
  const [heading, setHeading] = useState(0);
  const [tilt, setTilt] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const trafficRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const didInitialFitRef = useRef(false);


  // Load events
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

  // Init map
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const google = (window as any).google;
        const map = new google.maps.Map(containerRef.current, {
          center: { lat: -23.5505, lng: -46.6333 },
          zoom: 12,
          minZoom: 3,
          maxZoom: 21,
          mapTypeId: mapType,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: false,
          rotateControl: false,
          scaleControl: false,
          gestureHandling: "greedy",
          isFractionalZoomEnabled: true,
          tilt: 0,
          heading: 0,
          clickableIcons: false,
          keyboardShortcuts: false,
          backgroundColor: "#e8eaed",
          disableDefaultUI: true,
          restriction: {
            latLngBounds: { north: 85, south: -85, west: -180, east: 180 },
            strictBounds: true,
          },
        });
        mapRef.current = map;
        map.addListener("heading_changed", () => {
          setHeading(map.getHeading() || 0);
        });
        map.addListener("tilt_changed", () => {
          setTilt(map.getTilt() || 0);
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

  // One-finger rotate/tilt: two-finger gestures already handled by Google,
  // but we add an "Adjust view" overlay activated by long-press to allow
  // single-finger rotate (drag horizontally) + tilt (drag vertically).
  const adjustingRef = useRef(false);
  const adjustStartRef = useRef<{ x: number; y: number; h: number; t: number } | null>(null);
  const [adjusting, setAdjusting] = useState(false);

  function startAdjust(clientX: number, clientY: number) {
    if (!mapRef.current) return;
    adjustingRef.current = true;
    setAdjusting(true);
    adjustStartRef.current = {
      x: clientX,
      y: clientY,
      h: mapRef.current.getHeading() || 0,
      t: mapRef.current.getTilt() || 0,
    };
  }
  function moveAdjust(clientX: number, clientY: number) {
    if (!adjustingRef.current || !adjustStartRef.current || !mapRef.current) return;
    const dx = clientX - adjustStartRef.current.x;
    const dy = clientY - adjustStartRef.current.y;
    const newHeading = (adjustStartRef.current.h + dx * 0.6) % 360;
    const newTilt = Math.max(0, Math.min(67.5, adjustStartRef.current.t - dy * 0.3));
    mapRef.current.setHeading(newHeading < 0 ? newHeading + 360 : newHeading);
    mapRef.current.setTilt(newTilt);
  }
  function endAdjust() {
    adjustingRef.current = false;
    setAdjusting(false);
    adjustStartRef.current = null;
  }

  // Compass drag-to-rotate: press compass and drag around it to rotate the map.
  // If the pointer barely moved, treat as a click → reset to north when not aligned.
  const compassRef = useRef<HTMLButtonElement | null>(null);
  const compassDragRef = useRef<{
    cx: number; cy: number; startAngle: number; startHeading: number; moved: boolean;
  } | null>(null);
  const [compassDragging, setCompassDragging] = useState(false);

  function angleFromCenter(cx: number, cy: number, x: number, y: number) {
    // 0° = up (north), clockwise positive
    return (Math.atan2(x - cx, cy - y) * 180) / Math.PI;
  }

  function onCompassPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (!mapRef.current || !compassRef.current) return;
    e.preventDefault();
    compassRef.current.setPointerCapture(e.pointerId);
    const rect = compassRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    compassDragRef.current = {
      cx, cy,
      startAngle: angleFromCenter(cx, cy, e.clientX, e.clientY),
      startHeading: mapRef.current.getHeading() || 0,
      moved: false,
    };
    setCompassDragging(true);
  }
  function onCompassPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const d = compassDragRef.current;
    if (!d || !mapRef.current) return;
    const a = angleFromCenter(d.cx, d.cy, e.clientX, e.clientY);
    const delta = a - d.startAngle;
    if (Math.abs(delta) > 2) d.moved = true;
    let h = (d.startHeading + delta) % 360;
    if (h < 0) h += 360;
    mapRef.current.setHeading(h);
  }
  function onCompassPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    const d = compassDragRef.current;
    if (compassRef.current?.hasPointerCapture(e.pointerId)) {
      compassRef.current.releasePointerCapture(e.pointerId);
    }
    const wasDrag = !!d?.moved;
    compassDragRef.current = null;
    setCompassDragging(false);
    if (!wasDrag && mapRef.current) {
      const h = mapRef.current.getHeading() || 0;
      if (Math.abs(h) > 0.5 && Math.abs(h - 360) > 0.5) {
        resetNorth();
      }
    }
  }

  // Keyboard: Alt+ArrowLeft/Right rotate by 15°
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!mapRef.current || !e.altKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const step = e.key === "ArrowLeft" ? -15 : 15;
      let h = ((mapRef.current.getHeading() || 0) + step) % 360;
      if (h < 0) h += 360;
      mapRef.current.setHeading(h);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);


  useEffect(() => {
    if (mapRef.current) mapRef.current.setMapTypeId(mapType);
  }, [mapType]);

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

  const availableColors = useMemo(() => {
    const set = new Set<string>();
    events.forEach((e) => set.add(e.color));
    return Array.from(set);
  }, [events]);

  const filteredEvents = useMemo(() => {
    const now = new Date();
    let interval: { start: Date; end: Date } | null = null;
    if (period === "day") {
      const s = new Date(now); s.setHours(0, 0, 0, 0);
      const e = new Date(now); e.setHours(23, 59, 59, 999);
      interval = { start: s, end: e };
    } else if (period === "week") {
      interval = { start: startOfWeek(now, { weekStartsOn: 0 }), end: endOfWeek(now, { weekStartsOn: 0 }) };
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
      const icon = {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 9,
        fillColor: ev.color,
        fillOpacity: 1,
        strokeColor: "#fff",
        strokeWeight: 2,
      };
      if (!marker) {
        marker = new google.maps.Marker({ position: pos, map, title: ev.title, icon });
        marker.addListener("click", () => setSelectedId(ev.id));
        markersRef.current.set(key, marker);
      } else {
        marker.setPosition(pos);
        marker.setTitle(ev.title);
        marker.setIcon(icon);
      }
      bounds.extend(pos);
      any = true;
    }
    for (const [id, m] of markersRef.current) {
      if (!seen.has(id)) {
        m.setMap(null);
        markersRef.current.delete(id);
      }
    }
    // Only fit bounds ONCE (initial load). fitBounds resets heading/tilt,
    // which would fight the user's rotation on every event change.
    if (any && !selectedId && !didInitialFitRef.current) {
      didInitialFitRef.current = true;
      try {
        map.fitBounds(bounds, 80);
        if (filteredEvents.length === 1) map.setZoom(14);
      } catch {}
    }
  }, [filteredEvents, ready, selectedId]);

  function locateMe() {
    if (!ready || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        mapRef.current.setCenter(p);
        mapRef.current.setZoom(15);
      },
      () => {},
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  function zoomBy(delta: number) {
    if (!mapRef.current) return;
    const z = mapRef.current.getZoom() || 12;
    mapRef.current.setZoom(Math.max(2, Math.min(21, z + delta)));
  }

  function resetNorth() {
    if (!mapRef.current) return;
    mapRef.current.setHeading(0);
    mapRef.current.setTilt(0);
  }

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
      {/* Compact top bar: title + search only. Layers moved into the map. */}
      <header
        className="z-10 flex items-center gap-2 border-b border-border/60 bg-background/90 px-3 py-2 backdrop-blur"
        style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}
      >
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
                  <span className="inline-block h-3 w-3 rounded-full" style={{ background: c }} />
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

      {/* Map */}
      <div className="relative flex-1 overflow-hidden">
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

        {/* Adjust-view overlay: when active, captures pointer to rotate/tilt with one finger */}
        {adjusting && (
          <div
            className="absolute inset-0 z-20 cursor-grabbing touch-none"
            onPointerMove={(e) => moveAdjust(e.clientX, e.clientY)}
            onPointerUp={endAdjust}
            onPointerCancel={endAdjust}
            onPointerLeave={endAdjust}
          >
            <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-background/90 px-3 py-1 text-xs font-medium shadow ring-1 ring-border">
              Arraste: ↔ rotacionar · ↕ inclinar
            </div>
          </div>
        )}

        {/* Angle overlay while rotating */}
        {(compassDragging || adjusting) && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background/90 px-4 py-2 text-sm font-semibold shadow-lg ring-1 ring-border">
            {Math.round(heading)}°
          </div>
        )}



        {/* Right-side controls stack */}
        <div
          className="absolute right-3 top-3 z-10 flex flex-col gap-2"
          style={{ top: "calc(0.75rem)" }}
        >
          {/* Recentrar Norte — visible only when the map is rotated. Drag to rotate; click to reset. */}
          {(heading > 0.5 && heading < 359.5) && (
            <button
              ref={compassRef}
              onPointerDown={onCompassPointerDown}
              onPointerMove={onCompassPointerMove}
              onPointerUp={onCompassPointerUp}
              onPointerCancel={onCompassPointerUp}
              className={`flex h-11 w-11 items-center justify-center rounded-full bg-background/95 shadow-lg ring-1 ring-border transition hover:bg-accent active:scale-95 touch-none ${compassDragging ? "cursor-grabbing" : "cursor-grab"}`}
              style={{ cursor: compassDragging ? "grabbing" : "grab" }}
              aria-label="Recentrar Norte"
              title="Clique: Recentrar Norte · Arraste: rotacionar"
            >
              <div
                className="relative h-6 w-6"
                style={{ transform: `rotate(${-heading}deg)`, transition: adjusting || compassDragging ? "none" : "transform 120ms" }}
              >
                <Compass className="absolute inset-0 h-6 w-6 text-foreground" />
                <span className="absolute -top-1 left-1/2 -translate-x-1/2 text-[8px] font-bold text-red-500">N</span>
              </div>
            </button>
          )}


          {/* Layers menu */}
          <div className="relative">
            <button
              onClick={() => setShowLayers((v) => !v)}
              className={`flex h-11 w-11 items-center justify-center rounded-full bg-background/95 shadow-lg ring-1 ring-border transition hover:bg-accent active:scale-95 ${showLayers ? "bg-accent" : ""}`}
              aria-label="Camadas"
            >
              <Layers className="h-5 w-5 text-foreground" />
            </button>
            {showLayers && (
              <div className="absolute right-0 top-12 w-48 rounded-2xl border border-border bg-background/98 p-1.5 shadow-xl backdrop-blur">
                {([
                  { v: "roadmap", label: "🗺️ Padrão" },
                  { v: "satellite", label: "🛰️ Satélite" },
                  { v: "hybrid", label: "🌍 Híbrido" },
                  { v: "terrain", label: "🏔️ Terreno" },
                ] as { v: MapType; label: string }[]).map((o) => (
                  <button
                    key={o.v}
                    onClick={() => { setMapType(o.v); setShowLayers(false); }}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent ${mapType === o.v ? "bg-accent font-medium" : ""}`}
                  >
                    {o.label}
                  </button>
                ))}
                <div className="my-1 h-px bg-border" />
                <button
                  onClick={() => setTrafficOn((v) => !v)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent ${trafficOn ? "bg-accent font-medium" : ""}`}
                >
                  🚗 Trânsito {trafficOn ? "(ligado)" : ""}
                </button>
              </div>
            )}
          </div>

          {/* Zoom controls — circular, fully visible */}
          <div className="flex flex-col overflow-hidden rounded-full bg-background/95 shadow-lg ring-1 ring-border">
            <button
              onClick={() => zoomBy(1)}
              className="flex h-11 w-11 items-center justify-center transition hover:bg-accent active:scale-95"
              aria-label="Aumentar zoom"
            >
              <Plus className="h-5 w-5" />
            </button>
            <div className="mx-2 h-px bg-border" />
            <button
              onClick={() => zoomBy(-1)}
              className="flex h-11 w-11 items-center justify-center transition hover:bg-accent active:scale-95"
              aria-label="Diminuir zoom"
            >
              <Minus className="h-5 w-5" />
            </button>
          </div>

          {/* Tilt/rotate adjuster — long-press / press-and-drag */}
          <button
            onPointerDown={(e) => { e.preventDefault(); startAdjust(e.clientX, e.clientY); }}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-background/95 shadow-lg ring-1 ring-border transition hover:bg-accent active:scale-95 touch-none"
            aria-label="Ajustar inclinação e rotação"
            title="Pressione e arraste para girar/inclinar"
          >
            <Navigation
              className="h-5 w-5 text-foreground"
              style={{ transform: `rotate(${tilt > 0 ? 30 : 0}deg)` }}
            />
          </button>
        </div>

        {/* Locate me — bottom right */}
        <button
          onClick={locateMe}
          className="absolute right-3 bottom-[calc(96px+env(safe-area-inset-bottom))] z-10 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-1 ring-border transition hover:opacity-90 active:scale-95"
          aria-label="Minha localização"
        >
          <LocateFixed className="h-5 w-5" />
        </button>

        {/* Selected event card */}
        {selected && (
          <div className="absolute left-3 right-3 bottom-[calc(80px+env(safe-area-inset-bottom))] z-10 rounded-2xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur">
            <div className="flex items-start gap-3">
              <span className="mt-1 inline-block h-3 w-3 flex-shrink-0 rounded-full" style={{ background: selected.color }} />
              <div className="min-w-0 flex-1">
                <div className="font-display text-base font-semibold truncate">{selected.title}</div>
                <div className="text-xs text-muted-foreground">
                  {format(parseISO(selected.date), "EEE, d 'de' MMM", { locale: ptBR })} · {minutesToLabel(selected.start)}–{minutesToLabel(selected.end)}
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
              <Button size="sm" className="flex-1" onClick={() => openRoute(selected)}>
                <Navigation className="mr-1.5 h-4 w-4" />
                Rotas
              </Button>
              <Link to="/calendar" className="flex-1">
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
