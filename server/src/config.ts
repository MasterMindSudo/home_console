import path from "path";
import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 5174),
  databasePath: path.resolve(process.env.DATABASE_PATH || "./data/dashboard.sqlite"),
  tomtomApiKey: process.env.TOMTOM_API_KEY || "",
  tomtomBackupApiKey: process.env.TOMTOM_BACKUP_API_KEY || process.env.TOMTOM_API_KEY_BACKUP || process.env.TOMTOM_BACKUP_KEY || "",
  clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:5173"
};
