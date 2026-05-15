import { DashboardPayload } from "../../../shared/types";
import { getProfile } from "../db/profiles";
import { getBusEtas } from "../adapters/bus";
import { getMtrEstimate } from "../adapters/mtr";
import { getCarEta } from "../adapters/tomtom";
import { getTunnelIndicator } from "../adapters/tunnel";
import { pairBusEtas } from "./time";

export async function buildDashboard(profileId: string): Promise<DashboardPayload | undefined> {
  const profile = getProfile(profileId);
  if (!profile) return undefined;

  const [busResult, mtr, car, tunnel] = await Promise.all([
    getBusEtas(profile.bus),
    getMtrEstimate(profile.mtr),
    getCarEta(profile.car),
    getTunnelIndicator(profile.tunnelIndicatorId)
  ]);

  const pairs = pairBusEtas(busResult.originEtas, busResult.destinationEtas, profile.latestArrivalTime);
  const firstStatus = pairs[0]?.arrivalStatus;

  return {
    profile,
    generatedAt: new Date().toISOString(),
    recommendation: firstStatus === "on_time" ? "bus_ok" : firstStatus === "late" ? "consider_alternative" : "unknown",
    bus: { ...busResult, pairs },
    mtr,
    car,
    tunnel
  };
}
