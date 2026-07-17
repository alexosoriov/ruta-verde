"use client";

import { useState, type ChangeEvent } from "react";

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
  const exact = current.find((stop) => !usedIds.has(stop.id) && stop.address && addressKey(stop.address) === addressKey(address));
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

async function prepareFile(file: File): Promise<Preview> {
  const parsed = JSON.parse(await file.text()) as unknown;
  const homes = extractHomes(parsed);
  if (!homes?.length) throw new Error("El archivo no contiene una lista de viviendas.");

  const response = await fetch("/api/private-route", { cache: "no-store" });
  const body = await response.json().catch(() => ({})) as { stops?: ExistingStop[]; error?: string };
  if (!response.ok || !Array.isArray(body.stops)) throw new Error(body.error || "No pude leer el recorrido actual.");

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

    const previous = findPrevious(address, body.stops!, usedIds);
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
      coordinateSource: uploadedLat !== null && uploadedLng !== null ? "archivo" as const : "recorrido anterior" as const,
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
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState("Selecciona el archivo JSON preparado con el listado actualizado.");
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

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
        ? `Faltan coordenadas en ${result.unresolved.length} registro(s). No se enviará nada todavía.`
        : `Archivo listo: ${result.stops.length} viviendas verificadas.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No pude revisar el archivo.");
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  };

  const save = async () => {
    if (!preview || preview.unresolved.length || preview.stops.length < 1) return;
    if (!window.confirm(`¿Reemplazar el recorrido actual por estas ${preview.stops.length} viviendas?`)) return;
    setLoading(true);
    setMessage("Cifrando y guardando el nuevo listado…");
    try {
      const response = await fetch("/api/private-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1, stops: preview.stops.map(({ coordinateSource: _source, ...stop }) => stop) }),
      });
      const body = await response.json().catch(() => ({})) as { total?: number; error?: string };
      if (!response.ok) throw new Error(body.error || "No fue posible actualizar las viviendas.");
      setSaved(true);
      setMessage(`${body.total ?? preview.stops.length} viviendas guardadas de forma cifrada. Recarga la app para ver el nuevo recorrido.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible actualizar las viviendas.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <details className="route-manager-safe">
      <summary>🏠 Actualizar listado de viviendas</summary>
      <div className="route-manager-body">
        <div>
          <span className="route-manager-kicker">Solo Superadministrador</span>
          <h2>Cargar recorrido actualizado</h2>
          <p>El archivo se compara dentro de tu sesión. Las coordenadas existentes se reutilizan y el resultado se cifra antes de guardarse en la base de datos.</p>
        </div>

        <label className="route-file-button">
          <span>{loading ? "Revisando…" : "Seleccionar archivo JSON"}</span>
          <input type="file" accept="application/json,.json" onChange={chooseFile} disabled={loading} />
        </label>

        {preview && (
          <div className="route-preview-grid">
            <article><span>Viviendas</span><strong>{preview.stops.length}</strong></article>
            <article><span>Coordenadas conservadas</span><strong>{preview.inherited}</strong></article>
            <article><span>Puntos nuevos</span><strong>{preview.supplied}</strong></article>
            <article className={preview.unresolved.length ? "warning" : "good"}><span>Sin ubicación</span><strong>{preview.unresolved.length}</strong></article>
          </div>
        )}

        {preview?.unresolved.length ? (
          <div className="route-unresolved"><strong>Registros pendientes:</strong>{preview.unresolved.map((item) => <span key={item}>{item}</span>)}</div>
        ) : null}

        <div className={`route-manager-message ${saved ? "success" : ""}`} role="status">{message}</div>
        <div className="route-manager-actions">
          <button type="button" onClick={save} disabled={loading || !preview || preview.unresolved.length > 0}>{loading ? "Procesando…" : "Guardar 39 viviendas"}</button>
          {saved && <button type="button" className="secondary" onClick={() => window.location.reload()}>Recargar Ruta Verde</button>}
        </div>
      </div>

      <style jsx global>{`
        .route-manager-safe{max-width:1500px;margin:10px auto 0;border:1px solid #cfddd4;border-radius:15px;background:#fff;overflow:hidden}.route-manager-safe>summary{cursor:pointer;list-style:none;padding:13px 16px;color:#204f40;font-size:13px;font-weight:900}.route-manager-safe>summary::-webkit-details-marker{display:none}.route-manager-body{padding:0 16px 16px;display:grid;gap:12px}.route-manager-kicker{font-size:10px;font-weight:900;text-transform:uppercase;color:#6a7e76}.route-manager-body h2{margin:3px 0 5px;color:#173f33;font-size:21px}.route-manager-body p{margin:0;color:#60756d;font-size:12px;line-height:1.5}.route-file-button{display:grid;place-items:center;min-height:48px;border:1px dashed #8fb7a5;border-radius:12px;background:#eff7f2;color:#1d6448;font-size:13px;font-weight:900;cursor:pointer}.route-file-button input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}.route-preview-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.route-preview-grid article{padding:12px;border:1px solid #d8e4dc;border-radius:12px;background:#f8faf8;display:grid;gap:3px}.route-preview-grid span{font-size:10px;text-transform:uppercase;color:#6c7e77;font-weight:850}.route-preview-grid strong{font-size:23px;color:#173f33}.route-preview-grid article.good{background:#edf8f1}.route-preview-grid article.warning{background:#fff4dc}.route-unresolved{display:grid;gap:5px;padding:12px;border-radius:11px;background:#fff4dc;color:#76551c;font-size:12px}.route-manager-message{padding:11px 12px;border-radius:10px;background:#eef3ef;color:#36584c;font-size:12px}.route-manager-message.success{background:#e3f4e9;color:#176042}.route-manager-actions{display:flex;gap:8px}.route-manager-actions button{flex:1;min-height:46px;border:0;border-radius:11px;background:#1d7656;color:#fff;font-weight:900}.route-manager-actions button.secondary{background:#e9f0eb;color:#244f41}.route-manager-actions button:disabled{opacity:.5;cursor:not-allowed}@media(max-width:700px){.route-manager-safe{margin:8px 8px 0}.route-preview-grid{grid-template-columns:1fr 1fr}.route-manager-actions{flex-direction:column}}
      `}</style>
    </details>
  );
}
