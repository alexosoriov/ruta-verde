"use client";

import RouteApp from "./route-app";

export default function DriverApp() {
  return (
    <>
      <style jsx global>{`
        .app-tabs button:nth-child(2),
        .hero,
        .workflow-strip,
        .hero-actions > button,
        .presentation-bar {
          display: none !important;
        }

        .workspace {
          margin-top: 18px !important;
        }

        .next-card .primary-action,
        .next-card .complete-action,
        .next-card .absent-action,
        .next-card .quick-settings button,
        .map-buttons button,
        .row-nav,
        .row-actions button {
          min-height: 52px !important;
          font-size: 13px !important;
        }

        .next-card h2 {
          font-size: clamp(28px, 4vw, 38px) !important;
          line-height: 1.08 !important;
        }

        .next-card .complete-action,
        .next-card .absent-action {
          font-size: 15px !important;
          font-weight: 900 !important;
        }

        @media (max-width: 860px) {
          .topbar {
            min-height: 66px;
            height: auto;
            padding: 8px 12px;
          }

          .brand-copy span,
          .header-date,
          .install-button,
          .installed-badge {
            display: none !important;
          }

          .app-tabs {
            display: none !important;
          }

          .workspace {
            width: calc(100% - 16px) !important;
            margin: 8px auto 0 !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 10px !important;
          }

          .next-card {
            order: -1;
            position: sticky;
            top: 8px;
            z-index: 900;
            padding: 18px !important;
            border-radius: 20px !important;
          }

          .next-card .next-number,
          .next-card .segment-box,
          .next-card .quick-settings {
            display: none !important;
          }

          .next-card p {
            margin-bottom: 10px !important;
          }

          .next-card > div[style] {
            margin: 8px 0 !important;
            padding: 9px !important;
          }

          .street-map {
            height: 54vh !important;
            min-height: 360px !important;
          }

          .map-toolbar {
            padding-bottom: 8px !important;
          }

          .map-buttons button {
            min-width: 132px;
          }

          .stats-row {
            display: none !important;
          }

          .route-list-section {
            margin-top: 12px !important;
          }

          .stop-row {
            min-height: 68px;
          }
        }
      `}</style>
      <RouteApp />
    </>
  );
}
