import type { RawDataPool } from "../db/raw-data-pg.js";

export type AnswerFrequencyOptions = {
  sessionIds: bigint[];
  questionId?: bigint;
  qpCode?: string;
  /** Filter by response_status (e.g. "completed"). Null means all statuses. */
  filterStatus?: string;
  /** Max rows returned for choice/matrix counts (default 500). */
  limit?: number;
};

export type ChoiceCount = {
  value: string;
  count: number;
  pct: number;
};

export type MatrixCount = {
  row_label: string;
  value: string;
  count: number;
  pct: number;
};

export type AnswerFrequencyReport = {
  generated_at: string;
  session_ids: string[];
  question: {
    survey_question_id: string;
    title: string | null;
    family: string | null;
    qp_code: string | null;
  } | null;
  matched_question_ids: string[];
  total_respondents: number;
  filters: {
    question_id: string | null;
    qp_code: string | null;
    filter_status: string | null;
    limit: number;
  };
  /** Populated for single_choice, multiple_choice, open_ended families. */
  choice_counts: ChoiceCount[];
  /** Populated for matrix_single_choice family. */
  matrix_counts: MatrixCount[];
};

const QUESTION_BY_ID_SQL = `
SELECT sq.survey_question_id::text AS survey_question_id, sq.title, sq.family, sq.qp_code
FROM surveys.survey_question sq
WHERE sq.survey_question_id = $1::bigint AND sq.deleted_at IS NULL
LIMIT 1
`;

const QUESTION_BY_QP_CODE_SQL = `
SELECT DISTINCT ON (sq.qp_code)
  sq.survey_question_id::text AS survey_question_id, sq.title, sq.family, sq.qp_code
FROM surveys.survey_question sq
JOIN surveys.survey_question_mapping sqm ON sqm.survey_question_id = sq.survey_question_id AND sqm.deleted_at IS NULL
JOIN surveys.session_survey_mapping ssm ON ssm.survey_id = sqm.survey_id AND ssm.session_id = ANY($1::bigint[]) AND ssm.deleted_at IS NULL
WHERE sq.qp_code = $2 AND sq.deleted_at IS NULL
ORDER BY sq.qp_code, sq.survey_question_id
LIMIT 1
`;

/** All question_ids in the session(s) matching the given qp_code. */
const QP_CODE_QUESTION_IDS_SQL = `
SELECT DISTINCT sq.survey_question_id::text AS survey_question_id
FROM surveys.survey_question sq
JOIN surveys.survey_question_mapping sqm ON sqm.survey_question_id = sq.survey_question_id AND sqm.deleted_at IS NULL
JOIN surveys.session_survey_mapping ssm ON ssm.survey_id = sqm.survey_id AND ssm.session_id = ANY($1::bigint[]) AND ssm.deleted_at IS NULL
WHERE sq.qp_code = $2 AND sq.deleted_at IS NULL
`;

function buildChoiceCountSql(statusFilter: boolean): string {
  return `
SELECT answer[i][1] AS choice, COUNT(DISTINCT sra.survey_response_answer_id)::int AS cnt
FROM surveys.survey_response_answer sra
JOIN surveys.survey_response_status srs ON srs.survey_response_status_id = sra.survey_response_status_id AND srs.deleted_at IS NULL
JOIN surveys.session_survey_mapping ssm ON ssm.survey_id = srs.survey_id AND ssm.session_id = ANY($1::bigint[]) AND ssm.deleted_at IS NULL
CROSS JOIN generate_subscripts(sra.answer, 1) AS i
WHERE sra.survey_question_id = ANY($2::bigint[])
  AND sra.deleted_at IS NULL
  AND answer[i][1] IS NOT NULL AND answer[i][1] <> ''
  ${statusFilter ? "AND srs.response_status = $4" : ""}
GROUP BY answer[i][1]
ORDER BY cnt DESC
LIMIT $3
`;
}

function buildMatrixCountSql(statusFilter: boolean): string {
  return `
SELECT answer[i][1] AS row_label, answer[i][2] AS val, COUNT(DISTINCT sra.survey_response_answer_id)::int AS cnt
FROM surveys.survey_response_answer sra
JOIN surveys.survey_response_status srs ON srs.survey_response_status_id = sra.survey_response_status_id AND srs.deleted_at IS NULL
JOIN surveys.session_survey_mapping ssm ON ssm.survey_id = srs.survey_id AND ssm.session_id = ANY($1::bigint[]) AND ssm.deleted_at IS NULL
CROSS JOIN generate_subscripts(sra.answer, 1) AS i
WHERE sra.survey_question_id = ANY($2::bigint[])
  AND sra.deleted_at IS NULL
  AND answer[i][1] IS NOT NULL AND answer[i][1] <> ''
  ${statusFilter ? "AND srs.response_status = $4" : ""}
GROUP BY answer[i][1], answer[i][2]
ORDER BY answer[i][1], cnt DESC
LIMIT $3
`;
}

