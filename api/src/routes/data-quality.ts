import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/env.js";
import { extractApiKey, safeKeyCompare } from "../config/mcp-auth.js";
import type { RawDataPool } from "../db/raw-data-pg.js";
import { runDataQuality } from "../services/data-quality.js";

const MAX_SESSION_IDS = 100;

export function registerDataQualityRoutes(
  app: FastifyInstance,
  config: AppConfig,
  pool: RawDataPool | null,
): void {
  app.post<{
    Body: { session_ids?: unknown };
  }>("/v1/data-quality/check", async (request, reply) => {
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
        error: "Data quality check requires database env: DB_HOST, DB_USER, DB_NAME.",
      });
    }

    let sessionIds: bigint[] | null = null;
    const rawIds = request.body?.session_ids;

    if (rawIds != null) {
      if (!Array.isArray(rawIds) || rawIds.length === 0) {
        return reply.status(400).send({
          error: "session_ids must be a non-empty array of non-negative integers when provided",
        });
      }
      if (rawIds.length > MAX_SESSION_IDS) {
        return reply.status(400).send({
          error: `session_ids must contain at most ${MAX_SESSION_IDS} entries`,
        });
      }
      sessionIds = [];
      for (const item of rawIds) {
        const s = String(item).trim();
        if (!/^\d+$/.test(s)) {
          return reply.status(400).send({ error: "each session_id must be a non-negative integer" });
        }
        sessionIds.push(BigInt(s));
      }
    }

    try {
      const report = await runDataQuality(pool, sessionIds);
      return report;
    } catch (err) {
      request.log.error({ err }, "data quality check failed");
      return reply.status(500).send({ error: "Failed to run data quality check" });
    }
  });
}
