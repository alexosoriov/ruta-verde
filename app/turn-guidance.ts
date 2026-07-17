export type NavigationPoint = {
  lat: number;
  lng: number;
};

export type TurnIcon =
  | "start"
  | "straight"
  | "slight-left"
  | "left"
  | "sharp-left"
  | "slight-right"
  | "right"
  | "sharp-right"
  | "uturn"
  | "roundabout"
  | "arrive";

export type TurnInstruction = {
  id: string;
  icon: TurnIcon;
  text: string;
  street: string;
  distanceMeters: number;
  durationSeconds: number;
  location: NavigationPoint;
};

type OsrmManeuver = {
  type?: string;
  modifier?: string;
  exit?: number;
  location?: [number, number];
};

type OsrmStep = {
  distance?: number;
  duration?: number;
  name?: string;
  maneuver?: OsrmManeuver;
};

type OsrmResponse = {
  code?: string;
  routes?: Array<{
    legs?: Array<{
      steps?: OsrmStep[];
    }>;
  }>;
};

const DEFAULT_STREET = "la siguiente calle";

function cleanStreet(value?: string) {
  const street = value?.trim();
  return street || DEFAULT_STREET;
}

function turnIcon(type?: string, modifier?: string): TurnIcon {
  if (type === "depart") return "start";
  if (type === "arrive") return "arrive";
  if (type === "roundabout" || type === "rotary" || type === "roundabout turn") return "roundabout";
  if (modifier === "uturn") return "uturn";
  if (modifier === "sharp left") return "sharp-left";
  if (modifier === "slight left") return "slight-left";
  if (modifier === "left") return "left";
  if (modifier === "sharp right") return "sharp-right";
  if (modifier === "slight right") return "slight-right";
  if (modifier === "right") return "right";
  return "straight";
}

function ordinal(value: number) {
  const labels: Record<number, string> = {
    1: "primera",
    2: "segunda",
    3: "tercera",
    4: "cuarta",
    5: "quinta",
    6: "sexta",
    7: "séptima",
    8: "octava",
    9: "novena",
    10: "décima",
  };
  return labels[value] ?? `salida ${value}`;
}

function instructionText(step: OsrmStep) {
  const maneuver = step.maneuver ?? {};
  const street = cleanStreet(step.name);
  const type = maneuver.type;
  const modifier = maneuver.modifier;

  if (type === "depart") return `Comienza por ${street}`;
  if (type === "arrive") return "Llegaste al punto de retiro";

  if (type === "roundabout" || type === "rotary" || type === "roundabout turn") {
    if (maneuver.exit && maneuver.exit > 0) {
      return `En la rotonda, toma la ${ordinal(maneuver.exit)} salida hacia ${street}`;
    }
    return `Entra a la rotonda y continúa hacia ${street}`;
  }

  if (modifier === "uturn") return `Haz un retorno y continúa por ${street}`;
  if (modifier === "sharp left") return `Gira pronunciadamente a la izquierda hacia ${street}`;
  if (modifier === "slight left") return `Mantente levemente a la izquierda hacia ${street}`;
  if (modifier === "left") return `Gira a la izquierda hacia ${street}`;
  if (modifier === "sharp right") return `Gira pronunciadamente a la derecha hacia ${street}`;
  if (modifier === "slight right") return `Mantente levemente a la derecha hacia ${street}`;
  if (modifier === "right") return `Gira a la derecha hacia ${street}`;

  if (type === "merge") return `Incorpórate y continúa por ${street}`;
  if (type === "fork") return `Continúa por la bifurcación hacia ${street}`;
  if (type === "on ramp") return `Toma el acceso hacia ${street}`;
  if (type === "off ramp") return `Toma la salida hacia ${street}`;
  if (type === "end of road") return `Al final de la calle, continúa por ${street}`;
  if (type === "new name" || type === "continue") return `Continúa por ${street}`;

  return `Sigue derecho por ${street}`;
}

function parseStep(step: OsrmStep, index: number): TurnInstruction | null {
  const location = step.maneuver?.location;
  if (!location || location.length !== 2) return null;

  const distanceMeters = Number.isFinite(step.distance) ? Math.max(0, step.distance ?? 0) : 0;
  const durationSeconds = Number.isFinite(step.duration) ? Math.max(0, step.duration ?? 0) : 0;
  const street = cleanStreet(step.name);
  const icon = turnIcon(step.maneuver?.type, step.maneuver?.modifier);

  return {
    id: `${index}-${step.maneuver?.type ?? "turn"}-${location[0].toFixed(6)}-${location[1].toFixed(6)}`,
    icon,
    text: instructionText(step),
    street,
    distanceMeters,
    durationSeconds,
    location: { lat: location[1], lng: location[0] },
  };
}

export function parseTurnInstructions(value: unknown): TurnInstruction[] {
  const response = value as OsrmResponse;
  if (response?.code !== "Ok") return [];

  const steps = response.routes?.[0]?.legs?.flatMap((leg) => leg.steps ?? []) ?? [];
  return steps
    .map(parseStep)
    .filter((step): step is TurnInstruction => Boolean(step));
}

export async function requestTurnInstructions(
  origin: NavigationPoint,
  destination: NavigationPoint,
  signal?: AbortSignal,
): Promise<TurnInstruction[]> {
  const coordinates = `${origin.lng.toFixed(7)},${origin.lat.toFixed(7)};${destination.lng.toFixed(7)},${destination.lat.toFixed(7)}`;
  const response = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${coordinates}?alternatives=false&overview=false&steps=true`,
    { signal },
  );

  if (!response.ok) throw new Error("turn guidance unavailable");
  const instructions = parseTurnInstructions(await response.json());
  if (!instructions.length) throw new Error("empty turn guidance");
  return instructions;
}

export function formatTurnDistance(distanceMeters: number) {
  const distance = Math.max(0, distanceMeters);
  if (distance < 100) return `${Math.round(distance / 10) * 10} m`;
  if (distance < 1_000) return `${Math.round(distance / 50) * 50} m`;
  return `${(distance / 1_000).toFixed(distance < 10_000 ? 1 : 0).replace(".", ",")} km`;
}

export function speechForTurn(instruction: TurnInstruction, distanceMeters: number) {
  const distance = formatTurnDistance(distanceMeters);
  if (instruction.icon === "arrive") return instruction.text;
  return `En ${distance}, ${instruction.text.toLocaleLowerCase("es-CL")}`;
}
