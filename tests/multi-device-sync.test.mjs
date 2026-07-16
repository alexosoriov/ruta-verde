import assert from "node:assert/strict";
import test from "node:test";

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
    return { results: [] };
  }

  async first() {
    if (this.sql.includes("FROM journey_state WHERE id")) {
      const row = this.database.journeys.get(this.values[0]);
      if (!row) return null;
      if (this.sql.startsWith("SELECT payload,")) {
        return { payload: row.payload, client_updated_at: row.client_updated_at };
      }
      return { payload: row.payload };
    }
    return null;
  }

  async run() {
    if (this.sql.startsWith("INSERT INTO journey_state")) {
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
    this.journeys = new Map();
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("multi-device-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const context = { waitUntil() {}, passThroughOnException() {} };
const environment = (database) => ({
  DB: database,
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
});

function snapshot(deviceId, statuses, statusUpdatedAt, updatedAt) {
  return {
    version: 4,
    journeyId: "santuario-2026-07-16",
    statuses,
    details: {},
    customStops: [],
    reverse: false,
    optimizedIds: [],
    startedAt: 1_000,
    completedAt: null,
    activity: [],
    vehicle: "Camión",
    lastPosition: null,
    gpsMetrics: { actualKm: 0, movingMinutes: 0, stoppedMinutes: 0 },
    updatedAt,
    sync: {
      deviceId,
      serverRevision: 0,
      statusUpdatedAt,
      detailUpdatedAt: {},
      customStopUpdatedAt: {},
      globalUpdatedAt: {
        reverse: updatedAt,
        optimizedIds: updatedAt,
        startedAt: updatedAt,
        completedAt: updatedAt,
        vehicle: updatedAt,
        lastPosition: updatedAt,
        gpsMetrics: updatedAt,
      },
    },
  };
}

async function save(worker, database, value) {
  const response = await worker.fetch(new Request("http://localhost/api/journey-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ journeyId: value.journeyId, snapshot: value }),
  }), environment(database), context);
  assert.equal(response.status, 200);
  return response.json();
}

test("two devices keep changes made to different homes", async () => {
  const worker = await loadWorker();
  const database = new FakeD1();

  const first = await save(worker, database, snapshot("phone-a", { "01": "done" }, { "01": 1_000 }, 1_000));
  assert.equal(first.snapshot.statuses["01"], "done");
  assert.equal(first.revision, 1);

  const second = await save(worker, database, snapshot("phone-b", { "02": "absent" }, { "02": 2_000 }, 2_000));
  assert.equal(second.snapshot.statuses["01"], "done");
  assert.equal(second.snapshot.statuses["02"], "absent");
  assert.equal(second.revision, 2);
});

test("a newer update for the same home wins without deleting other homes", async () => {
  const worker = await loadWorker();
  const database = new FakeD1();

  await save(worker, database, snapshot("phone-a", { "01": "done", "03": "done" }, { "01": 1_000, "03": 1_000 }, 1_000));
  const result = await save(worker, database, snapshot("phone-b", { "01": "absent" }, { "01": 3_000 }, 3_000));

  assert.equal(result.snapshot.statuses["01"], "absent");
  assert.equal(result.snapshot.statuses["03"], "done");
});
