import type { MetricsPool } from "../db/metrics-pg.js";
import type { RawDataPool } from "../db/raw-data-pg.js";

const MAX_SESSION_IDS = 100;

const TABLE_LABELS = [
  "session_survey_mapping",
  "survey",
  "survey_question_mapping",
  "survey_question",
  "survey_question_answers",
  "survey_response_status",
  "survey_response_answer",
  "testers_session_information (processed)",
] as const;

/** Row counts per session — mirrors inspectSession.ipynb TABLE queries (with deleted_at filters aligned to other API services). */
const COUNT_SQL: Record<(typeof TABLE_LABELS)[number], string> = {
  "session_survey_mapping": `
SELECT ssm.session_id::text AS session_id, COUNT(*)::int AS c
FROM surveys.session_survey_mapping ssm
WHERE ssm.session_id = ANY($1::bigint[]) AND ssm.deleted_at IS NULL
GROUP BY ssm.session_id`,

  survey: `
SELECT ssm.session_id::text AS session_id, COUNT(*)::int AS c
FROM surveys.survey s
INNER JOIN surveys.session_survey_mapping ssm ON ssm.survey_id = s.survey_id
WHERE ssm.session_id = ANY($1::bigint[]) AND ssm.deleted_at IS NULL AND s.deleted_at IS NULL
GROUP BY ssm.session_id`,

  survey_question_mapping: `
SELECT ssm.session_id::text AS session_id, COUNT(*)::int AS c
FROM surveys.survey_question_mapping sqm
INNER JOIN surveys.session_survey_mapping ssm ON ssm.survey_id = sqm.survey_id
WHERE ssm.session_id = ANY($1::bigint[]) AND ssm.deleted_at IS NULL AND sqm.deleted_at IS NULL
GROUP BY ssm.session_id`,

  survey_question: `
SELECT ssm.session_id::text AS session_id, COUNT(*)::int AS c
FROM surveys.survey_question sq
INNER JOIN surveys.survey_question_mapping sqm ON sqm.survey_question_id = sq.survey_question_id AND sqm.deleted_at IS NULL
INNER JOIN surveys.session_survey_mapping ssm ON ssm.survey_id = sqm.survey_id AND ssm.deleted_at IS NULL
WHERE ssm.session_id = ANY($1::bigint[]) AND sq.deleted_at IS NULL
GROUP BY ssm.session_id`,

  survey_question_answers: `
SELECT ssm.session_id::text AS session_id, COUNT(*)::int AS c
FROM surveys.survey_question_answers sqa
INNER JOIN surveys.survey_question sq ON sq.survey_question_answers_id = sqa.survey_question_answers_id AND sq.deleted_at IS NULL
INNER JOIN surveys.survey_question_mapping sqm ON sqm.survey_question_id = sq.survey_question_id AND sqm.deleted_at IS NULL
INNER JOIN surveys.session_survey_mapping ssm ON ssm.survey_id = sqm.survey_id AND ssm.deleted_at IS NULL
WHERE ssm.session_id = ANY($1::bigint[])
GROUP BY ssm.session_id`,

  survey_response_status: `
SELECT ssm.session_id::text AS session_id, COUNT(*)::int AS c
FROM surveys.survey_response_status srs
INNER JOIN surveys.session_survey_mapping ssm ON ssm.survey_id = srs.survey_id AND ssm.deleted_at IS NULL
WHERE ssm.session_id = ANY($1::bigint[]) AND srs.deleted_at IS NULL
GROUP BY ssm.session_id`,

  survey_response_answer: `
SELECT ssm.session_id::text AS session_id, COUNT(*)::int AS c
FROM surveys.survey_response_answer sra
INNER JOIN surveys.survey_response_status srs ON srs.survey_response_status_id = sra.survey_response_status_id AND srs.deleted_at IS NULL
INNER JOIN surveys.session_survey_mapping ssm ON ssm.survey_id = srs.survey_id AND ssm.deleted_at IS NULL
WHERE ssm.session_id = ANY($1::bigint[]) AND sra.deleted_at IS NULL
GROUP BY ssm.session_id`,

  "testers_session_information (processed)": `
SELECT session_id::text AS session_id, COUNT(*)::int AS c
FROM testers_session_information
WHERE session_id = ANY($1::bigint[]) AND processing_state_id = 'processed'
GROUP BY session_id`,
};

export type SessionInspectReport = {
  generated_at: string;
  session_ids: string[];
  row_counts_by_table: Record<string, Record<string, number>>;
};

function emptyCountsForSessions(sessionIdStrs: string[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const label of TABLE_LABELS) {
    out[label] = {};
    for (const sid of sessionIdStrs) {
      out[label][sid] = 0;
    }
  }
  return out;
}

export async function runSessionInspect(
  pool: RawDataPool,
  metricsPool: MetricsPool | null,
  sessionIds: bigint[],
): Promise<SessionInspectReport> {
  if (sessionIds.length === 0 || sessionIds.length > MAX_SESSION_IDS) {
    throw new Error(`session_ids must contain 1 to ${MAX_SESSION_IDS} entries`);
  }

  const sessionIdStrs = sessionIds.map((id) => id.toString());
  const row_counts_by_table = emptyCountsForSessions(sessionIdStrs);

  for (const label of TABLE_LABELS) {
    if (label === "testers_session_information (processed)") {
      if (!metricsPool) {
        continue;
      }
      const res = await metricsPool.query<{ session_id: string; c: number }>(
        COUNT_SQL[label],
        [sessionIds],
      );
      for (const row of res.rows) {
        if (row_counts_by_table[label][row.session_id] !== undefined) {
          row_counts_by_table[label][row.session_id] = row.c;
        }
      }
      continue;
    }

    const res = await pool.query<{ session_id: string; c: number }>(COUNT_SQL[label], [sessionIds]);
    for (const row of res.rows) {
      if (row_counts_by_table[label][row.session_id] !== undefined) {
        row_counts_by_table[label][row.session_id] = row.c;
      }
    }
  }

  return {
    generated_at: new Date().toISOString(),
    session_ids: sessionIdStrs,
    row_counts_by_table,
  };
}
