import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const TRACKING_COLUMNS = [
  "id", "lat", "lng", "speed", "heading", "accuracy", "next_stop",
  "completed", "done", "absent", "pending", "total", "kilos",
  "route_km", "estimated_minutes", "started_at", "actual_km",
  "moving_minutes", "stopped_minutes", "baseline_route_km",
  "route_savings_km", "planned_drive_minutes", "activity_json",
  "status", "updated_at",
];

class FakeStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql.replace(/\s+/g, " ").trim();
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async all() {
    if (this.sql.startsWith("PRAGMA table_info(live_tracking)")) {
      return { results: TRACKING_COLUMNS.map((name) => ({ name })) };
    }
    return { results: [] };
  }

  async first() {
    if (this.sql.includes("SELECT * FROM live_tracking WHERE id")) {
      return this.database.tracking.get(this.values[0]) ?? null;
    }
    if (this.sql.includes("SELECT payload FROM journey_state WHERE id")) {
      const row = this.database.journeys.get(this.values[0]);
      return row ? { payload: row.payload } : null;
    }
    if (this.sql.includes("SELECT client_updated_at FROM journey_state WHERE id")) {
      const row = this.database.journeys.get(this.values[0]);
      return row ? { client_updated_at: row.client_updated_at } : null;
    }
    return null;
  }

  async run() {
    if (this.sql.startsWith("INSERT INTO live_tracking")) {
      this.database.tracking.set(this.values[0], Object.fromEntries(TRACKING_COLUMNS.map((column, index) => [column, this.values[index]])));
    } else if (this.sql.startsWith("INSERT INTO journey_state")) {
      this.database.journeys.set(this.values[0], {
        payload: this.values[1],
        client_updated_at: this.values[2],
        server_updated_at: this.values[3],
      });
    }
    return { success: true };
  }
}

class FakeD1 {
  constructor() {
    this.tracking = new Map();
    this.journeys = new Map();
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("operational-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

function environment(database) {
  return {
    DB: database,
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    ROUTE_USERNAME: "driver-user",
    ROUTE_PASSWORD: "driver-password",
    JEFATURA_USERNAME: "manager-user",
    JEFATURA_PASSWORD: "manager-password",
    ROUTE_SESSION_SECRET: "test-session-secret-with-enough-entropy",
  };
}

const context = { waitUntil() {}, passThroughOnException() {} };

async function loginCookie(worker, env, role = "driver") {
  const credentials = role === "manager"
    ? { username: env.JEFATURA_USERNAME, password: env.JEFATURA_PASSWORD }
    : { username: env.ROUTE_USERNAME, password: env.ROUTE_PASSWORD };
  const response = await worker.fetch(new Request("http://localhost/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  }), env, context);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.role, role);
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie);
  return setCookie.split(";", 1)[0];
}

function authorizedRequest(url, cookie, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", cookie);
  return new Request(url, { ...init, headers });
}

test("tracking synchronizes remote activity and real GPS metrics", async () => {
  const worker = await loadWorker();
  const database = new FakeD1();
  const env = environment(database);
  const driverCookie = await loginCookie(worker, env, "driver");
  const managerCookie = await loginCookie(worker, env, "manager");
  const activity = [{
    id: "03-1000",
    stopId: "03",
    label: "Parada 03",
    status: "done",
    at: 1_000,
    kilos: 8.5,
  }];

  const post = await worker.fetch(authorizedRequest("http://localhost/api/tracking", driverCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      journeyId: "santuario-2026-07-16",
      lat: -33.45,
      lng: -70.66,
      speed: 2.2,
      heading: 91,
      accuracy: 8,
      nextStop: "Parada 04",
      completed: 2,
      done: 1,
      absent: 1,
      pending: 39,
      total: 41,
      kilos: 8.5,
      routeKm: 4.2,
      baselineRouteKm: 4.8,
      routeSavingsKm: 0.6,
      plannedDriveMinutes: 16,
      actualKm: 1.35,
      movingMinutes: 7.4,
      stoppedMinutes: 5.1,
      estimatedMinutes: 88,
      startedAt: 900,
      activity,
      status: "active",
    }),
  }), env, context);

  assert.equal(post.status, 200);

  const get = await worker.fetch(
    authorizedRequest("http://localhost/api/tracking?journey=santuario-2026-07-16", managerCookie),
    env,
    context,
  );
  assert.equal(get.status, 200);
  const data = await get.json();
  assert.equal(data.tracking.done, 1);
  assert.equal(data.tracking.absent, 1);
  assert.equal(data.tracking.pending, 39);
  assert.equal(data.tracking.actual_km, 1.35);
  assert.equal(data.tracking.moving_minutes, 7.4);
  assert.equal(data.tracking.stopped_minutes, 5.1);
  assert.equal(data.tracking.route_savings_km, 0.6);
  assert.deepEqual(JSON.parse(data.tracking.activity_json), activity);
});

test("tracking rejects impossible coordinates", async () => {
  const worker = await loadWorker();
  const env = environment(new FakeD1());
  const driverCookie = await loginCookie(worker, env, "driver");
  const response = await worker.fetch(authorizedRequest("http://localhost/api/tracking", driverCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat: 120, lng: -70 }),
  }), env, context);
  assert.equal(response.status, 400);
});

test("journey state survives a remote save and load", async () => {
  const worker = await loadWorker();
  const database = new FakeD1();
  const env = environment(database);
  const driverCookie = await loginCookie(worker, env, "driver");
  const snapshot = {
    version: 4,
    journeyId: "santuario-2026-07-16",
    statuses: { "01": "done" },
    details: { "01": { kilos: "4,5", material: "Orgánico", note: "Retiro de prueba" } },
    customStops: [],
    reverse: false,
    optimizedIds: [],
    startedAt: 1_000,
    completedAt: null,
    activity: [],
    vehicle: "Camión",
    lastPosition: null,
    gpsMetrics: { actualKm: 0.8, movingMinutes: 4, stoppedMinutes: 2 },
    updatedAt: 2_000,
  };

  const post = await worker.fetch(authorizedRequest("http://localhost/api/journey-state", driverCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ journeyId: snapshot.journeyId, snapshot }),
  }), env, context);
  assert.equal(post.status, 200);

  const get = await worker.fetch(
    authorizedRequest(`http://localhost/api/journey-state?journey=${snapshot.journeyId}`, driverCookie),
    env,
    context,
  );
  assert.equal(get.status, 200);
  const data = await get.json();
  assert.deepEqual(data.snapshot.gpsMetrics, snapshot.gpsMetrics);
  assert.equal(data.snapshot.statuses["01"], "done");
});

test("protected APIs reject requests without a valid session", async () => {
  const worker = await loadWorker();
  const env = environment(new FakeD1());
  const response = await worker.fetch(
    new Request("http://localhost/api/tracking?journey=santuario-2026-07-16"),
    env,
    context,
  );
  assert.equal(response.status, 401);
});

test("driver source connects the main action, map picker and manager metrics", async () => {
  const source = await readFile(new URL("../app/route-app.tsx", import.meta.url), "utf8");
  assert.match(source, /Comenzar recorrido y GPS/);
  assert.match(source, /setGpsStartSignal/);
  assert.match(source, /pickLocationMode/);
  assert.match(source, /Seleccionar punto en el mapa/);
  assert.match(source, /routeSavingsKm/);
  assert.match(source, /movingMinutes/);
  assert.match(source, /stoppedMinutes/);
});
