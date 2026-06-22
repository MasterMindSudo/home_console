export type LegacyDatabaseMode = "postgres" | "sqlite";

export function resolveLegacyDatabaseMode(options: {
  databaseUrl: string;
  supabaseConfigured: boolean;
}): LegacyDatabaseMode {
  if (options.supabaseConfigured) return "sqlite";
  return options.databaseUrl ? "postgres" : "sqlite";
}
