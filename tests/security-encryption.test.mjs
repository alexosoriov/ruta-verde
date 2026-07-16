import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("el código público no contiene registros personales del recorrido", async () => {
  const routeData = await read("app/route-data.ts");
  assert.doesNotMatch(routeData, /Cinthya|Aucaman Sur|Los Pimientos 4806|Lepihue 5084/u);
  assert.match(routeData, /Los registros reales se cargan después de autenticar/u);
});

test("el bloque privado exige AES-256-GCM autenticado", async () => {
  const encrypted = await read("worker/private-route-data.ts");
  assert.match(encrypted, /AES-GCM/u);
  assert.match(encrypted, /rawKey\.byteLength !== 32/u);
  assert.match(encrypted, /tagLength: 128/u);
  assert.match(encrypted, /additionalData/u);
  assert.doesNotMatch(encrypted, /Cinthya|Aucaman Sur|Los Pimientos 4806|Lepihue 5084/u);
});

test("las APIs con ubicaciones y actividad requieren sesión", async () => {
  const worker = await read("worker/index.ts");
  assert.match(worker, /\/api\/private-route/u);
  assert.match(worker, /\/api\/tracking/u);
  assert.match(worker, /\/api\/journey-state/u);
  assert.match(worker, /\/api\/road-route/u);
  assert.match(worker, /requireSession/u);
  assert.match(worker, /ROUTE_DATA_KEY/u);
});

test("el navegador no guarda respuestas privadas en el caché offline", async () => {
  const serviceWorker = await read("public/sw.js");
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api\/"\)/u);
  assert.match(serviceWorker, /event\.respondWith\(fetch\(request\)\)/u);
});

test("la aplicación carga los datos solo después de iniciar sesión", async () => {
  const page = await read("app/page.tsx");
  assert.match(page, /\/api\/session/u);
  assert.match(page, /\/api\/private-route/u);
  assert.match(page, /installRouteData/u);
  assert.match(page, /type="password"/u);
});
