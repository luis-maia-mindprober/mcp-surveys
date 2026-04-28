import type { McpEnv } from "./config.js";

function authHeaders(env: McpEnv): Headers {
  const h = new Headers({ Accept: "application/json" });
  if (env.apiKey) {
    h.set("X-Api-Key", env.apiKey);
  }
  return h;
}

function joinUrl(base: string, path: string): string {
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

export async function fetchJson<T>(env: McpEnv, path: string): Promise<{ ok: boolean; status: number; body: T }> {
  const res = await fetch(joinUrl(env.apiBaseUrl, path), { headers: authHeaders(env) });
  const text = await res.text();
  let body: T;
  try {
    body = text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    body = text as unknown as T;
  }
  return { ok: res.ok, status: res.status, body };
}

export async function fetchHealth(env: McpEnv): Promise<{ ok: boolean; status: number; body: unknown }> {
  return fetchJson(env, "/health");
}

export async function fetchSurveysBySession(
  env: McpEnv,
  sessionId: string,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const q = new URLSearchParams({ session_id: sessionId });
  return fetchJson(env, `/v1/surveys?${q.toString()}`);
}

export async function fetchSessionInsights(
  env: McpEnv,
  sessionId: string,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const seg = encodeURIComponent(sessionId);
  return fetchJson(env, `/v1/sessions/${seg}/insights`);
}

export type SessionBrandFitReportOptions = {
  questionText?: string;
  questionMatchMode?: "exact" | "contains" | "similar";
};

export async function fetchSessionBrandFitReport(
  env: McpEnv,
  sessionIds: string[],
  options?: SessionBrandFitReportOptions,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const headers = authHeaders(env);
  headers.set("Content-Type", "application/json");
  const payload: Record<string, unknown> = { session_ids: sessionIds };
  if (options?.questionText != null && options.questionText.trim() !== "") {
    payload.question_text = options.questionText.trim();
  }
  if (options?.questionMatchMode != null) {
    payload.question_match_mode = options.questionMatchMode;
  }
  const res = await fetch(joinUrl(env.apiBaseUrl, "/v1/sessions/brand-fit-report"), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

export type OpenTextAnswerFrequencyOptions = {
  questionText: string;
  questionMatchMode?: "exact" | "contains" | "similar";
  minTokenLength?: number;
  tokenLimit?: number;
  exactAnswerLimit?: number;
};

export async function fetchOpenTextAnswerFrequency(
  env: McpEnv,
  sessionIds: string[],
  options: OpenTextAnswerFrequencyOptions,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const headers = authHeaders(env);
  headers.set("Content-Type", "application/json");
  const payload: Record<string, unknown> = {
    session_ids: sessionIds,
    question_text: options.questionText.trim(),
  };
  if (options.questionMatchMode != null) {
    payload.question_match_mode = options.questionMatchMode;
  }
  if (options.minTokenLength != null) {
    payload.min_token_length = options.minTokenLength;
  }
  if (options.tokenLimit != null) {
    payload.token_limit = options.tokenLimit;
  }
  if (options.exactAnswerLimit != null) {
    payload.exact_answer_limit = options.exactAnswerLimit;
  }
  const res = await fetch(joinUrl(env.apiBaseUrl, "/v1/sessions/open-text-answer-frequency"), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

export async function fetchSessionQuestions(
  env: McpEnv,
  sessionId: string,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const seg = encodeURIComponent(sessionId);
  return fetchJson(env, `/v1/sessions/${seg}/questions`);
}

export type AnswerFrequencyOptions = {
  questionId?: string;
  qpCode?: string;
  filterStatus?: string;
  limit?: number;
};

export async function fetchAnswerFrequency(
  env: McpEnv,
  sessionIds: string[],
  options: AnswerFrequencyOptions,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const headers = authHeaders(env);
  headers.set("Content-Type", "application/json");
  const payload: Record<string, unknown> = { session_ids: sessionIds };
  if (options.questionId != null && options.questionId.trim() !== "") {
    payload.question_id = options.questionId.trim();
  }
  if (options.qpCode != null && options.qpCode.trim() !== "") {
    payload.qp_code = options.qpCode.trim();
  }
  if (options.filterStatus != null && options.filterStatus.trim() !== "") {
    payload.filter_status = options.filterStatus.trim();
  }
  if (options.limit != null) {
    payload.limit = options.limit;
  }
  const res = await fetch(joinUrl(env.apiBaseUrl, "/v1/sessions/answer-frequency"), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

export type QuestionFrequencyOptions = {
  family?: string;
  limit?: number;
};

export async function fetchQuestionFrequency(
  env: McpEnv,
  sessionIds: string[],
  options?: QuestionFrequencyOptions,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const headers = authHeaders(env);
  headers.set("Content-Type", "application/json");
  const payload: Record<string, unknown> = { session_ids: sessionIds };
  if (options?.family != null && options.family.trim() !== "") {
    payload.family = options.family.trim();
  }
  if (options?.limit != null) {
    payload.limit = options.limit;
  }
  const res = await fetch(joinUrl(env.apiBaseUrl, "/v1/sessions/question-frequency"), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

export type BrandRecallOptions = {
  questionText?: string;
  questionMatchMode?: "exact" | "contains" | "similar";
  brands?: string[];
  minMentions?: number;
  limit?: number;
};

export async function fetchBrandRecall(
  env: McpEnv,
  sessionIds: string[],
  options?: BrandRecallOptions,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const headers = authHeaders(env);
  headers.set("Content-Type", "application/json");
  const payload: Record<string, unknown> = { session_ids: sessionIds };
  if (options?.questionText != null && options.questionText.trim() !== "") {
    payload.question_text = options.questionText.trim();
  }
  if (options?.questionMatchMode != null) {
    payload.question_match_mode = options.questionMatchMode;
  }
  if (options?.brands != null && options.brands.length > 0) {
    payload.brands = options.brands;
  }
  if (options?.minMentions != null) {
    payload.min_mentions = options.minMentions;
  }
  if (options?.limit != null) {
    payload.limit = options.limit;
  }
  const res = await fetch(joinUrl(env.apiBaseUrl, "/v1/sessions/brand-recall"), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}
