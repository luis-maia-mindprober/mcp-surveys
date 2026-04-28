#!/bin/sh
set -eu

node /app/api/dist/index.js &
api_pid="$!"

cleanup() {
  kill "$api_pid" 2>/dev/null || true
  wait "$api_pid" 2>/dev/null || true
}

trap cleanup INT TERM EXIT

node /app/surveys-mcp/dist/index.js
