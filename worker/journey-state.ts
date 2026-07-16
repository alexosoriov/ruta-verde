import { mergeJourneySnapshots } from "./journey-merge";

type JourneyPayload = {
  journeyId?: string;
  snapshot?: unknown;
};

const JOURNEY_ID_PATTERN = /^[a-z0-9-]{1,64}$/;
const MAX_JOURNEY_BYTES = 240_000;

function currentJourneyId() {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return `santuario-${date}`;
}

function normalizeJourneyId(value: unknown) {
  return typeof value === "string" && JOURNEY_ID_PATTERN.test(value) ? value : currentJourneyId();
}

function clientTimestamp(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : Date.now();
}

async function ensureTable(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS journey_state (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      client_updated_at INTEGER NOT NULL,
      server_updated_at INTEGER NOT NULL
    )
  `).run();
}

function parsePayload(value: string | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export async function handleJourneyState(request: Request, db: D1Database) {
  await ensureTable(db);
  const url = new URL(request.url);

  if (request.method === "GET") {
    const journeyId = normalizeJourneyId(url.searchParams.get("journey"));
    const row = await db.prepare("SELECT payload FROM journey_state WHERE id = ?")
      .bind(journeyId)
      .first<{ payload?: string }>();
    return Response.json({ snapshot: parsePayload(row?.payload) }, { headers: { "Cache-Control": "no-store" } });
  }

  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: JourneyPayload;
  try {
    body = await request.json() as JourneyPayload;
  } catch {
    return Response.json({ error: "Jornada inválida" }, { status: 400 });
  }

  if (!body.snapshot || typeof body.snapshot !== "object") {
    return Response.json({ error: "Falta el estado de la jornada" }, { status: 400 });
  }

  const source = body.snapshot as Record<string, unknown>;
  const journeyId = normalizeJourneyId(body.journeyId ?? source.journeyId);
  const incomingUpdatedAt = clientTimestamp(source.updatedAt);
  const existing = await db.prepare("SELECT payload, client_updated_at FROM journey_state WHERE id = ?")
    .bind(journeyId)
    .first<{ payload?: string; client_updated_at?: number }>();
  const serverUpdatedAt = Date.now();
  const merged = mergeJourneySnapshots(parsePayload(existing?.payload), {
    ...source,
    journeyId,
    updatedAt: incomingUpdatedAt,
  }, serverUpdatedAt);
  const payload = JSON.stringify(merged);

  if (new TextEncoder().encode(payload).byteLength > MAX_JOURNEY_BYTES) {
    return Response.json({ error: "La jornada es demasiado grande" }, { status: 413 });
  }

  const latestClientUpdate = Math.max(existing?.client_updated_at ?? 0, incomingUpdatedAt);
  await db.prepare(`
    INSERT INTO journey_state (id, payload, client_updated_at, server_updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      payload=excluded.payload,
      client_updated_at=excluded.client_updated_at,
      server_updated_at=excluded.server_updated_at
  `).bind(journeyId, payload, latestClientUpdate, serverUpdatedAt).run();

  const revision = typeof (merged as { sync?: { serverRevision?: unknown } }).sync?.serverRevision === "number"
    ? (merged as { sync: { serverRevision: number } }).sync.serverRevision
    : 0;

  return Response.json({
    ok: true,
    journeyId,
    updatedAt: serverUpdatedAt,
    revision,
    snapshot: merged,
  }, { headers: { "Cache-Control": "no-store" } });
}
