"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  formatTurnDistance,
  requestTurnInstructions,
  speechForTurn,
  type NavigationPoint,
  type TurnIcon,
  type TurnInstruction,
} from "./turn-guidance";

type Destination = NavigationPoint & { label: string };
type GuideStatus = "idle" | "locating" | "routing" | "ready" | "error";

const ROUTE_REFRESH_MS = 45_000;
const ADVANCE_RADIUS_METERS = 22;
const FAR_VOICE_RADIUS_METERS = 130;
const NEAR_VOICE_RADIUS_METERS = 38;

const ICONS: Record<TurnIcon, string> = {
  start: "↑",
  straight: "↑",
  "slight-left": "↖",
  left: "←",
  "sharp-left": "↙",
  "slight-right": "↗",
  right: "→",
  "sharp-right": "↘",
  uturn: "↶",
  roundabout: "↻",
  arrive: "●",
};

function pointsEqual(a: Destination | null, b: Destination | null) {
  if (!a || !b) return a === b;
  return Math.abs(a.lat - b.lat) < 0.0000001 && Math.abs(a.lng - b.lng) < 0.0000001 && a.label === b.label;
}

function destinationFromPage(): Destination | null {
  const link = document.querySelector<HTMLAnchorElement>('a.primary-action[href*="destination="]');
  if (!link) return null;

  try {
    const url = new URL(link.href, window.location.href);
    const raw = url.searchParams.get("destination");
    if (!raw) return null;
    const [lat, lng] = raw.split(",").map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const label = document.querySelector<HTMLElement>(".next-card h2")?.textContent?.trim() || "Próximo retiro";
    return { lat, lng, label };
  } catch {
    return null;
  }
}

