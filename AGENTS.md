## Learned User Preferences

- Survey and analytics requests sometimes arrive in Portuguese; respond in Portuguese when the user writes in Portuguese.

## Learned Workspace Facts

- This repo is a Fastify API under `api/` backed by PostgreSQL (`surveys` schema on raw_data) plus a stdio MCP under `surveys-mcp/` that calls the API over HTTP (`SURVEYS_API_BASE_URL`, optional `SURVEYS_API_KEY` matching `MCP_API_KEY`).
- The API loads `api/.env` at startup with dotenv (path resolved from the entry module), then `loadConfig()` reads `process.env`; Node does not load `.env` files implicitly.
- Raw-data DB connection uses `DB_HOST`, `DB_USER`, and `DB_NAME` (required), with optional `DB_PORT`, `DB_PASSWORD`, and `DATABASE_POOL_MAX`. The pg pool uses SSL off when `NODE_ENV` is `dev`, otherwise SSL with `rejectUnauthorized: false`.
- Survey endpoints include `GET /v1/surveys?session_id=…`, `GET /v1/sessions/:sessionId/insights`, `POST /v1/sessions/brand-fit-report` (JSON `session_ids`, optional `question_text` and `question_match_mode`: `exact`, `contains`, or `similar`), and `POST /v1/sessions/inspect` (JSON `session_ids`) for notebook-style per-table row counts; optional `METRICS_DB_*` adds `testers_session_information (processed)` counts. The MCP tool `session_inspect` is the one to use when the user says “inspect” a session (not `session_survey_insights`).
- Brand-fit reporting extracts Likert values from known English/Spanish matrix row strings inside answers; it is not a substitute for counting free-text recall answers—those need SQL against `surveys.survey_response_answer` (and related tables).
- The surveys-insights MCP tools aggregate metrics per session/survey only; they do not rank or list question text across all surveys—use direct Postgres (or ad hoc SQL) for global question-frequency style analysis.
- The `api` package was trimmed to surveys/raw_data only; earlier DynamoDB or TV airing routes are not part of this service.
- To run the MCP in Docker, build `surveys-mcp/Dockerfile` and use `docker run -i` (stdio); the image defaults `SURVEYS_API_BASE_URL` to `http://host.docker.internal:8080`. On Linux, add `--add-host=host.docker.internal:host-gateway` if that hostname is unavailable.
