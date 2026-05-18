import { BusDirectionChoice, BusLegConfig, BusOperator, BusRouteChoice, BusStopChoice, EtaItem, SourceStatus } from "../../../shared/types";
import { fetchJson } from "./http";
import { minutesUntil } from "../services/time";

interface BusResult {
  status: SourceStatus;
  previousStopName?: string;
  previousEtas: EtaItem[];
  originEtas: EtaItem[];
  destinationEtas: EtaItem[];
}

interface GenericEtaRecord {
  co?: BusOperator;
  eta?: string | null;
  eta_seq?: number;
  dest_en?: string;
  rmk_en?: string;
  remarks_en?: string;
}

interface KmbRouteRecord {
  route: string;
  bound: "O" | "I";
  service_type: string;
  orig_en: string;
  dest_en: string;
}

interface KmbRouteStopRecord {
  route: string;
  bound: "O" | "I";
  service_type: string;
  seq: string;
  stop: string;
}

interface KmbStopRecord {
  stop: string;
  name_en: string;
}

interface CitybusRouteRecord {
  co: "CTB";
  route: string;
  orig_en: string;
  dest_en: string;
}

interface CitybusRouteStopRecord {
  co: "CTB";
  route: string;
  dir: "O" | "I";
  seq: number;
  stop: string;
}

interface CitybusStopRecord {
  stop: string;
  name_en: string;
}

function normalize(records: GenericEtaRecord[] = [], operator?: BusOperator): EtaItem[] {
  return records
    .filter((item) => item.eta)
    .map((item, index) => ({
      eta: item.eta as string,
      minutes: minutesUntil(item.eta as string),
      operator: item.co || operator,
      etaSequence: item.eta_seq || index + 1,
      destination: item.dest_en,
      remark: item.co ? `${item.co}${item.rmk_en ? `: ${item.rmk_en}` : ""}` : item.rmk_en || item.remarks_en
    }))
    .sort((a, b) => a.minutes - b.minutes)
    .slice(0, 4);
}

async function fetchKmbEta(config: BusLegConfig, stopId: string): Promise<EtaItem[]> {
  const serviceType = config.serviceType || "1";
  const url = `https://data.etabus.gov.hk/v1/transport/kmb/eta/${encodeURIComponent(stopId)}/${encodeURIComponent(config.route)}/${encodeURIComponent(serviceType)}`;
  const payload = await fetchJson<{ data: GenericEtaRecord[] }>(url);
  return normalize(payload.data, config.operator);
}

async function fetchCitybusEta(config: BusLegConfig, stopId: string): Promise<EtaItem[]> {
  const url = `https://rt.data.gov.hk/v2/transport/citybus/eta/CTB/${encodeURIComponent(stopId)}/${encodeURIComponent(config.route)}`;
  const payload = await fetchJson<{ data: GenericEtaRecord[] }>(url);
  return normalize(payload.data, "CTB");
}

async function fetchNlbEta(config: BusLegConfig, stopId: string): Promise<EtaItem[]> {
  const url = `https://rt.data.gov.hk/v2/transport/nlb/stop.php?action=estimatedArrivals&routeId=${encodeURIComponent(config.route)}&stopId=${encodeURIComponent(stopId)}&language=en`;
  const payload = await fetchJson<{ estimatedArrivals?: Array<{ estimatedArrivalTime?: string; remarks_en?: string }> }>(url);
  return normalize((payload.estimatedArrivals || []).map((item) => ({ eta: item.estimatedArrivalTime, remarks_en: item.remarks_en })), "NLB");
}

async function fetchStopEta(config: BusLegConfig, stopId: string): Promise<EtaItem[]> {
  if (config.operator === "KMB" || config.operator === "LWB") return fetchKmbEta(config, stopId);
  if (config.operator === "CTB") return fetchCitybusEta(config, stopId);
  if (config.operator === "NLB") return fetchNlbEta(config, stopId);
  return [];
}

