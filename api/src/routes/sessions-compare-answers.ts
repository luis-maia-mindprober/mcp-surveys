import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/env.js";
import { extractApiKey, safeKeyCompare } from "../config/mcp-auth.js";
import type { RawDataPool } from "../db/raw-data-pg.js";

const MAX_SESSION_IDS = 20;

const QUESTION_META_SQL = `
SELECT DISTINCT ON (sq.qp_code)
  sq.survey_question_id::text AS survey_question_id, sq.title, sq.family, sq.qp_code
FROM surveys.survey_question sq
JOIN surveys.survey_question_mapping sqm ON sqm.survey_question_id = sq.survey_question_id AND sqm.deleted_at IS NULL
JOIN surveys.session_survey_mapping ssm ON ssm.survey_id = sqm.survey_id AND ssm.session_id = ANY($1::bigint[]) AND ssm.deleted_at IS NULL
WHERE sq.qp_code = $2 AND sq.deleted_at IS NULL
ORDER BY sq.qp_code, sq.survey_question_id
LIMIT 1
`;

const CHOICE_COUNTS_SQL = `
SELECT
  ssm.session_id::text AS session_id,
  answer[i][1] AS choice,
  COUNT(DISTINCT sra.survey_response_answer_id)::int AS cnt,
  COUNT(DISTINCT sra.survey_response_status_id)::int AS respondents
FROM surveys.survey_response_answer sra
JOIN surveys.survey_response_status srs ON srs.survey_response_status_id = sra.survey_response_status_id AND srs.deleted_at IS NULL
JOIN surveys.session_survey_mapping ssm ON ssm.survey_id = srs.survey_id AND ssm.session_id = ANY($1::bigint[]) AND ssm.deleted_at IS NULL
JOIN surveys.survey_question sq ON sq.survey_question_id = sra.survey_question_id AND sq.qp_code = $2 AND sq.deleted_at IS NULL
CROSS JOIN generate_subscripts(sra.answer, 1) AS i
WHERE sra.deleted_at IS NULL AND answer[i][1] IS NOT NULL AND answer[i][1] <> ''
GROUP BY ssm.session_id, answer[i][1]
ORDER BY ssm.session_id, cnt DESC
`;

const RESPONDENTS_PER_SESSION_SQL = `
SELECT
  ssm.session_id::text AS session_id,
  COUNT(DISTINCT sra.survey_response_status_id)::int AS respondents
FROM surveys.survey_response_answer sra
JOIN surveys.survey_response_status srs ON srs.survey_response_status_id = sra.survey_response_status_id AND srs.deleted_at IS NULL
JOIN surveys.session_survey_mapping ssm ON ssm.survey_id = srs.survey_id AND ssm.session_id = ANY($1::bigint[]) AND ssm.deleted_at IS NULL
JOIN surveys.survey_question sq ON sq.survey_question_id = sra.survey_question_id AND sq.qp_code = $2 AND sq.deleted_at IS NULL
WHERE sra.deleted_at IS NULL
GROUP BY ssm.session_id
`;

export function registerSessionsCompareAnswersRoutes(
  app: FastifyInstance,
  config: AppConfig,
  pool: RawDataPool | null,
): void {
  app.post<{
    Body: { session_ids?: unknown; qp_code?: unknown; limit?: unknown };
  }>("/v1/sessions/compare-answers", async (request, reply) => {
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
        error: "Compare answers requires database env: DB_HOST, DB_USER, DB_NAME.",
      });
    }

    const rawIds = request.body?.session_ids;
    if (!Array.isArray(rawIds) || rawIds.length < 2) {
      return reply.status(400).send({
        error: "session_ids must be an array with at least 2 non-negative integers",
      });
    }
    if (rawIds.length > MAX_SESSION_IDS) {
      return reply.status(400).send({ error: `session_ids must contain at most ${MAX_SESSION_IDS} entries` });
    }

    const sessionIds: bigint[] = [];
    for (const item of rawIds) {
      const s = String(item).trim();
      if (!/^\d+$/.test(s)) {
        return reply.status(400).send({ error: "each session_id must be a non-negative integer" });
      }
      sessionIds.push(BigInt(s));
    }

    const rawQpCode = request.body?.qp_code;
    if (!rawQpCode || String(rawQpCode).trim() === "") {
      return reply.status(400).send({ error: "qp_code is required" });
    }
    const qpCode = String(rawQpCode).trim();

    const rawLimit = request.body?.limit;
    let limit = 100;
    if (rawLimit != null) {
      limit = Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        return reply.status(400).send({ error: "limit must be an integer between 1 and 500" });
      }
    }

    try {
      const [metaRes, countsRes, respondentsRes] = await Promise.all([
        pool.query(QUESTION_META_SQL, [sessionIds, qpCode]),
        pool.query(CHOICE_COUNTS_SQL, [sessionIds, qpCode]),
        pool.query(RESPONDENTS_PER_SESSION_SQL, [sessionIds, qpCode]),
      ]);

      const sessionIdStrs = sessionIds.map((id) => id.toString());
      const respondentsMap: Record<string, number> = {};
      for (const row of respondentsRes.rows as Record<string, unknown>[]) {
        respondentsMap[String(row.session_id)] = Number(row.respondents ?? 0);
      }

      // Collect all unique answer values, then build a comparison row per value
      const valueMap: Map<string, Record<string, { count: number; pct: number }>> = new Map();
      for (const row of countsRes.rows as Record<string, unknown>[]) {
        const value = String(row.choice ?? "");
        const sid = String(row.session_id);
        const cnt = Number(row.cnt ?? 0);
        const totalRespondents = respondentsMap[sid] ?? 0;
        if (!valueMap.has(value)) {
          valueMap.set(value, {});
        }
        const entry = valueMap.get(value)!;
        entry[sid] = {
          count: cnt,
          pct: totalRespondents > 0 ? Math.round((cnt / totalRespondents) * 10000) / 100 : 0,
        };
      }

      // Build comparison table: array of { answer_value, per_session: { sid: { count, pct } } }
      const rows = Array.from(valueMap.entries())
        .map(([answer_value, per_session]) => ({ answer_value, per_session }))
        .slice(0, limit);

      const questionMeta = (metaRes.rows[0] as Record<string, unknown> | undefined) ?? null;

      return {
        generated_at: new Date().toISOString(),
        session_ids: sessionIdStrs,
        qp_code: qpCode,
        question: questionMeta
          ? {
              survey_question_id: String(questionMeta.survey_question_id),
              title: questionMeta.title != null ? String(questionMeta.title) : null,
              family: questionMeta.family != null ? String(questionMeta.family) : null,
              qp_code: questionMeta.qp_code != null ? String(questionMeta.qp_code) : null,
            }
          : null,
        respondents_per_session: respondentsMap,
        comparison: rows,
      };
    } catch (err) {
      request.log.error({ err }, "compare answers query failed");
      return reply.status(500).send({ error: "Failed to compare answers" });
    }
  });
}
