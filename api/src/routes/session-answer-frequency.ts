import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/env.js";
import { extractApiKey, safeKeyCompare } from "../config/mcp-auth.js";
import type { RawDataPool } from "../db/raw-data-pg.js";
import { runAnswerFrequency } from "../services/answer-frequency.js";

const MAX_SESSION_IDS = 5000;

export function registerSessionAnswerFrequencyRoutes(
  app: FastifyInstance,
  config: AppConfig,
  pool: RawDataPool | null,
): void {
  app.post<{
    Body: {
      session_ids?: unknown;
      question_id?: unknown;
      qp_code?: unknown;
      filter_status?: unknown;
      limit?: unknown;
    };
  }>("/v1/sessions/answer-frequency", async (request, reply) => {
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
        error: "Answer frequency requires database env: DB_HOST, DB_USER, DB_NAME.",
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

    const rawQId = request.body?.question_id;
    const rawQpCode = request.body?.qp_code;

    if (rawQId == null && (rawQpCode == null || String(rawQpCode).trim() === "")) {
      return reply.status(400).send({
        error: "Either question_id or qp_code is required",
      });
    }

    let questionId: bigint | undefined;
    if (rawQId != null && String(rawQId).trim() !== "") {
      const s = String(rawQId).trim();
      if (!/^\d+$/.test(s)) {
        return reply.status(400).send({ error: "question_id must be a non-negative integer" });
      }
      questionId = BigInt(s);
    }

    const qpCode = rawQpCode != null && String(rawQpCode).trim() !== ""
      ? String(rawQpCode).trim()
      : undefined;

    const filterStatus = request.body?.filter_status != null && String(request.body.filter_status).trim() !== ""
      ? String(request.body.filter_status).trim()
      : undefined;

    let limit: number | undefined;
    if (request.body?.limit != null && String(request.body.limit).trim() !== "") {
      const n = Number(request.body.limit);
      if (!Number.isInteger(n) || n < 1 || n > 10_000) {
        return reply.status(400).send({ error: "limit must be an integer between 1 and 10000" });
      }
      limit = n;
    }

    try {
      return await runAnswerFrequency(pool, { sessionIds, questionId, qpCode, filterStatus, limit });
    } catch (err) {
      request.log.error({ err }, "answer frequency query failed");
      return reply.status(500).send({ error: "Failed to build answer frequency report" });
    }
  });
}
