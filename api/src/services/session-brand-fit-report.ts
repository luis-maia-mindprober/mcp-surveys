import type { RawDataPool } from "../db/raw-data-pg.js";
import {
  buildAnswersSqlQuestionFilter,
  buildQuestionTitlePredicate,
  hasPgTrgm,
  type QuestionMatchMode,
} from "./question-title-filter.js";

export type { QuestionMatchMode } from "./question-title-filter.js";
export { MAX_QUESTION_TEXT_LEN } from "./question-title-filter.js";

export type BrandFitReportFilters = {
  question_text: string | null;
  /** Set when question_text was applied; null if only the default brand-fit answer phrases were used. */
  question_match_mode: QuestionMatchMode | null;
  /** When mode is similar: true if pg_trgm similarity was used; false if substring fallback. */
  similar_used_trigram: boolean | null;
};

export type PhraseVariant =
  | "en_long_show"
  | "en_long_match"
  | "en_short"
  | "es_matrix"
  | "es_juego_ajustan";

export const VARIANT_ROW_LABEL: Record<PhraseVariant, string> = {
  en_long_show: "The advertised brands featured in the show were a good fit",
  en_long_match:
    "The advertised brands featured in the match were a good fit",
  en_short: "The advertised brands were a good fit",
  es_matrix:
    "Las marcas promocionadas en el episodio se alinean bien al contenido",
  es_juego_ajustan:
    "Las marcas promocionadas durante el juego se ajustan bien al contenido",
};

const PATTERNS: ReadonlyArray<{ key: PhraseVariant; pattern: RegExp }> = [
  {
    key: "en_long_show",
    pattern:
      /"The advertised brands featured in the show were a good fit","([^"]+)"/,
  },
  {
    key: "en_long_match",
    pattern:
      /"The advertised brands featured in the match were a good fit","([^"]+)"/,
  },
  {
    key: "en_short",
    pattern: /"The advertised brands were a good fit","([^"]+)"/,
  },
  {
    key: "es_matrix",
    pattern:
      /"Las marcas promocionadas en el episodio se alinean bien al contenido\s*","([^"]+)"/,
  },
  {
    key: "es_juego_ajustan",
    pattern:
      /"Las marcas promocionadas durante el juego se ajustan bien al contenido\s*","([^"]+)"/,
  },
];

export function extractBrandFit(
  answerText: string | null | undefined,
): { phraseVariant: PhraseVariant; likert: string } | null {
  if (answerText == null || answerText === "") {
    return null;
  }
  for (const { key, pattern } of PATTERNS) {
    const m = pattern.exec(answerText);
    if (m) {
      return { phraseVariant: key, likert: m[1]!.trim() };
    }
  }
  return null;
}

export type InventoryRow = {
  session_id: string;
  survey_id: string | null;
  survey_name: string | null;
  provider: string | null;
  n_responses: number;
  n_answer_rows: number;
};

export type BrandFitCountRow = {
  session_id: string;
  survey_question_id: string;
  phrase_variant: PhraseVariant;
  brand_fit_likert: string;
  count: number;
};

export type BrandFitDetailRow = BrandFitCountRow & {
  survey_id: string | null;
  order_number: number | null;
  matrix_question_title: string | null;
  matrix_row_label: string;
};

export type MatrixQuestionRefRow = {
  survey_question_id: string;
  matrix_question_title: string | null;
  order_number: number | null;
  phrase_variants_seen: string | null;
};

export type SessionBrandFitReport = {
  generated_at: string;
  session_ids_requested: string[];
  filters: BrandFitReportFilters;
  summary: {
    n_listed: number;
    n_mapped: number;
    n_no_mapping: number;
    sessions_with_brand_fit_extractions: number;
  };
  inventory: InventoryRow[];
  brand_fit_counts: BrandFitCountRow[];
  brand_fit_detail: BrandFitDetailRow[];
  matrix_questions_reference: MatrixQuestionRefRow[];
  sessions_missing_survey_mapping: string[];
};

