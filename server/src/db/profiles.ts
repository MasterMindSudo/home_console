import { randomBytes } from "crypto";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { CommuteProfile, ProfileInput } from "../../../shared/types";
import { db, pgPool, usePostgres } from "./database";
import { config } from "../config";

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

interface ProfileStore {
  list(): Promise<CommuteProfile[]>;
  get(id: string): Promise<CommuteProfile | undefined>;
  create(input: ProfileInput): Promise<CommuteProfile>;
  update(id: string, input: ProfileInput): Promise<CommuteProfile | undefined>;
  delete(id: string): Promise<boolean>;
}

type SupabaseTableClient = {
  select(columns?: string): {
    order(column: string, options?: { ascending?: boolean }): Promise<{ data: ProfileRow[] | null; error: unknown }>;
    eq(column: string, value: string): Promise<{ data: ProfileRow[] | null; error: unknown }>;
  };
  insert(payload: ProfileRow): Promise<{ error: unknown }>;
  update(payload: Partial<ProfileRow>): {
    eq(column: string, value: string): Promise<{ error: unknown }>;
  };
  delete(): {
    eq(column: string, value: string): Promise<{ error: unknown; count?: number | null }>;
  };
};

type SupabaseLikeClient = {
  from(name: string): SupabaseTableClient;
};

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

