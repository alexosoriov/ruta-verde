"use client";

import "./map-camera-guard";
import "./gps-event-bridge";
import LevelOneSuite from "./level-one-suite";
import RouteApp from "./route-app";

export default function SuperadminApp() {
  return (
    <>
      <LevelOneSuite />
      <RouteApp />
    </>
  );
}
