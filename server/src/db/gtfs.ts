import { db, pgPool, usePostgres } from "./database";

export interface StoredGtfsRoutePattern {
  routeShortName: string;
  agencyId?: string;
  routeLongName?: string;
  patterns: GtfsRoutePattern[];
  importedAt: string;
}

export interface GtfsRoutePattern {
  patternKey: string;
  firstStopName: string;
  lastStopName: string;
  stopCount: number;
  runtimeMinutes?: number;
  stops: GtfsPatternStop[];
  headways: GtfsHeadwayWindow[];
}

export interface GtfsPatternStop {
  sequence: number;
  stopId: string;
  stopName: string;
}

export interface GtfsHeadwayWindow {
  startTime: string;
  endTime: string;
  headwayMinutes: number;
}

interface ImportRow {
  imported_at: string;
  status: string;
}

interface PatternRow {
  route_short_name: string;
  agency_id: string | null;
  route_long_name: string | null;
  patterns_json: string;
  imported_at: string;
}

export async function latestGtfsImport(): Promise<{ importedAt: string; status: string } | undefined> {
  if (usePostgres && pgPool) {
    const result = await pgPool.query<ImportRow>("SELECT imported_at, status FROM gtfs_imports ORDER BY imported_at DESC LIMIT 1");
    const row = result.rows[0];
    return row ? { importedAt: row.imported_at, status: row.status } : undefined;
  }

  const row = db!.prepare("SELECT imported_at, status FROM gtfs_imports ORDER BY imported_at DESC LIMIT 1").get() as ImportRow | undefined;
  return row ? { importedAt: row.imported_at, status: row.status } : undefined;
}

export async function replaceGtfsPatterns(sourceUrl: string, routes: StoredGtfsRoutePattern[], status = "ok"): Promise<void> {
  const importedAt = new Date().toISOString();
  const uniqueRoutes = Array.from(new Map(routes.map((route) => [route.routeShortName.trim().toUpperCase(), route])).values());

  if (usePostgres && pgPool) {
    const client = await pgPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM gtfs_route_patterns");
      for (const route of uniqueRoutes) {
        await client.query(
          `INSERT INTO gtfs_route_patterns (
            route_short_name, agency_id, route_long_name, patterns_json, imported_at
          ) VALUES ($1, $2, $3, $4, $5)`,
          [route.routeShortName, route.agencyId || null, route.routeLongName || null, JSON.stringify(route.patterns), importedAt]
        );
      }
      await client.query(
        "INSERT INTO gtfs_imports (id, source_url, imported_at, status) VALUES ($1, $2, $3, $4)",
        [`gtfs-${Date.now()}`, sourceUrl, importedAt, status]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return;
  }

  const transaction = db!.transaction(() => {
    db!.prepare("DELETE FROM gtfs_route_patterns").run();
    const insert = db!.prepare(`
      INSERT INTO gtfs_route_patterns (
        route_short_name, agency_id, route_long_name, patterns_json, imported_at
      ) VALUES (?, ?, ?, ?, ?)
    `);
    uniqueRoutes.forEach((route) => {
      insert.run(route.routeShortName, route.agencyId || null, route.routeLongName || null, JSON.stringify(route.patterns), importedAt);
    });
    db!.prepare("INSERT INTO gtfs_imports (id, source_url, imported_at, status) VALUES (?, ?, ?, ?)").run(`gtfs-${Date.now()}`, sourceUrl, importedAt, status);
  });
  transaction();
}

export async function getGtfsRoutePattern(routeShortName: string): Promise<StoredGtfsRoutePattern | undefined> {
  const route = routeShortName.trim().toUpperCase();
  const row = usePostgres && pgPool
    ? (await pgPool.query<PatternRow>("SELECT * FROM gtfs_route_patterns WHERE route_short_name = $1", [route])).rows[0]
    : db!.prepare("SELECT * FROM gtfs_route_patterns WHERE route_short_name = ?").get(route) as PatternRow | undefined;

  if (!row) return undefined;
  return {
    routeShortName: row.route_short_name,
    agencyId: row.agency_id || undefined,
    routeLongName: row.route_long_name || undefined,
    patterns: JSON.parse(row.patterns_json) as GtfsRoutePattern[],
    importedAt: row.imported_at
  };
}
