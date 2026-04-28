# Surveys MCP (Cursor)

Stdio MCP server that calls the local **mcp-surveys** API so the assistant can load survey metadata and session response metrics.

## Prerequisites

1. Run the API (`../api`) with `RAW_DATA_DATABASE_URL` set and optionally `MCP_API_KEY`.
2. Run this MCP either **locally** (`npm install && npm run build`) or **via Docker** (below).

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `SURVEYS_API_BASE_URL` | `http://127.0.0.1:8080` (local) / `http://host.docker.internal:8080` (Docker) | API origin (no trailing slash) |
| `SURVEYS_API_KEY` | _(empty)_ | Must match `MCP_API_KEY` on the API when that is set |

## Cursor

Add to your MCP config (e.g. **Cursor Settings → MCP**), adjusting the path:

```json
{
  "mcpServers": {
    "surveys-insights": {
      "command": "node",
      "args": ["/Users/you/Developer/company/mcp-surveys/surveys-mcp/dist/index.js"],
      "env": {
        "SURVEYS_API_BASE_URL": "http://127.0.0.1:8080",
        "SURVEYS_API_KEY": ""
      }
    }
  }
}
```

For development without a prior build:

```json
"command": "npx",
"args": ["tsx", "/Users/you/Developer/company/mcp-surveys/surveys-mcp/src/index.ts"],
```

### Docker

Build the image from this directory:

```bash
docker build -t surveys-mcp .
```

The image defaults `SURVEYS_API_BASE_URL` to `http://host.docker.internal:8080` so the container can reach an API bound on your machine. Override `SURVEYS_API_KEY` if the API uses `MCP_API_KEY`.

**Cursor** must run the container with **interactive stdin** (`-i`); stdio is how MCP talks to the process:

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
        "surveys-mcp"
      ]
    }
  }
}
```

On **Linux**, if `host.docker.internal` is missing, add to `args` after `run`: `"--add-host=host.docker.internal:host-gateway"`.

If the API runs in another container on the same Compose network, set `SURVEYS_API_BASE_URL` to that service URL (e.g. `http://api:8080`) instead.

## Tools

- **surveys_api_health** — `GET /health`
- **list_surveys_for_session** — `GET /v1/surveys?session_id=…`
- **session_survey_insights** — `GET /v1/sessions/:sessionId/insights`
- **session_brand_fit_report** — `POST /v1/sessions/brand-fit-report` with JSON `{ "session_ids": ["…"], "question_text"?: "…", "question_match_mode"?: "exact"|"contains"|"similar" }`; MCP tool passes comma-separated `session_ids` plus optional `question_text` / `question_match_mode`
