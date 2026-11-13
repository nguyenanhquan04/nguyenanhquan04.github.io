// Writes assets/data/games.json (Genshin Impact + Honkai: Star Rail stats from Enka.Network) for
// the UIDs in assets/js/config.js. The page reads it when the live Cloudflare Worker is not set up
// or not reachable.
//
// It runs the same code as the Worker (cloudflare/games-worker.mjs), so both give identical data.
// .github/workflows/games.yml runs it on a schedule; the file is only rewritten when the data
// changed, so scheduled runs stay quiet.
//
// Run locally:  node scripts/fetch-games.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../cloudflare/games-worker.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "assets/data/games.json");
const GAMES = ["genshin", "hsr"];

// fetchedAt changes on every run; leave it out when deciding whether anything changed
const comparable = (all) => Object.fromEntries(GAMES.filter((g) => all[g]).map((g) => [g, { ...all[g], fetchedAt: undefined }]));

const configText = await fs.readFile(path.join(ROOT, "assets/js/config.js"), "utf8");
let prev = {};
try {
  prev = JSON.parse(await fs.readFile(OUT, "utf8"));
} catch {
  /* first run */
}

const res = await worker.fetch(new Request("https://local.invalid/"), { CONFIG_TEXT: configText });
const body = await res.json();
if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);

const next = {};
for (const g of GAMES) {
  if (body[g]) {
    const { fetchedAt, stale, ...data } = body[g];
    next[g] = data;
    console.log(`[${g}] ok: ${data.nickname.replace(/[\uFE00-\uFE0F\u200B-\u200D]/g, "") || "(không tên)"} (UID ${data.uid})`);
  } else if (body.errors?.[g]) {
    console.warn(`[${g}] lỗi: ${body.errors[g]}. Giữ dữ liệu cũ.`);
    if (prev[g]) next[g] = prev[g];
  }
}

if (JSON.stringify(comparable(prev)) === JSON.stringify(comparable(next))) {
  console.log("Không có thay đổi.");
} else {
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, `${JSON.stringify({ updatedAt: new Date().toISOString(), ...next }, null, 2)}\n`);
  console.log(`Đã ghi ${path.relative(ROOT, OUT)}`);
}
