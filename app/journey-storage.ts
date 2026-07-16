import type { Stop } from "./route-data";
import type { GpsMetrics } from "./tracking-types";
import { EMPTY_GPS_METRICS } from "./tracking-types";
import { deleteStored, readStored, writeStored } from "./journey-db";

export type StopStatus = "pending" | "done" | "absent";
export type StopDetail = { kilos: string; material: string; note: string };
export type ActivityEntry = { id: string; stopId: string; stopName: string; stopAddress?: string; status: "done" | "absent"; at: number };
export type StoredPosition = { lat: number; lng: number; accuracy: number | null; at: number };
export type JourneySnapshot = {
  version: 4;
  journeyId: string;
  statuses: Record<string, StopStatus>;
  details: Record<string, StopDetail>;
  customStops: Stop[];
  reverse: boolean;
  optimizedIds: string[];
  startedAt: number | null;
  completedAt: number | null;
  activity: ActivityEntry[];
  vehicle: string;
  lastPosition: StoredPosition | null;
  gpsMetrics: GpsMetrics;
  updatedAt: number;
};

const BACKUP_PREFIX = "ruta-verde-journey-backup:";
const LEGACY_KEY = "santuario-viernes-v2";

export function currentJourneyId() {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return `santuario-${date}`;
}

function isGpsMetrics(value: unknown): value is GpsMetrics {
  if (!value || typeof value !== "object") return false;
  const metrics = value as Partial<GpsMetrics>;
  return typeof metrics.actualKm === "number" && typeof metrics.movingMinutes === "number" && typeof metrics.stoppedMinutes === "number";
}

function normalizeSnapshot(value: unknown): JourneySnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<JourneySnapshot> & { version?: number };
  if (typeof candidate.journeyId !== "string" || typeof candidate.updatedAt !== "number") return null;
  if (!candidate.statuses || !candidate.details || !Array.isArray(candidate.customStops) || !Array.isArray(candidate.activity)) return null;
  return {
    version: 4,
    journeyId: candidate.journeyId,
    statuses: candidate.statuses,
    details: candidate.details,
    customStops: candidate.customStops,
    reverse: Boolean(candidate.reverse),
    optimizedIds: Array.isArray(candidate.optimizedIds) ? candidate.optimizedIds : [],
    startedAt: typeof candidate.startedAt === "number" ? candidate.startedAt : null,
    completedAt: typeof candidate.completedAt === "number" ? candidate.completedAt : null,
    activity: candidate.activity,
    vehicle: typeof candidate.vehicle === "string" ? candidate.vehicle : "Camioneta",
    lastPosition: candidate.lastPosition && typeof candidate.lastPosition === "object" ? candidate.lastPosition : null,
    gpsMetrics: isGpsMetrics(candidate.gpsMetrics) ? candidate.gpsMetrics : EMPTY_GPS_METRICS,
    updatedAt: candidate.updatedAt,
  };
}

function backupKey(journeyId: string) {
  return `${BACKUP_PREFIX}${journeyId}`;
}

export function saveJourneyEmergency(snapshot: JourneySnapshot) {
  try { localStorage.setItem(backupKey(snapshot.journeyId), JSON.stringify(snapshot)); } catch {}
}

function readLocalBackup(journeyId: string) {
  try {
    const backup = normalizeSnapshot(JSON.parse(localStorage.getItem(backupKey(journeyId)) || "null"));
    if (backup) return backup;
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null") as Record<string, unknown> | null;
    if (!legacy) return null;
    return {
      version: 4,
      journeyId,
      statuses: (legacy.statuses as JourneySnapshot["statuses"]) || {},
      details: (legacy.details as JourneySnapshot["details"]) || {},
      customStops: (legacy.customStops as Stop[]) || [],
      reverse: Boolean(legacy.reverse),
      optimizedIds: (legacy.optimizedIds as string[]) || [],
      startedAt: typeof legacy.startedAt === "number" ? legacy.startedAt : null,
      completedAt: null,
      activity: (legacy.activity as ActivityEntry[]) || [],
      vehicle: typeof legacy.vehicle === "string" ? legacy.vehicle : "Camioneta",
      lastPosition: null,
      gpsMetrics: isGpsMetrics(legacy.gpsMetrics) ? legacy.gpsMetrics : EMPTY_GPS_METRICS,
      updatedAt: Date.now(),
    } satisfies JourneySnapshot;
  } catch {
    return null;
  }
}

async function loadRemote(journeyId: string) {
  if (!navigator.onLine) return null;
  try {
    const response = await fetch(`/api/journey-state?journey=${encodeURIComponent(journeyId)}`, { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json() as { snapshot?: unknown };
    return normalizeSnapshot(data.snapshot);
  } catch {
    return null;
  }
}

export async function loadJourneySnapshot(journeyId: string) {
  let local: JourneySnapshot | null = null;
  try {
    local = normalizeSnapshot(await readStored<JourneySnapshot>("journeys", journeyId));
  } catch {}
  local = local ?? readLocalBackup(journeyId);
  const remote = await loadRemote(journeyId);
  const selected = !local ? remote : !remote ? local : remote.updatedAt > local.updatedAt ? remote : local;
  if (selected) {
    saveJourneyEmergency(selected);
    try { await writeStored("journeys", journeyId, selected); } catch {}
  }
  return selected;
}

export async function saveJourneySnapshot(snapshot: JourneySnapshot) {
  saveJourneyEmergency(snapshot);
  try { await writeStored("journeys", snapshot.journeyId, snapshot); } catch {}
}

export async function queueJourneySnapshot(snapshot: JourneySnapshot) {
  saveJourneyEmergency(snapshot);
  try {
    await writeStored("outbox", snapshot.journeyId, snapshot);
  } catch {
    try { localStorage.setItem(`outbox:${snapshot.journeyId}`, JSON.stringify(snapshot)); } catch {}
  }
}

async function readQueued(journeyId: string) {
  try {
    const stored = normalizeSnapshot(await readStored<JourneySnapshot>("outbox", journeyId));
    if (stored) return stored;
  } catch {}
  try {
    return normalizeSnapshot(JSON.parse(localStorage.getItem(`outbox:${journeyId}`) || "null"));
  } catch {
    return null;
  }
}

export async function flushJourneyOutbox(journeyId: string) {
  if (!navigator.onLine) return false;
  const snapshot = await readQueued(journeyId);
  if (!snapshot) return true;
  try {
    const response = await fetch("/api/journey-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ journeyId, snapshot }),
    });
    if (!response.ok) return false;
    try { await deleteStored("outbox", journeyId); } catch {}
    try { localStorage.removeItem(`outbox:${journeyId}`); } catch {}
    return true;
  } catch {
    return false;
  }
}
