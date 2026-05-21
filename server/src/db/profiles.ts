import { randomBytes } from "crypto";
import { CommuteProfile, ProfileInput } from "../../../shared/types";
import { db, pgPool, usePostgres } from "./database";

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
  const bus = parseJson<CommuteProfile["bus"]>(row.bus_json);
  const mtr = parseJson<CommuteProfile["mtr"]>(row.mtr_json);
  const carRow = parseJson<CommuteProfile["car"] & { walkTimes?: CommuteProfile["walkTimes"] }>(row.car_json);
  const walkTimes = carRow?.walkTimes;
  const car = carRow ? { origin: carRow.origin, destination: carRow.destination } : undefined;
  return {
    id: row.id,
    name: row.name,
    latestArrivalTime: row.latest_arrival_time,
    bus,
    mtr,
    car,
    walkTimes,
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

function profileColumns(input: ProfileInput): Array<string | null> {
  const carWithWalkTimes = input.car ? { ...input.car, walkTimes: input.walkTimes } : null;
  return [
    input.name.trim(),
    input.latestArrivalTime,
    input.bus ? JSON.stringify(input.bus) : null,
    input.mtr ? JSON.stringify(input.mtr) : null,
    carWithWalkTimes ? JSON.stringify(carWithWalkTimes) : null,
    input.tunnelIndicatorId || null
  ];
}

export async function listProfiles(): Promise<CommuteProfile[]> {
  if (usePostgres && pgPool) {
    const result = await pgPool.query<ProfileRow>("SELECT * FROM profiles ORDER BY updated_at DESC");
    return result.rows.map(toProfile);
  }
  const rows = db!.prepare("SELECT * FROM profiles ORDER BY updated_at DESC").all() as ProfileRow[];
  return rows.map(toProfile);
}

export async function getProfile(id: string): Promise<CommuteProfile | undefined> {
  if (usePostgres && pgPool) {
    const result = await pgPool.query<ProfileRow>("SELECT * FROM profiles WHERE id = $1", [id]);
    return result.rows[0] ? toProfile(result.rows[0]) : undefined;
  }
  const row = db!.prepare("SELECT * FROM profiles WHERE id = ?").get(id) as ProfileRow | undefined;
  return row ? toProfile(row) : undefined;
}

export async function createProfile(input: ProfileInput): Promise<CommuteProfile> {
  validate(input);
  const now = new Date().toISOString();
  const id = createId();
  const [name, latestArrivalTime, busJson, mtrJson, carJson, tunnelIndicatorId] = profileColumns(input);
  if (usePostgres && pgPool) {
    await pgPool.query(
      `INSERT INTO profiles (
        id, name, latest_arrival_time, bus_json, mtr_json, car_json,
        tunnel_indicator_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        name,
        latestArrivalTime,
        busJson,
        mtrJson,
        carJson,
        tunnelIndicatorId,
        now,
        now
      ]
    );
  } else {
    db!.prepare(`
      INSERT INTO profiles (
        id, name, latest_arrival_time, bus_json, mtr_json, car_json,
        tunnel_indicator_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name,
      latestArrivalTime,
      busJson,
      mtrJson,
      carJson,
      tunnelIndicatorId,
      now,
      now
    );
  }
  return (await getProfile(id))!;
}

export async function updateProfile(id: string, input: ProfileInput): Promise<CommuteProfile | undefined> {
  validate(input);
  if (!(await getProfile(id))) return undefined;
  const now = new Date().toISOString();
  const [name, latestArrivalTime, busJson, mtrJson, carJson, tunnelIndicatorId] = profileColumns(input);
  if (usePostgres && pgPool) {
    await pgPool.query(
      `UPDATE profiles
      SET name = $1, latest_arrival_time = $2, bus_json = $3, mtr_json = $4, car_json = $5,
          tunnel_indicator_id = $6, updated_at = $7
      WHERE id = $8`,
      [
        name,
        latestArrivalTime,
        busJson,
        mtrJson,
        carJson,
        tunnelIndicatorId,
        now,
        id
      ]
    );
  } else {
    db!.prepare(`
      UPDATE profiles
      SET name = ?, latest_arrival_time = ?, bus_json = ?, mtr_json = ?, car_json = ?,
          tunnel_indicator_id = ?, updated_at = ?
      WHERE id = ?
    `).run(
      name,
      latestArrivalTime,
      busJson,
      mtrJson,
      carJson,
      tunnelIndicatorId,
      now,
      id
    );
  }
  return await getProfile(id);
}

export async function deleteProfile(id: string): Promise<boolean> {
  if (usePostgres && pgPool) {
    const result = await pgPool.query("DELETE FROM profiles WHERE id = $1", [id]);
    return (result.rowCount || 0) > 0;
  }
  const result = db!.prepare("DELETE FROM profiles WHERE id = ?").run(id);
  return result.changes > 0;
}