export const INVENTORY_SQL = `
WITH s AS (
  SELECT unnest($1::bigint[]) AS session_id
)
SELECT s.session_id::text AS session_id,
       ssm.survey_id::text AS survey_id,
       su.name AS survey_name,
       su.provider,
       COUNT(DISTINCT srs.survey_response_status_id)::int AS n_responses,
       COUNT(sra.survey_response_answer_id)::int AS n_answer_rows
FROM s
LEFT JOIN surveys.session_survey_mapping ssm ON ssm.session_id = s.session_id
LEFT JOIN surveys.survey su ON su.survey_id = ssm.survey_id
LEFT JOIN surveys.survey_response_status srs ON srs.survey_id = ssm.survey_id
LEFT JOIN surveys.survey_response_answer sra
  ON sra.survey_response_status_id = srs.survey_response_status_id
GROUP BY s.session_id, ssm.survey_id, su.name, su.provider
ORDER BY s.session_id
`;

const BRAND_FIT_ANSWER_PREDICATE = `
(
  sra.answer::text ILIKE '%The advertised brands featured in the show were a good fit%'
  OR sra.answer::text ILIKE '%The advertised brands featured in the match were a good fit%'
  OR sra.answer::text ILIKE '%The advertised brands were a good fit%'
  OR sra.answer::text ILIKE '%Las marcas promocionadas en el episodio se alinean bien al contenido%'
  OR sra.answer::text ILIKE '%Las marcas promocionadas durante el juego se ajustan bien al contenido%'
)
`;

const ANSWERS_SQL_BRAND_FIT_ONLY = `
SELECT ssm.session_id::text AS session_id,
       sra.survey_question_id::text AS survey_question_id,
       sra.answer::text AS answer_text
FROM surveys.survey_response_answer sra
JOIN surveys.survey_response_status srs
  ON srs.survey_response_status_id = sra.survey_response_status_id
JOIN surveys.session_survey_mapping ssm ON ssm.survey_id = srs.survey_id
WHERE ssm.session_id = ANY($1::bigint[])
  AND ${BRAND_FIT_ANSWER_PREDICATE}
`;

const QUESTIONS_SQL = `
SELECT survey_question_id::text AS survey_question_id,
       title AS matrix_question_title,
       order_number
FROM surveys.survey_question
WHERE survey_question_id = ANY($1::bigint[])
`;

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) {
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

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

/** First inventory row per session_id (matches pandas drop_duplicates("session_id")). */
function firstSurveyIdPerSession(inventory: InventoryRow[]): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const row of inventory) {
    if (!m.has(row.session_id)) {
      m.set(row.session_id, row.survey_id);
    }
  }
  return m;
}

