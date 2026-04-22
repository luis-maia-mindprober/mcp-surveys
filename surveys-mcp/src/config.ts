export type McpEnv = {
  /** Base URL of the surveys API (no trailing slash), e.g. http://127.0.0.1:8080 */
  apiBaseUrl: string;
  /** Optional shared secret; must match API MCP_API_KEY when set */
  apiKey: string;
  /**
   * QuestionPro API origin (no trailing slash), e.g. https://api.questionpro.eu or https://api.questionpro.com.
   * Used by questionpro_question_answers together with questionProApiKey.
   */
  questionProApiBaseUrl: string;
  /** QuestionPro REST API key (sent as the `api-key` header). */
  questionProApiKey: string;
};

/** Strip accidental `/a/api/v2` suffix so `QUESTIONPRO_API_BASE_URL` can be pasted as origin or full API prefix. */
function normalizeQuestionProBase(raw: string): string {
  let u = raw.trim().replace(/\/$/, "");
  u = u.replace(/\/a\/api\/v2\/?$/i, "");
  return u.replace(/\/$/, "");
}

export function loadEnv(): McpEnv {
  const apiBaseUrl = (process.env.SURVEYS_API_BASE_URL ?? "http://127.0.0.1:8080").trim().replace(/\/$/, "");
  const apiKey = (process.env.SURVEYS_API_KEY ?? "").trim();
  const questionProApiBaseUrl = normalizeQuestionProBase(process.env.QUESTIONPRO_API_BASE_URL ?? "");
  const questionProApiKey = (process.env.QUESTIONPRO_API_KEY ?? "").trim();
  return { apiBaseUrl, apiKey, questionProApiBaseUrl, questionProApiKey };
}
