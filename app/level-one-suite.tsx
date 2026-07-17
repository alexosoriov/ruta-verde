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

type Position = {
  lat: number;
  lng: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
  timestamp: number;
};

type NavigationStep = {
  distance: number;
  duration: number;
  name: string;
  maneuver: {
    type: string;
    modifier: string | null;
    lat: number;
    lng: number;
  };
};

type NavigationResponse = {
  distanceMeters: number;
  durationSeconds: number;
  steps: NavigationStep[];
};

type Tracking = {
  lat: number;
  lng: number;
  speed: number | null;
  accuracy: number | null;
  next_stop: string | null;
  completed: number;
  done?: number | null;
  absent?: number | null;
  pending?: number | null;
  total: number;
  kilos?: number | null;
  actual_km?: number | null;
  moving_minutes?: number | null;
  stopped_minutes?: number | null;
  estimated_minutes?: number | null;
  started_at?: number | null;
  status: string;
  updated_at: number;
};

type DomSummary = {
  done: number;
  absent: number;
  pending: number;
  total: number;
  actualKm: number;
  movingMinutes: number;
  stoppedMinutes: number;
};

type DailySummary = {
  id: string;
  date: string;
  day: RouteDay;
  total: number;
  done: number;
  absent: number;
  pending: number;
  kilos: number;
  progress: number;
  actualKm: number;
  movingMinutes: number;
  stoppedMinutes: number;
  elapsedMinutes: number;
  averageSpeed: number;
  updatedAt: number;
};

type Panel = "navigation" | "statistics" | "manager" | "planner";

const HISTORY_KEY = "ruta-verde-history-v1";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CL")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function chileDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function numberFromText(value: string | null | undefined) {
  const match = value?.replace(/\./g, "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  const parsed = match ? Number(match[0]) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function distanceMeters(a: Pick<Position, "lat" | "lng">, b: Pick<Stop, "lat" | "lng">) {
  const earthRadius = 6_371_000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLng = toRadians(b.lng - a.lng);
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function formatDistance(value: number) {
  if (value < 950) return `${Math.max(10, Math.round(value / 10) * 10)} m`;
  return `${(value / 1000).toLocaleString("es-CL", { maximumFractionDigits: 1 })} km`;
}

function formatMinutes(value: number) {
  const minutes = Math.max(0, Math.round(value));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function maneuverInstruction(step: NavigationStep | undefined, destination: string) {
  if (!step) return `Continúa hacia ${destination}`;
  const street = step.name.trim() ? ` por ${step.name}` : "";
  const modifier = step.maneuver.modifier ?? "";

  if (step.maneuver.type === "arrive") return `Llegarás a ${destination}`;
  if (step.maneuver.type === "roundabout" || step.maneuver.type === "rotary") return `Entra a la rotonda y continúa${street}`;
  if (modifier.includes("uturn")) return `Realiza un retorno${street}`;
  if (modifier.includes("sharp left")) return `Gira pronunciadamente a la izquierda${street}`;
  if (modifier.includes("sharp right")) return `Gira pronunciadamente a la derecha${street}`;
  if (modifier.includes("slight left")) return `Mantente levemente a la izquierda${street}`;
  if (modifier.includes("slight right")) return `Mantente levemente a la derecha${street}`;
  if (modifier.includes("left")) return `Gira a la izquierda${street}`;
  if (modifier.includes("right")) return `Gira a la derecha${street}`;
  if (step.maneuver.type === "depart") return `Avanza${street}`;
  return `Continúa${street}`;
}

function readHistory(): DailySummary[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is DailySummary => Boolean(item && typeof item === "object")) : [];
  } catch {
    return [];
  }
}

function saveHistory(history: DailySummary[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-120)));
  } catch {}
}

function findNextStop(label: string) {
  const wanted = normalize(label);
  if (!wanted) return undefined;
  return STOPS.find((stop) => {
    const address = normalize(stop.address ?? "");
    const name = normalize(stop.name);
    return (address.length > 4 && (wanted.includes(address) || address.includes(wanted))) ||
      (name.length > 4 && wanted.includes(name));
  });
}

