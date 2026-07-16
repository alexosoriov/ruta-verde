import type { Stop } from "./route-data";
import type { GpsMetrics } from "./tracking-types";

export type StopStatus = "pending" | "done" | "absent";
export type StopDetail = { kilos: string; material: string; note: string };
export type ActivityEntry = {
  id: string;
  stopId: string;
  stopName: string;
  stopAddress?: string;
  status: "done" | "absent";
  at: number;
};
export type StoredPosition = { lat: number; lng: number; accuracy: number | null; at: number };

export type SyncMetadata = {
  deviceId: string;
  serverRevision: number;
  statusUpdatedAt: Record<string, number>;
  detailUpdatedAt: Record<string, number>;
  customStopUpdatedAt: Record<string, number>;
  globalUpdatedAt: Record<string, number>;
};

export type JourneySnapshot = {
  version: 4;
  journeyId: string;
  statuses: Record<string, StopStatus>;
  details: Record<string, StopDetail>;
  customStops: Stop[];
  reverse: boolean;
  optimizedIds: string[];
  startedAt: number | null;
  completedAt: number | null;
  activity: ActivityEntry[];
  vehicle: string;
  lastPosition: StoredPosition | null;
  gpsMetrics: GpsMetrics;
  updatedAt: number;
  sync?: SyncMetadata;
};
