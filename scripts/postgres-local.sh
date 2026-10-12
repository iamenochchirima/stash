#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
pg_bin="${STASH_PG_BIN:-$(pg_config --bindir)}"
pg_data="$root/.data/postgres"
pg_socket="$root/.data/pgsocket"
pg_port="${STASH_PG_PORT:-55432}"
case "${1:-start}" in
 start)
  mkdir -p "$pg_data" "$pg_socket"
  if [[ ! -f "$pg_data/PG_VERSION" ]]; then "$pg_bin/initdb" -D "$pg_data" --auth=trust --no-instructions; fi
  if ! "$pg_bin/pg_ctl" -D "$pg_data" status >/dev/null 2>&1; then "$pg_bin/pg_ctl" -D "$pg_data" -l "$root/.data/postgres.log" -o "-h 127.0.0.1 -p $pg_port -k $pg_socket" start; fi
  for database in stash stash_test; do
   if ! "$pg_bin/psql" -w -h 127.0.0.1 -p "$pg_port" -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='$database'" | rg -q '^1$'; then "$pg_bin/createdb" -w -h 127.0.0.1 -p "$pg_port" "$database"; fi
  done
  ;;
 stop) "$pg_bin/pg_ctl" -D "$pg_data" stop -m fast ;;
 *) echo 'Usage: scripts/postgres-local.sh start|stop' >&2; exit 2 ;;
esac
