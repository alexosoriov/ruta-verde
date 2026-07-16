"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { STOPS } from "./route-data";

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function longitudeToTile(lng: number, zoom: number) {
  return Math.floor(((lng + 180) / 360) * 2 ** zoom);
}

function latitudeToTile(lat: number, zoom: number) {
  const radians = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * 2 ** zoom);
}

function routeTileUrls() {
  const minLat = Math.min(...STOPS.map((stop) => stop.lat)) - 0.002;
  const maxLat = Math.max(...STOPS.map((stop) => stop.lat)) + 0.002;
  const minLng = Math.min(...STOPS.map((stop) => stop.lng)) - 0.002;
  const maxLng = Math.max(...STOPS.map((stop) => stop.lng)) + 0.002;
  const urls: string[] = [];
  const subdomains = ["a", "b", "c"];

  for (const zoom of [15, 16, 17, 18]) {
    const minX = longitudeToTile(minLng, zoom);
    const maxX = longitudeToTile(maxLng, zoom);
    const minY = latitudeToTile(maxLat, zoom);
    const maxY = latitudeToTile(minLat, zoom);
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const subdomain = subdomains[(x + y) % subdomains.length];
        urls.push(`https://${subdomain}.tile.openstreetmap.org/${zoom}/${x}/${y}.png`);
      }
    }
  }
  return urls.slice(0, 220);
}

export default function OfflineSupport() {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js")
      .then(async () => {
        const registration = await navigator.serviceWorker.ready;
        registration.active?.postMessage({ type: "CACHE_URLS", urls: routeTileUrls() });
        setReady(true);
      })
      .catch(() => setReady(false));
  }, []);

  return <div className={`network-status ${online ? "online" : "offline"}`} role="status">
    <span />{online ? (ready ? "En línea · mapa offline preparado" : "En línea") : "Sin internet · jornada guardada en el teléfono"}
  </div>;
}
