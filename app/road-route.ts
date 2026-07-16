import * as L from "leaflet";
import type { Stop } from "./route-data";

type OsrmRoute = {
  code: string;
  routes?: Array<{ geometry: { coordinates: [number, number][] } }>;
};

const routeCache = new Map<string, L.LatLngExpression[]>();

export async function getRoadRoute(stops: Stop[], signal?: AbortSignal) {
  if (stops.length < 2) return [];
  const key = stops.map((stop) => `${stop.lng.toFixed(6)},${stop.lat.toFixed(6)}`).join(";");
  const cached = routeCache.get(key);
  if (cached) return cached;

  const response = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${key}?overview=full&geometries=geojson&steps=false`,
    { signal },
  );
  if (!response.ok) throw new Error("road route unavailable");
  const data = await response.json() as OsrmRoute;
  const coordinates = data.routes?.[0]?.geometry.coordinates;
  if (data.code !== "Ok" || !coordinates?.length) throw new Error("invalid road route");

  const points = coordinates.map(([lng, lat]) => [lat, lng] as L.LatLngExpression);
  routeCache.set(key, points);
  return points;
}
