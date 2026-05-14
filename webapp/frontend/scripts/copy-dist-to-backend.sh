#!/usr/bin/env bash
set -euo pipefail

# Copies webapp/frontend/dist into webapp/backend/frontend_dist so the FastAPI
# service can serve the SPA as static files. Run via `npm run build:deploy`.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_FRONTEND_DIR="$FRONTEND_DIR/../backend/frontend_dist"

if [ ! -d "$FRONTEND_DIR/dist" ]; then
  echo "error: dist/ not present, run \`npm run build\` first" >&2
  exit 1
fi

mkdir -p "$BACKEND_FRONTEND_DIR"
rm -rf "$BACKEND_FRONTEND_DIR"/*
cp -R "$FRONTEND_DIR/dist/." "$BACKEND_FRONTEND_DIR/"

echo "copied $(ls "$BACKEND_FRONTEND_DIR" | wc -l | tr -d ' ') files into webapp/backend/frontend_dist/"
