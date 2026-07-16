"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Stop } from "./route-data";
import { getRoadRoute } from "./road-route";
import { applyTruckAppearance, bearingBetween, normalizeHeading, truckIcon } from "./truck-marker";

type Props = {
  stops: Stop[];
  statuses: Record<string, "pending" | "done" | "absent">;
  activeId?: string;
  activeStop?: Stop;
  completed: number;
  done: number;
  absent: number;
  pending: number;
  total: number;
  kilos: number;
  routeKm: number;
  estimatedMinutes: number;
  startedAt: number | null;
  privacyMode: boolean;
  onTrackingChange: (active: boolean) => void;
  onArrival: (stop: Stop, distanceMeters: number) => void;
};

type PositionInfo = {
  accuracy: number;
  speed: number | null;
  heading: number;
  moving: boolean;
};

type PendingJump = { point: L.LatLng; count: number; at: number };
type ArrivalCandidate = { stopId: string; confirmations: number; firstSeenAt: number };
type WakeLockHandle = { release(): Promise<void> };
type LiveState = {
  activeStop?: Stop;
  completed: number;
  done: number;
  absent: number;
  pending: number;
  total: number;
  kilos: number;
  routeKm: number;
  estimatedMinutes: number;
  startedAt: number | null;
  privacyMode: boolean;
};

const OUTBOX_KEY = "santuario-tracking-outbox-v3";
const MAX_GPS_ACCURACY_METERS = 70;
const ARRIVAL_MAX_ACCURACY_METERS = 25;
const ARRIVAL_CONFIRMATIONS = 3;
const ARRIVAL_MIN_DWELL_MS = 2_500;
const ARRIVAL_MAX_SPEED_METERS_PER_SECOND = 5.5;
const MIN_TRAIL_STEP_METERS = 2.5;
const MOVING_SPEED_METERS_PER_SECOND = 0.8;
const MAX_NORMAL_JUMP_METERS = 220;
const MAX_REASONABLE_SPEED_METERS_PER_SECOND = 55;
const GPS_RESET_AFTER_MS = 20_000;
const GPS_DELAY_WARNING_MS = 12_000;
const GPS_LOST_WARNING_MS = 25_000;
const SYNC_INTERVAL_MS = 5_000;

function addressLabel(stop: Stop) {
  return stop.address ?? `Punto GPS ${stop.id}`;
}

function visibleStopLabel(stop: Stop, privacyMode: boolean) {
  return privacyMode ? addressLabel(stop) : `${stop.name} · ${addressLabel(stop)}`;
}

function journeyId() {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return `santuario-${date}`;
}

