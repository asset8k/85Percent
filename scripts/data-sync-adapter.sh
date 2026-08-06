#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="tmkt-api"
# Avoid reusing a pre-existing image from a different Transfermarkt adapter.
# Earlier local setups used the same generic tag for felipeall/transfermarkt-api,
# whose endpoint implementation is incompatible with this workflow.
IMAGE_NAME="85percent-transfermarkt-api:local-v1"
PORT="8000"
CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/Library/Caches}/85percent/transfermarkt-api"
REPOSITORY_URL="https://github.com/felipeall/transfermarkt-api.git"

ensure_docker() {
  command -v docker >/dev/null || { echo "Docker CLI is required." >&2; exit 1; }
  if ! docker info >/dev/null 2>&1; then
    command -v colima >/dev/null || { echo "Docker is unavailable and Colima is not installed." >&2; exit 1; }
    echo "Starting Colima..."
    colima start
  fi
  docker info >/dev/null
}

adapter_health() {
  # Startup must only establish that the local FastAPI adapter is running. A
  # competition scrape reaches Transfermarkt and can fail independently due to
  # rate limiting or an upstream markup change, which is not a container-health
  # failure.
  curl -fsS --max-time 5 "http://localhost:${PORT}/openapi.json" \
    | grep -q '"/clubs/{club_id}/players"'
}

setup() {
  ensure_docker
  mkdir -p "$(dirname "$CACHE_ROOT")"
  if [[ -d "$CACHE_ROOT/.git" ]]; then
    git -C "$CACHE_ROOT" fetch --quiet origin
    git -C "$CACHE_ROOT" pull --ff-only --quiet
  else
    git clone "$REPOSITORY_URL" "$CACHE_ROOT"
  fi
  docker build -t "$IMAGE_NAME" "$CACHE_ROOT"
}

start() {
  ensure_docker
  if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
    if [[ "$(docker container inspect -f '{{.Config.Image}}' "$CONTAINER_NAME")" == "$IMAGE_NAME" ]] \
      && [[ "$(docker container inspect -f '{{.State.Running}}' "$CONTAINER_NAME")" == "true" ]] \
      && adapter_health; then
      echo "Transfermarkt adapter is already healthy at http://localhost:${PORT}."
      return
    fi
    docker rm -f "$CONTAINER_NAME" >/dev/null
  fi
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port ${PORT} is already in use by another process; refusing to replace it." >&2
    exit 1
  fi
  docker image inspect "$IMAGE_NAME" >/dev/null 2>&1 || setup
  docker run -d --name "$CONTAINER_NAME" -p "${PORT}:8000" "$IMAGE_NAME" >/dev/null
  for _ in {1..20}; do
    if adapter_health; then
      echo "Transfermarkt adapter is ready at http://localhost:${PORT}."
      return
    fi
    sleep 1
  done
  docker logs "$CONTAINER_NAME" --tail 80 >&2 || true
  echo "Transfermarkt adapter did not become healthy." >&2
  exit 1
}

status() {
  command -v docker >/dev/null && echo "Docker CLI: installed" || echo "Docker CLI: missing"
  command -v colima >/dev/null && echo "Colima: installed" || echo "Colima: missing"
  if ! docker info >/dev/null 2>&1; then echo "Docker daemon: unavailable"; return 1; fi
  echo "Docker daemon: available"
  docker image inspect "$IMAGE_NAME" >/dev/null 2>&1 && echo "Image: present" || echo "Image: missing"
  if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
    echo "Container: $(docker container inspect -f '{{.State.Status}}' "$CONTAINER_NAME")"
  else echo "Container: missing"; fi
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && echo "Port ${PORT}: listening" || echo "Port ${PORT}: not listening"
  adapter_health && echo "Adapter health: ready" || echo "Adapter health: unavailable"
}

stop() {
  ensure_docker
  docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1 && docker rm -f "$CONTAINER_NAME" >/dev/null || true
  echo "Transfermarkt adapter stopped."
}

case "${1:-}" in
  setup|start|status|stop) "$1" ;;
  *) echo "Usage: $0 {setup|start|status|stop}" >&2; exit 2 ;;
esac
