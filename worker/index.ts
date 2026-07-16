/** Cloudflare Worker entry point for Ruta Verde. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  ROUTE_USERNAME?: string;
  ROUTE_PASSWORD?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type TrackingPayload = {
  journeyId?: string;
  lat: number;
  lng: number;
  speed?: number | null;
  heading?: number | null;
  accuracy?: number | null;
  nextStop?: string | null;
  completed?: number;
  done?: number;
  absent?: number;
  pending?: number;
  total?: number;
  kilos?: number;
  routeKm?: number;
  estimatedMinutes?: number;
  startedAt?: number | null;
  status?: "active" | "paused" | "finished";
};

type ColumnDefinition = { name: string; sql: string };

const TRACKING_COLUMNS: ColumnDefinition[] = [
  { name: "done", sql: "INTEGER NOT NULL DEFAULT 0" },
  { name: "absent", sql: "INTEGER NOT NULL DEFAULT 0" },
  { name: "pending", sql: "INTEGER NOT NULL DEFAULT 41" },
  { name: "kilos", sql: "REAL NOT NULL DEFAULT 0" },
  { name: "route_km", sql: "REAL" },
  { name: "estimated_minutes", sql: "INTEGER" },
  { name: "started_at", sql: "INTEGER" },
];

const TRACKING_STALE_AFTER_MS = 60_000;
const JOURNEY_ID_PATTERN = /^[a-z0-9-]{1,64}$/;

function isLocalRequest(url: URL) {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname.endsWith(".local");
}

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

function constantTimeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function isAuthorized(request: Request, env: Env) {
  if (!env.ROUTE_USERNAME || !env.ROUTE_PASSWORD) return false;
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Basic ")) return false;

  try {
    const decoded = atob(authorization.slice(6));
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;
    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    return constantTimeEqual(username, env.ROUTE_USERNAME) && constantTimeEqual(password, env.ROUTE_PASSWORD);
  } catch {
    return false;
  }
}

function unauthorizedResponse() {
  return new Response("Acceso privado a Ruta Verde", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Ruta Verde", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

function missingSecurityConfigurationResponse() {
  return new Response("Ruta Verde está bloqueada hasta configurar ROUTE_USERNAME y ROUTE_PASSWORD.", {
    status: 503,
    headers: { "Cache-Control": "no-store" },
  });
}

function withSecurityHeaders(response: Response, url: URL) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "geolocation=(self), camera=(), microphone=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (url.protocol === "https:") headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (url.pathname.startsWith("/api/") || url.pathname === "/") headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function ensureTrackingTable(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS live_tracking (
      id TEXT PRIMARY KEY,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      speed REAL,
      heading REAL,
      accuracy REAL,
      next_stop TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      done INTEGER NOT NULL DEFAULT 0,
      absent INTEGER NOT NULL DEFAULT 0,
      pending INTEGER NOT NULL DEFAULT 41,
      total INTEGER NOT NULL DEFAULT 41,
      kilos REAL NOT NULL DEFAULT 0,
      route_km REAL,
      estimated_minutes INTEGER,
      started_at INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      updated_at INTEGER NOT NULL
    )
  `).run();

  const tableInfo = await db.prepare("PRAGMA table_info(live_tracking)").all();
  const existingColumns = new Set(
    ((tableInfo.results ?? []) as Array<{ name?: string }>).map((column) => column.name).filter((name): name is string => Boolean(name)),
  );

  for (const column of TRACKING_COLUMNS) {
    if (!existingColumns.has(column.name)) {
      await db.prepare(`ALTER TABLE live_tracking ADD COLUMN ${column.name} ${column.sql}`).run();
    }
  }
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number) {
  const number = finiteNumber(value, fallback);
  return Math.max(0, Math.round(number));
}

async function handleTracking(request: Request, db: D1Database) {
  await ensureTrackingTable(db);
  const url = new URL(request.url);

  if (request.method === "GET") {
    const journeyId = normalizeJourneyId(url.searchParams.get("journey"));
    const row = await db.prepare("SELECT * FROM live_tracking WHERE id = ?").bind(journeyId).first<Record<string, unknown>>();
    if (!row) return Response.json({ tracking: null }, { headers: { "Cache-Control": "no-store" } });

    const updatedAt = finiteNumber(row.updated_at, 0);
    if (Date.now() - updatedAt > TRACKING_STALE_AFTER_MS && row.status !== "finished") {
      return Response.json(
        { tracking: null, stale: true, lastUpdatedAt: updatedAt },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return Response.json({ tracking: row }, { headers: { "Cache-Control": "no-store" } });
  }

  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const body = await request.json() as TrackingPayload;
  if (!Number.isFinite(body.lat) || !Number.isFinite(body.lng) || Math.abs(body.lat) > 90 || Math.abs(body.lng) > 180) {
    return Response.json({ error: "Ubicación inválida" }, { status: 400 });
  }

  const journeyId = normalizeJourneyId(body.journeyId);
  const total = nonNegativeInteger(body.total, 41);
  const done = Math.min(total, nonNegativeInteger(body.done, body.completed ?? 0));
  const absent = Math.min(total - done, nonNegativeInteger(body.absent, 0));
  const completed = Math.min(total, nonNegativeInteger(body.completed, done + absent));
  const pending = Math.min(total, nonNegativeInteger(body.pending, Math.max(0, total - done - absent)));
  const status = body.status === "finished" || body.status === "paused" ? body.status : "active";
  const updatedAt = Date.now();

  await db.prepare(`
    INSERT INTO live_tracking (
      id, lat, lng, speed, heading, accuracy, next_stop,
      completed, done, absent, pending, total, kilos,
      route_km, estimated_minutes, started_at, status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      lat=excluded.lat,
      lng=excluded.lng,
      speed=excluded.speed,
      heading=excluded.heading,
      accuracy=excluded.accuracy,
      next_stop=excluded.next_stop,
      completed=excluded.completed,
      done=excluded.done,
      absent=excluded.absent,
      pending=excluded.pending,
      total=excluded.total,
      kilos=excluded.kilos,
      route_km=excluded.route_km,
      estimated_minutes=excluded.estimated_minutes,
      started_at=excluded.started_at,
      status=excluded.status,
      updated_at=excluded.updated_at
  `).bind(
    journeyId,
    body.lat,
    body.lng,
    body.speed ?? null,
    body.heading ?? null,
    body.accuracy ?? null,
    typeof body.nextStop === "string" ? body.nextStop.slice(0, 140) : null,
    completed,
    done,
    absent,
    pending,
    total,
    Math.max(0, finiteNumber(body.kilos, 0)),
    Math.max(0, finiteNumber(body.routeKm, 0)),
    nonNegativeInteger(body.estimatedMinutes, 0),
    body.startedAt === null ? null : finiteNumber(body.startedAt, 0) || null,
    status,
    updatedAt,
  ).run();

  return Response.json({ ok: true, journeyId, updatedAt }, { headers: { "Cache-Control": "no-store" } });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const localRequest = isLocalRequest(url);

    if (!localRequest && (!env.ROUTE_USERNAME || !env.ROUTE_PASSWORD)) {
      return withSecurityHeaders(missingSecurityConfigurationResponse(), url);
    }
    if (!localRequest && !isAuthorized(request, env)) {
      return withSecurityHeaders(unauthorizedResponse(), url);
    }

    let response: Response;
    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      response = await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    } else if (url.pathname === "/api/tracking") {
      response = env.DB
        ? await handleTracking(request, env.DB)
        : Response.json({ error: "Base de datos no configurada" }, { status: 503 });
    } else {
      response = await handler.fetch(request, env, ctx);
    }

    return withSecurityHeaders(response, url);
  },
};

export default worker;
