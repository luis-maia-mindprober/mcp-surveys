import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/env.js";
import { extractApiKey, safeKeyCompare } from "../config/mcp-auth.js";
import type { RawDataPool } from "../db/raw-data-pg.js";

const FUNNEL_SQL = `
WITH testers AS (
  SELECT COUNT(DISTINCT srs.tester_id)::int AS total_testers
  FROM surveys.survey_response_status srs
  INNER JOIN surveys.session_survey_mapping ssm
    ON ssm.survey_id = srs.survey_id AND ssm.session_id = $1::bigint AND ssm.deleted_at IS NULL
  WHERE srs.deleted_at IS NULL
),
questions AS (
  SELECT
    sq.survey_question_id::text AS survey_question_id,
    sq.title,
    sq.family,
    sq.qp_code,
    sq.order_number,
    COUNT(DISTINCT sra.survey_response_status_id)::int AS respondents
  FROM surveys.survey_question sq
  JOIN surveys.survey_question_mapping sqm
    ON sqm.survey_question_id = sq.survey_question_id AND sqm.deleted_at IS NULL
  JOIN surveys.session_survey_mapping ssm
    ON ssm.survey_id = sqm.survey_id AND ssm.session_id = $1::bigint AND ssm.deleted_at IS NULL
  LEFT JOIN surveys.survey_response_answer sra
    ON sra.survey_question_id = sq.survey_question_id AND sra.deleted_at IS NULL
  WHERE sq.deleted_at IS NULL
  GROUP BY sq.survey_question_id, sq.title, sq.family, sq.qp_code, sq.order_number
)
SELECT q.*, t.total_testers
FROM questions q, testers t
ORDER BY q.order_number NULLS LAST, q.survey_question_id
`;

export function registerSessionCompletionFunnelRoutes(
  app: FastifyInstance,
  config: AppConfig,
  pool: RawDataPool | null,
): void {
  app.get<{
    Params: { sessionId?: string };
  }>("/v1/sessions/:sessionId/completion-funnel", async (request, reply) => {
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
        error: "Completion funnel requires database env: DB_HOST, DB_USER, DB_NAME.",
      });
    }

    const raw = (request.params.sessionId ?? "").trim();
    if (!raw || !/^\d+$/.test(raw)) {
      return reply.status(400).send({
        error: "sessionId path parameter must be a non-negative integer",
      });
    }

    try {
      const res = await pool.query(FUNNEL_SQL, [raw]);
      const totalTesters = Number((res.rows[0] as { total_testers?: unknown } | undefined)?.total_testers ?? 0);
      const funnel = (res.rows as Record<string, unknown>[]).map((row) => {
        const respondents = Number(row.respondents ?? 0);
        const completionPct = totalTesters > 0 ? Math.round((respondents / totalTesters) * 10000) / 100 : null;
        const dropOffPct = totalTesters > 0 ? Math.round(((totalTesters - respondents) / totalTesters) * 10000) / 100 : null;
        return {
          survey_question_id: String(row.survey_question_id),
          title: row.title != null ? String(row.title) : null,
          family: row.family != null ? String(row.family) : null,
          qp_code: row.qp_code != null ? String(row.qp_code) : null,
          order_number: row.order_number != null ? Number(row.order_number) : null,
          respondents,
          total_testers: totalTesters,
          completion_pct: completionPct,
          drop_off_pct: dropOffPct,
        };
      });
      return {
        generated_at: new Date().toISOString(),
        session_id: raw,
        total_testers: totalTesters,
        question_count: funnel.length,
        funnel,
      };
    } catch (err) {
      request.log.error({ err }, "completion funnel query failed");
      return reply.status(500).send({ error: "Failed to load completion funnel" });
    }
  });
}
