"use client";

import { useEffect, useState, type ChangeEvent } from "react";

type ExistingStop = {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  note?: string;
  day?: string;
  lat: number;
  lng: number;
  km: number;
};

type UploadedHome = {
  name?: unknown;
  address?: unknown;
  phone?: unknown;
  note?: unknown;
  day?: unknown;
  lat?: unknown;
  lng?: unknown;
};

type PreparedStop = ExistingStop & { coordinateSource: "archivo" | "recorrido anterior" };

type Preview = {
  stops: PreparedStop[];
  inherited: number;
  supplied: number;
  unresolved: string[];
};

type CurrentRoute = {
  total: number;
  source: "catalog" | "vault" | "unknown";
  updatedAt?: number;
};

const GENERIC_WORDS = new Set(["calle", "pje", "pasaje", "numero", "n", "de", "del", "la", "el"]);

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\bote\b/g, "oriente")
    .replace(/\boeste\b/g, "poniente")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function houseNumber(address: string) {
  const matches = normalize(address).match(/\b\d{3,5}\b/g);
  return matches?.at(-1) ?? "";
}

function streetTokens(address: string) {
  const number = houseNumber(address);
  return normalize(address)
    .split(" ")
    .filter((token) => token && token !== number && !GENERIC_WORDS.has(token) && !/^\d+$/.test(token));
}

function addressKey(address: string) {
  return `${streetTokens(address).join("-")}|${houseNumber(address)}`;
}

function tokenScore(left: string[], right: string[]) {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  const shared = left.filter((token) => rightSet.has(token)).length;
  return shared / Math.max(left.length, right.length);
}

