#!/usr/bin/env bash
# Copy production's data (txrpnoxwczodnzafjozl) into the EMPTY dev project
# (sivarqzgyeniuveqnjtq): every public table, the logins (auth.users +
# identities) and every Storage file. Production is only ever read.
#
# - Run scripts/flush-dev-db.sh first: dev must have no logins, workspaces or files.
# - The reference / platform tables flush-dev-db.sql keeps are not copied —
#   dev already has the same rows, plus its own migrations' additions; and
#   production's push_config / billing_config would make dev call the live app.
# - Schemas differ (dev runs ahead): only columns both sides have are copied,
#   dev-only columns take their defaults, and the data steps of dev's
#   migrations that production never ran are replayed (scripts/clone-prod-fixups.sql).
# - Production is read in one read-only, repeatable-read snapshot; dev is
#   loaded in one transaction with triggers off (no sign-up provisioning, no
#   activity rows, no workflow events), then checked for orphaned references
#   and row counts before it commits.
#
#   scripts/clone-prod-to-dev.sh --plan        # read-only on both sides: what would be copied
#   scripts/clone-prod-to-dev.sh               # export → load → files → verify (asks first)
#   scripts/clone-prod-to-dev.sh --yes         # same, without the prompt
#   scripts/clone-prod-to-dev.sh --files-only  # (re)copy the Storage files and owners
#
# Production credentials: PROD_SUPABASE_DB_URL / PROD_SUPABASE_DB_POOLER_URL,
# PROD_SUPABASE_URL and PROD_SERVICE_ROLE_KEY from the environment, else the
# commented production block in web/.env.local. The export lands in
# cubes-db-snapshots/<stamp>-prod-clone/ (git-ignored; it is customer data).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env.local ] || { echo "web/.env.local not found" >&2; exit 1; }
set -a; # shellcheck disable=SC1091
source .env.local; set +a
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD PGSERVICE PGSERVICEFILE PGOPTIONS

DEV_REF="sivarqzgyeniuveqnjtq"
PROD_REF="txrpnoxwczodnzafjozl"
# When each project's Storage schema was created: a server-side identity
# check, so a redirected connection can't swap the two.
PROD_FINGERPRINT="2026-06-20 11:46:44.956226"

MODE="clone"; ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --plan) MODE="plan" ;;
    --files-only) MODE="files" ;;
    --yes) ASSUME_YES=1 ;;
    *) echo "usage: scripts/clone-prod-to-dev.sh [--plan | --files-only] [--yes]" >&2; exit 2 ;;
  esac
done

# RETIRED 2026-10-03: the target project below became production (cubes.im runs
# on it), so it is never cloned into again. Kept for the record and as the
# template for the next dev database.
echo "Refusing: $DEV_REF has been the production database since 2026-10-03 — nothing is cloned into it any more." >&2
exit 1

# --- production credentials ----------------------------------------------------
# From the environment, else the first commented line in .env.local whose value
# belongs to the production project. Values stay in this shell; nothing is printed.
eval "$(python3 - "$PROD_REF" <<'PY'
import base64, json, os, re, shlex, sys
ref = sys.argv[1]
def ref_of(v):
    m = re.search(r"([a-z0-9]{20})\.supabase\.co", v) or re.search(r"://postgres\.([a-z0-9]{20}):", v)
    if m: return m.group(1)
    if v.startswith("eyJ"):
        try:
            p = v.split(".")[1]; p += "=" * (-len(p) % 4)
            return json.loads(base64.urlsafe_b64decode(p)).get("ref")
        except Exception: return None
    return None
found = {}
for line in open(".env.local"):
    m = re.match(r"^#\s*([A-Z_]+)=(\S+)\s*$", line)
    if m and ref_of(m.group(2)) == ref:
        found.setdefault(m.group(1), m.group(2))
