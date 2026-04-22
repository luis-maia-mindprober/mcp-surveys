# Surveys MCP (Cursor)

Stdio MCP server that calls the local **mcp-surveys** API so the assistant can load survey metadata and session response metrics.

## Prerequisites

1. Run the API (`../api`) with `DB_HOST`, `DB_USER`, `DB_NAME` set and optionally `MCP_API_KEY`.
2. Run this MCP either **locally** (`npm install && npm run build`) or **via Docker** (below).

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `SURVEYS_API_BASE_URL` | `http://127.0.0.1:8080` (local) / `http://host.docker.internal:8080` (Docker) | API origin (no trailing slash) |
| `SURVEYS_API_KEY` | _(empty)_ | Must match `MCP_API_KEY` on the API when that is set |
| `QUESTIONPRO_API_BASE_URL` | _(empty)_ | QuestionPro API **origin only** (no trailing slash), e.g. `https://api.questionpro.eu`. Do not include `/a/api/v2` (the code appends it; `loadEnv()` also strips that suffix if pasted by mistake). Required for **questionpro_question_answers**. |
| `QUESTIONPRO_API_KEY` | _(empty)_ | QuestionPro REST API key (sent as the `api-key` header) — required for **questionpro_question_answers** |

**Note:** Cursor passes only the `env` block from MCP settings into the process—`surveys-mcp/.env` is **not** loaded automatically (unlike `api/` with dotenv). Copy QuestionPro vars into the MCP config or export them in the shell before `node dist/index.js`.

## Local (Node)

Install, build, and point Cursor at the compiled entry:

```bash
cd surveys-mcp
npm install
npm run build
```

Add to **Cursor Settings → MCP**, adjusting the path:

```json
{
  "mcpServers": {
    "surveys-insights": {
      "command": "node",
      "args": ["C:\\Users\\Francisco\\Documents\\apps\\mcp-surveys\\surveys-mcp\\dist\\index.js"],
      "env": {
        "SURVEYS_API_BASE_URL": "http://127.0.0.1:8080",
        "SURVEYS_API_KEY": ""
      }
    }
  }
}
```

For development without a prior build, use `tsx` directly:

```json
"command": "npx",
"args": ["tsx", "C:\\Users\\Francisco\\Documents\\apps\\mcp-surveys\\surveys-mcp\\src\\index.ts"],
```

## Docker

### Build

Run from the `surveys-mcp` folder (must be done **after every code change**):

```bash
cd surveys-mcp
docker build -t surveys-mcp:latest .
```

> **Important:** Cursor runs the MCP process with **interactive stdin** (`-i`).  
> Without `-i` the container exits immediately (code 0) with no logs — this is not a crash, it is stdin being closed.

### Cursor MCP config (Docker)

```json
{
  "mcpServers": {
    "surveys-insights": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e", "SURVEYS_API_BASE_URL=http://host.docker.internal:8080",
        "-e", "SURVEYS_API_KEY=",
        "surveys-mcp:latest"
      ]
    }
  }
}
```

Replace `SURVEYS_API_KEY=` with the value of `MCP_API_KEY` from `api/.env` when auth is enabled.

### Linux note

If `host.docker.internal` is unavailable, add `"--add-host=host.docker.internal:host-gateway"` to `args` after `"run"`.

### API in a separate container

If the API also runs in Docker on the same Compose network, set `SURVEYS_API_BASE_URL` to that service URL (e.g. `http://api:8080`).

---

## Updating the image after code changes

Whenever new tools are added or existing logic changes, rebuild the image before restarting the MCP in Cursor:

```bash
cd surveys-mcp
npm run build            # update dist/ (optional when using Dockerfile which builds internally)
docker build -t surveys-mcp:latest .
```

Then in **Cursor Settings → MCP**, disable and re-enable (or restart) the `surveys-insights` server so it picks up the new image.

---

## Tools

### Connectivity
- **surveys_api_health** — `GET /health` — verify the API is reachable before other calls

