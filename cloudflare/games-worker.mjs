/*
 * Cloudflare Worker: live Genshin Impact + Honkai: Star Rail stats for nguyenanhquan.tech.
 *
 *   GET https://stats.nguyenanhquan.tech/
 *   -> { updatedAt, genshin: {...}, hsr: {...} }   (same shape as assets/data/games.json)
 *
 * The UIDs are read from the site's own assets/js/config.js (games.list[].uid), so changing a UID
 * there is enough. Only those UIDs are ever fetched: this is not an open proxy to Enka.Network.
 *
 * Caching (needs a Custom Domain; the Cache API does nothing on *.workers.dev):
 *   - each profile is fetched from Enka at most once every 10 minutes per Cloudflare location
 *   - the last good copy is kept for 30 days and served if Enka is down or rate-limiting
 *   - Enka's character data files are cached for a day
 *
 * The same file runs under Node in scripts/fetch-games.mjs (GitHub Actions), so both paths
 * produce identical data. Paste this whole file into the Cloudflare dashboard editor.
 */

const SITE_CONFIG_URL = "https://nguyenanhquan.tech/assets/js/config.js";
const ALLOWED_ORIGINS = ["https://nguyenanhquan.tech", "https://www.nguyenanhquan.tech", "https://nguyenanhquan04.github.io"];
const FRESH_SECONDS = 600; // 10 minutes
const STALE_SECONDS = 30 * 24 * 3600; // 30 days
const STORE_SECONDS = 24 * 3600; // character name/icon files
const UA = "nguyenanhquan.tech bio card (+https://github.com/nguyenanhquan04/nguyenanhquan04.github.io)";
const ENKA_STORE = "https://raw.githubusercontent.com/EnkaNetwork/API-docs/master/store";
const STAR_RAIL_RES = "https://raw.githubusercontent.com/Mar-7th/StarRailRes/master";

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */
export default {
  async fetch(request, env = {}, ctx = { waitUntil() {} }) {
    const cors = corsHeaders(request.headers.get("Origin"));
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "method not allowed" }, 405, cors);
    const url = new URL(request.url);
    if (url.pathname !== "/") return json({ error: "not found" }, 404, cors);

    try {
      const data = await getStats(new URL(request.url).origin, env, ctx);
      return json(data, 200, { ...cors, "Cache-Control": "public, max-age=300" });
    } catch (err) {
      return json({ error: String(err?.message || err) }, 502, cors);
    }
  },
};

function corsHeaders(origin) {
  const h = { Vary: "Origin" };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "GET, HEAD, OPTIONS";
  }
  return h;
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

async function getJSON(url, cacheSeconds) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    // Cloudflare subrequest cache; ignored outside Workers
    cf: cacheSeconds ? { cacheTtl: cacheSeconds, cacheEverything: true } : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.replace(/\?.*$/, "")}`);
  return res.json();
}

/* ------------------------------------------------------------------ */
/* Cache API helpers (no-ops when unavailable, e.g. under Node)        */
/* ------------------------------------------------------------------ */
const edgeCache = () => (typeof caches !== "undefined" && caches.default ? caches.default : null);

async function cacheGet(key) {
  const cache = edgeCache();
  if (!cache) return null;
  const hit = await cache.match(key);
  return hit ? hit.json() : null;
}

function cachePut(ctx, key, value, seconds) {
  const cache = edgeCache();
  if (!cache) return;
  const res = new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${seconds}` },
  });
  ctx.waitUntil(cache.put(key, res));
}

/* ------------------------------------------------------------------ */
/* Which UIDs: read from the site's config.js                          */
/* ------------------------------------------------------------------ */
// Matches `id: "genshin", ... uid: "815953629"` inside one games.list entry (no braces in between).
function uidsFromConfig(text) {
  const out = {};
  const re = /\bid:\s*["'](genshin|hsr)["'][^{}]*?\buid:\s*["'](\d*)["']/g;
  for (const m of text.matchAll(re)) if (/^\d{9,10}$/.test(m[2])) out[m[1]] = m[2];
  return out;
}

async function readUids(env) {
  // GitHub Actions passes the local config.js text; the Worker fetches the live one
  if (env.CONFIG_TEXT != null) return uidsFromConfig(env.CONFIG_TEXT);
  const res = await fetch(env.CONFIG_URL || SITE_CONFIG_URL, { headers: { "User-Agent": UA }, cf: { cacheTtl: 300, cacheEverything: true } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for the site config`);
  const text = await res.text();
  return uidsFromConfig(text);
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */
async function getStats(origin, env, ctx) {
  const keyFor = (kind, game, uid) => `${origin}/__cache/v1/${kind}/${game}/${uid}`;
  const uids = await readUids(env);
  const out = {};

  await Promise.all(
    Object.entries(uids).map(async ([game, uid]) => {
      const fresh = await cacheGet(keyFor("fresh", game, uid));
      if (fresh) {
        out[game] = fresh;
        return;
      }
      try {
        const data = await FETCHERS[game](uid);
        data.fetchedAt = new Date().toISOString();
        out[game] = data;
        cachePut(ctx, keyFor("fresh", game, uid), data, FRESH_SECONDS);
        cachePut(ctx, keyFor("stale", game, uid), data, STALE_SECONDS);
      } catch (err) {
        const stale = await cacheGet(keyFor("stale", game, uid));
        if (stale) {
          out[game] = { ...stale, stale: true };
          // back off: serve the old copy for 2 minutes instead of retrying Enka on every view
          cachePut(ctx, keyFor("fresh", game, uid), out[game], 120);
        }
        out.errors = { ...(out.errors || {}), [game]: String(err?.message || err) };
      }
    })
  );
  // "updated" = when the oldest of the shown profiles was fetched from Enka
  const times = Object.keys(uids).map((g) => out[g]?.fetchedAt).filter(Boolean).sort();
  return { updatedAt: times[0] || new Date().toISOString(), ...out };
}

async function genshin(uid) {
  // store/gi/ is Enka's current character store (the older store/characters.json misses new characters)
  const [data, chars, loc] = await Promise.all([
    getJSON(`https://enka.network/api/uid/${uid}/?info`),
    getJSON(`${ENKA_STORE}/gi/avatars.json`, STORE_SECONDS),
    getJSON(`${ENKA_STORE}/gi/locs.json`, STORE_SECONDS),
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
    getJSON(`${STAR_RAIL_RES}/index_new/vi/characters.json`, STORE_SECONDS),
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
