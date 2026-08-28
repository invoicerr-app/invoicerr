#!/usr/bin/env bash
# Run the e2e suite from a DEDICATED git worktree, so the working tree stays editable.
#
# Why this exists: three Cypress runs in one session were invalidated by editing files while they
# ran. The backend runs under `nest start --watch`, so a save mid-run recompiles it and the
# frontend's dev server reloads — specs then fail on elements that briefly stop existing, and the
# failures look like regressions. Being careful is not a fix; not being able to do it is.
#
# The worktree is a frozen checkout of HEAD. The stack serves from it, Cypress drives it, and the
# main tree can be edited freely throughout.
#
#   ./scripts/e2e-worktree.sh [--spec "cypress/e2e/07-invoices.cy.ts"]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WT="${E2E_WORKTREE:-/tmp/invoicerr-e2e-worktree}"
DB="${E2E_DB:-invoicerr_e2e_wt}"
DB_URL="postgresql://invoicerr:invoicerr@localhost:5433/${DB}"

echo "→ frozen checkout at ${WT} (HEAD: $(git -C "$ROOT" rev-parse --short HEAD))"
git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || true
git -C "$ROOT" worktree add --detach --force "$WT" HEAD >/dev/null

# node_modules are not tracked; symlink rather than reinstall three times over.
for d in backend frontend e2e; do ln -sfn "$ROOT/$d/node_modules" "$WT/$d/node_modules"; done
ln -sfn "$ROOT/backend/prisma/generated" "$WT/backend/prisma/generated"

echo "→ database ${DB}"
docker exec invoicerr-postgres psql -U invoicerr -d postgres \
  -c "DROP DATABASE IF EXISTS \"${DB}\";" -c "CREATE DATABASE \"${DB}\";" >/dev/null
(cd "$WT/backend" && DATABASE_URL="$DB_URL" npx prisma migrate deploy >/dev/null)

echo "→ stack"
(cd "$WT/backend" && DATABASE_URL="$DB_URL" REDIS_URL="${E2E_REDIS_URL:-redis://localhost:6399}" \
  npm run start:test > /tmp/e2e-wt-backend.log 2>&1 &)
(cd "$WT/frontend" && npm run start:test > /tmp/e2e-wt-frontend.log 2>&1 &)
for _ in $(seq 1 60); do
  curl -sf http://localhost:4000/api/health >/dev/null 2>&1 &&
    curl -sf http://localhost:6284 >/dev/null 2>&1 && break
  sleep 2
done

echo "→ cypress"
set +e
(cd "$WT/e2e" && DATABASE_URL="$DB_URL" npm run e2e:run -- "$@")
STATUS=$?
set -e

pkill -f "$WT" 2>/dev/null || true
docker exec invoicerr-postgres psql -U invoicerr -d postgres -c "DROP DATABASE IF EXISTS \"${DB}\";" >/dev/null 2>&1 || true
git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || true
exit $STATUS
