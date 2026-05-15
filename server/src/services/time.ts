import { EtaItem, PairedBusEta } from "../../../shared/types";

export function minutesUntil(iso: string, now = new Date()): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - now.getTime()) / 60000));
}

export function minutesToArrival(minutes: number, now = new Date()): string {
  return new Date(now.getTime() + minutes * 60000).toISOString();
}

export function latestArrivalToday(latestArrivalTime: string, now = new Date()): Date {
  const [hour, minute] = latestArrivalTime.split(":").map(Number);
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  return target;
}

export function classifyArrival(arrivalIso: string | undefined, latestArrivalTime: string, now = new Date()): "on_time" | "late" | "unknown" {
  if (!arrivalIso) return "unknown";
  return new Date(arrivalIso).getTime() <= latestArrivalToday(latestArrivalTime, now).getTime() ? "on_time" : "late";
}

export function pairBusEtas(originEtas: EtaItem[], destinationEtas: EtaItem[], latestArrivalTime: string): PairedBusEta[] {
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
    const destination =
      sameOperatorDestinations.find((eta) => eta.runId && origin.runId && eta.runId === origin.runId) ||
      sameOperatorDestinations.find((eta) => eta.etaSequence && origin.etaSequence && eta.etaSequence === origin.etaSequence && eta.minutes >= origin.minutes) ||
      sameOperatorDestinations.slice(nextIndex).find((eta) => eta.minutes >= origin.minutes);
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
