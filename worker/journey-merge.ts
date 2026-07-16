type JsonRecord = Record<string, unknown>;

type SyncMetadata = {
  deviceId: string;
  serverRevision: number;
  statusUpdatedAt: Record<string, number>;
  detailUpdatedAt: Record<string, number>;
  customStopUpdatedAt: Record<string, number>;
  globalUpdatedAt: Record<string, number>;
};

const GLOBAL_FIELDS = [
  "reverse",
  "optimizedIds",
  "startedAt",
  "completedAt",
  "vehicle",
  "lastPosition",
  "gpsMetrics",
] as const;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function finiteTimestamp(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function cleanTimes(value: unknown) {
  return Object.fromEntries(
    Object.entries(record(value))
      .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])),
  );
}

function normalizeSync(snapshot: JsonRecord): SyncMetadata {
  const raw = record(snapshot.sync);
  const updatedAt = finiteTimestamp(snapshot.updatedAt, Date.now());
  const statuses = record(snapshot.statuses);
  const details = record(snapshot.details);
  const customStops = Array.isArray(snapshot.customStops) ? snapshot.customStops : [];
  const statusUpdatedAt = cleanTimes(raw.statusUpdatedAt);
  const detailUpdatedAt = cleanTimes(raw.detailUpdatedAt);
  const customStopUpdatedAt = cleanTimes(raw.customStopUpdatedAt);
  const globalUpdatedAt = cleanTimes(raw.globalUpdatedAt);

  for (const key of Object.keys(statuses)) statusUpdatedAt[key] ??= updatedAt;
  for (const key of Object.keys(details)) detailUpdatedAt[key] ??= updatedAt;
  for (const stop of customStops) {
    const id = record(stop).id;
    if (typeof id === "string") customStopUpdatedAt[id] ??= updatedAt;
  }
  for (const field of GLOBAL_FIELDS) {
    if (field in snapshot) globalUpdatedAt[field] ??= updatedAt;
  }

  return {
    deviceId: typeof raw.deviceId === "string" ? raw.deviceId : "unknown-device",
    serverRevision: Math.max(0, Math.round(finiteTimestamp(raw.serverRevision, 0))),
    statusUpdatedAt,
    detailUpdatedAt,
    customStopUpdatedAt,
    globalUpdatedAt,
  };
}

function valueTimestamp(
  source: JsonRecord,
  sync: SyncMetadata,
  bucket: "statusUpdatedAt" | "detailUpdatedAt",
  key: string,
) {
  const times = sync[bucket];
  if (times[key] !== undefined) return times[key];
  return key in source ? finiteTimestamp(source.updatedAt, 0) : 0;
}

function mergeTimedRecord(
  existingSnapshot: JsonRecord,
  incomingSnapshot: JsonRecord,
  field: "statuses" | "details",
  bucket: "statusUpdatedAt" | "detailUpdatedAt",
  existingSync: SyncMetadata,
  incomingSync: SyncMetadata,
) {
  const existing = record(existingSnapshot[field]);
  const incoming = record(incomingSnapshot[field]);
  const keys = new Set([...Object.keys(existing), ...Object.keys(incoming), ...Object.keys(existingSync[bucket]), ...Object.keys(incomingSync[bucket])]);
  const merged: JsonRecord = {};
  const times: Record<string, number> = {};

  for (const key of keys) {
    const existingAt = valueTimestamp(existingSnapshot, existingSync, bucket, key);
    const incomingAt = valueTimestamp(incomingSnapshot, incomingSync, bucket, key);
    const useIncoming = incomingAt > existingAt || (incomingAt === existingAt && key in incoming);
    const source = useIncoming ? incoming : existing;
    const selectedAt = useIncoming ? incomingAt : existingAt;
    if (key in source) merged[key] = source[key];
    if (selectedAt > 0) times[key] = selectedAt;
  }

  return { merged, times };
}

function stopEntries(value: unknown) {
  const stops = Array.isArray(value) ? value : [];
  return new Map(
    stops.flatMap((stop) => {
      const item = record(stop);
      return typeof item.id === "string" ? [[item.id, item] as const] : [];
    }),
  );
}

