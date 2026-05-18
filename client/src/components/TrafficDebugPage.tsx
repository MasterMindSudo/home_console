import { useState } from "react";
import { Car, Gauge, RefreshCw, Route, Waves } from "lucide-react";
import { TrafficFlowDebugPayload } from "../../../shared/types";
import { api } from "../lib/api";
import { formatClock, formatMinutes, formatUpdated } from "../lib/format";

interface Props {
  profileId: string;
}

function speedLabel(value?: number): string {
  return typeof value === "number" ? `${Math.round(value)} km/h` : "--";
}

function JsonBlock({ data }: { data: unknown }) {
  return <pre className="debug-json">{JSON.stringify(data, null, 2)}</pre>;
}

export function TrafficDebugPage({ profileId }: Props) {
  const [data, setData] = useState<TrafficFlowDebugPayload | null>(null);
  const [forceRefresh, setForceRefresh] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function update() {
    if (!profileId) return;
    setLoading(true);
    setError("");
    try {
      setData(await api.trafficFlowDebug(profileId, forceRefresh));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Traffic debug update failed.");
    } finally {
      setLoading(false);
    }
  }

  if (!profileId) {
    return (
      <section className="debug-page">
        <h2>Traffic flow debug</h2>
        <p className="muted">Select a commute profile first.</p>
      </section>
    );
  }

  return (
    <section className="debug-page">
      <div className="debug-hero">
        <div>
          <p className="eyebrow">Manual diagnostics</p>
          <h2>Traffic flow + TomTom debug</h2>
          <p>No auto refresh. Press update when you want to spend a route check.</p>
        </div>
        <div className="debug-actions">
          <label className="debug-toggle">
            <input type="checkbox" checked={forceRefresh} onChange={(event) => setForceRefresh(event.target.checked)} />
            Force live TomTom
          </label>
          <button onClick={update} disabled={loading}>
            <RefreshCw size={18} /> {loading ? "Updating" : "Update now"}
          </button>
        </div>
      </div>

      {error && <div className="notice">{error}</div>}

      {data ? (
        <div className="debug-grid">
          <article className="debug-card">
            <div className="metric-title"><Car /> TomTom result</div>
            <div className="debug-kpis">
              <div>
                <span>Fastest</span>
                <strong>{formatMinutes(data.car.fastest?.travelMinutes || data.car.travelMinutes)}</strong>
                <small>{formatClock(data.car.fastest?.arrivalTime || data.car.arrivalTime)}</small>
              </div>
              <div>
                <span>Toll-free</span>
                <strong>{formatMinutes(data.car.tollFree?.travelMinutes)}</strong>
                <small>{formatClock(data.car.tollFree?.arrivalTime)}</small>
              </div>
              <div>
                <span>Status</span>
                <strong>{data.car.status.health.replace("_", " ")}</strong>
                <small>{formatUpdated(data.car.status.updatedAt)}</small>
              </div>
            </div>
            {data.car.status.message && <p className="muted">{data.car.status.message}</p>}
          </article>

          <article className="debug-card">
            <div className="metric-title">TomTom keys</div>
            <div className="debug-kpis key-kpis">
              <div>
                <span>Primary</span>
                <strong>{data.tomtom.primaryConfigured ? "seen" : "missing"}</strong>
              </div>
              <div>
                <span>Backup</span>
                <strong>{data.tomtom.backupConfigured ? "seen" : "missing"}</strong>
              </div>
              <div>
                <span>Cache</span>
                <strong>{data.forceRefresh ? "bypassed" : `${data.tomtom.refreshMinutes} min`}</strong>
                <small>{data.tomtom.primaryQuotaBlocked ? "primary cooling down" : "primary eligible"}</small>
              </div>
            </div>
          </article>

          <article className="debug-card">
            <div className="metric-title"><Route /> TomTom road names</div>
            {data.routeRoadNames.length ? (
              <div className="debug-token-list">
                {data.routeRoadNames.map((name, index) => <span key={`${name}-${index}`}>{name}</span>)}
              </div>
            ) : (
              <p className="muted">No route guidance road names returned.</p>
            )}
          </article>

          <article className="debug-card debug-card-wide">
            <div className="metric-title"><Waves /> HK matched speed-flow cards</div>
            {data.trafficFlow.roads.length ? (
              <div className="debug-flow-grid">
                {data.trafficFlow.roads.map((road) => (
                  <div key={road.roadName} className={`traffic-flow-card ${road.status}`}>
                    <div>
                      <strong>{road.roadName}</strong>
                      <span>{road.validSegmentCount} live segments - {road.invalidSegmentCount} stale</span>
                    </div>
                    <b><Gauge size={18} /> {speedLabel(road.representativeSpeedKph)}</b>
                    <small>Slowest {speedLabel(road.slowestSpeedKph)}</small>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">{data.trafficFlow.status.message || "No matching HK speed segments for this TomTom route."}</p>
            )}
          </article>

          <article className="debug-card debug-card-wide">
            <div className="metric-title">Raw payload</div>
            <JsonBlock data={data} />
          </article>
        </div>
      ) : (
        <div className="empty-state debug-empty">
          <h2>Ready to test</h2>
          <p>Use Update now to fetch TomTom, extract road names, and match HK speed segments.</p>
        </div>
      )}
    </section>
  );
}
