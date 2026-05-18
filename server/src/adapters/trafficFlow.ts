import { SourceStatus, TrafficCamera, TrafficFlowRoad, TrafficFlowStatus } from "../../../shared/types";
import fetch from "node-fetch";

const SPEED_XML_URL = "https://resource.data.one.gov.hk/td/traffic-detectors/irnAvgSpeed-all.xml";
const SEGMENT_INFO_URL = "https://static.data.gov.hk/td/traffic-data-strategic-major-roads/info/speed_segments_info.csv";
const CAMERA_LOCATION_URL = "https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.csv";
const SEGMENT_CACHE_MS = 24 * 60 * 60 * 1000;
const CAMERA_CACHE_MS = 24 * 60 * 60 * 1000;
const EASTERN_HARBOUR_COMMON_ROADS = [
  "LEI YUE MUN ROAD",
  "KWUN TONG BYPASS",
  "ISLAND EASTERN CORRIDOR",
  "GLOUCESTER ROAD",
  "WAN CHAI INTERCHANGE",
  "CANAL ROAD FLYOVER"
];
const ABERDEEN_TUNNEL_ROADS = [
  ...EASTERN_HARBOUR_COMMON_ROADS,
  "WONG NAI CHUNG GAP FLYOVER",
  "ABERDEEN TUNNEL",
  "WONG CHUK HANG ROAD",
  "NAM FUNG ROAD"
];
const STUBBS_ROAD_ROUTE_ROADS = [
  ...EASTERN_HARBOUR_COMMON_ROADS,
  "WONG NAI CHUNG GAP ROAD",
  "STUBBS ROAD",
  "WONG CHUK HANG ROAD",
  "NAM FUNG ROAD"
];

interface SegmentInfo {
  segmentId: string;
  roadName: string;
  roadKey: string;
}

interface SpeedItem {
  segmentId: string;
  speedKph?: number;
  valid: boolean;
}

interface SpeedPayload {
  updatedAt?: string;
  items: SpeedItem[];
}

interface TrafficFlowResult {
  status: SourceStatus;
  roads: TrafficFlowRoad[];
  matchedRoadNames: string[];
}

let segmentCache: { fetchedAt: number; items: SegmentInfo[] } | undefined;
let cameraCache: { fetchedAt: number; items: TrafficCamera[] } | undefined;

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function csvValue(value: string | undefined): string {
  return (value || "").trim().replace(/^"|"$/g, "").replace(/""/g, "\"");
}

export function normalizeRoadName(value: string): string {
  return value
    .toUpperCase()
    .replace(/\bBY\s*-?\s*PASS\b/g, "BYPASS")
    .replace(/\bROUTE\s+([0-9A-Z]+)\b/g, "$1")
    .replace(/\bRTE\s+([0-9A-Z]+)\b/g, "$1")
    .replace(/\bRD\b/g, "ROAD")
    .replace(/\bST\b/g, "STREET")
    .replace(/\bAVE\b/g, "AVENUE")
    .replace(/\bHWY\b/g, "HIGHWAY")
    .replace(/\bEXPWY\b/g, "EXPRESSWAY")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseSegmentInfoCsv(csv: string): SegmentInfo[] {
  return csv
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const [segmentId, roadName] = line.split(",");
      return { segmentId: csvValue(segmentId), roadName: csvValue(roadName) };
    })
    .filter((item) => item.segmentId && item.roadName)
    .map((item) => ({ ...item, roadKey: normalizeRoadName(item.roadName) }));
}

function delimitedRows(text: string): string[][] {
  const [header = ""] = text.split(/\r?\n/, 1);
  const delimiter = header.includes("\t") ? "\t" : ",";
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => line.split(delimiter).map(csvValue));
}

export function parseCameraLocationsCsv(text: string): TrafficCamera[] {
  const rows = delimitedRows(text);
  const header = rows.shift()?.map((item) => item.toLowerCase()) || [];
  const index = (name: string) => header.indexOf(name);
  const keyIndex = index("key");
  const descriptionIndex = index("description");
  const urlIndex = index("url");
  const latitudeIndex = index("latitude");
  const longitudeIndex = index("longitude");

  return rows
    .map((row) => {
      const key = row[keyIndex] || "";
      const description = row[descriptionIndex] || "";
      const latitude = Number(row[latitudeIndex]);
      const longitude = Number(row[longitudeIndex]);
      return {
        key,
        description,
        imageUrl: row[urlIndex] || `https://tdcctv.data.one.gov.hk/${encodeURIComponent(key)}.JPG`,
        latitude: Number.isFinite(latitude) ? latitude : undefined,
        longitude: Number.isFinite(longitude) ? longitude : undefined
      };
    })
    .filter((item) => item.key && item.description && item.imageUrl);
}

