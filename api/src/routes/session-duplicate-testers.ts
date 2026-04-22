import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/env.js";
import { extractApiKey, safeKeyCompare } from "../config/mcp-auth.js";
import type { RawDataPool } from "../db/raw-data-pg.js";

const MAX_SESSION_IDS = 100;

const DUPLICATE_TESTERS_SQL = `
SELECT
  ssm.session_id::text AS session_id,
  srs.tester_id::text AS tester_id,
  COUNT(*)::int AS response_count,
  array_agg(srs.survey_response_status_id::text ORDER BY srs.survey_response_status_id) AS response_status_ids,
  MIN(srs.start_time) AS first_response_start,
  MAX(COALESCE(srs.end_time, srs.start_time)) AS last_response_end,
  array_agg(DISTINCT srs.response_status ORDER BY srs.response_status) AS statuses
FROM surveys.survey_response_status srs
INNER JOIN surveys.session_survey_mapping ssm
  ON ssm.survey_id = srs.survey_id AND ssm.session_id = ANY($1::bigint[]) AND ssm.deleted_at IS NULL
WHERE srs.is_duplicate = TRUE AND srs.deleted_at IS NULL
GROUP BY ssm.session_id, srs.tester_id
ORDER BY ssm.session_id, response_count DESC, srs.tester_id
`;

export function registerSessionDuplicateTestersRoutes(
  app: FastifyInstance,
  config: AppConfig,
  pool: RawDataPool | null,
): void {
  app.post<{
    Body: { session_ids?: unknown };
  }>("/v1/sessions/duplicate-testers", async (request, reply) => {
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
        error: "Duplicate testers requires database env: DB_HOST, DB_USER, DB_NAME.",
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
        return reply.status(400).send({ error: "each session_id must be a non-negative integer" });
      }
      sessionIds.push(BigInt(s));
    }

    try {
      const res = await pool.query(DUPLICATE_TESTERS_SQL, [sessionIds]);
      const bySession: Record<string, { tester_id: string; response_count: number; response_status_ids: string[]; first_response_start: string | null; last_response_end: string | null; statuses: string[] }[]> = {};
      for (const sid of sessionIds) {
        bySession[sid.toString()] = [];
      }
      for (const row of res.rows as Record<string, unknown>[]) {
        const sid = String(row.session_id);
        if (bySession[sid]) {
          bySession[sid].push({
            tester_id: String(row.tester_id),
            response_count: Number(row.response_count ?? 0),
            response_status_ids: Array.isArray(row.response_status_ids)
              ? (row.response_status_ids as unknown[]).map(String)
              : [],
            first_response_start: row.first_response_start != null ? String(row.first_response_start) : null,
            last_response_end: row.last_response_end != null ? String(row.last_response_end) : null,
            statuses: Array.isArray(row.statuses) ? (row.statuses as unknown[]).map(String) : [],
          });
        }
      }
      return {
        generated_at: new Date().toISOString(),
        session_ids: sessionIds.map((id) => id.toString()),
        duplicate_testers_by_session: bySession,
      };
    } catch (err) {
      request.log.error({ err }, "duplicate testers query failed");
      return reply.status(500).send({ error: "Failed to load duplicate testers" });
    }
  });
}