function distanceMeters(a: NavigationPoint, b: NavigationPoint) {
  const earthRadius = 6_371_000;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function speak(message: string) {
  if (!("speechSynthesis" in window)) return;
  const voice = new SpeechSynthesisUtterance(message);
  voice.lang = "es-CL";
  voice.rate = 0.96;
  voice.pitch = 1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(voice);
}

function firstUsefulInstruction(instructions: TurnInstruction[]) {
  const index = instructions.findIndex((instruction) => instruction.icon !== "start");
  return index >= 0 ? index : 0;
}

export default function TurnNavigationOverlay() {
  const [destination, setDestination] = useState<Destination | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<GuideStatus>("idle");
  const [message, setMessage] = useState("");
  const [position, setPosition] = useState<NavigationPoint | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [instructions, setInstructions] = useState<TurnInstruction[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const watchRef = useRef<number | null>(null);
  const routeAbortRef = useRef<AbortController | null>(null);
  const lastRouteAtRef = useRef(0);
  const announcedRef = useRef(new Set<string>());

  useEffect(() => {
    let frame = 0;
    const refreshDestination = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = destinationFromPage();
        setDestination((current) => pointsEqual(current, next) ? current : next);
      });
    };

    refreshDestination();
    const observer = new MutationObserver(refreshDestination);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
    window.addEventListener("popstate", refreshDestination);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("popstate", refreshDestination);
    };
  }, []);

  useEffect(() => {
    announcedRef.current.clear();
    setInstructions([]);
    setActiveIndex(0);
    lastRouteAtRef.current = 0;
    if (!destination) {
      setEnabled(false);
      setStatus("idle");
      setMessage("");
    }
  }, [destination?.lat, destination?.lng]);

  const calculateRoute = useCallback(async (origin: NavigationPoint, target: Destination) => {
    routeAbortRef.current?.abort();
    const controller = new AbortController();
    routeAbortRef.current = controller;
    setStatus("routing");
    setMessage("Calculando los próximos giros…");

    try {
      const nextInstructions = await requestTurnInstructions(origin, target, controller.signal);
      if (controller.signal.aborted) return;
      announcedRef.current.clear();
      setInstructions(nextInstructions);
      setActiveIndex(firstUsefulInstruction(nextInstructions));
      lastRouteAtRef.current = Date.now();
      setStatus("ready");
      setMessage(`Guía activa hacia ${target.label}`);
    } catch (error) {
      if (controller.signal.aborted) return;
      setStatus("error");
      setMessage(navigator.onLine
        ? "No pude calcular los giros. Usa “Abrir navegación” como respaldo."
        : "Sin internet para recalcular. La ruta general sigue visible.");
    }
  }, []);

  useEffect(() => {
    if (!enabled || !destination) return;
    if (!navigator.geolocation) {
      setStatus("error");
      setMessage("Este dispositivo no permite usar ubicación.");
      setEnabled(false);
      return;
    }

    setStatus("locating");
    setMessage("Buscando ubicación precisa para iniciar la guía…");
    const id = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const nextPosition = { lat: coords.latitude, lng: coords.longitude };
        setPosition(nextPosition);
        setAccuracy(coords.accuracy);
      },
      (error) => {
        setStatus("error");
        setMessage(error.code === 1
          ? "Permite la ubicación para usar la guía de giros."
          : "No pude obtener una ubicación estable. La guía seguirá intentando.");
      },
      { enableHighAccuracy: true, maximumAge: 1_000, timeout: 20_000 },
    );
    watchRef.current = id;

    return () => {
      navigator.geolocation.clearWatch(id);
      if (watchRef.current === id) watchRef.current = null;
    };
  }, [enabled, destination]);

  useEffect(() => {
    if (!enabled || !destination || !position) return;
    if (!instructions.length || Date.now() - lastRouteAtRef.current >= ROUTE_REFRESH_MS) {
      void calculateRoute(position, destination);
    }
  }, [enabled, destination, position, instructions.length, calculateRoute]);

  useEffect(() => {
    if (!enabled || !position || !instructions.length) return;
    const current = instructions[Math.min(activeIndex, instructions.length - 1)];
    if (!current) return;

    const distance = distanceMeters(position, current.location);
    if (distance <= ADVANCE_RADIUS_METERS && activeIndex < instructions.length - 1) {
      setActiveIndex((index) => Math.min(index + 1, instructions.length - 1));
      return;
    }

    const farKey = `${current.id}:far`;
    const nearKey = `${current.id}:near`;
    if (distance <= NEAR_VOICE_RADIUS_METERS && !announcedRef.current.has(nearKey)) {
      announcedRef.current.add(farKey);
      announcedRef.current.add(nearKey);
      speak(current.icon === "arrive" ? current.text : `Ahora, ${current.text.toLocaleLowerCase("es-CL")}`);
    } else if (distance <= FAR_VOICE_RADIUS_METERS && !announcedRef.current.has(farKey)) {
      announcedRef.current.add(farKey);
      speak(speechForTurn(current, distance));
    }
  }, [enabled, position, instructions, activeIndex]);

  useEffect(() => () => {
    routeAbortRef.current?.abort();
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
  }, []);

  const activeInstruction = instructions[Math.min(activeIndex, instructions.length - 1)] ?? null;
  const distanceToInstruction = useMemo(() => {
    if (!position || !activeInstruction) return null;
    return distanceMeters(position, activeInstruction.location);
  }, [position, activeInstruction]);

  if (!destination) return null;

  return (
    <section
      aria-label="Navegación giro a giro"
      style={{
        position: "fixed",
        left: "max(12px, env(safe-area-inset-left))",
        right: "max(12px, env(safe-area-inset-right))",
        bottom: "max(14px, env(safe-area-inset-bottom))",
        zIndex: 2200,
        pointerEvents: "none",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: "min(620px, 100%)",
          borderRadius: 20,
          padding: enabled ? "13px 14px" : 8,
          background: enabled ? "rgba(12, 48, 39, 0.97)" : "rgba(255, 255, 255, 0.96)",
          color: enabled ? "white" : "#123a31",
          boxShadow: "0 14px 45px rgba(5, 28, 23, 0.28)",
          border: enabled ? "1px solid rgba(220, 236, 117, 0.28)" : "1px solid rgba(18, 58, 49, 0.16)",
          pointerEvents: "auto",
          backdropFilter: "blur(14px)",
        }}
      >
        {!enabled ? (
          <button
            type="button"
            onClick={() => {
              setEnabled(true);
              setStatus("locating");
              setMessage("Activando guía de giros…");
            }}
            style={{
              width: "100%",
              minHeight: 48,
              border: 0,
              borderRadius: 14,
              background: "#dcec75",
              color: "#123a31",
              fontSize: 15,
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            🔊 Activar guía de giros hacia {destination.label}
          </button>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "76px 1fr auto", alignItems: "center", gap: 12 }}>
            <div
              aria-hidden="true"
              style={{
                display: "grid",
                placeItems: "center",
                width: 70,
                height: 70,
                borderRadius: 18,
                background: "#dcec75",
                color: "#123a31",
                fontSize: 42,
                fontWeight: 950,
              }}
            >
              {activeInstruction ? ICONS[activeInstruction.icon] : "…"}
            </div>
            <div style={{ minWidth: 0 }} aria-live="polite">
              <strong style={{ display: "block", fontSize: 13, color: "#dcec75", letterSpacing: ".04em" }}>
                {distanceToInstruction === null ? "PREPARANDO" : `EN ${formatTurnDistance(distanceToInstruction).toUpperCase()}`}
              </strong>
              <span style={{ display: "block", fontSize: 18, lineHeight: 1.15, fontWeight: 900, marginTop: 2 }}>
                {activeInstruction?.text ?? message}
              </span>
              <small style={{ display: "block", marginTop: 5, color: "rgba(255,255,255,.76)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {status === "ready" ? `Destino: ${destination.label}${accuracy !== null ? ` · GPS ±${Math.round(accuracy)} m` : ""}` : message}
              </small>
            </div>
            <button
              type="button"
              onClick={() => {
                setEnabled(false);
                setStatus("idle");
                setMessage("");
                setInstructions([]);
                window.speechSynthesis?.cancel();
              }}
              aria-label="Desactivar guía de giros"
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,.22)",
                background: "rgba(255,255,255,.09)",
                color: "white",
                fontSize: 18,
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