function getConfiguredOperators(config: BusLegConfig): BusOperator[] {
  return config.operators && config.operators.length ? config.operators : config.operator ? [config.operator] : ["KMB"];
}

async function fetchOperatorEta(config: BusLegConfig, operator: BusOperator, stopId: string): Promise<EtaItem[]> {
  return fetchStopEta({ ...config, operator }, stopId);
}

export async function getBusEtas(config?: BusLegConfig): Promise<BusResult> {
  if (!config) {
    return { status: { health: "not_configured", message: "No bus leg configured." }, previousEtas: [], originEtas: [], destinationEtas: [] };
  }

  try {
    const operators = getConfiguredOperators(config);
    const originCalls = operators
      .map((operator) => ({ operator, stopId: config.originStopIds?.[operator] || config.originStopId }))
      .filter((item) => item.stopId);
    const destinationCalls = operators
      .map((operator) => ({ operator, stopId: config.destinationStopIds?.[operator] || config.destinationStopId }))
      .filter((item) => item.stopId);
    const previousCalls = (await Promise.all(operators.map((operator) => findPreviousStopCall(config, operator).catch(() => undefined))))
      .filter((item): item is { operator: BusOperator; stopId: string; name: string } => Boolean(item?.stopId));

    const [previousEtas, originEtas, destinationEtas] = await Promise.all([
      Promise.all(previousCalls.map((item) => fetchOperatorEta(config, item.operator, item.stopId))).then((items) => items.flat().sort((a, b) => a.minutes - b.minutes)),
      Promise.all(originCalls.map((item) => fetchOperatorEta(config, item.operator, item.stopId))).then((items) => items.flat().sort((a, b) => a.minutes - b.minutes)),
      Promise.all(destinationCalls.map((item) => fetchOperatorEta(config, item.operator, item.stopId))).then((items) => items.flat().sort((a, b) => a.minutes - b.minutes))
    ]);
    return {
      status: { health: "ok", updatedAt: new Date().toISOString() },
      previousStopName: previousCalls[0]?.name,
      previousEtas,
      originEtas,
      destinationEtas
    };
  } catch (error) {
    return {
      status: { health: "error", updatedAt: new Date().toISOString(), message: error instanceof Error ? error.message : "Bus ETA failed." },
      previousEtas: [],
      originEtas: [],
      destinationEtas: []
    };
  }
}

async function findPreviousStopCall(config: BusLegConfig, operator: BusOperator): Promise<{ operator: BusOperator; stopId: string; name: string } | undefined> {
  const originStopId = config.originStopIds?.[operator] || config.originStopId;
  if (!originStopId) return undefined;

  const operatorDirection = config.operatorDirections?.[operator] || config.direction;
  const stops =
    operator === "KMB" || operator === "LWB"
      ? await getKmbRouteStops(config.route, operatorDirection, config.serviceType)
      : operator === "CTB"
        ? await getCitybusRouteStops(config.route, operatorDirection)
        : [];
  const originIndex = stops.findIndex((stop) => stop.stopIds[operator] === originStopId);
  if (originIndex <= 0) return undefined;

  const previous = stops[originIndex - 1];
  const previousStopId = previous.stopIds[operator];
  return previousStopId ? { operator, stopId: previousStopId, name: previous.name } : undefined;
}

let kmbRoutesCache: KmbRouteRecord[] | undefined;
let citybusRoutesCache: CitybusRouteRecord[] | undefined;
let kmbStopsCache: Map<string, KmbStopRecord> | undefined;
const citybusStopCache = new Map<string, CitybusStopRecord>();

async function getKmbRoutes(): Promise<KmbRouteRecord[]> {
  if (!kmbRoutesCache) {
    const payload = await fetchJson<{ data: KmbRouteRecord[] }>("https://data.etabus.gov.hk/v1/transport/kmb/route/");
    kmbRoutesCache = payload.data;
  }
  return kmbRoutesCache;
}

