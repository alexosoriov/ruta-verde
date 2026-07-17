"use client";

import "./gps-zoom-guard";
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

        .workspace {
          grid-template-columns: minmax(0, 1fr) 390px;
        }

        .next-card {
          position: sticky;
          top: 14px;
        }

        .primary-action,
        .complete-action,
        .absent-action,
        .map-buttons button {
          min-height: 52px !important;
          font-size: 13px !important;
        }

        @media (max-width: 900px) {
          .hero,
          .workflow-strip,
          .stats-row,
          .route-list-section,
          .tools-panel {
            display: none !important;
          }

          .workspace {
            width: 100%;
            grid-template-columns: 1fr;
            gap: 10px;
            padding: 10px;
          }

          .map-column {
            order: 2;
          }

          .next-card {
            order: 1;
            position: static;
            padding: 18px;
          }

          .street-map {
            height: 58vh;
            min-height: 390px;
          }

          .quick-settings,
          .segment-box,
          .next-card > div[style*="grid"] {
            display: none !important;
          }

          .next-card h2 {
            font-size: 29px;
          }

          .next-card p {
            font-size: 13px;
          }
        }
      `}</style>
      <RouteApp />
    </>
  );
}
