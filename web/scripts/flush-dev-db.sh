#!/usr/bin/env bash
# RETIRED 2026-10-03: the project below became production; flush/rehearse now refuse.
#
# Flush the DEV Supabase project back to an empty app: every row of app data,
# every login and every uploaded file. What stays: the schema, the migration
# history, the pg_cron jobs, the Storage buckets, and the reference / platform
# configuration tables listed in scripts/flush-dev-db.sql.
#
# It only ever touches the dev project (sivarqzgyeniuveqnjtq): every database
# URL, the API URL and the service key in web/.env.local must belong to it,
# and the SQL also checks the server's own fingerprint. Before anything is
# deleted, every table is copied to CSV — inside the flush's own transaction,
# under lock, so the copy is exactly what gets removed — to
# cubes-db-snapshots/<stamp>-dev-flush/ (git-ignored), with a restore script.
#
#   scripts/flush-dev-db.sh --plan       # read-only: what would go, what stays
#   scripts/flush-dev-db.sh --rehearse   # every step incl. backup, checked, then rolled back
#   scripts/flush-dev-db.sh              # plan → confirm → back up + flush → files → verify
#   scripts/flush-dev-db.sh --yes        # same, without the typed confirmation
#   BACKUP_FILES=1 scripts/flush-dev-db.sh   # also download every Storage file first (~1 GB)
#   scripts/flush-dev-db.sh --grant-admin you@example.com
#                                        # right after signing up again: platform admin back
#
# Uses SUPABASE_DB_URL, or SUPABASE_DB_POOLER_URL when the direct host (IPv6
# only) can't be reached. Stop `next dev` first: the flush locks every table.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env.local ] || { echo "web/.env.local not found" >&2; exit 1; }
set -a; # shellcheck disable=SC1091
source .env.local; set +a
: "${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL is not set in web/.env.local}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is not set in web/.env.local}"
# Nothing in the environment may point libpq at another server than the URL says.
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD PGSERVICE PGSERVICEFILE PGOPTIONS

DEV_REF="sivarqzgyeniuveqnjtq"
MODE="flush"; MODE_FLAG=""; ASSUME_YES=0; ADMIN_EMAIL=""
usage() {
  echo "usage: scripts/flush-dev-db.sh [--plan | --rehearse | --grant-admin <email>] [--yes]" >&2
  exit 2
}
set_mode() {
  [ -z "$MODE_FLAG" ] || { echo "$MODE_FLAG and $1 can't be combined" >&2; usage; }
  MODE_FLAG="$1"; MODE="$2"
}
while [ $# -gt 0 ]; do
  case "$1" in
    --plan) set_mode "$1" plan ;;
    --rehearse) set_mode "$1" rehearse ;;
    --grant-admin)
      if [ $# -lt 2 ] || [ "${2#-}" != "$2" ]; then
        echo "usage: scripts/flush-dev-db.sh --grant-admin you@example.com" >&2; exit 2
      fi
      set_mode "$1" grant; ADMIN_EMAIL="$2"; shift ;;
    --yes) ASSUME_YES=1 ;;
    -h|--help) usage ;;
    *) echo "unknown option: $1" >&2; usage ;;
  esac
  shift
done

# Since 2026-10-03 this project is production (cubes.im runs on it): it is never
# flushed again. --plan (read-only) and --grant-admin still work.
if [ "$MODE" = "flush" ] || [ "$MODE" = "rehearse" ]; then
  echo "Refusing: $DEV_REF has been the production database since 2026-10-03 — this script no longer flushes it." >&2
  exit 1
fi

