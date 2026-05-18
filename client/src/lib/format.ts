export function formatClock(iso?: string): string {
  if (!iso) return "--";
  return new Intl.DateTimeFormat("en-HK", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

export function formatMinutes(minutes?: number): string {
  if (typeof minutes !== "number") return "--";
  if (minutes <= 0) return "Due";
  return `${minutes} min`;
}

export function formatUpdated(iso?: string): string {
  if (!iso) return "Not updated";
  return `Updated ${formatClock(iso)}`;
}

export function formatSpeedKph(value?: number): string {
  return typeof value === "number" ? `${Math.round(value)} km/h` : "--";
}
