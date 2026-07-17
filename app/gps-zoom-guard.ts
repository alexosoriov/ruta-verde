import * as L from "leaflet";

declare global {
  interface Window {
    __rutaVerdeZoomGuardInstalled?: boolean;
    __rutaVerdeFirstGpsFixPending?: boolean;
  }
}

type WatchSession = {
  nativeId: number | null;
  stopped: boolean;
  restartTimer: number | null;
  lastRawAt: number;
  lastAccepted: GeolocationPosition | null;
};

const MAX_ACCEPTED_ACCURACY_METERS = 50;
const WATCH_STALE_RESTART_MS = 50_000;
const STATIONARY_SPEED_METERS_PER_SECOND = 0.8;
const MIN_STATIONARY_RADIUS_METERS = 7;
const MAX_STATIONARY_RADIUS_METERS = 18;

function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const earthRadius = 6_371_000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLng = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function stablePosition(
  position: GeolocationPosition,
  previous: GeolocationPosition | null,
): GeolocationPosition {
  if (!previous) return position;

  const speed = position.coords.speed;
  const movement = distanceMeters(previous.coords, position.coords);
  const stationaryRadius = Math.min(
    MAX_STATIONARY_RADIUS_METERS,
    Math.max(MIN_STATIONARY_RADIUS_METERS, position.coords.accuracy * 0.55),
  );
  const likelyStationary =
    (speed === null || speed <= STATIONARY_SPEED_METERS_PER_SECOND) &&
    movement <= stationaryRadius;

  if (!likelyStationary) return position;

  return {
    timestamp: position.timestamp,
    coords: {
      latitude: previous.coords.latitude,
      longitude: previous.coords.longitude,
      accuracy: Math.min(previous.coords.accuracy, position.coords.accuracy),
      altitude: position.coords.altitude,
      altitudeAccuracy: position.coords.altitudeAccuracy,
      heading: previous.coords.heading ?? position.coords.heading,
      speed: 0,
    },
  };
}

if (typeof window !== "undefined" && !window.__rutaVerdeZoomGuardInstalled) {
  window.__rutaVerdeZoomGuardInstalled = true;

  const geolocation = navigator.geolocation;
  if (geolocation) {
    const prototype = Object.getPrototypeOf(geolocation) as Geolocation;
    const originalWatchPosition = prototype.watchPosition;
    const originalClearWatch = prototype.clearWatch;
    const sessions = new Map<number, WatchSession>();
    let nextVirtualId = 1_000_000;

    prototype.watchPosition = function watchPosition(
      successCallback: PositionCallback,
      errorCallback?: PositionErrorCallback | null,
      options?: PositionOptions,
    ) {
      window.__rutaVerdeFirstGpsFixPending = true;
      const virtualId = nextVirtualId++;
      const session: WatchSession = {
        nativeId: null,
        stopped: false,
        restartTimer: null,
        lastRawAt: Date.now(),
        lastAccepted: null,
      };
      sessions.set(virtualId, session);

      const startNativeWatch = () => {
        if (session.stopped) return;
        if (session.nativeId !== null) originalClearWatch.call(this, session.nativeId);

        session.nativeId = originalWatchPosition.call(
          this,
          (rawPosition) => {
            session.lastRawAt = Date.now();
            if (rawPosition.coords.accuracy > MAX_ACCEPTED_ACCURACY_METERS) return;

            const position = stablePosition(rawPosition, session.lastAccepted);
            session.lastAccepted = position;
            successCallback(position);
          },
          (error) => {
            session.lastRawAt = Date.now();
            errorCallback?.(error);
          },
          {
            enableHighAccuracy: true,
            maximumAge: Math.min(options?.maximumAge ?? 1_000, 1_000),
            timeout: Math.min(options?.timeout ?? 20_000, 20_000),
          },
        );
      };

      startNativeWatch();
      session.restartTimer = window.setInterval(() => {
        if (session.stopped) return;
        if (Date.now() - session.lastRawAt < WATCH_STALE_RESTART_MS) return;
        session.lastRawAt = Date.now();
        startNativeWatch();
      }, 10_000);

      return virtualId;
    };

    prototype.clearWatch = function clearWatch(watchId: number) {
      const session = sessions.get(watchId);
      if (!session) {
        originalClearWatch.call(this, watchId);
        return;
      }

      session.stopped = true;
      if (session.nativeId !== null) originalClearWatch.call(this, session.nativeId);
      if (session.restartTimer !== null) window.clearInterval(session.restartTimer);
      sessions.delete(watchId);
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
      const requestedZoom = typeof zoom === "number" ? zoom : 16;
      const safeZoom = Math.min(16, Math.max(15, requestedZoom));
      return originalSetView.call(this, center, safeZoom, options);
    }
    return originalSetView.call(this, center, zoom, options);
  };
}

export {};
