import { FastifyInstance } from "fastify";
import { buildDashboard } from "../services/dashboard";

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { profileId: string } }>("/api/dashboard/:profileId", async (request, reply) => {
    const dashboard = await buildDashboard(request.params.profileId);
    if (!dashboard) return reply.code(404).send({ error: "Profile not found." });
    return dashboard;
  });
}
