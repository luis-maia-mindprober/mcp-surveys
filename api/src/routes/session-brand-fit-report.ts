import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/env.js";
import { extractApiKey, safeKeyCompare } from "../config/mcp-auth.js";
import type { RawDataPool } from "../db/raw-data-pg.js";
import type { QuestionMatchMode } from "../services/session-brand-fit-report.js";
import {
  MAX_QUESTION_TEXT_LEN,
  runSessionBrandFitReport,
} from "../services/session-brand-fit-report.js";

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

export function registerSessionBrandFitReportRoutes(
  app: FastifyInstance,
  config: AppConfig,
  pool: RawDataPool | null,
): void {
  app.post<{
    Body: {
      session_ids?: unknown;
      question_text?: unknown;
      question_match_mode?: unknown;
    };
  }>("/v1/sessions/brand-fit-report", async (request, reply) => {
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
          "Brand-fit report requires database env: DB_HOST, DB_USER, DB_NAME (optional DB_PORT, DB_PASSWORD, DATABASE_POOL_MAX).",
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
    const questionText =
      qRaw === undefined || qRaw === null ? "" : String(qRaw).trim();

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

    try {
      const report = await runSessionBrandFitReport(pool, sessionIds, {
        questionText: questionText.length > 0 ? questionText : undefined,
        questionMatchMode: questionText.length > 0 ? questionMatchMode : undefined,
      });
      return report;
    } catch (err) {
      request.log.error({ err }, "session brand-fit report failed");
      return reply.status(500).send({
        error: "Failed to build session brand-fit report",
      });
    }
  });
}
