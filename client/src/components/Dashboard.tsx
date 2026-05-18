import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { AlertTriangle, Bus, Clock, CloudRain, Droplets, Car as CarIcon, Gauge, Thermometer, TrainFront, Waves } from "lucide-react";
import { DashboardPayload, EtaItem, TrafficCamera } from "../../../shared/types";
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
  message
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
}) {
  return (
    <article className="journey-lane">
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
    </article>
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
        <div className="car-route-row">
          <div>
            <strong>Fastest</strong>
            <span>{fastest?.usesToll ? "Uses toll" : "No toll flagged"}</span>
          </div>
          <b>{formatMinutes(fastest?.travelMinutes || data.car.travelMinutes)}</b>
          <span>{formatClock(fastest?.arrivalTime || data.car.arrivalTime)}</span>
        </div>
        <div className="car-route-row">
          <div>
            <strong>{tollFree?.usesToll ? "Less toll" : "Toll-free"}</strong>
            <span>{tollFree ? delta : "Not available"}</span>
          </div>
          <b>{formatMinutes(tollFree?.travelMinutes)}</b>
          <span>{formatClock(tollFree?.arrivalTime)}</span>
        </div>
      </div>
      {data.car.status.message && <p className="muted lane-message">{data.car.status.message}</p>}
    </article>
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
                    <small>Slowest {formatSpeedKph(road.slowestSpeedKph)}</small>
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
            previousMinutes={previousBus?.minutes}
            previousLabel={previousLabel}
            startMinutes={firstBus?.origin?.minutes}
            startLabel={formatClock(firstBus?.origin?.eta)}
            endMinutes={busTravelMinutes}
            endLabel={`ride · arrive ${formatClock(firstBus?.projectedArrival)}`}
            markers={12}
            message={`${data.profile.bus?.originStopName || "Origin stop"} to ${data.profile.bus?.destinationStopName || "destination stop"} · ${confidenceLabel(firstBus?.confidence)}`}
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