function readDomSummary(): DomSummary {
  const rows = Array.from(document.querySelectorAll<HTMLElement>(".stop-row"));
  const done = rows.filter((row) => row.classList.contains("done")).length;
  const absent = rows.filter((row) => row.classList.contains("absent")).length;
  const pending = rows.filter((row) => row.classList.contains("pending")).length;
  const cards = Array.from(document.querySelectorAll<HTMLElement>(".stats-row article"));
  const metrics = new Map(cards.map((card) => [
    card.querySelector("span")?.textContent?.trim() ?? "",
    card.querySelector("strong")?.textContent?.trim() ?? "",
  ]));
  return {
    done,
    absent,
    pending,
    total: rows.length,
    actualKm: numberFromText(metrics.get("Recorrido por GPS")),
    movingMinutes: numberFromText(metrics.get("En movimiento")),
    stoppedMinutes: numberFromText(metrics.get("Detenido")),
  };
}

function comparisonText(current: number, previous: number, unit: string, lowerIsBetter = false) {
  const difference = current - previous;
  if (Math.abs(difference) < 0.05) return { icon: "→", text: `Sin cambios en ${unit}`, good: true };
  const improved = lowerIsBetter ? difference < 0 : difference > 0;
  const absolute = Math.abs(difference);
  return {
    icon: difference < 0 ? "↓" : "↑",
    text: `${absolute.toLocaleString("es-CL", { maximumFractionDigits: 1 })} ${unit} ${difference < 0 ? "menos" : "más"}`,
    good: improved,
  };
}