function aggregateBrandFitCounts(
  rows: Array<{
    session_id: string;
    survey_question_id: string;
    phrase_variant: PhraseVariant;
    brand_fit_likert: string;
  }>,
): BrandFitCountRow[] {
  const map = new Map<string, BrandFitCountRow>();
  for (const r of rows) {
    const key = `${r.session_id}|${r.survey_question_id}|${r.phrase_variant}|${r.brand_fit_likert}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(key, {
        session_id: r.session_id,
        survey_question_id: r.survey_question_id,
        phrase_variant: r.phrase_variant,
        brand_fit_likert: r.brand_fit_likert,
        count: 1,
      });
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.session_id !== b.session_id) {
      return a.session_id.localeCompare(b.session_id);
    }
    if (a.survey_question_id !== b.survey_question_id) {
      return a.survey_question_id.localeCompare(b.survey_question_id);
    }
    if (a.phrase_variant !== b.phrase_variant) {
      return a.phrase_variant.localeCompare(b.phrase_variant);
    }
    return a.brand_fit_likert.localeCompare(b.brand_fit_likert);
  });
}

export type BrandFitReportOptions = {
  questionText?: string;
  questionMatchMode?: QuestionMatchMode;
};

export async function runSessionBrandFitReport(
  pool: RawDataPool,
  sessionIds: bigint[],
  options?: BrandFitReportOptions,
): Promise<SessionBrandFitReport> {
  const generatedAt = new Date().toISOString();
  const idsParam = sessionIds.map((x) => x.toString());

  const qText = (options?.questionText ?? "").trim();
  const mode: QuestionMatchMode = options?.questionMatchMode ?? "contains";

  let invResult;
  let ansResult;
  let filters: BrandFitReportFilters;

  if (qText.length === 0) {
    [invResult, ansResult] = await Promise.all([
      pool.query(INVENTORY_SQL, [idsParam]),
      pool.query(ANSWERS_SQL_BRAND_FIT_ONLY, [idsParam]),
    ]);
    filters = {
      question_text: null,
      question_match_mode: null,
      similar_used_trigram: null,
    };
  } else {
    const [inv, useTrigram] = await Promise.all([
      pool.query(INVENTORY_SQL, [idsParam]),
      mode === "similar" ? hasPgTrgm(pool) : Promise.resolve(false),
    ]);
    invResult = inv;
    const pred = buildQuestionTitlePredicate(mode, useTrigram);
    ansResult = await pool.query(buildAnswersSqlQuestionFilter(pred), [idsParam, qText]);
    filters = {
      question_text: qText,
      question_match_mode: mode,
      similar_used_trigram: mode === "similar" ? useTrigram : null,
    };
  }

  const inventory = (invResult.rows as Record<string, unknown>[]).map(mapInventoryRow);

  const extracted: Array<{
    session_id: string;
    survey_question_id: string;
    phrase_variant: PhraseVariant;
    brand_fit_likert: string;
  }> = [];

  for (const row of ansResult.rows as Record<string, unknown>[]) {
    const answerText = strOrNull(row.answer_text);
    const parsed = extractBrandFit(answerText);
    if (!parsed) {
      continue;
    }
    extracted.push({
      session_id: String(row.session_id),
      survey_question_id: String(row.survey_question_id),
      phrase_variant: parsed.phraseVariant,
      brand_fit_likert: parsed.likert,
    });
  }

  const brand_fit_counts = aggregateBrandFitCounts(extracted);

  const invSurveyFirst = firstSurveyIdPerSession(inventory);

  const qidSet = new Set<string>();
  for (const c of brand_fit_counts) {
    qidSet.add(c.survey_question_id);
  }
  const qids = [...qidSet].map((x) => BigInt(x));

  let qRows: Array<{
    survey_question_id: string;
    matrix_question_title: string | null;
    order_number: number | null;
  }> = [];

  if (qids.length > 0) {
    const qRes = await pool.query(QUESTIONS_SQL, [qids.map((x) => x.toString())]);
    qRows = (qRes.rows as Record<string, unknown>[]).map((row) => ({
      survey_question_id: String(row.survey_question_id),
      matrix_question_title: strOrNull(row.matrix_question_title),
      order_number: numOrNull(row.order_number),
    }));
  }

  const qById = new Map(qRows.map((r) => [r.survey_question_id, r]));

  const brand_fit_detail: BrandFitDetailRow[] = brand_fit_counts.map((c) => {
    const q = qById.get(c.survey_question_id);
    return {
      ...c,
      survey_id: invSurveyFirst.get(c.session_id) ?? null,
      order_number: q?.order_number ?? null,
      matrix_question_title: q?.matrix_question_title ?? null,
      matrix_row_label: VARIANT_ROW_LABEL[c.phrase_variant],
    };
  });

  const variantsByQid = new Map<string, Set<PhraseVariant>>();
  for (const c of brand_fit_counts) {
    let set = variantsByQid.get(c.survey_question_id);
    if (!set) {
      set = new Set();
      variantsByQid.set(c.survey_question_id, set);
    }
    set.add(c.phrase_variant);
  }

  const matrix_questions_reference: MatrixQuestionRefRow[] = qRows.map((q) => {
    const vs = variantsByQid.get(q.survey_question_id);
    const phrase_variants_seen =
      vs && vs.size > 0
        ? [...vs].map(String).sort().join(",")
        : null;
    return {
      survey_question_id: q.survey_question_id,
      matrix_question_title: q.matrix_question_title,
      order_number: q.order_number,
      phrase_variants_seen,
    };
  });

  const nMapped = inventory.filter((r) => r.survey_id != null).length;
  const nNoMapping = inventory.filter((r) => r.survey_id == null).length;

  const sessionsWithBf = new Set(brand_fit_counts.map((c) => c.session_id)).size;

  const missingSessions = [
    ...new Set(
      inventory
        .filter((r) => r.survey_id == null)
        .map((r) => r.session_id),
    ),
  ].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0));

  return {
    generated_at: generatedAt,
    session_ids_requested: sessionIds.map((x) => x.toString()),
    filters,
    summary: {
      n_listed: sessionIds.length,
      n_mapped: nMapped,
      n_no_mapping: nNoMapping,
      sessions_with_brand_fit_extractions: sessionsWithBf,
    },
    inventory,
    brand_fit_counts,
    brand_fit_detail,
    matrix_questions_reference,
    sessions_missing_survey_mapping: missingSessions,
  };
}
