import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import readline from "readline";
import fetch from "node-fetch";
import { BusLegConfig } from "../../../shared/types";
import { config } from "../config";
import { getGtfsRoutePattern, GtfsRoutePattern, StoredGtfsRoutePattern, upsertGtfsRoutePattern } from "../db/gtfs";
import { parseCsv, parseCsvLine } from "./csv";

const REFRESH_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const FAILURE_BACKOFF_MS = 60 * 60 * 1000;
const CACHE_STATUS = "ok:v2";
const refreshPromises = new Map<string, Promise<void>>();
let lastRefreshFailureAt = 0;

export interface BusPairingProfile {
  minTravelMinutes: number;
  targetTravelMinutes: number;
  maxTravelMinutes: number;
  headwayMinutes?: number;
  source: "gtfs" | "default";
}

interface RouteRow {
  route_id: string;
  agency_id: string;
  route_short_name: string;
  route_long_name: string;
}

interface TripRow {
  route_id: string;
  service_id: string;
  trip_id: string;
}

interface StopTimeRow {
  trip_id: string;
  arrival_time: string;
  departure_time: string;
  stop_id: string;
  stop_sequence: string;
}

interface StopRow {
  stop_id: string;
  stop_name: string;
}

interface FrequencyRow {
  trip_id: string;
  start_time: string;
  end_time: string;
  headway_secs: string;
}

function isImportFresh(importedAt?: string, status?: string): boolean {
  return Boolean(status === CACHE_STATUS && importedAt && Date.now() - new Date(importedAt).getTime() < REFRESH_DAYS * MS_PER_DAY);
}

function normalizeName(value = ""): string {
  return value
    .toUpperCase()
    .replace(/<BR>/g, " ")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/&AMP;/g, "&")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\b(BUS|TERMINUS|STATION|STOP|ROAD|RD|ST)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function namesMatch(left?: string, right?: string): boolean {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const leftTokens = new Set(a.split(" ").filter((token) => token.length > 2));
  const rightTokens = new Set(b.split(" ").filter((token) => token.length > 2));
  const smaller = Math.min(leftTokens.size, rightTokens.size);
  if (!smaller) return false;
  const overlap = Array.from(leftTokens).filter((token) => rightTokens.has(token)).length;
  return overlap >= 2 && overlap / smaller >= 0.6;
}

function minutesOfTime(value?: string): number | undefined {
  if (!value) return undefined;
  const [hour, minute, second] = value.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return undefined;
  return hour * 60 + minute + (second || 0) / 60;
}

async function downloadGtfsZip(targetPath: string): Promise<void> {
  const response = await fetch(config.gtfsHeadwayUrl, { timeout: 30000 } as any);
  if (!response.ok) throw new Error(`GTFS headway download failed: ${response.status}`);
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createWriteStream(targetPath);
    response.body.pipe(stream);
    response.body.on("error", reject);
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
}

