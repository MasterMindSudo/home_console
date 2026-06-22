import type { FastifyReply, FastifyRequest } from "fastify";
import { withSupabase, type SupabaseContext, type WithSupabaseConfig } from "@supabase/server";
import { config } from "../config";

type SupabaseWebHandler<Database = unknown> = (
  request: Request,
  context: SupabaseContext<Database>
) => Promise<Response>;

function hasSupabaseEnv(): boolean {
  return Boolean(config.supabaseUrl && config.supabasePublishableKey && config.supabaseSecretKey);
}

function getSupabaseUrlHost(): string | null {
  if (!config.supabaseUrl) return null;
  try {
    return new URL(config.supabaseUrl).host;
  } catch (_error) {
    return null;
  }
}

function buildAbsoluteUrl(request: FastifyRequest): string {
  const forwardedProto = request.headers["x-forwarded-proto"];
  const protocol = typeof forwardedProto === "string"
    ? forwardedProto
    : request.protocol || "http";
  const host = request.headers.host || "localhost";
  return `${protocol}://${host}${request.raw.url || request.url}`;
}

function normalizeHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "string" ? value : null;
}

function buildRequestInit(request: FastifyRequest): RequestInit {
  const headers = new Headers();
  Object.entries(request.headers).forEach(([key, value]) => {
    const normalized = normalizeHeaderValue(value);
    if (normalized) headers.set(key, normalized);
  });

  const method = request.raw.method || "GET";
  const init: RequestInit = { method, headers };
  if (method === "GET" || method === "HEAD") return init;
  if (request.body == null) return init;

  if (typeof request.body === "string" || Buffer.isBuffer(request.body)) {
    init.body = request.body as string | Buffer;
    return init;
  }

  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  init.body = JSON.stringify(request.body);
  return init;
}

export function toWebRequest(request: FastifyRequest): Request {
  return new Request(buildAbsoluteUrl(request), buildRequestInit(request));
}

export async function sendWebResponse(reply: FastifyReply, response: Response): Promise<void> {
  reply.code(response.status);
  response.headers.forEach((value, key) => {
    reply.header(key, value);
  });

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const text = await response.text();
    reply.send(text ? JSON.parse(text) : null);
    return;
  }

  reply.send(await response.text());
}

export function supabaseRoute<Database = unknown>(
  routeConfig: WithSupabaseConfig,
  handler: SupabaseWebHandler<Database>
) {
  const wrapped = withSupabase<Database>(
    {
      ...routeConfig,
      cors: false,
      env: {
        url: config.supabaseUrl,
        publishableKeys: { default: config.supabasePublishableKey },
        secretKeys: { default: config.supabaseSecretKey },
        jwks: config.supabaseJwksUrl ? new URL(config.supabaseJwksUrl) : null
      }
    },
    handler
  );

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!hasSupabaseEnv()) {
      reply.code(500).send({
        error: "Supabase is not configured.",
        missing: [
          !config.supabaseUrl ? "SUPABASE_URL" : null,
          !config.supabasePublishableKey ? "SUPABASE_PUBLISHABLE_KEY" : null,
          !config.supabaseSecretKey ? "SUPABASE_SECRET_KEY" : null
        ].filter(Boolean)
      });
      return;
    }

    const response = await wrapped(toWebRequest(request));
    await sendWebResponse(reply, response);
  };
}

export function getSupabaseConfigSummary() {
  return {
    configured: hasSupabaseEnv(),
    hasUrl: Boolean(config.supabaseUrl),
    hasPublishableKey: Boolean(config.supabasePublishableKey),
    hasSecretKey: Boolean(config.supabaseSecretKey),
    hasJwksUrl: Boolean(config.supabaseJwksUrl),
    urlHost: getSupabaseUrlHost()
  };
}
