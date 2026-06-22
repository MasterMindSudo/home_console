const Database = require("better-sqlite3");
const fetch = require("node-fetch");
const path = require("path");
require("dotenv").config();

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  }

  const databasePath = path.resolve(process.env.DATABASE_PATH || "./data/dashboard.sqlite");
  const database = new Database(databasePath, { readonly: true });
  const rows = database.prepare("SELECT * FROM profiles ORDER BY updated_at DESC").all();
  database.close();

  if (rows.length === 0) {
    console.log("No SQLite profiles found to migrate.");
    return;
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/profiles?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: secretKey,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=representation",
      "user-agent": "home-console-profile-migration/1.0"
    },
    body: JSON.stringify(rows)
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase migration failed (${response.status}): ${detail}`);
  }

  const migrated = await response.json();
  console.log(`Migrated ${migrated.length} profile(s) to Supabase.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
