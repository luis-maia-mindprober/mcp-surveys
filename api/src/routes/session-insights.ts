import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/env.js";
import { extractApiKey, safeKeyCompare } from "../config/mcp-auth.js";
import type { RawDataPool } from "../db/raw-data-pg.js";

const INSIGHTS_AGG_SQL = `
SELECT
  srs.survey_id,
  s.name AS survey_name,
  COUNT(*)::int AS response_count,
  COUNT(DISTINCT srs.tester_id)::int AS distinct_testers,
  ROUND(AVG(srs.completed_percentage)::numeric, 2) AS avg_completed_percentage,
  MIN(srs.start_time) AS earliest_response_start,
  MAX(COALESCE(srs.end_time, srs.start_time)) AS latest_activity,
  COUNT(*) FILTER (WHERE srs.is_duplicate IS TRUE)::int AS duplicate_rows
FROM surveys.survey_response_status srs
INNER JOIN surveys.session_survey_mapping m
  ON m.survey_id = srs.survey_id AND m.session_id = $1::bigint
LEFT JOIN surveys.survey s ON s.survey_id = srs.survey_id AND s.deleted_at IS NULL
WHERE m.deleted_at IS NULL AND srs.deleted_at IS NULL
GROUP BY srs.survey_id, s.name
ORDER BY srs.survey_id
`;

const INSIGHTS_STATUS_SQL = `
SELECT
  srs.survey_id,
  COALESCE(srs.response_status, '') AS response_status,
  COUNT(*)::int AS cnt
FROM surveys.survey_response_status srs
INNER JOIN surveys.session_survey_mapping m
  ON m.survey_id = srs.survey_id AND m.session_id = $1::bigint
WHERE m.deleted_at IS NULL AND srs.deleted_at IS NULL
GROUP BY srs.survey_id, srs.response_status
ORDER BY srs.survey_id, cnt DESC
`;

type SurveyInsight = {
  survey_id: string;
  survey_name: string | null;
  response_count: number;
  distinct_testers: number;
  avg_completed_percentage: string | null;
  earliest_response_start: string | null;
  latest_activity: string | null;
  duplicate_rows: number;
  response_status_breakdown: Record<string, number>;
};

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) {
    return null;
  }
  return String(v);
}

function mapAggRow(row: Record<string, unknown>): SurveyInsight {
  return {
    survey_id: String(row.survey_id),
    survey_name: strOrNull(row.survey_name),
    response_count: Number(row.response_count),
    distinct_testers: Number(row.distinct_testers),
    avg_completed_percentage: strOrNull(row.avg_completed_percentage),
    earliest_response_start: strOrNull(row.earliest_response_start),
    latest_activity: strOrNull(row.latest_activity),
    duplicate_rows: Number(row.duplicate_rows),
    response_status_breakdown: {},
  };
}

export function registerSessionInsightsRoutes(
  app: FastifyInstance,
  config: AppConfig,
  pool: RawDataPool | null,
): void {
  app.get<{
    Params: { sessionId?: string };
  }>("/v1/sessions/:sessionId/insights", async (request, reply) => {
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
          "Insights require database env: DB_HOST, DB_USER, DB_NAME (optional DB_PORT, DB_PASSWORD, DATABASE_POOL_MAX).",
      });
    }

    const raw = (request.params.sessionId ?? "").trim();
    if (!raw || !/^\d+$/.test(raw)) {
      return reply.status(400).send({
        error: "sessionId path parameter must be a non-negative integer",
      });
    }

    try {
      const [agg, statusRows] = await Promise.all([
        pool.query(INSIGHTS_AGG_SQL, [raw]),
        pool.query(INSIGHTS_STATUS_SQL, [raw]),
      ]);

      const bySurvey = new Map<string, SurveyInsight>();
      for (const row of agg.rows as Record<string, unknown>[]) {
        const insight = mapAggRow(row);
        bySurvey.set(insight.survey_id, insight);
      }

      for (const row of statusRows.rows as Record<string, unknown>[]) {
        const sid = String(row.survey_id);
        const bucket = bySurvey.get(sid);
        if (!bucket) {
          continue;
        }
        const key = String(row.response_status || "unknown");
        bucket.response_status_breakdown[key] = Number(row.cnt);
      }

      return {
        session_id: raw,
        survey_count: bySurvey.size,
        surveys: [...bySurvey.values()],
      };
    } catch (err) {
      request.log.error({ err }, "session insights query failed");
      return reply.status(500).send({
        error: "Failed to load session insights",
      });
    }
  });
}
