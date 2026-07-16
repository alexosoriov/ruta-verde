export type SecurityEnv = {
  ROUTE_USERNAME?: string;
  ROUTE_PASSWORD?: string;
  SESSION_SECRET?: string;
};

const COOKIE_NAME = "rv_session";
const SESSION_SECONDS = 8 * 60 * 60;
const encoder = new TextEncoder();

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

export function authConfigured(env: SecurityEnv) {
  return Boolean(env.ROUTE_USERNAME && env.ROUTE_PASSWORD && env.SESSION_SECRET);
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
  return validSessionToken(cookieValue(request, COOKIE_NAME), env.SESSION_SECRET!);
}

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export async function handleSessionRequest(request: Request, env: SecurityEnv) {
  if (!authConfigured(env)) {
    return noStoreJson(
      { error: "La seguridad no está configurada en el servidor." },
      { status: 503 },
    );
  }

  if (request.method === "GET") {
    return noStoreJson({ authenticated: await isAuthorized(request, env) });
  }

  if (request.method === "DELETE") {
    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    return noStoreJson(
      { ok: true },
      { headers: { "Set-Cookie": `${COOKIE_NAME}=; HttpOnly${secure}; SameSite=Strict; Path=/; Max-Age=0` } },
    );
  }

  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json() as { username?: unknown; password?: unknown };
  } catch {
    return noStoreJson({ error: "Credenciales inválidas." }, { status: 400 });
  }

  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";
  const valid = (await constantTimeEqual(username, env.ROUTE_USERNAME!)) &&
    (await constantTimeEqual(password, env.ROUTE_PASSWORD!));

  if (!valid) {
    return noStoreJson({ error: "Usuario o contraseña incorrectos." }, { status: 401 });
  }

  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const token = await createSessionToken(env.SESSION_SECRET!);
  return noStoreJson(
    { ok: true },
    {
      headers: {
        "Set-Cookie": `${COOKIE_NAME}=${token}; HttpOnly${secure}; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`,
      },
    },
  );
}

export async function requireSession(request: Request, env: SecurityEnv) {
  if (!authConfigured(env)) {
    return noStoreJson({ error: "La seguridad no está configurada en el servidor." }, { status: 503 });
  }
  if (!(await isAuthorized(request, env))) {
    return noStoreJson({ error: "Debes iniciar sesión." }, { status: 401 });
  }
  return null;
}
