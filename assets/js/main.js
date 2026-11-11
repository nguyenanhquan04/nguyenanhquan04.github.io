/*
 * Bio page runtime. Reads window.PROFILE from config.js.
 * Live data:
 *   - Discord presence + Spotify: Lanyard (https://github.com/Phineas/lanyard), REST + WebSocket
 *   - GitHub profile: public REST API (60 req/h per visitor IP, cached 10 min in sessionStorage)
 * No build step; works as-is on GitHub Pages.
 */
(() => {
  "use strict";

  const cfg = window.PROFILE || {};
  const fx = cfg.effects || {};
  const integ = cfg.integrations || {};

  const $ = (sel) => document.querySelector(sel);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  const state = { discord: null, lover: null, github: null };

  const validId = (v) => {
    const id = String(v || "").trim();
    if (!id) return "";
    if (!/^\d{17,20}$/.test(id)) {
      console.warn("[bio] Discord ID không hợp lệ (phải là dãy 17–20 chữ số):", id);
      return "";
    }
    return id;
  };
  const ME_ID = validId(integ.discordId);
  const LOVER_ID = validId(cfg.lover?.discordId);
  // Clicking the lover card opens her own page (#love) unless page: false.
  const LOVE_PAGE = !!LOVER_ID && cfg.lover?.page !== false;

  /* ------------------------------------------------------------------ */
  /* DOM helper: all dynamic text goes through textContent (no innerHTML) */
  /* ------------------------------------------------------------------ */
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "style") el.style.cssText = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of children.flat()) {
      if (c == null || c === false || c === "") continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const icon = (cls) => h("i", { class: cls, "aria-hidden": "true" });

  function graphemes(str) {
    if (window.Intl && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(str), (s) => s.segment);
    }
    return Array.from(str);
  }

  function fmtTime(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const hh = Math.floor(total / 3600);
    const mm = Math.floor((total % 3600) / 60);
    const ss = total % 60;
    const p = (n) => String(n).padStart(2, "0");
    return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
  }

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = h("textarea", { style: "position:fixed;opacity:0" });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast(`Đã sao chép: ${text}`);
  }

  /* ------------------------------------------------------------------ */
  /* Theme + background                                                  */
  /* ------------------------------------------------------------------ */
  function applyTheme() {
    const t = cfg.theme || {};
    const b = cfg.background || {};
    const root = document.documentElement.style;
    if (t.accent) root.setProperty("--accent", t.accent);
    if (t.accent2) root.setProperty("--accent2", t.accent2);
    if (t.cardOpacity != null) root.setProperty("--card-opacity", clamp(+t.cardOpacity, 0, 1));
    if (t.blur != null) root.setProperty("--blur", `${+t.blur}px`);
    if (b.dim != null) root.setProperty("--dim", clamp(+b.dim, 0, 1));
  }

  function setupBackground() {
    const b = cfg.background || {};
    if (b.video) {
      const v = $("#bg-video");
      v.src = b.video;
      v.hidden = false;
      v.play().catch(() => {});
    } else if (b.image) {
      const img = $("#bg-image");
      img.src = b.image;
      img.hidden = false;
    }
    if (!reduceMotion && (b.particles === "stars" || b.particles === "snow")) {
      startParticles(b.particles);
    }
  }

  function startParticles(kind) {
    const canvas = $("#particles");
    const ctx = canvas.getContext("2d");
    const snow = kind === "snow";
    let w = 0;
    let hgt = 0;
    let parts = [];

    const make = (initial) => ({
      x: Math.random() * w,
      y: initial ? Math.random() * hgt : -10,
      r: snow ? 0.8 + Math.random() * 2.2 : 0.35 + Math.random() * 1.25,
      vx: snow ? (Math.random() - 0.5) * 0.3 : (Math.random() - 0.5) * 0.06,
      vy: snow ? 0.3 + Math.random() * 0.8 : (Math.random() - 0.5) * 0.06,
      tw: 0.0006 + Math.random() * 0.0018,
      phase: Math.random() * Math.PI * 2,
    });

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      hgt = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hgt * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(Math.min(160, (w * hgt) / (snow ? 9000 : 9500)));
      parts = Array.from({ length: count }, () => make(true));
    }

    function frame(t) {
      ctx.clearRect(0, 0, w, hgt);
      ctx.fillStyle = "#fff";
      for (const p of parts) {
        p.x += p.vx;
        p.y += p.vy;
        if (snow) {
          p.x += Math.sin(t / 1400 + p.phase) * 0.2;
          if (p.y > hgt + 10) Object.assign(p, make(false));
          ctx.globalAlpha = 0.7;
        } else {
          if (p.x < -5) p.x = w + 5;
          if (p.x > w + 5) p.x = -5;
          if (p.y < -5) p.y = hgt + 5;
          if (p.y > hgt + 5) p.y = -5;
          ctx.globalAlpha = 0.15 + 0.85 * (0.5 + 0.5 * Math.sin(p.phase + t * p.tw));
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      requestAnimationFrame(frame);
    }

    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 150);
    });
    resize();
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------ */
  /* Music                                                               */
  /* ------------------------------------------------------------------ */
  // Playlist player with a spinning record. Tracks come from cfg.music.tracks
  // (or the older single-track cfg.music.src / cfg.music.title form).
  const music = (() => {
    const m = cfg.music || {};
    const fileTitle = (src) => decodeURIComponent(String(src).split("/").pop().replace(/\.[^.]+$/, ""));
    const raw = Array.isArray(m.tracks) && m.tracks.length ? m.tracks : m.src ? [{ src: m.src, title: m.title }] : [];
    const tracks = raw
      .filter((t) => t && t.src)
      .map((t) => ({ src: t.src, title: t.title || fileTitle(t.src), artist: t.artist || "", cover: t.cover || "" }));

    const root = $("#music");
    if (!tracks.length) return { play() {} };
    root.hidden = false;

    const audio = $("#audio");
    const el = {
      cover: $("#disc-cover"),
      coverIcon: $("#disc-icon"),
      state: $("#music-state"),
      count: $("#music-count"),
      title: $("#music-title"),
      artist: $("#music-artist"),
      seek: $("#seek"),
      cur: $("#t-cur"),
      dur: $("#t-dur"),
      play: $("#btn-play"),
      playIcon: $("#play-icon"),
      prev: $("#btn-prev"),
      next: $("#btn-next"),
      shuffle: $("#btn-shuffle"),
      repeat: $("#btn-repeat"),
      mute: $("#btn-mute"),
      volIcon: $("#vol-icon"),
      vol: $("#vol"),
      listBtn: $("#btn-list"),
      list: $("#playlist"),
    };

    const REPEAT_MODES = ["all", "one", "off"];
    const REPEAT_LABEL = { all: "Lặp lại: cả danh sách", one: "Lặp lại: một bài", off: "Lặp lại: tắt" };
    let repeat = REPEAT_MODES.includes(m.repeat) ? m.repeat : "all";
    let shuffle = !!m.shuffle;
    let index = 0;
    let order = [];
    let seeking = false;
    let failures = 0;

    // Play order: natural, or shuffled with `first` kept at the front.
    function buildOrder(first) {
      order = tracks.map((_, i) => i);
      if (!shuffle) return;
      for (let i = order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      if (first != null) order = [first, ...order.filter((i) => i !== first)];
    }

    const setRangeFill = (input) => {
      const min = +input.min || 0;
      const max = +input.max || 1;
      input.style.setProperty("--p", `${((+input.value - min) / (max - min)) * 100}%`);
    };

    // Playlist items
    const items = tracks.map((t, i) =>
      h(
        "li",
        {},
        h(
          "button",
          { class: "pl-item", type: "button", onclick: () => load(i, true) },
          h("span", { class: "pl-num" }, h("span", { class: "n" }, String(i + 1)), h("span", { class: "eq", "aria-hidden": "true" }, h("i"), h("i"), h("i"))),
          h("span", { class: "pl-text" }, h("span", { class: "pl-title" }, t.title), t.artist ? h("span", { class: "pl-artist" }, t.artist) : null)
        )
      )
    );
    el.list.replaceChildren(...items);

    function setMediaSession(t) {
      if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: t.title,
          artist: t.artist,
          album: displayName(),
          artwork: t.cover ? [{ src: new URL(t.cover, location.href).href, sizes: "300x300" }] : [],
        });
      } catch { /* unsupported artwork etc. */ }
    }

    function load(i, autoplay) {
      index = i;
      const t = tracks[i];
      audio.src = t.src;
      el.title.textContent = t.title;
      el.artist.textContent = t.artist;
      el.artist.hidden = !t.artist;
      el.count.textContent = tracks.length > 1 ? `${i + 1}/${tracks.length}` : "";

      if (t.cover) {
        el.cover.onerror = () => {
          el.cover.hidden = true;
          el.coverIcon.hidden = false;
        };
        el.cover.src = t.cover;
        el.cover.hidden = false;
        el.coverIcon.hidden = true;
      } else {
        el.cover.removeAttribute("src");
        el.cover.hidden = true;
        el.coverIcon.hidden = false;
      }

      el.seek.value = 0;
      setRangeFill(el.seek);
      el.cur.textContent = "0:00";
      el.dur.textContent = "0:00";
      items.forEach((li, k) => {
        const b = li.firstChild;
        b.classList.toggle("is-current", k === i);
        if (k === i) b.setAttribute("aria-current", "true");
        else b.removeAttribute("aria-current");
      });
      setMediaSession(t);
      if (autoplay) play();
    }

    function play() {
      return audio.play().catch(() => {});
    }

    function next(auto) {
      if (auto && repeat === "one") {
        audio.currentTime = 0;
        play();
        return;
      }
      const pos = order.indexOf(index);
      if (pos >= order.length - 1) {
        if (auto && repeat === "off") {
          audio.currentTime = 0;
          return; // end of playlist: stay paused on the last track
        }
        if (shuffle) buildOrder();
        load(order[0], true);
      } else {
        load(order[pos + 1], true);
      }
    }

    function prev() {
      if (audio.currentTime > 3) {
        audio.currentTime = 0;
        return;
      }
      const pos = order.indexOf(index);
      load(order[(pos - 1 + order.length) % order.length], true);
    }

    function syncPlayState() {
      const playing = !audio.paused;
      root.classList.toggle("is-playing", playing);
      el.playIcon.className = playing ? "fa-solid fa-pause" : "fa-solid fa-play";
      el.play.setAttribute("aria-label", playing ? "Tạm dừng" : "Phát");
      el.state.textContent = playing ? "Đang phát" : "Tạm dừng";
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    }

    function syncVolume() {
      const v = audio.muted ? 0 : audio.volume;
      el.volIcon.className = `fa-solid ${v === 0 ? "fa-volume-xmark" : v < 0.5 ? "fa-volume-low" : "fa-volume-high"}`;
      const label = audio.muted ? "Bật tiếng" : "Tắt tiếng";
      el.mute.setAttribute("aria-label", label);
      el.mute.dataset.tip = label;
      el.vol.value = v;
      setRangeFill(el.vol);
    }

    function syncModes() {
      el.shuffle.classList.toggle("is-on", shuffle);
      el.shuffle.setAttribute("aria-pressed", String(shuffle));
      el.repeat.classList.toggle("is-on", repeat !== "off");
      el.repeat.dataset.repeat = repeat;
      el.repeat.setAttribute("aria-label", REPEAT_LABEL[repeat]);
      el.repeat.dataset.tip = REPEAT_LABEL[repeat];
    }

    // Audio events
    audio.addEventListener("play", syncPlayState);
    audio.addEventListener("pause", syncPlayState);
    audio.addEventListener("ended", () => next(true));
    audio.addEventListener("playing", () => (failures = 0));
    audio.addEventListener("loadedmetadata", () => {
      el.dur.textContent = fmtTime(audio.duration * 1000);
    });
    audio.addEventListener("timeupdate", () => {
      if (seeking || !audio.duration) return;
      el.seek.value = Math.round((audio.currentTime / audio.duration) * 1000);
      setRangeFill(el.seek);
      el.cur.textContent = fmtTime(audio.currentTime * 1000);
    });
    audio.addEventListener("error", () => {
      console.warn("[bio] Không phát được:", tracks[index].src);
      failures += 1;
      if (failures < tracks.length && tracks.length > 1) setTimeout(() => next(false), 800);
    });
    audio.addEventListener("volumechange", syncVolume);

    // Controls
    el.play.addEventListener("click", () => (audio.paused ? play() : audio.pause()));
    el.next.addEventListener("click", () => next(false));
    el.prev.addEventListener("click", prev);
    el.shuffle.addEventListener("click", () => {
      shuffle = !shuffle;
      buildOrder(index);
      syncModes();
    });
    el.repeat.addEventListener("click", () => {
      repeat = REPEAT_MODES[(REPEAT_MODES.indexOf(repeat) + 1) % REPEAT_MODES.length];
      syncModes();
    });
    el.mute.addEventListener("click", () => {
      if (audio.muted || audio.volume === 0) {
        audio.muted = false;
        if (audio.volume === 0) audio.volume = 0.35;
      } else {
        audio.muted = true;
      }
    });
    el.vol.addEventListener("input", () => {
      audio.volume = +el.vol.value;
      audio.muted = false;
    });
    el.seek.addEventListener("input", () => {
      seeking = true;
      setRangeFill(el.seek);
      if (audio.duration) el.cur.textContent = fmtTime((+el.seek.value / 1000) * audio.duration * 1000);
    });
    el.seek.addEventListener("change", () => {
      if (audio.duration) audio.currentTime = (+el.seek.value / 1000) * audio.duration;
      seeking = false;
    });
    el.listBtn.addEventListener("click", () => {
      const open = el.list.hidden;
      el.list.hidden = !open;
      el.listBtn.setAttribute("aria-expanded", String(open));
      el.listBtn.classList.toggle("is-on", open);
    });

    // OS media keys / lock-screen controls
    if ("mediaSession" in navigator) {
      const ms = navigator.mediaSession;
      const set = (action, fn) => {
        try {
          ms.setActionHandler(action, fn);
        } catch { /* action not supported */ }
      };
      set("play", play);
      set("pause", () => audio.pause());
      set("previoustrack", prev);
      set("nexttrack", () => next(false));
      set("seekto", (d) => {
        if (d.seekTime != null) audio.currentTime = d.seekTime;
      });
    }

    audio.volume = clamp(m.volume ?? 0.35, 0, 1);
    buildOrder();
    load(order[0], false);
    syncModes();
    syncVolume();
    syncPlayState();

    return {
      play() {
        audio.play().catch(() => {
          // Autoplay blocked (no enter screen): start on the first click outside the player.
          const once = (e) => {
            if (e.target.closest("#music")) return;
            document.removeEventListener("pointerdown", once);
            play();
          };
          document.addEventListener("pointerdown", once);
        });
      },
    };
  })();

  /* ------------------------------------------------------------------ */
  /* Profile                                                             */
  /* ------------------------------------------------------------------ */
  function discordAvatar(u, size = 256) {
    if (u.avatar) {
      const ext = u.avatar.startsWith("a_") ? "gif" : "png";
      return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${ext}?size=${size}`;
    }
    let idx = 0;
    try {
      idx = Number((BigInt(u.id) >> 22n) % 6n);
    } catch { /* keep 0 */ }
    return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
  }

  function initialsAvatar(name) {
    const letter = graphemes((name || "?").trim())[0] || "?";
    const t = cfg.theme || {};
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${t.accent || "#a78bfa"}"/><stop offset="1" stop-color="${t.accent2 || "#38bdf8"}"/>
      </linearGradient></defs>
      <rect width="120" height="120" fill="url(#g)"/>
      <text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="sans-serif" font-size="56" font-weight="700" fill="#fff">${letter
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function displayName() {
    const d = state.discord?.discord_user;
    const g = state.github;
    return cfg.name || d?.global_name || d?.display_name || g?.name || d?.username || g?.login || integ.github || "your name";
  }

  function handle() {
    if (cfg.username) return cfg.username;
    const u = state.discord?.discord_user?.username || state.github?.login || integ.github;
    return u ? `@${u}` : "";
  }

  function avatarUrl() {
    if (cfg.avatar) return cfg.avatar;
    if (state.discord?.discord_user) return discordAvatar(state.discord.discord_user, 256);
    if (state.github?.avatar_url) return state.github.avatar_url;
    if (integ.github) return `https://github.com/${encodeURIComponent(integ.github)}.png?size=256`;
    return initialsAvatar(displayName());
  }

  function renderProfile() {
    const img = $("#avatar");
    const url = avatarUrl();
    if (img.getAttribute("src") !== url) {
      img.onerror = () => {
        img.onerror = null;
        img.src = initialsAvatar(displayName());
      };
      img.src = url;
      $("#favicon").href = url;
    }

    const deco = $("#avatar-deco");
    const asset = state.discord?.discord_user?.avatar_decoration_data?.asset;
    if (asset) {
      const decoUrl = `https://cdn.discordapp.com/avatar-decoration-presets/${asset}.png?size=240&passthrough=true`;
      if (deco.getAttribute("src") !== decoUrl) deco.src = decoUrl;
      deco.hidden = false;
    } else {
      deco.hidden = true;
    }

    const dot = $("#status-dot");
    if (state.discord && integ.showDiscord !== false) {
      dot.dataset.status = state.discord.discord_status || "offline";
      dot.hidden = false;
    } else {
      dot.hidden = true;
    }

    const nameEl = $("#name");
    nameEl.textContent = displayName();
    const effect = (cfg.theme || {}).nameEffect || "glow";
    nameEl.className = `name${effect === "none" ? "" : ` fx-${effect}`}`;

    const meta = $("#meta");
    const parts = [];
    const hd = handle();
    if (hd) parts.push(h("span", {}, hd));
    if (cfg.location) parts.push(h("span", {}, icon("fa-solid fa-location-dot"), cfg.location));
    meta.replaceChildren(...parts);
  }

  const SOCIAL = {
    github: { icon: "fa-brands fa-github", color: "#ffffff", label: "GitHub" },
    discord: { icon: "fa-brands fa-discord", color: "#5865f2", label: "Discord" },
    x: { icon: "fa-brands fa-x-twitter", color: "#ffffff", label: "X" },
    twitter: { icon: "fa-brands fa-x-twitter", color: "#ffffff", label: "X" },
    instagram: { icon: "fa-brands fa-instagram", color: "#e1306c", label: "Instagram" },
    tiktok: { icon: "fa-brands fa-tiktok", color: "#25f4ee", label: "TikTok" },
    youtube: { icon: "fa-brands fa-youtube", color: "#ff0033", label: "YouTube" },
    facebook: { icon: "fa-brands fa-facebook", color: "#1877f2", label: "Facebook" },
    spotify: { icon: "fa-brands fa-spotify", color: "#1db954", label: "Spotify" },
    soundcloud: { icon: "fa-brands fa-soundcloud", color: "#ff5500", label: "SoundCloud" },
    steam: { icon: "fa-brands fa-steam", color: "#66c0f4", label: "Steam" },
    telegram: { icon: "fa-brands fa-telegram", color: "#26a5e4", label: "Telegram" },
    twitch: { icon: "fa-brands fa-twitch", color: "#9146ff", label: "Twitch" },
    reddit: { icon: "fa-brands fa-reddit-alien", color: "#ff4500", label: "Reddit" },
    email: { icon: "fa-solid fa-envelope", color: null, label: "Email" },
    website: { icon: "fa-solid fa-globe", color: null, label: "Website" },
    link: { icon: "fa-solid fa-link", color: null, label: "Link" },
  };

  function renderStatic() {
    $("#badges").replaceChildren(
      ...(cfg.badges || []).map((b) =>
        h("span", { class: "badge", tabindex: 0, role: "img", "aria-label": b.label, "data-tip": b.label }, icon(b.icon))
      )
    );

    $("#socials").replaceChildren(
      ...(cfg.socials || []).map((s) => {
        const meta = SOCIAL[s.type] || SOCIAL.link;
        const label = s.label || meta.label;
        const color = s.color || meta.color;
        const common = {
          class: "social",
          "aria-label": label,
          "data-tip": label,
          style: color ? `--brand:${color}` : null,
        };
        if (s.copy) {
          return h("button", { ...common, type: "button", onclick: () => copyText(s.copy) }, icon(s.icon || meta.icon));
        }
        const isMail = /^mailto:/i.test(s.url || "");
        return h(
          "a",
          { ...common, href: s.url || "#", target: isMail ? null : "_blank", rel: isMail ? null : "noopener noreferrer" },
          icon(s.icon || meta.icon)
        );
      })
    );

    $("#links").replaceChildren(
      ...(cfg.links || []).map((l) =>
        h(
          "a",
          { class: "link-btn", href: l.url, target: "_blank", rel: "noopener noreferrer" },
          icon(l.icon || "fa-solid fa-link"),
          h("span", {}, l.label),
          icon("fa-solid fa-arrow-up-right-from-square arrow")
        )
      )
    );

    $("#footer").textContent = cfg.footer || "";
  }

  /* ------------------------------------------------------------------ */
  /* Typewriter bio + animated tab title                                 */
  /* ------------------------------------------------------------------ */
  function startTypewriter() {
    const lines = (Array.isArray(cfg.bio) ? cfg.bio : [cfg.bio]).filter(Boolean).map(String);
    const el = $("#bio-text");
    const wrap = el.parentElement;
    if (!lines.length) {
      wrap.hidden = true;
      return;
    }
    if (fx.typewriter === false || reduceMotion) {
      el.textContent = lines.join(" · ");
      wrap.classList.add("no-caret");
      return;
    }

    const split = lines.map(graphemes);
    let li = 0;
    let ci = 0;
    let deleting = false;

    (function tick() {
      const line = split[li];
      if (!deleting) {
        ci += 1;
        el.textContent = line.slice(0, ci).join("");
        if (ci >= line.length) {
          if (split.length === 1) return; // single line: type once and stop
          deleting = true;
          setTimeout(tick, 2200);
          return;
        }
        setTimeout(tick, 55 + Math.random() * 55);
      } else {
        ci -= 1;
        el.textContent = line.slice(0, ci).join("");
        if (ci <= 0) {
          deleting = false;
          li = (li + 1) % split.length;
          setTimeout(tick, 450);
          return;
        }
        setTimeout(tick, 28);
      }
    })();
  }

  function startTitle() {
    if (fx.animatedTitle === false || reduceMotion) {
      document.title = displayName();
      return;
    }
    let i = 0;
    let dir = 1;
    let hold = 0;
    setInterval(() => {
      const text = graphemes(love.titleText() || displayName());
      if (hold > 0) {
        hold -= 1;
        return;
      }
      i += dir;
      if (i >= text.length) {
        i = text.length;
        dir = -1;
        hold = 8;
      } else if (i <= 1) {
        i = 1;
        dir = 1;
        hold = 2;
      }
      document.title = text.slice(0, i).join("");
    }, 260);
  }

  /* ------------------------------------------------------------------ */
  /* Tilt + cursor                                                       */
  /* ------------------------------------------------------------------ */
  function setupTilt() {
    if (!finePointer) return;
    const card = $("#card");
    const tilt = fx.tilt !== false && !reduceMotion;

    card.addEventListener("pointerenter", () => tilt && card.classList.add("is-tilting"));
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      card.style.setProperty("--mx", `${px * 100}%`);
      card.style.setProperty("--my", `${py * 100}%`);
      if (!tilt) return;
      // Keep the card flat while the pointer is on the player so sliders are easy to drag.
      card.style.transform = e.target.closest("#music")
        ? ""
        : `rotateX(${(0.5 - py) * 7}deg) rotateY(${(px - 0.5) * 9}deg)`;
    });
    card.addEventListener("pointerleave", () => {
      card.classList.remove("is-tilting");
      card.style.transform = "";
    });
  }

  function setupCursor() {
    if (!finePointer || fx.cursor === false || reduceMotion) return;
    const c = $("#cursor");
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let tx = x;
    let ty = y;

    window.addEventListener(
      "pointermove",
      (e) => {
        tx = e.clientX;
        ty = e.clientY;
        c.classList.add("is-active");
        c.classList.toggle("is-hover", !!e.target.closest("a, button, input, [data-tip]"));
      },
      { passive: true }
    );
    document.documentElement.addEventListener("mouseleave", () => c.classList.remove("is-active"));

    (function loop() {
      x += (tx - x) * 0.22;
      y += (ty - y) * 0.22;
      c.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      requestAnimationFrame(loop);
    })();
  }

  /* ------------------------------------------------------------------ */
  /* Activity cards                                                      */
  /* ------------------------------------------------------------------ */
  const STATUS_TEXT = {
    online: "Đang hoạt động",
    idle: "Đang chờ",
    dnd: "Không làm phiền",
    offline: "Ngoại tuyến",
  };

  const ACTIVITY_VERB = {
    0: "Đang chơi",
    1: "Đang phát trực tiếp",
    2: "Đang nghe",
    3: "Đang xem",
    5: "Đang thi đấu",
  };

  function assetUrl(appId, key) {
    if (!key) return null;
    if (key.startsWith("mp:")) return `https://media.discordapp.net/${key.slice(3)}`;
    if (key.startsWith("spotify:")) return `https://i.scdn.co/image/${key.slice(8)}`;
    if (appId) return `https://cdn.discordapp.com/app-assets/${appId}/${key}.png`;
    return null;
  }

  const isSpotify = (a) => a.type === 2 && (a.name === "Spotify" || String(a.id || "").startsWith("spotify:"));

  function cardShell({ href, media, label, labelIcon, body, extraClass = "", newTab = true, trailing = null }) {
    const inner = [
      h("div", { class: "acard-media" }, media),
      h("div", { class: "acard-body" }, h("div", { class: "acard-label" }, icon(labelIcon), label), body),
      trailing,
    ];
    const cls = `acard${extraClass ? ` ${extraClass}` : ""}`;
    const linkProps = newTab ? { target: "_blank", rel: "noopener noreferrer" } : {};
    const el = href
      ? h("a", { class: cls, href, ...linkProps }, inner)
      : h("div", { class: cls }, inner);
    // Play the entrance animation once; re-renders of the same node won't replay it.
    el.addEventListener("animationend", () => (el.style.animation = "none"), { once: true });
    return el;
  }

  function mediaImg(src, { round = false, small = null, fallbackIcon = "fa-solid fa-gamepad" } = {}) {
    const nodes = [];
    if (src) {
      const img = h("img", { class: `acard-img${round ? " round" : ""}`, src, alt: "", loading: "lazy" });
      img.addEventListener("error", () => img.replaceWith(h("div", { class: "acard-fallback" }, icon(fallbackIcon))), { once: true });
      nodes.push(img);
    } else {
      nodes.push(h("div", { class: "acard-fallback" }, icon(fallbackIcon)));
    }
    if (small) nodes.push(small);
    return nodes;
  }

  // Custom status (emoji + text) if set, otherwise the plain online/idle/dnd/offline text.
  function statusLine(p) {
    const custom = (p.activities || []).find((a) => a.type === 4);
    const sub = h("div", { class: "acard-sub" });
    if (custom && (custom.state || custom.emoji)) {
      const e = custom.emoji;
      if (e?.id) {
        sub.append(h("img", {
          class: "emoji",
          alt: e.name || "",
          src: `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? "gif" : "png"}?size=32`,
        }));
      } else if (e?.name) {
        sub.append(`${e.name} `);
      }
      if (custom.state) sub.append(custom.state);
    } else {
      sub.textContent = STATUS_TEXT[p.discord_status] || STATUS_TEXT.offline;
    }
    return sub;
  }

  function buildDiscordCard(p) {
    const u = p.discord_user;
    const sub = statusLine(p);

    return cardShell({
      href: `https://discord.com/users/${u.id}`,
      media: mediaImg(discordAvatar(u, 128), {
        round: true,
        small: h("span", { class: "mini-dot", "data-status": p.discord_status || "offline" }),
        fallbackIcon: "fa-brands fa-discord",
      }),
      label: "Discord",
      labelIcon: "fa-brands fa-discord",
      body: [
        h("div", { class: "acard-title" }, u.global_name || u.display_name || u.username, h("small", {}, `@${u.username}`)),
        sub,
      ],
    });
  }

  function buildActivityCard(a) {
    const large = assetUrl(a.application_id, a.assets?.large_image);
    const smallSrc = assetUrl(a.application_id, a.assets?.small_image);
    const small = smallSrc ? h("img", { class: "acard-small", src: smallSrc, alt: "", loading: "lazy" }) : null;
    small?.addEventListener("error", () => small.remove(), { once: true });
    const start = a.timestamps?.start;
    return cardShell({
      href: a.type === 1 && a.url ? a.url : null,
      media: mediaImg(large, { small, fallbackIcon: a.type === 1 ? "fa-solid fa-tower-broadcast" : "fa-solid fa-gamepad" }),
      label: ACTIVITY_VERB[a.type] || "Đang hoạt động",
      labelIcon: a.type === 1 ? "fa-solid fa-tower-broadcast" : "fa-solid fa-gamepad",
      body: [
        h("div", { class: "acard-title" }, a.name),
        a.details ? h("div", { class: "acard-sub" }, a.details) : null,
        a.state ? h("div", { class: "acard-sub" }, a.state) : null,
        start ? h("div", { class: "acard-elapsed", "data-since": start }, "") : null,
      ],
    });
  }

  function buildSpotifyCard(sp) {
    const start = sp.timestamps?.start;
    const end = sp.timestamps?.end;
    const progress =
      start && end
        ? h(
            "div",
            { "data-sp-start": start, "data-sp-end": end },
            h("div", { class: "progress" }, h("div", { class: "progress-bar" })),
            h("div", { class: "times" }, h("span", { class: "t-cur" }, "0:00"), h("span", { class: "t-end" }, fmtTime(end - start)))
          )
        : null;
    return cardShell({
      href: sp.track_id ? `https://open.spotify.com/track/${encodeURIComponent(sp.track_id)}` : null,
      media: mediaImg(sp.album_art_url, { fallbackIcon: "fa-brands fa-spotify" }),
      label: "Đang nghe Spotify",
      labelIcon: "fa-brands fa-spotify",
      body: [
        h("div", { class: "acard-title" }, sp.song),
        h("div", { class: "acard-sub" }, `bởi ${String(sp.artist || "").replace(/;/g, ",")}`),
        progress,
      ],
    });
  }

  function buildGitHubCard(g) {
    const stats = [
      h("span", {}, icon("fa-solid fa-book"), `${g.public_repos} repo`),
      h("span", {}, icon("fa-solid fa-users"), `${g.followers} follower`),
      g.stars != null ? h("span", {}, icon("fa-solid fa-star"), `${g.stars} sao`) : null,
    ];
    return cardShell({
      href: g.html_url,
      media: mediaImg(g.avatar_url, { round: true, fallbackIcon: "fa-brands fa-github" }),
      label: "GitHub",
      labelIcon: "fa-brands fa-github",
      body: [
        h("div", { class: "acard-title" }, g.name || g.login, h("small", {}, `@${g.login}`)),
        g.bio ? h("div", { class: "acard-sub" }, g.bio) : null,
        h("div", { class: "stats" }, stats),
      ],
    });
  }

  /* Lover card: live Discord presence when Lanyard tracks the ID, otherwise a static link card. */
  function loverActivityLine(p) {
    if (p.listening_to_spotify && p.spotify) {
      const artist = String(p.spotify.artist || "").replace(/;/g, ",");
      return h("div", { class: "acard-sub" }, icon("fa-brands fa-spotify"), ` ${p.spotify.song} – ${artist}`);
    }
    const a = (p.activities || []).find((x) => x.type !== 4 && !isSpotify(x));
    if (!a) return null;
    return h(
      "div",
      { class: "acard-sub" },
      icon(a.type === 1 ? "fa-solid fa-tower-broadcast" : "fa-solid fa-gamepad"),
      ` ${ACTIVITY_VERB[a.type] || "Đang dùng"} ${a.name}`
    );
  }

  function buildLoverCard() {
    const lv = cfg.lover || {};
    const p = state.lover;
    const u = p?.discord_user;
    const username = u?.username || lv.username || "";
    const name = lv.name || u?.global_name || u?.display_name || username || "♥";

    const media = p
      ? mediaImg(discordAvatar(u, 128), {
          round: true,
          small: h("span", { class: "mini-dot", "data-status": p.discord_status || "offline" }),
          fallbackIcon: "fa-solid fa-heart",
        })
      : mediaImg(null, { fallbackIcon: "fa-solid fa-heart" });

    const card = cardShell({
      href: LOVE_PAGE ? "#love" : `https://discord.com/users/${LOVER_ID}`,
      newTab: !LOVE_PAGE,
      extraClass: "lcard",
      media,
      label: lv.label || "Người yêu tôi",
      labelIcon: "fa-solid fa-heart",
      body: [
        h("div", { class: "acard-title" }, name, username && username !== name ? h("small", {}, `@${username}`) : null),
        p ? statusLine(p) : h("div", { class: "acard-sub" }, icon("fa-brands fa-discord"), LOVE_PAGE ? " Bấm để xem trang của cô ấy" : " Xem hồ sơ Discord"),
        p ? loverActivityLine(p) : null,
      ],
      trailing: LOVE_PAGE ? h("span", { class: "lcard-go", "aria-hidden": "true" }, icon("fa-solid fa-chevron-right")) : null,
    });
    // Remember where the click happened so the pink page can grow out of that point.
    if (LOVE_PAGE) card.addEventListener("click", (e) => love.setOrigin(e.clientX, e.clientY));
    return card;
  }

  let loverSig = null;
  function renderLover() {
    const box = $("#lover");
    if (!LOVER_ID) {
      box.replaceChildren();
      return;
    }
    const p = state.lover;
    const u = p?.discord_user;
    const custom = p?.activities?.find((a) => a.type === 4);
    const act = p?.activities?.find((a) => a.type !== 4 && !isSpotify(a));
    const sig = JSON.stringify([
      u?.avatar, u?.global_name, u?.username, p?.discord_status, custom?.state, custom?.emoji,
      p?.listening_to_spotify && p?.spotify?.track_id, act?.type, act?.name,
    ]);
    if (sig === loverSig) return;
    loverSig = sig;
    box.replaceChildren(buildLoverCard());
  }

  /* ------------------------------------------------------------------ */
  /* Lover page (#love): full-screen cream-pink view over the bio page.  */
  /* Lives in the same document so the music keeps playing.             */
  /* ------------------------------------------------------------------ */
  const love = (() => {
    const noop = { init() {}, render() {}, setOrigin() {}, titleText: () => "" };
    if (!LOVE_PAGE) return noop;

    const lv = cfg.lover || {};
    const pg = lv.page && typeof lv.page === "object" ? lv.page : {};
    const view = $("#love-view");
    const back = $("#love-back");
    let isOpen = false;
    let fromHistory = false; // opened by an in-page click, so a history entry exists to go back to
    let closeTimer;
    let heartsMade = false;
    let galleryMade = false;
    let coupleSig = null;
    let nowSig = null;

    const herName = () => {
      const u = state.lover?.discord_user;
      return lv.name || u?.global_name || u?.display_name || u?.username || lv.username || "Người ấy";
    };

    function setOrigin(x, y) {
      view.style.setProperty("--ox", `${Math.round(x)}px`);
      view.style.setProperty("--oy", `${Math.round(y)}px`);
    }

    function heartAvatar() {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd8e1"/><stop offset="1" stop-color="#f59ab5"/></linearGradient></defs><rect width="120" height="120" fill="url(#g)"/><path d="M60 90C28 70 24 51 35 41c9-8 20-5 25 5 5-10 16-13 25-5 11 10 7 29-25 49z" fill="#fff" opacity=".92"/></svg>`;
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }

    function setImg(img, src, fallback) {
      if (img.getAttribute("src") === src) return;
      img.onerror = fallback
        ? () => {
            img.onerror = null;
            img.src = fallback;
          }
        : null;
      img.src = src;
    }

    function makeHearts() {
      if (heartsMade || reduceMotion) return;
      heartsMade = true;
      const colors = ["#f59ab5", "#f7b4c6", "#ffc4ad", "#ee86a6", "#ffd3de"];
      const box = $("#love-hearts");
      for (let i = 0; i < 18; i += 1) {
        const el = h("i", { class: "fa-solid fa-heart love-heart" });
        el.style.cssText = [
          `left:${(Math.random() * 100).toFixed(1)}%`,
          `font-size:${(10 + Math.random() * 18).toFixed(0)}px`,
          `color:${colors[i % colors.length]}`,
          `opacity:${(0.35 + Math.random() * 0.4).toFixed(2)}`,
          `animation-duration:${(11 + Math.random() * 10).toFixed(1)}s`,
          `animation-delay:${(-Math.random() * 20).toFixed(1)}s`,
          `--sway:${(Math.random() * 60 - 30).toFixed(0)}px`,
        ].join(";");
        box.append(el);
      }
    }

    function parseDate(s) {
      const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || "").trim());
      if (!m) return null;
      const d = new Date(+m[1], +m[2] - 1, +m[3]);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    function statusNodes(p) {
      const c = (p.activities || []).find((a) => a.type === 4);
      if (!c || !(c.state || c.emoji)) return [STATUS_TEXT[p.discord_status] || STATUS_TEXT.offline];
      const nodes = [];
      const e = c.emoji;
      if (e?.id) {
        nodes.push(h("img", { class: "emoji", alt: e.name || "", src: `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? "gif" : "png"}?size=48` }));
      } else if (e?.name) {
        nodes.push(`${e.name} `);
      }
      if (c.state) nodes.push(c.state);
      return nodes;
    }

    function renderHero() {
      const p = state.lover;
      const u = p?.discord_user;
      setImg($("#love-avatar"), u ? discordAvatar(u, 256) : heartAvatar(), heartAvatar());

      const deco = $("#love-deco");
      const asset = u?.avatar_decoration_data?.asset;
      if (asset) {
        setImg(deco, `https://cdn.discordapp.com/avatar-decoration-presets/${asset}.png?size=240&passthrough=true`);
        deco.hidden = false;
      } else {
        deco.hidden = true;
      }

      const dot = $("#love-dot");
      dot.hidden = !p;
      if (p) dot.dataset.status = p.discord_status || "offline";

      $("#love-kicker").textContent = `người yêu của ${displayName()}`;
      $("#love-name").textContent = herName();
      const username = u?.username || lv.username || "";
      $("#love-handle").textContent = username ? `@${username}` : "";

      const status = $("#love-status");
      if (p) status.replaceChildren(...statusNodes(p));
      status.hidden = !p;
    }

    function renderCouple() {
      const me = state.discord;
      const her = state.lover;
      const since = parseDate(pg.since);
      const sameSong =
        me?.listening_to_spotify && her?.listening_to_spotify && me.spotify?.track_id && me.spotify.track_id === her.spotify?.track_id
          ? her.spotify
          : null;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const sig = JSON.stringify([avatarUrl(), displayName(), herName(), her?.discord_user?.avatar, since && since.getTime(), today.getTime(), sameSong?.track_id]);
      if (sig === coupleSig) return;
      coupleSig = sig;

      const person = (src, name) => {
        const img = h("img", { src, alt: "", loading: "lazy" });
        img.addEventListener("error", () => (img.src = heartAvatar()), { once: true });
        return h("figure", { class: "couple-p" }, img, h("figcaption", {}, name));
      };
      const herAvatar = her?.discord_user ? discordAvatar(her.discord_user, 128) : heartAvatar();

      const nodes = [
        h(
          "div",
          { class: "couple-row" },
          person(avatarUrl(), displayName()),
          h("div", { class: "couple-heart", "aria-hidden": "true" }, icon("fa-solid fa-heart")),
          person(herAvatar, herName())
        ),
      ];

      if (since && since <= today) {
        const days = Math.floor((today - since) / 86400000) + 1;
        const dd = String(since.getDate()).padStart(2, "0");
        const mm = String(since.getMonth() + 1).padStart(2, "0");
        nodes.push(
          h(
            "div",
            { class: "love-days" },
            h("span", { class: "days-num" }, days.toLocaleString("vi-VN")),
            h("span", { class: "days-label" }, "ngày bên nhau"),
            h("span", { class: "days-since" }, icon("fa-solid fa-calendar-days"), ` từ ${dd}/${mm}/${since.getFullYear()}`)
          )
        );
      }

      if (sameSong) {
        const artist = String(sameSong.artist || "").replace(/;/g, ",");
        nodes.push(h("p", { class: "love-sync" }, icon("fa-solid fa-headphones"), ` Hai đứa đang nghe cùng một bài: ${sameSong.song} – ${artist}`));
      }

      $("#love-couple").replaceChildren(...nodes);
    }

    function renderNow() {
      const box = $("#love-now");
      const p = state.lover;
      const sp = p?.listening_to_spotify ? p.spotify : null;
      const acts = (p?.activities || []).filter((a) => a.type !== 4 && !isSpotify(a));
      const sig = JSON.stringify([sp?.track_id, sp?.timestamps, acts.map((a) => [a.name, a.details, a.state, a.timestamps?.start, a.assets])]);
      if (sig === nowSig) return;
      nowSig = sig;

      const items = [];
      const media = (src, fallbackIcon) => {
        if (!src) return h("div", { class: "now-img now-fallback" }, icon(fallbackIcon));
        const img = h("img", { class: "now-img", src, alt: "", loading: "lazy" });
        img.addEventListener("error", () => img.replaceWith(h("div", { class: "now-img now-fallback" }, icon(fallbackIcon))), { once: true });
        return img;
      };

      if (sp) {
        const start = sp.timestamps?.start;
        const end = sp.timestamps?.end;
        items.push(
          h(
            "a",
            { class: "now-item", href: sp.track_id ? `https://open.spotify.com/track/${encodeURIComponent(sp.track_id)}` : null, target: "_blank", rel: "noopener noreferrer" },
            media(sp.album_art_url, "fa-brands fa-spotify"),
            h(
              "div",
              { class: "now-body" },
              h("div", { class: "now-label" }, icon("fa-brands fa-spotify"), " Đang nghe Spotify"),
              h("div", { class: "now-title" }, sp.song),
              h("div", { class: "now-sub" }, String(sp.artist || "").replace(/;/g, ",")),
              start && end
                ? h(
                    "div",
                    { "data-sp-start": start, "data-sp-end": end },
                    h("div", { class: "progress" }, h("div", { class: "progress-bar" })),
                    h("div", { class: "times" }, h("span", { class: "t-cur" }, "0:00"), h("span", {}, fmtTime(end - start)))
                  )
                : null
            )
          )
        );
      }

      acts.forEach((a) => {
        const start = a.timestamps?.start;
        items.push(
          h(
            "div",
            { class: "now-item" },
            media(assetUrl(a.application_id, a.assets?.large_image), a.type === 1 ? "fa-solid fa-tower-broadcast" : "fa-solid fa-gamepad"),
            h(
              "div",
              { class: "now-body" },
              h("div", { class: "now-label" }, icon(a.type === 1 ? "fa-solid fa-tower-broadcast" : "fa-solid fa-gamepad"), ` ${ACTIVITY_VERB[a.type] || "Đang dùng"}`),
              h("div", { class: "now-title" }, a.name),
              a.details ? h("div", { class: "now-sub" }, a.details) : null,
              a.state ? h("div", { class: "now-sub" }, a.state) : null,
              start ? h("div", { class: "now-sub now-elapsed", "data-since": start }, "") : null
            )
          )
        );
      });

      box.hidden = !items.length;
      box.replaceChildren(h("h3", { class: "love-card-title" }, icon("fa-solid fa-heart"), " Cô ấy đang làm gì"), ...items);
      tickTimers();
    }

    function renderLetter() {
      const box = $("#love-letter");
      const text = String(pg.message || "").trim();
      box.hidden = !text;
      if (!text) return;
      box.replaceChildren(
        h("span", { class: "letter-stamp", "aria-hidden": "true" }, icon("fa-solid fa-heart")),
        h("h3", { class: "letter-title" }, pg.letterTitle || "Gửi em"),
        h("div", { class: "letter-body" }, text.split(/\n+/).map((line) => h("p", {}, line))),
        h("p", { class: "letter-sign" }, `— ${displayName()}`)
      );
    }

    function renderGallery() {
      if (galleryMade) return;
      galleryMade = true;
      const photos = (Array.isArray(pg.photos) ? pg.photos : []).filter(Boolean);
      const box = $("#love-gallery");
      box.hidden = !photos.length;
      box.replaceChildren(
        ...photos.map((src, i) => {
          const fig = h("figure", { class: "polaroid", style: `--r:${(i % 2 ? 1 : -1) * (1.5 + (i % 3))}deg` }, h("img", { src, alt: "", loading: "lazy" }));
          fig.querySelector("img").addEventListener("error", () => fig.remove(), { once: true });
          return fig;
        })
      );
    }

    function render() {
      if (!isOpen) return;
      renderHero();
      renderCouple();
      renderNow();
      $("#love-discord").href = `https://discord.com/users/${LOVER_ID}`;
      $("#love-foot").replaceChildren("made with ", icon("fa-solid fa-heart"), ` by ${displayName()}`);
    }

    function open() {
      if (isOpen) return;
      isOpen = true;
      clearTimeout(closeTimer);
      view.hidden = false;
      view.scrollTop = 0;
      makeHearts();
      renderLetter();
      renderGallery();
      render();
      document.documentElement.classList.add("love-open");
      $("#stage").inert = true;
      // two frames so the closed clip-path is painted before the transition starts
      requestAnimationFrame(() => requestAnimationFrame(() => view.classList.add("is-open")));
      setTimeout(() => back.focus({ preventScroll: true }), 60);
    }

    function close() {
      if (!isOpen) return;
      isOpen = false;
      view.classList.remove("is-open");
      document.documentElement.classList.remove("love-open");
      $("#stage").inert = false;
      closeTimer = setTimeout(() => (view.hidden = true), reduceMotion ? 0 : 850);
      document.querySelector("#lover .acard")?.focus({ preventScroll: true });
    }

    const sync = () => (location.hash === "#love" ? open() : close());

    back.addEventListener("click", () => {
      if (fromHistory) {
        history.back();
      } else {
        // opened from a shared link: drop the hash without leaving the site
        history.replaceState(null, "", location.pathname + location.search);
        close();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (isOpen && e.key === "Escape") back.click();
    });

    return {
      init() {
        window.addEventListener("hashchange", () => {
          fromHistory = true;
          sync();
        });
        sync();
      },
      render,
      setOrigin,
      titleText: () => (isOpen ? `♡ ${herName()}` : ""),
    };
  })();

  // Keyed render: a card is rebuilt only when its data changed.
  const cardCache = new Map();

  function renderActivity() {
    const specs = [];
    const p = state.discord;

    if (p && integ.showDiscord !== false) {
      const u = p.discord_user;
      const custom = (p.activities || []).find((a) => a.type === 4);
      specs.push({
        key: "discord",
        sig: JSON.stringify([u.avatar, u.global_name, u.username, p.discord_status, custom?.state, custom?.emoji]),
        build: () => buildDiscordCard(p),
      });
      (p.activities || [])
        .filter((a) => a.type !== 4 && !isSpotify(a))
        .forEach((a, i) => {
          specs.push({
            key: `act:${a.application_id || a.name}:${i}`,
            sig: JSON.stringify([a.name, a.details, a.state, a.assets, a.timestamps?.start, a.url]),
            build: () => buildActivityCard(a),
          });
        });
    }

    if (p && integ.showSpotify !== false && p.listening_to_spotify && p.spotify) {
      const sp = p.spotify;
      specs.push({
        key: "spotify",
        sig: JSON.stringify([sp.track_id, sp.timestamps?.start, sp.timestamps?.end]),
        build: () => buildSpotifyCard(sp),
      });
    }

    if (state.github) {
      specs.push({ key: "github", sig: JSON.stringify(state.github), build: () => buildGitHubCard(state.github) });
    }

    const nodes = specs.map((s) => {
      const cached = cardCache.get(s.key);
      if (cached && cached.sig === s.sig) return cached.el;
      const el = s.build();
      cardCache.set(s.key, { sig: s.sig, el });
      return el;
    });
    const keys = new Set(specs.map((s) => s.key));
    for (const k of cardCache.keys()) if (!keys.has(k)) cardCache.delete(k);

    const container = $("#activity");
    const current = Array.from(container.children);
    const same = current.length === nodes.length && current.every((n, i) => n === nodes[i]);
    if (!same) container.replaceChildren(...nodes);
    tickTimers();
  }

  function tickTimers() {
    const now = Date.now();
    document.querySelectorAll("[data-since]").forEach((el) => {
      el.textContent = `${fmtTime(now - Number(el.dataset.since))} trôi qua`;
    });
    document.querySelectorAll("[data-sp-start]").forEach((el) => {
      const start = Number(el.dataset.spStart);
      const end = Number(el.dataset.spEnd);
      const total = Math.max(1, end - start);
      const cur = clamp(now - start, 0, total);
      el.querySelector(".progress-bar").style.width = `${(cur / total) * 100}%`;
      el.querySelector(".t-cur").textContent = fmtTime(cur);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Data sources                                                        */
  /* ------------------------------------------------------------------ */
  // Routes a Lanyard presence to the owner or the lover by Discord user ID.
  function setPresence(data) {
    const id = data?.discord_user?.id || data?.user_id;
    if (!id || !data.discord_user) return;
    if (id === ME_ID) {
      state.discord = data;
      renderProfile();
      renderActivity();
    } else if (id === LOVER_ID) {
      state.lover = data;
      renderLover();
    }
    love.render();
  }

  // Returns false only when Lanyard says the user is not tracked (no point subscribing).
  async function fetchPresence(id) {
    try {
      const res = await fetch(`https://api.lanyard.rest/v1/users/${id}`);
      const json = await res.json();
      if (json.success) {
        setPresence(json.data);
        return true;
      }
      console.warn(
        `[bio] Lanyard (${id}): ${json.error?.message || "không tìm thấy người dùng"}.`,
        "Tham gia server Lanyard để hiện trạng thái Discord: https://discord.gg/UrXF2cfJ7F"
      );
      return false;
    } catch (err) {
      console.warn(`[bio] Không gọi được Lanyard REST (${id}), thử WebSocket:`, err);
      return true;
    }
  }

  async function loadDiscord() {
    const ids = [...new Set([ME_ID, LOVER_ID].filter(Boolean))];
    if (!ids.length) return;
    const tracked = await Promise.all(ids.map(fetchPresence));
    const live = ids.filter((_, i) => tracked[i]);
    if (live.length) connectLanyard(live, 0);
  }

  function connectLanyard(ids, attempt) {
    let ws;
    let heartbeat;
    try {
      ws = new WebSocket("wss://api.lanyard.rest/socket");
    } catch {
      return;
    }
    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.op === 1) {
        ws.send(JSON.stringify({ op: 2, d: { subscribe_to_ids: ids } }));
        clearInterval(heartbeat);
        heartbeat = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 3 }));
        }, msg.d?.heartbeat_interval || 30000);
        attempt = 0;
      } else if (msg.op === 0 && msg.t === "INIT_STATE") {
        // With subscribe_to_ids, INIT_STATE is a map of user ID -> presence.
        Object.values(msg.d || {}).forEach(setPresence);
      } else if (msg.op === 0 && msg.t === "PRESENCE_UPDATE") {
        setPresence(msg.d);
      }
    });
    ws.addEventListener("close", () => {
      clearInterval(heartbeat);
      const delay = Math.min(30000, 2000 * 2 ** attempt);
      setTimeout(() => connectLanyard(ids, attempt + 1), delay);
    });
  }

  async function loadGitHub() {
    const user = String(integ.github || "").trim();
    if (!user) return;
    const cacheKey = `bio:gh:${user.toLowerCase()}`;

    try {
      const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
      if (cached && Date.now() - cached.t < 10 * 60 * 1000) {
        state.github = cached.d;
        renderProfile();
        renderActivity();
        return;
      }
    } catch { /* ignore bad cache */ }

    try {
      const base = `https://api.github.com/users/${encodeURIComponent(user)}`;
      const [uRes, rRes] = await Promise.all([fetch(base), fetch(`${base}/repos?per_page=100&type=owner`)]);
      if (!uRes.ok) throw new Error(`HTTP ${uRes.status}`);
      const u = await uRes.json();
      const repos = rRes.ok ? await rRes.json() : null;
      const stars = Array.isArray(repos)
        ? repos.filter((r) => !r.fork).reduce((n, r) => n + (r.stargazers_count || 0), 0)
        : null;
      const d = {
        login: u.login,
        name: u.name,
        bio: u.bio,
        avatar_url: u.avatar_url,
        html_url: u.html_url,
        public_repos: u.public_repos,
        followers: u.followers,
        stars,
      };
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), d }));
      } catch { /* storage full or disabled */ }
      state.github = d;
      renderProfile();
      renderActivity();
    } catch (err) {
      console.warn("[bio] Không tải được thông tin GitHub:", err);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Enter screen + boot                                                 */
  /* ------------------------------------------------------------------ */
  function reveal() {
    $("#stage").classList.add("is-visible");
    startTypewriter();
    music.play();
  }

  function setupEnter() {
    const enter = $("#enter");
    if (fx.enterScreen === false) {
      reveal();
      return;
    }
    $("#enter-text").textContent = fx.enterText || "click to enter";
    enter.hidden = false;

    const onKey = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        enter.click();
      }
    };
    document.addEventListener("keydown", onKey);
    enter.addEventListener(
      "click",
      () => {
        document.removeEventListener("keydown", onKey);
        enter.classList.add("is-leaving");
        setTimeout(() => enter.remove(), 900);
        reveal();
      },
      { once: true }
    );
  }

  applyTheme();
  setupBackground();
  renderStatic();
  renderProfile();
  renderLover();
  love.init();
  setupTilt();
  setupCursor();
  startTitle();
  setupEnter();
  loadDiscord();
  loadGitHub();
  setInterval(tickTimers, 1000);
})();
