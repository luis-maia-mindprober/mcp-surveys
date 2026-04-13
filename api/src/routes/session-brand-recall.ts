import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/env.js";
import { extractApiKey, safeKeyCompare } from "../config/mcp-auth.js";
import type { RawDataPool } from "../db/raw-data-pg.js";
import { MAX_QUESTION_TEXT_LEN, type QuestionMatchMode } from "../services/question-title-filter.js";
import { runBrandRecall } from "../services/brand-recall.js";

const MAX_SESSION_IDS = 5000;
const MAX_BRANDS = 200;
const QUESTION_MATCH_MODES: readonly QuestionMatchMode[] = ["exact", "contains", "similar"];

function parseQuestionMatchMode(raw: unknown): QuestionMatchMode | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const s = String(raw).trim();
  if (s === "exact" || s === "contains" || s === "similar") return s;
  return null;
}

export function registerSessionBrandRecallRoutes(
  app: FastifyInstance,
  config: AppConfig,
  pool: RawDataPool | null,
): void {
  app.post<{
    Body: {
      session_ids?: unknown;
      question_text?: unknown;
      question_match_mode?: unknown;
      brands?: unknown;
      min_mentions?: unknown;
      limit?: unknown;
    };
  }>("/v1/sessions/brand-recall", async (request, reply) => {
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
        error: "Brand recall requires database env: DB_HOST, DB_USER, DB_NAME.",
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

    const qRaw = request.body?.question_text;
    const questionText = qRaw != null && String(qRaw).trim() !== "" ? String(qRaw).trim() : undefined;

    if (questionText && questionText.length > MAX_QUESTION_TEXT_LEN) {
      return reply.status(400).send({
        error: `question_text must be at most ${MAX_QUESTION_TEXT_LEN} characters`,
      });
    }

    const modeParsed = parseQuestionMatchMode(request.body?.question_match_mode);
    if (request.body?.question_match_mode != null && request.body?.question_match_mode !== "") {
      if (modeParsed == null) {
        return reply.status(400).send({
          error: `question_match_mode must be one of: ${QUESTION_MATCH_MODES.join(", ")}`,
        });
      }
    }

    const rawBrands = request.body?.brands;
    let brands: string[] = [];
    if (rawBrands != null) {
      if (!Array.isArray(rawBrands)) {
        return reply.status(400).send({ error: "brands must be an array of strings" });
      }
      if (rawBrands.length > MAX_BRANDS) {
        return reply.status(400).send({ error: `brands must contain at most ${MAX_BRANDS} entries` });
      }
      brands = rawBrands.map((b) => String(b).trim()).filter((b) => b.length > 0);
    }

    let minMentions: number | undefined;
    if (request.body?.min_mentions != null && String(request.body.min_mentions).trim() !== "") {
      const n = Number(request.body.min_mentions);
      if (!Number.isInteger(n) || n < 1) {
        return reply.status(400).send({ error: "min_mentions must be a positive integer" });
      }
      minMentions = n;
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
      return await runBrandRecall(pool, {
        sessionIds,
        questionText,
        questionMatchMode: modeParsed ?? undefined,
        brands,
        minMentions,
        limit,
      });
    } catch (err) {
      request.log.error({ err }, "brand recall query failed");
      return reply.status(500).send({ error: "Failed to build brand recall report" });
    }
  });
}
