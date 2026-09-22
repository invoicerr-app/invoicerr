#!/bin/sh

# Navigate to the backend directory where the compiled code and config are
cd /usr/share/nginx/backend/src

# ROLE switch: same image, different process. ROLE=worker runs ONLY the dedicated
# document-action queue worker (dist/src/worker.js) — no nginx, no frontend config, no migrations
# (those are API-only, handled inside main.js via syncDatabaseSchema()). Default (unset or "api")
# keeps the existing combined nginx+node backend below.
if [ "${ROLE:-api}" = "worker" ]; then
  echo "Starting document-action worker..."
  exec node worker.js
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

# ENABLE_BETA_BANNER: off by default, turns on exactly ONE thing — a banner on the sign-in/sign-up
# screens (frontend/src/components/beta-banner.tsx, mounted once from AuthShell) telling a visitor
# this instance is a preview, so nobody issues an invoice here and then relies on it.
# Published raw, the same passthrough as VITE_OIDC_ONLY above: no shell-side parsing, the frontend's
# own tolerant boolean check (isBetaBannerEnabled, lib/runtime-config.ts) is the single source of
# truth for what counts as "on". Deliberately an ORDINARY name, not a shouty one like
# WARNING__ENABLE_BILLING_FOR_USERS__WARNING (backend/src/modules/billing/billing-flag.ts) — that
# flag is shouty because getting it wrong by accident turns on a whole billing system; this one only
# ever adds a sentence to a page nobody is signed into yet, so an accidental flip in either direction
# costs nothing worse than a banner that shouldn't (or should) be there. Public by design: this is
# read before anyone logs in, so it goes through the same unauthenticated /config.json channel as
# everything else in this file, never a session-gated endpoint.
cat > /usr/share/nginx/html/config.json <<EOF
{
  "VITE_OIDC_PROVIDER_ID": "${OIDC_PROVIDER_ID}",
  "VITE_OIDC_ONLY": "${OIDC_ONLY:-}",
  "VITE_ENABLE_BETA_BANNER": "${ENABLE_BETA_BANNER:-}"
}
EOF

# HSTS opt-in (nginx.conf's own `__HSTS_HEADER__` marker, and the header's own comment there, explain
# why this is never sent unconditionally): only an operator who has confirmed THIS instance is reached
# exclusively over HTTPS should set ENABLE_HSTS=true. `includeSubDomains` is part of that same explicit
# opt-in, never assumed — an operator running something else on a sibling subdomain over plain HTTP
# would otherwise have HSTS sprung on them by invoicerr's own response.
if [ "${ENABLE_HSTS:-false}" = "true" ]; then
  echo "[DEBUG] - ENABLE_HSTS=true — sending Strict-Transport-Security"
  sed -i 's|# __HSTS_HEADER__|add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;|' \
    /etc/nginx/conf.d/default.conf
fi

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