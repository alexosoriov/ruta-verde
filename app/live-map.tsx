"use client";

import { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Stop } from "./route-data";
import { getRoadRoute } from "./road-route";

type Props = {
  stops: Stop[];
  statuses: Record<string, "pending" | "done" | "absent">;
  activeId?: string;
  activeStop?: Stop;
  completed: number;
  total: number;
  onArrival: (stop: Stop, distanceMeters: number) => void;
};

type PositionInfo = {
  accuracy: number;
  speed: number | null;
  heading: number;
};

function bearing(from: L.LatLng, to: L.LatLng) {
  const a1 = (from.lat * Math.PI) / 180;
  const a2 = (to.lat * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(a2);
  const x = Math.cos(a1) * Math.sin(a2) - Math.sin(a1) * Math.cos(a2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180) / Math.PI + 360;
}

function truckIcon(heading: number) {
  return L.divIcon({
    className: "truck-marker-wrap",
    html: `<div class="truck-heading" style="transform:rotate(${heading % 360}deg)"><span class="truck-arrow">▲</span><span class="truck-emoji">🚛</span></div>`,
    iconSize: [54, 62],
    iconAnchor: [27, 35],
  });
}

function metersBetween(a: L.LatLng, stop: Stop) {
  return a.distanceTo(L.latLng(stop.lat, stop.lng));
}

const OUTBOX_KEY = "santuario-tracking-outbox";
const MAX_GPS_ACCURACY_METERS = 80;
const MIN_TRAIL_STEP_METERS = 2.5;

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

export default function LiveMap({ stops, statuses, activeId, activeStop, completed, total, onArrival }: Props) {
  const mapElement = useRef<HTMLDivElement>(null);
  const initialStops = useRef(stops);
  const mapRef = useRef<L.Map | null>(null);
  const stopsLayerRef = useRef<L.LayerGroup | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const truckRef = useRef<L.Marker | null>(null);
  const accuracyRef = useRef<L.Circle | null>(null);
  const trailRef = useRef<L.Polyline | null>(null);
  const watchRef = useRef<number | null>(null);
  const previousRef = useRef<L.LatLng | null>(null);
  const acceptedPointRef = useRef<L.LatLng | null>(null);
  const followRef = useRef(true);
  const arrivalRef = useRef<string | null>(null);
  const lastSyncRef = useRef(0);
  const [tracking, setTracking] = useState(false);
  const [follow, setFollow] = useState(true);
  const [gpsMessage, setGpsMessage] = useState("GPS detenido");
  const [positionInfo, setPositionInfo] = useState<PositionInfo | null>(null);
  const [mapStyle, setMapStyle] = useState<"streets" | "satellite">("streets");

  useEffect(() => { followRef.current = follow; }, [follow]);
  useEffect(() => { arrivalRef.current = null; }, [activeId]);

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
      map.remove();
      mapRef.current = null;
    };
  }, []);

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
      label.textContent = `${index + 1}. ${stop.name}`;
      marker.bindTooltip(label, { direction: "top", offset: [0, -12] });
      marker.on("click", () => map.flyTo([stop.lat, stop.lng], Math.max(map.getZoom(), 17)));
    });
    return () => controller.abort();
  }, [stops, statuses, activeId]);

  const stopTracking = () => {
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    setTracking(false);
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
      ({ coords }) => {
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
        const movedMeters = acceptedPointRef.current?.distanceTo(point) ?? Infinity;
        const calculatedHeading = coords.heading ?? (previousRef.current ? bearing(previousRef.current, point) : 0);
        if (movedMeters >= MIN_TRAIL_STEP_METERS) previousRef.current = point;
        acceptedPointRef.current = point;

        if (!truckRef.current) {
          truckRef.current = L.marker(point, { icon: truckIcon(calculatedHeading), zIndexOffset: 1000 }).addTo(map);
          truckRef.current.bindTooltip("Camión en movimiento", { permanent: false, direction: "top" });
          accuracyRef.current = L.circle(point, { radius: coords.accuracy, color: "#2486ff", fillColor: "#2486ff", fillOpacity: 0.08, weight: 1 }).addTo(map);
        } else {
          truckRef.current.setLatLng(point).setIcon(truckIcon(calculatedHeading));
          accuracyRef.current?.setLatLng(point).setRadius(coords.accuracy);
        }
        if (movedMeters >= MIN_TRAIL_STEP_METERS) trailRef.current?.addLatLng(point);
        if (followRef.current) map.setView(point, Math.max(map.getZoom(), 17), { animate: true });
        setPositionInfo({ accuracy: coords.accuracy, speed: coords.speed, heading: calculatedHeading % 360 });
        setGpsMessage("Camión localizado en tiempo real");
        setTracking(true);

        if (activeStop) {
          const distanceMeters = metersBetween(point, activeStop);
          if (distanceMeters <= 30 && arrivalRef.current !== activeStop.id) {
            arrivalRef.current = activeStop.id;
            navigator.vibrate?.([250, 120, 250]);
            if ("speechSynthesis" in window) {
              window.speechSynthesis.speak(new SpeechSynthesisUtterance(`Llegaste a la parada de ${activeStop.name}`));
            }
            onArrival(activeStop, distanceMeters);
          }
        }

        if (Date.now() - lastSyncRef.current >= 5000) {
          lastSyncRef.current = Date.now();
          const payload = JSON.stringify({
            lat: point.lat, lng: point.lng, speed: coords.speed,
            heading: calculatedHeading % 360, accuracy: coords.accuracy,
            nextStop: activeStop?.name ?? null, completed, total,
            status: completed >= total ? "finished" : "active",
          });
          fetch("/api/tracking", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload })
            .then((response) => { if (!response.ok) throw new Error("sync failed"); localStorage.removeItem(OUTBOX_KEY); })
            .catch(() => localStorage.setItem(OUTBOX_KEY, payload));
        }
      },
      (error) => {
        setTracking(false);
        watchRef.current = null;
        setGpsMessage(error.code === 1 ? "Debes permitir la ubicación para ver el camión" : "No pude obtener la señal GPS");
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );
    watchRef.current = id;
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
        <span>{positionInfo ? `${positionInfo.speed === null ? "Velocidad sin datos" : `${Math.round(positionInfo.speed * 3.6)} km/h`} · precisión ${Math.round(positionInfo.accuracy)} m` : "Activa el GPS desde el teléfono del camión"}</span>
      </div>
      <p className="gps-privacy">Con el GPS activo, la ubicación se comparte únicamente con el panel privado de jefatura. Sin señal queda en espera y se sincroniza al volver internet.</p>
    </div>
  );
}
