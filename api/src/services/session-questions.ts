import type { RawDataPool } from "../db/raw-data-pg.js";

const SESSION_QUESTIONS_SQL = `
SELECT
  sq.survey_question_id::text AS survey_question_id,
  sq.title,
  sq.family,
  sq.qp_code,
  sq.order_number,
  sq.visible,
  sq.required,
  s.survey_id::text AS survey_id,
  s.name AS survey_name,
  COUNT(DISTINCT sra.survey_response_status_id)::int AS respondent_count,
  COUNT(sra.survey_response_answer_id)::int AS answer_row_count
FROM surveys.survey_question sq
JOIN surveys.survey_question_mapping sqm
  ON sqm.survey_question_id = sq.survey_question_id AND sqm.deleted_at IS NULL
JOIN surveys.session_survey_mapping ssm
  ON ssm.survey_id = sqm.survey_id AND ssm.session_id = $1::bigint AND ssm.deleted_at IS NULL
JOIN surveys.survey s ON s.survey_id = sqm.survey_id AND s.deleted_at IS NULL
LEFT JOIN surveys.survey_response_answer sra
  ON sra.survey_question_id = sq.survey_question_id AND sra.deleted_at IS NULL
WHERE sq.deleted_at IS NULL
GROUP BY sq.survey_question_id, sq.title, sq.family, sq.qp_code, sq.order_number,
         sq.visible, sq.required, s.survey_id, s.name
ORDER BY s.survey_id, sq.order_number NULLS LAST, sq.survey_question_id
`;

export type SessionQuestion = {
  survey_question_id: string;
  title: string | null;
  family: string | null;
  qp_code: string | null;
  order_number: number | null;
  visible: boolean | null;
  required: boolean | null;
  survey_id: string;
  survey_name: string | null;
  respondent_count: number;
  answer_row_count: number;
};

export type SessionQuestionsReport = {
  session_id: string;
  question_count: number;
  questions: SessionQuestion[];
};

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

function boolOrNull(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  return Boolean(v);
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapRow(row: Record<string, unknown>): SessionQuestion {
  return {
    survey_question_id: String(row.survey_question_id),
    title: strOrNull(row.title),
    family: strOrNull(row.family),
    qp_code: strOrNull(row.qp_code),
    order_number: numOrNull(row.order_number),
    visible: boolOrNull(row.visible),
    required: boolOrNull(row.required),
    survey_id: String(row.survey_id),
    survey_name: strOrNull(row.survey_name),
    respondent_count: Number(row.respondent_count ?? 0),
    answer_row_count: Number(row.answer_row_count ?? 0),
  };
}

export async function runSessionQuestions(
  pool: RawDataPool,
  sessionId: bigint,
): Promise<SessionQuestionsReport> {
  const result = await pool.query(SESSION_QUESTIONS_SQL, [sessionId.toString()]);
  const questions = (result.rows as Record<string, unknown>[]).map(mapRow);
  return {
    session_id: sessionId.toString(),
    question_count: questions.length,
    questions,
  };
}
