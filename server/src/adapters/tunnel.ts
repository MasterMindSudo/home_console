import { SourceStatus } from "../../../shared/types";
import { fetchJson } from "./http";

interface TunnelResult {
  status: SourceStatus;
  minutes?: number;
  trafficStatus?: string;
  indicatorName?: string;
}

const JTIS_QUERY_URL =
  "https://portal.csdi.gov.hk/server/rest/services/TD/Estimated_Journey_Time/MapServer/0/query?where=1%3D1&outFields=*&f=json";

export async function getTunnelIndicator(indicatorId?: string): Promise<TunnelResult> {
  if (!indicatorId) return { status: { health: "not_configured", message: "No tunnel indicator selected." } };

  try {
    const payload = await fetchJson<{ features?: Array<{ attributes: Record<string, unknown> }> }>(JTIS_QUERY_URL);
    const features = payload.features || [];
    const match = features.find((feature) => {
      const attrs = feature.attributes;
      return String(attrs.OBJECTID || attrs.ID || attrs.INDICATOR_ID || attrs.JTI_ID) === indicatorId;
    });

    if (!match) {
      return { status: { health: "stale", updatedAt: new Date().toISOString(), message: "Configured tunnel indicator was not found." } };
    }

    const attrs = match.attributes;
    const minutes = Number(attrs.JOURNEY_TIME || attrs.JOURNEYTIME || attrs.TRAVEL_TIME || attrs.TIME);
    return {
      status: { health: Number.isFinite(minutes) ? "ok" : "stale", updatedAt: new Date().toISOString() },
      minutes: Number.isFinite(minutes) ? minutes : undefined,
      trafficStatus: String(attrs.TRAFFIC_STATUS || attrs.STATUS || ""),
      indicatorName: String(attrs.LOCATION_EN || attrs.NAME_EN || attrs.DESCRIPTION_EN || indicatorId)
    };
  } catch (error) {
    return { status: { health: "error", updatedAt: new Date().toISOString(), message: error instanceof Error ? error.message : "Tunnel indicator failed." } };
  }
}
