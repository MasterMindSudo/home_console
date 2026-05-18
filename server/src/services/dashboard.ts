import { DashboardPayload } from "../../../shared/types";
import { getProfile } from "../db/profiles";
import { getBusEtas } from "../adapters/bus";
import { getMtrEstimate } from "../adapters/mtr";
import { getCarEta } from "../adapters/tomtom";
import { getHourlyWeather } from "../adapters/weather";
import { getTrafficFlow } from "../adapters/trafficFlow";
import { pairBusEtas } from "./time";

export async function buildDashboard(profileId: string): Promise<DashboardPayload | undefined> {
  const profile = getProfile(profileId);
  if (!profile) return undefined;

  const [weather, busResult, mtr, car] = await Promise.all([
    getHourlyWeather(),
    getBusEtas(profile.bus),
    getMtrEstimate(profile.mtr),
    getCarEta(profile.car, profile.latestArrivalTime)
  ]);
  const trafficFlow = await getTrafficFlow(car.routeRoadNames || []);

  const pairs = pairBusEtas(busResult.originEtas, busResult.destinationEtas, profile.latestArrivalTime);
  const firstStatus = pairs[0]?.arrivalStatus;

  return {
    profile,
    generatedAt: new Date().toISOString(),
    recommendation: firstStatus === "on_time" ? "bus_ok" : firstStatus === "late" ? "consider_alternative" : "unknown",
    weather,
    bus: { ...busResult, pairs },
    mtr,
    car,
    tunnel: { status: { health: "not_configured", message: "Tunnel pane replaced by route traffic flow." } },
    trafficFlow
  };
}