### Session discovery
- **list_sessions** — `GET /v1/sessions` — discover available sessions (session_id, survey_name, provider, URL); supports pagination (`limit`/`offset`) and optional `survey_name` (substring) / `provider` filters. **Start here** when you don't know the session_id.

### Session metadata
- **list_surveys_for_session** — `GET /v1/surveys?session_id=…` — surveys linked to a session (name, provider, URL, timestamps)
- **session_survey_insights** — `GET /v1/sessions/:sessionId/insights` — aggregated response counts, distinct testers, avg completion %, time range, duplicate rows, status breakdown

### Questions & answers
- **session_questions** — `GET /v1/sessions/:sessionId/questions` — all questions in a session with family, qp_code, order, respondent count
- **session_answer_frequency** — `POST /v1/sessions/answer-frequency` — choice/matrix answer distribution for a question; filter by `qp_code` or `question_id`, optional `filter_status`
- **questionpro_question_answers** — QuestionPro REST `GET /a/api/v2/surveys/{survey_id}/questions/{question_id}/answers` — live answers from QuestionPro (requires `QUESTIONPRO_API_BASE_URL` + `QUESTIONPRO_API_KEY`); not the warehouse API
- **sessions_question_frequency** — `POST /v1/sessions/question-frequency` — which questions appear most across multiple sessions; optional family filter
- **sessions_compare_answers** — `POST /v1/sessions/compare-answers` — side-by-side comparison of how 2+ sessions answered the same question (`qp_code`); returns a unified table with count and % per session

### Engagement & completion
- **session_completion_funnel** — `GET /v1/sessions/:sessionId/completion-funnel` — question-by-question drop-off: respondents, total_testers, completion_pct, drop_off_pct for each question in order
- **session_response_timeline** — `GET /v1/sessions/:sessionId/response-timeline?bucket=hour|day` — time-series of response arrivals bucketed by hour or day; useful for live TV events

### Per-respondent
- **session_tester_answers** — `GET /v1/sessions/:sessionId/tester/:testerId/answers` — all answers from a specific tester with question title, family, qp_code, order, and timing; use for auditing or debugging a respondent

### Brand analysis
- **session_brand_recall** — `POST /v1/sessions/brand-recall` — free-text brand recall token counts or specific brand mention counts
- **session_brand_fit_report** — `POST /v1/sessions/brand-fit-report` — Likert brand-fit extractions from matrix answers; optional `question_text` + `question_match_mode` (`exact`|`contains`|`similar`)
- **session_open_text_answer_frequency** — `POST /v1/sessions/open-text-answer-frequency` — token and exact-answer counts for open-ended questions

### Data quality & inspection
- **session_inspect** — `POST /v1/sessions/inspect` — notebook-style row counts per DB table for one or more sessions (like `inspectSession.ipynb`); includes `testers_session_information (processed)` when `METRICS_DB_*` is configured
- **session_duplicate_testers** — `POST /v1/sessions/duplicate-testers` — lists the specific testers flagged as duplicates (`is_duplicate = true`) with their response_count and response_status_ids; use after `session_survey_insights` shows non-zero `duplicate_rows`
- **session_data_quality** — `POST /v1/data-quality/check` — referential-integrity checks across the `surveys` schema (like `checkMappingMismatches.ipynb`); optional `session_ids` to scope, omit for global scan

  Checks run:
  | Check key | What it finds |
  |-----------|---------------|
  | `sqm_broken_question_ref` | `survey_question_mapping` → missing `survey_question` |
  | `sqm_broken_survey_ref` | `survey_question_mapping` → missing `survey` |
  | `sq_broken_answers_ref` | `survey_question` with `answers_id` set → missing `survey_question_answers` |
  | `sra_broken_question_ref` | `survey_response_answer` → missing `survey_question` |
  | `sra_broken_status_ref` | `survey_response_answer` → missing `survey_response_status` |
  | `srs_broken_survey_ref` | `survey_response_status` → missing `survey` |
  | `ssm_broken_survey_ref` | `session_survey_mapping` → missing `survey` |
  | `sq_orphaned` | `survey_question` with no `survey_question_mapping` entry |
