#!/usr/bin/env bash

set -euo pipefail

# Thư mục gốc của project (thư mục chứa docker-compose.yml)
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

COMMAND="${1:-deploy}"

case "$COMMAND" in
  deploy|up)
    echo "[deploy] Building Docker images..."
    docker compose pull || true
    docker compose build

    echo "[deploy] Starting/Restarting containers in detached mode..."
    docker compose up -d

    echo "[deploy] Current container status:"
    docker compose ps
    ;;

  restart)
    echo "[restart] Restarting containers without rebuild..."
    docker compose restart
    docker compose ps
    ;;

  logs)
    echo "[logs] Tailing logs (Ctrl+C to exit)..."
    docker compose logs -f
    ;;

  *)
    echo "Usage: $0 [deploy|up|restart|logs]"
    echo "  deploy|up  : build images và khởi động/restart toàn bộ stack"
    echo "  restart    : restart containers mà không build lại image"
    echo "  logs       : xem log tất cả service"
    exit 1
    ;;

esac
