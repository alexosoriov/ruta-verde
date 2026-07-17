import * as L from "leaflet";

declare global {
  interface Window {
    __rutaVerdeZoomGuardInstalled?: boolean;
    __rutaVerdeFirstGpsFixPending?: boolean;
  }
}

if (typeof window !== "undefined" && !window.__rutaVerdeZoomGuardInstalled) {
  window.__rutaVerdeZoomGuardInstalled = true;

  const geolocation = navigator.geolocation;
  if (geolocation) {
    const prototype = Object.getPrototypeOf(geolocation) as Geolocation;
    const originalWatchPosition = prototype.watchPosition;

    prototype.watchPosition = function watchPosition(
      successCallback: PositionCallback,
      errorCallback?: PositionErrorCallback | null,
      options?: PositionOptions,
    ) {
      window.__rutaVerdeFirstGpsFixPending = true;
      return originalWatchPosition.call(this, successCallback, errorCallback, options);
    };
  }

  const originalSetView = L.Map.prototype.setView;
  L.Map.prototype.setView = function setView(
    center: L.LatLngExpression,
    zoom?: number,
    options?: L.ZoomPanOptions,
  ) {
    const firstGpsCenter = window.__rutaVerdeFirstGpsFixPending && options?.animate === false;
    if (firstGpsCenter) {
      window.__rutaVerdeFirstGpsFixPending = false;
      const safeZoom = typeof zoom === "number" ? Math.min(zoom, 16) : 16;
      return originalSetView.call(this, center, safeZoom, options);
    }
    return originalSetView.call(this, center, zoom, options);
  };
}

export {};
