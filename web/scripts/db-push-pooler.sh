#!/usr/bin/env bash
# Push pending Supabase migrations through the IPv4 session pooler.
#
# Why this exists: the direct DB host (db.<ref>.supabase.co) is IPv6-only. On a
# network without an IPv6 route, `supabase db push` against it fails with
# "could not translate host name". The pooler is the same database over IPv4.
# Reads SUPABASE_DB_POOLER_URL from web/.env.local and percent-encodes the
# password, which --db-url requires.
#
#   scripts/db-push-pooler.sh          # push pending migrations (asks to confirm)
#   scripts/db-push-pooler.sh --yes    # same, without the prompt (non-interactive)
#   scripts/db-push-pooler.sh --check  # read-only: prove connectivity, list pending
# Any other flags are passed straight through to `supabase db push`.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env.local ] || { echo "web/.env.local not found" >&2; exit 1; }
set -a; # shellcheck disable=SC1091
source .env.local; set +a
: "${SUPABASE_DB_POOLER_URL:?SUPABASE_DB_POOLER_URL is not set in web/.env.local}"

ENC=$(python3 - <<'PY'
import os
from urllib.parse import urlsplit, urlunsplit, quote
p = urlsplit(os.environ["SUPABASE_DB_POOLER_URL"]); ui, host = p.netloc.split("@"); user, pw = ui.split(":", 1)
print(urlunsplit((p.scheme, f"{user}:{quote(pw, safe='')}@{host}", p.path, p.query, "")))
PY
)
export PGCONNECT_TIMEOUT=20

if [ "${1:-}" = "--check" ]; then
  echo "connectivity:"; psql "$SUPABASE_DB_POOLER_URL" -At -c "select '  ok — remote is at '||max(version) from supabase_migrations.schema_migrations;"
  echo "pending (in repo, not yet applied):"
  ls supabase/migrations/*.sql | sed -E 's/.*\/([0-9]+)_(.*)\.sql/\1 \2/' | sort > /tmp/_repo.$$
  psql "$SUPABASE_DB_POOLER_URL" -At -c "select version from supabase_migrations.schema_migrations;" | sort > /tmp/_applied.$$
  awk 'NR==FNR{a[$1]=1;next} !($1 in a){print "  "$0}' /tmp/_applied.$$ /tmp/_repo.$$; rm -f /tmp/_repo.$$ /tmp/_applied.$$
  exit 0
fi

echo "Pushing pending migrations via the IPv4 pooler…"
exec supabase db push --db-url "$ENC" "$@"
