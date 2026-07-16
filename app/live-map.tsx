"use client";

import { useEffect, useRef, useState } from "react";
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

type PositionInfo = { accuracy: number; speed: number | null; heading: number; moving: boolean };
type PendingJump = { point: L.LatLng; count: number; at: number };

const OUTBOX_KEY = "santuario-tracking-outbox-v2";
const MAX_GPS_ACCURACY_METERS = 60;
const ARRIVAL_MAX_ACCURACY_METERS = 25;
const ARRIVAL_RADIUS_METERS = 30;
const ARRIVAL_CONFIRMATIONS = 3;
const MIN_TRAIL_STEP_METERS = 2.5;
const MOVING_SPEED_METERS_PER_SECOND = 0.8;
const MAX_NORMAL_JUMP_METERS = 220;
const GPS_RESET_AFTER_MS = 20_000;

function protectedStopLabel(stop: Stop) {
  return stop.address ?? `Punto GPS ${stop.id}`;
}

function journeyId() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return `santuario-${parts}`;
}

export default function LiveMap(props: Props) {
  const { stops, statuses, activeId, activeStop, completed, done, absent, pending, total, kilos, routeKm, estimatedMinutes, startedAt, onTrackingChange, onArrival } = props;
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const stopsLayerRef = useRef<L.LayerGroup | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const truckRef = useRef<L.Marker | null>(null);
  const accuracyRef = useRef<L.Circle | null>(null);
  const trailRef = useRef<L.Polyline | null>(null);
  const watchRef = useRef<number | null>(null);
  const acceptedPointRef = useRef<L.LatLng | null>(null);
  const lastFixAtRef = useRef<number | null>(null);
  const pendingJumpRef = useRef<PendingJump | null>(null);
  const headingRef = useRef(0);
  const renderedHeadingRef = useRef(0);
  const arrivalRef = useRef<string | null>(null);
  const arrivalConfirmationsRef = useRef(0);
  const lastSyncRef = useRef(0);
  const followRef = useRef(true);
  const liveStateRef = useRef({ activeStop, completed, done, absent, pending, total, kilos, routeKm, estimatedMinutes, startedAt });
  const [tracking, setTracking] = useState(false);
  const [follow, setFollow] = useState(true);
  const [gpsMessage, setGpsMessage] = useState("GPS detenido");
  const [positionInfo, setPositionInfo] = useState<PositionInfo | null>(null);
  const [mapStyle, setMapStyle] = useState<"streets" | "satellite">("streets");

  useEffect(() => { followRef.current = follow; }, [follow]);
  useEffect(() => {
    arrivalRef.current = null;
    arrivalConfirmationsRef.current = 0;
  }, [activeId]);
  useEffect(() => {
    liveStateRef.current = { activeStop, completed, done, absent, pending, total, kilos, routeKm, estimatedMinutes, startedAt };
  }, [activeStop, completed, done, absent, pending, total, kilos, routeKm, estimatedMinutes, startedAt]);

  useEffect(() => {
    const flush = async () => {
      const queued = localStorage.getItem(OUTBOX_KEY);
      if (!queued) return;
      try {
        const response = await fetch("/api/tracking", { method: "POST", headers: { "Content-Type": "application/json" }, body: queued });
        if (response.ok) localStorage.removeItem(OUTBOX_KEY);
      } catch {}
    };
    window.addEventListener("online", flush);
    if (navigator.onLine) void flush();
    return () => window.removeEventListener("online", flush);
  }, []);

  useEffect(() => {
    if (!mapElement.current || mapRef.current) return;
    const map = L.map(mapElement.current, { zoomControl: true, attributionControl: true });
    baseLayerRef.current = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(map);
    mapRef.current = map;
    stopsLayerRef.current = L.layerGroup().addTo(map);
    trailRef.current = L.polyline([], { color: "#0f6f54", weight: 6, opacity: 0.88, lineCap: "round", lineJoin: "round" }).addTo(map);
    map.fitBounds(L.latLngBounds(stops.map((stop) => [stop.lat, stop.lng] as [number, number])).pad(0.12));
    return () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const layer = stopsLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    const controller = new AbortController();
    layer.clearLayers();
    void getRoadRoute(stops, controller.signal).then((roadPoints) => {
      if (!roadPoints.length || controller.signal.aborted) return;
      L.polyline(roadPoints, { color: "#1d8062", weight: 5, opacity: 0.82, lineCap: "round", lineJoin: "round" }).addTo(layer).bringToBack();
    }).catch(() => setGpsMessage("Paradas visibles · trazado por calles no disponible"));

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
      marker.bindTooltip(`${index + 1}. ${protectedStopLabel(stop)}`, { direction: "top", offset: [0, -12] });
    });
    return () => controller.abort();
  }, [stops, statuses, activeId]);

  const acceptPoint = (raw: L.LatLng, accuracy: number, timestamp: number) => {
    const previous = acceptedPointRef.current;
    if (!previous) return raw;
    const distance = previous.distanceTo(raw);
    const gap = lastFixAtRef.current === null ? 0 : timestamp - lastFixAtRef.current;
    if (distance <= MAX_NORMAL_JUMP_METERS) {
      pendingJumpRef.current = null;
    } else if (gap >= GPS_RESET_AFTER_MS) {
      pendingJumpRef.current = null;
      setGpsMessage("GPS recuperado después de perder señal");
      return raw;
    } else {
      const pendingJump = pendingJumpRef.current;
      const consistent = pendingJump && pendingJump.point.distanceTo(raw) <= Math.max(accuracy * 1.5, 35);
      pendingJumpRef.current = { point: raw, count: consistent ? pendingJump.count + 1 : 1, at: timestamp };
      if (pendingJumpRef.current.count >= 3) {
        pendingJumpRef.current = null;
        setGpsMessage("Nueva ubicación GPS confirmada");
        return raw;
      }
      return null;
    }
    if (distance < MIN_TRAIL_STEP_METERS) return previous;
    const alpha = accuracy <= 10 ? 0.72 : accuracy <= 25 ? 0.52 : 0.34;
    return L.latLng(previous.lat + (raw.lat - previous.lat) * alpha, previous.lng + (raw.lng - previous.lng) * alpha);
  };

  const stopTracking = () => {
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    acceptedPointRef.current = null;
    lastFixAtRef.current = null;
    pendingJumpRef.current = null;
    arrivalConfirmationsRef.current = 0;
    setTracking(false);
    onTrackingChange(false);
    setGpsMessage("GPS detenido");
  };

  const startTracking = () => {
    if (tracking) return stopTracking();
    if (!navigator.geolocation) return setGpsMessage("Este dispositivo no tiene GPS disponible");
    setGpsMessage("Solicitando ubicación…");
    const id = navigator.geolocation.watchPosition(({ coords, timestamp }) => {
      const map = mapRef.current;
      if (!map) return;
      if (coords.accuracy > MAX_GPS_ACCURACY_METERS) {
        arrivalConfirmationsRef.current = 0;
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
      const elapsedSeconds = lastFixAtRef.current === null ? null : Math.max((timestamp - lastFixAtRef.current) / 1000, 0.1);
      const derivedSpeed = elapsedSeconds === null ? null : movedMeters / elapsedSeconds;
      const currentSpeed = coords.speed !== null && Number.isFinite(coords.speed) ? coords.speed : derivedSpeed;
      const moving = currentSpeed !== null ? currentSpeed >= MOVING_SPEED_METERS_PER_SECOND : movedMeters >= MIN_TRAIL_STEP_METERS;
      const calculatedHeading = coords.heading !== null && Number.isFinite(coords.heading)
        ? coords.heading
        : previous && movedMeters >= MIN_TRAIL_STEP_METERS ? bearingBetween(previous, point) : headingRef.current;
      headingRef.current = normalizeHeading(calculatedHeading);
      acceptedPointRef.current = point;
      lastFixAtRef.current = timestamp;

      if (!truckRef.current) {
        renderedHeadingRef.current = headingRef.current;
        truckRef.current = L.marker(point, { icon: truckIcon(renderedHeadingRef.current, moving), zIndexOffset: 1000 }).addTo(map);
        accuracyRef.current = L.circle(point, { radius: coords.accuracy, color: "#2486ff", fillColor: "#2486ff", fillOpacity: 0.08, weight: 1 }).addTo(map);
      } else {
        renderedHeadingRef.current = applyTruckAppearance(truckRef.current, headingRef.current, moving, renderedHeadingRef.current);
        truckRef.current.setLatLng(point);
        accuracyRef.current?.setLatLng(point).setRadius(coords.accuracy);
      }
      if (movedMeters >= MIN_TRAIL_STEP_METERS) trailRef.current?.addLatLng(point);
      if (followRef.current) map.setView(point, Math.max(map.getZoom(), 17));
      setPositionInfo({ accuracy: coords.accuracy, speed: currentSpeed, heading: headingRef.current, moving });
      setGpsMessage(moving ? "Camión avanzando en tiempo real" : "Camión localizado · esperando movimiento");

      const state = liveStateRef.current;
      if (state.activeStop) {
        const distanceMeters = point.distanceTo(L.latLng(state.activeStop.lat, state.activeStop.lng));
        const reliableArrival = coords.accuracy <= ARRIVAL_MAX_ACCURACY_METERS && distanceMeters <= ARRIVAL_RADIUS_METERS;
        arrivalConfirmationsRef.current = reliableArrival ? arrivalConfirmationsRef.current + 1 : 0;
        if (arrivalConfirmationsRef.current >= ARRIVAL_CONFIRMATIONS && arrivalRef.current !== state.activeStop.id) {
          arrivalRef.current = state.activeStop.id;
          navigator.vibrate?.([250, 120, 250]);
          if ("speechSynthesis" in window) {
            const voice = new SpeechSynthesisUtterance(`Llegaste a la dirección ${protectedStopLabel(state.activeStop)}`);
            voice.lang = "es-CL";
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(voice);
          }
          onArrival(state.activeStop, distanceMeters);
        }
      }

      if (Date.now() - lastSyncRef.current >= 5000) {
        lastSyncRef.current = Date.now();
        const payload = JSON.stringify({
          journeyId: journeyId(), lat: point.lat, lng: point.lng, speed: currentSpeed,
          heading: headingRef.current, accuracy: coords.accuracy,
          nextStop: state.activeStop ? protectedStopLabel(state.activeStop) : null,
          completed: state.completed, done: state.done, absent: state.absent, pending: state.pending,
          total: state.total, kilos: state.kilos, routeKm: state.routeKm,
          estimatedMinutes: state.estimatedMinutes, startedAt: state.startedAt,
          status: state.completed >= state.total ? "finished" : "active",
        });
        fetch("/api/tracking", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload })
          .then((response) => { if (!response.ok) throw new Error("sync failed"); localStorage.removeItem(OUTBOX_KEY); })
          .catch(() => localStorage.setItem(OUTBOX_KEY, payload));
      }
    }, (error) => {
      setTracking(false);
      watchRef.current = null;
      onTrackingChange(false);
      setGpsMessage(error.code === 1 ? "Debes permitir la ubicación para ver el camión" : "No pude obtener la señal GPS");
    }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
    watchRef.current = id;
    setTracking(true);
    onTrackingChange(true);
  };

  const changeMapStyle = (style: "streets" | "satellite") => {
    const map = mapRef.current;
    if (!map || style === mapStyle) return;
    baseLayerRef.current?.removeFrom(map);
    baseLayerRef.current = style === "streets"
      ? L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" })
      : L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Imágenes &copy; Esri" });
    baseLayerRef.current.addTo(map).bringToBack();
    setMapStyle(style);
  };

  return <div className="map-shell live-map-shell">
    <div className="map-toolbar"><div><span className={`gps-pulse ${tracking ? "on" : ""}`} /><div><strong>Mapa y seguimiento del camión</strong><small>{gpsMessage}</small></div></div>
      <div className="map-buttons"><button className={tracking ? "tracking" : ""} onClick={startTracking}>{tracking ? "Detener GPS" : "Iniciar GPS"}</button><button onClick={() => { const point = truckRef.current?.getLatLng(); if (point && mapRef.current) { setFollow(true); mapRef.current.flyTo(point, 18); } }} disabled={!positionInfo}>Seguir camión</button><button onClick={() => { setFollow(false); mapRef.current?.fitBounds(L.latLngBounds(stops.map((stop) => [stop.lat, stop.lng] as [number, number])).pad(0.12)); }}>Ver ruta</button></div>
    </div>
    <div className="map-style-switch"><button className={mapStyle === "streets" ? "active" : ""} onClick={() => changeMapStyle("streets")}>Calles de Chile</button><button className={mapStyle === "satellite" ? "active" : ""} onClick={() => changeMapStyle("satellite")}>Vista satélite</button><a href={`https://www.google.com/maps/@?api=1&map_action=map&center=${stops[0]?.lat},${stops[0]?.lng}&zoom=16`} target="_blank" rel="noreferrer">Abrir Google Maps ↗</a></div>
    <div ref={mapElement} className="street-map" aria-label="Mapa con calles, paradas y ubicación del camión" />
    <div className="map-caption live-caption"><span>{mapStyle === "streets" ? "Calles reales de Chile · OpenStreetMap" : "Imágenes satelitales · Esri"} · {stops.length} paradas</span><span>{positionInfo ? `${positionInfo.moving ? "En movimiento" : "Detenido"} · ${positionInfo.speed === null ? "velocidad sin datos" : `${Math.round(positionInfo.speed * 3.6)} km/h`} · precisión ${Math.round(positionInfo.accuracy)} m` : "Activa el GPS desde el teléfono del camión"}</span></div>
    <p className="gps-privacy">La llegada se confirma con tres lecturas precisas. Si se pierde la señal, el GPS recupera la nueva ubicación sin quedar congelado.</p>
  </div>;
}
