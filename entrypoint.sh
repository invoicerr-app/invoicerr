#!/bin/sh

# Navigate to the backend directory where the compiled code and config are
cd /usr/share/nginx/backend/src

# ROLE switch: same image, different process. ROLE=worker runs ONLY the dedicated
# document-action queue worker (dist/src/worker.js, TODO.md item 22 — the compliance engine this
# comment used to reference was removed by the pre-refonte demolition; this is its documents-module
# equivalent) — no nginx, no frontend config, no migrations (those are API-only, handled inside
# main.js via syncDatabaseSchema()). Default (unset or "api") keeps the existing combined
# nginx+node backend below.
if [ "${ROLE:-api}" = "worker" ]; then
  echo "Starting document-action worker..."
  exec node worker.js
fi

# ROLE=ocr — TODO_PRODUIT.md T5(c). A THIRD, single-purpose role: a small HTTP service
# (dist/src/ocr-server.js) that alone holds MISTRAL_API_KEY and does the actual OCR call for
# unstructured received-invoice PDFs. Never nginx, never migrations, never the main backend's own
# database — the main backend (api role) only ever knows OCR_SERVICE_URL (see docker-compose.yml's
# own "ocr" service comment), and asks THIS process to do the extraction over plain HTTP
# (POST /extract). This is what lets a SaaS operator turn OCR on for an entire instance by deploying
# ONE service with their own key — self-hosters who never set OCR_SERVICE_URL never talk to this
# role at all, the honest full-local-by-default outcome.
if [ "${ROLE:-api}" = "ocr" ]; then
  echo "Starting OCR service..."
  exec node ocr-server.js
fi

echo "[DEBUG] - Listing files in /usr/share/nginx/backend"
ls -la /usr/share/nginx/backend

echo "[DEBUG] - Listing files in /usr/share/nginx/backend/src"
ls -la /usr/share/nginx/backend/src

echo "[DEBUG] - Listing files in /usr/share/nginx/backend/prisma"
ls -la /usr/share/nginx/backend/prisma

echo "[DEBUG] - Listing files in /usr/share/nginx/backend/src/prisma"
ls -la /usr/share/nginx/backend/src/prisma

echo "[DEBUG] - Listing files in /"
ls -la /

echo "[DEBUG] - Architecture info"
uname -a

# Create runtime config for frontend (populated from environment variables).
#
# This file is the ONLY env->browser channel: `import.meta.env` is baked at build time, and this image
# is built once and run with different environments.
#
# VITE_OIDC_PROVIDER_ID mirrors backend/src/lib/sso-policy.ts's own `resolveEnvOidcProvider` and MUST
# agree with it, because the page asks to sign in with this exact string and the IdP sends it back in a
# URL path segment. Two bugs are closed here:
#   - it is published only when OIDC_CLIENT_ID is set, i.e. only when the backend actually registered
#     the provider (publishing the raw OIDC_NAME meant an instance with a name but no client id showed
#     a button that led straight to PROVIDER_NOT_FOUND);
#   - it falls back to "oidc" and is sanitised to URL-safe characters (the old default, "Generic OIDC",
#     carried a SPACE into /api/auth/callback/..., where the id no longer matched the one registered).
# The sanitisation is the same rule as the TypeScript: anything outside [A-Za-z0-9._~-] becomes "-",
# leading/trailing whitespace is trimmed first, and a value with nothing alphanumeric left falls back.
echo "[DEBUG] - Writing frontend runtime config to /usr/share/nginx/html/config.json"
mkdir -p /usr/share/nginx/html

OIDC_PROVIDER_ID=""
if [ -n "${OIDC_CLIENT_ID:-}" ]; then
  OIDC_PROVIDER_ID=$(printf '%s' "${OIDC_NAME:-}" |
    sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/[^A-Za-z0-9._~-]/-/g')
  case "$OIDC_PROVIDER_ID" in
    *[A-Za-z0-9]*) ;;
    *) OIDC_PROVIDER_ID="oidc" ;;
  esac
fi

cat > /usr/share/nginx/html/config.json <<EOF
{
  "VITE_OIDC_PROVIDER_ID": "${OIDC_PROVIDER_ID}",
  "VITE_OIDC_ONLY": "${OIDC_ONLY:-}"
}
EOF

# Schema convergence (baseline + migrate deploy, and the one-off v1.4.4a
# leveling push for legacy db-push instances) is handled inside the backend
# at startup — see backend/src/prisma/sync-schema.ts. Doing it here
# unconditionally wrongly converged already-migrated instances back to
# v1.4.4a on every boot.

# Start the backend service
echo "Starting backend service..."
node main.js &
BACKEND_PID=$!

# Wait for backend to be ready
echo "Waiting for backend to start..."
while ! nc -z localhost 3000; do
    # Fail fast if the backend process died (e.g. a crash on boot) instead of
    # hanging forever waiting for a port that will never open.
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
        echo "Backend process exited before becoming ready. Aborting." >&2
        exit 1
    fi
    sleep 1
done

echo "Backend is ready, starting nginx..."
nginx -g "daemon off;" >/dev/null 2>&1