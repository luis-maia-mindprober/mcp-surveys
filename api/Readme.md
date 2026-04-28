## Endpoints

- `GET /health` — liveness
- `GET /v1/surveys?session_id=<id>` — inquéritos ligados à sessão (PostgreSQL `surveys`, via `RAW_DATA_DATABASE_URL`)
- `GET /v1/sessions/:sessionId/insights` — agregados de respostas por inquérito (contagens, médias de conclusão, linha temporal, estados `response_status`)

Autenticação opcional: `MCP_API_KEY` → header `X-Api-Key` ou `Authorization: Bearer`.
