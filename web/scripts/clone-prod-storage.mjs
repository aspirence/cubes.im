#!/usr/bin/env node
/**
 * Storage side of scripts/clone-prod-to-dev.sh: copies every file production
 * holds into the dev project through the Storage API (download from prod,
 * upload to dev with the same bucket, path, content type and cache control).
 * Production is only read. The object list comes from the wrapper as JSON
 * (`[{ b, p, mime, cache }]`, read out of prod's storage.objects); the owners
 * are put back afterwards by the wrapper in SQL, since an API upload makes the
 * service role the owner.
 *
 *   node scripts/clone-prod-storage.mjs <objects.json> [--concurrency 4]
 *
 * Needs PROD_SUPABASE_URL / PROD_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL /
 * SUPABASE_SERVICE_ROLE_KEY (dev) in the environment — never on the command line.
 * Re-runnable: uploads upsert, so a second run fills in what the first missed.
 */
import { readFileSync, writeFileSync } from "node:fs";

const [listFile, flag, n] = process.argv.slice(2);
const prodUrl = process.env.PROD_SUPABASE_URL?.replace(/\/+$/, "");
const prodKey = process.env.PROD_SERVICE_ROLE_KEY;
const devUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
const devKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!listFile || !prodUrl || !prodKey || !devUrl || !devKey) {
  console.error("usage: node scripts/clone-prod-storage.mjs <objects.json> [--concurrency 4]");
  process.exit(2);
}
if (prodUrl === devUrl) {
  console.error("refusing: the source and the target are the same project");
  process.exit(2);
}
const concurrency = flag === "--concurrency" ? Math.max(1, Number(n) || 4) : 4;

const objects = JSON.parse(readFileSync(listFile, "utf8") || "[]") ?? [];
/** Each path segment encoded on its own, so the slashes stay slashes. */
const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");
const auth = (key) => ({ apikey: key, Authorization: `Bearer ${key}` });

async function withRetry(what, fn) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error(`${what}: ${last instanceof Error ? last.message : last}`);
}

async function copy({ b, p, mime, cache }) {
  const path = `${encodeURIComponent(b)}/${encodePath(p)}`;
  const body = await withRetry(`download ${b}/${p}`, async () => {
    const res = await fetch(`${prodUrl}/storage/v1/object/${path}`, { headers: auth(prodKey) });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return Buffer.from(await res.arrayBuffer());
  });
  await withRetry(`upload ${b}/${p}`, async () => {
    const headers = { ...auth(devKey), "x-upsert": "true", "content-type": mime || "application/octet-stream" };
    if (cache) headers["cache-control"] = /^\d+$/.test(cache) ? `max-age=${cache}` : cache;
    const res = await fetch(`${devUrl}/storage/v1/object/${path}`, { method: "POST", headers, body });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  });
  return body.length;
}

let next = 0;
let done = 0;
let bytes = 0;
const failed = [];
async function worker() {
  while (next < objects.length) {
    const o = objects[next++];
    try {
      // Await first, then add: `bytes += await …` reads bytes before the
      // await, so parallel workers would overwrite each other's totals.
      const size = await copy(o);
      bytes += size;
    } catch (err) {
      failed.push(`${o.b}/${o.p}\t${err instanceof Error ? err.message : err}`);
    }
    done += 1;
    if (done % 25 === 0 || done === objects.length) {
      console.log(`  ${done}/${objects.length} files (${(bytes / 1024 / 1024).toFixed(0)} MB)`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, objects.length || 1) }, worker));

console.log(`  copied ${objects.length - failed.length} of ${objects.length} files (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
if (failed.length) {
  writeFileSync(`${listFile}.failed.tsv`, failed.join("\n") + "\n");
  console.error(`  ${failed.length} failed — listed in ${listFile}.failed.tsv; re-running copies them`);
  process.exitCode = 1;
}
