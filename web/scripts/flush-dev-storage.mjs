#!/usr/bin/env node
/**
 * Storage side of scripts/flush-dev-db.sh. Files go through the Storage API:
 * storage.objects refuses direct SQL deletes (storage.protect_delete), and
 * only the API removes the files themselves. Object lists come from the
 * wrapper as JSON (`[{ "b": bucket, "p": path }, …]`, read out of
 * storage.objects), so nested folders need no recursive listing and odd
 * characters in names survive.
 *
 *   node scripts/flush-dev-storage.mjs --check                          # the key works: list the buckets
 *   node scripts/flush-dev-storage.mjs <objects.json> --download <dir>  # save a copy of each file
 *   node scripts/flush-dev-storage.mjs <objects.json> --delete          # remove them
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the
 * environment (never on the command line). The buckets themselves stay.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const auth = { apikey: key, Authorization: `Bearer ${key}` };
const args = process.argv.slice(2);

function usage() {
  console.error("usage: node scripts/flush-dev-storage.mjs --check");
  console.error("       node scripts/flush-dev-storage.mjs <objects.json> (--download <dir> | --delete)");
  console.error("       with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set");
  process.exit(2);
}
if (!url || !key) usage();

if (args[0] === "--check") {
  // One authenticated call before anything irreversible: a wrong, revoked or
  // other-project key fails here instead of after the database is emptied.
  const res = await fetch(`${url}/storage/v1/bucket`, { headers: auth });
  if (!res.ok) {
    console.error(`  the Storage API refused the service key: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const buckets = await res.json();
  console.log(`  Storage API ok — buckets: ${buckets.map((b) => b.id).join(", ") || "(none)"}`);
  process.exit(0);
}

const [listFile, action, target] = args;
if (!listFile || !["--download", "--delete"].includes(action) || (action === "--download" && !target)) usage();

const objects = JSON.parse(readFileSync(listFile, "utf8") || "[]") ?? [];
const byBucket = new Map();
for (const { b, p } of objects) {
  if (!byBucket.has(b)) byBucket.set(b, []);
  byBucket.get(b).push(p);
}
/** Each path segment encoded on its own, so the slashes stay slashes. */
const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

if (action === "--download") {
  const root = resolve(target);
  mkdirSync(root, { recursive: true });
  let saved = 0;
  let missing = 0;
  let bytes = 0;
  for (const [bucket, paths] of byBucket) {
    for (const p of paths) {
      const dest = resolve(root, bucket, p);
      // A stored name is data: never let "../" in one write outside the backup.
      if (!dest.startsWith(root + sep)) throw new Error(`refusing to write outside ${root}: ${bucket}/${p}`);
      const res = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodePath(p)}`, { headers: auth });
      if (!res.ok) {
        const body = await res.text();
        // A row whose file is already gone has nothing to back up; anything
        // else (auth, network, server) stops the run before the flush.
        if (res.status === 404 || /not.?found/i.test(body)) {
          appendFileSync(join(root, "missing.txt"), `${bucket}/${p}\n`);
          missing += 1;
          continue;
        }
        throw new Error(`download ${bucket}/${p}: ${res.status} ${body}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, buf);
      saved += 1;
      bytes += buf.length;
    }
  }
  console.log(`  saved ${saved} files (${(bytes / 1024 / 1024).toFixed(1)} MB)${missing ? `, ${missing} already missing (listed in missing.txt)` : ""}`);
} else {
  let removed = 0;
  for (const [bucket, paths] of byBucket) {
    for (let i = 0; i < paths.length; i += 100) {
      const batch = paths.slice(i, i + 100);
      const res = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}`, {
        method: "DELETE",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: batch }),
      });
      if (!res.ok) throw new Error(`delete in ${bucket}: ${res.status} ${await res.text()}`);
      const out = await res.json();
      removed += Array.isArray(out) ? out.length : 0;
    }
    console.log(`  ${bucket}: ${paths.length} files`);
  }
  console.log(`  removed ${removed} of ${objects.length} files`);
  if (removed !== objects.length) process.exitCode = 1;
}
