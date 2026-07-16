import { decryptJson, encryptJson, isEncryptedEnvelope } from "./data-crypto";

type JourneyPayload = {
  journeyId?: string;
  snapshot?: unknown;
};

const JOURNEY_ID_PATTERN = /^[a-z0-9-]{1,64}$/;
const MAX_JOURNEY_BYTES = 240_000;
const PURPOSE = "journey-state";

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

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
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

async function decryptStoredPayload(payload: string, journeyId: string, keyBase64: string) {
  const parsed = JSON.parse(payload) as unknown;
  if (isEncryptedEnvelope(parsed)) {
    return decryptJson<Record<string, unknown>>(parsed, keyBase64, PURPOSE, journeyId);
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Jornada almacenada inválida");
  return parsed as Record<string, unknown>;
}

async function storeEncryptedSnapshot(
  db: D1Database,
  journeyId: string,
  snapshot: Record<string, unknown>,
  keyBase64: string,
  clientUpdatedAt: number,
  serverUpdatedAt: number,
) {
  const encrypted = await encryptJson(snapshot, keyBase64, PURPOSE, journeyId);
  await db.prepare(`
    INSERT INTO journey_state (id, payload, client_updated_at, server_updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      payload=excluded.payload,
      client_updated_at=excluded.client_updated_at,
      server_updated_at=excluded.server_updated_at
  `).bind(journeyId, JSON.stringify(encrypted), clientUpdatedAt, serverUpdatedAt).run();
}

export async function handleJourneyState(request: Request, db: D1Database, keyBase64: string) {
  await ensureTable(db);
  const url = new URL(request.url);

  if (request.method === "GET") {
    const journeyId = normalizeJourneyId(url.searchParams.get("journey"));
    const row = await db.prepare("SELECT payload, client_updated_at, server_updated_at FROM journey_state WHERE id = ?")
      .bind(journeyId)
      .first<{ payload?: string; client_updated_at?: number; server_updated_at?: number }>();
    if (!row?.payload) return noStoreJson({ snapshot: null });
    try {
      const snapshot = await decryptStoredPayload(row.payload, journeyId, keyBase64);
      const parsedStored = JSON.parse(row.payload) as unknown;
      if (!isEncryptedEnvelope(parsedStored)) {
        await storeEncryptedSnapshot(
          db,
          journeyId,
          snapshot,
          keyBase64,
          row.client_updated_at ?? clientTimestamp(snapshot.updatedAt),
          Date.now(),
        );
      }
      return noStoreJson({ snapshot });
    } catch (error) {
      console.error("No fue posible descifrar la jornada", error);
      return noStoreJson({ error: "No fue posible descifrar la jornada guardada." }, { status: 500 });
    }
  }

  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: JourneyPayload;
  try {
    body = await request.json() as JourneyPayload;
  } catch {
    return noStoreJson({ error: "Jornada inválida" }, { status: 400 });
  }

  if (!body.snapshot || typeof body.snapshot !== "object") {
    return noStoreJson({ error: "Falta el estado de la jornada" }, { status: 400 });
  }

  const source = body.snapshot as Record<string, unknown>;
  const journeyId = normalizeJourneyId(body.journeyId ?? source.journeyId);
  const updatedAt = clientTimestamp(source.updatedAt);
  const snapshot = { ...source, journeyId, updatedAt };
  const plaintext = JSON.stringify(snapshot);
  if (new TextEncoder().encode(plaintext).byteLength > MAX_JOURNEY_BYTES) {
    return noStoreJson({ error: "La jornada es demasiado grande" }, { status: 413 });
  }

  const existing = await db.prepare("SELECT client_updated_at FROM journey_state WHERE id = ?")
    .bind(journeyId)
    .first<{ client_updated_at?: number }>();
  if ((existing?.client_updated_at ?? 0) > updatedAt) {
    return noStoreJson({ ok: true, journeyId, ignored: true });
  }

  const serverUpdatedAt = Date.now();
  await storeEncryptedSnapshot(db, journeyId, snapshot, keyBase64, updatedAt, serverUpdatedAt);
  return noStoreJson({ ok: true, journeyId, updatedAt: serverUpdatedAt });
}
