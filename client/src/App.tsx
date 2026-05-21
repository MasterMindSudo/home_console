import { useEffect, useMemo, useState } from "react";
import { Bug, Maximize2, Minimize2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { CommuteProfile, DashboardPayload, ProfileInput } from "../../shared/types";
import { api } from "./lib/api";
import { Dashboard } from "./components/Dashboard";
import { ProfileForm } from "./components/ProfileForm";
import { TrafficDebugPage } from "./components/TrafficDebugPage";

export function App() {
  const [profiles, setProfiles] = useState<CommuteProfile[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [displayMode, setDisplayMode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("display") === "1" || window.localStorage.getItem("home-console-display-mode") === "true";
  });
  const [error, setError] = useState("");
  const selectedProfile = useMemo(() => profiles.find((profile) => profile.id === selectedId), [profiles, selectedId]);

  async function loadProfiles() {
    const next = await api.listProfiles();
    setProfiles(next);
    setSelectedId((current) => current || next[0]?.id || "");
    if (!next.length) setFormMode("create");
  }

  async function loadDashboard(id = selectedId) {
    if (!id) return;
    setError("");
    try {
      setDashboard(await api.dashboard(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dashboard failed.");
    }
  }

  async function saveProfile(input: ProfileInput) {
    const saved = formMode === "edit" && selectedProfile ? await api.updateProfile(selectedProfile.id, input) : await api.createProfile(input);
    await loadProfiles();
    setSelectedId(saved.id);
    setFormMode(null);
    setDebugOpen(false);
    await loadDashboard(saved.id);
  }

  async function deleteSelected() {
    if (!selectedId) return;
    await api.deleteProfile(selectedId);
    setDashboard(null);
    setSelectedId("");
    setDebugOpen(false);
    await loadProfiles();
  }

  useEffect(() => {
    loadProfiles().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!selectedId || debugOpen) return;
    loadDashboard(selectedId);
    const fast = window.setInterval(() => loadDashboard(selectedId), 10000);
    return () => window.clearInterval(fast);
  }, [selectedId, debugOpen]);

  useEffect(() => {
    window.localStorage.setItem("home-console-display-mode", String(displayMode));
  }, [displayMode]);

  return (
    <div className={`app-shell ${displayMode && !formMode && !debugOpen ? "display-mode" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <span>HK</span>
          <div>
            <h1>Transit Hub</h1>
            <p>Household commute display</p>
          </div>
        </div>

        <div className="profile-list">
          {profiles.map((profile) => (
            <button key={profile.id} className={profile.id === selectedId ? "selected" : ""} onClick={() => { setSelectedId(profile.id); setFormMode(null); setDebugOpen(false); }}>
              {profile.name}
              <small>Arrive by {profile.latestArrivalTime}</small>
            </button>
          ))}
        </div>

        <div className="sidebar-actions">
          <button onClick={() => setDisplayMode((current) => !current)}>
            {displayMode ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            {displayMode ? "Show controls" : "Display mode"}
          </button>
          <button onClick={() => { setFormMode("create"); setDebugOpen(false); }}><Plus size={18} /> Add profile</button>
          <button onClick={() => { setFormMode("edit"); setDebugOpen(false); }} disabled={!selectedProfile}>Edit profile</button>
          <button onClick={() => loadDashboard()} disabled={!selectedId || debugOpen}><RefreshCw size={18} /> Refresh</button>
          <button className={debugOpen ? "selected" : ""} onClick={() => { setFormMode(null); setDebugOpen(true); }} disabled={!selectedId}><Bug size={18} /> Traffic debug</button>
          <button onClick={deleteSelected} disabled={!selectedId}><Trash2 size={18} /> Delete</button>
        </div>
      </aside>

      {displayMode && !formMode && !debugOpen && (
        <button className="display-mode-exit" onClick={() => setDisplayMode(false)}>
          <Minimize2 size={18} /> Controls
        </button>
      )}

      <div className={`content ${formMode || debugOpen ? "content-scroll" : ""}`}>
        {error && <div className="notice">{error}</div>}
        {debugOpen ? (
          <TrafficDebugPage profileId={selectedId} />
        ) : formMode ? (
          <ProfileForm key={formMode === "edit" ? selectedProfile?.id || "missing" : "new"} profile={formMode === "edit" ? selectedProfile : undefined} onSave={saveProfile} />
        ) : dashboard ? (
          <Dashboard data={dashboard} />
        ) : (
          <section className="empty-state">
            <h2>Create your first commute profile</h2>
            <p>Add route, stop, MTR, car, and arrival-target details to start the live display.</p>
            <button onClick={() => setFormMode("create")}>New profile</button>
          </section>
        )}
      </div>
    </div>
  );
}
