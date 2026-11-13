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

// ---------------------------------------------------------------------------
// Wuthering Waves (Kuro official API) — optional, off unless Kuro auth is set up.
// WuWa has no public per-UID API. This uses Kuro's own launcher API through an
// auto-login token, the same flow as https://github.com/Wuthery/kuro.py .
//
// Your email/password are NEVER stored here. You run the kuro.py Colab notebook
// once (it solves the captcha interactively) to get an auto-login token, then put
// that token + its device id into the Worker. See cloudflare/README.md.
//
// Needs a KV namespace bound as WUWA_KV (stores the rotating token + cached stats)
// and these Worker variables/secrets:
//   KURO_AUTO_TOKEN   auto-login token from the notebook (seed; rotates into KV)
//   KURO_DEVICE_ID    the UUID the notebook logged in with (must stay the same)
// Optional: KURO_REGION to force one account region (e.g. "Europe"), else the
// highest-level account is used.
const KURO = {
  APP_KEY: "32gh5r0p35ullmxrzzwk40ly",
  CLIENT_ID: "7rxmydkibzzsf12om5asjnoo",
  CLIENT_SECRET: "32gh5r0p35ullmxrzzwk40ly",
  AUTO_LOGIN: "https://sdkapi.kurogame-service.com/sdkcom/v2/login/auto.lg",
  GET_TOKEN: "https://sdkapi.kurogame-service.com/sdkcom/v2/auth/getToken.lg",
  OAUTH_CODE: "https://sdkapi.kurogame-service.com/sdkcom/v2/user/oauth/code/generate.lg",
  PLAYER_INFO: "https://pc-launcher-sdk-api.kurogame.net/game/queryPlayerInfo",
  PLAYER_ROLE: "https://pc-launcher-sdk-api.kurogame.net/game/queryRole",
};
const WUWA_FRESH_SECONDS = 1800; // refresh the Kuro chain at most every 30 min

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

  // Wuthering Waves runs on its own (Kuro login chain + KV), only when configured.
  const wuwaTask =
    env.WUWA_KV && (env.KURO_AUTO_TOKEN || (await env.WUWA_KV.get("auto_token")))
      ? wutheringWaves(env)
          .then((d) => {
            if (d) out.wuwa = d;
          })
          .catch((err) => {
            out.errors = { ...(out.errors || {}), wuwa: String(err?.message || err) };
          })
      : null;

  await Promise.all(
    [wuwaTask].filter(Boolean).concat(
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
    )
  );
  // "updated" = when the oldest shown profile was fetched
  const times = ["genshin", "hsr", "wuwa"].map((g) => out[g]?.fetchedAt).filter(Boolean).sort();
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

/* ------------------------------------------------------------------ */
/* Wuthering Waves — Kuro login chain                                  */
/* ------------------------------------------------------------------ */
// Returns curated account stats, cached in KV for WUWA_FRESH_SECONDS. Rotates and persists the
// auto-login token so the password is never needed again after the one-time notebook bootstrap.
async function wutheringWaves(env) {
  const kv = env.WUWA_KV;
  const cached = JSON.parse((await kv.get("stats")) || "null");
  if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < WUWA_FRESH_SECONDS * 1000) {
    return cached;
  }
  try {
    const stats = await kuroFetchRole(env, kv);
    stats.fetchedAt = new Date().toISOString();
    await kv.put("stats", JSON.stringify(stats));
    return stats;
  } catch (err) {
    if (cached) return { ...cached, stale: true }; // Kuro down / token expired: keep the old copy
    throw err;
  }
}

async function kuroPost(url, data) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
    body: new URLSearchParams(data).toString(),
  });
  return res.json();
}

async function kuroPostJSON(url, data) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify(data),
  });
  return res.json();
}

