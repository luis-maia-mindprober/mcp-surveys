import type { RawDataPool } from "../db/raw-data-pg.js";
import {
  buildQuestionTitlePredicate,
  hasPgTrgm,
  type QuestionMatchMode,
} from "./question-title-filter.js";
import { INVENTORY_SQL, type InventoryRow } from "./session-brand-fit-report.js";

export type OpenTextAnswerFrequencyOptions = {
  questionText: string;
  questionMatchMode?: QuestionMatchMode;
  /** Minimum length of cleaned token (default 2). */
  minTokenLength?: number;
  /** Max rows in token_counts (default 100). */
  tokenLimit?: number;
  /** Max rows in exact_answer_counts (default 50). */
  exactAnswerLimit?: number;
};

export type OpenTextAnswerFrequencyFilters = {
  question_text: string;
  question_match_mode: QuestionMatchMode;
  similar_used_trigram: boolean | null;
  min_token_length: number;
  token_limit: number;
  exact_answer_limit: number;
};

export type OpenTextAnswerFrequencyReport = {
  generated_at: string;
  session_ids_requested: string[];
  filters: OpenTextAnswerFrequencyFilters;
  summary: {
    n_listed_sessions: number;
    n_mapped_sessions: number;
    n_no_mapping_sessions: number;
    n_respondents: number;
    matched_question_titles: string[];
  };
  /** Split on commas when the stored answer uses `{{"..."}}` (or `{{...}}`) wrappers; otherwise one token per respondent. */
  token_counts: Array<{ token: string; count: number }>;
  /** Full raw answer strings (trimmed), most frequent first. */
  exact_answer_counts: Array<{ answer: string; count: number }>;
  sessions_missing_survey_mapping: string[];
};

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) {
    return null;
  }
  return String(v);
}

function mapInventoryRow(row: Record<string, unknown>): InventoryRow {
  return {
    session_id: String(row.session_id),
    survey_id: row.survey_id != null ? String(row.survey_id) : null,
    survey_name: strOrNull(row.survey_name),
    provider: strOrNull(row.provider),
    n_responses: Number(row.n_responses ?? 0),
    n_answer_rows: Number(row.n_answer_rows ?? 0),
  };
}

function buildDedupCte(titlePredicateSql: string): string {
  return `
WITH dedup AS (
  SELECT DISTINCT ON (srs.survey_response_status_id)
    srs.survey_response_status_id,
    sra.answer::text AS ans
  FROM surveys.survey_response_answer sra
  JOIN surveys.survey_response_status srs
    ON srs.survey_response_status_id = sra.survey_response_status_id
  JOIN surveys.session_survey_mapping ssm ON ssm.survey_id = srs.survey_id
  JOIN surveys.survey_question sq ON sq.survey_question_id = sra.survey_question_id
  WHERE ssm.session_id = ANY($1::bigint[])
    AND (${titlePredicateSql})
  ORDER BY srs.survey_response_status_id, sra.survey_response_answer_id
)`;
}

