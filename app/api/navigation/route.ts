import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type OsrmStep = {
  distance: number;
  duration: number;
  name: string;
  maneuver: {
    type: string;
    modifier?: string;
    location: [number, number];
  };
};

type OsrmResponse = {
  code: string;
  routes?: Array<{
    distance: number;
    duration: number;
    legs: Array<{ steps: OsrmStep[] }>;
  }>;
};

function parseCoordinate(value: string | null) {
  if (!value) return null;
  const [lngText, latText] = value.split(",");
  const lng = Number(lngText);
  const lat = Number(latText);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export async function GET(request: NextRequest) {
  const origin = parseCoordinate(request.nextUrl.searchParams.get("origin"));
  const destination = parseCoordinate(request.nextUrl.searchParams.get("destination"));

  if (!origin || !destination) {
    return NextResponse.json({ error: "Coordenadas inválidas" }, { status: 400 });
  }

  const coordinates = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=false&steps=true&alternatives=false`;

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { "User-Agent": "Ruta-Verde-Navigation/1.0" },
    });
    if (!response.ok) throw new Error("OSRM unavailable");

    const data = await response.json() as OsrmResponse;
    const route = data.routes?.[0];
    const steps = route?.legs?.[0]?.steps ?? [];
    if (data.code !== "Ok" || !route || !steps.length) throw new Error("Route unavailable");

    return NextResponse.json({
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      steps: steps.map((step) => ({
        distance: step.distance,
        duration: step.duration,
        name: step.name,
        maneuver: {
          type: step.maneuver.type,
          modifier: step.maneuver.modifier ?? null,
          lat: step.maneuver.location[1],
          lng: step.maneuver.location[0],
        },
      })),
    });
  } catch {
    return NextResponse.json({ error: "No fue posible calcular las indicaciones" }, { status: 503 });
  }
}