export default function LevelOneSuite() {
  const activeDay = readActiveRouteDay();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [nextLabel, setNextLabel] = useState("");
  const [instruction, setInstruction] = useState("Activa el GPS para comenzar la guía propia.");
  const [navigationDistance, setNavigationDistance] = useState(0);
  const [navigationMinutes, setNavigationMinutes] = useState(0);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [connected, setConnected] = useState(true);
  const [clock, setClock] = useState(() => Date.now());
  const [domSummary, setDomSummary] = useState<DomSummary>({ done: 0, absent: 0, pending: 0, total: 0, actualKm: 0, movingMinutes: 0, stoppedMinutes: 0 });
  const [history, setHistory] = useState<DailySummary[]>([]);
  const [selectedDay, setSelectedDay] = useState<RouteDay>(activeDay);
  const [dayCounts, setDayCounts] = useState(() => readRouteDayCounts());
  const [plans, setPlans] = useState(() => readRoutePlanMetadata());
  const [plannerNotice, setPlannerNotice] = useState("");
  const lastRouteRequestRef = useRef<{ lat: number; lng: number; stopId: string; at: number } | null>(null);
  const lastSpokenRef = useRef("");

  const speak = useCallback((message: string, force = false) => {
    if (!voiceEnabled && !force) return;
    if (!("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = "es-CL";
    utterance.rate = 0.96;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [voiceEnabled]);

  useEffect(() => {
    setHistory(readHistory());
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const receivePosition = (event: WindowEventMap["ruta-verde:gps-position"]) => setPosition(event.detail);
    window.addEventListener("ruta-verde:gps-position", receivePosition);
    return () => window.removeEventListener("ruta-verde:gps-position", receivePosition);
  }, []);

  useEffect(() => {
    const refresh = () => {
      const label = document.querySelector<HTMLElement>(".next-card h2")?.textContent?.trim() ?? "";
      setNextLabel(label);
      setDomSummary(readDomSummary());

      const brand = document.querySelector<HTMLElement>(".brand-copy strong");
      if (brand) brand.textContent = `Ruta Verde · ${activeDay}`;
      const date = document.querySelector<HTMLElement>(".header-date span");
      if (date) date.textContent = `${activeDay} · recorrido activo`;
      const managerKicker = document.querySelector<HTMLElement>(".manager-kicker");
      if (managerKicker) managerKicker.textContent = `Jornada Santuario · ${activeDay}`;
    };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const timer = window.setInterval(refresh, 5_000);
    return () => { observer.disconnect(); window.clearInterval(timer); };
  }, [activeDay]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/tracking", { cache: "no-store" });
        if (!response.ok) throw new Error("tracking unavailable");
        const data = await response.json() as { tracking: Tracking | null };
        if (!active) return;
        setTracking(data.tracking);
        setConnected(true);
      } catch {
        if (active) setConnected(false);
      }
    };
    void load();
    const timer = window.setInterval(load, 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const targetStop = useMemo(() => findNextStop(nextLabel || tracking?.next_stop || ""), [nextLabel, tracking?.next_stop, position]);

  useEffect(() => {
    if (!position || !targetStop) return;
    const previous = lastRouteRequestRef.current;
    const moved = previous ? distanceMeters(position, { lat: previous.lat, lng: previous.lng, id: "", name: "", km: 0 }) : Number.POSITIVE_INFINITY;
    if (previous?.stopId === targetStop.id && moved < 18 && Date.now() - previous.at < 8_000) return;

    const controller = new AbortController();
    lastRouteRequestRef.current = { lat: position.lat, lng: position.lng, stopId: targetStop.id, at: Date.now() };
    const origin = `${position.lng},${position.lat}`;
    const destination = `${targetStop.lng},${targetStop.lat}`;

    void fetch(`/api/navigation?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`, {
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("navigation unavailable");
      const data = await response.json() as NavigationResponse;
      const firstUsefulIndex = Math.max(0, data.steps.findIndex((step) => step.distance > 4));
      const currentStep = data.steps[firstUsefulIndex] ?? data.steps[0];
      const maneuverStep = data.steps[firstUsefulIndex + 1] ?? currentStep;
      const distance = currentStep?.distance ?? data.distanceMeters;
      const action = maneuverInstruction(maneuverStep, targetStop.address ?? targetStop.name);
      const text = `En ${formatDistance(distance)}, ${action.charAt(0).toLocaleLowerCase("es-CL")}${action.slice(1)}`;
      setInstruction(text);
      setNavigationDistance(data.distanceMeters);
      setNavigationMinutes(data.durationSeconds / 60);

      const bucket = distance <= 35 ? "now" : distance <= 90 ? "near" : distance <= 220 ? "soon" : "far";
      const voiceKey = `${targetStop.id}:${maneuverStep?.maneuver.type}:${maneuverStep?.maneuver.modifier}:${bucket}`;
      if (voiceEnabled && voiceKey !== lastSpokenRef.current && bucket !== "far") {
        lastSpokenRef.current = voiceKey;
        speak(text);
      }
    }).catch(() => {
      if (controller.signal.aborted) return;
      const direct = distanceMeters(position, targetStop);
      const fallback = `Continúa hacia ${targetStop.address ?? targetStop.name}. Estás a ${formatDistance(direct)}.`;
      setInstruction(fallback);
      setNavigationDistance(direct);
      setNavigationMinutes(0);
    });

    return () => controller.abort();
  }, [position, targetStop, speak, voiceEnabled]);

  useEffect(() => {
    if (!voiceEnabled || !targetStop) return;
    const key = `destination:${targetStop.id}`;
    if (lastSpokenRef.current === key) return;
    lastSpokenRef.current = key;
    speak(`La siguiente vivienda es ${targetStop.address ?? targetStop.name}`);
  }, [targetStop, voiceEnabled, speak]);

  const done = tracking ? (tracking.done ?? tracking.completed ?? 0) : domSummary.done;
  const absent = tracking ? (tracking.absent ?? 0) : domSummary.absent;
  const total = tracking ? (tracking.total ?? domSummary.total) : domSummary.total;
  const pending = tracking ? (tracking.pending ?? Math.max(0, total - done - absent)) : domSummary.pending;
  const reviewed = done + absent;
  const progress = Math.round((reviewed / Math.max(1, total)) * 100);
  const kilos = tracking?.kilos ?? 0;
  const actualKm = tracking?.actual_km ?? domSummary.actualKm;
  const movingMinutes = tracking?.moving_minutes ?? domSummary.movingMinutes;
  const stoppedMinutes = tracking?.stopped_minutes ?? domSummary.stoppedMinutes;
  const startedAt = tracking?.started_at ?? null;
  const elapsedMinutes = startedAt ? Math.max(0, (clock - startedAt) / 60_000) : movingMinutes + stoppedMinutes;
  const averageSpeed = movingMinutes > 0 ? actualKm / (movingMinutes / 60) : 0;
  const estimatedMinutes = tracking?.estimated_minutes ?? 0;
  const trackingAge = tracking ? Math.max(0, Math.round((clock - tracking.updated_at) / 1000)) : null;

  const currentSummary = useMemo<DailySummary>(() => ({
    id: `${chileDate()}-${activeDay}`,
    date: chileDate(),
    day: activeDay,
    total,
    done,
    absent,
    pending,
    kilos,
    progress,
    actualKm,
    movingMinutes,
    stoppedMinutes,
    elapsedMinutes,
    averageSpeed,
    updatedAt: Date.now(),
  }), [activeDay, total, done, absent, pending, kilos, progress, actualKm, movingMinutes, stoppedMinutes, elapsedMinutes, averageSpeed]);

  useEffect(() => {
    if (currentSummary.total <= 0 || (currentSummary.done === 0 && currentSummary.absent === 0 && currentSummary.actualKm === 0)) return;
    const updated = [...readHistory().filter((item) => item.id !== currentSummary.id), currentSummary]
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(-120);
    saveHistory(updated);
    setHistory(updated);
  }, [currentSummary]);

  const previousSummary = useMemo(() => history
    .filter((item) => item.day === activeDay && item.id !== currentSummary.id)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0], [history, activeDay, currentSummary.id]);

  const comparisons = previousSummary ? [
    comparisonText(currentSummary.elapsedMinutes, previousSummary.elapsedMinutes, "minutos", true),
    comparisonText(currentSummary.actualKm, previousSummary.actualKm, "km", true),
    comparisonText(currentSummary.done, previousSummary.done, "viviendas"),
  ] : [];

  const updatePlan = (field: keyof RoutePlanMetadata, value: string) => {
    setPlans((current) => {
      const updated = { ...current, [selectedDay]: { ...current[selectedDay], [field]: value } };
      writeRoutePlanMetadata(updated);
      return updated;
    });
  };

  const assignVisibleStops = () => {
    if (!STOPS.length) {
      setPlannerNotice("Este recorrido no tiene viviendas cargadas para copiar.");
      return;
    }
    addStopsToRouteDay(STOPS.map((stop) => stop.id), selectedDay);
    setPlannerNotice(`${STOPS.length} viviendas quedaron incluidas también en el recorrido de ${selectedDay}. Actívalo para abrirlo.`);
    setDayCounts((current) => ({ ...current, [selectedDay]: Math.max(current[selectedDay], STOPS.length) }));
  };

  const removeVisibleStops = () => {
    if (selectedDay === activeDay) {
      setPlannerNotice("No puedes vaciar el recorrido que está abierto. Activa otro día primero.");
      return;
    }
    removeStopsFromRouteDay(STOPS.map((stop) => stop.id), selectedDay);
    setPlannerNotice(`Se quitaron las viviendas visibles del plan de ${selectedDay}.`);
    setDayCounts(readRouteDayCounts());
  };

  const activateDay = () => {
    const available = dayCounts[selectedDay] > 0 || selectedDay === activeDay;
    if (!available) {
      setPlannerNotice(`El recorrido de ${selectedDay} todavía no tiene viviendas. Usa “Agregar viviendas visibles” primero.`);
      return;
    }
    writeActiveRouteDay(selectedDay);
    window.location.reload();
  };

  const openManager = () => {
    const button = document.querySelectorAll<HTMLButtonElement>(".app-tabs button")[1];
    button?.click();
    setPanel(null);
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 50);
  };

  const connectionLabel = !tracking
    ? "Esperando GPS"
    : !connected || (trackingAge !== null && trackingAge > 60)
      ? "Sin señal reciente"
      : trackingAge !== null && trackingAge > 15
        ? "Señal atrasada"
        : tracking.status === "finished"
          ? "Recorrido finalizado"
          : "Camión en vivo";

  return (
    <section className="level-one-suite" aria-label="Funciones avanzadas Ruta Verde">
      <div className="level-one-main">
        <div className="level-one-copy">
          <span className="level-one-label">Ruta Verde · Nivel 1</span>
          <strong>{activeDay} · {STOPS.length} viviendas cargadas</strong>
        </div>
        <div className="level-one-actions">
          <button className={panel === "navigation" ? "active" : ""} onClick={() => setPanel(panel === "navigation" ? null : "navigation")}>🧭 Navegador</button>
          <button className={panel === "statistics" ? "active" : ""} onClick={() => setPanel(panel === "statistics" ? null : "statistics")}>📊 Estadísticas</button>
          <button className={panel === "manager" ? "active" : ""} onClick={() => setPanel(panel === "manager" ? null : "manager")}>👨‍💼 Jefatura</button>
          <button className={panel === "planner" ? "active" : ""} onClick={() => setPanel(panel === "planner" ? null : "planner")}>📅 Planificador</button>
        </div>
      </div>

      <div className="level-one-nav-strip" role="status" aria-live="polite">
        <span className="navigation-arrow">➜</span>
        <div><small>{nextLabel || tracking?.next_stop ? "Navegación propia hacia la siguiente vivienda" : "Navegador propio preparado"}</small><strong>{instruction}</strong></div>
        <span className="navigation-distance">{navigationDistance > 0 ? formatDistance(navigationDistance) : position ? `GPS ±${Math.round(position.accuracy)} m` : "Sin GPS"}</span>
      </div>

      {panel && <div className="level-one-panel">
        <button className="level-one-close" onClick={() => setPanel(null)} aria-label="Cerrar panel">×</button>

        {panel === "navigation" && <div className="level-one-panel-content">
          <div className="panel-heading"><div><span>Navegador propio</span><h2>Indicaciones sin salir de Ruta Verde</h2></div><button className={voiceEnabled ? "voice-on" : ""} onClick={() => { const next = !voiceEnabled; setVoiceEnabled(next); if (next) speak(`Voz activada. La siguiente vivienda es ${targetStop?.address ?? nextLabel || "la parada pendiente"}`, true); }}>{voiceEnabled ? "🔊 Voz activa" : "🔇 Activar voz"}</button></div>
          <div className="navigation-command"><span>Próxima instrucción</span><strong>{instruction}</strong><small>{targetStop ? `Siguiente vivienda: ${targetStop.address ?? targetStop.name}` : nextLabel ? `Siguiente vivienda: ${nextLabel}` : "Inicia el recorrido y activa el GPS."}</small></div>
          <div className="navigation-kpis"><div><span>Distancia</span><strong>{navigationDistance > 0 ? formatDistance(navigationDistance) : "—"}</strong></div><div><span>Tiempo estimado</span><strong>{navigationMinutes > 0 ? formatMinutes(navigationMinutes) : "—"}</strong></div><div><span>Velocidad</span><strong>{position?.speed !== null && position?.speed !== undefined ? `${Math.round(position.speed * 3.6)} km/h` : "—"}</strong></div><div><span>Precisión GPS</span><strong>{position ? `±${Math.round(position.accuracy)} m` : "—"}</strong></div></div>
          <button className="repeat-instruction" onClick={() => speak(`${instruction}. La siguiente vivienda es ${targetStop?.address ?? nextLabel}`, true)}>Repetir indicación</button>
          <p className="panel-note">La guía usa el mismo GPS del camión; no abre un segundo seguimiento ni bloquea el mapa.</p>
        </div>}

        {panel === "statistics" && <div className="level-one-panel-content">
          <div className="panel-heading"><div><span>Estadísticas automáticas</span><h2>Resultados del recorrido de {activeDay}</h2></div><div className="live-chip">Guardado automático</div></div>
          <div className="statistics-grid">
            <article><span>Kilómetros</span><strong>{actualKm.toLocaleString("es-CL", { maximumFractionDigits: 2 })} km</strong></article>
            <article><span>Tiempo</span><strong>{formatMinutes(elapsedMinutes)}</strong></article>
            <article><span>Velocidad promedio</span><strong>{averageSpeed > 0 ? `${averageSpeed.toLocaleString("es-CL", { maximumFractionDigits: 1 })} km/h` : "—"}</strong></article>
            <article><span>Realizadas</span><strong>{done}</strong></article>
            <article><span>Ausentes</span><strong>{absent}</strong></article>
            <article><span>Kilos recolectados</span><strong>{kilos > 0 ? `${kilos.toLocaleString("es-CL", { maximumFractionDigits: 1 })} kg` : "—"}</strong></article>
            <article><span>Completado</span><strong>{progress}%</strong></article>
          </div>
          <div className="comparison-box"><div><span>Comparación</span><strong>{previousSummary ? `${previousSummary.day} ${new Date(`${previousSummary.date}T12:00:00`).toLocaleDateString("es-CL")}` : "Primer recorrido registrado"}</strong></div>{comparisons.length ? <div className="comparison-list">{comparisons.map((item, index) => <span className={item.good ? "good" : "attention"} key={index}><b>{item.icon}</b>{item.text}</span>)}</div> : <p>Cuando realices nuevamente este recorrido, Ruta Verde mostrará automáticamente cuánto tiempo, kilómetros y viviendas mejoraron.</p>}</div>
        </div>}

        {panel === "manager" && <div className="level-one-panel-content">
          <div className="panel-heading"><div><span>Centro de control</span><h2>Seguimiento para jefatura</h2></div><div className={`live-chip ${connected ? "" : "warning"}`}>{connectionLabel}</div></div>
          <div className="manager-preview-grid"><article><span>Avance</span><strong>{progress}%</strong><small>{reviewed} de {total} revisadas</small></article><article><span>Cuánto falta</span><strong>{pending}</strong><small>viviendas pendientes</small></article><article><span>Próxima vivienda</span><strong>{tracking?.next_stop ?? nextLabel || "Esperando inicio"}</strong><small>actualizada desde el camión</small></article><article><span>Hora estimada de término</span><strong>{estimatedMinutes > 0 ? new Date(clock + estimatedMinutes * 60_000).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" }) : "—"}</strong><small>{estimatedMinutes > 0 ? `faltan aproximadamente ${formatMinutes(estimatedMinutes)}` : "se calculará con el avance"}</small></article></div>
          <div className="manager-location-line"><span>📍</span><div><strong>{tracking ? `${tracking.lat.toFixed(5)}, ${tracking.lng.toFixed(5)}` : "Sin ubicación recibida"}</strong><small>{trackingAge !== null ? `Última señal hace ${trackingAge} segundos` : "El conductor debe activar el GPS"}</small></div></div>
          <button className="open-manager-button" onClick={openManager}>Abrir panel completo de jefatura</button>
        </div>}

        {panel === "planner" && <div className="level-one-panel-content">
          <div className="panel-heading"><div><span>Planificador semanal</span><h2>Un recorrido distinto para cada día</h2></div><div className="live-chip">Activo: {activeDay}</div></div>
          <div className="day-tabs">{ROUTE_DAYS.map((day) => <button className={selectedDay === day ? "active" : ""} onClick={() => setSelectedDay(day)} key={day}><strong>{day.slice(0, 3)}</strong><span>{dayCounts[day]} casas</span></button>)}</div>
          <div className="planner-form"><label>Nombre del recorrido<input value={plans[selectedDay].name} onChange={(event) => updatePlan("name", event.target.value)} /></label><label>Conductor responsable<input value={plans[selectedDay].driver} onChange={(event) => updatePlan("driver", event.target.value)} placeholder="Nombre del conductor" /></label><label>Vehículo<select value={plans[selectedDay].vehicle} onChange={(event) => updatePlan("vehicle", event.target.value)}><option>Camión</option><option>Camioneta</option><option>Auto</option><option>Bicicleta</option></select></label><label>Hora de salida<input type="time" value={plans[selectedDay].startTime} onChange={(event) => updatePlan("startTime", event.target.value)} /></label></div>
          <div className="planner-summary"><div><span>Recorrido seleccionado</span><strong>{plans[selectedDay].name || `Recorrido ${selectedDay}`}</strong><small>{dayCounts[selectedDay]} viviendas · {plans[selectedDay].vehicle} · salida {plans[selectedDay].startTime}</small></div><button className="activate-route-button" onClick={activateDay}>{selectedDay === activeDay ? "Recorrido abierto" : `Activar ${selectedDay}`}</button></div>
          <div className="planner-actions"><button onClick={assignVisibleStops}>Agregar las {STOPS.length} viviendas visibles a {selectedDay}</button><button onClick={removeVisibleStops}>Quitar viviendas visibles de {selectedDay}</button></div>
          {plannerNotice && <div className="planner-notice" role="status">{plannerNotice}</div>}
          <p className="panel-note">Al activar un día la aplicación se recarga y muestra solamente las viviendas asignadas a ese recorrido. Las estadísticas quedan separadas por día.</p>
        </div>}
      </div>}

      <style jsx global>{`
        .level-one-suite { position: sticky; top: 54px; z-index: 9000; background: #f4f7f2; border-bottom: 1px solid #dce6df; box-shadow: 0 10px 28px rgba(14, 52, 40, .10); }
        .level-one-main { display: flex; align-items: center; justify-content: space-between; gap: 14px; max-width: 1500px; margin: auto; padding: 10px 16px; }
        .level-one-copy { display: grid; gap: 2px; min-width: 180px; }
        .level-one-copy strong { color: #163f33; font-size: 14px; }
        .level-one-label { color: #4f6e63; font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: .12em; }
        .level-one-actions { display: flex; gap: 7px; flex-wrap: wrap; justify-content: flex-end; }
        .level-one-actions button { min-height: 38px; padding: 0 12px; border: 1px solid #cedbd4; border-radius: 11px; background: #fff; color: #25483d; font-size: 12px; font-weight: 850; cursor: pointer; }
        .level-one-actions button.active { background: #173f33; border-color: #173f33; color: #fff; }
        .level-one-nav-strip { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 11px; max-width: 1500px; margin: auto; padding: 9px 16px 11px; border-top: 1px solid #e0e9e3; }
        .navigation-arrow { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: #dff2e7; color: #176042; font-size: 20px; font-weight: 900; }
        .level-one-nav-strip div { min-width: 0; display: grid; gap: 1px; }
        .level-one-nav-strip small { color: #647a72; font-size: 10px; font-weight: 800; }
        .level-one-nav-strip strong { overflow: hidden; color: #173f33; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
        .navigation-distance { padding: 7px 10px; border-radius: 999px; background: #fff; color: #31594b; font-size: 11px; font-weight: 900; white-space: nowrap; }
        .level-one-panel { position: relative; max-width: 1180px; margin: 0 auto 12px; border: 1px solid #d4e0d9; border-radius: 18px; background: #fff; box-shadow: 0 20px 60px rgba(14, 52, 40, .18); }
        .level-one-panel-content { padding: 22px; }
        .level-one-close { position: absolute; top: 10px; right: 12px; z-index: 2; width: 34px; height: 34px; border: 0; border-radius: 50%; background: #edf2ef; color: #35564b; font-size: 22px; cursor: pointer; }
        .panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding-right: 38px; margin-bottom: 18px; }
        .panel-heading div:first-child { display: grid; gap: 3px; }
        .panel-heading span { color: #638075; font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: .1em; }
        .panel-heading h2 { margin: 0; color: #173f33; font-size: 22px; }
        .panel-heading button, .live-chip { min-height: 38px; padding: 0 13px; border: 1px solid #cfe0d6; border-radius: 999px; background: #edf7f1; color: #216346; font-size: 11px; font-weight: 900; }
        .panel-heading button.voice-on { background: #173f33; color: #fff; }
        .live-chip.warning { background: #fff1d3; color: #835d17; }
        .navigation-command { display: grid; gap: 7px; padding: 20px; border-radius: 17px; background: #173f33; color: #fff; }
        .navigation-command span { color: #a9dbc7; font-size: 11px; font-weight: 900; text-transform: uppercase; }
        .navigation-command strong { font-size: 25px; line-height: 1.18; }
        .navigation-command small { color: #d7e9e2; font-size: 13px; }
        .navigation-kpis, .statistics-grid, .manager-preview-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 12px; }
        .navigation-kpis div, .statistics-grid article, .manager-preview-grid article { display: grid; gap: 4px; min-height: 88px; padding: 14px; border: 1px solid #dbe5df; border-radius: 14px; background: #f8faf8; }
        .navigation-kpis span, .statistics-grid span, .manager-preview-grid span { color: #6a7f77; font-size: 10px; font-weight: 850; text-transform: uppercase; }
        .navigation-kpis strong, .statistics-grid strong, .manager-preview-grid strong { color: #173f33; font-size: 20px; }
        .manager-preview-grid small { color: #71847d; font-size: 11px; }
        .repeat-instruction, .open-manager-button, .activate-route-button { width: 100%; min-height: 48px; margin-top: 12px; border: 0; border-radius: 13px; background: #1d7656; color: #fff; font-size: 13px; font-weight: 900; cursor: pointer; }
        .panel-note { margin: 12px 0 0; color: #657a72; font-size: 11px; }
        .statistics-grid { grid-template-columns: repeat(7, 1fr); }
        .statistics-grid article { min-height: 98px; }
        .comparison-box { display: grid; grid-template-columns: minmax(170px, .6fr) 1.4fr; gap: 18px; margin-top: 14px; padding: 17px; border-radius: 15px; background: #eef4f0; }
        .comparison-box > div:first-child { display: grid; align-content: center; gap: 3px; }
        .comparison-box span { color: #667b73; font-size: 10px; font-weight: 850; text-transform: uppercase; }
        .comparison-box strong { color: #173f33; }
        .comparison-box p { margin: 0; color: #5c7169; font-size: 12px; }
        .comparison-list { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .comparison-list span { display: inline-flex; align-items: center; gap: 6px; padding: 8px 10px; border-radius: 999px; text-transform: none; }
        .comparison-list span.good { background: #dff2e7; color: #176042; }
        .comparison-list span.attention { background: #fff0d6; color: #845b15; }
        .comparison-list b { font-size: 16px; }
        .manager-location-line { display: flex; align-items: center; gap: 12px; margin-top: 12px; padding: 14px; border-radius: 14px; background: #eef4f0; }
        .manager-location-line > span { font-size: 22px; }
        .manager-location-line div { display: grid; gap: 2px; }
        .manager-location-line strong { color: #173f33; }
        .manager-location-line small { color: #697d76; }
        .day-tabs { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
        .day-tabs button { display: grid; gap: 3px; min-height: 62px; padding: 9px; border: 1px solid #d7e2dc; border-radius: 13px; background: #f7f9f7; color: #315449; cursor: pointer; }
        .day-tabs button.active { background: #173f33; border-color: #173f33; color: #fff; }
        .day-tabs strong { font-size: 13px; }
        .day-tabs span { font-size: 10px; }
        .planner-form { display: grid; grid-template-columns: 1.4fr 1.2fr .8fr .7fr; gap: 10px; margin-top: 13px; }
        .planner-form label { display: grid; gap: 5px; color: #61766e; font-size: 10px; font-weight: 850; text-transform: uppercase; }
        .planner-form input, .planner-form select { width: 100%; min-height: 43px; box-sizing: border-box; border: 1px solid #cfdbd4; border-radius: 11px; background: #fff; padding: 0 11px; color: #173f33; font-size: 13px; }
        .planner-summary { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 13px; padding: 15px; border-radius: 14px; background: #edf4ef; }
        .planner-summary div { display: grid; gap: 3px; }
        .planner-summary span { color: #687c74; font-size: 10px; font-weight: 850; text-transform: uppercase; }
        .planner-summary strong { color: #173f33; }
        .planner-summary small { color: #647971; }
        .planner-summary .activate-route-button { width: auto; min-width: 150px; margin: 0; padding: 0 16px; }
        .planner-actions { display: flex; gap: 8px; margin-top: 10px; }
        .planner-actions button { flex: 1; min-height: 43px; border: 1px solid #ccdad2; border-radius: 11px; background: #fff; color: #31574a; font-size: 11px; font-weight: 850; cursor: pointer; }
        .planner-notice { margin-top: 10px; padding: 11px 13px; border-radius: 11px; background: #e4f3ea; color: #206045; font-size: 11px; font-weight: 800; }
        .primary-action, .row-nav, .segment-box { display: none !important; }
        @media (max-width: 1050px) {
          .statistics-grid { grid-template-columns: repeat(4, 1fr); }
          .planner-form { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 760px) {
          .level-one-suite { top: 50px; }
          .level-one-main { align-items: flex-start; padding: 8px 10px; }
          .level-one-copy { min-width: 105px; }
          .level-one-copy strong { font-size: 11px; }
          .level-one-actions { display: grid; grid-template-columns: repeat(2, 1fr); width: min(260px, 68%); }
          .level-one-actions button { min-height: 34px; padding: 0 7px; font-size: 10px; }
          .level-one-nav-strip { padding: 7px 10px 9px; }
          .level-one-nav-strip strong { font-size: 11px; }
          .navigation-distance { font-size: 9px; }
          .level-one-panel { max-height: 68vh; margin: 0 8px 8px; overflow-y: auto; border-radius: 15px; }
          .level-one-panel-content { padding: 16px 13px; }
          .panel-heading { align-items: flex-start; padding-right: 34px; }
          .panel-heading h2 { font-size: 18px; }
          .navigation-command strong { font-size: 20px; }
          .navigation-kpis, .statistics-grid, .manager-preview-grid { grid-template-columns: repeat(2, 1fr); }
          .comparison-box { grid-template-columns: 1fr; }
          .day-tabs { grid-template-columns: repeat(5, 1fr); gap: 4px; }
          .day-tabs button { min-height: 54px; padding: 6px 2px; }
          .planner-form { grid-template-columns: 1fr; }
          .planner-summary { align-items: stretch; flex-direction: column; }
          .planner-summary .activate-route-button { width: 100%; }
          .planner-actions { flex-direction: column; }
        }
      `}</style>
    </section>
  );
}
