"use client";

import { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { STOPS } from "./route-data";
import { getRoadRoute } from "./road-route";

type ActivityEntry = {
  id: string;
  stopId: string;
  stopName: string;
  status: "done" | "absent";
  at: number;
};

export type LocalSummary = {
  total: number;
  done: number;
  absent: number;
  pending: number;
  nextStop: string | null;
  startedAt: number | null;
  kilos: number;
  estimatedMinutes: number;
  activity: ActivityEntry[];
  presentationMode: boolean;
};

type Props = { localSummary: LocalSummary };

type Tracking = {
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  next_stop: string | null;
  completed: number;
  done?: number | null;
  absent?: number | null;
  pending?: number | null;
  total: number;
  kilos?: number | null;
  route_km?: number | null;
  estimated_minutes?: number | null;
  started_at?: number | null;
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

function formatMinutes(value: number) {
  if (value < 60) return `${value} min`;
  return `${Math.floor(value / 60)} h ${value % 60} min`;
}

export default function ManagerPanel({ localSummary }: Props) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const truckRef = useRef<L.Marker | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(true);
  const [ageSeconds, setAgeSeconds] = useState<number | null>(null);
  const [clock, setClock] = useState(0);
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
      const label = stop.address ?? `Punto GPS ${stop.id}`;
      L.circleMarker([stop.lat, stop.lng], {
        radius: 5, color: "#fff", weight: 2, fillColor: "#173e33", fillOpacity: 1,
      }).bindTooltip(`${index + 1}. ${label}`).addTo(map);
    });
    map.fitBounds(L.latLngBounds(STOPS.map((stop) => [stop.lat, stop.lng] as [number, number])).pad(0.12));
    mapRef.current = map;
    return () => { controller.abort(); map.remove(); mapRef.current = null; };
  }, [localSummary.presentationMode]);

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
      const now = Date.now();
      setClock(now);
      try {
        const response = await fetch("/api/tracking", { cache: "no-store" });
        if (!response.ok) throw new Error("tracking unavailable");
        const data = await response.json() as { tracking: Tracking | null };
        if (!active) return;
        setTracking(data.tracking);
        setAgeSeconds(data.tracking ? Math.max(0, Math.round((now - data.tracking.updated_at) / 1000)) : null);
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

  const localReviewed = localSummary.done + localSummary.absent;
  const useLocal = localReviewed > 0 || !tracking;
  const done = useLocal ? localSummary.done : (tracking?.done ?? tracking?.completed ?? 0);
  const absent = useLocal ? localSummary.absent : (tracking?.absent ?? 0);
  const total = useLocal ? localSummary.total : (tracking?.total ?? localSummary.total);
  const pending = useLocal ? localSummary.pending : (tracking?.pending ?? Math.max(0, total - done - absent));
  const reviewed = done + absent;
  const progress = Math.round((reviewed / Math.max(1, total)) * 100);
  const nextStop = useLocal ? localSummary.nextStop : (tracking?.next_stop ?? null);
  const kilos = useLocal ? localSummary.kilos : (tracking?.kilos ?? 0);
  const estimatedMinutes = useLocal ? localSummary.estimatedMinutes : (tracking?.estimated_minutes ?? localSummary.estimatedMinutes);
  const startedAt = useLocal ? localSummary.startedAt : (tracking?.started_at ?? null);
  const elapsedMinutes = startedAt && clock ? Math.max(1, Math.round((clock - startedAt) / 60000)) : 0;
  const liveConnection = localReviewed > 0 || (connected && tracking !== null);

  return (
    <section className="manager-view">
      <div className="manager-heading">
        <div><p className="eyebrow"><span /> Supervisión de la jornada</p><h1>Panel de jefatura</h1><p>Avance, incidencias y ubicación del camión en una sola pantalla.</p></div>
        <div className={`connection-badge ${liveConnection ? "online" : "offline"}`}><i />{liveConnection ? "Jornada conectada" : "Esperando al conductor"}</div>
      </div>

      <div className="manager-kpi-grid">
        <article className="success"><span>Retiros realizados</span><strong>{done}</strong><small>de {total} viviendas</small></article>
        <article className="warning"><span>Ausentes</span><strong>{absent}</strong><small>visitas sin retiro</small></article>
        <article><span>Pendientes</span><strong>{pending}</strong><small>por visitar</small></article>
        <article><span>Material registrado</span><strong>{kilos > 0 ? `${kilos.toLocaleString("es-CL", { maximumFractionDigits: 1 })} kg` : "—"}</strong><small>{kilos > 0 ? "acumulado de hoy" : "por medir en terreno"}</small></article>
      </div>

      <div className="manager-grid">
        <div className="manager-map-card">
          <div className="map-style-switch manager-map-switch" aria-label="Cambiar tipo de mapa de jefatura">
            <button className={mapStyle === "streets" ? "active" : ""} onClick={() => changeMapStyle("streets")}>Calles</button>
            <button className={mapStyle === "satellite" ? "active" : ""} onClick={() => changeMapStyle("satellite")}>Satélite</button>
            <a href="https://www.google.com/maps/@?api=1&map_action=map&center=-41.461,-72.899&zoom=16" target="_blank" rel="noreferrer">Google Maps ↗</a>
          </div>
          <div ref={mapElement} className="manager-map" aria-label="Ubicación compartida del camión" />
          <div className="manager-map-footer">{tracking ? `Actualización automática cada 5 segundos${ageSeconds !== null ? ` · último dato hace ${ageSeconds} s` : ""}` : "La ubicación aparecerá cuando el conductor active el GPS"}</div>
        </div>

        <aside className="manager-summary">
          <span className="manager-kicker">Jornada Santuario · Viernes</span>
          <div className="manager-progress-line"><div className="manager-progress-number">{progress}%</div><span>del recorrido revisado</span></div>
          <div className="progress-track manager-track"><i style={{ width: `${progress}%` }} /></div>

          <div className="manager-operational-metrics">
            <div><span>Tiempo transcurrido</span><strong>{startedAt ? formatMinutes(elapsedMinutes) : "Sin iniciar"}</strong></div>
            <div><span>Tiempo restante</span><strong>~{formatMinutes(estimatedMinutes)}</strong></div>
            <div><span>Ruta planificada</span><strong>{tracking?.route_km ? `${tracking.route_km.toFixed(1)} km` : "4,5 km"}</strong></div>
          </div>

          <div className="manager-next"><span>Próxima parada</span><strong>{nextStop || (reviewed >= total ? "Recorrido finalizado" : "Esperando inicio")}</strong></div>

          <div className="manager-activity">
            <div className="manager-activity-head"><strong>Actividad reciente</strong><span>{useLocal ? "Este dispositivo" : "En vivo"}</span></div>
            {localSummary.activity.length ? localSummary.activity.slice(0, 4).map((entry) => (
              <div className="activity-row" key={entry.id}>
                <i className={entry.status} />
                <span><strong>{entry.stopName}</strong><small>{entry.status === "done" ? "Retiro realizado" : "Marcada como ausente"}</small></span>
                <time>{new Date(entry.at).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}</time>
              </div>
            )) : <p className="manager-note">Las visitas registradas por el conductor aparecerán aquí.</p>}
          </div>

          {loading && <p className="manager-note">Conectando con el seguimiento del camión…</p>}
        </aside>
      </div>

      <div className="manager-next-stage">
        <span>Siguiente etapa del piloto</span>
        <strong>Medir kilómetros recorridos y tiempo ahorrado durante una jornada real.</strong>
        <p>Con esa prueba podremos comparar el recorrido actual con Ruta Verde y demostrar el impacto con datos.</p>
      </div>
    </section>
  );
}
