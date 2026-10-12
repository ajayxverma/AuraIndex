#!/usr/bin/env bash
# Stops everything started by run.sh: frontend, backend and the ChromaDB server.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
RUN_DIR="$ROOT/.run"
env_get() { grep -E "^$1=" "$ROOT/backend/.env" 2>/dev/null | tail -1 | cut -d= -f2-; }
CHROMA_PORT="$(env_get CHROMA_PORT)"; CHROMA_PORT="${CHROMA_PORT:-8001}"

# 1) Stop the whole run.sh process group (Ctrl+C equivalent).
if [[ -f "$RUN_DIR/run.pgid" ]]; then
  pgid="$(cat "$RUN_DIR/run.pgid")"
  own_pgid="$(ps -o pgid= $$ | tr -d ' ')"
  if [[ -n "$pgid" && "$pgid" != "$own_pgid" ]] && kill -0 -- "-$pgid" 2>/dev/null; then
    echo "==> Stopping run.sh process group $pgid"
    kill -TERM -- "-$pgid" 2>/dev/null
    for _ in $(seq 1 20); do
      kill -0 -- "-$pgid" 2>/dev/null || break
      sleep 0.5
    done
    kill -0 -- "-$pgid" 2>/dev/null && kill -KILL -- "-$pgid" 2>/dev/null
  fi
  rm -f "$RUN_DIR/run.pgid"
fi

# 2) Fallback: anything still listening on our ports, but only if it runs from this project.
cwd_of() { lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p'; }

stop_port() {
  local port="$1" name="$2" pids pid cwd
  pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | sort -u)"
  if [[ -z "$pids" ]]; then
    echo "    $name (port $port): not running"
    return
  fi
  for pid in $pids; do
    cwd="$(cwd_of "$pid")"
    if [[ "$cwd" == "$ROOT"* ]]; then
      kill -TERM "$pid" 2>/dev/null && echo "==> Stopped $name (port $port, pid $pid)"
    else
      echo "!! Port $port is used by pid $pid outside this project ($cwd); leaving it alone"
    fi
  done
}

stop_port 3000 "frontend"
stop_port 8000 "backend"
stop_port "$CHROMA_PORT" "chromadb"

sleep 1
for port in 3000 8000 "$CHROMA_PORT"; do
  for pid in $(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null); do
    [[ "$(cwd_of "$pid")" == "$ROOT"* ]] && kill -KILL "$pid" 2>/dev/null && echo "==> Force-killed pid $pid on port $port"
  done
done
echo "==> All stopped"
