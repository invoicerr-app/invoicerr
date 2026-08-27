#!/bin/sh

# Navigate to the backend directory where the compiled code and config are
cd /usr/share/nginx/backend/src

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

# Create runtime config for frontend (populated from environment variables)
echo "[DEBUG] - Writing frontend runtime config to /usr/share/nginx/html/config.json"
mkdir -p /usr/share/nginx/html
cat > /usr/share/nginx/html/config.json <<EOF
{
  "VITE_OIDC_PROVIDER_ID": "${OIDC_NAME:-}"
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

# Wait for backend to be ready
echo "Waiting for backend to start..."
while ! nc -z localhost 3000; do
    sleep 1
done

echo "Backend is ready, starting nginx..."
nginx -g "daemon off;" >/dev/null 2>&1