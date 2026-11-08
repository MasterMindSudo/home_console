const assert = require("assert");

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
process.env.SUPABASE_JWKS_URL = "https://example.supabase.co/auth/v1/.well-known/jwks.json";

const Fastify = require("fastify");
const { supabaseRoutes } = require("../../dist/server/server/src/routes/supabase");

async function run() {
  const app = Fastify();
  try {
    await app.register(supabaseRoutes);
    const response = await app.inject({ method: "GET", url: "/api/supabase/status" });
    assert.strictEqual(response.statusCode, 200);
    const body = response.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.config.configured, true);
  } finally {
    await app.close();
  }
}

run().then(() => console.log("supabase route tests passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
