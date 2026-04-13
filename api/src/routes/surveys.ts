import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/env.js";
import { extractApiKey, safeKeyCompare } from "../config/mcp-auth.js";
import type { RawDataPool } from "../db/raw-data-pg.js";

const SURVEYS_BY_SESSION_SQL = `
SELECT
  m.session_survey_mapping_id,
  m.session_id,
  m.survey_id,
  m.created_at AS mapping_created_at,
  m.updated_at AS mapping_updated_at,
  s.name,
  s.description,
  s.provider,
  s.provider_survey_id,
  s.comment,
  s.url,
  s.created_at AS survey_created_at,
  s.updated_at AS survey_updated_at
FROM surveys.session_survey_mapping m
INNER JOIN surveys.survey s ON s.survey_id = m.survey_id
WHERE m.session_id = $1::bigint
  AND m.deleted_at IS NULL
  AND s.deleted_at IS NULL
ORDER BY m.session_survey_mapping_id
`;

export function registerSurveysRoutes(
  app: FastifyInstance,
  config: AppConfig,
  pool: RawDataPool | null,
): void {
  app.get<{
    Querystring: { session_id?: string };
  }>("/v1/surveys", async (request, reply) => {
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
          "Surveys require database env: DB_HOST, DB_USER, DB_NAME (optional DB_PORT, DB_PASSWORD, DATABASE_POOL_MAX).",
      });
    }

    const raw = (request.query.session_id ?? "").trim();
    if (!raw) {
      return reply.status(400).send({
        error: "session_id query parameter is required",
      });
    }

    if (!/^\d+$/.test(raw)) {
      return reply.status(400).send({
        error: "session_id must be a non-negative integer",
      });
    }

    const sessionId = BigInt(raw);

    try {
      const result = await pool.query(SURVEYS_BY_SESSION_SQL, [sessionId.toString()]);
      return {
        session_id: sessionId.toString(),
        count: result.rowCount ?? result.rows.length,
        surveys: result.rows,
      };
    } catch (err) {
      request.log.error({ err }, "surveys by session_id query failed");
      return reply.status(500).send({
        error: "Failed to load surveys",
      });
    }
  });
}
