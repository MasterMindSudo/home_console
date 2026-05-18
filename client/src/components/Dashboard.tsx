import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { AlertTriangle, Bus, Clock, CloudRain, Droplets, Car as CarIcon, Thermometer, TrainFront, Waves } from "lucide-react";
import { DashboardPayload, EtaItem, WeatherHour } from "../../../shared/types";
import { formatClock, formatMinutes, formatUpdated } from "../lib/format";

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

function normalizePoint(value: number, min: number, max: number, top: number, bottom: number): number {
  if (max <= min) return (top + bottom) / 2;
  return bottom - ((value - min) / (max - min)) * (bottom - top);
}

function chartPoints(hours: WeatherHour[], getValue: (hour: WeatherHour) => number, min: number, max: number): string {
  const top = 24;
  const bottom = 118;
  const xStart = 36;
  const xStep = 72;
  return hours.map((hour, index) => `${xStart + index * xStep},${normalizePoint(getValue(hour), min, max, top, bottom)}`).join(" ");
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
  return (
    <section className="weather-pane">
      <div className="weather-head">
        <div className="metric-title"><CloudRain /> Today's weather</div>
        <SourcePill health={data.weather.status.health} updatedAt={data.weather.status.updatedAt} />
      </div>
      {data.weather.hours.length ? (
        <div className="weather-hours">
          {data.weather.hours.map((hour) => (
            <article key={hour.time} className="weather-hour">
              <strong>{formatClock(hour.time)}</strong>
              <span><Thermometer size={15} /> {hour.temperatureC}°C</span>
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

function WeatherChartPane({ data }: { data: DashboardPayload }) {
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
    container.scrollLeft = Math.max(0, currentIndex * 72 - container.clientWidth * 0.28);
  }, [currentIndex, hours.length]);

  const chart = useMemo(() => {
    if (!hours.length) return undefined;
    const temps = hours.map((hour) => hour.temperatureC);
    const humidity = hours.map((hour) => hour.humidityPercent);
    const precipitation = hours.map((hour) => hour.precipitationMm);
    const width = 72 * Math.max(hours.length - 1, 1) + 72;
    return {
      width,
      tempPoints: chartPoints(hours, (hour) => hour.temperatureC, Math.min(...temps) - 1, Math.max(...temps) + 1),
      humidityPoints: chartPoints(hours, (hour) => hour.humidityPercent, Math.max(0, Math.min(...humidity) - 5), Math.min(100, Math.max(...humidity) + 5)),
      precipitationPoints: chartPoints(hours, (hour) => hour.precipitationMm, 0, Math.max(1, Math.max(...precipitation))),
      currentX: 36 + currentIndex * 72
    };
  }, [currentIndex, hours]);

  return (
    <section className="weather-pane">
      <div className="weather-head">
        <div className="metric-title"><CloudRain /> Today's weather</div>
        <SourcePill health={data.weather.status.health} updatedAt={data.weather.status.updatedAt} />
      </div>
      {chart ? (
        <div className="weather-chart-shell">
          <div className="weather-chart-wrap" ref={scrollRef}>
            <div className="weather-chart" style={{ width: chart.width }}>
              <svg width={chart.width} height="178" viewBox={`0 0 ${chart.width} 178`} role="img" aria-label="24 hour weather forecast chart">
                {[24, 55, 86, 118].map((y) => <line key={y} x1="28" y1={y} x2={chart.width - 18} y2={y} className="weather-grid-line" />)}
                <line x1={chart.currentX} y1="14" x2={chart.currentX} y2="132" className="weather-now-line" />
                <polyline points={chart.humidityPoints} className="weather-line humidity" />
                <polyline points={chart.precipitationPoints} className="weather-line precipitation" />
                <polyline points={chart.tempPoints} className="weather-line temp" />
                {hours.map((hour, index) => {
                  const x = 36 + index * 72;
                  return (
                    <g key={hour.time}>
                      <line x1={x} y1="132" x2={x} y2="138" className="weather-tick" />
                      <text x={x} y="156" textAnchor="middle" className={index === currentIndex ? "weather-time current" : "weather-time"}>{formatClock(hour.time)}</text>
                      <text x={x} y="172" textAnchor="middle" className="weather-summary">{hour.temperatureC}C / {hour.humidityPercent}% / {hour.precipitationMm}mm</text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
          <div className="weather-legend">
            <span className="temp"><Thermometer size={15} /> Temp</span>
            <span className="humidity"><Droplets size={15} /> Humidity</span>
            <span className="precipitation"><CloudRain size={15} /> Rain</span>
          </div>
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

      <WeatherChartPane data={data} />

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

        <aside className="traffic-panel">
          <div className="metric-title"><Waves /> Traffic</div>
          <SourcePill health={data.tunnel.status.health} updatedAt={data.tunnel.status.updatedAt} />
          <div className="traffic-grid">
            <div>
              <span>{data.tunnel.indicatorName || "Tunnel indicator"}</span>
              <strong>{formatMinutes(data.tunnel.minutes)}</strong>
            </div>
            <div>
              <span>Status</span>
              <strong>{data.tunnel.trafficStatus || "--"}</strong>
            </div>
          </div>
          <div className="traffic-feed">
            <p>{data.tunnel.status.message || "Live traffic camera/feed placeholder for the selected crossing."}</p>
          </div>
        </aside>
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