async function getCitybusRoutes(): Promise<CitybusRouteRecord[]> {
  if (!citybusRoutesCache) {
    const payload = await fetchJson<{ data: CitybusRouteRecord[] }>("https://rt.data.gov.hk/v2/transport/citybus/route/ctb", 20000);
    citybusRoutesCache = payload.data;
  }
  return citybusRoutesCache;
}

async function getKmbStops(): Promise<Map<string, KmbStopRecord>> {
  if (!kmbStopsCache) {
    const payload = await fetchJson<{ data: KmbStopRecord[] }>("https://data.etabus.gov.hk/v1/transport/kmb/stop");
    kmbStopsCache = new Map(payload.data.map((stop) => [stop.stop, stop]));
  }
  return kmbStopsCache;
}

async function getCitybusStop(stopId: string): Promise<CitybusStopRecord | undefined> {
  if (!citybusStopCache.has(stopId)) {
    const payload = await fetchJson<{ data: CitybusStopRecord }>(`https://rt.data.gov.hk/v2/transport/citybus/stop/${encodeURIComponent(stopId)}`);
    citybusStopCache.set(stopId, payload.data);
  }
  return citybusStopCache.get(stopId);
}

function routeDirection(bound: "O" | "I"): "inbound" | "outbound" {
  return bound === "I" ? "inbound" : "outbound";
}

