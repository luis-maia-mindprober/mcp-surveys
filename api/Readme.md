## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness check |
| `GET` | `/v1/surveys?session_id=<id>` | Surveys linked to a session |
| `GET` | `/v1/sessions/:sessionId/insights` | Aggregated response metrics (counts, completion %, status breakdown) |
| `GET` | `/v1/sessions/:sessionId/questions` | All questions in a session with respondent counts, family, qp_code |
| `POST` | `/v1/sessions/answer-frequency` | Choice/matrix answer distribution for a question |
| `POST` | `/v1/sessions/question-frequency` | Question frequency across multiple sessions |
| `POST` | `/v1/sessions/brand-recall` | Free-text brand recall token/mention counts |
| `POST` | `/v1/sessions/brand-fit-report` | Likert brand-fit extraction from matrix answers |
| `POST` | `/v1/sessions/open-text-answer-frequency` | Token and exact-answer counts for open-ended questions |
| `POST` | `/v1/sessions/inspect` | Notebook-style row counts per DB table (like `inspectSession.ipynb`) |
| `POST` | `/v1/data-quality/check` | Referential-integrity checks across the `surveys` schema (like `checkMappingMismatches.ipynb`) |

Optional auth: `MCP_API_KEY` → header `X-Api-Key` or `Authorization: Bearer`.

Optional metrics DB (`METRICS_DB_*`): adds `testers_session_information (processed)` counts to `/v1/sessions/inspect`.
