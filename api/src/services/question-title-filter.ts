import type { RawDataPool } from "../db/raw-data-pg.js";

export type QuestionMatchMode = "exact" | "contains" | "similar";

export const MAX_QUESTION_TEXT_LEN = 2000;

export async function hasPgTrgm(pool: RawDataPool): Promise<boolean> {
  const r = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS has_trgm`,
  );
  return Boolean((r.rows[0] as { has_trgm?: boolean } | undefined)?.has_trgm);
}

/** SQL fragment using bind $2::text (survey_question joined as sq). */
export function buildQuestionTitlePredicate(mode: QuestionMatchMode, useTrigram: boolean): string {
  switch (mode) {
    case "exact":
      return `lower(trim(sq.title)) = lower(trim($2::text))`;
    case "contains":
      return `position(lower($2::text) in lower(sq.title)) > 0`;
    case "similar":
      if (useTrigram) {
        return `similarity(lower(sq.title), lower($2::text)) > 0.22`;
      }
      return `position(lower($2::text) in lower(sq.title)) > 0`;
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export function buildAnswersSqlQuestionFilter(titlePredicateSql: string): string {
  return `
SELECT ssm.session_id::text AS session_id,
       sra.survey_question_id::text AS survey_question_id,
       sra.answer::text AS answer_text
FROM surveys.survey_response_answer sra
JOIN surveys.survey_response_status srs
  ON srs.survey_response_status_id = sra.survey_response_status_id
JOIN surveys.session_survey_mapping ssm ON ssm.survey_id = srs.survey_id
JOIN surveys.survey_question sq ON sq.survey_question_id = sra.survey_question_id
WHERE ssm.session_id = ANY($1::bigint[])
  AND (${titlePredicateSql})
`;
}