function ensureSupabaseSuccess(result: { error: unknown }): void {
  if (result.error) {
    throw result.error instanceof Error ? result.error : new Error(String(result.error));
  }
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

function buildProfileRow(id: string, input: ProfileInput, createdAt: string, updatedAt: string): ProfileRow {
  const [name, latestArrivalTime, busJson, mtrJson, carJson, tunnelIndicatorId] = profileColumns(input);
  return {
    id,
    name: name || "",
    latest_arrival_time: latestArrivalTime || "",
    bus_json: busJson,
    mtr_json: mtrJson,
    car_json: carJson,
    tunnel_indicator_id: tunnelIndicatorId,
    created_at: createdAt,
    updated_at: updatedAt
  };
}

function createLegacyProfileStore(): ProfileStore {
  return {
    async list(): Promise<CommuteProfile[]> {
      if (usePostgres && pgPool) {
        const result = await pgPool.query<ProfileRow>("SELECT * FROM profiles ORDER BY updated_at DESC");
        return result.rows.map(toProfile);
      }
      const rows = db!.prepare("SELECT * FROM profiles ORDER BY updated_at DESC").all() as ProfileRow[];
      return rows.map(toProfile);
    },
    async get(id: string): Promise<CommuteProfile | undefined> {
      if (usePostgres && pgPool) {
        const result = await pgPool.query<ProfileRow>("SELECT * FROM profiles WHERE id = $1", [id]);
        return result.rows[0] ? toProfile(result.rows[0]) : undefined;
      }
      const row = db!.prepare("SELECT * FROM profiles WHERE id = ?").get(id) as ProfileRow | undefined;
      return row ? toProfile(row) : undefined;
    },
    async create(input: ProfileInput): Promise<CommuteProfile> {
      validate(input);
      const now = new Date().toISOString();
      const row = buildProfileRow(createId(), input, now, now);
      if (usePostgres && pgPool) {
        await pgPool.query(
          `INSERT INTO profiles (
            id, name, latest_arrival_time, bus_json, mtr_json, car_json,
            tunnel_indicator_id, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            row.id,
            row.name,
            row.latest_arrival_time,
            row.bus_json,
            row.mtr_json,
            row.car_json,
            row.tunnel_indicator_id,
            row.created_at,
            row.updated_at
          ]
        );
      } else {
        db!.prepare(`
          INSERT INTO profiles (
            id, name, latest_arrival_time, bus_json, mtr_json, car_json,
            tunnel_indicator_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          row.id,
          row.name,
          row.latest_arrival_time,
          row.bus_json,
          row.mtr_json,
          row.car_json,
          row.tunnel_indicator_id,
          row.created_at,
          row.updated_at
        );
      }
      return (await this.get(row.id))!;
    },
    async update(id: string, input: ProfileInput): Promise<CommuteProfile | undefined> {
      validate(input);
      const existing = await this.get(id);
      if (!existing) return undefined;
      const row = buildProfileRow(id, input, existing.createdAt, new Date().toISOString());
      if (usePostgres && pgPool) {
        await pgPool.query(
          `UPDATE profiles
          SET name = $1, latest_arrival_time = $2, bus_json = $3, mtr_json = $4, car_json = $5,
              tunnel_indicator_id = $6, updated_at = $7
          WHERE id = $8`,
          [
            row.name,
            row.latest_arrival_time,
            row.bus_json,
            row.mtr_json,
            row.car_json,
            row.tunnel_indicator_id,
            row.updated_at,
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
          row.name,
          row.latest_arrival_time,
          row.bus_json,
          row.mtr_json,
          row.car_json,
          row.tunnel_indicator_id,
          row.updated_at,
          id
        );
      }
      return this.get(id);
    },
    async delete(id: string): Promise<boolean> {
      if (usePostgres && pgPool) {
        const result = await pgPool.query("DELETE FROM profiles WHERE id = $1", [id]);
        return (result.rowCount || 0) > 0;
      }
      const result = db!.prepare("DELETE FROM profiles WHERE id = ?").run(id);
      return result.changes > 0;
    }
  };
}

export function createSupabaseProfileStore(client: SupabaseLikeClient): ProfileStore {
  return {
    async list(): Promise<CommuteProfile[]> {
      const result = await client.from("profiles").select("*").order("updated_at", { ascending: false });
      ensureSupabaseSuccess(result);
      return (result.data || []).map(toProfile);
    },
    async get(id: string): Promise<CommuteProfile | undefined> {
      const result = await client.from("profiles").select("*").eq("id", id);
      ensureSupabaseSuccess(result);
      return result.data?.[0] ? toProfile(result.data[0]) : undefined;
    },
    async create(input: ProfileInput): Promise<CommuteProfile> {
      validate(input);
      const now = new Date().toISOString();
      const row = buildProfileRow(createId(), input, now, now);
      const result = await client.from("profiles").insert(row);
      ensureSupabaseSuccess(result);
      return (await this.get(row.id))!;
    },
    async update(id: string, input: ProfileInput): Promise<CommuteProfile | undefined> {
      validate(input);
      const existing = await this.get(id);
      if (!existing) return undefined;
      const row = buildProfileRow(id, input, existing.createdAt, new Date().toISOString());
      const result = await client.from("profiles").update({
        name: row.name,
        latest_arrival_time: row.latest_arrival_time,
        bus_json: row.bus_json,
        mtr_json: row.mtr_json,
        car_json: row.car_json,
        tunnel_indicator_id: row.tunnel_indicator_id,
        updated_at: row.updated_at
      }).eq("id", id);
      ensureSupabaseSuccess(result);
      return this.get(id);
    },
    async delete(id: string): Promise<boolean> {
      const existing = await this.get(id);
      if (!existing) return false;
      const result = await client.from("profiles").delete().eq("id", id);
      ensureSupabaseSuccess(result);
      return true;
    }
  };
}

const useSupabaseProfiles = Boolean(config.supabaseUrl && config.supabaseSecretKey);
let activeProfileStore: ProfileStore | undefined;

function createSupabaseAdminClient(): SupabaseLikeClient {
  return createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    realtime: {
      transport: WebSocket as unknown as never
    }
  }) as unknown as SupabaseLikeClient;
}

function getProfileStore(): ProfileStore {
  if (!activeProfileStore) {
    activeProfileStore = useSupabaseProfiles
      ? createSupabaseProfileStore(createSupabaseAdminClient())
      : createLegacyProfileStore();
  }
  return activeProfileStore;
}

export async function listProfiles(): Promise<CommuteProfile[]> {
  return getProfileStore().list();
}

export async function getProfile(id: string): Promise<CommuteProfile | undefined> {
  return getProfileStore().get(id);
}

export async function createProfile(input: ProfileInput): Promise<CommuteProfile> {
  return getProfileStore().create(input);
}

export async function updateProfile(id: string, input: ProfileInput): Promise<CommuteProfile | undefined> {
  return getProfileStore().update(id, input);
}

export async function deleteProfile(id: string): Promise<boolean> {
  return getProfileStore().delete(id);
}
