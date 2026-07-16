import * as L from "leaflet";

export function normalizeHeading(heading: number) {
  return ((heading % 360) + 360) % 360;
}

export function nearestHeading(current: number, next: number) {
  const delta = ((normalizeHeading(next) - normalizeHeading(current) + 540) % 360) - 180;
  return current + delta;
}

export function bearingBetween(from: L.LatLng, to: L.LatLng) {
  const a1 = (from.lat * Math.PI) / 180;
  const a2 = (to.lat * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(a2);
  const x = Math.cos(a1) * Math.sin(a2) - Math.sin(a1) * Math.cos(a2) * Math.cos(dLng);
  return normalizeHeading((Math.atan2(y, x) * 180) / Math.PI);
}

export function truckIcon(heading: number, moving: boolean) {
  return L.divIcon({
    className: "truck-marker-wrap",
    html: `<div class="truck-heading ${moving ? "is-moving" : "is-stopped"}" style="--truck-heading:${heading}deg">
      <span class="truck-motion-ring"></span>
      <svg class="truck-vehicle" viewBox="0 0 58 72" aria-hidden="true">
        <ellipse class="truck-shadow" cx="29" cy="40" rx="21" ry="27" />
        <g class="truck-wheels">
          <rect x="5" y="19" width="8" height="16" rx="4" />
          <rect x="45" y="19" width="8" height="16" rx="4" />
          <rect x="5" y="48" width="8" height="15" rx="4" />
          <rect x="45" y="48" width="8" height="15" rx="4" />
        </g>
        <rect class="truck-cargo" x="10" y="26" width="38" height="40" rx="8" />
        <path class="truck-cab" d="M14 25V14c0-5 4-9 9-9h12c5 0 9 4 9 9v11H14Z" />
        <path class="truck-windshield" d="M19 16c0-3 2-5 5-5h10c3 0 5 2 5 5v5H19v-5Z" />
        <rect class="truck-panel" x="16" y="33" width="26" height="25" rx="5" />
        <path class="truck-leaf" d="M34 39c-7 .3-12 3.8-12 10.2 5.8.8 10.8-2.2 12-10.2Zm-11 11c3.1-3.4 6.1-5.5 10-7" />
        <circle class="truck-headlight" cx="19" cy="8" r="2.2" />
        <circle class="truck-headlight" cx="39" cy="8" r="2.2" />
      </svg>
      <span class="truck-direction" aria-hidden="true"></span>
    </div>`,
    iconSize: [58, 72],
    iconAnchor: [29, 40],
  });
}

export function applyTruckAppearance(
  marker: L.Marker,
  heading: number,
  moving: boolean,
  currentHeading: number,
) {
  const renderedHeading = nearestHeading(currentHeading, heading);
  const truck = marker.getElement()?.querySelector<HTMLElement>(".truck-heading");
  if (truck) {
    truck.style.setProperty("--truck-heading", `${renderedHeading}deg`);
    truck.classList.toggle("is-moving", moving);
    truck.classList.toggle("is-stopped", !moving);
  } else {
    marker.setIcon(truckIcon(renderedHeading, moving));
  }
  marker.setTooltipContent(moving ? "Camión en movimiento" : "Camión detenido");
  return renderedHeading;
}
