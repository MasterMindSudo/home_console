const assert = require("assert");
const { resolveLegacyDatabaseMode } = require("../../dist/server/server/src/db/databaseMode");

assert.strictEqual(
  resolveLegacyDatabaseMode({ databaseUrl: "postgresql://retired-host/db", supabaseConfigured: true }),
  "sqlite"
);
assert.strictEqual(
  resolveLegacyDatabaseMode({ databaseUrl: "postgresql://active-host/db", supabaseConfigured: false }),
  "postgres"
);
assert.strictEqual(
  resolveLegacyDatabaseMode({ databaseUrl: "", supabaseConfigured: false }),
  "sqlite"
);

console.log("database mode tests passed");
