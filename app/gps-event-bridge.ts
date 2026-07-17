declare global {
  interface Window {
    __rutaVerdeGpsBridgeInstalled?: boolean;
  }

  interface WindowEventMap {
    "ruta-verde:gps-position": CustomEvent<{
      lat: number;
      lng: number;
      accuracy: number;
      speed: number | null;
      heading: number | null;
      timestamp: number;
    }>;
  }
}

function announcePosition(position: GeolocationPosition) {
  window.dispatchEvent(new CustomEvent("ruta-verde:gps-position", {
    detail: {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
      speed: position.coords.speed,
      heading: position.coords.heading,
      timestamp: position.timestamp,
    },
  }));
}

if (typeof window !== "undefined" && !window.__rutaVerdeGpsBridgeInstalled) {
  window.__rutaVerdeGpsBridgeInstalled = true;
  const geolocation = navigator.geolocation;

  if (geolocation) {
    const prototype = Object.getPrototypeOf(geolocation) as Geolocation;
    const originalWatchPosition = prototype.watchPosition;
    const originalGetCurrentPosition = prototype.getCurrentPosition;

    prototype.watchPosition = function watchPosition(
      successCallback: PositionCallback,
      errorCallback?: PositionErrorCallback | null,
      options?: PositionOptions,
    ) {
      return originalWatchPosition.call(
        this,
        (position) => {
          announcePosition(position);
          successCallback(position);
        },
        errorCallback,
        options,
      );
    };

    prototype.getCurrentPosition = function getCurrentPosition(
      successCallback: PositionCallback,
      errorCallback?: PositionErrorCallback | null,
      options?: PositionOptions,
    ) {
      return originalGetCurrentPosition.call(
        this,
        (position) => {
          announcePosition(position);
          successCallback(position);
        },
        errorCallback,
        options,
      );
    };
  }
}

export {};
