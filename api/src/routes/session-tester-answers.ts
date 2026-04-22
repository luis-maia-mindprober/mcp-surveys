import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/env.js";
import { extractApiKey, safeKeyCompare } from "../config/mcp-auth.js";
import type { RawDataPool } from "../db/raw-data-pg.js";

const TESTER_ANSWERS_SQL = `
SELECT
  sra.survey_response_answer_id::text AS survey_response_answer_id,
  srs.survey_response_status_id::text AS survey_response_status_id,
  srs.response_status,
  srs.completed_percentage,
  srs.start_time,
  srs.end_time,
  sq.survey_question_id::text AS survey_question_id,
  sq.title AS question_title,
  sq.family AS question_family,
  sq.qp_code,
  sq.order_number,
  sra.answer
FROM surveys.survey_response_answer sra
JOIN surveys.survey_response_status srs
  ON srs.survey_response_status_id = sra.survey_response_status_id AND srs.deleted_at IS NULL
JOIN surveys.session_survey_mapping ssm
  ON ssm.survey_id = srs.survey_id AND ssm.session_id = $1::bigint AND ssm.deleted_at IS NULL
JOIN surveys.survey_question sq
  ON sq.survey_question_id = sra.survey_question_id AND sq.deleted_at IS NULL
WHERE srs.tester_id = $2::bigint
  AND sra.deleted_at IS NULL
  AND ssm.deleted_at IS NULL
ORDER BY srs.survey_response_status_id, sq.order_number NULLS LAST, sq.survey_question_id
`;

export function registerSessionTesterAnswersRoutes(
  app: FastifyInstance,
  config: AppConfig,
  pool: RawDataPool | null,
): void {
  app.get<{
    Params: { sessionId?: string; testerId?: string };
  }>("/v1/sessions/:sessionId/tester/:testerId/answers", async (request, reply) => {
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
        error: "Tester answers requires database env: DB_HOST, DB_USER, DB_NAME.",
      });
    }

    const rawSession = (request.params.sessionId ?? "").trim();
    if (!rawSession || !/^\d+$/.test(rawSession)) {
      return reply.status(400).send({
        error: "sessionId path parameter must be a non-negative integer",
      });
    }

    const rawTester = (request.params.testerId ?? "").trim();
    if (!rawTester || !/^\d+$/.test(rawTester)) {
      return reply.status(400).send({
        error: "testerId path parameter must be a non-negative integer",
      });
    }

    try {
      const res = await pool.query(TESTER_ANSWERS_SQL, [rawSession, rawTester]);
      return {
        generated_at: new Date().toISOString(),
        session_id: rawSession,
        tester_id: rawTester,
        answer_count: res.rows.length,
        answers: res.rows,
      };
    } catch (err) {
      request.log.error({ err }, "tester answers query failed");
      return reply.status(500).send({ error: "Failed to load tester answers" });
    }
  });
}
