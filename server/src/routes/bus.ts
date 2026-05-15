import { FastifyInstance } from "fastify";
import { BusOperator } from "../../../shared/types";
import { getBusDirections, getBusStops, searchBusRoutes } from "../adapters/bus";

export async function busRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { query?: string } }>("/api/bus/routes", async (request) => {
    return searchBusRoutes(request.query.query || "");
  });

  app.get<{ Params: { route: string } }>("/api/bus/routes/:route/directions", async (request) => {
    return getBusDirections(request.params.route);
  });

  app.get<{
    Params: { route: string; direction: "inbound" | "outbound" };
    Querystring: { operators?: string; serviceType?: string; operatorDirections?: string };
  }>("/api/bus/routes/:route/directions/:direction/stops", async (request) => {
    const operators = (request.query.operators || "KMB")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean) as BusOperator[];
    const operatorDirections = (request.query.operatorDirections || "").split(",").reduce((acc, item) => {
      const [operator, direction] = item.split(":");
      if (operator && (direction === "inbound" || direction === "outbound")) {
        acc[operator as BusOperator] = direction;
      }
      return acc;
    }, {} as Partial<Record<BusOperator, "inbound" | "outbound">>);
    return getBusStops(request.params.route, request.params.direction, operators, request.query.serviceType, operatorDirections);
  });
}
