import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { Pool } from "pg";
import { config } from "../config";

export const usePostgres = Boolean(config.databaseUrl);
const DB_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    latest_arrival_time TEXT NOT NULL,
    bus_json TEXT,
    mtr_json TEXT,
    car_json TEXT,
    tunnel_indicator_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS todo_tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    due_at TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS gtfs_imports (
    id TEXT PRIMARY KEY,
    source_url TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    status TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS gtfs_route_patterns (
    route_short_name TEXT PRIMARY KEY,
    agency_id TEXT,
    route_long_name TEXT,
    patterns_json TEXT NOT NULL,
    imported_at TEXT NOT NULL
  );
`;

function resolvePostgresSsl(): boolean | { rejectUnauthorized: boolean } | undefined {
  const value = config.databaseSsl.trim().toLowerCase();
  if (value === "false" || value === "0" || value === "off" || value === "disable") return false;
  if (value === "true" || value === "1" || value === "on" || value === "require") return { rejectUnauthorized: false };
  if (config.databaseUrl.includes("render.com")) return { rejectUnauthorized: false };
  return undefined;
}

export const pgPool = usePostgres
  ? new Pool({
      connectionString: config.databaseUrl,
      ssl: resolvePostgresSsl()
    })
  : undefined;

export const db = usePostgres
  ? undefined
  : (() => {
      fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
      return new Database(config.databasePath);
    })();

export async function initDatabase(): Promise<void> {
  if (usePostgres && pgPool) {
    await pgPool.query(DB_SCHEMA_SQL);
    return;
  }

  db?.exec(DB_SCHEMA_SQL);
}
