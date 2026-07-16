"use client";

import RouteApp from "./route-app";

export default function DriverApp() {
  return (
    <>
      <style jsx global>{`
        .app-tabs button:nth-child(2),
        .hero-actions > button,
        .presentation-bar {
          display: none !important;
        }
      `}</style>
      <RouteApp />
    </>
  );
}
