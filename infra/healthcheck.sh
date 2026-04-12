#!/usr/bin/env bash
set -euo pipefail

MAX_RETRIES=30
SLEEP_INTERVAL=2

check_postgres() {
  for i in $(seq 1 "$MAX_RETRIES"); do
    if docker exec finch-postgres pg_isready -U finch -d finch >/dev/null 2>&1; then
      echo "✓ finch-postgres is ready"
      return 0
    fi
    sleep "$SLEEP_INTERVAL"
  done
  echo "✗ finch-postgres failed to become ready"
  return 1
}

check_redis() {
  for i in $(seq 1 "$MAX_RETRIES"); do
    if docker exec finch-redis redis-cli ping 2>/dev/null | grep -q PONG; then
      echo "✓ finch-redis is ready"
      return 0
    fi
    sleep "$SLEEP_INTERVAL"
  done
  echo "✗ finch-redis failed to become ready"
  return 1
}

check_temporal_ui() {
  for i in $(seq 1 "$MAX_RETRIES"); do
    if curl -sf http://localhost:8080 >/dev/null 2>&1; then
      echo "✓ finch-temporal-ui is ready"
      return 0
    fi
    sleep "$SLEEP_INTERVAL"
  done
  echo "✗ finch-temporal-ui failed to become ready"
  return 1
}

echo "Checking infrastructure services..."

FAILED=0

check_postgres || FAILED=1
check_redis || FAILED=1
check_temporal_ui || FAILED=1

if [ "$FAILED" -ne 0 ]; then
  echo ""
  echo "One or more services failed health checks."
  exit 1
fi

echo ""
echo "All services are healthy."
exit 0
