import { BusDirectionChoice, BusRouteChoice, BusStopChoice, CommuteProfile, DashboardPayload, MtrLineChoice, MtrSegmentConfig, MtrStationChoice, ProfileInput } from "../../../shared/types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || response.statusText);
  }
  return response.json() as Promise<T>;
}

export const api = {
  listProfiles: () => request<CommuteProfile[]>("/api/profiles"),
  searchBusRoutes: (query: string) => request<BusRouteChoice[]>(`/api/bus/routes?query=${encodeURIComponent(query)}`),
  busDirections: (route: string) => request<BusDirectionChoice[]>(`/api/bus/routes/${encodeURIComponent(route)}/directions`),
  busStops: (route: string, direction: string, operators: string[], serviceType?: string, operatorDirections?: Record<string, string>) => {
    const directionParam = Object.entries(operatorDirections || {}).map(([operator, value]) => `${operator}:${value}`).join(",");
    return request<BusStopChoice[]>(`/api/bus/routes/${encodeURIComponent(route)}/directions/${encodeURIComponent(direction)}/stops?operators=${encodeURIComponent(operators.join(","))}&serviceType=${encodeURIComponent(serviceType || "1")}&operatorDirections=${encodeURIComponent(directionParam)}`);
  },
  mtrLines: () => request<MtrLineChoice[]>("/api/mtr/lines"),
  allMtrStations: () => request<MtrStationChoice[]>("/api/mtr/stations"),
  mtrStations: (line: string) => request<MtrStationChoice[]>(`/api/mtr/lines/${encodeURIComponent(line)}/stations`),
  mtrTrip: (start: string, end: string) => request<MtrSegmentConfig>(`/api/mtr/trip?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`),
  createProfile: (input: ProfileInput) => request<CommuteProfile>("/api/profiles", { method: "POST", body: JSON.stringify(input) }),
  updateProfile: (id: string, input: ProfileInput) => request<CommuteProfile>(`/api/profiles/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  deleteProfile: async (id: string) => {
    const response = await fetch(`/api/profiles/${id}`, { method: "DELETE" });
    if (!response.ok) throw new Error(response.statusText);
  },
  dashboard: (profileId: string) => request<DashboardPayload>(`/api/dashboard/${profileId}`)
};
