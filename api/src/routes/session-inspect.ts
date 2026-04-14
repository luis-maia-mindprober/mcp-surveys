import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/env.js";
import { extractApiKey, safeKeyCompare } from "../config/mcp-auth.js";
import type { MetricsPool } from "../db/metrics-pg.js";
import type { RawDataPool } from "../db/raw-data-pg.js";
import { runSessionInspect } from "../services/session-inspect.js";

const MAX_SESSION_IDS = 100;

export function registerSessionInspectRoutes(
  app: FastifyInstance,
  config: AppConfig,
  rawPool: RawDataPool | null,
  metricsPool: MetricsPool | null,
): void {
  app.post<{
    Body: {
      session_ids?: unknown;
    };
  }>("/v1/sessions/inspect", async (request, reply) => {
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

    if (!rawPool) {
      return reply.status(503).send({
        error: "Session inspect requires database env: DB_HOST, DB_USER, DB_NAME.",
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

    try {
      const report = await runSessionInspect(rawPool, metricsPool, sessionIds);
      return report;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("session_ids must contain")) {
        return reply.status(400).send({ error: msg });
      }
      request.log.error({ err }, "session inspect failed");
      return reply.status(500).send({ error: "Failed to run session inspect" });
    }
  });
}