function buildRespondentCountSql(statusFilter: boolean): string {
  return `
SELECT COUNT(DISTINCT sra.survey_response_status_id)::int AS n
FROM surveys.survey_response_answer sra
JOIN surveys.survey_response_status srs ON srs.survey_response_status_id = sra.survey_response_status_id AND srs.deleted_at IS NULL
JOIN surveys.session_survey_mapping ssm ON ssm.survey_id = srs.survey_id AND ssm.session_id = ANY($1::bigint[]) AND ssm.deleted_at IS NULL
WHERE sra.survey_question_id = ANY($2::bigint[])
  AND sra.deleted_at IS NULL
  ${statusFilter ? "AND srs.response_status = $3" : ""}
`;
}

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

export async function runAnswerFrequency(
  pool: RawDataPool,
  options: AnswerFrequencyOptions,
): Promise<AnswerFrequencyReport> {
  const generatedAt = new Date().toISOString();
  const { sessionIds, questionId, qpCode, filterStatus, limit = 500 } = options;
  const idsParam = sessionIds.map((x) => x.toString());
  const hasStatus = filterStatus != null && filterStatus.trim().length > 0;

  let questionMeta: { survey_question_id: string; title: string | null; family: string | null; qp_code: string | null } | null = null;
  let matchedQuestionIds: bigint[] = [];

  if (questionId != null) {
    const qRes = await pool.query(QUESTION_BY_ID_SQL, [questionId.toString()]);
    const row = (qRes.rows as Record<string, unknown>[])[0];
    if (row) {
      questionMeta = {
        survey_question_id: String(row.survey_question_id),
        title: strOrNull(row.title),
        family: strOrNull(row.family),
        qp_code: strOrNull(row.qp_code),
      };
      matchedQuestionIds = [questionId];
    }
  } else if (qpCode != null && qpCode.trim().length > 0) {
    const [metaRes, idsRes] = await Promise.all([
      pool.query(QUESTION_BY_QP_CODE_SQL, [idsParam, qpCode.trim()]),
      pool.query(QP_CODE_QUESTION_IDS_SQL, [idsParam, qpCode.trim()]),
    ]);
    const metaRow = (metaRes.rows as Record<string, unknown>[])[0];
    if (metaRow) {
      questionMeta = {
        survey_question_id: String(metaRow.survey_question_id),
        title: strOrNull(metaRow.title),
        family: strOrNull(metaRow.family),
        qp_code: strOrNull(metaRow.qp_code),
      };
    }
    matchedQuestionIds = (idsRes.rows as { survey_question_id: string }[]).map(
      (r) => BigInt(r.survey_question_id),
    );
  }

  if (matchedQuestionIds.length === 0) {
    return {
      generated_at: generatedAt,
      session_ids: sessionIds.map((x) => x.toString()),
      question: questionMeta,
      matched_question_ids: [],
      total_respondents: 0,
      filters: {
        question_id: questionId != null ? questionId.toString() : null,
        qp_code: qpCode ?? null,
        filter_status: filterStatus ?? null,
        limit,
      },
      choice_counts: [],
      matrix_counts: [],
    };
  }

  const qidsParam = matchedQuestionIds.map((x) => x.toString());
  const isMatrix = questionMeta?.family === "matrix_single_choice";

  const respondentsArgs = hasStatus
    ? [idsParam, qidsParam, filterStatus]
    : [idsParam, qidsParam];

  const countArgs = hasStatus
    ? [idsParam, qidsParam, limit, filterStatus]
    : [idsParam, qidsParam, limit];

  const [respondentsRes, countsRes] = await Promise.all([
    pool.query(buildRespondentCountSql(hasStatus), respondentsArgs),
    pool.query(
      isMatrix ? buildMatrixCountSql(hasStatus) : buildChoiceCountSql(hasStatus),
      countArgs,
    ),
  ]);

  const totalRespondents = Number(
    (respondentsRes.rows[0] as { n?: unknown } | undefined)?.n ?? 0,
  );

  let choiceCounts: ChoiceCount[] = [];
  let matrixCounts: MatrixCount[] = [];

  if (isMatrix) {
    matrixCounts = (countsRes.rows as Record<string, unknown>[]).map((row) => ({
      row_label: String(row.row_label ?? ""),
      value: String(row.val ?? ""),
      count: Number(row.cnt ?? 0),
      pct: totalRespondents > 0 ? Math.round((Number(row.cnt ?? 0) / totalRespondents) * 10000) / 100 : 0,
    }));
  } else {
    choiceCounts = (countsRes.rows as Record<string, unknown>[]).map((row) => ({
      value: String(row.choice ?? ""),
      count: Number(row.cnt ?? 0),
      pct: totalRespondents > 0 ? Math.round((Number(row.cnt ?? 0) / totalRespondents) * 10000) / 100 : 0,
    }));
  }

  return {
    generated_at: generatedAt,
    session_ids: sessionIds.map((x) => x.toString()),
    question: questionMeta,
    matched_question_ids: matchedQuestionIds.map((x) => x.toString()),
    total_respondents: totalRespondents,
    filters: {
      question_id: questionId != null ? questionId.toString() : null,
      qp_code: qpCode ?? null,
      filter_status: filterStatus ?? null,
      limit,
    },
    choice_counts: choiceCounts,
    matrix_counts: matrixCounts,
  };
}
