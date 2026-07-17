"use client";

import { useEffect } from "react";

const STABILIZED_FLAG = "__rutaVerdeGpsStabilized";
const MIN_STATIONARY_RADIUS_METERS = 7;
const MAX_STATIONARY_RADIUS_METERS = 18;
const MOVING_SPEED_METERS_PER_SECOND = 1.4;
const HEADING_SPEED_METERS_PER_SECOND = 2;
const HEADING_DISTANCE_METERS = 12;

type StabilizedGeolocation = Geolocation & {
  [STABILIZED_FLAG]?: boolean;
};

type LeafletMap = {
  setView(center: unknown, zoom?: number, options?: { animate?: boolean }): unknown;
};

type LeafletModule = {
  Map: {
    prototype: LeafletMap;
  };
};

function distanceMeters(a: GeolocationPosition, b: GeolocationPosition) {
  const earthRadius = 6_371_000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const lat1 = toRadians(a.coords.latitude);
  const lat2 = toRadians(b.coords.latitude);
  const deltaLat = lat2 - lat1;
  const deltaLng = toRadians(b.coords.longitude - a.coords.longitude);
  const value = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function stablePosition(
  source: GeolocationPosition,
  latitude: number,
  longitude: number,
  heading: number | null,
): GeolocationPosition {
  return {
    timestamp: source.timestamp,
    coords: {
      latitude,
      longitude,
      accuracy: source.coords.accuracy,
      altitude: source.coords.altitude,
      altitudeAccuracy: source.coords.altitudeAccuracy,
      heading,
      speed: source.coords.speed,
      toJSON: source.coords.toJSON?.bind(source.coords),
    },
    toJSON: source.toJSON?.bind(source),
  } as GeolocationPosition;
}

function installGpsStabilizer() {
  const current = navigator.geolocation as StabilizedGeolocation | undefined;
  if (!current || current[STABILIZED_FLAG]) return;

  const wrapped: StabilizedGeolocation = {
    [STABILIZED_FLAG]: true,
    getCurrentPosition(success, error, options) {
      current.getCurrentPosition.call(current, success, error, options);
    },
    clearWatch(id) {
      current.clearWatch.call(current, id);
    },
    watchPosition(success, error, options) {
      let lastRaw: GeolocationPosition | null = null;
      let lastStable: GeolocationPosition | null = null;

      return current.watchPosition.call(current, (position) => {
        if (!lastRaw || !lastStable) {
          lastRaw = position;
          lastStable = position;
          success(position);
          return;
        }

        const rawDistance = distanceMeters(lastRaw, position);
        const stableDistance = distanceMeters(lastStable, position);
        const elapsedSeconds = Math.max((position.timestamp - lastRaw.timestamp) / 1_000, 0.25);
        const derivedSpeed = rawDistance / elapsedSeconds;
        const reportedSpeed = position.coords.speed;
        const speed = reportedSpeed !== null && Number.isFinite(reportedSpeed)
          ? reportedSpeed
          : derivedSpeed;
        const stationaryRadius = Math.min(
          MAX_STATIONARY_RADIUS_METERS,
          Math.max(MIN_STATIONARY_RADIUS_METERS, position.coords.accuracy * 0.35),
        );
        const stationary = speed < MOVING_SPEED_METERS_PER_SECOND && stableDistance < stationaryRadius;

        if (stationary) {
          const frozen = stablePosition(
            position,
            lastStable.coords.latitude,
            lastStable.coords.longitude,
            lastStable.coords.heading,
          );
          lastRaw = position;
          lastStable = frozen;
          success(frozen);
          return;
        }

        const alpha = position.coords.accuracy <= 10 ? 0.68 : position.coords.accuracy <= 25 ? 0.5 : 0.34;
        const latitude = lastStable.coords.latitude
          + (position.coords.latitude - lastStable.coords.latitude) * alpha;
        const longitude = lastStable.coords.longitude
          + (position.coords.longitude - lastStable.coords.longitude) * alpha;
        const headingReliable = speed >= HEADING_SPEED_METERS_PER_SECOND
          || stableDistance >= HEADING_DISTANCE_METERS;
        const heading = headingReliable && position.coords.heading !== null
          ? position.coords.heading
          : lastStable.coords.heading;
        const filtered = stablePosition(position, latitude, longitude, heading);

        lastRaw = position;
        lastStable = filtered;
        success(filtered);
      }, error, options);
    },
  };

  try {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      enumerable: true,
      value: wrapped,
    });
  } catch {
    // Algunos navegadores no permiten reemplazar la propiedad. La app mantiene
    // igualmente el filtro interno que ya existe en LiveMap.
  }
}

export default function GpsMapStability() {
  useEffect(() => {
    let manualMapMode = false;
    let restoreMapPatch: (() => void) | undefined;

    const enableManualMapMode = (event: Event) => {
      const target = event.target as Element | null;
      if (!target?.closest(".street-map")) return;
      manualMapMode = true;
    };

    const handleDocumentClick = (event: Event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest("button");
      if (button?.textContent?.includes("Seguir camión")) manualMapMode = false;
    };

    installGpsStabilizer();
    const reinstall = () => window.setTimeout(installGpsStabilizer, 0);
    window.addEventListener("ruta-verde-native-ready", reinstall);
    document.addEventListener("pointerdown", enableManualMapMode, true);
    document.addEventListener("touchstart", enableManualMapMode, true);
    document.addEventListener("wheel", enableManualMapMode, { capture: true, passive: true });
    document.addEventListener("click", handleDocumentClick, true);

    void import("leaflet").then((leafletModule) => {
      const leaflet = leafletModule as unknown as LeafletModule;
      const prototype = leaflet.Map.prototype;
      const originalSetView = prototype.setView;

      prototype.setView = function patchedSetView(
        this: LeafletMap,
        center: unknown,
        zoom?: number,
        options?: { animate?: boolean },
      ) {
        const looksLikeAutomaticGpsFollow = options?.animate === true
          && typeof zoom === "number"
          && zoom >= 17;
        if (manualMapMode && looksLikeAutomaticGpsFollow) return this;
        return originalSetView.call(this, center, zoom, options);
      };

      restoreMapPatch = () => {
        prototype.setView = originalSetView;
      };
    }).catch(() => undefined);

    return () => {
      restoreMapPatch?.();
      window.removeEventListener("ruta-verde-native-ready", reinstall);
      document.removeEventListener("pointerdown", enableManualMapMode, true);
      document.removeEventListener("touchstart", enableManualMapMode, true);
      document.removeEventListener("wheel", enableManualMapMode, true);
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, []);

  return null;
}
