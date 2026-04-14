import type { RawDataPool } from "../db/raw-data-pg.js";

const MAX_SAMPLE = 20;

export type CheckResult = {
  check: string;
  description: string;
  status: "ok" | "warning";
  broken_count: number;
  /** Up to MAX_SAMPLE broken rows. */
  sample: Record<string, unknown>[];
};

export type DataQualityReport = {
  generated_at: string;
  /** Session IDs used to scope checks. Null means global (all data). */
  session_ids: string[] | null;
  checks: CheckResult[];
  total_warnings: number;
};

// ─── helpers ────────────────────────────────────────────────────────────────

async function runCheck(
  pool: RawDataPool,
  checkName: string,
  description: string,
  sql: string,
  params: unknown[],
): Promise<CheckResult> {
  const res = await pool.query<Record<string, unknown>>(sql, params);
  const broken_count = res.rows.length;
  return {
    check: checkName,
    description,
    status: broken_count === 0 ? "ok" : "warning",
    broken_count,
    sample: res.rows.slice(0, MAX_SAMPLE),
  };
}

// ─── checks ─────────────────────────────────────────────────────────────────

/** Check 1: survey_question_mapping → survey_question (broken FK) */
async function check1(pool: RawDataPool, sessionIds: bigint[] | null): Promise<CheckResult> {
  const scopeJoin = sessionIds
    ? `INNER JOIN surveys.session_survey_mapping _ssm ON _ssm.survey_id = sqm.survey_id AND _ssm.session_id = ANY($1::bigint[]) AND _ssm.deleted_at IS NULL`
    : "";
  const sql = `
SELECT sqm.survey_question_mapping_id::text, sqm.survey_id::text, sqm.survey_question_id::text
FROM surveys.survey_question_mapping sqm
${scopeJoin}
LEFT JOIN surveys.survey_question sq ON sq.survey_question_id = sqm.survey_question_id AND sq.deleted_at IS NULL
WHERE sq.survey_question_id IS NULL AND sqm.deleted_at IS NULL
ORDER BY sqm.survey_question_mapping_id
LIMIT ${MAX_SAMPLE + 1}`;
  return runCheck(pool, "sqm_broken_question_ref",
    "survey_question_mapping rows pointing to a non-existent survey_question",
    sql, sessionIds ? [sessionIds] : []);
}

/** Check 2: survey_question_mapping → survey (broken FK) */
async function check2(pool: RawDataPool, sessionIds: bigint[] | null): Promise<CheckResult> {
  const scopeJoin = sessionIds
    ? `INNER JOIN surveys.session_survey_mapping _ssm ON _ssm.survey_id = sqm.survey_id AND _ssm.session_id = ANY($1::bigint[]) AND _ssm.deleted_at IS NULL`
    : "";
  const sql = `
SELECT sqm.survey_question_mapping_id::text, sqm.survey_id::text, sqm.survey_question_id::text
FROM surveys.survey_question_mapping sqm
${scopeJoin}
LEFT JOIN surveys.survey s ON s.survey_id = sqm.survey_id AND s.deleted_at IS NULL
WHERE s.survey_id IS NULL AND sqm.deleted_at IS NULL
ORDER BY sqm.survey_id
LIMIT ${MAX_SAMPLE + 1}`;
  return runCheck(pool, "sqm_broken_survey_ref",
    "survey_question_mapping rows pointing to a non-existent survey",
    sql, sessionIds ? [sessionIds] : []);
}

/** Check 3: survey_question → survey_question_answers (broken FK when answers_id is set) */
async function check3(pool: RawDataPool, sessionIds: bigint[] | null): Promise<CheckResult> {
  const scopeJoin = sessionIds
    ? `INNER JOIN surveys.survey_question_mapping sqm ON sqm.survey_question_id = sq.survey_question_id AND sqm.deleted_at IS NULL
       INNER JOIN surveys.session_survey_mapping _ssm ON _ssm.survey_id = sqm.survey_id AND _ssm.session_id = ANY($1::bigint[]) AND _ssm.deleted_at IS NULL`
    : "";
  const sql = `
SELECT sq.survey_question_id::text, sq.title, sq.survey_question_answers_id::text
FROM surveys.survey_question sq
${scopeJoin}
LEFT JOIN surveys.survey_question_answers sqa ON sqa.survey_question_answers_id = sq.survey_question_answers_id
WHERE sq.survey_question_answers_id IS NOT NULL AND sqa.survey_question_answers_id IS NULL AND sq.deleted_at IS NULL
ORDER BY sq.survey_question_id
LIMIT ${MAX_SAMPLE + 1}`;
  return runCheck(pool, "sq_broken_answers_ref",
    "survey_question rows pointing to a non-existent survey_question_answers",
    sql, sessionIds ? [sessionIds] : []);
}

/** Check 4: survey_response_answer → survey_question (broken FK) */
async function check4(pool: RawDataPool, sessionIds: bigint[] | null): Promise<CheckResult> {
  const scopeJoin = sessionIds
    ? `INNER JOIN surveys.survey_response_status srs ON srs.survey_response_status_id = sra.survey_response_status_id AND srs.deleted_at IS NULL
       INNER JOIN surveys.session_survey_mapping _ssm ON _ssm.survey_id = srs.survey_id AND _ssm.session_id = ANY($1::bigint[]) AND _ssm.deleted_at IS NULL`
    : "";
  const sql = `
SELECT sra.survey_response_answer_id::text, sra.survey_response_status_id::text, sra.survey_question_id::text
FROM surveys.survey_response_answer sra
${scopeJoin}
LEFT JOIN surveys.survey_question sq ON sq.survey_question_id = sra.survey_question_id AND sq.deleted_at IS NULL
WHERE sq.survey_question_id IS NULL AND sra.deleted_at IS NULL
ORDER BY sra.survey_response_answer_id
LIMIT ${MAX_SAMPLE + 1}`;
  return runCheck(pool, "sra_broken_question_ref",
    "survey_response_answer rows pointing to a non-existent survey_question",
    sql, sessionIds ? [sessionIds] : []);
}