function normalizeName(value: string): string {
  return value
    .toUpperCase()
    .replace(/[(),.'-]/g, " ")
    .replace(/\bST\b/g, "STREET")
    .replace(/\bRD\b/g, "ROAD")
    .replace(/\bAVE\b/g, "AVENUE")
    .replace(/\bTER\b/g, "TERRACE")
    .replace(/\s+/g, " ")
    .trim();
}

function nameTokens(value: string): Set<string> {
  return new Set(normalizeName(value).split(" ").filter((token) => token.length > 2));
}

export function terminalNamesMatch(a: string, b: string): boolean {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 8 && right.includes(left)) return true;
  if (right.length >= 8 && left.includes(right)) return true;

  const leftTokens = nameTokens(left);
  const rightTokens = nameTokens(right);
  const smaller = Math.min(leftTokens.size, rightTokens.size);
  if (!smaller) return false;
  const overlap = Array.from(leftTokens).filter((token) => rightTokens.has(token)).length;
  return overlap / smaller >= 0.75;
}

function directionsMatch(choice: BusDirectionChoice, origin: string, destination: string): boolean {
  return terminalNamesMatch(choice.origin, origin) && terminalNamesMatch(choice.destination, destination);
}

export async function searchBusRoutes(query = ""): Promise<BusRouteChoice[]> {
  const term = query.trim().toUpperCase();
  const [kmbRoutes, citybusRoutes] = await Promise.all([getKmbRoutes(), getCitybusRoutes()]);
  const grouped = new Map<string, BusRouteChoice>();

  function add(route: string, operator: BusOperator) {
    if (term && !route.toUpperCase().startsWith(term)) return;
    const current = grouped.get(route) || { route, operators: [] };
    if (!current.operators.includes(operator)) current.operators.push(operator);
    grouped.set(route, current);
  }

  kmbRoutes.forEach((route) => add(route.route, "KMB"));
  citybusRoutes.forEach((route) => add(route.route, "CTB"));

  return Array.from(grouped.values())
    .sort((a, b) => a.route.localeCompare(b.route, undefined, { numeric: true }))
    .slice(0, 40);
}

export async function getBusDirections(route: string): Promise<BusDirectionChoice[]> {
  const routeUpper = route.toUpperCase();
  const [kmbRoutes, citybusRoutes] = await Promise.all([getKmbRoutes(), getCitybusRoutes()]);
  const grouped: BusDirectionChoice[] = [];

  function add(direction: "inbound" | "outbound", operator: BusOperator, origin: string, destination: string, serviceType?: string) {
    const current = grouped.find((choice) => directionsMatch(choice, origin, destination)) || { direction, operators: [], operatorDirections: {}, origin, destination, serviceType };
    if (!current.operators.includes(operator)) current.operators.push(operator);
    current.operatorDirections[operator] = direction;
    if (normalizeName(origin).length < normalizeName(current.origin).length) current.origin = origin;
    if (normalizeName(destination).length < normalizeName(current.destination).length) current.destination = destination;
    current.serviceType = current.serviceType || serviceType;
    if (!grouped.includes(current)) grouped.push(current);
  }

  kmbRoutes.filter((item) => item.route === routeUpper).forEach((item) => add(routeDirection(item.bound), "KMB", item.orig_en, item.dest_en, item.service_type));
  for (const direction of ["outbound", "inbound"] as const) {
    const stops = await getCitybusRouteStops(routeUpper, direction).catch(() => []);
    if (stops.length) {
      add(direction, "CTB", stops[0].name, stops[stops.length - 1].name);
    }
  }

  return grouped;
}

async function getKmbRouteStops(route: string, direction: "inbound" | "outbound", serviceType = "1"): Promise<BusStopChoice[]> {
  const bound = direction === "inbound" ? "inbound" : "outbound";
  const [payload, stops] = await Promise.all([
    fetchJson<{ data: KmbRouteStopRecord[] }>(`https://data.etabus.gov.hk/v1/transport/kmb/route-stop/${encodeURIComponent(route)}/${bound}/${encodeURIComponent(serviceType)}`),
    getKmbStops()
  ]);

  return payload.data.map((item) => {
    const stop = stops.get(item.stop);
    const name = stop?.name_en || item.stop;
    return {
      key: `KMB:${item.stop}`,
      name,
      operators: ["KMB"],
      stopIds: { KMB: item.stop },
      sequence: Number(item.seq)
    };
  });
}

async function getCitybusRouteStops(route: string, direction: "inbound" | "outbound"): Promise<BusStopChoice[]> {
  const dir = direction === "inbound" ? "inbound" : "outbound";
  const payload = await fetchJson<{ data: CitybusRouteStopRecord[] }>(`https://rt.data.gov.hk/v2/transport/citybus/route-stop/ctb/${encodeURIComponent(route)}/${dir}`, 20000);
  const stops = await Promise.all(payload.data.map(async (item) => ({ item, stop: await getCitybusStop(item.stop) })));

  return stops.map(({ item, stop }) => {
    const name = stop?.name_en || item.stop;
    return {
      key: `CTB:${item.stop}`,
      name,
      operators: ["CTB"],
      stopIds: { CTB: item.stop },
      sequence: Number(item.seq)
    };
  });
}

export async function getBusStops(
  route: string,
  direction: "inbound" | "outbound",
  operators: BusOperator[],
  serviceType?: string,
  operatorDirections: Partial<Record<BusOperator, "inbound" | "outbound">> = {}
): Promise<BusStopChoice[]> {
  const stopGroups = new Map<string, BusStopChoice>();
  const lists = await Promise.all(
    operators.map((operator) => {
      const operatorDirection = operatorDirections[operator] || direction;
      if (operator === "KMB" || operator === "LWB") return getKmbRouteStops(route, operatorDirection, serviceType);
      if (operator === "CTB") return getCitybusRouteStops(route, operatorDirection);
      return Promise.resolve([]);
    })
  );

  const shouldGroupBySequence = operators.length > 1;

  lists.flat().forEach((stop) => {
    const key = shouldGroupBySequence ? `SEQ-${stop.sequence}` : normalizeName(stop.name);
    const current = stopGroups.get(key) || { ...stop, operators: [], stopIds: {}, key };
    stop.operators.forEach((operator) => {
      if (!current.operators.includes(operator)) current.operators.push(operator);
      current.stopIds[operator] = stop.stopIds[operator];
    });
    current.sequence = Math.min(current.sequence, stop.sequence);
    stopGroups.set(key, current);
  });

  return Array.from(stopGroups.values()).sort((a, b) => a.sequence - b.sequence);
}
