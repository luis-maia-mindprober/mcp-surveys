import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/env.js";
import { extractApiKey, safeKeyCompare } from "../config/mcp-auth.js";
import type { RawDataPool } from "../db/raw-data-pg.js";

function buildTimelineSQL(bucket: "hour" | "day"): string {
  const trunc = bucket === "hour" ? "hour" : "day";
  return `
SELECT
  date_trunc('${trunc}', srs.start_time) AS bucket,
  COUNT(*)::int AS response_count,
  COUNT(DISTINCT srs.tester_id)::int AS distinct_testers
FROM surveys.survey_response_status srs
INNER JOIN surveys.session_survey_mapping ssm
  ON ssm.survey_id = srs.survey_id AND ssm.session_id = $1::bigint AND ssm.deleted_at IS NULL
WHERE srs.deleted_at IS NULL AND srs.start_time IS NOT NULL
GROUP BY bucket
ORDER BY bucket
`;
}

export function registerSessionResponseTimelineRoutes(
  app: FastifyInstance,
  config: AppConfig,
  pool: RawDataPool | null,
): void {
  app.get<{
    Params: { sessionId?: string };
    Querystring: { bucket?: string };
  }>("/v1/sessions/:sessionId/response-timeline", async (request, reply) => {
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
        error: "Response timeline requires database env: DB_HOST, DB_USER, DB_NAME.",
      });
    }

    const raw = (request.params.sessionId ?? "").trim();
    if (!raw || !/^\d+$/.test(raw)) {
      return reply.status(400).send({
        error: "sessionId path parameter must be a non-negative integer",
      });
    }

    const rawBucket = (request.query.bucket ?? "hour").trim().toLowerCase();
    if (rawBucket !== "hour" && rawBucket !== "day") {
      return reply.status(400).send({ error: "bucket must be 'hour' or 'day'" });
    }
    const bucket = rawBucket as "hour" | "day";

    try {
      const res = await pool.query(buildTimelineSQL(bucket), [raw]);
      const timeline = (res.rows as Record<string, unknown>[]).map((row) => ({
        bucket: row.bucket != null ? String(row.bucket) : null,
        response_count: Number(row.response_count ?? 0),
        distinct_testers: Number(row.distinct_testers ?? 0),
      }));
      return {
        generated_at: new Date().toISOString(),
        session_id: raw,
        bucket,
        point_count: timeline.length,
        timeline,
      };
    } catch (err) {
      request.log.error({ err }, "response timeline query failed");
      return reply.status(500).send({ error: "Failed to load response timeline" });
    }
  });
}
