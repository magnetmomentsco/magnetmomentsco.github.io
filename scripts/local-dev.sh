#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# local-dev.sh — Inject .env credentials and start a local dev server
#
# Usage:
#   ./scripts/local-dev.sh          # inject + serve on port 8080
#   ./scripts/local-dev.sh 9999     # inject + serve on custom port
#   ./scripts/local-dev.sh reset    # restore placeholder tokens (git checkout)
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# ── Reset mode ──────────────────────────────────────────────────────────
if [[ "${1:-}" == "reset" ]]; then
  echo "🔄 Restoring placeholder tokens…"
  git checkout -- assets/js/mm-tracker.js admin/index.html assets/js/webapp-shared.js 2>/dev/null || true
  echo "✅ Placeholders restored."
  exit 0
fi

# ── Load .env ───────────────────────────────────────────────────────────
if [[ ! -f .env ]]; then
  echo "❌ .env file not found. Copy .env.example to .env and fill in your credentials:"
  echo "   cp .env.example .env"
  exit 1
fi

# Source .env (skip comments and blank lines)
set -a
while IFS='=' read -r key value; do
  # Skip comments, blank lines, and keys without values
  [[ "$key" =~ ^#.*$ || -z "$key" || -z "$value" ]] && continue
  key=$(echo "$key" | xargs)    # trim whitespace
  value=$(echo "$value" | xargs)
  export "$key=$value"
done < .env
set +a

# Verify required vars are set
REQUIRED=(FIREBASE_API_KEY FIREBASE_AUTH_DOMAIN FIREBASE_DATABASE_URL FIREBASE_APP_ID)
for var in "${REQUIRED[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "❌ Missing required variable: $var"
    echo "   Fill it in .env and try again."
    exit 1
  fi
done

echo "🔑 Credentials loaded from .env"

# ── Inject into files (same sed commands as CI) ────────────────────────
FILES_FIREBASE=(assets/js/mm-tracker.js admin/index.html assets/js/webapp-shared.js)
for f in "${FILES_FIREBASE[@]}"; do
  [[ -f "$f" ]] || continue
  sed -i "s|__FIREBASE_API_KEY__|${FIREBASE_API_KEY}|g" "$f"
  sed -i "s|__FIREBASE_AUTH_DOMAIN__|${FIREBASE_AUTH_DOMAIN}|g" "$f"
  sed -i "s|__FIREBASE_DATABASE_URL__|${FIREBASE_DATABASE_URL}|g" "$f"
  sed -i "s|__FIREBASE_PROJECT_ID__|${FIREBASE_PROJECT_ID:-magnetmomentsco-us}|g" "$f"
  sed -i "s|__FIREBASE_STORAGE_BUCKET__|${FIREBASE_STORAGE_BUCKET:-}|g" "$f"
  sed -i "s|__FIREBASE_MESSAGING_SENDER_ID__|${FIREBASE_MESSAGING_SENDER_ID:-}|g" "$f"
  sed -i "s|__FIREBASE_APP_ID__|${FIREBASE_APP_ID}|g" "$f"
done

# Apps Script URL (only in webapp-shared.js)
if [[ -n "${APPS_SCRIPT_URL:-}" ]]; then
  sed -i "s|__APPS_SCRIPT_URL__|${APPS_SCRIPT_URL}|g" assets/js/webapp-shared.js
fi

echo "✅ Credentials injected into local files"
echo ""
echo "⚠️  These files now contain real credentials (git-ignored changes)."
echo "   Run './scripts/local-dev.sh reset' to restore placeholders before committing."
echo ""

# ── Start server ────────────────────────────────────────────────────────
PORT="${1:-8080}"
echo "🚀 Starting local server on http://localhost:${PORT}"
echo "   Admin:  http://localhost:${PORT}/admin/"
echo "   Market: http://localhost:${PORT}/market/webapp/"
echo "   Event:  http://localhost:${PORT}/event/webapp/"
echo ""
echo "   Press Ctrl+C to stop. Placeholders will be restored automatically."
echo ""

# Trap Ctrl+C to auto-restore placeholders
cleanup() {
  echo ""
  echo "🔄 Restoring placeholder tokens…"
  git checkout -- assets/js/mm-tracker.js admin/index.html assets/js/webapp-shared.js 2>/dev/null || true
  echo "✅ Placeholders restored. Goodbye!"
  exit 0
}
trap cleanup INT TERM

python3 -m http.server "$PORT"
