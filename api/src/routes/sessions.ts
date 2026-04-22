import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/env.js";
import { extractApiKey, safeKeyCompare } from "../config/mcp-auth.js";
import type { RawDataPool } from "../db/raw-data-pg.js";

const LIST_SESSIONS_SQL = `
SELECT
  ssm.session_id::text AS session_id,
  ssm.survey_id::text AS survey_id,
  ssm.session_survey_mapping_id::text AS session_survey_mapping_id,
  s.name AS survey_name,
  s.provider,
  s.url,
  ssm.created_at AS mapping_created_at
FROM surveys.session_survey_mapping ssm
INNER JOIN surveys.survey s ON s.survey_id = ssm.survey_id AND s.deleted_at IS NULL
WHERE ssm.deleted_at IS NULL
  AND ($1::text IS NULL OR s.name ILIKE '%' || $1 || '%')
  AND ($2::text IS NULL OR s.provider = $2)
ORDER BY ssm.session_id DESC
LIMIT $3 OFFSET $4
`;

const COUNT_SESSIONS_SQL = `
SELECT COUNT(*)::int AS total
FROM surveys.session_survey_mapping ssm
INNER JOIN surveys.survey s ON s.survey_id = ssm.survey_id AND s.deleted_at IS NULL
WHERE ssm.deleted_at IS NULL
  AND ($1::text IS NULL OR s.name ILIKE '%' || $1 || '%')
  AND ($2::text IS NULL OR s.provider = $2)
`;

export function registerSessionsRoutes(
  app: FastifyInstance,
  config: AppConfig,
  pool: RawDataPool | null,
): void {
  app.get<{
    Querystring: { limit?: string; offset?: string; survey_name?: string; provider?: string };
  }>("/v1/sessions", async (request, reply) => {
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
        error: "Sessions list requires database env: DB_HOST, DB_USER, DB_NAME.",
      });
    }

    const rawLimit = request.query.limit ?? "50";
    const rawOffset = request.query.offset ?? "0";
    const limit = Number(rawLimit);
    const offset = Number(rawOffset);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      return reply.status(400).send({ error: "limit must be an integer between 1 and 500" });
    }
    if (!Number.isInteger(offset) || offset < 0) {
      return reply.status(400).send({ error: "offset must be a non-negative integer" });
    }

    const surveyName = (request.query.survey_name ?? "").trim() || null;
    const provider = (request.query.provider ?? "").trim() || null;

    try {
      const [listRes, countRes] = await Promise.all([
        pool.query(LIST_SESSIONS_SQL, [surveyName, provider, limit, offset]),
        pool.query(COUNT_SESSIONS_SQL, [surveyName, provider]),
      ]);
      return {
        total: Number((countRes.rows[0] as { total?: unknown })?.total ?? 0),
        limit,
        offset,
        filters: { survey_name: surveyName, provider },
        sessions: listRes.rows,
      };
    } catch (err) {
      request.log.error({ err }, "list sessions query failed");
      return reply.status(500).send({ error: "Failed to list sessions" });
    }
  });
}
