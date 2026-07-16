import type { JourneySnapshot, SyncMetadata } from "./journey-types";

const DEVICE_KEY = "ruta-verde-device-id";
const GLOBAL_FIELDS = [
  "reverse",
  "optimizedIds",
  "startedAt",
  "completedAt",
  "activity",
  "vehicle",
  "lastPosition",
  "gpsMetrics",
] as const;

function equalValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function deviceId() {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const generated = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_KEY, generated);
    return generated;
  } catch {
    return `device-${Date.now()}`;
  }
}

function cleanTimes(value: unknown) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])),
  );
}

export function normalizeSyncMetadata(value: unknown): SyncMetadata | undefined {
  if (!value || typeof value !== "object") return undefined;
  const sync = value as Partial<SyncMetadata>;
  return {
    deviceId: typeof sync.deviceId === "string" ? sync.deviceId : "unknown-device",
    serverRevision: typeof sync.serverRevision === "number" && Number.isFinite(sync.serverRevision)
      ? Math.max(0, Math.round(sync.serverRevision))
      : 0,
    statusUpdatedAt: cleanTimes(sync.statusUpdatedAt),
    detailUpdatedAt: cleanTimes(sync.detailUpdatedAt),
    customStopUpdatedAt: cleanTimes(sync.customStopUpdatedAt),
    globalUpdatedAt: cleanTimes(sync.globalUpdatedAt),
  };
}

function mergeRecordTimes(
  current: Record<string, unknown>,
  previous: Record<string, unknown>,
  previousTimes: Record<string, number>,
  now: number,
) {
  const result: Record<string, number> = {};
  const keys = new Set([...Object.keys(current), ...Object.keys(previous)]);
  for (const key of keys) {
    result[key] = equalValue(current[key], previous[key])
      ? previousTimes[key] ?? now
      : now;
  }
  return result;
}

function stopMap(snapshot: JourneySnapshot) {
  return Object.fromEntries(snapshot.customStops.map((stop) => [stop.id, stop]));
}

export function withSyncMetadata(snapshot: JourneySnapshot, previous: JourneySnapshot | null) {
  const now = snapshot.updatedAt;
  const previousSync = normalizeSyncMetadata(previous?.sync);
  const currentStops = stopMap(snapshot);
  const previousStops = previous ? stopMap(previous) : {};
  const globalUpdatedAt: Record<string, number> = {};

  for (const field of GLOBAL_FIELDS) {
    globalUpdatedAt[field] = previous && equalValue(snapshot[field], previous[field])
      ? previousSync?.globalUpdatedAt[field] ?? previous.updatedAt
      : now;
  }

  return {
    ...snapshot,
    sync: {
      deviceId: deviceId(),
      serverRevision: previousSync?.serverRevision ?? normalizeSyncMetadata(snapshot.sync)?.serverRevision ?? 0,
      statusUpdatedAt: mergeRecordTimes(snapshot.statuses, previous?.statuses ?? {}, previousSync?.statusUpdatedAt ?? {}, now),
      detailUpdatedAt: mergeRecordTimes(snapshot.details, previous?.details ?? {}, previousSync?.detailUpdatedAt ?? {}, now),
      customStopUpdatedAt: mergeRecordTimes(currentStops, previousStops, previousSync?.customStopUpdatedAt ?? {}, now),
      globalUpdatedAt,
    },
  } satisfies JourneySnapshot;
}

export function journeyStateSignature(snapshot: JourneySnapshot) {
  return JSON.stringify({
    statuses: snapshot.statuses,
    details: snapshot.details,
    customStops: snapshot.customStops,
    reverse: snapshot.reverse,
    optimizedIds: snapshot.optimizedIds,
    startedAt: snapshot.startedAt,
    completedAt: snapshot.completedAt,
    activity: snapshot.activity,
    vehicle: snapshot.vehicle,
    lastPosition: snapshot.lastPosition,
    gpsMetrics: snapshot.gpsMetrics,
  });
}
