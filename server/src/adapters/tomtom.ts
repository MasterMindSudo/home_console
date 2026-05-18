import { CarConfig, CarRouteEstimate, SourceStatus } from "../../../shared/types";
import { config } from "../config";
import { fetchJson } from "./http";
import { latestArrivalToday, minutesToArrival } from "../services/time";

const TOMTOM_REFRESH_MS = 5 * 60 * 1000;

interface CarResult {
  status: SourceStatus;
  travelMinutes?: number;
  arrivalTime?: string;
  usesToll?: boolean;
  fastest?: CarRouteEstimate;
  tollFree?: CarRouteEstimate;
  tollFreeDeltaMinutes?: number;
  routeRoadNames?: string[];
}

interface CachedCarResult {
  fetchedAt: number;
  result: CarResult;
}

interface TomTomRoute {
  summary?: {
    travelTimeInSeconds?: number;
  };
  guidance?: {
    instructions?: Array<{
      street?: string;
      roadNumbers?: string[];
      signpostText?: string;
      message?: string;
    }>;
  };
  sections?: Array<{
    sectionType?: string;
  }>;
}

interface TomTomRoutePayload {
  routes?: TomTomRoute[];
}

const carCache = new Map<string, CachedCarResult>();

function hasTollSection(route?: TomTomRoute): boolean {
  return Boolean(route?.sections?.some((section) => {
    const type = (section.sectionType || "").toUpperCase();
    return type === "TOLL" || type === "TOLL_ROAD" || type === "TOLL_VIGNETTE";
  }));
}

function extractRoadNames(route?: TomTomRoute): string[] {
  const seen = new Set<string>();
  const roads: string[] = [];
  (route?.guidance?.instructions || []).forEach((instruction) => {
    const candidates = [
      instruction.street,
      ...(instruction.roadNumbers || []),
      instruction.signpostText,
      instruction.message
    ];
    candidates.forEach((candidate) => {
      const value = (candidate || "").trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      roads.push(value);
    });
  });
  return roads;
}

async function calculateCarRoute(car: CarConfig, label: "fastest" | "toll_free"): Promise<CarRouteEstimate & { routeRoadNames?: string[] }> {
  const points = `${car.origin.lat},${car.origin.lng}:${car.destination.lat},${car.destination.lng}`;
  const params = new URLSearchParams({
    traffic: "true",
    travelMode: "car",
    routeType: "fastest",
    routeRepresentation: "summaryOnly",
    language: "en-GB",
    sectionType: "toll",
    includeTollPaymentTypes: "all",
    key: config.tomtomApiKey
  });
  if (label === "fastest") {
    params.append("instructionsType", "text");
  }
  if (label === "toll_free") {
    params.append("avoid", "tollRoads");
  }

  const url = `https://api.tomtom.com/routing/1/calculateRoute/${points}/json?${params.toString()}`;
  const payload = await fetchJson<TomTomRoutePayload>(url);
  const route = payload.routes?.[0];
  const seconds = route?.summary?.travelTimeInSeconds;
  if (!seconds) throw new Error("TomTom did not return a travel time.");

  const travelMinutes = Math.round(seconds / 60);
  return {
    label,
    travelMinutes,
    arrivalTime: minutesToArrival(travelMinutes),
    usesToll: hasTollSection(route),
    routeRoadNames: label === "fastest" ? extractRoadNames(route) : undefined
  };
}

function carCacheKey(car: CarConfig): string {
  return `${car.origin.lat.toFixed(6)},${car.origin.lng.toFixed(6)}:${car.destination.lat.toFixed(6)},${car.destination.lng.toFixed(6)}`;
}

function withStatusMessage(result: CarResult, message: string, health = result.status.health): CarResult {
  return {
    ...result,
    status: {
      ...result.status,
      health,
      message: result.status.message ? `${result.status.message} ${message}` : message
    }
  };
}

export function stoppedAfterArrival(latestArrivalTime?: string, now = new Date()): boolean {
  if (!latestArrivalTime) return false;
  return now.getTime() > latestArrivalToday(latestArrivalTime, now).getTime();
}

export async function getCarEta(car?: CarConfig, latestArrivalTime?: string): Promise<CarResult> {
  if (!car) return { status: { health: "not_configured", message: "No car route configured." } };
  if (!config.tomtomApiKey) return { status: { health: "not_configured", message: "TOMTOM_API_KEY is not set." } };

  const key = carCacheKey(car);
  const cached = carCache.get(key);
  const now = Date.now();
  if (stoppedAfterArrival(latestArrivalTime, new Date(now))) {
    return cached
      ? withStatusMessage(cached.result, "TomTom refresh stopped after latest-arrival target.", "stale")
      : { status: { health: "not_configured", message: "TomTom refresh stopped after latest-arrival target." }, routeRoadNames: [] };
  }
  if (cached && now - cached.fetchedAt < TOMTOM_REFRESH_MS) {
    return withStatusMessage(cached.result, "Cached TomTom result; refreshes every 5 minutes.");
  }

  try {
    const fastest = await calculateCarRoute(car, "fastest");
    const tollFree = await calculateCarRoute(car, "toll_free").catch(() => undefined);
    const tollFreeDeltaMinutes = tollFree ? tollFree.travelMinutes - fastest.travelMinutes : undefined;

    const result: CarResult = {
      status: {
        health: "ok",
        updatedAt: new Date().toISOString(),
        message: tollFree ? undefined : "No toll-free route returned by TomTom."
      },
      travelMinutes: fastest.travelMinutes,
      arrivalTime: fastest.arrivalTime,
      usesToll: fastest.usesToll,
      fastest,
      tollFree,
      tollFreeDeltaMinutes,
      routeRoadNames: fastest.routeRoadNames || []
    };
    carCache.set(key, { fetchedAt: now, result });
    return result;
  } catch (error) {
    const result: CarResult = { status: { health: "error", updatedAt: new Date().toISOString(), message: error instanceof Error ? error.message : "TomTom route failed." }, routeRoadNames: cached?.result.routeRoadNames || [] };
    carCache.set(key, { fetchedAt: now, result });
    return result;
  }
}