want = {
    "PROD_SUPABASE_DB_URL": "SUPABASE_DB_URL",
    "PROD_SUPABASE_DB_POOLER_URL": "SUPABASE_DB_POOLER_URL",
    "PROD_SUPABASE_URL": "NEXT_PUBLIC_SUPABASE_URL",
    "PROD_SERVICE_ROLE_KEY": "SUPABASE_SERVICE_ROLE_KEY",
}
for var, key in want.items():
    v = os.environ.get(var) or found.get(key, "")
    print(f"export {var}={shlex.quote(v)}")
PY
)"

# --- guards ----------------------------------------------------------------------
ref_of_db_url() {
  if [[ $1 =~ @db\.([a-z0-9]+)\.supabase\.co ]]; then echo "${BASH_REMATCH[1]}"
  elif [[ $1 =~ ://postgres\.([a-z0-9]+): ]]; then echo "${BASH_REMATCH[1]}"; fi
}
redirects() { [[ $1 == *[?\&]host=* || $1 == *[?\&]hostaddr=* || $1 == *[?\&]service=* ]]; }
jwt_ref() {
  KEY="$1" node -e '
    const part = (process.env.KEY || "").split(".")[1];
    if (!part) { process.stdout.write("opaque"); process.exit(0); }
    try { process.stdout.write(JSON.parse(Buffer.from(part, "base64url").toString()).ref || ""); } catch {}
  '
}
die() { echo "$1" >&2; exit 1; }
export PGCONNECT_TIMEOUT=15

# Picks the first reachable URL among the given variables, after checking each one's ref.
pick_db() {
  local want="$1"; shift
  local var url
  for var in "$@"; do
    url="${!var:-}"
    [ -n "$url" ] || continue
    [ "$(ref_of_db_url "$url")" = "$want" ] || die "Refusing: $var does not point at $want."
    if redirects "$url"; then die "Refusing: $var carries a host/hostaddr/service parameter."; fi
  done
  for var in "$@"; do
    url="${!var:-}"
    [ -n "$url" ] || continue
    if psql "$url" -X -At -c "select 1" >/dev/null 2>&1; then echo "$var"; return; fi
  done
  die "Can't reach $want through: $*"
}

[[ $NEXT_PUBLIC_SUPABASE_URL =~ ^https://([a-z0-9]+)\.supabase\.co ]] && [ "${BASH_REMATCH[1]}" = "$DEV_REF" ] \
  || die "Refusing: NEXT_PUBLIC_SUPABASE_URL is not the dev project."
[[ $PROD_SUPABASE_URL =~ ^https://([a-z0-9]+)\.supabase\.co ]] && [ "${BASH_REMATCH[1]}" = "$PROD_REF" ] \
  || die "Refusing: no production API URL found (PROD_SUPABASE_URL)."
k=$(jwt_ref "$SUPABASE_SERVICE_ROLE_KEY"); [ "$k" = "$DEV_REF" ] || [ "$k" = "opaque" ] || die "Refusing: the dev service key belongs to $k."
k=$(jwt_ref "$PROD_SERVICE_ROLE_KEY"); [ "$k" = "$PROD_REF" ] || [ "$k" = "opaque" ] || die "Refusing: the production service key belongs to ${k:-nothing}."

DEV_VAR=$(pick_db "$DEV_REF" SUPABASE_DB_URL SUPABASE_DB_POOLER_URL)
PROD_VAR=$(pick_db "$PROD_REF" PROD_SUPABASE_DB_URL PROD_SUPABASE_DB_POOLER_URL)
DEV=(psql "${!DEV_VAR}" -X -q -v ON_ERROR_STOP=1)
PROD=(psql "${!PROD_VAR}" -X -q -v ON_ERROR_STOP=1)
# Every production session runs read-only.
prod_query() { "${PROD[@]}" -At "$@"; }
prod_sql() { printf 'set default_transaction_read_only = on;\n%s\n' "$1" | prod_query -F $'\t'; }

"${DEV[@]}" -v mode=guard -f scripts/flush-dev-db.sql
[ "$(prod_sql "select coalesce((select min(executed_at)::text from storage.migrations), '')")" = "$PROD_FINGERPRINT" ] \
  || die "Refusing: the source server is not production ($PROD_REF)."
echo "Source: production $PROD_REF (via $PROD_VAR, read-only) → target: dev $DEV_REF (via $DEV_VAR)."

# --- the target must be empty ----------------------------------------------------
read -r d_logins d_teams d_files <<< "$("${DEV[@]}" -At -F ' ' -c "select (select count(*) from auth.users), (select count(*) from public.teams), (select count(*) from storage.objects);")"
if [ "$MODE" = "files" ]; then
  [ "$d_logins" != "0" ] || die "Dev has no data yet — run the full clone, not --files-only."
else
  [ "$d_logins$d_teams$d_files" = "000" ] \
    || die "Dev is not empty ($d_logins logins, $d_teams workspaces, $d_files files). Run scripts/flush-dev-db.sh first."
fi

# --- what to copy: tables both sides have, columns both sides have ----------------
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
COLS_SQL="select n.nspname, c.relname, a.attname, a.attgenerated <> ''
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
 where c.relkind in ('r', 'p')
   and (n.nspname = 'public' or (n.nspname = 'auth' and c.relname in ('users', 'identities')))
 order by n.nspname, c.relname, a.attnum"
"${DEV[@]}" -At -F $'\t' -c "$COLS_SQL" > "$WORK/dev_cols.tsv"
prod_sql "$COLS_SQL" > "$WORK/prod_cols.tsv"
grep -oE "\('public\.[a-z_]+'\)" scripts/flush-dev-db.sql | tr -d "()'" > "$WORK/keep.txt"
prod_sql "select string_agg(format('select %L, count(*) from %I.%I', n.nspname || '.' || c.relname, n.nspname, c.relname), ' union all ')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r', 'p') and (n.nspname = 'public' or (n.nspname = 'auth' and c.relname in ('users', 'identities')))" > "$WORK/count_query.sql"
prod_sql "$(cat "$WORK/count_query.sql")" > "$WORK/prod_counts.tsv"

python3 - "$WORK" <<'PY'
import csv, sys, os
work = sys.argv[1]
def cols(path):
    out = {}
    for row in csv.reader(open(path), delimiter="\t"):
        schema, table, col, generated = row
        out.setdefault(f"{schema}.{table}", []).append((col, generated == "t"))
    return out
dev, prod = cols(f"{work}/dev_cols.tsv"), cols(f"{work}/prod_cols.tsv")
keep = set(l.strip() for l in open(f"{work}/keep.txt") if l.strip())
counts = dict(r for r in csv.reader(open(f"{work}/prod_counts.tsv"), delimiter="\t"))
plan, skipped = [], []
for t in sorted(set(dev) | set(prod)):
    n = int(counts.get(t, 0))
    if t not in dev:
        skipped.append((t, n, "only in production")); continue
    if t not in prod:
        continue  # dev-only table: nothing to copy
    if t in keep:
        skipped.append((t, n, "kept in dev (reference / platform config)")); continue
    prod_cols = {c for c, _ in prod[t]}
    copy = [c for c, gen in dev[t] if not gen and c in prod_cols]
    plan.append((t, n, copy))
with open(f"{work}/plan.tsv", "w") as f:
    for t, n, c in plan: f.write(f"{t}\t{n}\t{','.join(c)}\n")
with open(f"{work}/skipped.tsv", "w") as f:
    for t, n, why in skipped: f.write(f"{t}\t{n}\t{why}\n")
PY

copy_tables=$(wc -l < "$WORK/plan.tsv" | tr -d ' ')
copy_rows=$(awk -F'\t' '{s+=$2} END {print s+0}' "$WORK/plan.tsv")
read -r p_files p_mb <<< "$(prod_sql "select count(*), (coalesce(sum((metadata->>'size')::bigint), 0) / 1048576)::bigint from storage.objects")"
echo
echo "Copy: $copy_tables tables, $copy_rows rows (incl. $(awk -F'\t' '$1=="auth.users"{print $2}' "$WORK/plan.tsv") logins), and $p_files Storage files (~${p_mb} MB)."
echo "Not copied:"
awk -F'\t' '{printf "  %-45s %6s rows  %s\n", $1, $2, $3}' "$WORK/skipped.tsv"
lost=$(awk -F'\t' '$3=="only in production" && $2>0' "$WORK/skipped.tsv")
[ -z "$lost" ] || die "Refusing: production-only tables hold rows that have nowhere to go in dev:
$lost"
[ "$MODE" = "plan" ] && { echo; echo "Plan only: nothing was read beyond counts, nothing was written."; exit 0; }

if [ "$ASSUME_YES" != "1" ]; then
  echo
  read -r -p "Copy production's data into dev now? Type the dev ref ($DEV_REF): " answer
  [ "$answer" = "$DEV_REF" ] || die "Not confirmed — nothing was changed."
fi

STAMP=$(date +%Y-%m-%d-%H%M%S)
mkdir -p "../cubes-db-snapshots/${STAMP}-prod-clone/tables"
OUT=$(cd "../cubes-db-snapshots/${STAMP}-prod-clone" && pwd)

# --- 1. export production (one read-only snapshot) --------------------------------
echo; echo "Exporting production…"
{
  echo "begin isolation level repeatable read read only;"
  while IFS=$'\t' read -r t n c; do
    s=${t%%.*}; r=${t#*.}
    cols=$(echo "$c" | awk -F, '{for (i=1;i<=NF;i++) printf "%s\"%s\"", (i>1?", ":""), $i}')
    echo "\\copy (select $cols from \"$s\".\"$r\") to '$OUT/tables/$t.csv' with (format csv, header)"
  done < "$WORK/plan.tsv"
  echo "\\copy ($(cat "$WORK/count_query.sql")) to '$OUT/prod-counts.csv' with (format csv)"
  echo "commit;"
} > "$OUT/export.psql"
[ "$MODE" = "files" ] || "${PROD[@]}" -f "$OUT/export.psql"
# The Storage list and owners (a plain query: COPY's text format would escape the JSON).
prod_sql "select coalesce(json_agg(json_build_object('b', bucket_id, 'p', name, 'mime', metadata->>'mimetype', 'cache', metadata->>'cacheControl') order by bucket_id, name), '[]') from storage.objects" > "$OUT/storage-objects.json"
printf 'set default_transaction_read_only = on;\n\\copy (select bucket_id, name, owner, owner_id, user_metadata, created_at, last_accessed_at from storage.objects) to %s with (format csv, header)\n' "'$OUT/storage-owners.csv'" | "${PROD[@]}"
echo "  saved to cubes-db-snapshots/${STAMP}-prod-clone/"

# --- 2. load dev (one transaction, triggers off, checked before commit) -----------
if [ "$MODE" != "files" ]; then
  echo; echo "Loading dev…"
  IN_LIST=$(awk -F'\t' '{printf "%s'"'"'%s'"'"'", (NR>1?", ":""), $1}' "$WORK/plan.tsv")
  {
    echo "\\set ON_ERROR_STOP on"
    echo "begin;"
    echo "set local lock_timeout = '20s';"
    echo "do \$\$ begin if exists (select 1 from auth.users) or exists (select 1 from public.teams) then raise exception 'dev is not empty'; end if; end \$\$;"
    # Triggers (and FK checks) off: production's rows arrive as they are, with
    # no sign-up provisioning, activity logging or workflow events firing.
    echo "set local session_replication_role = replica;"
    # auth first, then public — order doesn't matter with FK checks off.
    sort -t$'\t' -k1,1 "$WORK/plan.tsv" | while IFS=$'\t' read -r t n c; do
      s=${t%%.*}; r=${t#*.}
      cols=$(echo "$c" | awk -F, '{for (i=1;i<=NF;i++) printf "%s\"%s\"", (i>1?", ":""), $i}')
      echo "\\copy \"$s\".\"$r\" ($cols) from '$OUT/tables/$t.csv' with (format csv, header match)"
    done
    cat <<'SQL'
-- Every table holds exactly what production's snapshot held.
create temp table clone_counts (t text primary key, n bigint) on commit drop;
SQL
    echo "\\copy clone_counts from '$OUT/prod-counts.csv' with (format csv)"
    cat <<SQL
do \$\$
declare
    r record;
    n bigint;
    bad text := '';
begin
    for r in select c.t, c.n from clone_counts c
              where c.t in ($IN_LIST)
    loop
        execute format('select count(*) from %s', r.t) into n;
        if n <> r.n then bad := bad || format('%s: %s of %s; ', r.t, n, r.n); end if;
    end loop;
    if bad <> '' then raise exception 'row counts differ from production: %', bad; end if;
end;
\$\$;
SQL
    echo "\\i scripts/clone-prod-fixups.sql"
    cat <<'SQL'
-- No reference may point at a row that isn't there (FK checks were off).
do $$
declare
    fk record;
    n bigint;
    bad text := '';
begin
    for fk in
        select c.conrelid::regclass as child, c.confrelid::regclass as parent, c.conname,
               array(select format('%I', a.attname) from unnest(c.conkey) with ordinality k(attnum, ord)
                       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum order by k.ord) as ccols,
               array(select format('%I', a.attname) from unnest(c.confkey) with ordinality k(attnum, ord)
                       join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum order by k.ord) as pcols
          from pg_constraint c
         where c.contype = 'f'
           and (c.connamespace = 'public'::regnamespace or c.conrelid = 'auth.identities'::regclass)
    loop
        execute format('select count(*) from %s c where %s and not exists (select 1 from %s p where %s)',
                       fk.child,
                       (select string_agg(format('c.%s is not null', x), ' and ') from unnest(fk.ccols) x),
                       fk.parent,
                       (select string_agg(format('p.%s = c.%s', fk.pcols[i], fk.ccols[i]), ' and ')
                          from generate_subscripts(fk.ccols, 1) i))
           into n;
        if n > 0 then bad := bad || format('%s.%s (%s rows); ', fk.child, fk.conname, n); end if;
    end loop;
    if bad <> '' then raise exception 'orphaned references after the load: %', bad; end if;
end;
$$;
commit;
\echo '  loaded, fixed up, counts and references checked — committed.'
SQL
  } > "$OUT/load.psql"
  "${DEV[@]}" -f "$OUT/load.psql"
fi

# --- 3. files, then their owners ---------------------------------------------------
echo; echo "Copying Storage files…"
PROD_SUPABASE_URL="$PROD_SUPABASE_URL" PROD_SERVICE_ROLE_KEY="$PROD_SERVICE_ROLE_KEY" \
  node scripts/clone-prod-storage.mjs "$OUT/storage-objects.json" --concurrency 4
"${DEV[@]}" <<SQL
create temp table clone_owners (bucket_id text, name text, owner uuid, owner_id text, user_metadata jsonb,
                                created_at timestamptz, last_accessed_at timestamptz);
\\copy clone_owners from '$OUT/storage-owners.csv' with (format csv, header)
update storage.objects o
   set owner = s.owner, owner_id = s.owner_id, user_metadata = s.user_metadata,
       created_at = s.created_at, last_accessed_at = s.last_accessed_at
  from clone_owners s
 where o.bucket_id = s.bucket_id and o.name = s.name;
SQL

# --- 4. verify ---------------------------------------------------------------------
V="select (select count(*) from auth.users), (select count(*) from public.teams), (select count(*) from public.projects),
          (select count(*) from public.tasks), (select count(*) from public.app_crm_deals), (select count(*) from storage.objects)"
echo; echo "               logins workspaces projects tasks crm_deals files"
echo "  production:  $(prod_sql "$V" | tr '\t' ' ')"
echo "  dev now:     $("${DEV[@]}" -At -F ' ' -c "$V")"
cat <<EOF

Done. Production's data is in dev; the export stays in cubes-db-snapshots/${STAMP}-prod-clone/.
Everyone signs in to dev with their production password (sessions were not copied).
EOF