function asCoordinate(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function distanceKm(a: Pick<ExistingStop, "lat" | "lng">, b: Pick<ExistingStop, "lat" | "lng">) {
  const radius = 6371;
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const value = Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function findPrevious(address: string, current: ExistingStop[], usedIds: Set<string>) {
  const exact = current.find((stop) =>
    !usedIds.has(stop.id) && stop.address && addressKey(stop.address) === addressKey(address));
  if (exact) return exact;

  const number = houseNumber(address);
  if (!number) return undefined;
  const wantedTokens = streetTokens(address);
  const candidates = current
    .filter((stop) => !usedIds.has(stop.id) && stop.address && houseNumber(stop.address) === number)
    .map((stop) => ({ stop, score: tokenScore(wantedTokens, streetTokens(stop.address!)) }))
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.score >= 0.45 ? candidates[0].stop : undefined;
}

function extractHomes(parsed: unknown): UploadedHome[] | null {
  if (Array.isArray(parsed)) return parsed as UploadedHome[];
  if (!parsed || typeof parsed !== "object") return null;
  const source = parsed as Record<string, unknown>;
  if (Array.isArray(source.homes)) return source.homes as UploadedHome[];
  if (Array.isArray(source.stops)) return source.stops as UploadedHome[];
  return null;
}

async function readCurrentRoute(): Promise<{ route: CurrentRoute; stops: ExistingStop[] }> {
  const response = await fetch("/api/private-route", { cache: "no-store" });
  const body = await response.json().catch(() => ({})) as {
    stops?: ExistingStop[];
    source?: "catalog" | "vault";
    updatedAt?: number;
    error?: string;
  };
  if (!response.ok || !Array.isArray(body.stops)) {
    throw new Error(body.error || "No pude leer el recorrido activo.");
  }
  return {
    route: {
      total: body.stops.length,
      source: body.source ?? "unknown",
      updatedAt: body.updatedAt,
    },
    stops: body.stops,
  };
}

async function prepareFile(file: File): Promise<Preview> {
  const parsed = JSON.parse(await file.text()) as unknown;
  const homes = extractHomes(parsed);
  if (!homes?.length) throw new Error("El archivo no contiene una lista de viviendas.");

  const { stops: currentStops } = await readCurrentRoute();
  const usedIds = new Set<string>();
  const unresolved: string[] = [];
  let inherited = 0;
  let supplied = 0;

  const prepared = homes.flatMap((home, index) => {
    const name = clean(home.name);
    const address = clean(home.address);
    const phone = clean(home.phone);
    const note = clean(home.note);
    const day = clean(home.day) || "Viernes";
    if (!name || !address) {
      unresolved.push(`Fila ${index + 1}: falta nombre o dirección`);
      return [];
    }

    const previous = findPrevious(address, currentStops, usedIds);
    const uploadedLat = asCoordinate(home.lat);
    const uploadedLng = asCoordinate(home.lng);
    const lat = uploadedLat ?? previous?.lat ?? null;
    const lng = uploadedLng ?? previous?.lng ?? null;
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      unresolved.push(address);
      return [];
    }

    if (uploadedLat !== null && uploadedLng !== null) supplied += 1;
    else {
      inherited += 1;
      if (previous) usedIds.add(previous.id);
    }

    return [{
      id: String(index + 1).padStart(2, "0"),
      name,
      address,
      ...(phone ? { phone } : {}),
      ...(note ? { note } : {}),
      day,
      lat,
      lng,
      km: 0,
      coordinateSource: uploadedLat !== null && uploadedLng !== null
        ? "archivo" as const
        : "recorrido anterior" as const,
    }];
  });

  let cumulative = 0;
  const stops = prepared.map((stop, index) => {
    if (index > 0) cumulative += distanceKm(prepared[index - 1], stop);
    return { ...stop, km: Number(cumulative.toFixed(3)) };
  });

  return { stops, inherited, supplied, unresolved };
}

export default function SuperadminRouteManager() {
  const [current, setCurrent] = useState<CurrentRoute | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState("Selecciona el archivo Ruta_Verde_39_viviendas_actualizadas.json.");
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    void readCurrentRoute()
      .then(({ route }) => { if (active) setCurrent(route); })
      .catch(() => { if (active) setCurrent({ total: 0, source: "unknown" }); });
    return () => { active = false; };
  }, []);

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setSaved(false);
    setPreview(null);
    setMessage("Comparando el archivo con las viviendas actuales…");
    try {
      const result = await prepareFile(file);
      setPreview(result);
      setMessage(result.unresolved.length
        ? `Faltan coordenadas en ${result.unresolved.length} registro(s). No se guardó ningún cambio.`
        : `Listo para activar: ${result.stops.length} viviendas, incluidas ${result.supplied} ubicaciones nuevas.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No pude revisar el archivo.");
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  };

  const save = async () => {
    if (!preview || preview.unresolved.length || preview.stops.length < 1) return;
    if (!window.confirm(`¿Reemplazar las ${current?.total ?? ""} viviendas actuales por estas ${preview.stops.length}?`)) return;
    setLoading(true);
    setMessage("Cifrando y activando el nuevo listado…");
    try {
      const response = await fetch("/api/private-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 1,
          stops: preview.stops.map(({ coordinateSource: _source, ...stop }) => stop),
        }),
      });
      const body = await response.json().catch(() => ({})) as { total?: number; error?: string };
      if (!response.ok) throw new Error(body.error || "No fue posible actualizar las viviendas.");

      const verified = await readCurrentRoute();
      if (verified.route.total !== preview.stops.length || verified.route.source !== "catalog") {
        throw new Error("El servidor recibió el listado, pero no lo devolvió como recorrido activo.");
      }

      setCurrent(verified.route);
      setSaved(true);
      setMessage(`${verified.route.total} viviendas activadas. Recargando el mapa automáticamente…`);
      window.setTimeout(() => window.location.reload(), 1_200);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible actualizar las viviendas.");
    } finally {
      setLoading(false);
    }
  };

  const sourceLabel = current?.source === "catalog"
    ? "Listado actualizado en base de datos"
    : current?.source === "vault"
      ? "Listado antiguo cifrado"
      : "Comprobando listado";

  return (
    <section className={`route-manager-safe ${current?.total === 39 ? "is-current" : "needs-update"}`} aria-label="Actualizar viviendas">
      <div className="route-manager-head">
        <div>
          <span className="route-manager-kicker">Solo Superadministrador</span>
          <h2>{current?.total === 39 ? "Listado actualizado activo" : "Falta activar el listado actualizado"}</h2>
          <p>{sourceLabel}. El mapa está usando <strong>{current?.total || "…"} viviendas</strong>.</p>
        </div>
        <div className="route-change-count">
          <span>Recorrido</span>
          <strong>{current?.total || "…"} → 39</strong>
        </div>
      </div>

      {current?.total !== 39 && (
        <div className="route-warning">
          El mapa seguirá mostrando 41 viviendas hasta seleccionar el archivo y presionar “Activar 39 viviendas”.
        </div>
      )}

      <label className="route-file-button">
        <span>{loading ? "Revisando archivo…" : "1. Seleccionar archivo de 39 viviendas"}</span>
        <input type="file" accept="application/json,.json" onChange={chooseFile} disabled={loading} />
      </label>

      {preview && (
        <div className="route-preview-grid">
          <article><span>Viviendas nuevas</span><strong>{preview.stops.length}</strong></article>
          <article><span>Coordenadas conservadas</span><strong>{preview.inherited}</strong></article>
          <article><span>Puntos nuevos en mapa</span><strong>{preview.supplied}</strong></article>
          <article className={preview.unresolved.length ? "warning" : "good"}><span>Sin ubicación</span><strong>{preview.unresolved.length}</strong></article>
        </div>
      )}

      {preview?.unresolved.length ? (
        <div className="route-unresolved"><strong>Registros pendientes:</strong>{preview.unresolved.map((item) => <span key={item}>{item}</span>)}</div>
      ) : null}

      <div className={`route-manager-message ${saved ? "success" : ""}`} role="status">{message}</div>
      <button
        className="route-activate-button"
        type="button"
        onClick={save}
        disabled={loading || !preview || preview.unresolved.length > 0}
      >
        {loading ? "Procesando…" : `2. Activar ${preview?.stops.length ?? 39} viviendas y recargar mapa`}
      </button>

      <style jsx global>{`
        .route-manager-safe{max-width:1500px;margin:10px auto;padding:16px;border:2px solid #d49a2b;border-radius:17px;background:#fff9e8;display:grid;gap:12px;box-shadow:0 12px 30px rgba(72,52,15,.1)}.route-manager-safe.is-current{border-color:#53a579;background:#eff9f3}.route-manager-head{display:flex;align-items:center;justify-content:space-between;gap:16px}.route-manager-kicker{font-size:10px;font-weight:900;text-transform:uppercase;color:#746849}.route-manager-head h2{margin:3px 0 4px;color:#173f33;font-size:22px}.route-manager-head p{margin:0;color:#596d65;font-size:13px}.route-change-count{min-width:115px;padding:11px 14px;border-radius:13px;background:#fff;display:grid;text-align:center;border:1px solid #dfd3ab}.route-change-count span{font-size:10px;text-transform:uppercase;font-weight:850;color:#766b4d}.route-change-count strong{font-size:22px;color:#173f33}.route-warning{padding:12px;border-radius:11px;background:#fff0bd;color:#6e4b08;font-size:13px;font-weight:800}.route-file-button{display:grid;place-items:center;min-height:52px;border:2px dashed #6b9f87;border-radius:12px;background:#fff;color:#185d43;font-size:14px;font-weight:900;cursor:pointer}.route-file-button input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}.route-preview-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.route-preview-grid article{padding:12px;border:1px solid #d8e4dc;border-radius:12px;background:#fff;display:grid;gap:3px}.route-preview-grid span{font-size:10px;text-transform:uppercase;color:#6c7e77;font-weight:850}.route-preview-grid strong{font-size:23px;color:#173f33}.route-preview-grid article.good{background:#e9f8ef}.route-preview-grid article.warning{background:#fff0bd}.route-unresolved{display:grid;gap:5px;padding:12px;border-radius:11px;background:#ffe9cc;color:#76511b;font-size:12px}.route-manager-message{padding:11px 12px;border-radius:10px;background:#fff;color:#36584c;font-size:13px;border:1px solid #d8e4dc}.route-manager-message.success{background:#dff3e7;color:#176042}.route-activate-button{width:100%;min-height:50px;border:0;border-radius:12px;background:#176e50;color:#fff;font-size:14px;font-weight:950}.route-activate-button:disabled{opacity:.45;cursor:not-allowed}@media(max-width:700px){.route-manager-safe{margin:8px;padding:13px}.route-manager-head{align-items:flex-start}.route-change-count{min-width:95px}.route-preview-grid{grid-template-columns:1fr 1fr}}
      `}</style>
    </section>
  );
}
