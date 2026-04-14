import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";

import {
  fetchAnswerFrequency,
  fetchBrandRecall,
  fetchDataQuality,
  fetchHealth,
  fetchOpenTextAnswerFrequency,
  fetchQuestionFrequency,
  fetchSessionBrandFitReport,
  fetchSessionInspect,
  fetchSessionInsights,
  fetchSessionQuestions,
  fetchSurveysBySession,
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
