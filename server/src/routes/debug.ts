import { FastifyInstance } from "fastify";
import { TrafficFlowDebugPayload } from "../../../shared/types";
import { getCarEta, tomtomRuntimeInfo } from "../adapters/tomtom";
import { getTrafficFlow } from "../adapters/trafficFlow";
import { getProfile } from "../db/profiles";

export async function debugRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { profileId: string }; Querystring: { force?: string; tollFree?: string } }>("/api/debug/traffic-flow/:profileId", async (request, reply) => {
    const startedAt = Date.now();
    const profile = await getProfile(request.params.profileId);
    if (!profile) return reply.code(404).send({ error: "Profile not found." });

    const forceRefresh = request.query.force !== "false";
    const includeTollFree = request.query.tollFree === "true";
    const tomtomStartedAt = Date.now();
    const car = await getCarEta(profile.car, profile.latestArrivalTime, { forceRefresh, ignoreArrivalStop: true, includeTollFree });
    const tomtomFinishedAt = Date.now();
    const routeRoadNames = car.routeRoadNames || [];
    const trafficFlowStartedAt = Date.now();
    const trafficFlow = await getTrafficFlow(routeRoadNames);
    const finishedAt = Date.now();

    const payload: TrafficFlowDebugPayload = {
      profile: {
        id: profile.id,
        name: profile.name,
        latestArrivalTime: profile.latestArrivalTime,
        car: profile.car
      },
      generatedAt: new Date().toISOString(),
      forceRefresh,
      includeTollFree,
      timings: {
        totalMs: finishedAt - startedAt,
        tomtomMs: tomtomFinishedAt - tomtomStartedAt,
        trafficFlowMs: finishedAt - trafficFlowStartedAt
      },
      tomtom: tomtomRuntimeInfo(),
      routeRoadNames,
      car,
      trafficFlow
    };

    return payload;
  });
}
