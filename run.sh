#!/usr/bin/env bash
# Starts ChromaDB (server mode), backend and frontend. Stop with Ctrl+C or ./stop.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
RUN_DIR="$ROOT/.run"
BACKEND_PORT=8000
FRONTEND_PORT=3000

env_get() { grep -E "^$1=" "$BACKEND/.env" 2>/dev/null | tail -1 | cut -d= -f2- || true; }
port_in_use() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1; }

# ---------- one-time setup ----------
if [[ ! -x "$BACKEND/.venv/bin/uvicorn" ]]; then
  echo "==> Setting up backend venv"
  uv venv --python 3.12 "$BACKEND/.venv"
  uv pip install --python "$BACKEND/.venv/bin/python" -r "$BACKEND/requirements.txt"
fi

if [[ ! -f "$BACKEND/.env" ]]; then
  echo "==> Creating backend/.env (remember to set LLM_API_KEY)"
  secret="$("$BACKEND/.venv/bin/python" -c 'import secrets;print(secrets.token_urlsafe(48))')"
  sed "s|^JWT_SECRET=.*|JWT_SECRET=$secret|" "$BACKEND/.env.example" > "$BACKEND/.env"
  chmod 600 "$BACKEND/.env"
fi

if [[ ! -d "$FRONTEND/node_modules" ]]; then
  echo "==> Installing frontend dependencies"
  (cd "$FRONTEND" && npm install --no-audit --no-fund)
fi

CHROMA_MODE="$(env_get CHROMA_MODE)"; CHROMA_MODE="${CHROMA_MODE:-server}"
CHROMA_HOST="$(env_get CHROMA_HOST)"; CHROMA_HOST="${CHROMA_HOST:-127.0.0.1}"
CHROMA_PORT="$(env_get CHROMA_PORT)"; CHROMA_PORT="${CHROMA_PORT:-8001}"
DATA_DIR="$(env_get DATA_DIR)"; DATA_DIR="${DATA_DIR:-./data}"

chroma_up() {
  curl -sf "http://$CHROMA_HOST:$CHROMA_PORT/api/v2/heartbeat" >/dev/null 2>&1 ||
    curl -sf "http://$CHROMA_HOST:$CHROMA_PORT/api/v1/heartbeat" >/dev/null 2>&1
}

# ---------- pre-flight ----------
for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  if port_in_use "$port"; then
    echo "!! Port $port is already in use. Run ./stop.sh first." >&2
    exit 1
  fi
done

mkdir -p "$RUN_DIR"
ps -o pgid= $$ | tr -d ' ' > "$RUN_DIR/run.pgid"

cleanup() {
  trap - INT TERM EXIT
  echo; echo "==> Stopping..."
  rm -f "$RUN_DIR/run.pgid"
  kill 0 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# ---------- ChromaDB ----------
if [[ "$CHROMA_MODE" == "server" ]]; then
  if chroma_up; then
    echo "==> ChromaDB already running at $CHROMA_HOST:$CHROMA_PORT (reusing)"
  elif port_in_use "$CHROMA_PORT"; then
    echo "!! Port $CHROMA_PORT is in use but is not a ChromaDB server. Run ./stop.sh or change CHROMA_PORT." >&2
    exit 1
  else
    echo "==> Starting ChromaDB on $CHROMA_HOST:$CHROMA_PORT"
    (cd "$BACKEND" && ANONYMIZED_TELEMETRY=False exec .venv/bin/chroma run --path "$DATA_DIR/chroma" \
      --host "$CHROMA_HOST" --port "$CHROMA_PORT" 2>&1 \
      | grep --line-buffered -v -E "DEBUG|heartbeat" | sed -u 's/^/[chroma]   /') &
    for _ in $(seq 1 60); do
      chroma_up && break
      sleep 0.5
    done
    if ! chroma_up; then
      echo "!! ChromaDB failed to start within 30s" >&2
      exit 1
    fi
    echo "==> ChromaDB is up"
  fi
else
  echo "==> ChromaDB running embedded inside the backend (CHROMA_MODE=$CHROMA_MODE)"
fi

# ---------- backend & frontend ----------
(cd "$BACKEND" && exec .venv/bin/uvicorn app.main:app --reload --port "$BACKEND_PORT" 2>&1 | sed -u 's/^/[backend]  /') &
(cd "$FRONTEND" && exec npm run dev 2>&1 | sed -u 's/^/[frontend] /') &

echo "==> Backend:  http://localhost:$BACKEND_PORT/docs"
echo "==> Frontend: http://localhost:$FRONTEND_PORT"
wait
