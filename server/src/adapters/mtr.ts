import { MtrLineChoice, MtrSegmentConfig, MtrStationChoice, SourceStatus } from "../../../shared/types";
import { fetchJson } from "./http";
import { minutesUntil, minutesToArrival } from "../services/time";
import fetch from "node-fetch";

interface MtrResult {
  status: SourceStatus;
  nextTrainMinutes?: number;
  averageRideMinutes?: number;
  totalMinutes?: number;
  arrivalTime?: string;
}

interface MtrTrain {
  time?: string;
}

interface StationRow {
  line: string;
  direction: "UP" | "DOWN";
  code: string;
  name: string;
  sequence: number;
}

let stationCache: StationRow[] | undefined;

function toApiDirection(direction: "UP" | "DOWN"): string {
  return direction === "UP" ? "UT" : "DT";
}

function fromCsvDirection(direction: string): "UP" | "DOWN" {
  return direction === "UT" ? "UP" : "DOWN";
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

async function getStations(): Promise<StationRow[]> {
  if (!stationCache) {
    const response = await fetch("https://opendata.mtr.com.hk/data/mtr_lines_and_stations.csv", { timeout: 12000 });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const csv = await response.text();
    stationCache = csv
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .slice(1)
      .filter(Boolean)
      .map((line) => {
        const cols = parseCsvLine(line);
        return {
          line: cols[0],
          direction: fromCsvDirection(cols[1]),
          code: cols[2],
          name: cols[5],
          sequence: Number(cols[6])
        };
      })
      .filter((station) => station.line && station.code && station.name && Number.isFinite(station.sequence));
  }
  return stationCache;
}

export async function getMtrLines(): Promise<MtrLineChoice[]> {
  const stations = await getStations();
  return Array.from(new Set(stations.map((station) => station.line)))
    .sort()
    .map((line) => ({ line }));
}

export async function getMtrStations(line: string): Promise<MtrStationChoice[]> {
  const stations = await getStations();
  const filtered = line ? stations.filter((station) => station.line === line.toUpperCase()) : stations;
  return summarizeStations(filtered);
}

export async function getAllMtrStations(): Promise<MtrStationChoice[]> {
  const stations = await getStations();
  return summarizeStations(stations);
}

function summarizeStations(stations: StationRow[]): MtrStationChoice[] {
  const grouped = new Map<string, MtrStationChoice>();
  stations.forEach((station) => {
    const current = grouped.get(station.code) || { code: station.code, name: station.name, lines: [] };
    if (!current.lines.includes(station.line)) current.lines.push(station.line);
    grouped.set(station.code, current);
  });
  return Array.from(grouped.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function nodeKey(line: string, code: string): string {
  return `${line}:${code}`;
}

function parseNode(key: string): { line: string; code: string } {
  const [line, code] = key.split(":");
  return { line, code };
}

export async function resolveMtrTrip(startStationCode: string, endStationCode: string): Promise<MtrSegmentConfig | undefined> {
  const stations = await getStations();
  const byCode = new Map<string, StationRow[]>();
  stations.forEach((station) => {
    const rows = byCode.get(station.code) || [];
    rows.push(station);
    byCode.set(station.code, rows);
  });

  const graph = new Map<string, Array<{ to: string; cost: number }>>();
  function addEdge(from: string, to: string, cost: number) {
    const edges = graph.get(from) || [];
    edges.push({ to, cost });
    graph.set(from, edges);
  }

  const lineDirections = new Map<string, StationRow[]>();
  stations.forEach((station) => {
    const key = `${station.line}:${station.direction}`;
    const rows = lineDirections.get(key) || [];
    rows.push(station);
    lineDirections.set(key, rows);
  });

  lineDirections.forEach((rows) => {
    const ordered = rows.sort((a, b) => a.sequence - b.sequence);
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const from = ordered[index];
      const to = ordered[index + 1];
      addEdge(nodeKey(from.line, from.code), nodeKey(to.line, to.code), 2.2);
    }
  });

  byCode.forEach((rows) => {
    rows.forEach((from) => {
      rows.forEach((to) => {
        if (from.line !== to.line) addEdge(nodeKey(from.line, from.code), nodeKey(to.line, to.code), 4);
      });
    });
  });

  const startNodes = byCode.get(startStationCode) || [];
  const endCodes = new Set([endStationCode]);
  const queue = startNodes.map((station) => ({ key: nodeKey(station.line, station.code), cost: 0, path: [nodeKey(station.line, station.code)] }));
  const seen = new Map<string, number>();

  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift()!;
    if ((seen.get(current.key) || Infinity) <= current.cost) continue;
    seen.set(current.key, current.cost);

    const parsed = parseNode(current.key);
    if (endCodes.has(parsed.code) && current.path.length > 1) {
      const first = parseNode(current.path[0]);
      const second = parseNode(current.path[1]) || first;
      const firstRows = stations.filter((station) => station.line === first.line && station.code === first.code);
      const secondRows = stations.filter((station) => station.line === second.line && station.code === second.code);
      const firstDirection = firstRows.find((row) => secondRows.some((candidate) => candidate.direction === row.direction && candidate.sequence > row.sequence))?.direction || "UP";
      const start = byCode.get(startStationCode)?.[0];
      const end = byCode.get(endStationCode)?.[0];
      const lines = Array.from(new Set(current.path.map((key) => parseNode(key).line)));

      return {
        line: first.line,
        station: startStationCode,
        direction: firstDirection,
        startStationCode,
        startStationName: start?.name || startStationCode,
        endStationCode,
        endStationName: end?.name || endStationCode,
        averageRideMinutes: Math.max(2, Math.round(current.cost)),
        routeSummary: lines.join(" -> ")
      };
    }

    (graph.get(current.key) || []).forEach((edge) => {
      queue.push({ key: edge.to, cost: current.cost + edge.cost, path: [...current.path, edge.to] });
    });
  }

  return undefined;
}

export async function getMtrEstimate(config?: MtrSegmentConfig): Promise<MtrResult> {
  if (!config) return { status: { health: "not_configured", message: "No MTR leg configured." } };

  try {
    const station = config.startStationCode || config.station;
    const url = `https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=${encodeURIComponent(config.line)}&sta=${encodeURIComponent(station)}`;
    const payload = await fetchJson<{ status?: number; data?: Record<string, { UP?: MtrTrain[]; DOWN?: MtrTrain[] }> }>(url);
    const key = `${config.line}-${station}`;
    const trains = payload.data?.[key]?.[toApiDirection(config.direction) as "UP" | "DOWN"] || payload.data?.[key]?.[config.direction] || [];
    const next = trains.find((train) => train.time);
    const nextTrainMinutes = next?.time ? minutesUntil(next.time) : undefined;
    const totalMinutes = typeof nextTrainMinutes === "number" ? nextTrainMinutes + config.averageRideMinutes : undefined;

    return {
      status: { health: typeof totalMinutes === "number" ? "ok" : "stale", updatedAt: new Date().toISOString(), message: typeof totalMinutes === "number" ? undefined : "No upcoming train returned." },
      nextTrainMinutes,
      averageRideMinutes: config.averageRideMinutes,
      totalMinutes,
      arrivalTime: typeof totalMinutes === "number" ? minutesToArrival(totalMinutes) : undefined
    };
  } catch (error) {
    return { status: { health: "error", updatedAt: new Date().toISOString(), message: error instanceof Error ? error.message : "MTR estimate failed." } };
  }
}