export function parseSpeedXml(xml: string): SpeedPayload {
  const date = xml.match(/<date>(.*?)<\/date>/)?.[1];
  const time = xml.match(/<time>(.*?)<\/time>/)?.[1];
  const updatedAt = date && time ? `${date}T${time}+08:00` : undefined;
  const items: SpeedItem[] = [];
  const segmentPattern = /<segment>\s*<segment_id>(.*?)<\/segment_id>\s*<speed>(.*?)<\/speed>\s*<valid>(.*?)<\/valid>\s*<\/segment>/g;
  let match: RegExpExecArray | null;

  while ((match = segmentPattern.exec(xml)) !== null) {
    const speedText = decodeXml(match[2]).trim();
    const speed = speedText ? Number(speedText) : Number.NaN;
    items.push({
      segmentId: decodeXml(match[1]).trim(),
      speedKph: Number.isFinite(speed) ? speed : undefined,
      valid: decodeXml(match[3]).trim().toUpperCase() === "Y"
    });
  }

  return { updatedAt, items };
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function flowStatus(speed: number | undefined, validSegmentCount: number): TrafficFlowStatus {
  if (typeof speed !== "number" || !validSegmentCount) return "stale";
  if (speed < 30) return "slow";
  if (speed < 50) return "moderate";
  return "smooth";
}

function isNumericRoadKey(value: string): boolean {
  return /^[0-9]+[A-Z]?$/.test(value);
}

function displayRoadName(key: string): string {
  return key;
}

function uniqueRouteCandidates(routeRoadNames: string[]): Array<{ name: string; key: string }> {
  const seen = new Set<string>();
  const candidates: Array<{ name: string; key: string }> = [];
  expandRouteRoadNames(routeRoadNames)
    .map((name) => ({ name, key: normalizeRoadName(name) }))
    .filter((item) => item.key && !isNumericRoadKey(item.key))
    .forEach(({ name, key }) => {
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({ name: displayRoadName(normalizeRoadName(name)), key });
    });
  return candidates.slice(0, 32);
}

function segmentIndex(segmentInfo: SegmentInfo[]): Map<string, SegmentInfo[]> {
  const index = new Map<string, SegmentInfo[]>();
  segmentInfo.forEach((segment) => {
    if (!segment.roadKey || isNumericRoadKey(segment.roadKey)) return;
    const current = index.get(segment.roadKey) || [];
    current.push(segment);
    index.set(segment.roadKey, current);
  });
  return index;
}

function findMatchingSegments(routeKey: string, segmentsByRoad: Map<string, SegmentInfo[]>): SegmentInfo[] {
  const exact = segmentsByRoad.get(routeKey);
  if (exact?.length) return exact;
  if (routeKey.length < 8) return [];

  for (const [segmentKey, segments] of segmentsByRoad) {
    if (segmentKey.includes(routeKey) || routeKey.includes(segmentKey)) return segments;
  }
  return [];
}

function matchCameraToRouteKey(camera: TrafficCamera, routeCandidates: Array<{ key: string }>): string | undefined {
  const descriptionKey = normalizeRoadName(camera.description);
  const matches = routeCandidates
    .filter((candidate) => descriptionKey.includes(candidate.key))
    .map((candidate) => ({ key: candidate.key, index: descriptionKey.indexOf(candidate.key), length: candidate.key.length }))
    .sort((a, b) => a.index - b.index || b.length - a.length);
  return matches[0]?.key;
}

function camerasByRouteKey(cameras: TrafficCamera[], routeCandidates: Array<{ name: string; key: string }>): Map<string, TrafficCamera[]> {
  const matched = new Map<string, TrafficCamera[]>();
  cameras.forEach((camera) => {
    const routeKey = matchCameraToRouteKey(camera, routeCandidates);
    if (!routeKey) return;
    const routeName = routeCandidates.find((candidate) => candidate.key === routeKey)?.name;
    const current = matched.get(routeKey) || [];
    current.push({ ...camera, roadName: routeName });
    matched.set(routeKey, current);
  });
  return matched;
}

function expandRouteRoadNames(routeRoadNames: string[]): string[] {
  const normalized = routeRoadNames.map(normalizeRoadName);
  const expanded = [...routeRoadNames];
  const hasEasternHarbourRoute = normalized.some((name) => name.includes("LEI YUE MUN ROAD"))
    && normalized.some((name) => name.includes("ISLAND EASTERN CORRIDOR") || name.includes("EASTERN HARBOUR CROSSING TUNNEL"));
  if (!hasEasternHarbourRoute) return expanded;

  const hasAberdeenRoute = normalized.some((name) => name.includes("ABERDEEN TUNNEL") || name.includes("WONG CHUK HANG ROAD"));
  const hasStubbsRoute = normalized.some((name) => name.includes("STUBBS ROAD") || name.includes("WONG NAI CHUNG GAP ROAD"));
  const corridorRoads = hasAberdeenRoute
    ? ABERDEEN_TUNNEL_ROADS
    : hasStubbsRoute
      ? STUBBS_ROAD_ROUTE_ROADS
      : [...ABERDEEN_TUNNEL_ROADS, ...STUBBS_ROAD_ROUTE_ROADS];
  return [...corridorRoads, ...expanded];
}

export function aggregateTrafficFlow(routeRoadNames: string[], segmentInfo: SegmentInfo[], speeds: SpeedPayload, cameras: TrafficCamera[] = []): TrafficFlowRoad[] {
  const routeCandidates = uniqueRouteCandidates(routeRoadNames);
  const segmentsByRoad = segmentIndex(segmentInfo);
  const speedBySegment = new Map(speeds.items.map((item) => [item.segmentId, item]));
  const cameraMatches = camerasByRouteKey(cameras, routeCandidates);
  const usedRoads = new Set<string>();
  const roads: TrafficFlowRoad[] = [];

  routeCandidates.forEach((routeRoad) => {
    const matchingSegments = findMatchingSegments(routeRoad.key, segmentsByRoad);
    const matchedCameras = (cameraMatches.get(routeRoad.key) || []).slice(0, 2);
    if (!matchingSegments.length) {
      if (!matchedCameras.length) return;
      roads.push({
        roadName: routeRoad.name,
        validSegmentCount: 0,
        invalidSegmentCount: 0,
        status: "stale",
        cameras: matchedCameras,
        cameraOnly: true
      });
      return;
    }

    const matchedRoadKey = matchingSegments[0].roadKey;
    if (usedRoads.has(matchedRoadKey)) return;

    usedRoads.add(matchedRoadKey);
    const matchedSpeeds = matchingSegments.map((segment) => speedBySegment.get(segment.segmentId)).filter(Boolean) as SpeedItem[];
    const validSpeeds = matchedSpeeds.filter((item) => item.valid && typeof item.speedKph === "number").map((item) => item.speedKph as number);
    const representativeSpeed = median(validSpeeds);
    const slowestSpeed = validSpeeds.length ? Math.min(...validSpeeds) : undefined;
    const invalidSegmentCount = Math.max(0, matchingSegments.length - validSpeeds.length);

    roads.push({
      roadName: matchingSegments[0].roadName,
      representativeSpeedKph: typeof representativeSpeed === "number" ? Math.round(representativeSpeed * 10) / 10 : undefined,
      slowestSpeedKph: typeof slowestSpeed === "number" ? Math.round(slowestSpeed * 10) / 10 : undefined,
      validSegmentCount: validSpeeds.length,
      invalidSegmentCount,
      status: flowStatus(representativeSpeed, validSpeeds.length),
      cameras: matchedCameras
    });
  });

  return roads.slice(0, 8);
}

async function fetchText(url: string, timeoutMs = 10000): Promise<string> {
  const response = await fetch(url, { timeout: timeoutMs });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const buffer = await response.buffer();
  if (buffer.length >= 4) {
    const hasUtf16LeBom = buffer[0] === 0xFF && buffer[1] === 0xFE;
    const hasManyNulls = buffer.slice(0, Math.min(buffer.length, 80)).filter((byte, index) => index % 2 === 1 && byte === 0).length > 10;
    if (hasUtf16LeBom || hasManyNulls) {
      return buffer.toString("utf16le").replace(/^\uFEFF/, "");
    }
  }
  return buffer.toString("utf8");
}

async function getSegmentInfo(): Promise<SegmentInfo[]> {
  const now = Date.now();
  if (segmentCache && now - segmentCache.fetchedAt < SEGMENT_CACHE_MS) return segmentCache.items;
  const csv = await fetchText(SEGMENT_INFO_URL, 20000);
  const items = parseSegmentInfoCsv(csv);
  segmentCache = { fetchedAt: now, items };
  return items;
}

async function getTrafficCameras(): Promise<TrafficCamera[]> {
  const now = Date.now();
  if (cameraCache && now - cameraCache.fetchedAt < CAMERA_CACHE_MS) return cameraCache.items;
  const csv = await fetchText(CAMERA_LOCATION_URL, 20000);
  const items = parseCameraLocationsCsv(csv);
  cameraCache = { fetchedAt: now, items };
  return items;
}

export async function getTrafficFlow(routeRoadNames: string[] = []): Promise<TrafficFlowResult> {
  if (!routeRoadNames.length) {
    return { status: { health: "not_configured", message: "No TomTom route road names available." }, roads: [], matchedRoadNames: [] };
  }

  try {
    const [segmentInfo, speedXml, cameras] = await Promise.all([
      getSegmentInfo(),
      fetchText(SPEED_XML_URL, 15000),
      getTrafficCameras().catch(() => [])
    ]);
    const speeds = parseSpeedXml(speedXml);
    const roads = aggregateTrafficFlow(routeRoadNames, segmentInfo, speeds, cameras);
    return {
      status: {
        health: roads.length ? "ok" : "stale",
        updatedAt: speeds.updatedAt || new Date().toISOString(),
        message: roads.length ? undefined : "No matching HK speed segments for this TomTom route."
      },
      roads,
      matchedRoadNames: routeRoadNames
    };
  } catch (error) {
    return {
      status: { health: "error", updatedAt: new Date().toISOString(), message: error instanceof Error ? error.message : "Traffic flow failed." },
      roads: [],
      matchedRoadNames: routeRoadNames
    };
  }
}
