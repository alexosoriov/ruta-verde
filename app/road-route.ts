import * as L from "leaflet";
import type { Stop } from "./route-data";

type RouteResponse = {
  coordinates?: [number, number][];
};

type OsrmRoute = {
  code: string;
  routes?: Array<{ geometry: { coordinates: [number, number][] } }>;
};

const routeCache = new Map<string, L.LatLngExpression[]>();
const STORAGE_PREFIX = "ruta-verde-road-route:";

function hashKey(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function readStoredRoute(storageKey: string) {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "null") as [number, number][] | null;
    if (!Array.isArray(stored) || !stored.length) return null;
    return stored.map(([lat, lng]) => [lat, lng] as L.LatLngExpression);
  } catch {
    return null;
  }
}

function storeRoute(storageKey: string, points: L.LatLngExpression[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(points));
  } catch {}
}

async function requestRoute(key: string, signal?: AbortSignal) {
  const coordinates = key.split(";").map((pair) => pair.split(",").map(Number) as [number, number]);
  try {
    const response = await fetch("/api/road-route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coordinates }),
      signal,
    });
    if (!response.ok) throw new Error("route proxy unavailable");
    const data = await response.json() as RouteResponse;
    if (!data.coordinates?.length) throw new Error("empty route");
    return data.coordinates;
  } catch (error) {
    if (signal?.aborted) throw error;
    const response = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${key}?overview=full&geometries=geojson&steps=false`,
      { signal },
    );
    if (!response.ok) throw new Error("road route unavailable");
    const data = await response.json() as OsrmRoute;
    const result = data.routes?.[0]?.geometry.coordinates;
    if (data.code !== "Ok" || !result?.length) throw new Error("invalid road route");
    return result;
  }
}

export async function getRoadRoute(stops: Stop[], signal?: AbortSignal) {
  if (stops.length < 2) return [];
  const key = stops.map((stop) => `${stop.lng.toFixed(6)},${stop.lat.toFixed(6)}`).join(";");
  const memory = routeCache.get(key);
  if (memory) return memory;

  const storageKey = `${STORAGE_PREFIX}${hashKey(key)}`;
  const stored = readStoredRoute(storageKey);
  if (stored) {
    routeCache.set(key, stored);
    if (typeof navigator !== "undefined" && !navigator.onLine) return stored;
  }

  try {
    const coordinates = await requestRoute(key, signal);
    const points = coordinates.map(([lng, lat]) => [lat, lng] as L.LatLngExpression);
    routeCache.set(key, points);
    storeRoute(storageKey, points);
    return points;
  } catch (error) {
    if (stored) return stored;
    throw error;
  }
}
