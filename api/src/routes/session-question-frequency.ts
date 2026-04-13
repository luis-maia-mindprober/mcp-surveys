import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/env.js";
import { extractApiKey, safeKeyCompare } from "../config/mcp-auth.js";
import type { RawDataPool } from "../db/raw-data-pg.js";
import { runQuestionFrequency } from "../services/question-frequency.js";

const MAX_SESSION_IDS = 5000;

const VALID_FAMILIES = new Set([
  "single_choice",
  "multiple_choice",
  "matrix_single_choice",
  "open_ended",
  "static_text",
]);

export function registerSessionQuestionFrequencyRoutes(
  app: FastifyInstance,
  config: AppConfig,
  pool: RawDataPool | null,
): void {
  app.post<{
    Body: {
      session_ids?: unknown;
      family?: unknown;
      limit?: unknown;
    };
  }>("/v1/sessions/question-frequency", async (request, reply) => {
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
        error: "Question frequency requires database env: DB_HOST, DB_USER, DB_NAME.",
      });
    }

    const rawIds = request.body?.session_ids;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return reply.status(400).send({
        error: "session_ids must be a non-empty array of non-negative integers",
      });
    }

    if (rawIds.length > MAX_SESSION_IDS) {
      return reply.status(400).send({
        error: `session_ids must contain at most ${MAX_SESSION_IDS} entries`,
      });
    }

    const sessionIds: bigint[] = [];
    for (const item of rawIds) {
      const s = String(item).trim();
      if (!/^\d+$/.test(s)) {
        return reply.status(400).send({
          error: "each session_id must be a non-negative integer",
        });
      }
      sessionIds.push(BigInt(s));
    }

    let family: string | undefined;
    if (request.body?.family != null && String(request.body.family).trim() !== "") {
      const f = String(request.body.family).trim();
      if (!VALID_FAMILIES.has(f)) {
        return reply.status(400).send({
          error: `family must be one of: ${[...VALID_FAMILIES].join(", ")}`,
        });
      }
      family = f;
    }

    let limit: number | undefined;
    if (request.body?.limit != null && String(request.body.limit).trim() !== "") {
      const n = Number(request.body.limit);
      if (!Number.isInteger(n) || n < 1 || n > 10_000) {
        return reply.status(400).send({ error: "limit must be an integer between 1 and 10000" });
      }
      limit = n;
    }

    try {
      return await runQuestionFrequency(pool, { sessionIds, family, limit });
    } catch (err) {
      request.log.error({ err }, "question frequency query failed");
      return reply.status(500).send({ error: "Failed to build question frequency report" });
    }
  });
}
