import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { CommuteProfile, DashboardPayload, ProfileInput } from "../../shared/types";
import { api } from "./lib/api";
import { Dashboard } from "./components/Dashboard";
import { ProfileForm } from "./components/ProfileForm";

export function App() {
  const [profiles, setProfiles] = useState<CommuteProfile[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const selectedProfile = useMemo(() => profiles.find((profile) => profile.id === selectedId), [profiles, selectedId]);

  async function loadProfiles() {
    const next = await api.listProfiles();
    setProfiles(next);
    setSelectedId((current) => current || next[0]?.id || "");
    if (!next.length) setEditing(true);
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
    const saved = selectedProfile && editing ? await api.updateProfile(selectedProfile.id, input) : await api.createProfile(input);
    await loadProfiles();
    setSelectedId(saved.id);
    setEditing(false);
    await loadDashboard(saved.id);
  }

  async function deleteSelected() {
    if (!selectedId) return;
    await api.deleteProfile(selectedId);
    setDashboard(null);
    setSelectedId("");
    await loadProfiles();
  }

  useEffect(() => {
    loadProfiles().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    loadDashboard(selectedId);
    const fast = window.setInterval(() => loadDashboard(selectedId), 10000);
    return () => window.clearInterval(fast);
  }, [selectedId]);

  return (
    <div className="app-shell">
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
            <button key={profile.id} className={profile.id === selectedId ? "selected" : ""} onClick={() => { setSelectedId(profile.id); setEditing(false); }}>
              {profile.name}
              <small>Arrive by {profile.latestArrivalTime}</small>
            </button>
          ))}
        </div>

        <div className="sidebar-actions">
          <button onClick={() => setEditing(true)}><Plus size={18} /> {selectedProfile ? "Edit/Add" : "Create"}</button>
          <button onClick={() => loadDashboard()} disabled={!selectedId}><RefreshCw size={18} /> Refresh</button>
          <button onClick={deleteSelected} disabled={!selectedId}><Trash2 size={18} /> Delete</button>
        </div>
      </aside>

      <div className="content">
        {error && <div className="notice">{error}</div>}
        {editing ? (
          <ProfileForm profile={selectedProfile} onSave={saveProfile} />
        ) : dashboard ? (
          <Dashboard data={dashboard} />
        ) : (
          <section className="empty-state">
            <h2>Create your first commute profile</h2>
            <p>Add route, stop, MTR, car, and arrival-target details to start the live display.</p>
            <button onClick={() => setEditing(true)}>New profile</button>
          </section>
        )}
      </div>
    </div>
  );
}
