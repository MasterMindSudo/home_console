import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { AlertTriangle, Bus, Clock, CloudRain, Droplets, Car as CarIcon, Gauge, Thermometer, TrainFront, Waves } from "lucide-react";
import { CarRouteEstimate, DashboardPayload, EtaItem, ModeWalkTimeConfig, PairedBusEta, TrafficCamera, TrafficSpeedNode } from "../../../shared/types";
import { cameraImageUrl, useCameraRefreshToken, useRotatingIndex } from "../lib/camera";
import { formatClock, formatMinutes, formatSpeedKph, formatUpdated } from "../lib/format";

interface Props {
  data: DashboardPayload;
}

function statusLabel(data: DashboardPayload): string {
  if (data.recommendation === "bus_ok") return "Bus still works";
  if (data.recommendation === "consider_alternative") return "Consider MTR, car, or cab";
  return "Waiting for reliable ETA";
}

function SourcePill({ health, updatedAt }: { health: string; updatedAt?: string }) {
  return <span className={`pill ${health}`}>{health.replace("_", " ")} · {formatUpdated(updatedAt)}</span>;
}

function confidenceLabel(confidence?: string): string {
  if (confidence === "exact") return "same vehicle/run";
  if (confidence === "operator_order") return "same operator/order estimate";
  if (confidence === "approximate") return "approximate estimate";
  return "unavailable";
}

function addMinutes(iso: string | undefined, minutes = 0): string | undefined {
  if (!iso) return undefined;
  return new Date(new Date(iso).getTime() + minutes * 60000).toISOString();
}

function subtractMinutes(iso: string | undefined, minutes = 0): string | undefined {
  if (!iso) return undefined;
  return new Date(new Date(iso).getTime() - minutes * 60000).toISOString();
}

