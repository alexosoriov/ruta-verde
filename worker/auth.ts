export type SecurityEnv = {
  ROUTE_USERNAME?: string;
  ROUTE_PASSWORD?: string;
  ROUTE_SESSION_SECRET?: string;
  DB?: D1Database;
};

const HTTPS_COOKIE_NAME = "__Host-rv_session";
const HTTP_COOKIE_NAME = "rv_session_dev";
const SESSION_SECONDS = 4 * 60 * 60;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_BLOCK_MS = 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();

function cookieName(request: Request) {
  return new URL(request.url).protocol === "https:" ? HTTPS_COOKIE_NAME : HTTP_COOKIE_NAME;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function cookieValue(request: Request, name: string) {
  const header = request.headers.get("Cookie") ?? "";
  for (const item of header.split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return parts.join("=");
  }
  return null;
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

async function constantTimeEqual(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function authConfigured(env: SecurityEnv) {
  return Boolean(env.ROUTE_USERNAME && env.ROUTE_PASSWORD && env.ROUTE_SESSION_SECRET && env.DB);
}

async function createSessionToken(secret: string) {
  const expiresAt = Date.now() + SESSION_SECONDS * 1000;
  const nonce = crypto.randomUUID();
  const payload = `${expiresAt}.${nonce}`;
  return `${payload}.${base64Url(await hmac(payload, secret))}`;
}

async function validSessionToken(token: string | null, secret: string) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expiresAtText, nonce, signature] = parts;
  const expiresAt = Number(expiresAtText);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || nonce.length < 8) return false;
  const payload = `${expiresAtText}.${nonce}`;
  return constantTimeEqual(signature, base64Url(await hmac(payload, secret)));
}

export async function isAuthorized(request: Request, env: SecurityEnv) {
  if (!authConfigured(env)) return false;
  return validSessionToken(cookieValue(request, cookieName(request)), env.ROUTE_SESSION_SECRET!);
}

async function ensureRateLimitTable(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auth_rate_limit (
      id TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      window_started INTEGER NOT NULL,
      blocked_until INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();
}

async function rateLimitKey(scope: string, value: string, secret: string) {
  return base64Url(await hmac(`${scope}|${value}`, secret));
}

function requestIp(request: Request) {
  return request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown";
}

async function rateLimitIds(request: Request, username: string, secret: string) {
  const normalized = username.trim().toLocaleLowerCase("es-CL");
  return Promise.all([
    rateLimitKey("ip-user", `${requestIp(request)}|${normalized}`, secret),
    rateLimitKey("user", normalized || "empty", secret),
  ]);
}

async function blockedFor(db: D1Database, ids: string[]) {
  const now = Date.now();
  let retryAfterMs = 0;
  for (const id of ids) {
    const row = await db.prepare("SELECT blocked_until FROM auth_rate_limit WHERE id = ?")
      .bind(id)
      .first<{ blocked_until?: number }>();
    retryAfterMs = Math.max(retryAfterMs, Math.max(0, (row?.blocked_until ?? 0) - now));
  }
  return retryAfterMs;
}

async function recordFailure(db: D1Database, ids: string[]) {
  const now = Date.now();
  let longestBlock = 0;
  for (const id of ids) {
    const row = await db.prepare("SELECT attempts, window_started FROM auth_rate_limit WHERE id = ?")
      .bind(id)
      .first<{ attempts?: number; window_started?: number }>();
    const inWindow = row?.window_started && now - row.window_started <= ATTEMPT_WINDOW_MS;
    const attempts = inWindow ? (row?.attempts ?? 0) + 1 : 1;
    const windowStarted = inWindow ? row!.window_started! : now;
    const blockDuration = attempts >= MAX_ATTEMPTS
      ? Math.min(MAX_BLOCK_MS, ATTEMPT_WINDOW_MS * (2 ** Math.min(6, attempts - MAX_ATTEMPTS)))
      : 0;
    const blockedUntil = blockDuration ? now + blockDuration : 0;
    longestBlock = Math.max(longestBlock, blockDuration);
    await db.prepare(`
      INSERT INTO auth_rate_limit (id, attempts, window_started, blocked_until, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        attempts=excluded.attempts,
        window_started=excluded.window_started,
        blocked_until=excluded.blocked_until,
        updated_at=excluded.updated_at
    `).bind(id, attempts, windowStarted, blockedUntil, now).run();
  }
  return longestBlock;
}

async function clearFailures(db: D1Database, ids: string[]) {
  for (const id of ids) await db.prepare("DELETE FROM auth_rate_limit WHERE id = ?").bind(id).run();
}

function sessionCookie(request: Request, token: string, maxAge: number) {
  const secure = new URL(request.url).protocol === "https:";
  const name = cookieName(request);
  return `${name}=${token}; HttpOnly${secure ? "; Secure" : ""}; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

export async function handleSessionRequest(request: Request, env: SecurityEnv) {
  if (!authConfigured(env)) {
    return noStoreJson(
      { error: "La seguridad o la base de datos no están configuradas en el servidor." },
      { status: 503 },
    );
  }

  if (request.method === "GET") {
    return noStoreJson({ authenticated: await isAuthorized(request, env) });
  }

  if (request.method === "DELETE") {
    return noStoreJson(
      { ok: true },
      { headers: { "Set-Cookie": sessionCookie(request, "", 0) } },
    );
  }

  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json() as { username?: unknown; password?: unknown };
  } catch {
    return noStoreJson({ error: "Credenciales inválidas." }, { status: 400 });
  }

  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  await ensureRateLimitTable(env.DB!);
  const rateIds = await rateLimitIds(request, username, env.ROUTE_SESSION_SECRET!);
  const retryAfterMs = await blockedFor(env.DB!, rateIds);
  if (retryAfterMs > 0) {
    const retryAfter = Math.max(1, Math.ceil(retryAfterMs / 1000));
    return noStoreJson(
      { error: "Demasiados intentos. Acceso bloqueado temporalmente.", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const valid = (await constantTimeEqual(username, env.ROUTE_USERNAME!)) &&
    (await constantTimeEqual(password, env.ROUTE_PASSWORD!));

  if (!valid) {
    const blockMs = await recordFailure(env.DB!, rateIds);
    await new Promise((resolve) => setTimeout(resolve, 350));
    const retryAfter = blockMs > 0 ? Math.ceil(blockMs / 1000) : undefined;
    return noStoreJson(
      { error: retryAfter ? "Demasiados intentos. Acceso bloqueado temporalmente." : "Usuario o contraseña incorrectos.", retryAfter },
      retryAfter
        ? { status: 429, headers: { "Retry-After": String(retryAfter) } }
        : { status: 401 },
    );
  }

  await clearFailures(env.DB!, rateIds);
  const token = await createSessionToken(env.ROUTE_SESSION_SECRET!);
  return noStoreJson(
    { ok: true },
    { headers: { "Set-Cookie": sessionCookie(request, token, SESSION_SECONDS) } },
  );
}

export async function requireSession(request: Request, env: SecurityEnv) {
  if (!authConfigured(env)) {
    return noStoreJson({ error: "La seguridad o la base de datos no están configuradas en el servidor." }, { status: 503 });
  }
  if (!(await isAuthorized(request, env))) {
    return noStoreJson({ error: "Debes iniciar sesión." }, { status: 401 });
  }
  return null;
}
