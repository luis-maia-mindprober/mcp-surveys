import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";

import {
  fetchAnswerFrequency,
  fetchBrandRecall,
  fetchDataQuality,
  fetchHealth,
  fetchListSessions,
  fetchOpenTextAnswerFrequency,
  fetchQuestionFrequency,
  fetchQuestionProQuestionAnswers,
  fetchSessionBrandFitReport,
  fetchSessionCompletionFunnel,
  fetchSessionDuplicateTesters,
  fetchSessionInspect,
  fetchSessionInsights,
  fetchSessionQuestions,
  fetchSessionResponseTimeline,
  fetchSessionTesterAnswers,
  fetchSessionsCompareAnswers,
  fetchSurveysBySession,
  isQuestionProConfigured,
} from "./api.js";
import { loadEnv } from "./config.js";

function jsonResult(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function buildServer(): McpServer {
  const env = loadEnv();

  const server = new McpServer(
    {
      name: "surveys-insights",
      version: "1.0.0",
    },
    {
      instructions: `Use these tools to answer questions about TV survey sessions and response metrics.

**Inspect (important):** If the user says **inspect**, **inspection**, **row counts per table**, **data coverage**, **check tables**, or **notebook-style** session checks — always use the tool **session_inspect** only. Do not substitute list_surveys_for_session or session_survey_insights for that; those are different (metadata vs aggregated metrics, not per-table DB row counts).

Workflow:
0. Call list_sessions (no session_id required) to discover available sessions when the user doesn't know the session_id. Supports pagination and filters by survey_name or provider.
1. Call surveys_api_health if you need to confirm the local API is reachable.
2. Call list_surveys_for_session with a numeric session_id to get survey definitions linked to that session (names, provider, URLs).
3. Call session_survey_insights with the same session_id to get aggregated response counts, completion averages, timelines, and per-status breakdowns from survey_response_status (not the same as session_inspect).
4. Call session_questions to list all questions in a session with respondent counts — useful for discovering question_ids and qp_codes before drilling down.
5. Call session_answer_frequency with session_ids and a question_id (or qp_code) to see how respondents answered that question. Works for single_choice, multiple_choice, open_ended, and matrix_single_choice.
6. Call sessions_question_frequency with multiple session_ids to find which questions appear most often (by session coverage and respondent volume). Optionally filter by family.
7. Call session_brand_recall to analyse free-text brand recall answers: provide brands[] to count specific brand mentions, or omit brands to get token frequency. Use question_text to target the right open_ended question (default matches "brand").
8. Call session_brand_fit_report with comma-separated session_ids; optionally pass question_text and question_match_mode (exact | contains | similar) to restrict rows by survey_question.title. This tool only extracts Likert rows from brand-fit matrix phrases (EN/ES), not free-text recall.
9. Call session_open_text_answer_frequency with comma-separated session_ids and required question_text (same title matching modes). Returns token_counts (comma-split answers in SurveyMonkey-style wrappers) and exact_answer_counts for open-ended recall questions.
10. **session_inspect** — use whenever the user asks to **inspect** one or more sessions: comma-separated session_ids; returns row_counts_by_table (notebook-style). Same purpose as "inspect session" in natural language.
11. Call session_duplicate_testers to identify which specific testers are flagged as duplicates in a session (after session_survey_insights shows non-zero duplicate_rows).
12. Call session_completion_funnel for a session to see question-by-question drop-off rates and completion percentages.
13. Call sessions_compare_answers with 2+ session_ids and a qp_code to compare answer distributions across sessions in a single table.
14. Call session_response_timeline for a session to see when responses arrived over time (by hour or day).
15. Call session_tester_answers with session_id and tester_id to retrieve all answers from a specific respondent.
16. **questionpro_question_answers** — QuestionPro GET .../questions/{question_id}/answers returns **answer-option metadata** for that question (not per-respondent text). For response counts vs the warehouse, use QuestionPro GET .../surveys/{survey_id}/responses (pagination.totalItems). Requires QUESTIONPRO_* in the MCP process env (surveys-mcp/.env is not auto-loaded unless you use a loader).

Interpret results for the user: compare completion, spot duplicates, relate survey names to metrics, and highlight data gaps. Session IDs are opaque integers from your upstream systems.`,
    },
  );

  server.registerTool(
    "surveys_api_health",
    {
      description:
        "Check connectivity to the local surveys API (GET /health). Use before other tools if requests fail.",
      inputSchema: {},
    },
    async () => {
      const { ok, status, body } = await fetchHealth(env);
      return jsonResult({ ok, status, body });
    },
  );

  server.registerTool(
    "list_surveys_for_session",
    {
      description:
        "List surveys linked to a session: metadata (name, description, provider, url, timestamps). Requires session_id.",
      inputSchema: {
        session_id: z
          .string()
          .describe("Numeric session identifier (e.g. from your scheduling or QA system)"),
      },
    },
    async ({ session_id }) => {
      const sid = session_id.trim();
      if (!/^\d+$/.test(sid)) {
        return jsonResult({ error: "session_id must be a non-negative integer string" });
      }
      const { ok, status, body } = await fetchSurveysBySession(env, sid);
      return jsonResult({ ok, status, body });
    },
  );

  server.registerTool(
    "session_survey_insights",
    {
      description:
        "Aggregated response metrics per survey for a session: counts, distinct testers, average completion %, time range, duplicate rows, and response_status breakdown (e.g. completed). Not for 'inspect' / per-table row-count requests — use session_inspect instead.",
      inputSchema: {
        session_id: z.string().describe("Numeric session identifier, same as for list_surveys_for_session"),
      },
    },
    async ({ session_id }) => {
      const sid = session_id.trim();
      if (!/^\d+$/.test(sid)) {
        return jsonResult({ error: "session_id must be a non-negative integer string" });
      }
      const { ok, status, body } = await fetchSessionInsights(env, sid);
      return jsonResult({ ok, status, body });
    },
  );

  server.registerTool(
    "session_brand_fit_report",
    {
      description:
        "Session inventory plus brand-fit Likert extractions. Without question_text, filters answers by built-in brand-fit phrases. With question_text, filters by survey_question.title: exact (trim, case-insensitive), contains (substring), or similar (pg_trgm similarity if enabled, else substring).",
      inputSchema: {
        session_ids: z
          .string()
          .describe(
            "Comma-separated numeric session IDs (e.g. 101,102,103). Non-empty; each token must be a non-negative integer.",
          ),
        question_text: z
          .string()
          .optional()
          .describe(
            "Optional free text to match survey question titles (survey_question.title). When omitted, only answers containing the standard brand-fit matrix phrases are included.",
          ),
        question_match_mode: z
          .enum(["exact", "contains", "similar"])
          .optional()
          .describe(
            "How to match question_text against titles: exact, contains (default), or similar (trigram when pg_trgm is available).",
          ),
      },
    },
    async ({ session_ids, question_text, question_match_mode }) => {
      const parts = session_ids
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (parts.length === 0) {
        return jsonResult({ error: "session_ids must list at least one integer" });
      }
      for (const p of parts) {
        if (!/^\d+$/.test(p)) {
          return jsonResult({ error: `invalid session_id token: ${p}` });
        }
      }
      const qt = question_text?.trim();
      const { ok, status, body } = await fetchSessionBrandFitReport(env, parts, {
        questionText: qt && qt.length > 0 ? qt : undefined,
        questionMatchMode: question_match_mode,
      });
      return jsonResult({ ok, status, body });
    },
  );

  server.registerTool(
    "session_questions",
    {
      description:
        "List all questions in a session with respondent counts, family, qp_code, and order. Use this to discover question_ids and qp_codes before calling session_answer_frequency.",
      inputSchema: {
        session_id: z
          .string()
          .describe("Numeric session identifier."),
      },
    },
    async ({ session_id }) => {
      const sid = session_id.trim();
      if (!/^\d+$/.test(sid)) {
        return jsonResult({ error: "session_id must be a non-negative integer string" });
      }
      const { ok, status, body } = await fetchSessionQuestions(env, sid);
      return jsonResult({ ok, status, body });
    },
  );

  server.registerTool(
    "session_inspect",
    {
      description:
        "Use this tool whenever the user asks to **inspect** (or audit / check row counts / table coverage for) one or more sessions. Returns row_counts_by_table per DB table (like inspectSession.ipynb): mappings, questions, answers, response status/answers, and processed testers when the API has METRICS_DB_* configured. Natural-language 'inspect session X' maps here — not session_survey_insights.",
      inputSchema: {
        session_ids: z
          .string()
          .describe(
            "Comma-separated numeric session IDs (e.g. 10743 or 10705,9989). Max 100 sessions.",
          ),
      },
    },
    async ({ session_ids }) => {
      const parts = session_ids
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (parts.length === 0) {
        return jsonResult({ error: "session_ids must list at least one integer" });
      }
      for (const p of parts) {
        if (!/^\d+$/.test(p)) {
          return jsonResult({ error: `invalid session_id token: ${p}` });
        }
      }
      const { ok, status, body } = await fetchSessionInspect(env, parts);
      return jsonResult({ ok, status, body });
    },
  );

  server.registerTool(
    "session_answer_frequency",
    {
      description:
        "Count how respondents answered a specific question in one or more sessions. Provide question_id (exact) or qp_code (matches all equivalent questions across surveys). Returns choice_counts for single/multiple_choice and open_ended, or matrix_counts for matrix_single_choice. Optionally filter by response status (e.g. 'completed').",
      inputSchema: {
        session_ids: z
          .string()
          .describe("Comma-separated numeric session IDs (e.g. 101,102,103)."),
        question_id: z
          .string()
          .optional()
          .describe("Exact survey_question_id to analyse. Either this or qp_code is required."),
        qp_code: z
          .string()
          .optional()
          .describe("qp_code (e.g. Q14) to aggregate across all matching questions in the sessions. Either this or question_id is required."),
        filter_status: z
          .string()
          .optional()
          .describe("Optional response_status filter, e.g. 'completed' or 'partial'."),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Max rows in choice_counts or matrix_counts (default 500)."),
      },
    },
    async ({ session_ids, question_id, qp_code, filter_status, limit }) => {
      const parts = session_ids
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (parts.length === 0) {
        return jsonResult({ error: "session_ids must list at least one integer" });
      }
      for (const p of parts) {
        if (!/^\d+$/.test(p)) {
          return jsonResult({ error: `invalid session_id token: ${p}` });
        }
      }
      const qid = question_id?.trim();
      const qpc = qp_code?.trim();
      if ((!qid || qid.length === 0) && (!qpc || qpc.length === 0)) {
        return jsonResult({ error: "Either question_id or qp_code is required" });
      }
      const { ok, status, body } = await fetchAnswerFrequency(env, parts, {
        questionId: qid && qid.length > 0 ? qid : undefined,
        qpCode: qpc && qpc.length > 0 ? qpc : undefined,
        filterStatus: filter_status?.trim(),
        limit,
      });
      return jsonResult({ ok, status, body });
    },
  );

  server.registerTool(
    "sessions_question_frequency",
    {
      description:
        "Which questions appear most frequently across a set of sessions? Groups by qp_code (when set) or question title, returning session_count (how many sessions include it), total_respondents, and total_answer_rows. Useful for cross-session comparison and discovering which questions are most used. Optionally filter by family.",
      inputSchema: {
        session_ids: z
          .string()
          .describe("Comma-separated numeric session IDs (e.g. 101,102,103)."),
        family: z
          .enum(["single_choice", "multiple_choice", "matrix_single_choice", "open_ended", "static_text"])
          .optional()
          .describe("Optional: restrict to one question family."),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Max rows returned (default 200)."),
      },
    },
    async ({ session_ids, family, limit }) => {
      const parts = session_ids
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (parts.length === 0) {
        return jsonResult({ error: "session_ids must list at least one integer" });
      }
      for (const p of parts) {
        if (!/^\d+$/.test(p)) {
          return jsonResult({ error: `invalid session_id token: ${p}` });
        }
      }
      const { ok, status, body } = await fetchQuestionFrequency(env, parts, { family, limit });
      return jsonResult({ ok, status, body });
    },
  );

  server.registerTool(
    "session_brand_recall",
    {
      description:
        "Analyse free-text brand recall answers from open_ended survey questions. Two modes: (1) Provide brands[] → counts how many respondents mentioned each brand (case-insensitive substring match). (2) Omit brands → returns token_counts of comma-split answer fragments. Use question_text to target the right question (default 'brand', matches 'brands you remember' etc.). Different from session_brand_fit_report which analyses structured Likert brand-fit matrices.",
      inputSchema: {
        session_ids: z
          .string()
          .describe("Comma-separated numeric session IDs (e.g. 101,102,103)."),
        brands: z
          .string()
          .optional()
          .describe(
            "Optional comma-separated list of brand names to search for (e.g. 'T-Mobile,M&Ms,Wells Fargo'). When provided, returns brand_mentions with per-brand respondent counts. When omitted, returns token_counts from splitting free-text answers.",
          ),
        question_text: z
          .string()
          .optional()
          .describe("Text to match survey_question.title (default: 'brand'). Targets the brand recall open-ended question."),
        question_match_mode: z
          .enum(["exact", "contains", "similar"])
          .optional()
          .describe("How to match question_text against titles (default: contains)."),
        min_mentions: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("In token frequency mode: minimum mentions to include a token (default 1)."),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Max brands/tokens returned (default 100)."),
      },
    },
    async ({ session_ids, brands, question_text, question_match_mode, min_mentions, limit }) => {
      const parts = session_ids
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (parts.length === 0) {
        return jsonResult({ error: "session_ids must list at least one integer" });
      }
      for (const p of parts) {
        if (!/^\d+$/.test(p)) {
          return jsonResult({ error: `invalid session_id token: ${p}` });
        }
      }
      const brandList = brands
        ? brands.split(",").map((b) => b.trim()).filter((b) => b.length > 0)
        : undefined;
      const qt = question_text?.trim();
      const { ok, status, body } = await fetchBrandRecall(env, parts, {
        questionText: qt && qt.length > 0 ? qt : undefined,
        questionMatchMode: question_match_mode,
        brands: brandList,
        minMentions: min_mentions,
        limit,
      });
      return jsonResult({ ok, status, body });
    },
  );

  server.registerTool(
    "session_open_text_answer_frequency",
    {
      description:
        "Frequencies for open-text answers: matches survey_question.title (exact | contains | similar), dedupes one row per respondent, splits comma-separated lists inside {{\"...\"}} / {{...}} answer wrappers, and returns token_counts plus exact_answer_counts. Use for brand recall and other free-text questions — not for brand-fit Likert matrices (use session_brand_fit_report for those).",
      inputSchema: {
        session_ids: z
          .string()
          .describe(
            "Comma-separated numeric session IDs (e.g. 101,102,103). Non-empty; each token must be a non-negative integer.",
          ),
        question_text: z
          .string()
          .min(1)
          .describe("Required text to match survey_question.title (same semantics as brand-fit report)."),
        question_match_mode: z
          .enum(["exact", "contains", "similar"])
          .optional()
          .describe(
            "How to match question_text against titles: exact, contains (default), or similar (trigram when pg_trgm is available).",
          ),
        min_token_length: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Minimum character length for token_counts rows after cleaning (default 2)."),
        token_limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Max rows returned in token_counts (default 100)."),
        exact_answer_limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Max rows returned in exact_answer_counts (default 50)."),
      },
    },
    async ({
      session_ids,
      question_text,
      question_match_mode,
      min_token_length,
      token_limit,
      exact_answer_limit,
    }) => {
      const parts = session_ids
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (parts.length === 0) {
        return jsonResult({ error: "session_ids must list at least one integer" });
      }
      for (const p of parts) {
        if (!/^\d+$/.test(p)) {
          return jsonResult({ error: `invalid session_id token: ${p}` });
        }
      }
      const qt = question_text.trim();
      if (qt.length === 0) {
        return jsonResult({ error: "question_text is required" });
      }
      const { ok, status, body } = await fetchOpenTextAnswerFrequency(env, parts, {
        questionText: qt,
        questionMatchMode: question_match_mode,
        minTokenLength: min_token_length,
        tokenLimit: token_limit,
        exactAnswerLimit: exact_answer_limit,
      });
      return jsonResult({ ok, status, body });
    },
  );

  server.registerTool(
    "session_data_quality",
    {
      description:
        "Run data-quality / mapping-mismatch checks on the surveys schema (based on checkMappingMismatches.ipynb). Runs 8 referential-integrity checks: broken FKs in survey_question_mapping, survey_question, survey_response_answer, survey_response_status, session_survey_mapping, and orphaned survey_question rows. Optionally scoped to specific sessions via comma-separated session_ids; omit to run globally. Returns per-check status (ok/warning), broken_count, and sample rows.",
      inputSchema: {
        session_ids: z
          .string()
          .optional()
          .describe(
            "Optional comma-separated numeric session IDs to scope checks to specific sessions (e.g. '10743' or '10705,9989'). Omit to run globally across all data.",
          ),
      },
    },
    async ({ session_ids }) => {
      let parts: string[] | null = null;
      if (session_ids != null && session_ids.trim().length > 0) {
        parts = session_ids
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        if (parts.length === 0) {
          return jsonResult({ error: "session_ids must list at least one integer when provided" });
        }
        for (const p of parts) {
          if (!/^\d+$/.test(p)) {
            return jsonResult({ error: `invalid session_id token: ${p}` });
          }
        }
      }
      const { ok, status, body } = await fetchDataQuality(env, parts);
      return jsonResult({ ok, status, body });
    },
  );

  server.registerTool(
    "list_sessions",
    {
      description:
        "Discover available sessions by listing session_survey_mapping entries (session_id, survey_name, provider, url). Use this when you don't know which session_id to use — it's the entry point before calling any other session tool. Supports pagination (limit/offset) and optional filters: survey_name (substring) and provider.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .positive()
          .max(500)
          .optional()
          .describe("Max sessions returned (default 50, max 500)."),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Pagination offset (default 0)."),
        survey_name: z
          .string()
          .optional()
          .describe("Optional substring filter on survey name (case-insensitive)."),
        provider: z
          .string()
          .optional()
          .describe("Optional exact provider filter (e.g. 'questionpro', 'surveymonkey')."),
      },
    },
    async ({ limit, offset, survey_name, provider }) => {
      const { ok, status, body } = await fetchListSessions(env, {
        limit,
        offset,
        surveyName: survey_name?.trim() || undefined,
        provider: provider?.trim() || undefined,
      });
      return jsonResult({ ok, status, body });
    },
  );

  server.registerTool(
    "session_duplicate_testers",
    {
      description:
        "Identify which testers have duplicate response rows (is_duplicate = true) in one or more sessions. Returns per-tester response_count, response_status_ids, time range, and statuses. Useful for QA and data cleanup after session_survey_insights shows non-zero duplicate_rows.",
      inputSchema: {
        session_ids: z
          .string()
          .describe("Comma-separated numeric session IDs (e.g. 10743 or 10705,9989). Max 100 sessions."),
      },
    },
    async ({ session_ids }) => {
      const parts = session_ids.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      if (parts.length === 0) return jsonResult({ error: "session_ids must list at least one integer" });
      for (const p of parts) {
        if (!/^\d+$/.test(p)) return jsonResult({ error: `invalid session_id token: ${p}` });
      }
      const { ok, status, body } = await fetchSessionDuplicateTesters(env, parts);
      return jsonResult({ ok, status, body });
    },
  );

  server.registerTool(
    "session_completion_funnel",
    {
      description:
        "Show question-by-question completion drop-off for a session. For each question (in order), returns respondents, total_testers, completion_pct, and drop_off_pct. Useful for identifying where respondents abandon the survey.",
      inputSchema: {
        session_id: z.string().describe("Numeric session identifier."),
      },
    },
    async ({ session_id }) => {
      const sid = session_id.trim();
      if (!/^\d+$/.test(sid)) return jsonResult({ error: "session_id must be a non-negative integer string" });
      const { ok, status, body } = await fetchSessionCompletionFunnel(env, sid);
      return jsonResult({ ok, status, body });
    },
  );

  server.registerTool(
    "sessions_compare_answers",
    {
      description:
        "Compare how different sessions answered the same question (identified by qp_code). Returns a unified comparison table with one row per answer value and columns per session showing count and percentage. Requires at least 2 session_ids and one qp_code.",
      inputSchema: {
        session_ids: z
          .string()
          .describe("Comma-separated numeric session IDs — at least 2 required (e.g. 101,102,103)."),
        qp_code: z
          .string()
          .describe("Question qp_code to compare across sessions (e.g. Q14). Use session_questions to discover qp_codes."),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Max answer values returned in comparison (default 100)."),
      },
    },
    async ({ session_ids, qp_code, limit }) => {
      const parts = session_ids.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      if (parts.length < 2) return jsonResult({ error: "session_ids must list at least 2 integers" });
      for (const p of parts) {
        if (!/^\d+$/.test(p)) return jsonResult({ error: `invalid session_id token: ${p}` });
      }
      const qpc = qp_code.trim();
      if (!qpc) return jsonResult({ error: "qp_code is required" });
      const { ok, status, body } = await fetchSessionsCompareAnswers(env, parts, qpc, limit);
      return jsonResult({ ok, status, body });
    },
  );

  server.registerTool(
    "session_response_timeline",
    {
      description:
        "Show a time-series of when responses arrived in a session, bucketed by hour or day. Returns response_count and distinct_testers per time bucket. Useful for live TV events where engagement timing matters.",
      inputSchema: {
        session_id: z.string().describe("Numeric session identifier."),
        bucket: z
          .enum(["hour", "day"])
          .optional()
          .describe("Time bucket granularity: 'hour' (default) or 'day'."),
      },
    },
    async ({ session_id, bucket }) => {
      const sid = session_id.trim();
      if (!/^\d+$/.test(sid)) return jsonResult({ error: "session_id must be a non-negative integer string" });
      const { ok, status, body } = await fetchSessionResponseTimeline(env, sid, bucket);
      return jsonResult({ ok, status, body });
    },
  );

  server.registerTool(
    "session_tester_answers",
    {
      description:
        "Retrieve all answers submitted by a specific tester in a session. Returns every survey_response_answer row with question title, family, qp_code, order, answer, response status, completion percentage, and start/end times. Use for auditing or debugging a specific respondent.",
      inputSchema: {
        session_id: z.string().describe("Numeric session identifier."),
        tester_id: z.string().describe("Numeric tester identifier (from survey_response_status.tester_id)."),
      },
    },
    async ({ session_id, tester_id }) => {
      const sid = session_id.trim();
      const tid = tester_id.trim();
      if (!/^\d+$/.test(sid)) return jsonResult({ error: "session_id must be a non-negative integer string" });
      if (!/^\d+$/.test(tid)) return jsonResult({ error: "tester_id must be a non-negative integer string" });
      const { ok, status, body } = await fetchSessionTesterAnswers(env, sid, tid);
      return jsonResult({ ok, status, body });
    },
  );

  server.registerTool(
    "questionpro_question_answers",
    {
      description:
        "QuestionPro REST: GET /a/api/v2/surveys/{survey_id}/questions/{question_id}/answers — returns **answer structure / options** for the question (not each respondent's submission). For comparing **how many** responses exist, use QuestionPro GET .../surveys/{survey_id}/responses instead. Requires QUESTIONPRO_API_BASE_URL (origin only, e.g. https://api.questionpro.eu) and QUESTIONPRO_API_KEY in the MCP **process** environment. Survey id = `provider_survey_id` from list_surveys_for_session.",
      inputSchema: {
        survey_id: z
          .string()
          .describe("QuestionPro survey ID (numeric string, e.g. from the survey URL or provider metadata)."),
        question_id: z
          .string()
          .describe("QuestionPro question ID (numeric string from the survey editor or API)."),
        page: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Page number for paginated results (default 1)."),
        per_page: z
          .number()
          .int()
          .positive()
          .max(500)
          .optional()
          .describe("Page size (QuestionPro `perPage`, default 100, max 500)."),
      },
    },
    async ({ survey_id, question_id, page, per_page }) => {
      const sid = survey_id.trim();
      const qid = question_id.trim();
      if (!/^\d+$/.test(sid)) {
        return jsonResult({ error: "survey_id must be a numeric string" });
      }
      if (!/^\d+$/.test(qid)) {
        return jsonResult({ error: "question_id must be a numeric string" });
      }
      if (!isQuestionProConfigured(env)) {
        return jsonResult({
          error:
            "QuestionPro is not configured. Set QUESTIONPRO_API_BASE_URL (e.g. https://api.questionpro.eu) and QUESTIONPRO_API_KEY in the MCP server environment.",
        });
      }
      const { ok, status, body } = await fetchQuestionProQuestionAnswers(env, sid, qid, {
        page,
        perPage: per_page,
      });
      return jsonResult({ ok, status, body });
    },
  );

  return server;
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  const server = buildServer();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
