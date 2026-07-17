"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STOPS, type Stop } from "./route-data";
import {
  ROUTE_DAYS,
  addStopsToRouteDay,
  readActiveRouteDay,
  readRouteDayCounts,
  readRoutePlanMetadata,
  removeStopsFromRouteDay,
  writeActiveRouteDay,
  writeRoutePlanMetadata,
  type RouteDay,
  type RoutePlanMetadata,
} from "./route-plan-state";

type Position = { lat: number; lng: number; accuracy: number; speed: number | null; heading: number | null; timestamp: number };
type Step = { distance: number; duration: number; name: string; maneuver: { type: string; modifier: string | null; lat: number; lng: number } };
type NavigationResponse = { distanceMeters: number; durationSeconds: number; steps: Step[] };
type Tracking = {
  lat: number; lng: number; speed: number | null; accuracy: number | null; next_stop: string | null;
  completed: number; done?: number | null; absent?: number | null; pending?: number | null; total: number;
  kilos?: number | null; actual_km?: number | null; moving_minutes?: number | null; stopped_minutes?: number | null;
  estimated_minutes?: number | null; started_at?: number | null; status: string; updated_at: number;
};
type Summary = {
  id: string; date: string; day: RouteDay; total: number; done: number; absent: number; pending: number;
  kilos: number; progress: number; actualKm: number; movingMinutes: number; stoppedMinutes: number;
  elapsedMinutes: number; averageSpeed: number; updatedAt: number;
};
type Panel = "navigation" | "statistics" | "manager" | "planner";

const HISTORY_KEY = "ruta-verde-history-v1";

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function distance(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const radius = 6_371_000;
  const radians = (value: number) => value * Math.PI / 180;
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function formatDistance(value: number) {
  return value < 950 ? `${Math.max(10, Math.round(value / 10) * 10)} m` : `${(value / 1000).toLocaleString("es-CL", { maximumFractionDigits: 1 })} km`;
}

function formatMinutes(value: number) {
  const minutes = Math.max(0, Math.round(value));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function destination(stop: Stop | undefined, fallback: string) {
  return stop?.address || stop?.name || fallback || "la siguiente vivienda";
}

function findStop(label: string) {
  const wanted = normalize(label);
  if (!wanted) return undefined;
  return STOPS.find((stop) => {
    const address = normalize(stop.address || "");
    const name = normalize(stop.name);
    return (address.length > 4 && (wanted.includes(address) || address.includes(wanted))) || (name.length > 4 && wanted.includes(name));
  });
}

function actionFor(step: Step | undefined, target: string) {
  if (!step) return `Continúa hacia ${target}`;
  const street = step.name ? ` por ${step.name}` : "";
  const modifier = step.maneuver.modifier || "";
  if (step.maneuver.type === "arrive") return `Llegarás a ${target}`;
  if (step.maneuver.type === "roundabout" || step.maneuver.type === "rotary") return `Entra a la rotonda y continúa${street}`;
  if (modifier.includes("uturn")) return `Realiza un retorno${street}`;
  if (modifier.includes("left")) return `Gira a la izquierda${street}`;
  if (modifier.includes("right")) return `Gira a la derecha${street}`;
  return `Continúa${street}`;
}

function loadHistory(): Summary[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]") as unknown;
    return Array.isArray(parsed) ? parsed as Summary[] : [];
  } catch { return []; }
}

function saveHistory(items: Summary[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(-120))); } catch {}
}

function sameDomSummary(a: { done: number; absent: number; pending: number; total: number }, b: { done: number; absent: number; pending: number; total: number }) {
  return a.done === b.done && a.absent === b.absent && a.pending === b.pending && a.total === b.total;
}

