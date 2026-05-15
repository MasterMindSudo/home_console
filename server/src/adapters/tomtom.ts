import { CarConfig, SourceStatus } from "../../../shared/types";
import { config } from "../config";
import { fetchJson } from "./http";
import { minutesToArrival } from "../services/time";

interface CarResult {
  status: SourceStatus;
  travelMinutes?: number;
  arrivalTime?: string;
}

export async function getCarEta(car?: CarConfig): Promise<CarResult> {
  if (!car) return { status: { health: "not_configured", message: "No car route configured." } };
  if (!config.tomtomApiKey) return { status: { health: "not_configured", message: "TOMTOM_API_KEY is not set." } };

  try {
    const points = `${car.origin.lat},${car.origin.lng}:${car.destination.lat},${car.destination.lng}`;
    const url = `https://api.tomtom.com/routing/1/calculateRoute/${points}/json?traffic=true&travelMode=car&key=${encodeURIComponent(config.tomtomApiKey)}`;
    const payload = await fetchJson<{ routes?: Array<{ summary?: { travelTimeInSeconds?: number } }> }>(url);
    const seconds = payload.routes?.[0]?.summary?.travelTimeInSeconds;
    if (!seconds) throw new Error("TomTom did not return a travel time.");
    const travelMinutes = Math.round(seconds / 60);
    return {
      status: { health: "ok", updatedAt: new Date().toISOString() },
      travelMinutes,
      arrivalTime: minutesToArrival(travelMinutes)
    };
  } catch (error) {
    return { status: { health: "error", updatedAt: new Date().toISOString(), message: error instanceof Error ? error.message : "TomTom route failed." } };
  }
}
