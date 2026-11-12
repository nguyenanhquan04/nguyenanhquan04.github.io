// Fetches Genshin Impact and Honkai: Star Rail profiles from Enka.Network for the UIDs set in
// assets/js/config.js (games.list[].uid) and writes assets/data/games.json for the games card.
//
// Enka.Network does not allow browsers on other sites to call it (no CORS), so the page cannot
// fetch it directly. .github/workflows/games.yml runs this script on a schedule instead.
// The file is only rewritten when the data actually changed, so scheduled runs stay quiet.
//
// Run locally:  node scripts/fetch-games.mjs
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "assets/data/games.json");
const UA = "nguyenanhquan.tech bio card (+https://github.com/nguyenanhquan04/nguyenanhquan04.github.io)";
const ENKA_STORE = "https://raw.githubusercontent.com/EnkaNetwork/API-docs/master/store";
const STAR_RAIL_RES = "https://raw.githubusercontent.com/Mar-7th/StarRailRes/master";

async function readConfig() {
  const src = await fs.readFile(path.join(ROOT, "assets/js/config.js"), "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(src, sandbox, { timeout: 1000 });
  return sandbox.window.PROFILE || {};
}

async function getJSON(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function genshin(uid) {
  // store/gi/ is Enka's current character store; the older store/characters.json misses new characters
  const [data, chars, loc] = await Promise.all([
    getJSON(`https://enka.network/api/uid/${uid}/?info`),
    getJSON(`${ENKA_STORE}/gi/avatars.json`),
    getJSON(`${ENKA_STORE}/gi/locs.json`),
  ]);
  const p = data.playerInfo || {};
  const name = (hash) => loc.vi?.[hash] || loc.en?.[hash] || "";
  const characters = (p.showAvatarInfoList || []).map((a) => {
    const id = String(a.avatarId);
    // Travelers are stored per element ("10000005-504"); any variant gives the right name and icon.
    const c = chars[id] || chars[Object.keys(chars).find((k) => k.startsWith(`${id}-`))] || {};
    return {
      name: name(String(c.NameTextMapHash)),
      level: a.level ?? null,
      rarity: c.QualityType === "QUALITY_ORANGE" ? 5 : 4,
      element: c.Element || "",
      // "/ui/UI_AvatarIcon_Side_X.png" (new store) or "UI_AvatarIcon_Side_X" (old store) -> full icon URL
      icon: c.SideIconName
        ? `https://enka.network/ui/${c.SideIconName.replace(/^\/?ui\//, "").replace(/\.png$/, "").replace("_Side_", "_")}.png`
        : "",
    };
  });
  return {
    uid: String(uid),
    nickname: p.nickname || "",
    signature: p.signature || "",
    level: p.level ?? null,
    worldLevel: p.worldLevel ?? null,
    achievements: p.finishAchievementNum ?? null,
    abyss: p.towerFloorIndex ? `${p.towerFloorIndex}-${p.towerLevelIndex}` : "",
    theater: p.theaterActIndex ? `Màn ${p.theaterActIndex}` : "",
    friendship: p.fetterCount ?? null,
    characters,
  };
}

async function starRail(uid) {
  const [data, chars] = await Promise.all([
    getJSON(`https://enka.network/api/hsr/uid/${uid}/?info`),
    getJSON(`${STAR_RAIL_RES}/index_new/vi/characters.json`),
  ]);
  const d = data.detailInfo || {};
  const r = d.recordInfo || {};
  const characters = (d.avatarDetailList || []).map((a) => {
    const c = chars[String(a.avatarId)] || {};
    return {
      name: String(c.name || "").includes("{NICKNAME}") ? "Nhà Khai Phá" : c.name || "",
      level: a.level ?? null,
      rarity: c.rarity || 4,
      element: c.element || "",
      eidolon: a.rank ?? 0,
      icon: c.icon ? `${STAR_RAIL_RES}/${c.icon}` : "",
    };
  });
  return {
    uid: String(uid),
    nickname: d.nickname || "",
    signature: d.signature || "",
    level: d.level ?? null,
    worldLevel: d.worldLevel ?? null,
    achievements: r.achievementCount ?? null,
    characterCount: r.avatarCount ?? null,
    lightCones: r.equipmentCount ?? null,
    universe: r.maxRogueChallengeScore ?? null,
    characters,
  };
}

const FETCHERS = { genshin, hsr: starRail };
const strip = ({ updatedAt, ...rest }) => rest;

const cfg = await readConfig();
let prev = {};
try {
  prev = JSON.parse(await fs.readFile(OUT, "utf8"));
} catch {
  /* first run */
}

const next = {};
for (const g of cfg.games?.list || []) {
  const fetcher = FETCHERS[g.id];
  const uid = String(g.uid || "").trim();
  if (!fetcher || !uid) continue;
  if (!/^\d{9,10}$/.test(uid)) {
    console.warn(`[${g.id}] UID "${uid}" không hợp lệ (phải là 9–10 chữ số), bỏ qua`);
    continue;
  }
  try {
    next[g.id] = await fetcher(uid);
    console.log(`[${g.id}] ok: ${next[g.id].nickname} (UID ${uid})`);
  } catch (err) {
    console.warn(`[${g.id}] lỗi: ${err.message}. Giữ dữ liệu cũ.`);
    if (prev[g.id]?.uid === uid) next[g.id] = prev[g.id];
  }
}

if (JSON.stringify(strip(prev)) === JSON.stringify(next)) {
  console.log("Không có thay đổi.");
} else {
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, `${JSON.stringify({ updatedAt: new Date().toISOString(), ...next }, null, 2)}\n`);
  console.log(`Đã ghi ${path.relative(ROOT, OUT)}`);
}
