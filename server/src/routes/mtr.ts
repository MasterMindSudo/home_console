import { FastifyInstance } from "fastify";
import { getAllMtrStations, getMtrLines, getMtrStations, resolveMtrTrip } from "../adapters/mtr";

export async function mtrRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/mtr/lines", async () => getMtrLines());

  app.get("/api/mtr/stations", async () => getAllMtrStations());

  app.get<{ Params: { line: string } }>("/api/mtr/lines/:line/stations", async (request) => {
    return getMtrStations(request.params.line);
  });

  app.get<{ Querystring: { start: string; end: string } }>("/api/mtr/trip", async (request, reply) => {
    const trip = await resolveMtrTrip(request.query.start, request.query.end);
    if (!trip) return reply.code(422).send({ error: "Could not resolve an MTR route between these stations." });
    return trip;
  });
}
