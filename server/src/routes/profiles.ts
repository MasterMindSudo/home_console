import { FastifyInstance } from "fastify";
import { createProfile, deleteProfile, getProfile, listProfiles, updateProfile } from "../db/profiles";
import { ProfileInput } from "../../../shared/types";

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/profiles", async () => listProfiles());

  app.get<{ Params: { id: string } }>("/api/profiles/:id", async (request, reply) => {
    const profile = getProfile(request.params.id);
    if (!profile) return reply.code(404).send({ error: "Profile not found." });
    return profile;
  });

  app.post<{ Body: ProfileInput }>("/api/profiles", async (request, reply) => {
    try {
      return reply.code(201).send(createProfile(request.body));
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid profile." });
    }
  });

  app.put<{ Params: { id: string }; Body: ProfileInput }>("/api/profiles/:id", async (request, reply) => {
    try {
      const profile = updateProfile(request.params.id, request.body);
      if (!profile) return reply.code(404).send({ error: "Profile not found." });
      return profile;
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid profile." });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/profiles/:id", async (request, reply) => {
    if (!deleteProfile(request.params.id)) return reply.code(404).send({ error: "Profile not found." });
    return reply.code(204).send();
  });
}