async function kuroFetchRole(env, kv) {
  const deviceId = (await kv.get("device_id")) || env.KURO_DEVICE_ID;
  const autoToken = (await kv.get("auto_token")) || env.KURO_AUTO_TOKEN;
  if (!deviceId || !autoToken) throw new Error("Chưa cấu hình KURO_DEVICE_ID / KURO_AUTO_TOKEN");

  // 1. auto-login with the saved token (no password, avoids the captcha)
  const login = signed(
    {
      token: autoToken,
      client_id: KURO.CLIENT_ID,
      deviceNum: deviceId,
      sdkVersion: "2.6.0h",
      productId: "A1730",
      projectId: "G153",
      redirect_uri: 1,
      response_type: "code",
      channelId: "171",
    },
    KURO.APP_KEY
  );
  const loginRsp = await kuroPost(KURO.AUTO_LOGIN, login);
  if (loginRsp.codes != null && loginRsp.codes !== 0) {
    throw new Error(`auto-login: ${loginRsp.error_description || loginRsp.msg || loginRsp.codes}`);
  }
  if (loginRsp.autoToken && loginRsp.autoToken !== autoToken) await kv.put("auto_token", loginRsp.autoToken);
  if (deviceId && !(await kv.get("device_id"))) await kv.put("device_id", deviceId);

  // 2. authorization code -> access token
  const tokenRsp = await kuroPost(
    KURO.GET_TOKEN,
    signed(
      {
        client_id: KURO.CLIENT_ID,
        deviceNum: deviceId,
        client_secret: KURO.CLIENT_SECRET,
        code: loginRsp.code,
        productId: "A1725",
        projectId: "G153",
        redirect_uri: 1,
        grant_type: "authorization_code",
      },
      KURO.APP_KEY
    )
  );
  if (tokenRsp.codes != null && tokenRsp.codes !== 0) throw new Error(`getToken: ${tokenRsp.error_description || tokenRsp.codes}`);

  // 3. access token -> oauth code (no sign on this one, per kuro.py)
  const oauthRsp = await kuroPost(KURO.OAUTH_CODE, {
    client_id: KURO.CLIENT_ID,
    deviceNum: deviceId,
    client_secret: KURO.CLIENT_SECRET,
    access_token: tokenRsp.access_token,
    productId: "A1725",
    projectId: "G153",
    redirect_uri: 1,
    scope: "launcher",
  });
  const oauthCode = oauthRsp.oauthCode;
  if (!oauthCode) throw new Error(`oauth: ${oauthRsp.error_description || oauthRsp.codes || "no code"}`);

  // 4. oauth code -> player accounts (region name -> { uid, level, ... })
  const infoRsp = await retry(() => kuroPostJSON(KURO.PLAYER_INFO, { oauthCode }), (r) => r.code === 1005);
  if (infoRsp.code !== 0) throw new Error(`playerInfo: ${infoRsp.message || infoRsp.code}`);
  const accounts = Object.entries(infoRsp.data).map(([region, info]) => ({ region, ...JSON.parse(info) }));
  const forced = env.KURO_REGION && accounts.find((a) => a.region === env.KURO_REGION);
  const account = forced || accounts.sort((a, b) => (b.level || 0) - (a.level || 0))[0];
  if (!account) throw new Error("playerInfo: no accounts");

  // 5. role detail for that account
  const roleRsp = await retry(
    () => kuroPostJSON(KURO.PLAYER_ROLE, { oauthCode, playerId: account.roleId, region: account.region }),
    (r) => r.code === 1005
  );
  if (roleRsp.code !== 0) throw new Error(`queryRole: ${roleRsp.message || roleRsp.code}`);
  const base = JSON.parse(roleRsp.data[account.region]).Base;

  return {
    uid: String(account.roleId),
    nickname: base.Name || account.roleName || "",
    region: account.region,
    level: base.Level ?? null, // Union Level
    worldLevel: base.WorldLevel ?? null,
    characterCount: base.RoleNum ?? null,
    activeDays: base.ActiveDays ?? null,
    sonanceCasket: base.SoundBox ?? null,
  };
}

function retry(fn, again, max = 3) {
  return fn().then((r) => (max > 0 && again(r) ? retry(fn, again, max - 1) : r));
}

/* ---- Kuro auth crypto (ported from kuro.py; verified byte-for-byte) ---- */
function signed(data, appKey) {
  return { ...data, sign: encodeMd5Parameter(data, appKey) };
}

function encodeMd5Parameter(m, appKey) {
  let s = "";
  for (const key of Object.keys(m).sort()) {
    if (key !== "sign" && key !== "market" && m[key] != null) s += `${key}=${m[key]}&`;
  }
  return md5Code(s + appKey);
}

function md5Code(code) {
  const b = [...md5Hex(code).toLowerCase()];
  if (b.length >= 23) {
    [b[1], b[13]] = [b[13], b[1]];
    [b[5], b[17]] = [b[17], b[5]];
    [b[7], b[23]] = [b[23], b[7]];
  }
  return b.join("");
}

function md5Hex(str) {
  const msg = new TextEncoder().encode(str);
  const n = msg.length;
  const buf = new Uint8Array((((n + 8) >> 6) + 1) * 64);
  buf.set(msg);
  buf[n] = 0x80;
  const dv = new DataView(buf.buffer);
  const bits = n * 8;
  dv.setUint32(buf.length - 8, bits >>> 0, true);
  dv.setUint32(buf.length - 4, Math.floor(bits / 0x100000000) >>> 0, true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const K = [];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0;
  const rol = (x, c) => (x << c) | (x >>> (32 - c));
  for (let off = 0; off < buf.length; off += 64) {
    const M = [];
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + rol(F, S[i])) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const hex = (x) => [0, 1, 2, 3].map((i) => ((x >>> (i * 8)) & 0xff).toString(16).padStart(2, "0")).join("");
  return hex(a0) + hex(b0) + hex(c0) + hex(d0);
}
