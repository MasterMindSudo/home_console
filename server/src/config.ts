import path from "path";
import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 5174),
  databaseUrl: process.env.DATABASE_URL || "",
  databasePath: path.resolve(process.env.DATABASE_PATH || "./data/dashboard.sqlite"),
  databaseSsl: process.env.DATABASE_SSL || "",
  gtfsHeadwayUrl: process.env.GTFS_HEADWAY_URL || "https://static.data.gov.hk/td/pt-headway-en/gtfs.zip",
  tomtomApiKey: process.env.TOMTOM_API_KEY || "",
  tomtomBackupApiKey: process.env.TOMTOM_BACKUP_API_KEY
    || process.env.TOMTOM_API_KEY_BACKUP
    || process.env.TOMTOM_BACKUP_KEY
    || process.env.TOMTOM_FALLBACK_API_KEY
    || process.env.TOMTOM_API_KEY_2
    || process.env.TOMTOM_SECONDARY_API_KEY
    || process.env.TOMTOM_SECONDARY_KEY
    || process.env.TOMTOM_BACKUP
    || "",
  clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:5173"
};
