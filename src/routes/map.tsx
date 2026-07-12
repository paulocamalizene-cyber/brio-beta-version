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
      v: "weekly",
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

  // User location refs
  const userDotRef = useRef<any>(null);
  const userAccuracyRef = useRef<any>(null);
  const userHeadingRef = useRef<any>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastUserPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const userBearingRef = useRef<number | null>(null);
  const mapHeadingRef = useRef(0);
  const [, setLocPermission] = useState<"granted" | "denied" | "prompt" | "unknown">("unknown");
  const [tracking, setTracking] = useState(false);
  const trackingRef = useRef(false);




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
          // Vector rendering is required for native two-finger rotate & tilt.
          renderingType: google.maps.RenderingType?.VECTOR,
          headingInteractionEnabled: true,
          tiltInteractionEnabled: true,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: false,
          rotateControl: true,
          scaleControl: false,
          gestureHandling: "greedy",
          isFractionalZoomEnabled: true,
          // Do NOT force heading to 0 — that would reset user rotation.
          tilt: 45,
          clickableIcons: false,
          backgroundColor: "#e8eaed",
          disableDefaultUI: true,
        });

        mapRef.current = map;
        map.setOptions({
          headingInteractionEnabled: true,
          tiltInteractionEnabled: true,
          rotateControl: true,
        });
        if (typeof map.setHeadingInteractionEnabled === "function") {
          map.setHeadingInteractionEnabled(true);
        }
        if (typeof map.setTiltInteractionEnabled === "function") {
          map.setTiltInteractionEnabled(true);
        }
        map.addListener("heading_changed", () => {
          const nextHeading = map.getHeading() || 0;
          mapHeadingRef.current = nextHeading;
          setHeading(nextHeading);
          updateUserHeadingMarkerRotation();
        });
        map.addListener("tilt_changed", () => {
          setTilt(map.getTilt() || 0);
        });
        // User gestures (drag/pinch) disable tracking — the map should never
        // snap back to the user's location while they're exploring.
        map.addListener("dragstart", () => {
          if (trackingRef.current) {
            trackingRef.current = false;
            setTracking(false);
          }
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

  function updateUserHeadingMarkerRotation(bearing = userBearingRef.current) {
    if (!userHeadingRef.current || bearing == null || Number.isNaN(bearing)) return;
    const icon = userHeadingRef.current.getIcon() || {};
    const rotation = (bearing - mapHeadingRef.current + 360) % 360;
    userHeadingRef.current.setIcon({ ...icon, rotation });
  }

  // Vector maps handle two-finger rotate/tilt natively when the API/browser
  // supports it. This capture-phase fallback mirrors Google Maps behavior on
  // devices where the native heading gesture is unavailable or disabled by the
  // loaded map style: two fingers rotate freely without forcing north again.
  useEffect(() => {
    if (!ready || !containerRef.current || !mapRef.current) return;
    const el = containerRef.current;
    const map = mapRef.current;

    let rotateGesture: { angle: number; heading: number } | null = null;
    const touchAngle = (touches: TouchList) => {
      const a = touches[0];
      const b = touches[1];
      return (Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX) * 180) / Math.PI;
    };
    const normalizeHeading = (value: number) => {
      const next = value % 360;
      return next < 0 ? next + 360 : next;
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      rotateGesture = {
        angle: touchAngle(e.touches),
        heading: map.getHeading() || 0,
      };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !rotateGesture) return;
      const nextHeading = normalizeHeading(
        rotateGesture.heading + touchAngle(e.touches) - rotateGesture.angle,
      );
      map.setHeading(nextHeading);
      mapHeadingRef.current = nextHeading;
      updateUserHeadingMarkerRotation();
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) rotateGesture = null;
    };

    el.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    el.addEventListener("touchmove", onTouchMove, { capture: true, passive: true });
    el.addEventListener("touchend", onTouchEnd, { capture: true, passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { capture: true, passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart, { capture: true } as any);
      el.removeEventListener("touchmove", onTouchMove, { capture: true } as any);
      el.removeEventListener("touchend", onTouchEnd, { capture: true } as any);
      el.removeEventListener("touchcancel", onTouchEnd, { capture: true } as any);
    };
  }, [ready]);

  // Desktop affordance: Shift/Ctrl/⌘ + mouse drag → rotate (horizontal) and tilt (vertical).
  useEffect(() => {
    if (!ready || !containerRef.current || !mapRef.current) return;
    const el = containerRef.current;
    const map = mapRef.current;

    let rotating = false;
    let start: { x: number; y: number; h: number; t: number } | null = null;
    const onMouseDown = (e: MouseEvent) => {
      if (!(e.shiftKey || e.ctrlKey || e.metaKey)) return;
      rotating = true;
      start = { x: e.clientX, y: e.clientY, h: map.getHeading() || 0, t: map.getTilt() || 0 };
      e.stopPropagation();
      e.preventDefault();
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!rotating || !start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      let h = (start.h + dx * 0.6) % 360;
      if (h < 0) h += 360;
      map.setHeading(h);
      mapHeadingRef.current = h;
      updateUserHeadingMarkerRotation();
      map.setTilt(Math.max(0, Math.min(67.5, start.t - dy * 0.3)));
    };
    const onMouseUp = () => {
      rotating = false;
      start = null;
    };

    el.addEventListener("mousedown", onMouseDown, { capture: true });
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      el.removeEventListener("mousedown", onMouseDown, { capture: true } as any);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [ready]);



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
    mapHeadingRef.current = newHeading < 0 ? newHeading + 360 : newHeading;
    updateUserHeadingMarkerRotation();
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
    mapHeadingRef.current = h;
    updateUserHeadingMarkerRotation();
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
      mapHeadingRef.current = h;
      updateUserHeadingMarkerRotation();
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

  // Watch user location continuously and render a Google-Maps-style blue dot
  // with an accuracy circle. Runs independently from event markers so it is
  // never cleared by fitBounds / marker sync / map camera changes.
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    const google = (window as any).google;
    const map = mapRef.current;

    // Build persistent user-location overlay once. Uses OverlayView so we can
    // render an HTML element with a CSS-animated pulsing aura — smooth and
    // GPU-accelerated, independent of map camera changes (zoom/rotate/pan).
    if (!userDotRef.current) {
      const el = document.createElement("div");
      el.className = "user-loc";
      el.innerHTML = '<div class="user-loc__pulse"></div><div class="user-loc__dot"></div>';
      // IMPORTANT: no CSS transition on left/top — OverlayView.draw() runs on
      // every pan/zoom frame. A transition here makes the dot lag behind the
      // map (looking like it is "stuck to the screen"). Position updates are
      // instant so the dot stays anchored to its geographic coordinates.


      class UserOverlay extends google.maps.OverlayView {
        position: any = null;
        div: HTMLDivElement = el;
        onAdd() {
          const panes = this.getPanes();
          // floatPane sits above markers so the dot never gets occluded
          panes.floatPane.appendChild(this.div);
        }
        draw() {
          if (!this.position) return;
          const proj = this.getProjection();
          if (!proj) return;
          const pt = proj.fromLatLngToDivPixel(this.position);
          if (!pt) return;
          this.div.style.left = pt.x + "px";
          this.div.style.top = pt.y + "px";
        }
        onRemove() {
          if (this.div.parentNode) this.div.parentNode.removeChild(this.div);
        }
        setPosition(latLng: any) {
          this.position = latLng;
          this.draw();
        }
      }
      const overlay = new UserOverlay();
      overlay.setMap(map);
      userDotRef.current = overlay;
    }

    // Optional heading indicator (triangle) — hidden until we have a heading
    if (!userHeadingRef.current) {
      userHeadingRef.current = new google.maps.Marker({
        map: null,
        clickable: false,
        zIndex: 999,
        optimized: false,
        icon: {
          path: "M 0,-22 L 8,-6 L 0,-10 L -8,-6 Z",
          fillColor: "#4285F4",
          fillOpacity: 0.9,
          strokeColor: "#ffffff",
          strokeWeight: 1,
          rotation: 0,
        },
      });
    }

    const onPos = (pos: GeolocationPosition) => {
      const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      lastUserPosRef.current = p;
      setLocPermission("granted");
      const latLng = new google.maps.LatLng(p.lat, p.lng);
      userDotRef.current.setPosition(latLng);
      // Camera only follows when the user explicitly enabled tracking.
      if (trackingRef.current) {
        map.panTo(p);
      }
      if (pos.coords.heading != null && !Number.isNaN(pos.coords.heading)) {
        userBearingRef.current = pos.coords.heading;
        userHeadingRef.current.setPosition(p);
        updateUserHeadingMarkerRotation(pos.coords.heading);
        if (!userHeadingRef.current.getMap()) userHeadingRef.current.setMap(map);
      }
    };


    const onErr = (err: GeolocationPositionError) => {
      if (err.code === err.PERMISSION_DENIED) setLocPermission("denied");
    };

    watchIdRef.current = navigator.geolocation.watchPosition(onPos, onErr, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 15000,
    });

    // Device orientation as heading fallback (mobile compass)
    const onOrient = (e: DeviceOrientationEvent) => {
      const anyE = e as any;
      const alpha = anyE.webkitCompassHeading != null ? anyE.webkitCompassHeading : (e.alpha != null ? 360 - e.alpha : null);
      if (alpha == null || Number.isNaN(alpha) || !lastUserPosRef.current) return;
      userBearingRef.current = alpha;
      userHeadingRef.current.setPosition(lastUserPosRef.current);
      updateUserHeadingMarkerRotation(alpha);
      if (!userHeadingRef.current.getMap()) userHeadingRef.current.setMap(map);
    };
    window.addEventListener("deviceorientationabsolute" as any, onOrient as any, true);
    window.addEventListener("deviceorientation", onOrient, true);

    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
      window.removeEventListener("deviceorientationabsolute" as any, onOrient as any, true);
      window.removeEventListener("deviceorientation", onOrient, true);
    };
  }, [ready]);

  function locateMe() {
    if (!ready || !mapRef.current) return;
    // Enable tracking mode — the button is now "active" and subsequent GPS
    // fixes will pan the camera. Any user drag disables it again.
    trackingRef.current = true;
    setTracking(true);
    // If we already have a fix, just recenter.
    if (lastUserPosRef.current) {
      mapRef.current.panTo(lastUserPosRef.current);
      const z = mapRef.current.getZoom() || 12;
      if (z < 15) mapRef.current.setZoom(16);
      return;
    }
    if (!navigator.geolocation) {
      setError("Geolocalização não suportada neste dispositivo.");
      return;
    }
    // iOS 13+: request permission for device orientation on user gesture
    const anyDOE = (window as any).DeviceOrientationEvent;
    if (anyDOE && typeof anyDOE.requestPermission === "function") {
      anyDOE.requestPermission().catch(() => {});
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        lastUserPosRef.current = p;
        setLocPermission("granted");
        mapRef.current.panTo(p);
        mapRef.current.setZoom(16);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setLocPermission("denied");
          trackingRef.current = false;
          setTracking(false);
          setError("Permissão de localização negada. Ative-a nas configurações do navegador.");
          setTimeout(() => setError(null), 4000);
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
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
    mapHeadingRef.current = 0;
    updateUserHeadingMarkerRotation();
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
    <main
      className="fixed inset-0 z-0 flex flex-col overflow-hidden bg-background text-foreground"
      style={{ paddingBottom: "calc(64px + env(safe-area-inset-bottom))" }}
    >

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
          {/* Bússola — sempre visível. Clique: norte; arraste: rotacionar. */}
          <button
            ref={compassRef}
            onPointerDown={onCompassPointerDown}
            onPointerMove={onCompassPointerMove}
            onPointerUp={onCompassPointerUp}
            onPointerCancel={onCompassPointerUp}
            className={`flex h-11 w-11 items-center justify-center rounded-full bg-background/95 shadow-lg ring-1 ring-border transition hover:bg-accent active:scale-95 touch-none ${compassDragging ? "cursor-grabbing" : "cursor-grab"}`}
            style={{ cursor: compassDragging ? "grabbing" : "grab" }}
            aria-label="Bússola: voltar ao norte"
            title="Clique: voltar ao norte · Arraste: rotacionar"
          >
            <div
              className="relative h-6 w-6"
              style={{ transform: `rotate(${-heading}deg)`, transition: adjusting || compassDragging ? "none" : "transform 120ms" }}
            >
              <Compass className="absolute inset-0 h-6 w-6 text-foreground" />
              <span className="absolute -top-1 left-1/2 -translate-x-1/2 text-[8px] font-bold text-red-500">N</span>
            </div>
          </button>


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

        {/* Locate me — bottom right. Filled when tracking is active. */}
        <button
          onClick={locateMe}
          className={`absolute right-3 bottom-4 z-10 flex h-12 w-12 items-center justify-center rounded-full shadow-lg ring-1 ring-border transition active:scale-95 ${tracking ? "bg-primary text-primary-foreground" : "bg-background/95 text-foreground hover:bg-accent"}`}
          aria-label="Minha localização"
          aria-pressed={tracking}
        >
          <LocateFixed className="h-5 w-5" />
        </button>


        {/* Selected event card */}
        {selected && (
          <div className="absolute left-3 right-3 bottom-4 z-10 rounded-2xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur">
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
