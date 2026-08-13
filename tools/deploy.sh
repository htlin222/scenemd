#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

PAGES_PROJECT="${CF_PAGES_PROJECT:-scenemd}"
PAGES_DIR="${CF_PAGES_DIR:-dist}"
PAGES_BRANCH="${CF_PAGES_BRANCH:-main}"

npm run build
npx wrangler d1 migrations apply scenemd-documents --remote
npx wrangler deploy -c worker/wrangler.jsonc
npx --yes wrangler@4 pages project create "$PAGES_PROJECT" --production-branch "$PAGES_BRANCH" >/dev/null 2>&1 || true
npx --yes wrangler@4 pages deploy "$PAGES_DIR" --project-name "$PAGES_PROJECT" --branch "$PAGES_BRANCH" --commit-dirty=true
