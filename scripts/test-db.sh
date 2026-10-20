#!/usr/bin/env bash
# Runs the schema and its rule checks against a throwaway local Postgres.
# Needs Postgres 15+ binaries on PATH or in /usr/lib/postgresql/*/bin.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
bin="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="${bin:+$bin:}$PATH"
dir="$(mktemp -d)"
cleanup() { pg_ctl -D "$dir/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$dir"; }
trap cleanup EXIT
run() { if [ "$(id -u)" = 0 ]; then chown -R postgres "$dir"; su postgres -s /bin/bash -c "PATH=$PATH $*"; else bash -c "$*"; fi; }
run "initdb -D $dir/data -A trust -U postgres >/dev/null"
run "pg_ctl -D $dir/data -o '-k $dir -p 54329 -c listen_addresses=' -l $dir/log -w start >/dev/null"
psql_() { run "psql -h $dir -p 54329 -U postgres -v ON_ERROR_STOP=1 -q -t -A $*"; }
psql_ "-c 'create database mathcloud'"
psql_ "-d mathcloud -f $here/supabase/tests/stub_auth.sql"
psql_ "-d mathcloud -f $here/supabase/migrations/0001_core.sql"
psql_ "-d mathcloud -f $here/supabase/migrations/0001_core.sql"   # re-running must be safe
psql_ "-d mathcloud -f $here/supabase/migrations/0002_take_part.sql"
psql_ "-d mathcloud -f $here/supabase/migrations/0002_take_part.sql"
psql_ "-d mathcloud -f $here/supabase/migrations/0003_app.sql"
psql_ "-d mathcloud -f $here/supabase/migrations/0003_app.sql"
psql_ "-d mathcloud -f $here/supabase/migrations/0004_editions_import.sql"
psql_ "-d mathcloud -f $here/supabase/migrations/0004_editions_import.sql"
psql_ "-d mathcloud -f $here/supabase/migrations/0005_public_and_speed.sql"
psql_ "-d mathcloud -f $here/supabase/migrations/0005_public_and_speed.sql"
psql_ "-d mathcloud -f $here/supabase/migrations/0006_contest_day.sql"
psql_ "-d mathcloud -f $here/supabase/migrations/0006_contest_day.sql"
psql_ "-d mathcloud -f $here/supabase/tests/rules.sql"
psql_ "-d mathcloud -f $here/supabase/tests/take_part.sql"
psql_ "-d mathcloud -f $here/supabase/tests/app.sql"
psql_ "-d mathcloud -f $here/supabase/tests/editions.sql"
psql_ "-d mathcloud -f $here/supabase/tests/public.sql"
