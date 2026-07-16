/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
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
  lat: number;
  lng: number;
  speed?: number | null;
  heading?: number | null;
  accuracy?: number | null;
  nextStop?: string | null;
  completed?: number;
  total?: number;
  status?: "active" | "paused" | "finished";
};

async function ensureTrackingTable(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS live_tracking (
      id TEXT PRIMARY KEY, lat REAL NOT NULL, lng REAL NOT NULL,
      speed REAL, heading REAL, accuracy REAL, next_stop TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 41,
      status TEXT NOT NULL DEFAULT 'active', updated_at INTEGER NOT NULL
    )
  `).run();
}

async function handleTracking(request: Request, db: D1Database) {
  await ensureTrackingTable(db);
  if (request.method === "GET") {
    const row = await db.prepare("SELECT * FROM live_tracking WHERE id = ?")
      .bind("santuario-viernes").first();
    return Response.json({ tracking: row ?? null }, { headers: { "Cache-Control": "no-store" } });
  }
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const body = await request.json() as TrackingPayload;
  if (!Number.isFinite(body.lat) || !Number.isFinite(body.lng)) {
    return Response.json({ error: "Ubicación inválida" }, { status: 400 });
  }
  const updatedAt = Date.now();
  await db.prepare(`
    INSERT INTO live_tracking (id, lat, lng, speed, heading, accuracy, next_stop, completed, total, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET lat=excluded.lat, lng=excluded.lng,
      speed=excluded.speed, heading=excluded.heading, accuracy=excluded.accuracy,
      next_stop=excluded.next_stop, completed=excluded.completed, total=excluded.total,
      status=excluded.status, updated_at=excluded.updated_at
  `).bind("santuario-viernes", body.lat, body.lng, body.speed ?? null,
    body.heading ?? null, body.accuracy ?? null, body.nextStop ?? null,
    body.completed ?? 0, body.total ?? 41, body.status ?? "active", updatedAt).run();
  return Response.json({ ok: true, updatedAt });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    if (url.pathname === "/api/tracking") {
      return handleTracking(request, env.DB);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
