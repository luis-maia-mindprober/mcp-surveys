import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/env.js";
import { extractApiKey, safeKeyCompare } from "../config/mcp-auth.js";
import type { RawDataPool } from "../db/raw-data-pg.js";
import { MAX_QUESTION_TEXT_LEN, type QuestionMatchMode } from "../services/question-title-filter.js";
import { runOpenTextAnswerFrequency } from "../services/open-text-answer-frequency.js";

const MAX_SESSION_IDS = 5000;

const QUESTION_MATCH_MODES: readonly QuestionMatchMode[] = ["exact", "contains", "similar"];

function parseQuestionMatchMode(raw: unknown): QuestionMatchMode | null {
  if (raw === undefined || raw === null || raw === "") {
    return null;
  }
  const s = String(raw).trim();
  if (s === "exact" || s === "contains" || s === "similar") {
    return s;
  }
  return null;
}

function parsePositiveInt(raw: unknown, fallback: number, max: number): number | null {
  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1 || n > max) {
    return null;
  }
  return n;
}

export function registerSessionOpenTextFrequencyRoutes(
  app: FastifyInstance,
  config: AppConfig,
  pool: RawDataPool | null,
): void {
  app.post<{
    Body: {
      session_ids?: unknown;
      question_text?: unknown;
      question_match_mode?: unknown;
      min_token_length?: unknown;
      token_limit?: unknown;
      exact_answer_limit?: unknown;
    };
  }>("/v1/sessions/open-text-answer-frequency", async (request, reply) => {
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
        error:
          "Open-text frequency requires database env: DB_HOST, DB_USER, DB_NAME (optional DB_PORT, DB_PASSWORD, DATABASE_POOL_MAX).",
      });
    }

    const raw = request.body?.session_ids;
    if (!Array.isArray(raw) || raw.length === 0) {
      return reply.status(400).send({
        error: "session_ids must be a non-empty array of non-negative integer strings",
      });
    }

    if (raw.length > MAX_SESSION_IDS) {
      return reply.status(400).send({
        error: `session_ids must contain at most ${MAX_SESSION_IDS} entries`,
      });
    }

    const sessionIds: bigint[] = [];
    for (const item of raw) {
      const s = String(item).trim();
      if (!/^\d+$/.test(s)) {
        return reply.status(400).send({
          error: "each session_id must be a non-negative integer string",
        });
      }
      sessionIds.push(BigInt(s));
    }

    const qRaw = request.body?.question_text;
    const questionText = qRaw === undefined || qRaw === null ? "" : String(qRaw).trim();

    if (questionText.length === 0) {
      return reply.status(400).send({
        error: "question_text is required (match against surveys.survey_question.title)",
      });
    }

    if (questionText.length > MAX_QUESTION_TEXT_LEN) {
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

    const questionMatchMode: QuestionMatchMode = modeParsed ?? "contains";

    const minTokenLength = parsePositiveInt(request.body?.min_token_length, 2, 500);
    if (minTokenLength === null) {
      return reply.status(400).send({
        error: "min_token_length must be an integer between 1 and 500",
      });
    }

    const tokenLimit = parsePositiveInt(request.body?.token_limit, 100, 10_000);
    if (tokenLimit === null) {
      return reply.status(400).send({
        error: "token_limit must be an integer between 1 and 10000",
      });
    }

    const exactAnswerLimit = parsePositiveInt(request.body?.exact_answer_limit, 50, 10_000);
    if (exactAnswerLimit === null) {
      return reply.status(400).send({
        error: "exact_answer_limit must be an integer between 1 and 10000",
      });
    }

    try {
      const report = await runOpenTextAnswerFrequency(pool, sessionIds, {
        questionText,
        questionMatchMode,
        minTokenLength,
        tokenLimit,
        exactAnswerLimit,
      });
      return report;
    } catch (err) {
      request.log.error({ err }, "open-text answer frequency failed");
      return reply.status(500).send({
        error: "Failed to build open-text answer frequency report",
      });
    }
  });
}
