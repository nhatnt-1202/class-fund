#!/usr/bin/env bash
# Chạy bộ kiểm thử DB trên một Postgres sạch trong Docker.
#   bash tests/db/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

CONTAINER=quylop-test-db
PGPASSWORD=pg

echo "▸ Dựng Postgres sạch trong Docker…"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD="$PGPASSWORD" -e POSTGRES_DB=quylop \
  postgres:17-alpine >/dev/null
# initdb khởi động server tạm rồi restart, nên pg_isready một lần là chưa đủ:
# phải chờ tới khi kết nối thật thành công 2 lần liên tiếp.
ok=0
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" psql -U postgres -d quylop -q -tAc 'select 1' >/dev/null 2>&1; then
    ok=$((ok + 1))
    [ "$ok" -ge 2 ] && break
  else
    ok=0
  fi
  sleep 1
done
[ "$ok" -ge 2 ] || { echo "Postgres không khởi động được"; docker logs --tail 20 "$CONTAINER"; exit 1; }

docker cp tests/db/00_shim.sql "$CONTAINER":/tmp/ >/dev/null
docker cp tests/db/01_test.sql "$CONTAINER":/tmp/ >/dev/null
docker cp supabase/migrations/. "$CONTAINER":/tmp/ >/dev/null

# -o /dev/null: bỏ kết quả truy vấn, chỉ giữ các dòng NOTICE (PASS/FAIL) ở stderr
run() { docker exec "$CONTAINER" psql -U postgres -d quylop -v ON_ERROR_STOP=1 -q -o /dev/null -f "$1"; }

echo "▸ Shim Supabase (auth.users, auth.uid, các role)…"
run /tmp/00_shim.sql
echo "▸ Migrations…"
for f in supabase/migrations/*.sql; do
  echo "   $(basename "$f")"
  run "/tmp/$(basename "$f")"
done
echo "▸ Kiểm thử RLS + nghiệp vụ + audit log…"
docker exec "$CONTAINER" psql -U postgres -d quylop -v ON_ERROR_STOP=1 -q -o /dev/null -f /tmp/01_test.sql 2>&1 |
  sed -E 's/^psql:[^ ]+ //; s/^NOTICE:  //' | grep -Ev '^\s*$'

echo ""
echo "▸ Dọn container"
docker rm -f "$CONTAINER" >/dev/null
