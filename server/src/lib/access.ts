import { createHash, timingSafeEqual } from "crypto";
import { FastifyInstance } from "fastify";

export interface AccessConfig {
  username: string;
  password: string;
  required: boolean;
}

export function registerAccessControl(app: FastifyInstance, options: AccessConfig): void {
  const { username, password, required } = options;
  if (!username && !password && !required) return;
  if (!username || username.includes(":") || !/^[\x21-\x7e]+$/.test(username) || password.length < 24) {
    throw new Error("Set APP_AUTH_USER (ASCII, no colon) and APP_AUTH_PASSWORD (at least 24 characters).");
  }

  const expected = createHash("sha256").update(`${username}:${password}`, "utf8").digest();
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (request.method === "GET" && request.raw.url?.split("?")[0] === "/api/health") return;

    const authorization = request.headers.authorization || "";
    const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization);
    const supplied = match ? Buffer.from(match[1], "base64") : Buffer.alloc(0);
    const actual = createHash("sha256").update(supplied).digest();
    if (match && timingSafeEqual(expected, actual)) return;

    reply.header("WWW-Authenticate", 'Basic realm="Household Transit", charset="UTF-8"');
    return reply.code(401).send({ error: "Authentication required." });
  });
}
