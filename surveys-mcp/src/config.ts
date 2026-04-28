export type McpEnv = {
  /** Base URL of the surveys API (no trailing slash), e.g. http://127.0.0.1:8080 */
  apiBaseUrl: string;
  /** Optional shared secret; must match API MCP_API_KEY when set */
  apiKey: string;
};

export function loadEnv(): McpEnv {
  const apiBaseUrl = (process.env.SURVEYS_API_BASE_URL ?? "http://127.0.0.1:8080").trim().replace(/\/$/, "");
  const apiKey = (process.env.SURVEYS_API_KEY ?? "").trim();
  return { apiBaseUrl, apiKey };
}
