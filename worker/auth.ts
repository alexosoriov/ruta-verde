export type UserRole = "driver" | "manager" | "superadmin";

export type SecurityEnv = {
  ROUTE_USERNAME?: string;
  ROUTE_PASSWORD?: string;
  JEFATURA_USERNAME?: string;
  JEFATURA_PASSWORD?: string;
  SUPERADMIN_USERNAME?: string;
  SUPERADMIN_PASSWORD?: string;
  ROUTE_SESSION_SECRET?: string;
};

type Session = {
  role: UserRole;
  expiresAt: number;
};

type Account = {
  role: UserRole;
  username: string;
  password: string;
};

type AttemptState = {
  failures: number;
  firstAt: number;
  blockedUntil: number;
};

const COOKIE_NAME = "rv_session";
const SESSION_VERSION = "v2";
const SESSION_SECONDS: Record<UserRole, number> = {
  driver: 12 * 60 * 60,
  manager: 8 * 60 * 60,
  superadmin: 2 * 60 * 60,
};
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;
const encoder = new TextEncoder();
const loginAttempts = new Map<string, AttemptState>();

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

function configuredAccounts(env: SecurityEnv): Account[] {
  const candidates: Array<[UserRole, string | undefined, string | undefined]> = [
    ["driver", env.ROUTE_USERNAME, env.ROUTE_PASSWORD],
    ["manager", env.JEFATURA_USERNAME, env.JEFATURA_PASSWORD],
    ["superadmin", env.SUPERADMIN_USERNAME, env.SUPERADMIN_PASSWORD],
  ];
  return candidates.flatMap(([role, username, password]) => username && password ? [{ role, username, password }] : []);
}

export function authConfigured(env: SecurityEnv) {
  return Boolean(env.ROUTE_SESSION_SECRET && configuredAccounts(env).length > 0);
}

async function createSessionToken(secret: string, role: UserRole) {
  const expiresAt = Date.now() + SESSION_SECONDS[role] * 1000;
  const nonce = crypto.randomUUID();
  const payload = `${SESSION_VERSION}.${expiresAt}.${nonce}.${role}`;
  return `${payload}.${base64Url(await hmac(payload, secret))}`;
}

async function validSessionToken(token: string | null, secret: string, configuredRoles: Set<UserRole>): Promise<Session | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [version, expiresAtText, nonce, roleText, signature] = parts;
  if (version !== SESSION_VERSION) return null;
  const expiresAt = Number(expiresAtText);
  const role = roleText as UserRole;
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || nonce.length < 8) return null;
  if (role !== "driver" && role !== "manager" && role !== "superadmin") return null;
  if (!configuredRoles.has(role)) return null;
  const payload = `${version}.${expiresAtText}.${nonce}.${role}`;
  const expected = base64Url(await hmac(payload, secret));
  return await constantTimeEqual(signature, expected) ? { role, expiresAt } : null;
}

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Vary", "Cookie");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function requestIsSameOrigin(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return false;
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

function secureCookieSuffix(request: Request) {
  return new URL(request.url).protocol === "https:" ? "; Secure" : "";
}

async function attemptKey(request: Request, username: string, secret: string) {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const agent = (request.headers.get("User-Agent") ?? "unknown").slice(0, 120);
  const value = `${ip}|${agent}|${username.trim().toLocaleLowerCase("en-US")}`;
  return base64Url(await hmac(value, secret));
}

function activeAttempt(key: string) {
  const now = Date.now();
  const state = loginAttempts.get(key);
  if (!state) return null;
  if (state.blockedUntil > now) return state;
  if (now - state.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
    return null;
  }
  return state;
}

function registerFailure(key: string) {
  const now = Date.now();
  const current = activeAttempt(key);
  const failures = (current?.failures ?? 0) + 1;
  const firstAt = current?.firstAt ?? now;
  const blockedUntil = failures >= MAX_LOGIN_FAILURES ? now + LOGIN_LOCK_MS : 0;
  loginAttempts.set(key, { failures, firstAt, blockedUntil });
  if (loginAttempts.size > 2_000) loginAttempts.clear();
  return blockedUntil;
}

function retryAfterSeconds(state: AttemptState) {
  return Math.max(1, Math.ceil((state.blockedUntil - Date.now()) / 1000));
}

function slowDown() {
  return new Promise((resolve) => setTimeout(resolve, 300));
}