function mergeCustomStops(
  existingSnapshot: JsonRecord,
  incomingSnapshot: JsonRecord,
  existingSync: SyncMetadata,
  incomingSync: SyncMetadata,
) {
  const existing = stopEntries(existingSnapshot.customStops);
  const incoming = stopEntries(incomingSnapshot.customStops);
  const keys = new Set([...existing.keys(), ...incoming.keys(), ...Object.keys(existingSync.customStopUpdatedAt), ...Object.keys(incomingSync.customStopUpdatedAt)]);
  const merged: JsonRecord[] = [];
  const times: Record<string, number> = {};

  for (const key of keys) {
    const existingAt = existingSync.customStopUpdatedAt[key] ?? (existing.has(key) ? finiteTimestamp(existingSnapshot.updatedAt, 0) : 0);
    const incomingAt = incomingSync.customStopUpdatedAt[key] ?? (incoming.has(key) ? finiteTimestamp(incomingSnapshot.updatedAt, 0) : 0);
    const useIncoming = incomingAt > existingAt || (incomingAt === existingAt && incoming.has(key));
    const selected = useIncoming ? incoming.get(key) : existing.get(key);
    const selectedAt = useIncoming ? incomingAt : existingAt;
    if (selected) merged.push(selected);
    if (selectedAt > 0) times[key] = selectedAt;
  }

  return { merged, times };
}

function mergeActivity(existing: unknown, incoming: unknown) {
  const entries = [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])];
  const byId = new Map<string, JsonRecord>();
  for (const entry of entries) {
    const item = record(entry);
    const id = typeof item.id === "string" ? item.id : "";
    if (!id) continue;
    const previous = byId.get(id);
    if (!previous || finiteTimestamp(item.at, 0) >= finiteTimestamp(previous.at, 0)) byId.set(id, item);
  }
  return [...byId.values()]
    .sort((left, right) => finiteTimestamp(right.at, 0) - finiteTimestamp(left.at, 0))
    .slice(0, 200);
}

function chooseGlobal(
  existingSnapshot: JsonRecord,
  incomingSnapshot: JsonRecord,
  field: string,
  existingSync: SyncMetadata,
  incomingSync: SyncMetadata,
) {
  const existingAt = existingSync.globalUpdatedAt[field] ?? (field in existingSnapshot ? finiteTimestamp(existingSnapshot.updatedAt, 0) : 0);
  const incomingAt = incomingSync.globalUpdatedAt[field] ?? (field in incomingSnapshot ? finiteTimestamp(incomingSnapshot.updatedAt, 0) : 0);
  const useIncoming = incomingAt > existingAt || (incomingAt === existingAt && field in incomingSnapshot);
  return {
    value: useIncoming ? incomingSnapshot[field] : existingSnapshot[field],
    updatedAt: useIncoming ? incomingAt : existingAt,
  };
}

export function mergeJourneySnapshots(existingValue: unknown, incomingValue: unknown, serverUpdatedAt: number) {
  const incoming = record(incomingValue);
  const existing = record(existingValue);
  const incomingSync = normalizeSync(incoming);

  if (!Object.keys(existing).length) {
    return {
      ...incoming,
      updatedAt: serverUpdatedAt,
      sync: {
        ...incomingSync,
        serverRevision: 1,
      },
    };
  }

  const existingSync = normalizeSync(existing);
  const statuses = mergeTimedRecord(existing, incoming, "statuses", "statusUpdatedAt", existingSync, incomingSync);
  const details = mergeTimedRecord(existing, incoming, "details", "detailUpdatedAt", existingSync, incomingSync);
  const customStops = mergeCustomStops(existing, incoming, existingSync, incomingSync);
  const merged: JsonRecord = {
    ...existing,
    ...incoming,
    statuses: statuses.merged,
    details: details.merged,
    customStops: customStops.merged,
    activity: mergeActivity(existing.activity, incoming.activity),
    updatedAt: serverUpdatedAt,
  };
  const globalUpdatedAt: Record<string, number> = {};

  for (const field of GLOBAL_FIELDS) {
    const selected = chooseGlobal(existing, incoming, field, existingSync, incomingSync);
    merged[field] = selected.value;
    globalUpdatedAt[field] = selected.updatedAt;
  }

  merged.sync = {
    deviceId: incomingSync.deviceId,
    serverRevision: Math.max(existingSync.serverRevision, incomingSync.serverRevision) + 1,
    statusUpdatedAt: statuses.times,
    detailUpdatedAt: details.times,
    customStopUpdatedAt: customStops.times,
    globalUpdatedAt,
  } satisfies SyncMetadata;

  return merged;
}
