import Fastify from "fastify";
import cors from "@fastify/cors";
import fs from "fs";
import path from "path";
import { config } from "./config";
import { initDatabase } from "./db/database";
import { profileRoutes } from "./routes/profiles";
import { dashboardRoutes } from "./routes/dashboard";
import { busRoutes } from "./routes/bus";
import { mtrRoutes } from "./routes/mtr";
import { debugRoutes } from "./routes/debug";
import { supabaseRoutes } from "./routes/supabase";

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

function resolveClientAsset(urlPath: string): string {
  const clientDir = path.resolve(process.cwd(), "dist/client");
  const safePath = path.normalize(decodeURIComponent(urlPath.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const requested = path.join(clientDir, safePath === "/" ? "index.html" : safePath);
  if (requested.startsWith(clientDir) && fs.existsSync(requested) && fs.statSync(requested).isFile()) {
    return requested;
  }
  return path.join(clientDir, "index.html");
}

async function main(): Promise<void> {
  await initDatabase();
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: config.clientOrigin });
  await app.register(profileRoutes);
  await app.register(dashboardRoutes);
  await app.register(busRoutes);
  await app.register(mtrRoutes);
  await app.register(debugRoutes);
  await app.register(supabaseRoutes);

  app.get("/api/health", async () => ({ ok: true, now: new Date().toISOString() }));

  app.get("/*", async (request, reply) => {
    const filePath = resolveClientAsset(request.url);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: "Client build not found." });
    reply.type(mimeTypes[path.extname(filePath)] || "application/octet-stream");
    return reply.send(fs.createReadStream(filePath));
  });

  await app.listen(config.port, "0.0.0.0");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