function latestArrivalIso(latestArrivalTime: string, generatedAt: string): string {
  const now = new Date(generatedAt);
  const hongKongNow = new Date(now.getTime() + 8 * 60 * 60000);
  const [hour, minute] = latestArrivalTime.split(":").map(Number);
  const year = hongKongNow.getUTCFullYear();
  const month = String(hongKongNow.getUTCMonth() + 1).padStart(2, "0");
  const day = String(hongKongNow.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`;
}

function bufferMinutes(finalArrivalIso: string | undefined, latestArrivalTime: string, generatedAt: string): number | undefined {
  if (!finalArrivalIso) return undefined;
  return Math.floor((new Date(latestArrivalIso(latestArrivalTime, generatedAt)).getTime() - new Date(finalArrivalIso).getTime()) / 60000);
}

function timeUntil(iso: string | undefined, generatedAt: string): number | undefined {
  if (!iso) return undefined;
  return Math.floor((new Date(iso).getTime() - new Date(generatedAt).getTime()) / 60000);
}

function formatSignedMinutes(minutes: number | undefined): string {
  if (typeof minutes !== "number") return "--";
  if (minutes > 0) return `+${minutes} min`;
  if (minutes === 0) return "0 min";
  return `${minutes} min`;
}

function baselineLabel(pair?: PairedBusEta): string {
  if (!pair?.baseline) return "Normal --";
  const delta = pair.baseline.deltaMinutes;
  if (typeof delta !== "number") return `Normal ${pair.baseline.targetTravelMinutes} min`;
  const suffix = pair.baseline.status === "faster"
    ? "faster"
    : pair.baseline.status === "normal"
      ? "normal"
      : pair.baseline.status === "delayed"
        ? "delay"
        : "slow";
  return `Normal ${pair.baseline.targetTravelMinutes} min · ${formatSignedMinutes(delta)} ${suffix}`;
}

function leaveByLabel(leaveByIso: string | undefined, generatedAt: string): string {
  const minutes = timeUntil(leaveByIso, generatedAt);
  if (typeof minutes !== "number") return "Leave by --";
  if (minutes <= 0) return "Leave now";
  return `Leave by ${formatClock(leaveByIso)}`;
}

function walkSummary(walk?: ModeWalkTimeConfig): string {
  const toStart = walk?.toStartMinutes || 0;
  const fromDestination = walk?.fromDestinationMinutes || 0;
  return `${toStart}m to start · ${fromDestination}m after`;
}

function findPreviousEta(origin: EtaItem | undefined, previousEtas: EtaItem[]): EtaItem | undefined {
  if (!origin) return undefined;
  const sameOperator = previousEtas.filter((eta) => eta.operator === origin.operator && eta.minutes <= origin.minutes);
  return (
    sameOperator.find((eta) => eta.runId && origin.runId && eta.runId === origin.runId) ||
    sameOperator.find((eta) => eta.etaSequence && origin.etaSequence && eta.etaSequence === origin.etaSequence) ||
    sameOperator[0]
  );
}

function JourneyLane({
  icon,
  title,
  status,
  previousMinutes,
  previousLabel,
  startMinutes,
  startLabel,
  endMinutes,
  endLabel,
  markers = 10,
  message,
  extra,
  className = ""
}: {
  icon: ReactNode;
  title: string;
  status: ReactNode;
  previousMinutes?: number;
  previousLabel?: string;
  startMinutes?: number;
  startLabel?: string;
  endMinutes?: number;
  endLabel: string;
  markers?: number;
  message?: string;
  extra?: ReactNode;
  className?: string;
}) {
  return (
    <article className={`journey-lane ${className}`}>
      <div className="lane-head">
        <div className="metric-title">{icon}{title}</div>
        {status}
      </div>
      <div className={`lane-body ${previousLabel ? "with-previous" : ""}`}>
        {previousLabel && (
          <div className="lane-time previous">
            <strong>{formatMinutes(previousMinutes)}</strong>
            <span>{previousLabel}</span>
          </div>
        )}
        <div className="lane-time start">
          <strong>{formatMinutes(startMinutes)}</strong>
          <span>{startLabel || "from now"}</span>
        </div>
        <div className="lane-track">
          {Array.from({ length: markers }).map((_, index) => (
            <span key={index} className={index === 0 || index === markers - 1 ? "major" : ""} />
          ))}
        </div>
        <div className="lane-time end">
          <strong>{formatMinutes(endMinutes)}</strong>
          <span>{endLabel}</span>
        </div>
      </div>
      {message && <p className="muted lane-message">{message}</p>}
      {extra}
    </article>
  );
}

function BusEtaStack({ pairs }: { pairs: PairedBusEta[] }) {
  const visiblePairs = pairs.slice(0, 2);
  if (!visiblePairs.length) return null;

  return (
    <div className="bus-eta-stack" aria-label="Next two bus arrivals">
      {visiblePairs.map((pair, index) => {
        const rideMinutes =
          typeof pair.destination?.minutes === "number" && typeof pair.origin?.minutes === "number"
            ? Math.max(0, pair.destination.minutes - pair.origin.minutes)
            : undefined;

        return (
          <article key={`${pair.origin?.eta || "origin"}-${pair.destination?.eta || "destination"}-${index}`} className={`bus-eta-card ${pair.arrivalStatus} ${pair.baseline?.status || ""}`}>
            <span className="bus-eta-index">#{index + 1}</span>
            <div className="bus-eta-main">
              <strong>{formatMinutes(pair.origin?.minutes)} · {formatClock(pair.origin?.eta)}</strong>
              <span>{pair.origin?.operator || "Bus"} · {confidenceLabel(pair.confidence)}</span>
              <small>{baselineLabel(pair)}</small>
            </div>
            <div className="bus-eta-destination">
              <strong>{formatClock(pair.projectedArrival)}</strong>
              <span>{formatMinutes(rideMinutes)} ride</span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ModeTimingHint({
  leaveBy,
  finalArrival,
  buffer,
  walk,
  baseline,
  generatedAt
}: {
  leaveBy?: string;
  finalArrival?: string;
  buffer?: number;
  walk?: ModeWalkTimeConfig;
  baseline?: ReactNode;
  generatedAt: string;
}) {
  return (
    <div className="mode-timing-hint">
      <span>{leaveByLabel(leaveBy, generatedAt)}</span>
      <span>Door arrival {formatClock(finalArrival)}</span>
      <strong className={(buffer ?? 0) < 0 ? "late" : "on_time"}>{formatSignedMinutes(buffer)} buffer</strong>
      <small>{baseline || walkSummary(walk)}</small>
    </div>
  );
}

function WeatherPane({ data }: { data: DashboardPayload }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const hours = data.weather.hours;
  const currentIndex = useMemo(() => {
    const now = new Date(data.generatedAt).getTime();
    const nextIndex = hours.findIndex((hour) => new Date(hour.time).getTime() > now);
    return Math.max(0, nextIndex === -1 ? hours.length - 1 : nextIndex - 1);
  }, [data.generatedAt, hours]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !hours.length) return;
    const currentCard = container.querySelector<HTMLElement>("[data-current-hour='true']");
    container.scrollLeft = currentCard?.offsetLeft || currentIndex * 132;
  }, [currentIndex, hours.length]);

  return (
    <section className="weather-pane">
      <div className="weather-head">
        <div className="metric-title"><CloudRain /> Today's weather</div>
        <SourcePill health={data.weather.status.health} updatedAt={data.weather.status.updatedAt} />
      </div>
      {hours.length ? (
        <div className="weather-hours" ref={scrollRef}>
          {hours.map((hour, index) => (
            <article key={hour.time} className={index === currentIndex ? "weather-hour current" : "weather-hour"} data-current-hour={index === currentIndex ? "true" : undefined}>
              <strong>{formatClock(hour.time)}</strong>
              <span><Thermometer size={15} /> {hour.temperatureC}C</span>
              <span><Droplets size={15} /> {hour.humidityPercent}%</span>
              <span><CloudRain size={15} /> {hour.precipitationMm} mm</span>
            </article>
          ))}
        </div>
      ) : (
        <p className="muted">{data.weather.status.message || "Weather forecast unavailable."}</p>
      )}
    </section>
  );
}

function CarLane({ data }: { data: DashboardPayload }) {
  const fastest = data.car.fastest;
  const tollFree = data.car.tollFree;
  const delta = typeof data.car.tollFreeDeltaMinutes === "number" && data.car.tollFreeDeltaMinutes > 0
    ? `+${data.car.tollFreeDeltaMinutes} min`
    : "same time";

  return (
    <article className="journey-lane car-compare">
      <div className="lane-head">
        <div className="metric-title"><CarIcon />By car</div>
        <SourcePill health={data.car.status.health} updatedAt={data.car.status.updatedAt} />
      </div>
      <div className="car-route-grid">
        <CarRouteRow
          title="Fastest"
          subtitle={fastest?.usesToll ? "Uses toll" : "No toll flagged"}
          route={fastest}
          fallbackMinutes={data.car.travelMinutes}
          fallbackArrival={data.car.arrivalTime}
          profile={data}
        />
        <CarRouteRow
          title={tollFree?.usesToll ? "Less toll" : "Toll-free"}
          subtitle={tollFree ? delta : "Not available"}
          route={tollFree}
          profile={data}
        />
      </div>
      {data.car.status.message && <p className="muted lane-message">{data.car.status.message}</p>}
    </article>
  );
}

function nodeSummary(nodes: TrafficSpeedNode[] = []): { min?: number; avg?: number; max?: number } {
  const minValues = nodes.map((node) => node.minSpeedKph).filter((value): value is number => typeof value === "number");
  const avgValues = nodes.map((node) => node.averageSpeedKph).filter((value): value is number => typeof value === "number");
  const maxValues = nodes.map((node) => node.maxSpeedKph).filter((value): value is number => typeof value === "number");
  return {
    min: minValues.length ? Math.min(...minValues) : undefined,
    avg: avgValues.length ? avgValues.reduce((sum, value) => sum + value, 0) / avgValues.length : undefined,
    max: maxValues.length ? Math.max(...maxValues) : undefined
  };
}

function CarSpeedTrack({ nodes = [] }: { nodes?: TrafficSpeedNode[] }) {
  const displayNodes = nodes.slice(0, 8);
  const summary = nodeSummary(displayNodes);
  if (!displayNodes.length) {
    return <div className="car-speed-empty">No matched speed nodes</div>;
  }

  return (
    <div className="car-speed-track-wrap">
      <div className="car-speed-track" aria-hidden="true">
        {displayNodes.map((node, index) => (
          <span key={`${node.roadName}-${index}`} className={`car-speed-node ${node.status}`} title={`${node.roadName}: avg ${formatSpeedKph(node.averageSpeedKph)}`} />
        ))}
      </div>
      <span className="car-speed-summary">
        Min {formatSpeedKph(summary.min)} · Avg {formatSpeedKph(summary.avg)} · Max {formatSpeedKph(summary.max)}
      </span>
    </div>
  );
}

function CarRouteRow({
  title,
  subtitle,
  route,
  fallbackMinutes,
  fallbackArrival,
  profile
}: {
  title: string;
  subtitle: string;
  route?: CarRouteEstimate;
  fallbackMinutes?: number;
  fallbackArrival?: string;
  profile: DashboardPayload;
}) {
  const walk = profile.profile.walkTimes?.car;
  const arrival = route?.arrivalTime || fallbackArrival;
  const finalArrival = addMinutes(arrival, walk?.fromDestinationMinutes || 0);
  const travelMinutes = route?.travelMinutes || fallbackMinutes;
  const leaveBy = typeof travelMinutes === "number"
    ? subtractMinutes(latestArrivalIso(profile.profile.latestArrivalTime, profile.generatedAt), travelMinutes + (walk?.toStartMinutes || 0) + (walk?.fromDestinationMinutes || 0))
    : undefined;
  const buffer = bufferMinutes(finalArrival, profile.profile.latestArrivalTime, profile.generatedAt);

  return (
    <div className="car-route-row with-speed-track">
      <div className="car-route-meta">
        <strong>{title}</strong>
        <span>{subtitle}</span>
        <small>{leaveByLabel(leaveBy, profile.generatedAt)} · {formatSignedMinutes(buffer)} buffer</small>
      </div>
      <CarSpeedTrack nodes={route?.speedNodes} />
      <b>{formatMinutes(travelMinutes)}</b>
      <span>{formatClock(finalArrival)}</span>
    </div>
  );
}

function TrafficFlowPane({ data }: { data: DashboardPayload }) {
  const cameraToken = useCameraRefreshToken();
  const cameras = useMemo(
    () => data.trafficFlow.roads.flatMap((road) =>
      (road.cameras || []).map((camera): TrafficCamera => ({ ...camera, roadName: camera.roadName || road.roadName }))
    ),
    [data.trafficFlow.roads]
  );
  const featuredCamera = cameras[useRotatingIndex(cameras.length)];

  return (
    <aside className="traffic-panel flow-board">
      <div className="traffic-flow-head">
        <div className="metric-title"><Waves /> Traffic flow</div>
        <SourcePill health={data.trafficFlow.status.health} updatedAt={data.trafficFlow.status.updatedAt} />
      </div>
      {data.trafficFlow.roads.length ? (
        <>
          <div className="traffic-flow-grid compact-speed-grid">
            {data.trafficFlow.roads.map((road) => (
              <article key={road.roadName} className={`traffic-flow-card ${road.status} ${road.cameraOnly ? "camera-only" : ""}`}>
                <div>
                  <strong>{road.roadName}</strong>
                  <span>
                    {road.cameraOnly
                      ? "camera only"
                      : `${road.validSegmentCount} live - ${road.invalidSegmentCount} stale`}
                    {road.cameras?.length ? ` - ${road.cameras.length} cam` : ""}
                  </span>
                </div>
                {!road.cameraOnly && (
                  <>
                    <b><Gauge size={18} /> {formatSpeedKph(road.representativeSpeedKph)}</b>
                    <small>Slowest {formatSpeedKph(road.slowestSpeedKph)} · Max {formatSpeedKph(road.maxSpeedKph)}</small>
                  </>
                )}
              </article>
            ))}
          </div>
          {featuredCamera && (
            <figure className="featured-traffic-camera">
              <img src={cameraImageUrl(featuredCamera.imageUrl, cameraToken)} alt={featuredCamera.description} />
              <figcaption>
                <strong>{featuredCamera.roadName || "Traffic camera"}</strong>
                <span>{featuredCamera.description}</span>
              </figcaption>
            </figure>
          )}
        </>
      ) : (
        <div className="traffic-flow-empty">
          <p>{data.trafficFlow.status.message || "No matching HK speed segments for this TomTom route."}</p>
        </div>
      )}
    </aside>
  );
}

export function Dashboard({ data }: Props) {
  const firstBus = data.bus.pairs[0];
  const previousBus = findPreviousEta(firstBus?.origin, data.bus.previousEtas);
  const previousLabel = previousBus
    ? `${formatClock(previousBus.eta)} prev stop`
    : firstBus?.origin
      ? "departed prev stop"
      : undefined;
  const busTravelMinutes =
    typeof firstBus?.destination?.minutes === "number" && typeof firstBus?.origin?.minutes === "number"
      ? Math.max(0, firstBus.destination.minutes - firstBus.origin.minutes)
      : undefined;
  const busWalk = data.profile.walkTimes?.bus;
  const mtrWalk = data.profile.walkTimes?.mtr;
  const busFinalArrival = addMinutes(firstBus?.projectedArrival, busWalk?.fromDestinationMinutes || 0);
  const busLeaveBy = subtractMinutes(firstBus?.origin?.eta, busWalk?.toStartMinutes || 0);
  const busBuffer = bufferMinutes(busFinalArrival, data.profile.latestArrivalTime, data.generatedAt);
  const mtrFinalArrival = addMinutes(data.mtr.arrivalTime, mtrWalk?.fromDestinationMinutes || 0);
  const mtrStartTrainIso = typeof data.mtr.nextTrainMinutes === "number"
    ? addMinutes(data.generatedAt, data.mtr.nextTrainMinutes)
    : undefined;
  const mtrLeaveBy = subtractMinutes(mtrStartTrainIso, mtrWalk?.toStartMinutes || 0);
  const mtrBuffer = bufferMinutes(mtrFinalArrival, data.profile.latestArrivalTime, data.generatedAt);

  return (
    <main className="dashboard">
      <section className={`hero-state compact ${data.recommendation}`}>
        <div>
          <p className="eyebrow">{data.profile.name}</p>
          <h1>{statusLabel(data)}</h1>
          <p>Latest arrival target: {data.profile.latestArrivalTime}</p>
        </div>
        <div className="hero-time">
          <Clock size={28} />
          <span>{formatClock(data.generatedAt)}</span>
        </div>
      </section>

      <WeatherPane data={data} />

      <section className="journey-board">
        <div className="journey-main">
          <JourneyLane
            icon={<Bus />}
            title={`Bus ${data.profile.bus?.route || ""}`}
            status={<SourcePill health={data.bus.status.health} updatedAt={data.bus.status.updatedAt} />}
            className="bus-lane"
            previousMinutes={previousBus?.minutes}
            previousLabel={previousLabel}
            startMinutes={firstBus?.origin?.minutes}
            startLabel={formatClock(firstBus?.origin?.eta)}
            endMinutes={busTravelMinutes}
            endLabel={`ride · arrive ${formatClock(firstBus?.projectedArrival)}`}
            markers={12}
            message={`${data.profile.bus?.originStopName || "Origin stop"} to ${data.profile.bus?.destinationStopName || "destination stop"} · ${confidenceLabel(firstBus?.confidence)}`}
            extra={
              <>
                <ModeTimingHint leaveBy={busLeaveBy} finalArrival={busFinalArrival} buffer={busBuffer} walk={busWalk} baseline={baselineLabel(firstBus)} generatedAt={data.generatedAt} />
                <BusEtaStack pairs={data.bus.pairs} />
              </>
            }
          />
          <JourneyLane
            icon={<TrainFront />}
            title="MTR"
            status={<SourcePill health={data.mtr.status.health} updatedAt={data.mtr.status.updatedAt} />}
            startMinutes={data.mtr.nextTrainMinutes}
            endMinutes={data.mtr.averageRideMinutes}
            endLabel={`ride · arrive ${formatClock(data.mtr.arrivalTime)}`}
            markers={8}
            message="Next train plus configured average ride/interchange time, excluding walking"
            extra={<ModeTimingHint leaveBy={mtrLeaveBy} finalArrival={mtrFinalArrival} buffer={mtrBuffer} walk={mtrWalk} generatedAt={data.generatedAt} />}
          />
          <CarLane data={data} />
        </div>

        <TrafficFlowPane data={data} />
      </section>

      <section className="board">
        <div className="section-heading">
          <h2>Upcoming bus pairings</h2>
          {data.bus.status.health === "error" && <span className="error-inline"><AlertTriangle size={16} /> {data.bus.status.message}</span>}
        </div>
        <div className="eta-table">
          <span>Origin</span><span>Destination</span><span>Status</span>
          {data.bus.pairs.slice(0, 4).map((pair, index) => (
            <>
              <strong key={`o-${index}`}>{formatMinutes(pair.origin?.minutes)} · {formatClock(pair.origin?.eta)}</strong>
              <strong key={`d-${index}`}>{formatClock(pair.projectedArrival)}</strong>
              <span key={`s-${index}`} className={`arrival ${pair.arrivalStatus}`}>{pair.arrivalStatus.replace("_", " ")}</span>
            </>
          ))}
        </div>
      </section>
    </main>
  );
}
