import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/env.js";
import { extractApiKey, safeKeyCompare } from "../config/mcp-auth.js";
import type { RawDataPool } from "../db/raw-data-pg.js";
import { runSessionQuestions } from "../services/session-questions.js";

export function registerSessionQuestionsRoutes(
  app: FastifyInstance,
  config: AppConfig,
  pool: RawDataPool | null,
): void {
  app.get<{
    Params: { sessionId?: string };
  }>("/v1/sessions/:sessionId/questions", async (request, reply) => {
    if (config.mcpApiKey) {
      const candidate = extractApiKey(
        request.headers["x-api-key"] as string | undefined,
        request.headers.authorization,
      );
      if (!candidate || !safeKeyCompare(candidate, config.mcpApiKey)) {
        return reply.status(401).send({
          error: "Invalid or missing API key (X-Api-Key or Authorization: Bearer)",
        });
      }
    }

    if (!pool) {
      return reply.status(503).send({
        error: "Session questions require database env: DB_HOST, DB_USER, DB_NAME.",
      });
    }

    const raw = (request.params.sessionId ?? "").trim();
    if (!raw || !/^\d+$/.test(raw)) {
      return reply.status(400).send({
        error: "sessionId path parameter must be a non-negative integer",
      });
    }

    try {
      return await runSessionQuestions(pool, BigInt(raw));
    } catch (err) {
      request.log.error({ err }, "session questions query failed");
      return reply.status(500).send({ error: "Failed to load session questions" });
    }
  });
}
