import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import fetch from "node-fetch";
import { BusLegConfig } from "../../../shared/types";
import { config } from "../config";
import { getGtfsRoutePattern, GtfsRoutePattern, latestGtfsImport, replaceGtfsPatterns, StoredGtfsRoutePattern } from "../db/gtfs";
import { parseCsv } from "./csv";

const REFRESH_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const FAILURE_BACKOFF_MS = 60 * 60 * 1000;
const CACHE_STATUS = "ok:v2";
let refreshPromise: Promise<void> | undefined;
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

function buildRoutePatterns(dir: string): StoredGtfsRoutePattern[] {
  const routes = readGtfsCsv<RouteRow>(dir, "routes.txt");
  const trips = readGtfsCsv<TripRow>(dir, "trips.txt");
  const stops = readGtfsCsv<StopRow>(dir, "stops.txt");
  const frequencies = readGtfsCsv<FrequencyRow>(dir, "frequencies.txt");
  const stopTimes = readGtfsCsv<StopTimeRow>(dir, "stop_times.txt");

  const stopNameById = new Map(stops.map((stop) => [stop.stop_id, stop.stop_name]));
  const tripsByRoute = new Map<string, TripRow[]>();
  trips.forEach((trip) => {
    const current = tripsByRoute.get(trip.route_id) || [];
    current.push(trip);
    tripsByRoute.set(trip.route_id, current);
  });

  const frequenciesByTrip = new Map<string, FrequencyRow[]>();
  frequencies.forEach((frequency) => {
    const current = frequenciesByTrip.get(frequency.trip_id) || [];
    current.push(frequency);
    frequenciesByTrip.set(frequency.trip_id, current);
  });

  const stopTimesByTrip = new Map<string, StopTimeRow[]>();
  stopTimes.forEach((stopTime) => {
    const current = stopTimesByTrip.get(stopTime.trip_id) || [];
    current.push(stopTime);
    stopTimesByTrip.set(stopTime.trip_id, current);
  });

  const groupedRoutes = new Map<string, StoredGtfsRoutePattern>();
  routes
    .filter((route) => route.route_short_name)
    .forEach((route) => {
      const patterns = new Map<string, GtfsRoutePattern & { runtimes: number[] }>();
      (tripsByRoute.get(route.route_id) || []).forEach((trip) => {
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

      const routeShortName = route.route_short_name.trim().toUpperCase();
      const built = {
        routeShortName,
        agencyId: route.agency_id,
        routeLongName: route.route_long_name,
        patterns: Array.from(patterns.values()).map(({ runtimes, ...pattern }) => ({
          ...pattern,
          runtimeMinutes: median(runtimes)
        })),
        importedAt: new Date().toISOString()
      };
      if (!built.patterns.length) return;

      const existing = groupedRoutes.get(routeShortName);
      if (!existing) {
        groupedRoutes.set(routeShortName, built);
        return;
      }
      const existingPatternKeys = new Set(existing.patterns.map((pattern) => pattern.patternKey));
      built.patterns.forEach((pattern) => {
        if (!existingPatternKeys.has(pattern.patternKey)) existing.patterns.push(pattern);
      });
      if (!existing.agencyId?.includes(route.agency_id)) {
        existing.agencyId = [existing.agencyId, route.agency_id].filter(Boolean).join("+");
      }
    });

  return Array.from(groupedRoutes.values());
}

function removeDirectory(dir: string): void {
  if (!fs.existsSync(dir)) return;
  if (typeof (fs as unknown as { rmSync?: unknown }).rmSync === "function") {
    (fs as unknown as { rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void }).rmSync(dir, { recursive: true, force: true });
    return;
  }
  fs.rmdirSync(dir, { recursive: true });
}

async function refreshGtfsIfNeeded(): Promise<void> {
  const latest = await latestGtfsImport();
  if (isImportFresh(latest?.importedAt, latest?.status)) return;
  if (lastRefreshFailureAt && Date.now() - lastRefreshFailureAt < FAILURE_BACKOFF_MS) return;
  if (refreshPromise) {
    await refreshPromise;
    return;
  }

  refreshPromise = (async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "home-console-gtfs-"));
    const zipPath = path.join(workDir, "gtfs.zip");
    const extractDir = path.join(workDir, "feed");
    try {
      await downloadGtfsZip(zipPath);
      extractZip(zipPath, extractDir);
      await replaceGtfsPatterns(config.gtfsHeadwayUrl, buildRoutePatterns(extractDir), CACHE_STATUS);
      lastRefreshFailureAt = 0;
    } catch (error) {
      lastRefreshFailureAt = Date.now();
      console.warn("GTFS headway refresh failed:", error instanceof Error ? error.message : error);
    } finally {
      removeDirectory(workDir);
      refreshPromise = undefined;
    }
  })();

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
    await refreshGtfsIfNeeded();
    const route = await getGtfsRoutePattern(config.route);
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