# --- guard: every credential must belong to the dev project ------------------
ref_of_db_url() {
  if [[ $1 =~ @db\.([a-z0-9]+)\.supabase\.co ]]; then echo "${BASH_REMATCH[1]}"
  elif [[ $1 =~ ://postgres\.([a-z0-9]+): ]]; then echo "${BASH_REMATCH[1]}"; fi
}
# host=/hostaddr=/service= in the query string override the host part.
redirects() { [[ $1 == *[?\&]host=* || $1 == *[?\&]hostaddr=* || $1 == *[?\&]service=* ]]; }
refuse() { echo "Refusing: this only flushes the dev project ($DEV_REF). $1" >&2; exit 1; }

DB_URL=""; DB_VIA=""
for var in SUPABASE_DB_URL SUPABASE_DB_POOLER_URL; do
  url="${!var:-}"
  [ -n "$url" ] || continue
  ref=$(ref_of_db_url "$url")
  [ "$ref" = "$DEV_REF" ] || refuse "$var points at ${ref:-an unrecognised host}."
  if redirects "$url"; then refuse "$var carries a host/hostaddr/service parameter."; fi
done
[[ $NEXT_PUBLIC_SUPABASE_URL =~ ^https://([a-z0-9]+)\.supabase\.co ]] && api_ref="${BASH_REMATCH[1]}" || api_ref=""
[ "$api_ref" = "$DEV_REF" ] || refuse "NEXT_PUBLIC_SUPABASE_URL points at ${api_ref:-an unrecognised host}."
key_ref=$(node -e '
  const part = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").split(".")[1];
  if (!part) { process.stdout.write("opaque"); process.exit(0); }
  try { process.stdout.write(JSON.parse(Buffer.from(part, "base64url").toString()).ref || ""); } catch {}
')
# An opaque (sb_secret_…) key has no readable ref; the Storage check below
# proves it belongs to this project instead.
[ "$key_ref" = "$DEV_REF" ] || [ "$key_ref" = "opaque" ] || refuse "SUPABASE_SERVICE_ROLE_KEY belongs to ${key_ref:-an unknown project}."

# The direct host is IPv6-only; fall back to the session pooler when it can't be reached.
export PGCONNECT_TIMEOUT=15
for var in SUPABASE_DB_URL SUPABASE_DB_POOLER_URL; do
  url="${!var:-}"
  [ -n "$url" ] || continue
  if psql "$url" -X -At -c "select 1" >/dev/null 2>&1; then DB_URL="$url"; DB_VIA="$var"; break; fi
done
[ -n "$DB_URL" ] || { echo "Can't reach the dev database through SUPABASE_DB_URL or SUPABASE_DB_POOLER_URL." >&2; exit 1; }
PSQL=(psql "$DB_URL" -X -q -v ON_ERROR_STOP=1)
# The server's own fingerprint (see the SQL): a redirected connection stops here.
"${PSQL[@]}" -v mode=guard -f scripts/flush-dev-db.sql
echo "Dev project $DEV_REF — URLs, key and the server's fingerprint all check out (via $DB_VIA)."

# --- right after signing up again: platform admin back -------------------------
if [ "$MODE" = "grant" ]; then
  # psql variables (:'email') only interpolate in scripts, not in -c.
  granted=$("${PSQL[@]}" -At -v email="$ADMIN_EMAIL" <<'SQL' | wc -l | tr -d ' '
insert into public.platform_admins (user_id)
select id from public.users where lower(email) = lower(:'email')
on conflict (user_id) do nothing
returning user_id;
SQL
)
  exists=$("${PSQL[@]}" -At -v email="$ADMIN_EMAIL" <<'SQL'
select count(*) from public.platform_admins pa join public.users u on u.id = pa.user_id
 where lower(u.email) = lower(:'email');
SQL
)
  if [ "$exists" = "0" ]; then echo "No account for $ADMIN_EMAIL yet — sign up first, then run this again." >&2; exit 1; fi
  [ "$granted" = "0" ] && echo "$ADMIN_EMAIL was already a platform admin." || echo "$ADMIN_EMAIL is a platform admin again."
  # Anyone else on this list got in through claim_first_superadmin() before you did.
  echo "Platform admins now:"
  "${PSQL[@]}" -At -c "select '  ' || u.email from public.platform_admins pa join public.users u on u.id = pa.user_id order by u.email;"
  exit 0
fi

# --- plan ------------------------------------------------------------------------
"${PSQL[@]}" -v mode=plan -f scripts/flush-dev-db.sql
[ "$MODE" = "plan" ] && exit 0

# The service key must work before anything irreversible happens.
node scripts/flush-dev-storage.mjs --check

# \copy commands for every table (+ the logins), without generated columns —
# COPY FROM refuses them, so a backup with them couldn't be restored — and the
# matching restore script. Both use absolute paths.
write_backup_scripts() {
  local dir="$1"
  mkdir -p "$dir/tables"
  "${PSQL[@]}" -At -v dir="$dir/tables" > "$dir/backup.psql" <<'SQL'
select format('\copy (select %s from %I.%I) to %L with (format csv, header)',
              string_agg(format('%I', a.attname), ', ' order by a.attnum), n.nspname, c.relname,
              :'dir' || '/' || n.nspname || '.' || c.relname || '.csv')
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
 where c.relkind in ('r', 'p')
   and (n.nspname = 'public' or (n.nspname = 'auth' and c.relname in ('users', 'identities')))
 group by n.nspname, c.relname
 order by n.nspname, c.relname;
SQL
  # Exact row counts, from the same locked snapshot as the CSVs.
  echo "\\copy (select t::text as \"table\", keep, rows_before as rows from flush_plan order by 1) to '$dir/table-rows.csv' with (format csv, header)" >> "$dir/backup.psql"
  {
    echo "-- Puts the flushed rows back, into the flushed database, before anyone signs up again:"
    echo "--   psql \"\$SUPABASE_DB_POOLER_URL\" -X -1 -v ON_ERROR_STOP=1 -f '$dir/restore.psql'"
    echo "-- Triggers and FK checks are off while loading, so the order doesn't matter and"
    echo "-- the sign-up trigger doesn't fire for the restored logins."
    echo "set session_replication_role = replica;"
    "${PSQL[@]}" -At -v dir="$dir/tables" <<'SQL'
select format('\copy %I.%I (%s) from %L with (format csv, header match)',
              n.nspname, c.relname, string_agg(format('%I', a.attname), ', ' order by a.attnum),
              :'dir' || '/' || n.nspname || '.' || c.relname || '.csv')
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
 where c.relkind in ('r', 'p')
   and (n.nspname = 'public' or (n.nspname = 'auth' and c.relname in ('users', 'identities')))
 group by n.nspname, c.relname
 order by n.nspname = 'auth' desc, n.nspname, c.relname;
SQL
    echo "set session_replication_role = origin;"
  } > "$dir/restore.psql"
}

# --- rehearsal: everything, backup included, then rolled back ---------------------
if [ "$MODE" = "rehearse" ]; then
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  write_backup_scripts "$tmp"
  echo; echo "Rehearsing the flush (rolled back at the end)…"
  "${PSQL[@]}" -v mode=rehearse -v backup="$tmp/backup.psql" -f scripts/flush-dev-db.sql
  echo "  the rehearsal's backup wrote $(ls "$tmp/tables" | wc -l | tr -d ' ') CSVs ($(du -sh "$tmp/tables" | cut -f1)); they were deleted again."
  exit 0
fi

# --- confirm -----------------------------------------------------------------------
if [ "$ASSUME_YES" != "1" ]; then
  echo
  echo "This deletes all of the above for good (a CSV backup is taken as part of it)."
  read -r -p "Type the project ref ($DEV_REF) to flush it: " answer
  [ "$answer" = "$DEV_REF" ] || { echo "Not confirmed — nothing was changed."; exit 1; }
fi

STAMP=$(date +%Y-%m-%d-%H%M%S)
mkdir -p "../cubes-db-snapshots/${STAMP}-dev-flush"
OUT=$(cd "../cubes-db-snapshots/${STAMP}-dev-flush" && pwd)
write_backup_scripts "$OUT"
"${PSQL[@]}" -At -c "select coalesce(json_agg(json_build_object('b', bucket_id, 'p', name) order by bucket_id, name), '[]') from storage.objects;" > "$OUT/storage-objects.json"
cat > "$OUT/README.txt" <<EOF
Backup of the dev project $DEV_REF, taken by scripts/flush-dev-db.sh at $STAMP,
inside the flush's own transaction (so it is exactly what the flush removed).

tables/<schema>.<table>.csv   every public table, plus auth.users and auth.identities
                              (generated columns left out; they recompute on load)
table-rows.csv                exact row count of every public table at flush time
restore.psql                  loads every CSV back — see the comment at its top
storage-objects.json          the Storage files that existed (bucket + path)
storage/                      the files themselves, when run with BACKUP_FILES=1
EOF
if [ "${BACKUP_FILES:-0}" = "1" ]; then
  echo; echo "Downloading every Storage file…"
  node scripts/flush-dev-storage.mjs "$OUT/storage-objects.json" --download "$OUT/storage"
fi

# --- back up + flush the database (one transaction, checked before commit) -----------
echo; echo "Flushing the database (backup to cubes-db-snapshots/${STAMP}-dev-flush/)…"
"${PSQL[@]}" -v mode=flush -v backup="$OUT/backup.psql" -f scripts/flush-dev-db.sql

# --- files: whatever storage.objects lists now, until nothing is left ----------------
echo; echo "Removing Storage files…"
for pass in 1 2 3; do
  "${PSQL[@]}" -At -c "select coalesce(json_agg(json_build_object('b', bucket_id, 'p', name) order by bucket_id, name), '[]') from storage.objects;" > "$OUT/storage-pass-$pass.json"
  if [ "$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).length))' "$OUT/storage-pass-$pass.json")" = "0" ]; then break; fi
  node scripts/flush-dev-storage.mjs "$OUT/storage-pass-$pass.json" --delete || echo "  (pass $pass didn't remove everything; trying again)"
done

# --- verify ------------------------------------------------------------------------
read -r logins profiles workspaces files admins <<< "$("${PSQL[@]}" -At -F ' ' -c "
  select (select count(*) from auth.users), (select count(*) from public.users),
         (select count(*) from public.teams), (select count(*) from storage.objects),
         (select count(*) from public.platform_admins);")"
echo; echo "Left behind: $logins logins · $profiles profiles · $workspaces workspaces · $files storage files · $admins platform admins"
if [ "$logins$profiles$workspaces$files$admins" != "00000" ]; then
  echo "Something was left behind — see the counts above. Re-running this script is safe." >&2
  exit 1
fi

cat <<EOF

Done. Backup: cubes-db-snapshots/${STAMP}-dev-flush/
Next:
  1. Sign up again (an old browser session just lands on the login page).
  2. Straight after — before anyone else signs up — take the admin center back:
       scripts/flush-dev-db.sh --grant-admin <your email>
     While no platform admin exists, the first signed-in account could claim it.
EOF
