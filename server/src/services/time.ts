import { EtaItem, PairedBusEta } from "../../../shared/types";
import { BusPairingProfile } from "./gtfsHeadway";

const MIN_ORDER_MATCH_TRAVEL_MINUTES = 30;
const DEFAULT_PAIRING_PROFILE: BusPairingProfile = {
  minTravelMinutes: MIN_ORDER_MATCH_TRAVEL_MINUTES,
  targetTravelMinutes: 35,
  maxTravelMinutes: 75,
  source: "default"
};

function hasExplicitTimezone(value: string): boolean {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
}

export function parseApiDate(value: string): Date {
  if (hasExplicitTimezone(value)) return new Date(value);
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  return new Date(`${normalized}+08:00`);
}

export function minutesUntil(iso: string, now = new Date()): number {
  return Math.max(0, Math.round((parseApiDate(iso).getTime() - now.getTime()) / 60000));
}

export function minutesToArrival(minutes: number, now = new Date()): string {
  return new Date(now.getTime() + minutes * 60000).toISOString();
}

export function latestArrivalToday(latestArrivalTime: string, now = new Date()): Date {
  const [hour, minute] = latestArrivalTime.split(":").map(Number);
  const hongKongNow = new Date(now.getTime() + 8 * 60 * 60000);
  const year = hongKongNow.getUTCFullYear();
  const month = String(hongKongNow.getUTCMonth() + 1).padStart(2, "0");
  const day = String(hongKongNow.getUTCDate()).padStart(2, "0");
  return new Date(`${year}-${month}-${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`);
}

export function classifyArrival(arrivalIso: string | undefined, latestArrivalTime: string, now = new Date()): "on_time" | "late" | "unknown" {
  if (!arrivalIso) return "unknown";
  return parseApiDate(arrivalIso).getTime() <= latestArrivalToday(latestArrivalTime, now).getTime() ? "on_time" : "late";
}

function scoreDestination(origin: EtaItem, destination: EtaItem, profile: BusPairingProfile): number {
  const delta = destination.minutes - origin.minutes;
  const targetDistance = Math.abs(delta - profile.targetTravelMinutes);
  const sequencePenalty = origin.etaSequence && destination.etaSequence && origin.etaSequence !== destination.etaSequence ? 3 : 0;
  return targetDistance + sequencePenalty;
}

export function pairBusEtas(originEtas: EtaItem[], destinationEtas: EtaItem[], latestArrivalTime: string, pairingProfile?: BusPairingProfile): PairedBusEta[] {
  const profile = pairingProfile || DEFAULT_PAIRING_PROFILE;
  const destinationByOperator = new Map<string, EtaItem[]>();
  destinationEtas.forEach((eta) => {
    const operator = eta.operator || "unknown";
    const current = destinationByOperator.get(operator) || [];
    current.push(eta);
    destinationByOperator.set(operator, current.sort((a, b) => a.minutes - b.minutes));
  });

  const originOrderByOperator = new Map<string, number>();
  const pairs = originEtas.map((origin) => {
    const operator = origin.operator || "unknown";
    const nextIndex = originOrderByOperator.get(operator) || 0;
    originOrderByOperator.set(operator, nextIndex + 1);
    const sameOperatorDestinations = destinationByOperator.get(operator) || [];
    const isPlausibleDownstreamTime = (eta: EtaItem) => {
      const delta = eta.minutes - origin.minutes;
      return delta >= profile.minTravelMinutes && delta <= profile.maxTravelMinutes;
    };
    const bestPlausibleDestination = sameOperatorDestinations
      .filter(isPlausibleDownstreamTime)
      .sort((a, b) => scoreDestination(origin, a, profile) - scoreDestination(origin, b, profile))[0];
    const destination =
      sameOperatorDestinations.find((eta) => eta.runId && origin.runId && eta.runId === origin.runId) ||
      sameOperatorDestinations.find((eta) => eta.etaSequence && origin.etaSequence && eta.etaSequence === origin.etaSequence && isPlausibleDownstreamTime(eta)) ||
      sameOperatorDestinations.slice(nextIndex).find(isPlausibleDownstreamTime) ||
      bestPlausibleDestination;
    const projectedArrival = destination?.eta;
    const confidence = destination?.runId && origin.runId && destination.runId === origin.runId
      ? "exact"
      : destination
        ? "operator_order"
        : "unavailable";
    return {
      origin,
      destination,
      projectedArrival,
      arrivalStatus: classifyArrival(projectedArrival, latestArrivalTime),
      confidence
    } as PairedBusEta;
  });

  return pairs;
}
