import { randomBytes } from "crypto";
import { CommuteProfile, ProfileInput } from "../../../shared/types";
import { db } from "./database";

interface ProfileRow {
  id: string;
  name: string;
  latest_arrival_time: string;
  bus_json: string | null;
  mtr_json: string | null;
  car_json: string | null;
  tunnel_indicator_id: string | null;
  created_at: string;
  updated_at: string;
}

function parseJson<T>(value: string | null): T | undefined {
  return value ? (JSON.parse(value) as T) : undefined;
}

function toProfile(row: ProfileRow): CommuteProfile {
  return {
    id: row.id,
    name: row.name,
    latestArrivalTime: row.latest_arrival_time,
    bus: parseJson(row.bus_json),
    mtr: parseJson(row.mtr_json),
    car: parseJson(row.car_json),
    tunnelIndicatorId: row.tunnel_indicator_id || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function validate(input: ProfileInput): void {
  if (!input.name || input.name.trim().length < 2) {
    throw new Error("Profile name must be at least 2 characters.");
  }
  if (!/^\d{2}:\d{2}$/.test(input.latestArrivalTime)) {
    throw new Error("Latest arrival time must use HH:mm format.");
  }
}

function createId(): string {
  return randomBytes(16).toString("hex");
}

export function listProfiles(): CommuteProfile[] {
  const rows = db.prepare("SELECT * FROM profiles ORDER BY updated_at DESC").all() as ProfileRow[];
  return rows.map(toProfile);
}

export function getProfile(id: string): CommuteProfile | undefined {
  const row = db.prepare("SELECT * FROM profiles WHERE id = ?").get(id) as ProfileRow | undefined;
  return row ? toProfile(row) : undefined;
}

export function createProfile(input: ProfileInput): CommuteProfile {
  validate(input);
  const now = new Date().toISOString();
  const id = createId();
  db.prepare(`
    INSERT INTO profiles (
      id, name, latest_arrival_time, bus_json, mtr_json, car_json,
      tunnel_indicator_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name.trim(),
    input.latestArrivalTime,
    input.bus ? JSON.stringify(input.bus) : null,
    input.mtr ? JSON.stringify(input.mtr) : null,
    input.car ? JSON.stringify(input.car) : null,
    input.tunnelIndicatorId || null,
    now,
    now
  );
  return getProfile(id)!;
}

export function updateProfile(id: string, input: ProfileInput): CommuteProfile | undefined {
  validate(input);
  if (!getProfile(id)) return undefined;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE profiles
    SET name = ?, latest_arrival_time = ?, bus_json = ?, mtr_json = ?, car_json = ?,
        tunnel_indicator_id = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.name.trim(),
    input.latestArrivalTime,
    input.bus ? JSON.stringify(input.bus) : null,
    input.mtr ? JSON.stringify(input.mtr) : null,
    input.car ? JSON.stringify(input.car) : null,
    input.tunnelIndicatorId || null,
    now,
    id
  );
  return getProfile(id);
}

export function deleteProfile(id: string): boolean {
  const result = db.prepare("DELETE FROM profiles WHERE id = ?").run(id);
  return result.changes > 0;
}
