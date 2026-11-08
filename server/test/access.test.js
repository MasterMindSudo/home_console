const assert = require("assert");
const Fastify = require("fastify");
const { registerAccessControl } = require("../../dist/server/server/src/lib/access");

async function run() {
  const password = "correct-horse-battery-staple-123";
  assert.throws(() => registerAccessControl(Fastify(), { username: "", password: "", required: true }));
  assert.throws(() => registerAccessControl(Fastify(), { username: "home", password: "short", required: true }));
  assert.throws(() => registerAccessControl(Fastify(), { username: "home:other", password, required: true }));

  const app = Fastify();
  registerAccessControl(app, { username: "home", password, required: true });
  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/profiles", async () => ["protected"]);
  app.post("/api/profiles", async () => ({ ok: true }));
  app.get("/", async () => "protected page");
  app.get("/api/debug/traffic-flow/:id", async () => "protected debug");

  try {
    for (const url of ["/", "/api/profiles", "/api/debug/traffic-flow/test", "/api/health/extra"]) {
      const response = await app.inject({ method: "GET", url });
      assert.strictEqual(response.statusCode, 401, url);
      assert.match(response.headers["www-authenticate"], /^Basic /);
      assert.strictEqual(response.headers["cache-control"], "no-store");
    }
    assert.strictEqual((await app.inject({ method: "POST", url: "/api/profiles" })).statusCode, 401);
    assert.strictEqual((await app.inject({ method: "GET", url: "/api/health?check=1" })).statusCode, 200);
    const auth = (value) => `Basic ${Buffer.from(value).toString("base64")}`;
    assert.strictEqual((await app.inject({ method: "GET", url: "/api/profiles", headers: { authorization: auth("home:wrong") } })).statusCode, 401);
    assert.strictEqual((await app.inject({ method: "GET", url: "/api/profiles", headers: { authorization: auth(`home:${password}`) } })).statusCode, 200);
  } finally {
    await app.close();
  }
}

run().then(() => console.log("access control tests passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
