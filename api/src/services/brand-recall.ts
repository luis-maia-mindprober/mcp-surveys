import type { RawDataPool } from "../db/raw-data-pg.js";
import {
  buildQuestionTitlePredicate,
  hasPgTrgm,
  type QuestionMatchMode,
} from "./question-title-filter.js";
import { INVENTORY_SQL, type InventoryRow } from "./session-brand-fit-report.js";

export type { QuestionMatchMode } from "./question-title-filter.js";

export type BrandRecallOptions = {
  sessionIds: bigint[];
  questionText?: string;
  questionMatchMode?: QuestionMatchMode;
  /**
   * List of brand names to search for inside free-text answers (case-insensitive substring).
   * When empty/omitted, returns raw token frequency instead.
   */
  brands?: string[];
  /** Min mentions to include a brand in results when using token frequency mode (default 1). */
  minMentions?: number;
  /** Max brands/tokens in token frequency result (default 100). */
  limit?: number;
};

export type BrandMentionRow = {
  brand: string;
  /** Respondents whose answer contained this brand (ILIKE match). */
  respondents_mentioning: number;
  pct_of_total: number;
};

export type BrandRecallFilters = {
  question_text: string | null;
  question_match_mode: QuestionMatchMode | null;
  similar_used_trigram: boolean | null;
  brands_searched: string[];
  min_mentions: number;
  limit: number;
};

export type BrandRecallReport = {
  generated_at: string;
  session_ids_requested: string[];
  filters: BrandRecallFilters;
  summary: {
    n_listed: number;
    n_mapped: number;
    n_no_mapping: number;
    total_respondents: number;
    matched_question_titles: string[];
  };
  /** Populated when brands were provided: per-brand mention counts. */
  brand_mentions: BrandMentionRow[];
  /**
   * Populated when no brands provided: token frequency from splitting
   * comma-separated free-text answers.
   */
  token_counts: Array<{ token: string; count: number }>;
  sessions_missing_survey_mapping: string[];
};

function mapInventoryRow(row: Record<string, unknown>): InventoryRow {
  return {
    session_id: String(row.session_id),
    survey_id: row.survey_id != null ? String(row.survey_id) : null,
    survey_name: row.survey_name != null ? String(row.survey_name) : null,
    provider: row.provider != null ? String(row.provider) : null,
    n_responses: Number(row.n_responses ?? 0),
    n_answer_rows: Number(row.n_answer_rows ?? 0),
  };
}

function buildAnswersFetchSql(titlePred: string): string {
  return `
SELECT DISTINCT ON (sra.survey_response_status_id)
  sra.survey_response_status_id,
  sra.answer[1][1] AS raw_answer
FROM surveys.survey_response_answer sra
JOIN surveys.survey_response_status srs
  ON srs.survey_response_status_id = sra.survey_response_status_id AND srs.deleted_at IS NULL
JOIN surveys.session_survey_mapping ssm ON ssm.survey_id = srs.survey_id AND ssm.deleted_at IS NULL
JOIN surveys.survey_question sq ON sq.survey_question_id = sra.survey_question_id AND sq.deleted_at IS NULL
WHERE ssm.session_id = ANY($1::bigint[])
  AND (${titlePred})
  AND sra.deleted_at IS NULL
  AND sq.family = 'open_ended'
ORDER BY sra.survey_response_status_id, sra.survey_response_answer_id
`;
}

function buildTitlesSql(titlePred: string): string {
  return `
SELECT DISTINCT sq.title
FROM surveys.survey_response_answer sra
JOIN surveys.survey_response_status srs
  ON srs.survey_response_status_id = sra.survey_response_status_id AND srs.deleted_at IS NULL
JOIN surveys.session_survey_mapping ssm ON ssm.survey_id = srs.survey_id AND ssm.deleted_at IS NULL
JOIN surveys.survey_question sq ON sq.survey_question_id = sra.survey_question_id AND sq.deleted_at IS NULL
WHERE ssm.session_id = ANY($1::bigint[])
  AND (${titlePred})
  AND sq.family = 'open_ended'
  AND sra.deleted_at IS NULL
ORDER BY 1
`;
}

/**
 * Split a free-text brand recall answer into candidate tokens.
 * Splits on commas and line breaks; normalises whitespace.
 */
