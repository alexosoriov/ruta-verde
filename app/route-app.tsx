"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { ROUTE_DISTANCE_KM, STOPS, type Stop } from "./route-data";
import OfflineSupport from "./offline-support";
import AppInstall from "./app-install";

const LiveMap = dynamic(() => import("./live-map"), {
  ssr: false,
  loading: () => <div className="map-shell map-loading">Cargando calles y paradas…</div>,
});
const ManagerPanel = dynamic(() => import("./manager-panel"), {
  ssr: false,
  loading: () => <div className="manager-view">Cargando panel de jefatura…</div>,
});

type StopStatus = "pending" | "done" | "absent";
type StopDetail = { kilos: string; material: string; note: string };
type SavedState = {
  statuses: Record<string, StopStatus>;
  details: Record<string, StopDetail>;
  customStops: Stop[];
  reverse: boolean;
  optimizedIds?: string[];
};

const STORAGE_KEY = "santuario-viernes-v2";

function mapsUrl(stop: Stop, vehicle: string) {
  const mode = vehicle === "Bicicleta" ? "bicycling" : "driving";
  return `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=${mode}`;
}

function segmentUrl(stops: Stop[], vehicle: string) {
  const mode = vehicle === "Bicicleta" ? "bicycling" : "driving";
  const origin = stops[0];
  const destination = stops.at(-1)!;
  const waypoints = stops.slice(1, -1).map((s) => `${s.lat},${s.lng}`).join("|");
  return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&travelmode=${mode}${waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : ""}`;
}

function distance(a: Stop, b: Stop) {
  const r = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export default function RouteApp() {
  const [statuses, setStatuses] = useState<Record<string, StopStatus>>({});
  const [details, setDetails] = useState<Record<string, StopDetail>>({});
  const [customStops, setCustomStops] = useState<Stop[]>([]);
  const [reverse, setReverse] = useState(false);
  const [vehicle, setVehicle] = useState("Camioneta");
  const [filter, setFilter] = useState<"all" | StopStatus>("all");
  const [notice, setNotice] = useState("");
  const [detailStop, setDetailStop] = useState<string | null>(null);
  const [newStop, setNewStop] = useState({ name: "", lat: "", lng: "" });
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<"driver" | "manager">("driver");
  const [optimizedIds, setOptimizedIds] = useState<string[]>([]);
  const [optimizing, setOptimizing] = useState(false);
  const [arrival, setArrival] = useState<{ stop: Stop; distance: number } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as SavedState | null;
        if (saved) {
          setStatuses(saved.statuses || {});
          setDetails(saved.details || {});
          setCustomStops(saved.customStops || []);
          setReverse(Boolean(saved.reverse));
          setOptimizedIds(saved.optimizedIds || []);
        }
      } catch {}
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ statuses, details, customStops, reverse, optimizedIds }));
  }, [statuses, details, customStops, reverse, optimizedIds, hydrated]);

  const allStops = useMemo(() => {
    const result = [...STOPS];
    for (const custom of customStops) {
      let bestIndex = 0;
      let bestDistance = Infinity;
      result.forEach((stop, index) => {
        const d = distance(stop, custom);
        if (d < bestDistance) { bestDistance = d; bestIndex = index; }
      });
      result.splice(bestIndex + 1, 0, custom);
    }
    return result;
  }, [customStops]);
  const optimizedStops = useMemo(() => {
    if (!optimizedIds.length) return allStops;
    const byId = new Map(allStops.map((stop) => [stop.id, stop]));
    const sorted = optimizedIds.map((id) => byId.get(id)).filter((stop): stop is Stop => Boolean(stop));
    const used = new Set(sorted.map((stop) => stop.id));
    return [...sorted, ...allStops.filter((stop) => !used.has(stop.id))];
  }, [allStops, optimizedIds]);
  const ordered = useMemo(() => (reverse ? [...optimizedStops].reverse() : optimizedStops), [reverse, optimizedStops]);
  const current = ordered.find((s) => (statuses[s.id] ?? "pending") === "pending");
  const done = Object.values(statuses).filter((s) => s === "done").length;
  const absent = Object.values(statuses).filter((s) => s === "absent").length;
  const pending = allStops.length - done - absent;
  const routeRemaining = current
    ? reverse
      ? current.km
      : ROUTE_DISTANCE_KM - current.km
    : 0;
  const estimatedMinutes = Math.max(0, Math.round(pending * 2 + (routeRemaining / (vehicle === "Bicicleta" ? 14 : 24)) * 60));
  const visible = ordered.filter((s) => filter === "all" || (statuses[s.id] ?? "pending") === filter);
  const segments = useMemo(() => {
    const result: Stop[][] = [];
    for (let i = 0; i < ordered.length - 1; i += 9) result.push(ordered.slice(i, i + 10));
    return result;
  }, [ordered]);

  const setStatus = (id: string, status: StopStatus) => {
    setStatuses((old) => ({ ...old, [id]: status }));
  };

  const startNearMe = () => {
    if (!navigator.geolocation) return setNotice("Este dispositivo no permite obtener la ubicación.");
    setNotice("Buscando tu ubicación…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const me: Stop = { id: "me", name: "Mi ubicación", lat: coords.latitude, lng: coords.longitude, km: 0 };
        const useReverse = distance(me, STOPS.at(-1)!) < distance(me, STOPS[0]);
        setReverse(useReverse);
        setNotice(useReverse ? "Conviene comenzar por la casa 41." : "Conviene comenzar por la casa 01.");
      },
      () => setNotice("No pude obtener tu ubicación. Puedes invertir el sentido manualmente."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const reset = () => {
    if (confirm("¿Borrar todo el avance y los datos del recorrido de hoy?")) {
      setStatuses({});
      setDetails({});
    }
  };

  const updateDetail = (id: string, field: keyof StopDetail, value: string) => {
    setDetails((old) => ({ ...old, [id]: { kilos: "", material: "Mixto", note: "", ...old[id], [field]: value } }));
  };

  const addStop = () => {
    const lat = Number(newStop.lat.replace(",", "."));
    const lng = Number(newStop.lng.replace(",", "."));
    if (!newStop.name.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      setNotice("Escribe un nombre, latitud y longitud válidos.");
      return;
    }
    const nearest = STOPS.reduce((best, stop) => distance(stop, { id: "new", name: "", lat, lng, km: 0 }) < distance(best, { id: "new", name: "", lat, lng, km: 0 }) ? stop : best);
    const stop: Stop = { id: `N${Date.now()}`, name: newStop.name.trim(), lat, lng, km: nearest.km };
    setCustomStops((old) => [...old, stop]);
    setOptimizedIds([]);
    setNewStop({ name: "", lat: "", lng: "" });
    setNotice("Casa agregada cerca de la parada correspondiente.");
  };

  const optimizeRoute = async () => {
    if (!navigator.onLine) {
      setNotice("Estás sin internet. Mantendré la última ruta guardada hasta recuperar señal.");
      return;
    }
    setOptimizing(true);
    setNotice("Calculando el mejor orden por calles y sentidos de tránsito…");
    try {
      const coordinates = allStops.map((stop) => `${stop.lng},${stop.lat}`).join(";");
      const response = await fetch(`https://router.project-osrm.org/trip/v1/driving/${coordinates}?roundtrip=false&source=first&destination=last&overview=false&steps=false`);
      if (!response.ok) throw new Error("optimizer unavailable");
      const data = await response.json() as { code: string; waypoints: Array<{ waypoint_index: number }> };
      if (data.code !== "Ok" || data.waypoints.length !== allStops.length) throw new Error("invalid route");
      const ids = allStops.map((stop, index) => ({ id: stop.id, order: data.waypoints[index].waypoint_index })).sort((a, b) => a.order - b.order).map((item) => item.id);
      setOptimizedIds(ids);
      setReverse(false);
      setNotice("Ruta optimizada por calles reales, sentidos y restricciones de giro. Quedó guardada para usarla sin señal.");
    } catch {
      setNotice("No pude contactar el optimizador. La ruta anterior sigue disponible y no se perdió nada.");
    } finally {
      setOptimizing(false);
    }
  };

  const exportCsv = () => {
    const rows = [["Orden", "Casa", "Estado", "Kilos", "Material", "Observaciones"]];
    ordered.forEach((stop, index) => {
      const detail = details[stop.id] || { kilos: "", material: "", note: "" };
      rows.push([String(index + 1), stop.name, statuses[stop.id] || "pending", detail.kilos, detail.material, detail.note]);
    });
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "informe-santuario-viernes.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main>
      <OfflineSupport />
      <header className="topbar">
        <Image className="brand-mark" src="/icon-192.png" width={45} height={45} alt="Logo Ruta Verde" priority unoptimized />
        <div className="brand-copy">
          <span>Reciclaje en movimiento</span>
          <strong>Ruta Verde · Santuario</strong>
        </div>
        <div className="header-actions"><AppInstall /><div className="header-date"><span>Viernes · recorrido activo</span><strong>{allStops.length} casas</strong></div></div>
      </header>

      <nav className="app-tabs" aria-label="Cambiar vista de la aplicación">
        <button className={view === "driver" ? "active" : ""} onClick={() => setView("driver")}>Conductor</button>
        <button className={view === "manager" ? "active" : ""} onClick={() => setView("manager")}>Jefatura · seguimiento</button>
      </nav>

      {view === "manager" ? <ManagerPanel /> : <>

      <section className="hero">
        <div>
          <p className="eyebrow"><span /> Ruta de reciclaje</p>
          <h1>Todo el recorrido,<br />sin vueltas innecesarias.</h1>
          <p className="lead">Mira las calles reales, las 41 paradas y el camión avanzando con el GPS del teléfono. Google Maps se encarga de los giros, sentidos de calle, desvíos y tránsito.</p>
        </div>
        <div className="progress-card">
          <div className="progress-head"><span>Avance de hoy</span><strong>{Math.round(((done + absent) / allStops.length) * 100)}%</strong></div>
          <div className="progress-track"><i style={{ width: `${((done + absent) / allStops.length) * 100}%` }} /></div>
          <div className="progress-numbers"><strong>{done}</strong> realizadas <span>·</span> <strong>{pending}</strong> pendientes <span>·</span> <strong>{absent}</strong> ausentes</div>
        </div>
      </section>

      <section className="workspace">
        <div className="map-column">
          <LiveMap stops={ordered} statuses={statuses} activeId={current?.id} activeStop={current} completed={done + absent} total={allStops.length} onArrival={(stop, distance) => setArrival({ stop, distance })} />
          <div className="stats-row">
            <article><span>Distancia base</span><strong>4,5 km</strong><small>entre primera y última casa</small></article>
            <article><span>Tiempo restante</span><strong>~{Math.floor(estimatedMinutes / 60)} h {estimatedMinutes % 60} min</strong><small>incluye 2 min por retiro</small></article>
            <article><span>Sentido</span><strong>{reverse ? "41 → 01" : "01 → 41"}</strong><small>puedes invertirlo</small></article>
          </div>
        </div>

        <aside className="next-card">
          <div className="next-label"><span className="live-dot" /> Siguiente retiro</div>
          {current ? (
            <>
              <div className="next-number">{ordered.findIndex((stop) => stop.id === current.id) + 1}</div>
              <h2>{current.name}</h2>
              <p>Casa {current.id} · km {current.km.toFixed(2).replace(".", ",")}</p>
              <a className="primary-action" href={mapsUrl(current, vehicle)} target="_blank" rel="noreferrer">Abrir navegación</a>
              <button className="complete-action" onClick={() => setStatus(current.id, "done")}>Realizado · ir al siguiente</button>
              <button className="text-action" onClick={() => setStatus(current.id, "absent")}>Marcar como ausente</button>
            </>
          ) : (
            <div className="finished"><strong>Recorrido terminado</strong><p>Las 41 casas ya fueron revisadas.</p></div>
          )}
          <div className="quick-settings">
            <label>Vehículo<select value={vehicle} onChange={(e) => setVehicle(e.target.value)}><option>Camioneta</option><option>Camión</option><option>Auto</option><option>Bicicleta</option></select></label>
            <button className="optimize-button" onClick={optimizeRoute} disabled={optimizing}>{optimizing ? "Optimizando…" : optimizedIds.length ? "Optimizar nuevamente" : "Optimizar ruta por calles"}</button>
            <button onClick={startNearMe}>Comenzar por el extremo más cercano</button>
            <button onClick={() => setReverse((v) => !v)}>Invertir sentido</button>
          </div>
          <div className="segment-box">
            <strong>Navegar el recorrido por tramos</strong>
            <p>Google Maps limita las paradas; por eso van separadas automáticamente.</p>
            <div>{segments.map((segment, index) => <a key={segment[0].id} href={segmentUrl(segment, vehicle)} target="_blank" rel="noreferrer">Tramo {index + 1}</a>)}</div>
          </div>
          {notice && <div className="notice" role="status">{notice}</div>}
        </aside>
      </section>

      <section className="route-list-section">
        <div className="section-heading">
          <div><p className="eyebrow"><span /> Control de retiros</p><h2>Orden completo de paradas</h2></div>
          <div className="filters" aria-label="Filtrar paradas">
            {(["all", "pending", "done", "absent"] as const).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item === "all" ? "Todas" : item === "pending" ? "Pendientes" : item === "done" ? "Realizadas" : "Ausentes"}</button>)}
          </div>
        </div>
        <div className="stop-list">
          {visible.map((stop, index) => {
            const status = statuses[stop.id] ?? "pending";
            const detail = details[stop.id] || { kilos: "", material: "Mixto", note: "" };
            return <article className={`stop-row ${status} ${current?.id === stop.id ? "current" : ""}`} key={stop.id}>
              <div className="stop-order">{String(index + 1).padStart(2, "0")}</div>
              <div className="stop-main"><strong>{stop.name}</strong><span>Casa {stop.id} · {stop.km.toFixed(2).replace(".", ",")} km</span></div>
              <div className={`status-pill ${status}`}>{status === "done" ? "Realizado" : status === "absent" ? "Ausente" : current?.id === stop.id ? "Siguiente" : "Pendiente"}</div>
              <a className="row-nav" href={mapsUrl(stop, vehicle)} target="_blank" rel="noreferrer">Navegar</a>
              <div className="row-actions">
                <button className="data-button" aria-label={`Datos de ${stop.name}`} onClick={() => setDetailStop(detailStop === stop.id ? null : stop.id)}>i</button>
                {status === "pending" ? <><button aria-label={`Marcar ${stop.name} como realizado`} onClick={() => setStatus(stop.id, "done")}>✓</button><button aria-label={`Marcar ${stop.name} como ausente`} onClick={() => setStatus(stop.id, "absent")}>×</button></> : <button className="undo" onClick={() => setStatus(stop.id, "pending")}>Deshacer</button>}
              </div>
              {detailStop === stop.id && <div className="stop-detail">
                <label>Kilos retirados<input inputMode="decimal" value={detail.kilos} onChange={(e) => updateDetail(stop.id, "kilos", e.target.value)} placeholder="Ej. 8,5" /></label>
                <label>Material<select value={detail.material} onChange={(e) => updateDetail(stop.id, "material", e.target.value)}><option>Mixto</option><option>Vidrio</option><option>Plástico</option><option>Cartón</option><option>Latas</option><option>Otro</option></select></label>
                <label className="note-field">Observaciones<input value={detail.note} onChange={(e) => updateDetail(stop.id, "note", e.target.value)} placeholder="Bolsa afuera, llamar, acceso cerrado…" /></label>
              </div>}
            </article>;
          })}
        </div>
        <div className="tools-panel">
          <details className="add-stop">
            <summary>Agregar una casa nueva</summary>
            <div className="add-stop-form">
              <label>Nombre<input value={newStop.name} onChange={(e) => setNewStop((old) => ({ ...old, name: e.target.value }))} placeholder="Nombre del retiro" /></label>
              <label>Latitud<input inputMode="decimal" value={newStop.lat} onChange={(e) => setNewStop((old) => ({ ...old, lat: e.target.value }))} placeholder="-41.4600" /></label>
              <label>Longitud<input inputMode="decimal" value={newStop.lng} onChange={(e) => setNewStop((old) => ({ ...old, lng: e.target.value }))} placeholder="-72.9000" /></label>
              <button onClick={addStop}>Agregar al recorrido</button>
            </div>
          </details>
          <button className="export-button" onClick={exportCsv}>Descargar informe CSV</button>
        </div>
        <div className="list-footer"><span>Avances, kilos y observaciones quedan guardados en este dispositivo.</span><button onClick={reset}>Reiniciar jornada</button></div>
      </section>
      </>}

      {arrival && <div className="arrival-backdrop" role="dialog" aria-modal="true" aria-labelledby="arrival-title">
        <div className="arrival-card">
          <span className="arrival-icon">✓</span>
          <p>Llegada automática</p>
          <h2 id="arrival-title">Llegaste a {arrival.stop.name}</h2>
          <span>Estás aproximadamente a {Math.round(arrival.distance)} metros del punto.</span>
          <button onClick={() => { setStatus(arrival.stop.id, "done"); setArrival(null); }}>Registrar retiro y continuar</button>
          <button className="arrival-secondary" onClick={() => setArrival(null)}>Todavía no · cerrar aviso</button>
        </div>
      </div>}
    </main>
  );
}
