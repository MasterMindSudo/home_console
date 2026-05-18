import { FastifyInstance } from "fastify";
import { TrafficFlowDebugPayload } from "../../../shared/types";
import { getCarEta } from "../adapters/tomtom";
import { getTrafficFlow } from "../adapters/trafficFlow";
import { getProfile } from "../db/profiles";

export async function debugRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { profileId: string }; Querystring: { force?: string } }>("/api/debug/traffic-flow/:profileId", async (request, reply) => {
    const profile = getProfile(request.params.profileId);
    if (!profile) return reply.code(404).send({ error: "Profile not found." });

    const forceRefresh = request.query.force === "true";
    const car = await getCarEta(profile.car, profile.latestArrivalTime, { forceRefresh, ignoreArrivalStop: true });
    const routeRoadNames = car.routeRoadNames || [];
    const trafficFlow = await getTrafficFlow(routeRoadNames);

    const payload: TrafficFlowDebugPayload = {
      profile: {
        id: profile.id,
        name: profile.name,
        latestArrivalTime: profile.latestArrivalTime,
        car: profile.car
      },
      generatedAt: new Date().toISOString(),
      forceRefresh,
      routeRoadNames,
      car,
      trafficFlow
    };

    return payload;
  });
}
