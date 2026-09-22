#!/usr/bin/env bash
#
# Local development stack for the Mac — always-on, hot-reloading.
#
#   ./scripts/dev.sh start     docker services + backend (nest --watch) + frontend (vite)
#   ./scripts/dev.sh stop      stops backend/frontend (docker services keep running)
#   ./scripts/dev.sh down      stops everything, including the docker services
#   ./scripts/dev.sh status    what is up, and on which port
#   ./scripts/dev.sh logs      tail both application logs
#   ./scripts/dev.sh restart   stop + start
#
# Backend and frontend run on the host (not in docker) so file changes recompile
# instantly. Postgres, Redis and Mailpit come from docker-compose.dev.yml.
#
#   backend   http://localhost:3000/api      logs .dev/backend.log
#   frontend  http://localhost:5173          logs .dev/frontend.log
#   mailpit   http://localhost:8025
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT/.dev"
COMPOSE_FILE="$ROOT/docker-compose.dev.yml"
BACKEND_PORT=3000
FRONTEND_PORT=5173

mkdir -p "$RUN_DIR"

pid_of() { [ -f "$RUN_DIR/$1.pid" ] && cat "$RUN_DIR/$1.pid" || echo ""; }

alive() {
  local pid
  pid="$(pid_of "$1")"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

wait_for_http() {
  local url="$1" name="$2" tries="${3:-60}"
  for _ in $(seq 1 "$tries"); do
    if curl -fsS -m 2 -o /dev/null "$url"; then
      echo "  $name is up → $url"
      return 0
    fi
    sleep 1
  done
  echo "  !! $name did not answer on $url — see $RUN_DIR/$name.log"
  return 1
}

start_services() {
  echo "▸ docker services (postgres, redis, mailpit)"
  docker compose -f "$COMPOSE_FILE" up -d
  # Postgres accepts connections a moment after the container reports running.
  for _ in $(seq 1 30); do
    docker compose -f "$COMPOSE_FILE" exec -T db pg_isready -U invoicerr >/dev/null 2>&1 && break
    sleep 1
  done
}

start_app() {
  local name="$1" dir="$2" cmd="$3" port="$4"
  if alive "$name"; then
    echo "▸ $name already running (pid $(pid_of "$name"))"
    return
  fi
  if port_busy "$port"; then
    echo "▸ $name: port $port is already taken by another process — skipping"
    return
  fi
  echo "▸ starting $name"
  (cd "$dir" && nohup $cmd >"$RUN_DIR/$name.log" 2>&1 & echo $! >"$RUN_DIR/$name.pid")
}

stop_app() {
  local name="$1"
  local pid
  pid="$(pid_of "$name")"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "▸ stopping $name (pid $pid)"
    # The watchers spawn children; kill the whole process group.
    kill -TERM -- "-$(ps -o pgid= "$pid" | tr -d ' ')" 2>/dev/null || kill "$pid" 2>/dev/null || true
  fi
  rm -f "$RUN_DIR/$name.pid"
}

case "${1:-start}" in
  start)
    start_services
    echo "▸ prisma client"
    (cd "$ROOT/backend" && npx prisma generate >>"$RUN_DIR/prisma.log" 2>&1)
    echo "▸ database schema"
    (cd "$ROOT/backend" && npx prisma migrate deploy >>"$RUN_DIR/prisma.log" 2>&1) || \
      echo "  !! migrate deploy failed — see $RUN_DIR/prisma.log"
    start_app backend "$ROOT/backend" "npm run start:dev" "$BACKEND_PORT"
    start_app frontend "$ROOT/frontend" "npm run dev" "$FRONTEND_PORT"
    wait_for_http "http://localhost:$BACKEND_PORT/api/health" backend 90 || true
    wait_for_http "http://localhost:$FRONTEND_PORT" frontend 60 || true
    ;;
  stop)
    stop_app backend
    stop_app frontend
    ;;
  down)
    stop_app backend
    stop_app frontend
    docker compose -f "$COMPOSE_FILE" down
    ;;
  restart)
    "$0" stop
    "$0" start
    ;;
  status)
    for name in backend frontend; do
      if alive "$name"; then echo "$name: running (pid $(pid_of "$name"))"; else echo "$name: stopped"; fi
    done
    curl -fsS -m 2 -o /dev/null "http://localhost:$BACKEND_PORT/api/health" && echo "backend health: ok" || echo "backend health: unreachable"
    curl -fsS -m 2 -o /dev/null "http://localhost:$FRONTEND_PORT" && echo "frontend: ok" || echo "frontend: unreachable"
    docker compose -f "$COMPOSE_FILE" ps
    ;;
  logs)
    tail -n 50 -f "$RUN_DIR/backend.log" "$RUN_DIR/frontend.log"
    ;;
  *)
    echo "usage: $0 {start|stop|restart|down|status|logs}" >&2
    exit 1
    ;;
esac