export default function LiveMap({
  stops,
  statuses,
  activeId,
  activeStop,
  completed,
  done,
  absent,
  pending,
  total,
  kilos,
  routeKm,
  estimatedMinutes,
  startedAt,
  privacyMode,
  onTrackingChange,
  onArrival,
}: Props) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const stopsLayerRef = useRef<L.LayerGroup | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const truckRef = useRef<L.Marker | null>(null);
  const accuracyRef = useRef<L.Circle | null>(null);
  const trailRef = useRef<L.Polyline | null>(null);
  const watchRef = useRef<number | null>(null);
  const animationRef = useRef<number | null>(null);
  const acceptedPointRef = useRef<L.LatLng | null>(null);
  const lastFixAtRef = useRef<number | null>(null);
  const pendingJumpRef = useRef<PendingJump | null>(null);
  const headingRef = useRef(0);
  const renderedHeadingRef = useRef(0);
  const arrivalRef = useRef<string | null>(null);
  const arrivalCandidateRef = useRef<ArrivalCandidate | null>(null);
  const lastSyncRef = useRef(0);
  const followRef = useRef(true);
  const trackingRef = useRef(false);
  const positionInfoRef = useRef<PositionInfo | null>(null);
  const wakeLockRef = useRef<WakeLockHandle | null>(null);
  const liveStateRef = useRef<LiveState>({
    activeStop,
    completed,
    done,
    absent,
    pending,
    total,
    kilos,
    routeKm,
    estimatedMinutes,
    startedAt,
    privacyMode,
  });

  const [tracking, setTracking] = useState(false);
  const [follow, setFollow] = useState(true);
  const [gpsMessage, setGpsMessage] = useState("GPS detenido");
  const [positionInfo, setPositionInfo] = useState<PositionInfo | null>(null);
  const [mapStyle, setMapStyle] = useState<"streets" | "satellite">("streets");

  useEffect(() => {
    followRef.current = follow;
  }, [follow]);

  useEffect(() => {
    arrivalRef.current = null;
    arrivalCandidateRef.current = null;
  }, [activeId]);

  useEffect(() => {
    liveStateRef.current = {
      activeStop,
      completed,
      done,
      absent,
      pending,
      total,
      kilos,
      routeKm,
      estimatedMinutes,
      startedAt,
      privacyMode,
    };
  }, [activeStop, completed, done, absent, pending, total, kilos, routeKm, estimatedMinutes, startedAt, privacyMode]);

  const releaseWakeLock = useCallback(async () => {
    const current = wakeLockRef.current;
    wakeLockRef.current = null;
    try {
      await current?.release();
    } catch {}
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (document.visibilityState !== "visible" || wakeLockRef.current) return;
    const wakeLockApi = (navigator as Navigator & {
      wakeLock?: { request(type: "screen"): Promise<WakeLockHandle> };
    }).wakeLock;
    if (!wakeLockApi) return;
    try {
      wakeLockRef.current = await wakeLockApi.request("screen");
    } catch {}
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && trackingRef.current) void requestWakeLock();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [requestWakeLock]);

  const sendTracking = useCallback(async (
    point: L.LatLng,
    info: PositionInfo,
    statusOverride?: "active" | "paused" | "finished",
  ) => {
    const state = liveStateRef.current;
    const payload = JSON.stringify({
      journeyId: journeyId(),
      lat: point.lat,
      lng: point.lng,
      speed: info.speed,
      heading: info.heading,
      accuracy: info.accuracy,
      nextStop: state.activeStop ? visibleStopLabel(state.activeStop, state.privacyMode) : null,
      completed: state.completed,
      done: state.done,
      absent: state.absent,
      pending: state.pending,
      total: state.total,
      kilos: state.kilos,
      routeKm: state.routeKm,
      estimatedMinutes: state.estimatedMinutes,
      startedAt: state.startedAt,
      status: statusOverride ?? (state.completed >= state.total ? "finished" : "active"),
    });

    try {
      const response = await fetch("/api/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      if (!response.ok) throw new Error("sync failed");
      localStorage.removeItem(OUTBOX_KEY);
    } catch {
      localStorage.setItem(OUTBOX_KEY, payload);
    }
  }, []);

  useEffect(() => {
    const flush = async () => {
      const queued = localStorage.getItem(OUTBOX_KEY);
      if (!queued) return;
      try {
        const response = await fetch("/api/tracking", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: queued,
        });
        if (response.ok) localStorage.removeItem(OUTBOX_KEY);
      } catch {}
    };
    window.addEventListener("online", flush);
    if (navigator.onLine) void flush();
    return () => window.removeEventListener("online", flush);
  }, []);

  useEffect(() => {
    if (!tracking) return;
    const point = acceptedPointRef.current;
    const info = positionInfoRef.current;
    if (!point || !info) return;
    const timer = window.setTimeout(() => void sendTracking(point, info), 180);
    return () => window.clearTimeout(timer);
  }, [tracking, activeId, completed, done, absent, pending, total, kilos, routeKm, estimatedMinutes, startedAt, privacyMode, sendTracking]);

  useEffect(() => {
    if (!tracking) return;
    const timer = window.setInterval(() => {
      const lastFix = lastFixAtRef.current;
      if (!lastFix) return;
      const age = Date.now() - lastFix;
      if (age >= GPS_LOST_WARNING_MS) {
        setGpsMessage("Señal GPS perdida · buscando nuevamente…");
      } else if (age >= GPS_DELAY_WARNING_MS) {
        setGpsMessage("GPS sin actualización reciente · manteniendo última ubicación");
      }
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [tracking]);

  useEffect(() => {
    if (!mapElement.current || mapRef.current) return;
    const map = L.map(mapElement.current, { zoomControl: true, attributionControl: true });
    baseLayerRef.current = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);
    mapRef.current = map;
    stopsLayerRef.current = L.layerGroup().addTo(map);
    trailRef.current = L.polyline([], {
      color: "#0f6f54",
      weight: 6,
      opacity: 0.88,
      lineCap: "round",
      lineJoin: "round",
      smoothFactor: 1.2,
    }).addTo(map);
    map.fitBounds(L.latLngBounds(stops.map((stop) => [stop.lat, stop.lng] as [number, number])).pad(0.12));

    return () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      void releaseWakeLock();
      map.remove();
      mapRef.current = null;
    };
  }, [releaseWakeLock, stops]);

  useEffect(() => {
    const layer = stopsLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    const controller = new AbortController();
    layer.clearLayers();

    void getRoadRoute(stops, controller.signal).then((roadPoints) => {
      if (!roadPoints.length || controller.signal.aborted) return;
      L.polyline(roadPoints, {
        color: "#1d8062",
        weight: 5,
        opacity: 0.82,
        lineCap: "round",
        lineJoin: "round",
        smoothFactor: 1,
      }).addTo(layer).bringToBack();
    }).catch(() => {
      if (!controller.signal.aborted) setGpsMessage("Paradas visibles · trazado por calles no disponible");
    });

    stops.forEach((stop, index) => {
      const state = statuses[stop.id] ?? "pending";
      const active = stop.id === activeId;
      const marker = L.marker([stop.lat, stop.lng], {
        icon: L.divIcon({
          className: "stop-marker-wrap",
          html: `<span class="street-stop ${state} ${active ? "active" : ""}">${index + 1}</span>`,
          iconSize: active ? [36, 36] : [28, 28],
          iconAnchor: active ? [18, 18] : [14, 14],
        }),
      }).addTo(layer);
      marker.bindTooltip(`${index + 1}. ${visibleStopLabel(stop, privacyMode)}`, {
        direction: "top",
        offset: [0, -12],
      });
      marker.on("click", () => map.flyTo([stop.lat, stop.lng], Math.max(map.getZoom(), 17)));
    });

    return () => controller.abort();
  }, [stops, statuses, activeId, privacyMode]);

  const animateTruckTo = (target: L.LatLng, accuracy: number) => {
    const marker = truckRef.current;
    if (!marker) return;
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    const start = marker.getLatLng();
    const distance = start.distanceTo(target);
    if (distance < 0.5) {
      marker.setLatLng(target);
      accuracyRef.current?.setLatLng(target).setRadius(accuracy);
      return;
    }

    const duration = Math.min(1_250, Math.max(380, distance * 48));
    const started = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - (1 - progress) ** 3;
      const current = L.latLng(
        start.lat + (target.lat - start.lat) * eased,
        start.lng + (target.lng - start.lng) * eased,
      );
      marker.setLatLng(current);
      accuracyRef.current?.setLatLng(current).setRadius(accuracy);
      if (progress < 1) animationRef.current = requestAnimationFrame(step);
      else animationRef.current = null;
    };
    animationRef.current = requestAnimationFrame(step);
  };

  const acceptPoint = (raw: L.LatLng, accuracy: number, timestamp: number) => {
    const previous = acceptedPointRef.current;
    if (!previous) return raw;

    const distance = previous.distanceTo(raw);
    const gap = lastFixAtRef.current === null ? 0 : timestamp - lastFixAtRef.current;
    const elapsedSeconds = Math.max(gap / 1_000, 0.1);
    const impliedSpeed = distance / elapsedSeconds;
    const plausibleMovement = distance <= MAX_NORMAL_JUMP_METERS || impliedSpeed <= MAX_REASONABLE_SPEED_METERS_PER_SECOND;

    if (gap >= GPS_RESET_AFTER_MS) {
      pendingJumpRef.current = null;
      setGpsMessage("GPS recuperado después de perder señal");
      return raw;
    }

    if (!plausibleMovement) {
      const pendingJump = pendingJumpRef.current;
      const confirmationRadius = Math.max(accuracy * 1.5, 35);
      const consistent = pendingJump && pendingJump.point.distanceTo(raw) <= confirmationRadius;
      pendingJumpRef.current = {
        point: raw,
        count: consistent ? pendingJump.count + 1 : 1,
        at: timestamp,
      };
      if (pendingJumpRef.current.count >= 3) {
        pendingJumpRef.current = null;
        setGpsMessage("Nueva ubicación GPS confirmada");
        return raw;
      }
      return null;
    }

    pendingJumpRef.current = null;
    if (distance < MIN_TRAIL_STEP_METERS) return previous;
    const alpha = accuracy <= 10 ? 0.76 : accuracy <= 25 ? 0.56 : 0.36;
    return L.latLng(
      previous.lat + (raw.lat - previous.lat) * alpha,
      previous.lng + (raw.lng - previous.lng) * alpha,
    );
  };

  const stopTracking = () => {
    const point = acceptedPointRef.current;
    const info = positionInfoRef.current;
    const state = liveStateRef.current;
    if (point && info) void sendTracking(point, info, state.completed >= state.total ? "finished" : "paused");

    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    watchRef.current = null;
    animationRef.current = null;
    acceptedPointRef.current = null;
    lastFixAtRef.current = null;
    pendingJumpRef.current = null;
    arrivalCandidateRef.current = null;
    trackingRef.current = false;
    setTracking(false);
    onTrackingChange(false);
    setGpsMessage("GPS detenido");
    void releaseWakeLock();
  };

  const startTracking = () => {
    if (trackingRef.current) {
      stopTracking();
      return;
    }
    if (!navigator.geolocation) {
      setGpsMessage("Este dispositivo no tiene GPS disponible");
      return;
    }

    trackingRef.current = true;
    setTracking(true);
    onTrackingChange(true);
    setGpsMessage("Solicitando ubicación de alta precisión…");
    void requestWakeLock();

    const id = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) => {
        const map = mapRef.current;
        if (!map) return;

        if (coords.accuracy > MAX_GPS_ACCURACY_METERS) {
          arrivalCandidateRef.current = null;
          setGpsMessage(`Esperando una señal GPS más precisa (${Math.round(coords.accuracy)} m)`);
          return;
        }

        const rawPoint = L.latLng(coords.latitude, coords.longitude);
        const point = acceptPoint(rawPoint, coords.accuracy, timestamp);
        if (!point) {
          setGpsMessage("Verificando un cambio grande de ubicación…");
          return;
        }

        const previous = acceptedPointRef.current;
        const movedMeters = previous?.distanceTo(point) ?? 0;
        const elapsedSeconds = lastFixAtRef.current === null
          ? null
          : Math.max((timestamp - lastFixAtRef.current) / 1_000, 0.1);
        const derivedSpeed = elapsedSeconds === null ? null : movedMeters / elapsedSeconds;
        const gpsSpeed = coords.speed !== null && Number.isFinite(coords.speed) && coords.speed >= 0 ? coords.speed : null;
        const currentSpeed = gpsSpeed ?? derivedSpeed;
        const moving = currentSpeed !== null
          ? currentSpeed >= MOVING_SPEED_METERS_PER_SECOND
          : movedMeters >= MIN_TRAIL_STEP_METERS;
        const gpsHeading = coords.heading !== null && Number.isFinite(coords.heading) ? coords.heading : null;
        const calculatedHeading = gpsHeading ?? (
          previous && movedMeters >= MIN_TRAIL_STEP_METERS
            ? bearingBetween(previous, point)
            : headingRef.current
        );

        headingRef.current = normalizeHeading(calculatedHeading);
        acceptedPointRef.current = point;
        lastFixAtRef.current = timestamp;

        if (!truckRef.current) {
          renderedHeadingRef.current = headingRef.current;
          truckRef.current = L.marker(point, {
            icon: truckIcon(renderedHeadingRef.current, moving),
            zIndexOffset: 1_000,
          }).addTo(map);
          truckRef.current.bindTooltip(moving ? "Camión en movimiento" : "Camión detenido", {
            direction: "top",
            offset: [0, -28],
          });
          accuracyRef.current = L.circle(point, {
            radius: coords.accuracy,
            color: "#2486ff",
            fillColor: "#2486ff",
            fillOpacity: 0.08,
            weight: 1,
          }).addTo(map);
        } else {
          renderedHeadingRef.current = applyTruckAppearance(
            truckRef.current,
            headingRef.current,
            moving,
            renderedHeadingRef.current,
          );
          truckRef.current.setTooltipContent(moving ? "Camión en movimiento" : "Camión detenido");
          animateTruckTo(point, coords.accuracy);
        }

        if (movedMeters >= MIN_TRAIL_STEP_METERS) trailRef.current?.addLatLng(point);
        if (followRef.current) map.setView(point, Math.max(map.getZoom(), 17), { animate: true });

        const info: PositionInfo = {
          accuracy: coords.accuracy,
          speed: currentSpeed,
          heading: headingRef.current,
          moving,
        };
        positionInfoRef.current = info;
        setPositionInfo(info);
        setGpsMessage(moving ? "Camión avanzando en tiempo real" : "Camión localizado · señal estable");

        const state = liveStateRef.current;
        if (state.activeStop) {
          const distanceMeters = point.distanceTo(L.latLng(state.activeStop.lat, state.activeStop.lng));
          const arrivalRadius = Math.min(32, Math.max(22, 18 + coords.accuracy * 0.48));
          const slowEnough = currentSpeed === null || currentSpeed <= ARRIVAL_MAX_SPEED_METERS_PER_SECOND;
          const reliableArrival =
            coords.accuracy <= ARRIVAL_MAX_ACCURACY_METERS &&
            distanceMeters <= arrivalRadius &&
            slowEnough;

          if (reliableArrival) {
            const previousCandidate = arrivalCandidateRef.current;
            arrivalCandidateRef.current = previousCandidate?.stopId === state.activeStop.id
              ? {
                  ...previousCandidate,
                  confirmations: previousCandidate.confirmations + 1,
                }
              : {
                  stopId: state.activeStop.id,
                  confirmations: 1,
                  firstSeenAt: timestamp,
                };

            const candidate = arrivalCandidateRef.current;
            const confirmed =
              candidate.confirmations >= ARRIVAL_CONFIRMATIONS &&
              timestamp - candidate.firstSeenAt >= ARRIVAL_MIN_DWELL_MS;

            if (confirmed && arrivalRef.current !== state.activeStop.id) {
              arrivalRef.current = state.activeStop.id;
              navigator.vibrate?.([250, 120, 250]);
              if ("speechSynthesis" in window) {
                const message = state.privacyMode
                  ? `Llegaste a la dirección ${addressLabel(state.activeStop)}`
                  : `Llegaste a la parada de ${state.activeStop.name}, dirección ${addressLabel(state.activeStop)}`;
                const voice = new SpeechSynthesisUtterance(message);
                voice.lang = "es-CL";
                voice.rate = 0.96;
                window.speechSynthesis.cancel();
                window.speechSynthesis.speak(voice);
              }
              onArrival(state.activeStop, distanceMeters);
            }
          } else {
            arrivalCandidateRef.current = null;
          }
        }

        if (Date.now() - lastSyncRef.current >= SYNC_INTERVAL_MS) {
          lastSyncRef.current = Date.now();
          void sendTracking(point, info);
        }
      },
      (error) => {
        if (error.code === 1) {
          if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
          watchRef.current = null;
          trackingRef.current = false;
          setTracking(false);
          onTrackingChange(false);
          setGpsMessage("Debes permitir la ubicación para ver el camión");
          void releaseWakeLock();
          return;
        }

        if (truckRef.current) {
          renderedHeadingRef.current = applyTruckAppearance(
            truckRef.current,
            headingRef.current,
            false,
            renderedHeadingRef.current,
          );
        }
        setGpsMessage(error.code === 2
          ? "Señal GPS temporalmente no disponible · sigo intentando"
          : "El GPS tardó demasiado · sigo buscando ubicación");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );

    watchRef.current = id;
  };

  const changeMapStyle = (style: "streets" | "satellite") => {
    const map = mapRef.current;
    if (!map || style === mapStyle) return;
    baseLayerRef.current?.removeFrom(map);
    baseLayerRef.current = style === "streets"
      ? L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap",
        })
      : L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
          maxZoom: 19,
          attribution: "Imágenes &copy; Esri",
        });
    baseLayerRef.current.addTo(map).bringToBack();
    setMapStyle(style);
  };

  const centerRoute = () => {
    setFollow(false);
    mapRef.current?.fitBounds(
      L.latLngBounds(stops.map((stop) => [stop.lat, stop.lng] as [number, number])).pad(0.12),
    );
  };

  const centerTruck = () => {
    const point = truckRef.current?.getLatLng();
    if (!point || !mapRef.current) return;
    setFollow(true);
    mapRef.current.flyTo(point, 18);
  };

  return (
    <div className="map-shell live-map-shell">
      <div className="map-toolbar">
        <div>
          <span className={`gps-pulse ${tracking ? "on" : ""}`} />
          <div><strong>Mapa y seguimiento del camión</strong><small>{gpsMessage}</small></div>
        </div>
        <div className="map-buttons">
          <button className={tracking ? "tracking" : ""} onClick={startTracking}>{tracking ? "Detener GPS" : "Iniciar GPS"}</button>
          <button onClick={centerTruck} disabled={!positionInfo}>Seguir camión</button>
          <button onClick={centerRoute}>Ver ruta</button>
        </div>
      </div>
      <div className="map-style-switch" aria-label="Cambiar tipo de mapa">
        <button className={mapStyle === "streets" ? "active" : ""} onClick={() => changeMapStyle("streets")}>Calles de Chile</button>
        <button className={mapStyle === "satellite" ? "active" : ""} onClick={() => changeMapStyle("satellite")}>Vista satélite</button>
        <a href={`https://www.google.com/maps/@?api=1&map_action=map&center=${stops[0]?.lat},${stops[0]?.lng}&zoom=16`} target="_blank" rel="noreferrer">Abrir Google Maps ↗</a>
      </div>
      <div ref={mapElement} className="street-map" aria-label="Mapa con calles, paradas y ubicación del camión" />
      <div className="map-caption live-caption">
        <span>{mapStyle === "streets" ? "Calles reales de Chile · OpenStreetMap" : "Imágenes satelitales · Esri"} · {stops.length} paradas</span>
        <span>{positionInfo ? `${positionInfo.moving ? "En movimiento" : "Detenido"} · ${positionInfo.speed === null ? "velocidad sin datos" : `${Math.round(positionInfo.speed * 3.6)} km/h`} · precisión ${Math.round(positionInfo.accuracy)} m` : "Activa el GPS desde el teléfono del camión"}</span>
      </div>
      <p className="gps-privacy">GPS reforzado: mantiene la pantalla activa, recupera pérdidas de señal, suaviza el movimiento y confirma la llegada con varias lecturas precisas.</p>
    </div>
  );
}
