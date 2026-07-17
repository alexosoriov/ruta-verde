export const ROUTE_DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"] as const;

export type RouteDay = (typeof ROUTE_DAYS)[number];
export type RoutePlanMetadata = {
  name: string;
  driver: string;
  vehicle: string;
  startTime: string;
};

const ACTIVE_DAY_KEY = "ruta-verde-active-day-v1";
const STOP_DAYS_KEY = "ruta-verde-stop-days-v1";
const DAY_COUNTS_KEY = "ruta-verde-day-counts-v1";
const PLAN_METADATA_KEY = "ruta-verde-plan-metadata-v1";

const DEFAULT_PLAN: RoutePlanMetadata = {
  name: "",
  driver: "",
  vehicle: "Camión",
  startTime: "08:30",
};

function browserStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function isRouteDay(value: unknown): value is RouteDay {
  return typeof value === "string" && ROUTE_DAYS.includes(value as RouteDay);
}

export function readActiveRouteDay(): RouteDay {
  try {
    const value = browserStorage()?.getItem(ACTIVE_DAY_KEY);
    return isRouteDay(value) ? value : "Viernes";
  } catch {
    return "Viernes";
  }
}

export function writeActiveRouteDay(day: RouteDay) {
  try {
    browserStorage()?.setItem(ACTIVE_DAY_KEY, day);
  } catch {}
}

export function readStopDayAssignments(): Record<string, RouteDay[]> {
  try {
    const parsed = JSON.parse(browserStorage()?.getItem(STOP_DAYS_KEY) || "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).map(([id, days]) => [
        id,
        Array.isArray(days) ? days.filter(isRouteDay) : [],
      ]),
    );
  } catch {
    return {};
  }
}

export function writeStopDayAssignments(assignments: Record<string, RouteDay[]>) {
  try {
    browserStorage()?.setItem(STOP_DAYS_KEY, JSON.stringify(assignments));
  } catch {}
}

export function addStopsToRouteDay(stopIds: string[], day: RouteDay) {
  const assignments = readStopDayAssignments();
  for (const id of stopIds) {
    const current = assignments[id] ?? [];
    assignments[id] = Array.from(new Set([...current, day]));
  }
  writeStopDayAssignments(assignments);
}

export function removeStopsFromRouteDay(stopIds: string[], day: RouteDay) {
  const assignments = readStopDayAssignments();
  for (const id of stopIds) {
    assignments[id] = (assignments[id] ?? []).filter((item) => item !== day);
    if (!assignments[id].length) delete assignments[id];
  }
  writeStopDayAssignments(assignments);
}

export function readRouteDayCounts(): Record<RouteDay, number> {
  const empty = Object.fromEntries(ROUTE_DAYS.map((day) => [day, 0])) as Record<RouteDay, number>;
  try {
    const parsed = JSON.parse(browserStorage()?.getItem(DAY_COUNTS_KEY) || "{}") as Record<string, unknown>;
    for (const day of ROUTE_DAYS) {
      const value = parsed[day];
      if (typeof value === "number" && Number.isFinite(value)) empty[day] = Math.max(0, Math.round(value));
    }
  } catch {}
  return empty;
}

export function readRoutePlanMetadata(): Record<RouteDay, RoutePlanMetadata> {
  const defaults = Object.fromEntries(
    ROUTE_DAYS.map((day) => [day, { ...DEFAULT_PLAN, name: `Recorrido ${day}` }]),
  ) as Record<RouteDay, RoutePlanMetadata>;
  try {
    const parsed = JSON.parse(browserStorage()?.getItem(PLAN_METADATA_KEY) || "{}") as Record<string, Partial<RoutePlanMetadata>>;
    for (const day of ROUTE_DAYS) {
      defaults[day] = { ...defaults[day], ...(parsed[day] ?? {}) };
    }
  } catch {}
  return defaults;
}

export function writeRoutePlanMetadata(plans: Record<RouteDay, RoutePlanMetadata>) {
  try {
    browserStorage()?.setItem(PLAN_METADATA_KEY, JSON.stringify(plans));
  } catch {}
}

type PlannedStop = {
  id: string;
  day?: string;
};

export function applyWeeklyRoutePlan<T extends PlannedStop>(source: T[]) {
  const activeDay = readActiveRouteDay();
  const assignments = readStopDayAssignments();
  const counts = Object.fromEntries(ROUTE_DAYS.map((day) => [day, 0])) as Record<RouteDay, number>;

  const expanded = source.map((stop) => {
    const assigned = assignments[stop.id]?.filter(isRouteDay) ?? [];
    const originalDay = isRouteDay(stop.day) ? stop.day : "Viernes";
    const days = Array.from(new Set(assigned.length ? assigned : [originalDay]));
    for (const day of days) counts[day] += 1;
    return { stop, days };
  });

  try {
    browserStorage()?.setItem(DAY_COUNTS_KEY, JSON.stringify(counts));
  } catch {}

  return {
    activeDay,
    counts,
    stops: expanded
      .filter(({ days }) => days.includes(activeDay))
      .map(({ stop }) => ({ ...stop, day: activeDay })),
  };
}
