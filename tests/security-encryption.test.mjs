import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("el código público deja vacío el conjunto de paradas hasta autenticar", async () => {
  const routeData = await read("app/route-data.ts");
  assert.match(routeData, /export let STOPS: Stop\[\] = \[\]/u);
  assert.match(routeData, /Los registros reales se cargan después de autenticar/u);
  assert.doesNotMatch(routeData, /name:\s*["'][^"']+["']\s*,\s*address:/u);
});

test("el bloque privado vive separado y exige AES-256-GCM autenticado", async () => {
  const bridge = await read("worker/private-route-data.ts");
  const encrypted = await read("worker/vault/sector-map.ts");

  assert.match(bridge, /\.\/vault\/sector-map/u);
  assert.doesNotMatch(bridge, /PRIVATE_ROUTE_CIPHERTEXT_B64/u);

  assert.match(encrypted, /AES-GCM/u);
  assert.match(encrypted, /rawKey\.byteLength !== 32/u);
  assert.match(encrypted, /tagLength: 128/u);
  assert.match(encrypted, /additionalData/u);
  assert.match(encrypted, /PRIVATE_ROUTE_CIPHERTEXT_B64/u);
  assert.doesNotMatch(encrypted, /\{\s*id:\s*["']\d+/u);
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

test("la separación de la bóveda no cambia el mapa ni su fuente de datos", async () => {
  const worker = await read("worker/index.ts");
  const routeApp = await read("app/route-app.tsx");

  assert.match(worker, /decryptPrivateRoute\(env\.ROUTE_DATA_KEY\)/u);
  assert.match(worker, /return noStoreJson\(\{ stops \}\)/u);
  assert.match(routeApp, /STOPS/u);
});