/** Check 5: survey_response_answer → survey_response_status (broken FK) */
async function check5(pool: RawDataPool, sessionIds: bigint[] | null): Promise<CheckResult> {
  const scopeJoin = sessionIds
    ? `INNER JOIN surveys.survey_response_status srs2 ON srs2.survey_response_status_id = sra.survey_response_status_id AND srs2.deleted_at IS NULL
       INNER JOIN surveys.session_survey_mapping _ssm ON _ssm.survey_id = srs2.survey_id AND _ssm.session_id = ANY($1::bigint[]) AND _ssm.deleted_at IS NULL`
    : "";
  const sql = `
SELECT sra.survey_response_answer_id::text, sra.survey_response_status_id::text, sra.survey_question_id::text
FROM surveys.survey_response_answer sra
${scopeJoin}
LEFT JOIN surveys.survey_response_status srs ON srs.survey_response_status_id = sra.survey_response_status_id AND srs.deleted_at IS NULL
WHERE srs.survey_response_status_id IS NULL AND sra.deleted_at IS NULL
ORDER BY sra.survey_response_answer_id
LIMIT ${MAX_SAMPLE + 1}`;
  return runCheck(pool, "sra_broken_status_ref",
    "survey_response_answer rows pointing to a non-existent survey_response_status",
    sql, sessionIds ? [sessionIds] : []);
}

/** Check 6: survey_response_status → survey (broken FK) */
async function check6(pool: RawDataPool, sessionIds: bigint[] | null): Promise<CheckResult> {
  const scopeJoin = sessionIds
    ? `INNER JOIN surveys.session_survey_mapping _ssm ON _ssm.survey_id = srs.survey_id AND _ssm.session_id = ANY($1::bigint[]) AND _ssm.deleted_at IS NULL`
    : "";
  const sql = `
SELECT srs.survey_response_status_id::text, srs.survey_id::text
FROM surveys.survey_response_status srs
${scopeJoin}
LEFT JOIN surveys.survey s ON s.survey_id = srs.survey_id AND s.deleted_at IS NULL
WHERE s.survey_id IS NULL AND srs.deleted_at IS NULL
ORDER BY srs.survey_response_status_id
LIMIT ${MAX_SAMPLE + 1}`;
  return runCheck(pool, "srs_broken_survey_ref",
    "survey_response_status rows pointing to a non-existent survey",
    sql, sessionIds ? [sessionIds] : []);
}

/** Check 7: session_survey_mapping → survey (broken FK) */
async function check7(pool: RawDataPool, sessionIds: bigint[] | null): Promise<CheckResult> {
  const sessionFilter = sessionIds ? `AND ssm.session_id = ANY($1::bigint[])` : "";
  const sql = `
SELECT ssm.session_survey_mapping_id::text, ssm.session_id::text, ssm.survey_id::text
FROM surveys.session_survey_mapping ssm
LEFT JOIN surveys.survey s ON s.survey_id = ssm.survey_id AND s.deleted_at IS NULL
WHERE s.survey_id IS NULL AND ssm.deleted_at IS NULL ${sessionFilter}
ORDER BY ssm.session_survey_mapping_id
LIMIT ${MAX_SAMPLE + 1}`;
  return runCheck(pool, "ssm_broken_survey_ref",
    "session_survey_mapping rows pointing to a non-existent survey",
    sql, sessionIds ? [sessionIds] : []);
}

/** Check 8: survey_question with no survey_question_mapping entry (orphaned questions) */
async function check8(pool: RawDataPool, sessionIds: bigint[] | null): Promise<CheckResult> {
  const scopeJoin = sessionIds
    ? `INNER JOIN surveys.survey_question_mapping sqm2 ON sqm2.survey_question_id = sq.survey_question_id AND sqm2.deleted_at IS NULL
       INNER JOIN surveys.session_survey_mapping _ssm ON _ssm.survey_id = sqm2.survey_id AND _ssm.session_id = ANY($1::bigint[]) AND _ssm.deleted_at IS NULL`
    : "";
  const sql = `
SELECT sq.survey_question_id::text, sq.title, sq.family, sq.survey_question_answers_id::text
FROM surveys.survey_question sq
${scopeJoin}
LEFT JOIN surveys.survey_question_mapping sqm ON sqm.survey_question_id = sq.survey_question_id AND sqm.deleted_at IS NULL
WHERE sqm.survey_question_mapping_id IS NULL AND sq.deleted_at IS NULL
ORDER BY sq.survey_question_id
LIMIT ${MAX_SAMPLE + 1}`;
  return runCheck(pool, "sq_orphaned",
    "survey_question rows with no survey_question_mapping entry",
    sql, sessionIds ? [sessionIds] : []);
}

// ─── main export ─────────────────────────────────────────────────────────────

export async function runDataQuality(
  pool: RawDataPool,
  sessionIds: bigint[] | null,
): Promise<DataQualityReport> {
  const checks = await Promise.all([
    check1(pool, sessionIds),
    check2(pool, sessionIds),
    check3(pool, sessionIds),
    check4(pool, sessionIds),
    check5(pool, sessionIds),
    check6(pool, sessionIds),
    check7(pool, sessionIds),
    check8(pool, sessionIds),
  ]);

  return {
    generated_at: new Date().toISOString(),
    session_ids: sessionIds ? sessionIds.map((id) => id.toString()) : null,
    checks,
    total_warnings: checks.filter((c) => c.status === "warning").length,
  };
}
