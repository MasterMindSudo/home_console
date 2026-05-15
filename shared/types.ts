export type BusOperator = "KMB" | "LWB" | "CTB" | "NLB";

export type DataHealth = "ok" | "stale" | "error" | "not_configured";

export interface Coordinate {
  lat: number;
  lng: number;
}

export interface BusLegConfig {
  operator?: BusOperator;
  operators?: BusOperator[];
  route: string;
  direction: "inbound" | "outbound";
  operatorDirections?: Partial<Record<BusOperator, "inbound" | "outbound">>;
  serviceType?: string;
  originStopId: string;
  originStopName?: string;
  originStopIds?: Partial<Record<BusOperator, string>>;
  destinationStopId: string;
  destinationStopName?: string;
  destinationStopIds?: Partial<Record<BusOperator, string>>;
}

export interface BusRouteChoice {
  route: string;
  operators: BusOperator[];
}

export interface BusDirectionChoice {
  direction: "inbound" | "outbound";
  operators: BusOperator[];
  operatorDirections: Partial<Record<BusOperator, "inbound" | "outbound">>;
  origin: string;
  destination: string;
  serviceType?: string;
}

export interface BusStopChoice {
  key: string;
  name: string;
  operators: BusOperator[];
  stopIds: Partial<Record<BusOperator, string>>;
  sequence: number;
}

export interface MtrSegmentConfig {
  line: string;
  station: string;
  direction: "UP" | "DOWN";
  averageRideMinutes: number;
  startStationCode?: string;
  startStationName?: string;
  endStationCode?: string;
  endStationName?: string;
  routeSummary?: string;
}

export interface MtrLineChoice {
  line: string;
}

export interface MtrStationChoice {
  code: string;
  name: string;
  lines: string[];
}

export interface CarConfig {
  origin: Coordinate;
  destination: Coordinate;
}

export interface CommuteProfile {
  id: string;
  name: string;
  latestArrivalTime: string;
  bus?: BusLegConfig;
  mtr?: MtrSegmentConfig;
  car?: CarConfig;
  tunnelIndicatorId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EtaItem {
  eta: string;
  minutes: number;
  operator?: BusOperator;
  etaSequence?: number;
  runId?: string;
  remark?: string;
  destination?: string;
}

export interface PairedBusEta {
  origin?: EtaItem;
  destination?: EtaItem;
  projectedArrival?: string;
  arrivalStatus: "on_time" | "late" | "unknown";
  confidence: "exact" | "operator_order" | "approximate" | "unavailable";
}

export interface SourceStatus {
  health: DataHealth;
  updatedAt?: string;
  message?: string;
}

export interface DashboardPayload {
  profile: CommuteProfile;
  generatedAt: string;
  recommendation: "bus_ok" | "consider_alternative" | "unknown";
  bus: {
    status: SourceStatus;
    originEtas: EtaItem[];
    destinationEtas: EtaItem[];
    pairs: PairedBusEta[];
  };
  mtr: {
    status: SourceStatus;
    nextTrainMinutes?: number;
    averageRideMinutes?: number;
    totalMinutes?: number;
    arrivalTime?: string;
  };
  car: {
    status: SourceStatus;
    travelMinutes?: number;
    arrivalTime?: string;
  };
  tunnel: {
    status: SourceStatus;
    minutes?: number;
    trafficStatus?: string;
    indicatorName?: string;
  };
}

export interface ProfileInput {
  name: string;
  latestArrivalTime: string;
  bus?: BusLegConfig;
  mtr?: MtrSegmentConfig;
  car?: CarConfig;
  tunnelIndicatorId?: string;
}
