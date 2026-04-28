import type { RawDataPool } from "../db/raw-data-pg.js";

export type QuestionFrequencyOptions = {
  sessionIds: bigint[];
  /** Filter by question family (e.g. "single_choice"). Null means all families. */
  family?: string;
  /** Max rows returned (default 200). */
  limit?: number;
};

export type QuestionFrequencyRow = {
  /** qp_code when set, otherwise null. Rows with the same qp_code are merged. */
  qp_code: string | null;
  /** Representative title (from the most common question_id for this group). */
  title: string | null;
  family: string | null;
  /** How many of the requested sessions include this question. */
  session_count: number;
  /** Total distinct respondents who received this question across all sessions. */
  total_respondents: number;
  /** Total answer rows collected for this question across all sessions. */
  total_answer_rows: number;
  /** All distinct survey_question_ids that contributed to this row. */
  question_ids: string[];
};

export type QuestionFrequencyReport = {
  generated_at: string;
  session_ids: string[];
  filters: {
    family: string | null;
    limit: number;
  };
  question_count: number;
  questions: QuestionFrequencyRow[];
};

/** Aggregate by qp_code (when set) or by (title, family) as a fallback group key. */
const QUESTION_FREQUENCY_SQL = `
WITH base AS (
  SELECT
    sq.survey_question_id,
    sq.title,
    sq.family,
    sq.qp_code,
    ssm.session_id,
    COUNT(DISTINCT sra.survey_response_status_id) AS respondents,
    COUNT(sra.survey_response_answer_id) AS answer_rows
  FROM surveys.survey_question sq
  JOIN surveys.survey_question_mapping sqm
    ON sqm.survey_question_id = sq.survey_question_id AND sqm.deleted_at IS NULL
  JOIN surveys.session_survey_mapping ssm
    ON ssm.survey_id = sqm.survey_id AND ssm.session_id = ANY($1::bigint[]) AND ssm.deleted_at IS NULL
  LEFT JOIN surveys.survey_response_answer sra
    ON sra.survey_question_id = sq.survey_question_id AND sra.deleted_at IS NULL
  LEFT JOIN surveys.survey_response_status srs
    ON srs.survey_response_status_id = sra.survey_response_status_id AND srs.deleted_at IS NULL
  WHERE sq.deleted_at IS NULL
    AND ($2::text IS NULL OR sq.family = $2::text)
  GROUP BY sq.survey_question_id, sq.title, sq.family, sq.qp_code, ssm.session_id
),
grouped AS (
  SELECT
    COALESCE(qp_code, title || '|' || COALESCE(family, '')) AS group_key,
    qp_code,
    -- pick the title from the highest-respondent variant
    (array_agg(title ORDER BY respondents DESC NULLS LAST, survey_question_id))[1] AS title,
    (array_agg(family ORDER BY respondents DESC NULLS LAST, survey_question_id))[1] AS family,
    COUNT(DISTINCT session_id)::int AS session_count,
    SUM(respondents)::int AS total_respondents,
    SUM(answer_rows)::int AS total_answer_rows,
    array_agg(DISTINCT survey_question_id::text ORDER BY survey_question_id::text) AS question_ids
  FROM base
  GROUP BY group_key, qp_code
)
SELECT qp_code, title, family, session_count, total_respondents, total_answer_rows, question_ids
FROM grouped
ORDER BY session_count DESC, total_respondents DESC, title
LIMIT $3
`;

export async function runQuestionFrequency(
  pool: RawDataPool,
  options: QuestionFrequencyOptions,
): Promise<QuestionFrequencyReport> {
  const generatedAt = new Date().toISOString();
  const { sessionIds, family, limit = 200 } = options;
  const idsParam = sessionIds.map((x) => x.toString());

  const result = await pool.query(QUESTION_FREQUENCY_SQL, [
    idsParam,
    family ?? null,
    limit,
  ]);

  const questions: QuestionFrequencyRow[] = (result.rows as Record<string, unknown>[]).map((row) => ({
    qp_code: row.qp_code != null ? String(row.qp_code) : null,
    title: row.title != null ? String(row.title) : null,
    family: row.family != null ? String(row.family) : null,
    session_count: Number(row.session_count ?? 0),
    total_respondents: Number(row.total_respondents ?? 0),
    total_answer_rows: Number(row.total_answer_rows ?? 0),
    question_ids: Array.isArray(row.question_ids) ? (row.question_ids as unknown[]).map(String) : [],
  }));

  return {
    generated_at: generatedAt,
    session_ids: sessionIds.map((x) => x.toString()),
    filters: {
      family: family ?? null,
      limit,
    },
    question_count: questions.length,
    questions,
  };
}