export async function runOpenTextAnswerFrequency(
  pool: RawDataPool,
  sessionIds: bigint[],
  options: OpenTextAnswerFrequencyOptions,
): Promise<OpenTextAnswerFrequencyReport> {
  const generatedAt = new Date().toISOString();
  const idsParam = sessionIds.map((x) => x.toString());
  const qText = options.questionText.trim();
  const mode: QuestionMatchMode = options.questionMatchMode ?? "contains";
  const minTokenLength = options.minTokenLength ?? 2;
  const tokenLimit = options.tokenLimit ?? 100;
  const exactAnswerLimit = options.exactAnswerLimit ?? 50;

  const useTrigram = mode === "similar" ? await hasPgTrgm(pool) : false;
  const titlePred = buildQuestionTitlePredicate(mode, useTrigram);

  const dedupBase = buildDedupCte(titlePred);

  const titlesSql = `
SELECT DISTINCT sq.title AS title
FROM surveys.survey_response_answer sra
JOIN surveys.survey_response_status srs
  ON srs.survey_response_status_id = sra.survey_response_status_id
JOIN surveys.session_survey_mapping ssm ON ssm.survey_id = srs.survey_id
JOIN surveys.survey_question sq ON sq.survey_question_id = sra.survey_question_id
WHERE ssm.session_id = ANY($1::bigint[])
  AND (${titlePred})
ORDER BY 1
`;

  const tokenSql = `
${dedupBase}
,
extracted AS (
  SELECT
    COALESCE(
      substring(ans FROM '\\{\\{"(.*)"\\}\\}'),
      substring(ans FROM '\\{\\{([^}]*)\\}\\}')
    ) AS inner_text,
    trim(ans) AS raw_full
  FROM dedup
),
tokens AS (
  SELECT lower(trim(unnest(string_to_array(regexp_replace(inner_text, E'\\\\s+', ' ', 'g'), ',')))) AS token_raw
  FROM extracted
  WHERE inner_text IS NOT NULL AND length(trim(inner_text)) > 0
  UNION ALL
  SELECT lower(trim(raw_full)) AS token_raw
  FROM extracted
  WHERE inner_text IS NULL OR length(trim(inner_text)) = 0
)
SELECT token_clean AS token, COUNT(*)::int AS count
FROM (
  SELECT regexp_replace(trim(token_raw), '[^a-z0-9áàâãéêíóôõúç.'' -]', '', 'gi') AS token_clean
  FROM tokens
  WHERE length(trim(token_raw)) > 0
) t
WHERE length(token_clean) >= $3
GROUP BY token_clean
ORDER BY count DESC, token_clean ASC
LIMIT $4
`;

  const exactSql = `
${dedupBase}
SELECT trim(ans) AS answer, COUNT(*)::int AS count
FROM dedup
GROUP BY 1
ORDER BY count DESC, answer ASC
LIMIT $3
`;

  const respondentsSql = `
${dedupBase}
SELECT COUNT(*)::int AS n FROM dedup
`;

  const [invResult, titlesResult, tokenResult, exactResult, respondentsResult] = await Promise.all([
    pool.query(INVENTORY_SQL, [idsParam]),
    pool.query(titlesSql, [idsParam, qText]),
    pool.query(tokenSql, [idsParam, qText, minTokenLength, tokenLimit]),
    pool.query(exactSql, [idsParam, qText, exactAnswerLimit]),
    pool.query(respondentsSql, [idsParam, qText]),
  ]);

  const inventory = (invResult.rows as Record<string, unknown>[]).map(mapInventoryRow);
  const nMapped = inventory.filter((r) => r.survey_id != null).length;
  const nNoMapping = inventory.filter((r) => r.survey_id == null).length;

  const missingSessions = [
    ...new Set(
      inventory
        .filter((r) => r.survey_id == null)
        .map((r) => r.session_id),
    ),
  ].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0));

  const matched_question_titles = (titlesResult.rows as { title?: unknown }[])
    .map((r) => strOrNull(r.title))
    .filter((t): t is string => t != null && t.length > 0);

  const token_counts = (tokenResult.rows as Record<string, unknown>[]).map((row) => ({
    token: String(row.token ?? ""),
    count: Number(row.count ?? 0),
  }));

  const exact_answer_counts = (exactResult.rows as Record<string, unknown>[]).map((row) => ({
    answer: String(row.answer ?? ""),
    count: Number(row.count ?? 0),
  }));

  const nRespondents = Number(
    (respondentsResult.rows[0] as { n?: unknown } | undefined)?.n ?? 0,
  );

  return {
    generated_at: generatedAt,
    session_ids_requested: sessionIds.map((x) => x.toString()),
    filters: {
      question_text: qText,
      question_match_mode: mode,
      similar_used_trigram: mode === "similar" ? useTrigram : null,
      min_token_length: minTokenLength,
      token_limit: tokenLimit,
      exact_answer_limit: exactAnswerLimit,
    },
    summary: {
      n_listed_sessions: sessionIds.length,
      n_mapped_sessions: nMapped,
      n_no_mapping_sessions: nNoMapping,
      n_respondents: nRespondents,
      matched_question_titles,
    },
    token_counts,
    exact_answer_counts,
    sessions_missing_survey_mapping: missingSessions,
  };
}
