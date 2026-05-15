import type React from "react";
import { AlertTriangle, Bus, Car, Clock, TrainFront, Waves } from "lucide-react";
import { DashboardPayload } from "../../../shared/types";
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

function JourneyLane({
  icon,
  title,
  status,
  startMinutes,
  endMinutes,
  endLabel,
  markers = 10,
  message
}: {
  icon: React.ReactNode;
  title: string;
  status: React.ReactNode;
  startMinutes?: number;
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
      <div className="lane-body">
        <div className="lane-time start">
          <strong>{formatMinutes(startMinutes)}</strong>
          <span>from now</span>
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

export function Dashboard({ data }: Props) {
  const firstBus = data.bus.pairs[0];
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

      <section className="journey-board">
        <div className="journey-main">
          <JourneyLane
            icon={<Bus />}
            title={`Bus ${data.profile.bus?.route || ""}`}
            status={<SourcePill health={data.bus.status.health} updatedAt={data.bus.status.updatedAt} />}
            startMinutes={firstBus?.origin?.minutes}
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
          <JourneyLane
            icon={<Car />}
            title="By car"
            status={<SourcePill health={data.car.status.health} updatedAt={data.car.status.updatedAt} />}
            startMinutes={0}
            endMinutes={data.car.travelMinutes}
            endLabel={`drive · arrive ${formatClock(data.car.arrivalTime)}`}
            markers={5}
            message={data.car.status.message || "TomTom live traffic route"}
          />
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
