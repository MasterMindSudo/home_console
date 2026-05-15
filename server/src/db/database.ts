import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { config } from "../config";

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
export const db = new Database(config.databasePath);

export function initDatabase(): void {
  db.exec(`
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
  `);
}
