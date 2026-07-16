"use client";

import { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { STOPS } from "./route-data";
import { getRoadRoute } from "./road-route";

type Tracking = {
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  next_stop: string | null;
  completed: number;
  total: number;
  status: string;
  updated_at: number;
};

function sharedTruckIcon() {
  return L.divIcon({
    className: "truck-marker-wrap",
    html: '<div class="shared-truck">🚛</div>',
    iconSize: [52, 52],
    iconAnchor: [26, 26],
  });
}

export default function ManagerPanel() {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const truckRef = useRef<L.Marker | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(true);
  const [ageSeconds, setAgeSeconds] = useState<number | null>(null);
  const [mapStyle, setMapStyle] = useState<"streets" | "satellite">("streets");

  useEffect(() => {
    if (!mapElement.current || mapRef.current) return;
    const map = L.map(mapElement.current, { zoomControl: true });
    baseLayerRef.current = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);
    const controller = new AbortController();
    void getRoadRoute(STOPS, controller.signal).then((roadPoints) => {
      if (!roadPoints.length || controller.signal.aborted) return;
      L.polyline(roadPoints, {
        color: "#1d8062", weight: 5, opacity: 0.82,
        lineCap: "round", lineJoin: "round", smoothFactor: 1,
      }).addTo(map).bringToBack();
    }).catch(() => {});
    STOPS.forEach((stop, index) => {
      L.circleMarker([stop.lat, stop.lng], {
        radius: 5, color: "#fff", weight: 2, fillColor: "#173e33", fillOpacity: 1,
      }).bindTooltip(`${index + 1}. ${stop.name}`).addTo(map);
    });
    map.fitBounds(L.latLngBounds(STOPS.map((stop) => [stop.lat, stop.lng] as [number, number])).pad(0.12));
    mapRef.current = map;
    return () => { controller.abort(); map.remove(); mapRef.current = null; };
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
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/tracking", { cache: "no-store" });
        if (!response.ok) throw new Error("tracking unavailable");
        const data = await response.json() as { tracking: Tracking | null };
        if (!active) return;
        setTracking(data.tracking);
        setAgeSeconds(data.tracking ? Math.max(0, Math.round((Date.now() - data.tracking.updated_at) / 1000)) : null);
        setConnected(true);
        if (data.tracking && mapRef.current) {
          const point = L.latLng(data.tracking.lat, data.tracking.lng);
          if (!truckRef.current) {
            truckRef.current = L.marker(point, { icon: sharedTruckIcon(), zIndexOffset: 1000 }).addTo(mapRef.current);
          } else truckRef.current.setLatLng(point);
        }
      } catch {
        if (active) setConnected(false);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(load, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const progress = tracking ? Math.round((tracking.completed / Math.max(1, tracking.total)) * 100) : 0;

  return (
    <section className="manager-view">
      <div className="manager-heading">
        <div><p className="eyebrow"><span /> Supervisión en vivo</p><h1>Panel de jefatura</h1><p>Ubicación, avance y próxima parada del camión en una sola pantalla.</p></div>
        <div className={`connection-badge ${connected ? "online" : "offline"}`}><i />{connected ? "Conectado" : "Sin conexión"}</div>
      </div>
      <div className="manager-grid">
        <div className="manager-map-card">
          <div className="map-style-switch manager-map-switch" aria-label="Cambiar tipo de mapa de jefatura">
            <button className={mapStyle === "streets" ? "active" : ""} onClick={() => changeMapStyle("streets")}>Calles</button>
            <button className={mapStyle === "satellite" ? "active" : ""} onClick={() => changeMapStyle("satellite")}>Satélite</button>
            <a href="https://www.google.com/maps/@?api=1&map_action=map&center=-41.461,-72.899&zoom=16" target="_blank" rel="noreferrer">Google Maps ↗</a>
          </div>
          <div ref={mapElement} className="manager-map" aria-label="Ubicación compartida del camión" />
          <div className="manager-map-footer">Actualización automática cada 5 segundos {ageSeconds !== null ? `· último dato hace ${ageSeconds} s` : ""}</div>
        </div>
        <aside className="manager-summary">
          {loading ? <p>Cargando seguimiento…</p> : tracking ? <>
            <span className="manager-kicker">Jornada Santuario · Viernes</span>
            <div className="manager-progress-number">{progress}%</div>
            <div className="progress-track manager-track"><i style={{ width: `${progress}%` }} /></div>
            <div className="manager-metrics">
              <article><span>Completadas</span><strong>{tracking.completed}/{tracking.total}</strong></article>
              <article><span>Velocidad</span><strong>{tracking.speed === null ? "—" : `${Math.round(tracking.speed * 3.6)} km/h`}</strong></article>
              <article><span>Precisión GPS</span><strong>{tracking.accuracy === null ? "—" : `${Math.round(tracking.accuracy)} m`}</strong></article>
            </div>
            <div className="manager-next"><span>Próxima parada</span><strong>{tracking.next_stop || "Sin información"}</strong></div>
            <p className="manager-note">El conductor debe mantener activo el botón GPS para compartir su posición.</p>
          </> : <div className="empty-tracking"><strong>Todavía no hay ubicación</strong><p>Abre la vista Conductor desde el teléfono del camión y presiona “Iniciar GPS”.</p></div>}
        </aside>
      </div>
    </section>
  );
}