function extractZip(zipPath: string, outDir: string): void {
  fs.mkdirSync(outDir, { recursive: true });
  if (process.platform === "win32") {
    execFileSync("powershell.exe", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${outDir.replace(/'/g, "''")}' -Force`]);
    return;
  }
  execFileSync("unzip", ["-q", "-o", zipPath, "-d", outDir]);
}

function readGtfsCsv<T>(dir: string, file: string): T[] {
  return parseCsv(fs.readFileSync(path.join(dir, file), "utf8")) as T[];
}

function patternKey(stops: StopTimeRow[]): string {
  return stops.map((stop) => stop.stop_id).join(">");
}

function median(values: number[]): number | undefined {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return undefined;
  return sorted[Math.floor(sorted.length / 2)];
}

async function readTargetStopTimes(dir: string, tripIds: Set<string>): Promise<Map<string, StopTimeRow[]>> {
  const stopTimesByTrip = new Map<string, StopTimeRow[]>();
  const stream = fs.createReadStream(path.join(dir, "stop_times.txt"), { encoding: "utf8" });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let headerIndex: Record<string, number> | undefined;

  for await (const line of reader) {
    if (!headerIndex) {
      const headers = parseCsvLine(line.replace(/^\uFEFF/, ""));
      headerIndex = Object.fromEntries(headers.map((header, index) => [header, index]));
      continue;
    }
    if (!line) continue;
    const values = parseCsvLine(line);
    const tripId = values[headerIndex.trip_id];
    if (!tripIds.has(tripId)) continue;
    const current = stopTimesByTrip.get(tripId) || [];
    current.push({
      trip_id: tripId,
      arrival_time: values[headerIndex.arrival_time] || "",
      departure_time: values[headerIndex.departure_time] || "",
      stop_id: values[headerIndex.stop_id] || "",
      stop_sequence: values[headerIndex.stop_sequence] || ""
    });
    stopTimesByTrip.set(tripId, current);
  }

  return stopTimesByTrip;
}

async function buildRoutePattern(dir: string, targetRouteShortName: string): Promise<StoredGtfsRoutePattern | undefined> {
  const routes = readGtfsCsv<RouteRow>(dir, "routes.txt");
  const trips = readGtfsCsv<TripRow>(dir, "trips.txt");
  const stops = readGtfsCsv<StopRow>(dir, "stops.txt");
  const frequencies = readGtfsCsv<FrequencyRow>(dir, "frequencies.txt");
  const routeShortName = targetRouteShortName.trim().toUpperCase();
  const matchingRoutes = routes.filter((route) => route.route_short_name.trim().toUpperCase() === routeShortName);
  if (!matchingRoutes.length) return undefined;

  const stopNameById = new Map(stops.map((stop) => [stop.stop_id, stop.stop_name]));
  const matchingRouteIds = new Set(matchingRoutes.map((route) => route.route_id));
  const targetTrips = trips.filter((trip) => matchingRouteIds.has(trip.route_id));
  const targetTripIds = new Set(targetTrips.map((trip) => trip.trip_id));

  const frequenciesByTrip = new Map<string, FrequencyRow[]>();
  frequencies.forEach((frequency) => {
    if (!targetTripIds.has(frequency.trip_id)) return;
    const current = frequenciesByTrip.get(frequency.trip_id) || [];
    current.push(frequency);
    frequenciesByTrip.set(frequency.trip_id, current);
  });

  const stopTimesByTrip = await readTargetStopTimes(dir, targetTripIds);
  const patterns = new Map<string, GtfsRoutePattern & { runtimes: number[] }>();
  targetTrips.forEach((trip) => {
        const orderedStops = (stopTimesByTrip.get(trip.trip_id) || [])
          .slice()
          .sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
        if (orderedStops.length < 2) return;

        const key = patternKey(orderedStops);
        const first = orderedStops[0];
        const last = orderedStops[orderedStops.length - 1];
        const firstMinutes = minutesOfTime(first.departure_time || first.arrival_time);
        const lastMinutes = minutesOfTime(last.arrival_time || last.departure_time);
        const existing = patterns.get(key) || {
          patternKey: key,
          firstStopName: stopNameById.get(first.stop_id) || first.stop_id,
          lastStopName: stopNameById.get(last.stop_id) || last.stop_id,
          stopCount: orderedStops.length,
          stops: orderedStops.map((stop) => ({
            sequence: Number(stop.stop_sequence),
            stopId: stop.stop_id,
            stopName: stopNameById.get(stop.stop_id) || stop.stop_id
          })),
          headways: [],
          runtimes: []
        };

        if (typeof firstMinutes === "number" && typeof lastMinutes === "number" && lastMinutes > firstMinutes) {
          existing.runtimes.push(lastMinutes - firstMinutes);
        }
        (frequenciesByTrip.get(trip.trip_id) || []).forEach((frequency) => {
          const headwayMinutes = Number(frequency.headway_secs) / 60;
          if (headwayMinutes > 0) {
            existing.headways.push({
              startTime: frequency.start_time,
              endTime: frequency.end_time,
              headwayMinutes
            });
          }
        });
        patterns.set(key, existing);
      });

  if (!patterns.size) return undefined;
  return {
    routeShortName,
    agencyId: Array.from(new Set(matchingRoutes.map((route) => route.agency_id).filter(Boolean))).join("+"),
    routeLongName: matchingRoutes[0]?.route_long_name,
    patterns: Array.from(patterns.values()).map(({ runtimes, ...pattern }) => ({
      ...pattern,
      runtimeMinutes: median(runtimes)
    })),
    importedAt: new Date().toISOString()
  };
}

function removeDirectory(dir: string): void {
  if (!fs.existsSync(dir)) return;
  if (typeof (fs as unknown as { rmSync?: unknown }).rmSync === "function") {
    (fs as unknown as { rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void }).rmSync(dir, { recursive: true, force: true });
    return;
  }
  fs.rmdirSync(dir, { recursive: true });
}

async function refreshGtfsRouteIfNeeded(routeShortName: string, existing?: StoredGtfsRoutePattern): Promise<void> {
  const route = routeShortName.trim().toUpperCase();
  if (isImportFresh(existing?.importedAt, CACHE_STATUS)) return;
  if (lastRefreshFailureAt && Date.now() - lastRefreshFailureAt < FAILURE_BACKOFF_MS) return;
  const currentRefresh = refreshPromises.get(route);
  if (currentRefresh) {
    await currentRefresh;
    return;
  }

  const refreshPromise = (async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "home-console-gtfs-"));
    const zipPath = path.join(workDir, "gtfs.zip");
    const extractDir = path.join(workDir, "feed");
    try {
      await downloadGtfsZip(zipPath);
      extractZip(zipPath, extractDir);
      const pattern = await buildRoutePattern(extractDir, route);
      if (pattern) await upsertGtfsRoutePattern(config.gtfsHeadwayUrl, pattern, CACHE_STATUS);
      lastRefreshFailureAt = 0;
    } catch (error) {
      lastRefreshFailureAt = Date.now();
      console.warn("GTFS headway refresh failed:", error instanceof Error ? error.message : error);
    } finally {
      removeDirectory(workDir);
      refreshPromises.delete(route);
    }
  })();
  refreshPromises.set(route, refreshPromise);

  await refreshPromise;
}

function currentHeadway(pattern: GtfsRoutePattern, now = new Date()): number | undefined {
  const hkNow = new Date(now.getTime() + 8 * 60 * 60000);
  const minuteOfDay = hkNow.getUTCHours() * 60 + hkNow.getUTCMinutes();
  const active = pattern.headways.find((window) => {
    const start = minutesOfTime(window.startTime);
    const end = minutesOfTime(window.endTime);
    return typeof start === "number" && typeof end === "number" && minuteOfDay >= start && minuteOfDay <= end;
  });
  return active?.headwayMinutes || median(pattern.headways.map((window) => window.headwayMinutes));
}

function estimateSegmentRuntime(pattern: GtfsRoutePattern, originIndex: number, destinationIndex: number): number | undefined {
  if (destinationIndex <= originIndex) return undefined;
  if (!pattern.runtimeMinutes || pattern.stopCount < 2) return undefined;
  const stopRatio = (destinationIndex - originIndex) / (pattern.stopCount - 1);
  const curvedRatio = Math.pow(stopRatio, 0.65);
  return Math.max(1, Math.round(pattern.runtimeMinutes * curvedRatio));
}

function pairingProfileFromPattern(pattern: GtfsRoutePattern, config: BusLegConfig): BusPairingProfile | undefined {
  const originIndex = pattern.stops.findIndex((stop) => namesMatch(stop.stopName, config.originStopName));
  const destinationIndex = pattern.stops.findIndex((stop) => namesMatch(stop.stopName, config.destinationStopName));
  const targetTravelMinutes = estimateSegmentRuntime(pattern, originIndex, destinationIndex);
  if (!targetTravelMinutes) return undefined;

  const headwayMinutes = currentHeadway(pattern);
  const earlyTolerance = Math.max(6, Math.round(targetTravelMinutes * 0.2));
  const lateTolerance = Math.max(10, Math.round((headwayMinutes || 20) * 0.75));
  return {
    minTravelMinutes: Math.max(1, targetTravelMinutes - earlyTolerance),
    targetTravelMinutes,
    maxTravelMinutes: targetTravelMinutes + lateTolerance,
    headwayMinutes,
    source: "gtfs"
  };
}

export async function getBusPairingProfile(config?: BusLegConfig): Promise<BusPairingProfile | undefined> {
  if (!config?.route || !config.originStopName || !config.destinationStopName) return undefined;
  try {
    let route = await getGtfsRoutePattern(config.route);
    await refreshGtfsRouteIfNeeded(config.route, route);
    route = await getGtfsRoutePattern(config.route);
    if (!route) return undefined;

    const candidates = route.patterns
      .map((pattern) => pairingProfileFromPattern(pattern, config))
      .filter((profile): profile is BusPairingProfile => Boolean(profile));
    return candidates.sort((a, b) => b.targetTravelMinutes - a.targetTravelMinutes)[0];
  } catch (error) {
    console.warn("GTFS pairing profile failed:", error instanceof Error ? error.message : error);
    return undefined;
  }
}