export async function getSession(request: Request, env: SecurityEnv): Promise<Session | null> {
  if (!authConfigured(env)) return null;
  const roles = new Set(configuredAccounts(env).map((account) => account.role));
  return validSessionToken(cookieValue(request, COOKIE_NAME), env.ROUTE_SESSION_SECRET!, roles);
}

export async function isAuthorized(request: Request, env: SecurityEnv) {
  return Boolean(await getSession(request, env));
}

export async function handleSessionRequest(request: Request, env: SecurityEnv) {
  if (!authConfigured(env)) {
    return noStoreJson(
      { error: "La seguridad no está configurada en el servidor." },
      { status: 503 },
    );
  }

  if (request.method === "GET") {
    const session = await getSession(request, env);
    return noStoreJson({ authenticated: Boolean(session), role: session?.role ?? null });
  }

  if (!requestIsSameOrigin(request)) {
    return noStoreJson({ error: "Solicitud de acceso rechazada." }, { status: 403 });
  }

  if (request.method === "DELETE") {
    return noStoreJson(
      { ok: true },
      { headers: { "Set-Cookie": `${COOKIE_NAME}=; HttpOnly${secureCookieSuffix(request)}; SameSite=Strict; Path=/; Max-Age=0; Priority=High` } },
    );
  }

  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!(request.headers.get("Content-Type") ?? "").toLocaleLowerCase("en-US").startsWith("application/json")) {
    return noStoreJson({ error: "Formato de solicitud inválido." }, { status: 415 });
  }

  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json() as { username?: unknown; password?: unknown };
  } catch {
    return noStoreJson({ error: "Credenciales inválidas." }, { status: 400 });
  }

  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password || username.length > 128 || password.length > 512) {
    await slowDown();
    return noStoreJson({ error: "Usuario o contraseña incorrectos." }, { status: 401 });
  }

  const key = await attemptKey(request, username, env.ROUTE_SESSION_SECRET!);
  const blocked = activeAttempt(key);
  if (blocked?.blockedUntil && blocked.blockedUntil > Date.now()) {
    const retryAfter = retryAfterSeconds(blocked);
    await slowDown();
    return noStoreJson(
      { error: "Demasiados intentos. Intenta nuevamente más tarde." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  let matchedRole: UserRole | null = null;
  for (const account of configuredAccounts(env)) {
    const [usernameMatches, passwordMatches] = await Promise.all([
      constantTimeEqual(username, account.username),
      constantTimeEqual(password, account.password),
    ]);
    if (usernameMatches && passwordMatches) matchedRole = account.role;
  }

  if (!matchedRole) {
    const blockedUntil = registerFailure(key);
    await slowDown();
    if (blockedUntil > Date.now()) {
      return noStoreJson(
        { error: "Demasiados intentos. Intenta nuevamente más tarde." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(LOGIN_LOCK_MS / 1000)) } },
      );
    }
    return noStoreJson({ error: "Usuario o contraseña incorrectos." }, { status: 401 });
  }

  loginAttempts.delete(key);
  const token = await createSessionToken(env.ROUTE_SESSION_SECRET!, matchedRole);
  return noStoreJson(
    { ok: true, role: matchedRole },
    {
      headers: {
        "Set-Cookie": `${COOKIE_NAME}=${token}; HttpOnly${secureCookieSuffix(request)}; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS[matchedRole]}; Priority=High`,
      },
    },
  );
}

function roleCanAccess(request: Request, role: UserRole) {
  if (role === "superadmin") return true;
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/private-route") return true;
  if (pathname === "/api/tracking") {
    if (request.method === "GET" || request.method === "HEAD") return role === "manager";
    return request.method === "POST" && role === "driver";
  }
  if (pathname === "/api/road-route") return role === "driver" || role === "manager";
  if (pathname === "/api/journey-state") return role === "driver";
  return true;
}

export async function requireSession(request: Request, env: SecurityEnv) {
  if (!authConfigured(env)) {
    return noStoreJson({ error: "La seguridad no está configurada en el servidor." }, { status: 503 });
  }
  const session = await getSession(request, env);
  if (!session) {
    return noStoreJson({ error: "Debes iniciar sesión." }, { status: 401 });
  }
  if (!roleCanAccess(request, session.role)) {
    return noStoreJson({ error: "Tu cuenta no tiene permiso para esta función." }, { status: 403 });
  }
  return null;
}
