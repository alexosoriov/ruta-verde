type RoadRouteBody = { coordinates?: Array<[number, number]> };

function validCoordinates(value: unknown): value is Array<[number, number]> {
  return Array.isArray(value) && value.length >= 2 && value.length <= 100 && value.every((point) =>
    Array.isArray(point) && point.length === 2 &&
    Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
    Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90,
  );
}

async function routeForTruck(coordinates: Array<[number, number]>, apiKey: string) {
  const response = await fetch("https://api.openrouteservice.org/v2/directions/driving-hgv/geojson", {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
      Accept: "application/geo+json, application/json",
    },
    body: JSON.stringify({
      coordinates,
      instructions: false,
      options: { vehicle_type: "delivery" },
    }),
  });
  if (!response.ok) throw new Error("Ruta de camión no disponible");
  const data = await response.json() as {
    features?: Array<{ properties?: { summary?: { distance?: number; duration?: number } }; geometry?: { coordinates?: [number, number][] } }>;
  };
  const feature = data.features?.[0];
  if (!feature?.geometry?.coordinates?.length) throw new Error("Ruta de camión vacía");
  return {
    coordinates: feature.geometry.coordinates,
    distanceMeters: feature.properties?.summary?.distance ?? 0,
    durationSeconds: feature.properties?.summary?.duration ?? 0,
    provider: "openrouteservice-hgv",
  };
}

async function routeForVehicle(coordinates: Array<[number, number]>) {
  const key = coordinates.map(([lng, lat]) => `${lng},${lat}`).join(";");
  const response = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${key}?overview=full&geometries=geojson&steps=false`,
    { headers: { "User-Agent": "Ruta-Verde/1.0" } },
  );
  if (!response.ok) throw new Error("Ruta vehicular no disponible");
  const data = await response.json() as {
    code?: string;
    routes?: Array<{ distance?: number; duration?: number; geometry?: { coordinates?: [number, number][] } }>;
  };
  const route = data.routes?.[0];
  if (data.code !== "Ok" || !route?.geometry?.coordinates?.length) throw new Error("Ruta vehicular vacía");
  return {
    coordinates: route.geometry.coordinates,
    distanceMeters: route.distance ?? 0,
    durationSeconds: route.duration ?? 0,
    provider: "osrm-driving",
  };
}

export async function handleVehicleRoadRoute(request: Request, apiKey?: string) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let body: RoadRouteBody;
  try {
    body = await request.json() as RoadRouteBody;
  } catch {
    return Response.json({ error: "Datos inválidos" }, { status: 400 });
  }

  if (!validCoordinates(body.coordinates)) {
    return Response.json({ error: "Coordenadas inválidas" }, { status: 400 });
  }

  if (apiKey) {
    try {
      return Response.json(await routeForTruck(body.coordinates, apiKey), {
        headers: { "Cache-Control": "public, max-age=3600" },
      });
    } catch {
      // Si el proveedor HGV falla, se conserva una ruta vehicular de respaldo.
    }
  }

  try {
    return Response.json(await routeForVehicle(body.coordinates), {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch {
    return Response.json({ error: "Ruta no disponible" }, { status: 502 });
  }
}