export default function LevelOneSuite() {
  const activeDay = readActiveRouteDay();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [nextLabel, setNextLabel] = useState("");
  const [instruction, setInstruction] = useState("Activa el GPS para comenzar la guía propia.");
  const [navDistance, setNavDistance] = useState(0);
  const [navMinutes, setNavMinutes] = useState(0);
  const [voice, setVoice] = useState(false);
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [connected, setConnected] = useState(true);
  const [clock, setClock] = useState(Date.now());
  const [localCounts, setLocalCounts] = useState({ done: 0, absent: 0, pending: 0, total: 0 });
  const [history, setHistory] = useState<Summary[]>([]);
  const [selectedDay, setSelectedDay] = useState<RouteDay>(activeDay);
  const [dayCounts, setDayCounts] = useState(readRouteDayCounts());
  const [plans, setPlans] = useState(readRoutePlanMetadata());
  const [notice, setNotice] = useState("");
  const lastRequest = useRef<{ lat: number; lng: number; stopId: string; at: number } | null>(null);
  const lastSpoken = useRef("");

  const speak = useCallback((text: string, force = false) => {
    if (!force && !voice) return;
    if (!("speechSynthesis" in window)) return;
    const message = new SpeechSynthesisUtterance(text);
    message.lang = "es-CL";
    message.rate = 0.96;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(message);
  }, [voice]);

  useEffect(() => {
    setHistory(loadHistory());
    const clockTimer = window.setInterval(() => setClock(Date.now()), 1_000);
    const domTimer = window.setInterval(() => {
      const label = document.querySelector<HTMLElement>(".next-card h2")?.textContent?.trim() || "";
      setNextLabel((current) => current === label ? current : label);
      const rows = Array.from(document.querySelectorAll<HTMLElement>(".stop-row"));
      const next = {
        done: rows.filter((row) => row.classList.contains("done")).length,
        absent: rows.filter((row) => row.classList.contains("absent")).length,
        pending: rows.filter((row) => row.classList.contains("pending")).length,
        total: rows.length,
      };
      setLocalCounts((current) => sameDomSummary(current, next) ? current : next);

      const brand = document.querySelector<HTMLElement>(".brand-copy strong");
      if (brand && brand.textContent !== `Ruta Verde · ${activeDay}`) brand.textContent = `Ruta Verde · ${activeDay}`;
      const date = document.querySelector<HTMLElement>(".header-date span");
      if (date && date.textContent !== `${activeDay} · recorrido activo`) date.textContent = `${activeDay} · recorrido activo`;
    }, 1_500);
    return () => { window.clearInterval(clockTimer); window.clearInterval(domTimer); };
  }, [activeDay]);

  useEffect(() => {
    const receive = (event: WindowEventMap["ruta-verde:gps-position"]) => setPosition(event.detail);
    window.addEventListener("ruta-verde:gps-position", receive);
    return () => window.removeEventListener("ruta-verde:gps-position", receive);
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const response = await fetch("/api/tracking", { cache: "no-store" });
        if (!response.ok) throw new Error("tracking unavailable");
        const data = await response.json() as { tracking: Tracking | null };
        if (mounted) { setTracking(data.tracking); setConnected(true); }
      } catch { if (mounted) setConnected(false); }
    };
    void load();
    const timer = window.setInterval(load, 5_000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, []);

  const targetStop = useMemo(() => findStop(nextLabel || tracking?.next_stop || ""), [nextLabel, tracking?.next_stop, position]);
  const targetLabel = destination(targetStop, nextLabel || tracking?.next_stop || "");

  useEffect(() => {
    if (!position || !targetStop) return;
    const previous = lastRequest.current;
    if (previous && previous.stopId === targetStop.id && distance(position, previous) < 18 && Date.now() - previous.at < 8_000) return;
    lastRequest.current = { lat: position.lat, lng: position.lng, stopId: targetStop.id, at: Date.now() };
    const controller = new AbortController();
    const origin = `${position.lng},${position.lat}`;
    const destinationPoint = `${targetStop.lng},${targetStop.lat}`;

    void fetch(`/api/navigation?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destinationPoint)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("navigation unavailable");
        const data = await response.json() as NavigationResponse;
        const found = data.steps.findIndex((step) => step.distance > 4);
        const index = found >= 0 ? found : 0;
        const currentStep = data.steps[index] || data.steps[0];
        const nextStep = data.steps[index + 1] || currentStep;
        const stepDistance = currentStep?.distance || data.distanceMeters;
        const action = actionFor(nextStep, targetLabel);
        const text = `En ${formatDistance(stepDistance)}, ${action.charAt(0).toLowerCase()}${action.slice(1)}`;
        setInstruction(text);
        setNavDistance(data.distanceMeters);
        setNavMinutes(data.durationSeconds / 60);
        const bucket = stepDistance <= 35 ? "now" : stepDistance <= 90 ? "near" : stepDistance <= 220 ? "soon" : "far";
        const key = `${targetStop.id}:${nextStep?.maneuver.type || "continue"}:${nextStep?.maneuver.modifier || "straight"}:${bucket}`;
        if (voice && bucket !== "far" && lastSpoken.current !== key) { lastSpoken.current = key; speak(text); }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        const direct = distance(position, targetStop);
        setInstruction(`Continúa hacia ${targetLabel}. Estás a ${formatDistance(direct)}.`);
        setNavDistance(direct);
        setNavMinutes(0);
      });
    return () => controller.abort();
  }, [position, targetStop, targetLabel, voice, speak]);

  const done = tracking ? (tracking.done ?? tracking.completed ?? 0) : localCounts.done;
  const absent = tracking ? (tracking.absent ?? 0) : localCounts.absent;
  const total = tracking ? (tracking.total || localCounts.total) : localCounts.total;
  const pending = tracking ? (tracking.pending ?? Math.max(0, total - done - absent)) : localCounts.pending;
  const reviewed = done + absent;
  const progress = Math.round(reviewed / Math.max(1, total) * 100);
  const actualKm = tracking?.actual_km ?? 0;
  const movingMinutes = tracking?.moving_minutes ?? 0;
  const stoppedMinutes = tracking?.stopped_minutes ?? 0;
  const kilos = tracking?.kilos ?? 0;
  const startedAt = tracking?.started_at ?? null;
  const elapsedMinutes = startedAt ? Math.max(0, (clock - startedAt) / 60_000) : movingMinutes + stoppedMinutes;
  const averageSpeed = movingMinutes > 0 ? actualKm / (movingMinutes / 60) : 0;
  const estimatedMinutes = tracking?.estimated_minutes ?? 0;
  const trackingAge = tracking ? Math.max(0, Math.round((clock - tracking.updated_at) / 1_000)) : null;
  const managerNext = tracking?.next_stop || nextLabel || "Esperando inicio";

  const currentSummary = useMemo<Summary>(() => ({
    id: `${today()}-${activeDay}`, date: today(), day: activeDay, total, done, absent, pending, kilos, progress,
    actualKm, movingMinutes, stoppedMinutes, elapsedMinutes, averageSpeed, updatedAt: Date.now(),
  }), [activeDay, total, done, absent, pending, kilos, progress, actualKm, movingMinutes, stoppedMinutes, elapsedMinutes, averageSpeed]);

  useEffect(() => {
    if (currentSummary.total <= 0 || (currentSummary.done === 0 && currentSummary.absent === 0 && currentSummary.actualKm === 0)) return;
    const updated = [...loadHistory().filter((item) => item.id !== currentSummary.id), currentSummary].sort((a, b) => a.updatedAt - b.updatedAt).slice(-120);
    saveHistory(updated);
    setHistory(updated);
  }, [currentSummary]);

  const previous = useMemo(() => history.filter((item) => item.day === activeDay && item.id !== currentSummary.id).sort((a, b) => b.updatedAt - a.updatedAt)[0], [history, activeDay, currentSummary.id]);

  const changePlan = (field: keyof RoutePlanMetadata, value: string) => {
    setPlans((current) => {
      const updated = { ...current, [selectedDay]: { ...current[selectedDay], [field]: value } };
      writeRoutePlanMetadata(updated);
      return updated;
    });
  };

  const addVisible = () => {
    if (!STOPS.length) return setNotice("No hay viviendas cargadas para agregar.");
    addStopsToRouteDay(STOPS.map((stop) => stop.id), selectedDay);
    setDayCounts((current) => ({ ...current, [selectedDay]: Math.max(current[selectedDay], STOPS.length) }));
    setNotice(`${STOPS.length} viviendas quedaron asignadas también a ${selectedDay}.`);
  };

  const removeVisible = () => {
    if (selectedDay === activeDay) return setNotice("Activa otro recorrido antes de vaciar el actual.");
    removeStopsFromRouteDay(STOPS.map((stop) => stop.id), selectedDay);
    setDayCounts(readRouteDayCounts());
    setNotice(`Viviendas retiradas del plan de ${selectedDay}.`);
  };

  const activateDay = () => {
    if (dayCounts[selectedDay] <= 0 && selectedDay !== activeDay) return setNotice(`Primero agrega viviendas a ${selectedDay}.`);
    writeActiveRouteDay(selectedDay);
    window.location.reload();
  };

  const openManager = () => {
    document.querySelectorAll<HTMLButtonElement>(".app-tabs button")[1]?.click();
    setPanel(null);
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 50);
  };

  const status = !tracking ? "Esperando GPS" : !connected || (trackingAge !== null && trackingAge > 60) ? "Sin señal reciente" : trackingAge !== null && trackingAge > 15 ? "Señal atrasada" : tracking.status === "finished" ? "Finalizado" : "Camión en vivo";
  const timeDifference = previous ? currentSummary.elapsedMinutes - previous.elapsedMinutes : 0;
  const kmDifference = previous ? currentSummary.actualKm - previous.actualKm : 0;
  const homesDifference = previous ? currentSummary.done - previous.done : 0;

  return <section className="level-one-suite">
    <div className="level-one-main">
      <div className="level-one-title"><span>Ruta Verde · Nivel 1</span><strong>{activeDay} · {STOPS.length} viviendas</strong></div>
      <div className="level-one-actions">
        <button onClick={() => setPanel(panel === "navigation" ? null : "navigation")}>🧭 Navegador</button>
        <button onClick={() => setPanel(panel === "statistics" ? null : "statistics")}>📊 Estadísticas</button>
        <button onClick={() => setPanel(panel === "manager" ? null : "manager")}>👨‍💼 Jefatura</button>
        <button onClick={() => setPanel(panel === "planner" ? null : "planner")}>📅 Planificador</button>
      </div>
    </div>
    <div className="level-one-guide"><b>➜</b><div><small>Guía propia</small><strong>{instruction}</strong></div><span>{navDistance > 0 ? formatDistance(navDistance) : position ? `GPS ±${Math.round(position.accuracy)} m` : "Sin GPS"}</span></div>

    {panel && <div className="level-one-panel"><button className="panel-close" onClick={() => setPanel(null)}>×</button>
      {panel === "navigation" && <div className="panel-body"><header><div><small>Navegador propio</small><h2>Indicaciones dentro de Ruta Verde</h2></div><button className={voice ? "voice-active" : ""} onClick={() => { const enabled = !voice; setVoice(enabled); if (enabled) speak(`Voz activada. La siguiente vivienda es ${targetLabel}`, true); }}>{voice ? "🔊 Voz activa" : "🔇 Activar voz"}</button></header><div className="nav-command"><small>Próxima instrucción</small><strong>{instruction}</strong><span>Siguiente vivienda: {targetLabel}</span></div><div className="kpi-grid"><article><span>Distancia</span><strong>{navDistance ? formatDistance(navDistance) : "—"}</strong></article><article><span>Tiempo</span><strong>{navMinutes ? formatMinutes(navMinutes) : "—"}</strong></article><article><span>Velocidad</span><strong>{position?.speed !== null && position?.speed !== undefined ? `${Math.round(position.speed * 3.6)} km/h` : "—"}</strong></article><article><span>Precisión</span><strong>{position ? `±${Math.round(position.accuracy)} m` : "—"}</strong></article></div><button className="main-panel-button" onClick={() => speak(`${instruction}. La siguiente vivienda es ${targetLabel}`, true)}>Repetir indicación</button></div>}

      {panel === "statistics" && <div className="panel-body"><header><div><small>Estadísticas automáticas</small><h2>Resultados del recorrido</h2></div><span className="panel-chip">Guardado automático</span></header><div className="stats-grid"><article><span>Kilómetros</span><strong>{actualKm.toFixed(2)} km</strong></article><article><span>Tiempo</span><strong>{formatMinutes(elapsedMinutes)}</strong></article><article><span>Velocidad media</span><strong>{averageSpeed ? `${averageSpeed.toFixed(1)} km/h` : "—"}</strong></article><article><span>Realizadas</span><strong>{done}</strong></article><article><span>Ausentes</span><strong>{absent}</strong></article><article><span>Kilos</span><strong>{kilos ? `${kilos.toFixed(1)} kg` : "—"}</strong></article><article><span>Completado</span><strong>{progress}%</strong></article></div><div className="comparison"><strong>{previous ? `Comparación con ${previous.day} ${previous.date}` : "Primer recorrido registrado"}</strong>{previous ? <div><span className={timeDifference <= 0 ? "good" : "bad"}>{timeDifference <= 0 ? "↓" : "↑"} {Math.abs(timeDifference).toFixed(0)} min</span><span className={kmDifference <= 0 ? "good" : "bad"}>{kmDifference <= 0 ? "↓" : "↑"} {Math.abs(kmDifference).toFixed(1)} km</span><span className={homesDifference >= 0 ? "good" : "bad"}>{homesDifference >= 0 ? "↑" : "↓"} {Math.abs(homesDifference)} viviendas</span></div> : <p>La próxima vez que se realice este recorrido aparecerá la comparación automáticamente.</p>}</div></div>}

      {panel === "manager" && <div className="panel-body"><header><div><small>Centro de control</small><h2>Panel para jefatura</h2></div><span className="panel-chip">{status}</span></header><div className="kpi-grid"><article><span>Avance</span><strong>{progress}%</strong><small>{reviewed} de {total}</small></article><article><span>Cuánto falta</span><strong>{pending}</strong><small>viviendas</small></article><article><span>Próxima vivienda</span><strong>{managerNext}</strong></article><article><span>Término estimado</span><strong>{estimatedMinutes ? new Date(clock + estimatedMinutes * 60_000).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" }) : "—"}</strong></article></div><div className="location-line">📍 <div><strong>{tracking ? `${tracking.lat.toFixed(5)}, ${tracking.lng.toFixed(5)}` : "Sin ubicación"}</strong><small>{trackingAge !== null ? `Última señal hace ${trackingAge} segundos` : "Esperando al conductor"}</small></div></div><button className="main-panel-button" onClick={openManager}>Abrir panel completo de jefatura</button></div>}

      {panel === "planner" && <div className="panel-body"><header><div><small>Planificador semanal</small><h2>Un recorrido para cada día</h2></div><span className="panel-chip">Activo: {activeDay}</span></header><div className="day-tabs">{ROUTE_DAYS.map((day) => <button className={selectedDay === day ? "active" : ""} key={day} onClick={() => setSelectedDay(day)}><strong>{day.slice(0, 3)}</strong><span>{dayCounts[day]} casas</span></button>)}</div><div className="planner-form"><label>Nombre<input value={plans[selectedDay].name} onChange={(event) => changePlan("name", event.target.value)} /></label><label>Conductor<input value={plans[selectedDay].driver} onChange={(event) => changePlan("driver", event.target.value)} placeholder="Responsable" /></label><label>Vehículo<select value={plans[selectedDay].vehicle} onChange={(event) => changePlan("vehicle", event.target.value)}><option>Camión</option><option>Camioneta</option><option>Auto</option><option>Bicicleta</option></select></label><label>Salida<input type="time" value={plans[selectedDay].startTime} onChange={(event) => changePlan("startTime", event.target.value)} /></label></div><div className="planner-summary"><div><strong>{plans[selectedDay].name}</strong><span>{dayCounts[selectedDay]} viviendas · {plans[selectedDay].vehicle} · {plans[selectedDay].startTime}</span></div><button onClick={activateDay}>{selectedDay === activeDay ? "Recorrido abierto" : `Activar ${selectedDay}`}</button></div><div className="planner-buttons"><button onClick={addVisible}>Agregar viviendas visibles a {selectedDay}</button><button onClick={removeVisible}>Quitar viviendas de {selectedDay}</button></div>{notice && <p className="planner-notice">{notice}</p>}</div>}
    </div>}

    <style jsx global>{`
      .level-one-suite{position:sticky;top:54px;z-index:9000;background:#f3f7f3;border-bottom:1px solid #d6e2da;box-shadow:0 8px 24px rgba(16,55,43,.1)}.level-one-main{max-width:1500px;margin:auto;padding:9px 14px;display:flex;justify-content:space-between;align-items:center;gap:12px}.level-one-title{display:grid}.level-one-title span{font-size:10px;font-weight:900;color:#61786f;text-transform:uppercase}.level-one-title strong{font-size:14px;color:#173f33}.level-one-actions{display:flex;gap:7px;flex-wrap:wrap}.level-one-actions button{min-height:37px;border:1px solid #ccd9d1;border-radius:10px;background:#fff;color:#244b3e;font-size:12px;font-weight:850;padding:0 11px}.level-one-guide{max-width:1500px;margin:auto;padding:8px 14px 10px;border-top:1px solid #dce6df;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px}.level-one-guide>b{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:#dff2e7;color:#176042;font-size:20px}.level-one-guide div{display:grid;min-width:0}.level-one-guide small{font-size:10px;color:#698078}.level-one-guide strong{font-size:13px;color:#173f33;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.level-one-guide>span{font-size:11px;font-weight:900;color:#31594b;background:#fff;border-radius:999px;padding:7px 10px}.level-one-panel{position:relative;max-width:1160px;margin:0 auto 12px;background:#fff;border:1px solid #d2dfd7;border-radius:17px;box-shadow:0 20px 55px rgba(17,59,45,.18)}.panel-close{position:absolute;right:10px;top:9px;width:34px;height:34px;border:0;border-radius:50%;background:#eaf0ec;font-size:22px;color:#36594d}.panel-body{padding:20px}.panel-body header{display:flex;justify-content:space-between;align-items:center;gap:12px;padding-right:38px;margin-bottom:15px}.panel-body header>div{display:grid}.panel-body header small{font-size:10px;font-weight:900;color:#668077;text-transform:uppercase}.panel-body h2{margin:2px 0 0;font-size:22px;color:#173f33}.panel-body header button,.panel-chip{min-height:38px;border:1px solid #cfe0d6;border-radius:999px;background:#edf7f1;color:#216346;font-size:11px;font-weight:900;padding:0 13px;display:inline-flex;align-items:center}.panel-body header button.voice-active{background:#173f33;color:#fff}.nav-command{padding:19px;border-radius:16px;background:#173f33;color:#fff;display:grid;gap:6px}.nav-command small{font-size:10px;color:#a9dbc7;text-transform:uppercase}.nav-command strong{font-size:24px;line-height:1.2}.nav-command span{font-size:12px;color:#d7e9e2}.kpi-grid,.stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-top:11px}.stats-grid{grid-template-columns:repeat(7,1fr)}.kpi-grid article,.stats-grid article{padding:13px;border:1px solid #dae5de;border-radius:13px;background:#f8faf8;display:grid;gap:4px;min-height:78px}.kpi-grid span,.stats-grid span{font-size:10px;color:#6a7e77;text-transform:uppercase;font-weight:850}.kpi-grid strong,.stats-grid strong{font-size:19px;color:#173f33}.kpi-grid small{font-size:10px;color:#71847d}.main-panel-button{width:100%;min-height:47px;margin-top:11px;border:0;border-radius:12px;background:#1d7656;color:#fff;font-weight:900}.comparison{margin-top:12px;padding:15px;border-radius:14px;background:#eef4f0;display:grid;gap:9px;color:#173f33}.comparison>div{display:flex;gap:7px;flex-wrap:wrap}.comparison span{padding:7px 10px;border-radius:999px;font-size:11px;font-weight:900}.comparison .good{background:#dff2e7;color:#176042}.comparison .bad{background:#fff0d6;color:#845b15}.comparison p{margin:0;font-size:12px;color:#60756d}.location-line{margin-top:11px;padding:13px;border-radius:13px;background:#eef4f0;display:flex;gap:10px;align-items:center}.location-line div{display:grid}.location-line strong{color:#173f33}.location-line small{color:#6c8179}.day-tabs{display:grid;grid-template-columns:repeat(5,1fr);gap:7px}.day-tabs button{min-height:58px;border:1px solid #d5e0d9;border-radius:12px;background:#f8faf8;color:#315449;display:grid;padding:7px}.day-tabs button.active{background:#173f33;color:#fff}.day-tabs span{font-size:10px}.planner-form{display:grid;grid-template-columns:1.3fr 1.1fr .8fr .7fr;gap:9px;margin-top:11px}.planner-form label{display:grid;gap:4px;font-size:10px;color:#62776f;text-transform:uppercase;font-weight:850}.planner-form input,.planner-form select{min-height:42px;border:1px solid #cfdbd4;border-radius:10px;padding:0 10px;background:#fff;color:#173f33}.planner-summary{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:11px;padding:13px;border-radius:13px;background:#edf4ef}.planner-summary div{display:grid}.planner-summary span{font-size:11px;color:#667b73}.planner-summary button{min-height:44px;border:0;border-radius:11px;background:#1d7656;color:#fff;font-weight:900;padding:0 15px}.planner-buttons{display:flex;gap:8px;margin-top:9px}.planner-buttons button{flex:1;min-height:42px;border:1px solid #ccdad2;border-radius:10px;background:#fff;color:#31574a;font-weight:850;font-size:11px}.planner-notice{padding:10px 12px;border-radius:10px;background:#e3f2e9;color:#206045;font-size:11px;font-weight:800}.primary-action,.row-nav,.segment-box{display:none!important}@media(max-width:1000px){.stats-grid{grid-template-columns:repeat(4,1fr)}.planner-form{grid-template-columns:repeat(2,1fr)}}@media(max-width:760px){.level-one-suite{top:50px}.level-one-main{align-items:flex-start;padding:8px 9px}.level-one-title strong{font-size:11px}.level-one-actions{display:grid;grid-template-columns:repeat(2,1fr);width:68%}.level-one-actions button{min-height:33px;padding:0 5px;font-size:10px}.level-one-guide{padding:7px 9px 9px}.level-one-guide strong{font-size:11px}.level-one-guide>span{font-size:9px}.level-one-panel{max-height:68vh;overflow-y:auto;margin:0 7px 8px}.panel-body{padding:15px 12px}.panel-body h2{font-size:18px}.nav-command strong{font-size:20px}.kpi-grid,.stats-grid{grid-template-columns:repeat(2,1fr)}.planner-form{grid-template-columns:1fr}.planner-summary{align-items:stretch;flex-direction:column}.planner-buttons{flex-direction:column}}
    `}</style>
  </section>;
}
