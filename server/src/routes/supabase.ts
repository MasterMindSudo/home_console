import { FastifyInstance } from "fastify";
import { supabaseRoute, getSupabaseConfigSummary } from "../lib/supabase";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export async function supabaseRoutes(app: FastifyInstance) {
  app.get(
    "/api/supabase/status",
    supabaseRoute({ auth: "none" }, async (_request, ctx) => {
      return jsonResponse({
        ok: true,
        authMode: ctx.authMode,
        config: getSupabaseConfigSummary()
      });
    })
  );

  app.get(
    "/api/supabase/me",
    supabaseRoute({ auth: "user" }, async (_request, ctx) => {
      return jsonResponse({
        ok: true,
        authMode: ctx.authMode,
        userClaims: ctx.userClaims,
        jwtClaims: ctx.jwtClaims
      });
    })
  );
}
