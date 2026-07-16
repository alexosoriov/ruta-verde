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

type PositionInfo = {
  accuracy: number;
  speed: number | null;
  heading: number;
  moving: boolean;
};

function metersBetween(a: L.LatLng, stop: Stop) {
  return a.distanceTo(L.latLng(stop.lat, stop.lng));
}

function protectedStopLabel(stop: Stop) {
  return stop.address ?? `Punto GPS ${stop.id}`;
}

const OUTBOX_KEY = "santuario-tracking-outbox";
const MAX_GPS_ACCURACY_METERS = 80;
const MIN_TRAIL_STEP_METERS = 2.5;
const MOVING_SPEED_METERS_PER_SECOND = 0.8;

function smoothGpsPoint(previous: L.LatLng | null, raw: L.LatLng, accuracy: number) {
  if (!previous) return raw;
  const distance = previous.distanceTo(raw);
  if (distance > 220) return null;
  if (distance < MIN_TRAIL_STEP_METERS) return previous;
  const alpha = accuracy <= 10 ? 0.72 : accuracy <= 25 ? 0.52 : 0.34;
  return L.latLng(
    previous.lat + (raw.lat - previous.lat) * alpha,
    previous.lng + (raw.lng - previous.lng) * alpha,
  );
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
  const initialStops = useRef(stops);
  const mapRef = useRef<L.Map | null>(null);
  const stopsLayerRef = useRef<L.LayerGroup | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const truckRef = useRef<L.Marker | null>(null);
  const accuracyRef = useRef<L.Circle | null>(null);
  const trailRef = useRef<L.Polyline | null>(null);
  const watchRef = useRef<number | null>(null);
  const acceptedPointRef = useRef<L.LatLng | null>(null);
  const lastFixAtRef = useRef<number | null>(null);
  const headingRef = useRef(0);
  const renderedHeadingRef = useRef(0);
  const animationRef = useRef<number | null>(null);
  const followRef = useRef(true);
  const arrivalRef = useRef<string | null>(null);
  const lastSyncRef = useRef(0);
  const liveStateRef = useRef({ activeStop, completed, done, absent, pending, total, kilos, routeKm, estimatedMinutes, startedAt, privacyMode });
  const [tracking, setTracking] = useState(false);
  const [follow, setFollow] = useState(true);
  const [gpsMessage, setGpsMessage] = useState("GPS detenido");
  const [positionInfo, setPositionInfo] = useState<PositionInfo | null>(null);
  const [mapStyle, setMapStyle] = useState<"streets" | "satellite">("streets");

  useEffect(() => { followRef.current = follow; }, [follow]);
  useEffect(() => { arrivalRef.current = null; }, [activeId]);
  useEffect(() => {
    liveStateRef.current = { activeStop, completed, done, absent, pending, total, kilos, routeKm, estimatedMinutes, startedAt, privacyMode };
  }, [activeStop, completed, done, absent, pending, total, kilos, routeKm, estimatedMinutes, startedAt, privacyMode]);

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
    baseLayerRef.current = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);
    mapRef.current = map;
    stopsLayerRef.current = L.layerGroup().addTo(map);
    trailRef.current = L.polyline([], {
      color: "#0f6f54", weight: 6, opacity: 0.88,
      lineCap: "round", lineJoin: "round", smoothFactor: 1.4,
    }).addTo(map);
    const bounds = L.latLngBounds(initialStops.current.map((stop) => [stop.lat, stop.lng] as [number, number]));
    map.fitBounds(bounds.pad(0.12));

    return () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const updateTruckAppearance = (heading: number, moving: boolean) => {
    const marker = truckRef.current;
    if (!marker) return;
    renderedHeadingRef.current = applyTruckAppearance(marker, heading, moving, renderedHeadingRef.current);
  };

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
    const duration = Math.min(1200, Math.max(420, distance * 55));
    const startedAt = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
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

  useEffect(() => {
    const layer = stopsLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    const controller = new AbortController();
    layer.clearLayers();

    void getRoadRoute(stops, controller.signal).then((roadPoints) => {
      if (!roadPoints.length || controller.signal.aborted) return;
      L.polyline(roadPoints, {
        color: "#1d8062", weight: 5, opacity: 0.82,
        lineCap: "round", lineJoin: "round", smoothFactor: 1,
      }).addTo(layer).bringToBack();
    }).catch(() => {
      if (!controller.signal.aborted) setGpsMessage("Paradas visibles · esperando trazado por calles");
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
      const label = document.createElement("span");
      label.className = "map-stop-label";
      label.textContent = `${index + 1}. ${privacyMode ? protectedStopLabel(stop) : stop.name}`;
      marker.bindTooltip(label, { direction: "top", offset: [0, -12] });
      marker.on("click", () => map.flyTo([stop.lat, stop.lng], Math.max(map.getZoom(), 17)));
    });
    return () => controller.abort();
  }, [stops, statuses, activeId, privacyMode]);

  const stopTracking = () => {
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    watchRef.current = null;
    acceptedPointRef.current = null;
    lastFixAtRef.current = null;
    updateTruckAppearance(headingRef.current, false);
    setTracking(false);
    onTrackingChange(false);
    setGpsMessage("GPS detenido");
  };

  const startTracking = () => {
    if (tracking) return stopTracking();
    if (!navigator.geolocation) {
      setGpsMessage("Este dispositivo no tiene GPS disponible");
      return;
    }
    setGpsMessage("Solicitando ubicación…");
    const id = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) => {
        const map = mapRef.current;
        if (!map) return;
        if (coords.accuracy > MAX_GPS_ACCURACY_METERS) {
          setGpsMessage(`Esperando una señal GPS más precisa (${Math.round(coords.accuracy)} m)`);
          return;
        }
        const rawPoint = L.latLng(coords.latitude, coords.longitude);
        const point = smoothGpsPoint(acceptedPointRef.current, rawPoint, coords.accuracy);
        if (!point) {
          setGpsMessage("Corrigiendo un salto impreciso del GPS…");
          return;
        }
        const previousPoint = acceptedPointRef.current;
        const movedMeters = previousPoint?.distanceTo(point) ?? 0;
        const elapsedSeconds = lastFixAtRef.current === null ? null : Math.max((timestamp - lastFixAtRef.current) / 1000, 0.1);
        const derivedSpeed = elapsedSeconds === null ? null : movedMeters / elapsedSeconds;
        const gpsSpeed = coords.speed !== null && Number.isFinite(coords.speed) ? coords.speed : null;
        const currentSpeed = gpsSpeed ?? derivedSpeed;
        const moving = currentSpeed !== null
          ? currentSpeed >= MOVING_SPEED_METERS_PER_SECOND
          : movedMeters >= MIN_TRAIL_STEP_METERS;
        const gpsHeading = coords.heading !== null && Number.isFinite(coords.heading) ? coords.heading : null;
        const calculatedHeading = gpsHeading ?? (previousPoint && movedMeters >= MIN_TRAIL_STEP_METERS
          ? bearingBetween(previousPoint, point)
          : headingRef.current);
        headingRef.current = normalizeHeading(calculatedHeading);
        lastFixAtRef.current = timestamp;
        acceptedPointRef.current = point;

        if (!truckRef.current) {
          renderedHeadingRef.current = headingRef.current;
          truckRef.current = L.marker(point, { icon: truckIcon(renderedHeadingRef.current, moving), zIndexOffset: 1000 }).addTo(map);
          truckRef.current.bindTooltip(moving ? "Camión en movimiento" : "Camión detenido", { permanent: false, direction: "top", offset: [0, -28] });
          accuracyRef.current = L.circle(point, { radius: coords.accuracy, color: "#2486ff", fillColor: "#2486ff", fillOpacity: 0.08, weight: 1 }).addTo(map);
        } else {
          updateTruckAppearance(headingRef.current, moving);
          animateTruckTo(point, coords.accuracy);
        }
        if (movedMeters >= MIN_TRAIL_STEP_METERS) trailRef.current?.addLatLng(point);
        if (followRef.current) map.setView(point, Math.max(map.getZoom(), 17), { animate: true });
        setPositionInfo({ accuracy: coords.accuracy, speed: currentSpeed, heading: headingRef.current, moving });
        setGpsMessage(moving ? "Camión avanzando en tiempo real" : "Camión localizado · esperando movimiento");
        setTracking(true);

        const currentState = liveStateRef.current;
        if (currentState.activeStop) {
          const distanceMeters = metersBetween(point, currentState.activeStop);
          if (distanceMeters <= 30 && arrivalRef.current !== currentState.activeStop.id) {
            arrivalRef.current = currentState.activeStop.id;
            navigator.vibrate?.([250, 120, 250]);
            if ("speechSynthesis" in window) {
              window.speechSynthesis.speak(new SpeechSynthesisUtterance(`Llegaste a ${currentState.privacyMode ? `la dirección ${protectedStopLabel(currentState.activeStop)}` : `la parada de ${currentState.activeStop.name}`}`));
            }
            onArrival(currentState.activeStop, distanceMeters);
          }
        }

        if (Date.now() - lastSyncRef.current >= 5000) {
          lastSyncRef.current = Date.now();
          const payload = JSON.stringify({
            lat: point.lat, lng: point.lng, speed: currentSpeed,
            heading: headingRef.current, accuracy: coords.accuracy,
            nextStop: currentState.activeStop ? (currentState.privacyMode ? protectedStopLabel(currentState.activeStop) : currentState.activeStop.name) : null,
            completed: currentState.completed,
            done: currentState.done,
            absent: currentState.absent,
            pending: currentState.pending,
            total: currentState.total,
            kilos: currentState.kilos,
            routeKm: currentState.routeKm,
            estimatedMinutes: currentState.estimatedMinutes,
            startedAt: currentState.startedAt,
            status: currentState.completed >= currentState.total ? "finished" : "active",
          });
          fetch("/api/tracking", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload })
            .then((response) => { if (!response.ok) throw new Error("sync failed"); localStorage.removeItem(OUTBOX_KEY); })
            .catch(() => localStorage.setItem(OUTBOX_KEY, payload));
        }
      },
      (error) => {
        updateTruckAppearance(headingRef.current, false);
        setTracking(false);
        watchRef.current = null;
        onTrackingChange(false);
        setGpsMessage(error.code === 1 ? "Debes permitir la ubicación para ver el camión" : "No pude obtener la señal GPS");
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );
    watchRef.current = id;
    onTrackingChange(true);
  };

  const centerRoute = () => {
    const map = mapRef.current;
    if (!map) return;
    setFollow(false);
    map.fitBounds(L.latLngBounds(stops.map((stop) => [stop.lat, stop.lng] as [number, number])).pad(0.12));
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
      <p className="gps-privacy">Con el GPS activo, la ubicación se comparte únicamente con el panel privado de jefatura. Sin señal queda en espera y se sincroniza al volver internet.</p>
    </div>
  );
}
