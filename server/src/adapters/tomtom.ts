import { CarConfig, CarRouteEstimate, SourceStatus } from "../../../shared/types";
import { config } from "../config";
import { latestArrivalToday, minutesToArrival } from "../services/time";
import fetch from "node-fetch";

const DEV_TOMTOM_REFRESH_MS = 10 * 60 * 1000;
const LIVE_TOMTOM_REFRESH_MS = 2 * 60 * 1000;
const TOMTOM_TIMEOUT_MS = 8000;

type TomTomKeyLabel = "primary" | "backup";

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

interface CarEtaOptions {
  forceRefresh?: boolean;
  ignoreArrivalStop?: boolean;
  includeTollFree?: boolean;
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

const ROADLIKE_PATTERN = /([A-Z][A-Z0-9'(). -]*?\b(?:ROAD|RD\.?|STREET|ST\.?|AVENUE|AVE\.?|HIGHWAY|HWY|EXPRESSWAY|EXPWY|BYPASS|BY-PASS|TUNNEL|CORRIDOR|INTERCHANGE|FLYOVER)\b)/gi;
const ROADLIKE_TEST_PATTERN = /\b(?:ROAD|RD\.?|STREET|ST\.?|AVENUE|AVE\.?|HIGHWAY|HWY|EXPRESSWAY|EXPWY|BYPASS|BY-PASS|TUNNEL|CORRIDOR|INTERCHANGE|FLYOVER)\b/i;

const carCache = new Map<string, CachedCarResult>();
let primaryQuotaBlockedUntil = 0;

class TomTomHttpError extends Error {
  status: number;
  keyLabel: TomTomKeyLabel;
  body?: string;

  constructor(status: number, statusText: string, keyLabel: TomTomKeyLabel, body?: string) {
    super(`${status} ${statusText}`);
    this.status = status;
    this.keyLabel = keyLabel;
    this.body = body;
  }
}

function tomtomErrorMessage(error: unknown): string {
  if (error instanceof TomTomHttpError) {
    const source = error.keyLabel === "backup" ? "backup key" : "primary key";
    const backupHint = error.keyLabel === "primary" && !config.tomtomBackupApiKey ? " No backup TomTom key is configured." : "";
    return `${error.status} ${error.message.replace(/^[0-9]+\s*/, "")} from TomTom ${source}.${backupHint}`;
  }
  return error instanceof Error ? error.message : "TomTom route failed.";
}

export function tomtomRefreshMs(env: NodeJS.ProcessEnv = process.env): number {
  const override = Number(env.TOMTOM_REFRESH_MS || env.TOMTOM_REFRESH_INTERVAL_MS);
  if (Number.isFinite(override) && override > 0) return override;

  const isLive = env.RENDER === "true" || Boolean(env.RENDER_SERVICE_ID) || env.NODE_ENV === "production";
  return isLive ? LIVE_TOMTOM_REFRESH_MS : DEV_TOMTOM_REFRESH_MS;
}

export function tomtomRuntimeInfo(): { primaryConfigured: boolean; backupConfigured: boolean; refreshMinutes: number; primaryQuotaBlocked: boolean } {
  return {
    primaryConfigured: Boolean(config.tomtomApiKey),
    backupConfigured: Boolean(config.tomtomBackupApiKey),
    refreshMinutes: Math.round(tomtomRefreshMs() / 60000),
    primaryQuotaBlocked: Date.now() < primaryQuotaBlockedUntil
  };
}

export function isTomTomQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: number; body?: string; message?: string };
  if (candidate.status !== 403 && candidate.status !== 429) return false;
  const body = (candidate.body || candidate.message || "").toLowerCase();
  return candidate.status === 429
    || body.includes("quota")
    || body.includes("limit")
    || body.includes("insufficientfunds")
    || body.includes("credits")
    || candidate.status === 403;
}

function tomtomKeys(now = Date.now()): Array<{ label: TomTomKeyLabel; value: string }> {
  const keys: Array<{ label: TomTomKeyLabel; value: string }> = [];
  if (config.tomtomApiKey && now >= primaryQuotaBlockedUntil) {
    keys.push({ label: "primary", value: config.tomtomApiKey });
  }
  if (config.tomtomBackupApiKey) {
    keys.push({ label: "backup", value: config.tomtomBackupApiKey });
  }
  return keys;
}

async function fetchTomTomRoute(baseUrl: string, params: URLSearchParams, refreshMs: number): Promise<{ payload: TomTomRoutePayload; keyLabel: TomTomKeyLabel }> {
  const keys = tomtomKeys();
  if (!keys.length) {
    throw new Error("TOMTOM_API_KEY is not set.");
  }

  let lastError: unknown;
  for (const key of keys) {
    const requestParams = new URLSearchParams(params);
    requestParams.set("key", key.value);
    const response = await fetch(`${baseUrl}?${requestParams.toString()}`, { timeout: TOMTOM_TIMEOUT_MS });
    if (response.ok) {
      return { payload: (await response.json()) as TomTomRoutePayload, keyLabel: key.label };
    }

    const body = await response.text().catch(() => "");
    const error = new TomTomHttpError(response.status, response.statusText, key.label, body);
    lastError = error;
    if (key.label === "primary" && config.tomtomBackupApiKey && isTomTomQuotaError(error)) {
      primaryQuotaBlockedUntil = Date.now() + refreshMs;
      continue;
    }
    break;
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error("TomTom route failed.");
}

function hasTollSection(route?: TomTomRoute): boolean {
  return Boolean(route?.sections?.some((section) => {
    const type = (section.sectionType || "").toUpperCase();
    return type === "TOLL" || type === "TOLL_ROAD" || type === "TOLL_VIGNETTE";
  }));
}

export function extractRoadNames(route?: TomTomRoute): string[] {
  const seen = new Set<string>();
  const roads: string[] = [];
  const add = (value: string | undefined, alreadyRoadlike = false) => {
    const trimmed = (value || "")
      .replace(/\/[0-9A-Z]+\b/g, "")
      .replace(/^.*\b(?:AT|ONTO|ON|TO|VIA)\s+/i, "")
      .trim();
    if (!trimmed || /^[0-9A-Z]+$/.test(trimmed)) return;
    if (!alreadyRoadlike && !ROADLIKE_TEST_PATTERN.test(trimmed)) return;
    const key = trimmed.toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    if (seen.has(key)) return;
    seen.add(key);
    roads.push(trimmed);
  };
  const addRoadsFromText = (value: string | undefined) => {
    const text = value || "";
    let match: RegExpExecArray | null;
    ROADLIKE_PATTERN.lastIndex = 0;
    while ((match = ROADLIKE_PATTERN.exec(text)) !== null) {
      add(match[1], true);
    }
    ROADLIKE_PATTERN.lastIndex = 0;
  };

  (route?.guidance?.instructions || []).forEach((instruction) => {
    add(instruction.street);
    addRoadsFromText(instruction.signpostText);
    addRoadsFromText(instruction.message);
  });
  return roads;
}

async function calculateCarRoute(car: CarConfig, label: "fastest" | "toll_free", refreshMs: number): Promise<CarRouteEstimate & { routeRoadNames?: string[]; keyLabel: TomTomKeyLabel }> {
  const points = `${car.origin.lat},${car.origin.lng}:${car.destination.lat},${car.destination.lng}`;
  const params = new URLSearchParams({
    traffic: "true",
    travelMode: "car",
    routeType: "fastest",
    routeRepresentation: "summaryOnly",
    language: "en-GB",
    sectionType: "toll",
    includeTollPaymentTypes: "all"
  });
  if (label === "fastest") {
    params.append("instructionsType", "text");
  }
  if (label === "toll_free") {
    params.append("avoid", "tollRoads");
  }

  const url = `https://api.tomtom.com/routing/1/calculateRoute/${points}/json`;
  const { payload, keyLabel } = await fetchTomTomRoute(url, params, refreshMs);
  const route = payload.routes?.[0];
  const seconds = route?.summary?.travelTimeInSeconds;
  if (!seconds) throw new Error("TomTom did not return a travel time.");

  const travelMinutes = Math.round(seconds / 60);
  return {
    label,
    travelMinutes,
    arrivalTime: minutesToArrival(travelMinutes),
    usesToll: hasTollSection(route),
    routeRoadNames: label === "fastest" ? extractRoadNames(route) : undefined,
    keyLabel
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

export async function getCarEta(car?: CarConfig, latestArrivalTime?: string, options: CarEtaOptions = {}): Promise<CarResult> {
  if (!car) return { status: { health: "not_configured", message: "No car route configured." } };
  if (!config.tomtomApiKey && !config.tomtomBackupApiKey) return { status: { health: "not_configured", message: "TOMTOM_API_KEY is not set." } };

  const key = carCacheKey(car);
  const cached = carCache.get(key);
  const now = Date.now();
  const refreshMs = tomtomRefreshMs();
  const refreshMinutes = Math.round(refreshMs / 60000);
  if (!options.ignoreArrivalStop && stoppedAfterArrival(latestArrivalTime, new Date(now))) {
    return cached
      ? withStatusMessage(cached.result, "TomTom refresh stopped after latest-arrival target.", "stale")
      : { status: { health: "not_configured", message: "TomTom refresh stopped after latest-arrival target." }, routeRoadNames: [] };
  }
  if (!options.forceRefresh && cached && now - cached.fetchedAt < refreshMs) {
    return withStatusMessage(cached.result, `Cached TomTom result; refreshes every ${refreshMinutes} minutes.`);
  }

  try {
    const includeTollFree = options.includeTollFree !== false;
    const fastest = await calculateCarRoute(car, "fastest", refreshMs);
    const tollFree = includeTollFree ? await calculateCarRoute(car, "toll_free", refreshMs).catch(() => undefined) : undefined;
    const tollFreeDeltaMinutes = tollFree ? tollFree.travelMinutes - fastest.travelMinutes : undefined;
    const backupMessage = fastest.keyLabel === "backup" ? "TomTom backup key used because the primary key is unavailable." : undefined;
    const tollFreeMessage = includeTollFree
      ? tollFree ? undefined : "No toll-free route returned by TomTom."
      : "Toll-free route skipped for this request.";

    const result: CarResult = {
      status: {
        health: "ok",
        updatedAt: new Date().toISOString(),
        message: [backupMessage, tollFreeMessage].filter(Boolean).join(" ") || undefined
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
    const result: CarResult = { status: { health: "error", updatedAt: new Date().toISOString(), message: tomtomErrorMessage(error) }, routeRoadNames: cached?.result.routeRoadNames || [] };
    carCache.set(key, { fetchedAt: now, result });
    return result;
  }
}
