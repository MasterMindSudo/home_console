import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config";
import { initDatabase } from "./db/database";
import { profileRoutes } from "./routes/profiles";
import { dashboardRoutes } from "./routes/dashboard";
import { busRoutes } from "./routes/bus";
import { mtrRoutes } from "./routes/mtr";

async function main(): Promise<void> {
  initDatabase();
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: config.clientOrigin });
  await app.register(profileRoutes);
  await app.register(dashboardRoutes);
  await app.register(busRoutes);
  await app.register(mtrRoutes);

  app.get("/api/health", async () => ({ ok: true, now: new Date().toISOString() }));

  await app.listen(config.port, "0.0.0.0");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