function splitBrandTokens(raw: string): string[] {
  return raw
    .split(/[,\n\r]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 1);
}

export async function runBrandRecall(
  pool: RawDataPool,
  options: BrandRecallOptions,
): Promise<BrandRecallReport> {
  const generatedAt = new Date().toISOString();
  const {
    sessionIds,
    questionText,
    questionMatchMode,
    brands = [],
    minMentions = 1,
    limit = 100,
  } = options;

  const idsParam = sessionIds.map((x) => x.toString());
  const qText = (questionText ?? "brand").trim();
  const mode: QuestionMatchMode = questionMatchMode ?? "contains";

  const [invResult, useTrigram] = await Promise.all([
    pool.query(INVENTORY_SQL, [idsParam]),
    mode === "similar" ? hasPgTrgm(pool) : Promise.resolve(false),
  ]);

  const inventory = (invResult.rows as Record<string, unknown>[]).map(mapInventoryRow);
  const nMapped = inventory.filter((r) => r.survey_id != null).length;
  const nNoMapping = inventory.filter((r) => r.survey_id == null).length;
  const missingSessions = [
    ...new Set(inventory.filter((r) => r.survey_id == null).map((r) => r.session_id)),
  ].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0));

  const titlePred = buildQuestionTitlePredicate(mode, useTrigram);
  const answersSql = buildAnswersFetchSql(titlePred);
  const titlesSql = buildTitlesSql(titlePred);

  const [answersResult, titlesResult] = await Promise.all([
    pool.query(answersSql, [idsParam, qText]),
    pool.query(titlesSql, [idsParam, qText]),
  ]);

  const matchedTitles = (titlesResult.rows as { title?: unknown }[])
    .map((r) => (r.title != null ? String(r.title) : null))
    .filter((t): t is string => t != null && t.length > 0);

  const rawAnswers = (answersResult.rows as { raw_answer?: unknown }[])
    .map((r) => (r.raw_answer != null ? String(r.raw_answer) : null))
    .filter((a): a is string => a != null && a.trim().length > 0);

  const totalRespondents = rawAnswers.length;

  const filters: BrandRecallFilters = {
    question_text: qText,
    question_match_mode: mode,
    similar_used_trigram: mode === "similar" ? useTrigram : null,
    brands_searched: brands,
    min_mentions: minMentions,
    limit,
  };

  if (brands.length > 0) {
    const brandMentions: BrandMentionRow[] = brands.map((brand) => {
      const pattern = brand.trim().toLowerCase();
      const count = rawAnswers.filter((a) => a.toLowerCase().includes(pattern)).length;
      return {
        brand: brand.trim(),
        respondents_mentioning: count,
        pct_of_total: totalRespondents > 0 ? Math.round((count / totalRespondents) * 10000) / 100 : 0,
      };
    }).sort((a, b) => b.respondents_mentioning - a.respondents_mentioning);

    return {
      generated_at: generatedAt,
      session_ids_requested: idsParam,
      filters,
      summary: {
        n_listed: sessionIds.length,
        n_mapped: nMapped,
        n_no_mapping: nNoMapping,
        total_respondents: totalRespondents,
        matched_question_titles: matchedTitles,
      },
      brand_mentions: brandMentions,
      token_counts: [],
      sessions_missing_survey_mapping: missingSessions,
    };
  }

  // No brands provided: token frequency mode
  const tokenMap = new Map<string, number>();
  for (const answer of rawAnswers) {
    for (const token of splitBrandTokens(answer)) {
      tokenMap.set(token, (tokenMap.get(token) ?? 0) + 1);
    }
  }

  const tokenCounts = [...tokenMap.entries()]
    .filter(([, count]) => count >= minMentions)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([token, count]) => ({ token, count }));

  return {
    generated_at: generatedAt,
    session_ids_requested: idsParam,
    filters,
    summary: {
      n_listed: sessionIds.length,
      n_mapped: nMapped,
      n_no_mapping: nNoMapping,
      total_respondents: totalRespondents,
      matched_question_titles: matchedTitles,
    },
    brand_mentions: [],
    token_counts: tokenCounts,
    sessions_missing_survey_mapping: missingSessions,
  };
}
