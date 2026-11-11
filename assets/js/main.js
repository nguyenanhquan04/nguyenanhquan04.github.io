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
    // The dim layer is only for photo/video backgrounds; the night sky is already dark.
    $(".bg-overlay").hidden = !(b.video || b.image);

    if (b.particles === "snow") {
      if (!reduceMotion) startSnow();
    } else if (b.particles === "stars") {
      startSky({ shooting: b.shootingStars !== false, still: reduceMotion });
    }
  }

  // Shared canvas sizing (CSS px, capped device-pixel ratio) with debounced resize.
  function canvas2d(onResize) {
    const canvas = $("#particles");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const size = { w: 0, h: 0 };
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size.w = canvas.clientWidth || window.innerWidth;
      size.h = canvas.clientHeight || window.innerHeight;
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      onResize(size);
    }
    let timer;
    window.addEventListener("resize", () => {
      clearTimeout(timer);
      timer = setTimeout(resize, 150);
    });
    resize();
    return { ctx, size };
  }

  // Night sky: twinkling stars of different sizes/colours, and every few seconds a shooting star.
  function startSky({ shooting = true, still = false } = {}) {
    const COLORS = ["255,255,255", "255,255,255", "255,255,255", "214,228,255", "255,238,214", "232,222,255"];
    const rand = (a, b) => a + Math.random() * (b - a);
    let stars = [];
    let meteors = [];
    let nextMeteor = 0;
    let last = 0;
    let ctx = null;
    let size = null;

    const c = canvas2d(({ w, h }) => {
      const count = Math.round(clamp((w * h) / 4200, 80, 380));
      stars = Array.from({ length: count }, () => {
        const bright = Math.random() < 0.06;
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          r: bright ? rand(1.1, 1.8) : rand(0.3, 1.05),
          c: COLORS[Math.floor(Math.random() * COLORS.length)],
          base: bright ? rand(0.75, 1) : rand(0.25, 0.75),
          amp: rand(0.15, 0.5),
          speed: rand(0.0005, 0.0022),
          phase: Math.random() * Math.PI * 2,
          bright,
        };
      });
      if (still && ctx) drawStars(0); // redraw the static sky after a resize
    });
    if (!c) return;
    ({ ctx, size } = c);

    function dot(x, y, r, color) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    function drawStars(t) {
      if (still) ctx.clearRect(0, 0, size.w, size.h);
      for (const s of stars) {
        const a = still ? s.base : clamp(s.base + Math.sin(s.phase + t * s.speed) * s.amp, 0.05, 1);
        dot(s.x, s.y, s.r, `rgba(${s.c},${a.toFixed(3)})`);
        if (s.bright) dot(s.x, s.y, s.r * 3.4, `rgba(${s.c},${(a * 0.16).toFixed(3)})`); // soft halo
      }
    }

    function spawnMeteor() {
      const dir = Math.random() < 0.5 ? -1 : 1;
      const angle = rand(0.3, 0.62); // 17°–35° below horizontal
      const speed = rand(0.9, 1.5) * (Math.max(size.w, size.h) / 1000); // px per ms, scaled to the screen
      meteors.push({
        x: rand(size.w * 0.15, size.w * 0.85),
        y: rand(0, size.h * 0.45),
        vx: Math.cos(angle) * speed * dir,
        vy: Math.sin(angle) * speed,
        len: rand(110, 230),
        life: 0,
        ttl: rand(700, 1300),
      });
    }

    function drawMeteors(dt) {
      for (let i = meteors.length - 1; i >= 0; i -= 1) {
        const m = meteors[i];
        m.life += dt;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        const p = m.life / m.ttl;
        if (p >= 1) {
          meteors.splice(i, 1);
          continue;
        }
        const fade = p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85; // quick fade-in, long fade-out
        const sp = Math.hypot(m.vx, m.vy) || 1;
        const tx = m.x - (m.vx / sp) * m.len;
        const ty = m.y - (m.vy / sp) * m.len;
        const g = ctx.createLinearGradient(m.x, m.y, tx, ty);
        g.addColorStop(0, `rgba(255,255,255,${(0.95 * fade).toFixed(3)})`);
        g.addColorStop(0.3, `rgba(200,220,255,${(0.45 * fade).toFixed(3)})`);
        g.addColorStop(1, "rgba(200,220,255,0)");
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.6;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        dot(m.x, m.y, 5, `rgba(210,225,255,${(0.22 * fade).toFixed(3)})`); // head glow
        dot(m.x, m.y, 1.6, `rgba(255,255,255,${fade.toFixed(3)})`);
      }
    }

    if (still) {
      drawStars(0); // reduced motion: static stars only
      return;
    }

    function frame(t) {
      const dt = last ? Math.min(t - last, 50) : 16; // clamp after a hidden tab resumes
      last = t;
      ctx.clearRect(0, 0, size.w, size.h);
      drawStars(t);
      if (shooting) {
        if (!nextMeteor) nextMeteor = t + rand(1500, 4000);
        if (t >= nextMeteor) {
          spawnMeteor();
          // now and then two in a row
          nextMeteor = t + (Math.random() < 0.15 ? rand(250, 600) : rand(3500, 9000));
        }
        drawMeteors(dt);
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function startSnow() {
    let flakes = [];
    const make = (w, h, initial) => ({
      x: Math.random() * w,
      y: initial ? Math.random() * h : -10,
      r: 0.8 + Math.random() * 2.2,
      vx: (Math.random() - 0.5) * 0.3,
      vy: 0.3 + Math.random() * 0.8,
      phase: Math.random() * Math.PI * 2,
    });
    const c = canvas2d(({ w, h }) => {
      const count = Math.round(Math.min(160, (w * h) / 9000));
      flakes = Array.from({ length: count }, () => make(w, h, true));
    });
    if (!c) return;
    const { ctx, size } = c;

    (function frame(t) {
      ctx.clearRect(0, 0, size.w, size.h);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      for (const p of flakes) {
        p.x += p.vx + Math.sin(t / 1400 + p.phase) * 0.2;
        p.y += p.vy;
        if (p.y > size.h + 10) Object.assign(p, make(size.w, size.h, false));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      requestAnimationFrame(frame);
    })(0);
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
    if (!tracks.length) return { play() {}, hold() {}, release() {}, volume: () => 0.35, muted: () => false };
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

    // Playlist rows, Zing MP3 style: thumbnail (bars over it while playing), title, artist
    const thumb = (t) => {
      const box = h("span", { class: "zm-thumb", "aria-hidden": "true" }, icon("fa-solid fa-music"));
      if (t.cover) {
        const img = h("img", { src: t.cover, alt: "", loading: "lazy" });
        img.addEventListener("error", () => img.remove(), { once: true });
        box.append(img);
      }
      box.append(h("span", { class: "eq" }, h("i"), h("i"), h("i")));
      return box;
    };
    const items = tracks.map((t, i) =>
      h(
        "li",
        {},
        h(
          "button",
          { class: "zm-row", type: "button", onclick: () => load(i, true) },
          h("span", { class: "zm-row-num" }, String(i + 1)),
          thumb(t),
          h("span", { class: "zm-text" }, h("span", { class: "zm-row-title" }, t.title), t.artist ? h("span", { class: "zm-row-artist" }, t.artist) : null)
        )
      )
    );
    el.list.replaceChildren(...items);
    el.count.textContent = `${tracks.length} bài hát`;
    $("#music-playlist").textContent = m.playlistName || "Playlist của tôi";

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
      // the cover also tints the whole panel (blurred), like Zing's player
      root.style.setProperty("--zm-cover", t.cover ? `url("${encodeURI(t.cover).replace(/"/g, "%22")}")` : "none");

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
    // OS media keys / lock-screen controls
    function bindMediaKeys() {
      if (!("mediaSession" in navigator)) return;
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
    bindMediaKeys();

    audio.volume = clamp(m.volume ?? 0.35, 0, 1);
    buildOrder();
    load(order[0], false);
    syncModes();
    syncVolume();
    syncPlayState();

    // While another page section (the lover page) plays its own song, the main
    // playlist is "held": paused, and any request to play is deferred until release.
    let held = false;
    let resumeOnRelease = false;

    return {
      volume: () => audio.volume,
      muted: () => audio.muted,
      hold() {
        if (held) return;
        held = true;
        resumeOnRelease = !audio.paused;
        audio.pause();
      },
      release() {
        if (!held) return;
        held = false;
        bindMediaKeys();
        setMediaSession(tracks[index]);
        if (resumeOnRelease) play();
        resumeOnRelease = false;
      },
      play() {
        if (held) {
          resumeOnRelease = true;
          return;
        }
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
  /* Deck: Music · Profile · Games panels. The front panel is usable;    */
  /* the side panels are angled toward the viewer and inert until picked.*/
  /* ------------------------------------------------------------------ */
  const deck = (() => {
    const deckEl = $("#deck");
    const nav = $("#deck-nav");
    const WALL = 60; // degrees between walls of a hexagonal room
    let panels = [];
    let angles = []; // each panel's angle around the room; grows without wrapping so turns stay continuous
    let active = 0;
    let tabs = [];

    // offset -1 / 0 / +1 relative to the front panel, wrapping around for three panels
    function offsetOf(i) {
      const n = panels.length;
      if (n < 2) return 0;
      if (n === 2) return i === active ? 0 : i > active ? 1 : -1;
      const d = (i - active + n) % n;
      return d === 0 ? 0 : d === 1 ? 1 : -1;
    }

    // step: +1 = turn toward the right-hand wall, -1 = toward the left, 0 = initial placement.
    // In CSS a positive rotateY swings a wall to the left, so the left wall sits at +60° and the
    // right wall at -60°. Turning right raises every angle by 60°; with three panels, the wall
    // leaving the left edge keeps turning the same way around the back of the room (240°) and
    // comes back in on the right.
    function layout(step) {
      panels.forEach((p, i) => {
        const off = offsetOf(i);
        const target = -off * WALL;
        if (!step || angles[i] == null) {
          angles[i] = target;
        } else {
          let d = (((target - angles[i]) % 360) + 360) % 360; // 0..359 turning the + way
          if (step < 0 && d) d -= 360; // turning left: go the - way instead
          if (Math.abs(d) > WALL && !reduceMotion) {
            // passing behind the camera: hide it while it is out of view
            p.animate([{ opacity: 1 }, { opacity: 0, offset: 0.28 }, { opacity: 0, offset: 0.72 }, { opacity: 1 }], { duration: 900 });
          }
          angles[i] += d;
        }
        p.style.setProperty("--ang", `${angles[i]}deg`);
        p.dataset.offset = String(off);
        if (off !== 0) p.dataset.fade = off < 0 ? "left" : "right";
        p.inert = off !== 0;
        p.setAttribute("aria-hidden", off !== 0 ? "true" : "false");
      });
      tabs.forEach((t, i) => t.setAttribute("aria-current", String(i === active)));
    }

    function go(i, { focus = false } = {}) {
      if (!panels.length) return;
      const n = panels.length;
      const next = ((i % n) + n) % n;
      if (next === active) return;
      const step = offsetOf(next); // the target is always one wall to the left (-1) or right (+1)
      active = next;
      layout(step);
      if (focus) setTimeout(() => panels[active].querySelector(".panel-scroll")?.focus({ preventScroll: true }), 50);
    }

    // Which side wall lies under a point: left of the front panel = left wall, right of it =
    // right wall. (The side walls' bounding boxes are huge because their outer edges reach
    // almost to the camera, so they can't be hit-tested by rectangle.)
    function sidePanelAt(x, y) {
      const front = panels[active].getBoundingClientRect();
      const deckBox = deckEl.getBoundingClientRect();
      if (y < deckBox.top || y > deckBox.bottom) return -1;
      const want = x < front.left ? -1 : x > front.right ? 1 : 0;
      if (!want) return -1;
      return panels.findIndex((_, i) => offsetOf(i) === want);
    }

    function init() {
      panels = [...deckEl.querySelectorAll(".panel")].filter((p) => !p.hidden);
      active = Math.max(0, panels.findIndex((p) => p.dataset.panel === "profile"));
      panels.forEach((p) => p.querySelector(".panel-scroll")?.setAttribute("tabindex", "-1"));

      tabs = panels.length > 1
        ? panels.map((p, i) =>
            h(
              "button",
              { class: "deck-tab", type: "button", onclick: () => go(i, { focus: true }) },
              icon(p.dataset.icon || "fa-solid fa-circle"),
              h("span", {}, p.dataset.label || "")
            )
          )
        : [];
      nav.replaceChildren(...tabs);
      layout(0);

      // once a wall has turned to the front, drop its fade mask (it is fully solid by then)
      panels.forEach((p) =>
        p.addEventListener("transitionend", (e) => {
          if (e.target === p && e.propertyName === "transform" && p.dataset.offset === "0") delete p.dataset.fade;
        })
      );

      // Side panels are inert, so clicks land on the deck itself: work out which one was hit.
      deckEl.addEventListener("click", (e) => {
        if (e.target.closest(".panel[data-offset='0']")) return;
        const i = sidePanelAt(e.clientX, e.clientY);
        if (i >= 0) go(i);
      });
      deckEl.addEventListener(
        "pointermove",
        (e) => {
          const i = e.pointerType === "mouse" && !e.target.closest(".panel[data-offset='0']") ? sidePanelAt(e.clientX, e.clientY) : -1;
          panels.forEach((p, k) => p.classList.toggle("is-hover", k === i));
          deckEl.style.cursor = i >= 0 ? "pointer" : "";
          // light spot on the front panel
          const front = panels[active];
          const r = front.getBoundingClientRect();
          front.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
          front.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
        },
        { passive: true }
      );
      deckEl.addEventListener("pointerleave", () => {
        panels.forEach((p) => p.classList.remove("is-hover"));
        deckEl.style.cursor = "";
      });

      // Horizontal swipe on touch screens
      let sx = 0;
      let sy = 0;
      let tracking = false;
      deckEl.addEventListener("pointerdown", (e) => {
        if (e.pointerType !== "touch" || e.target.closest("input")) return;
        tracking = true;
        sx = e.clientX;
        sy = e.clientY;
      });
      deckEl.addEventListener("pointerup", (e) => {
        if (!tracking) return;
        tracking = false;
        const dx = e.clientX - sx;
        const dy = e.clientY - sy;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(active + (dx < 0 ? 1 : -1));
      });
      deckEl.addEventListener("pointercancel", () => (tracking = false));

      // ← → switch panels, except while typing or dragging a slider
      document.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        if (e.altKey || e.ctrlKey || e.metaKey || document.documentElement.classList.contains("love-open")) return;
        if (e.target.closest?.("input, textarea, select, [contenteditable], [role='tab']")) return;
        go(active + (e.key === "ArrowRight" ? 1 : -1));
      });
    }

    return { init, go };
  })();

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
    const noop = { init() {}, render() {}, setOrigin() {}, titleText: () => "", onEnter() {} };
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

    /* Her own song(s): replaces the main playlist while this page is open. */
    const song = (() => {
      const sm = pg.music || {};
      const list = (Array.isArray(sm.tracks) ? sm.tracks : [])
        .filter((t) => t && t.src)
        .map((t) => ({ src: t.src, title: t.title || decodeURIComponent(String(t.src).split("/").pop().replace(/\.[^.]+$/, "")), artist: t.artist || "", cover: t.cover || "" }));
      if (!list.length) return { active: false, start() {}, stop() {} };

      const box = $("#love-song");
      const audio = $("#love-audio");
      const seek = $("#ls-seek");
      const playBtn = $("#ls-play");
      const playIcon = $("#ls-play-icon");
      let i = 0;
      let seeking = false;

      box.hidden = false;
      $("#ls-label").textContent = sm.label || "Bài hát dành cho em";
      $("#ls-prev").hidden = list.length < 2;
      $("#ls-next").hidden = list.length < 2;
      audio.loop = list.length === 1;

      const fill = () => seek.style.setProperty("--p", `${(+seek.value / 1000) * 100}%`);

      function mediaSession(t) {
        if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: t.title,
            artist: t.artist,
            album: herName(),
            artwork: t.cover ? [{ src: new URL(t.cover, location.href).href, sizes: "300x300" }] : [],
          });
          const set = (a, fn) => {
            try {
              navigator.mediaSession.setActionHandler(a, fn);
            } catch { /* unsupported */ }
          };
          set("play", () => audio.play().catch(() => {}));
          set("pause", () => audio.pause());
          set("previoustrack", list.length > 1 ? () => load(i - 1, true) : null);
          set("nexttrack", list.length > 1 ? () => load(i + 1, true) : null);
          set("seekto", (d) => {
            if (d.seekTime != null) audio.currentTime = d.seekTime;
          });
        } catch { /* ignore */ }
      }

      function load(k, autoplay) {
        i = (k + list.length) % list.length;
        const t = list[i];
        audio.src = t.src;
        $("#ls-title").textContent = t.title;
        const artist = $("#ls-artist");
        artist.textContent = t.artist;
        artist.hidden = !t.artist;
        const cover = $("#ls-cover");
        if (t.cover) {
          cover.onerror = () => {
            cover.hidden = true;
            $("#ls-icon").hidden = false;
          };
          cover.src = t.cover;
          cover.hidden = false;
          $("#ls-icon").hidden = true;
        } else {
          cover.hidden = true;
          $("#ls-icon").hidden = false;
        }
        seek.value = 0;
        fill();
        $("#ls-cur").textContent = "0:00";
        $("#ls-dur").textContent = "0:00";
        if (isOpen) mediaSession(t);
        if (autoplay) audio.play().catch(() => {});
      }

      const sync = () => {
        const playing = !audio.paused;
        box.classList.toggle("is-playing", playing);
        playIcon.className = playing ? "fa-solid fa-pause" : "fa-solid fa-play";
        playBtn.setAttribute("aria-label", playing ? "Tạm dừng" : "Phát");
      };
      audio.addEventListener("play", sync);
      audio.addEventListener("pause", sync);
      audio.addEventListener("ended", () => load(i + 1, true)); // only fires with 2+ tracks (single track loops)
      audio.addEventListener("loadedmetadata", () => ($("#ls-dur").textContent = fmtTime(audio.duration * 1000)));
      audio.addEventListener("timeupdate", () => {
        if (seeking || !audio.duration) return;
        seek.value = Math.round((audio.currentTime / audio.duration) * 1000);
        fill();
        $("#ls-cur").textContent = fmtTime(audio.currentTime * 1000);
      });
      audio.addEventListener("error", () => console.warn("[bio] Không phát được:", list[i].src));
      playBtn.addEventListener("click", () => (audio.paused ? audio.play().catch(() => {}) : audio.pause()));
      $("#ls-prev").addEventListener("click", () => load(audio.currentTime > 3 ? i : i - 1, true));
      $("#ls-next").addEventListener("click", () => load(i + 1, true));
      seek.addEventListener("input", () => {
        seeking = true;
        fill();
        if (audio.duration) $("#ls-cur").textContent = fmtTime((+seek.value / 1000) * audio.duration * 1000);
      });
      seek.addEventListener("change", () => {
        if (audio.duration) audio.currentTime = (+seek.value / 1000) * audio.duration;
        seeking = false;
      });
      load(0, false);

      return {
        active: true,
        // Called when the page opens (or when the visitor clicks "enter" while it is open).
        start() {
          music.hold();
          audio.volume = music.volume();
          audio.muted = music.muted();
          mediaSession(list[i]);
          audio.play().catch(() => {}); // blocked without a click; the enter screen retries
        },
        stop() {
          audio.pause();
          music.release();
        },
      };
    })();

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
      song.start();
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
      song.stop();
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
      // The enter-screen click is the first user gesture: start her song if her page is showing.
      onEnter() {
        if (isOpen && song.active) song.start();
      },
    };
  })();

  /* ------------------------------------------------------------------ */
  /* Games panel: one tab per game (WuWa · Genshin · HSR).               */
  /* Genshin/HSR stats come from assets/data/games.json, which the       */
  /* "Update game stats" GitHub Action fills from Enka.Network.          */
  /* WuWa (no public API) and any extra stats come from config.js.       */
  /* ------------------------------------------------------------------ */
  const games = (() => {
    const gc = cfg.games || {};
    const list = (Array.isArray(gc.list) ? gc.list : []).filter((g) => g && g.id && g.name);
    if (!list.length) return { init() {}, renderLive() {} };

    const root = $("#games");
    const FETCHED = new Set(["genshin", "hsr"]);
    const DISCORD_NAMES = { wuwa: ["Wuthering Waves"], genshin: ["Genshin Impact"], hsr: ["Honkai: Star Rail", "Honkai Star Rail"] };
    const LEVEL_LABEL = { wuwa: "Union Level", genshin: "Cấp Mạo Hiểm", hsr: "Cấp Khai Phá" };
    let data = {};
    let current = 0;
    let token = 0;
    const tabs = [];
    const panels = [];
    const liveSlots = [];
    const liveDots = [];

    const fmtNum = (n) => (typeof n === "number" ? n.toLocaleString("vi-VN") : String(n));
    const filled = (v) => v != null && v !== "";
    const uidOf = (g) => String(g.uid || "").trim();

    function statsFor(g, d) {
      const out = [];
      const add = (label, value) => filled(value) && out.push({ label, value: fmtNum(value) });
      if (g.id === "genshin" && d) {
        add("Cấp Mạo Hiểm", d.level);
        add("Cấp Thế Giới", d.worldLevel);
        add("Thành tựu", d.achievements);
        add("La Hoàn Thâm Cảnh", d.abyss);
        add("Kịch Trường Ảo Tưởng", d.theater);
        add("Thân thiết tối đa", d.friendship ? `${d.friendship} nhân vật` : "");
      } else if (g.id === "hsr" && d) {
        add("Cấp Khai Phá", d.level);
        add("Cấp Cân Bằng", d.worldLevel);
        add("Thành tựu", d.achievements);
        add("Nhân vật", d.characterCount);
        add("Nón Ánh Sáng", d.lightCones);
        add("Vũ Trụ Mô Phỏng", d.universe ? `Thế giới ${d.universe}` : "");
      } else {
        add(LEVEL_LABEL[g.id] || "Cấp", g.level);
      }
      (Array.isArray(g.stats) ? g.stats : []).forEach((s) => s && s.label && add(s.label, s.value));
      return out;
    }

    function charGrid(chars) {
      if (!chars.some((c) => c.icon)) {
        return h("div", { class: "gm-tags" }, chars.map((c) => h("span", { class: "gm-chip" }, icon("fa-solid fa-star"), c.name)));
      }
      return h(
        "div",
        { class: "gm-chars" },
        chars.slice(0, 8).map((c) => {
          const box = h("div", { class: "gm-char-img" });
          if (c.icon) {
            const img = h("img", { src: c.icon, alt: "", loading: "lazy" });
            img.addEventListener("error", () => img.replaceWith(icon("fa-solid fa-user")), { once: true });
            box.append(img);
          } else {
            box.append(icon("fa-solid fa-user"));
          }
          if (c.level) box.append(h("span", { class: "gm-char-lv" }, `Lv.${c.level}${c.eidolon ? ` · E${c.eidolon}` : ""}`));
          return h("figure", { class: "gm-char", "data-rarity": c.rarity || 4 }, box, h("figcaption", {}, c.name || ""));
        })
      );
    }

    function fmtUpdated(iso) {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "";
      const p = (n) => String(n).padStart(2, "0");
      return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    function buildPanel(g, i) {
      const d = data[g.id] && data[g.id].uid === uidOf(g) ? data[g.id] : null;
      const uid = uidOf(g);
      const nickname = d?.nickname || g.nickname || "";
      const stats = statsFor(g, d);
      const chars = d?.characters?.length ? d.characters : (Array.isArray(g.characters) ? g.characters : []).filter(Boolean).map((name) => ({ name }));

      const live = h("span", { class: "gm-live" });
      liveSlots[i] = live;
      const meta = [];
      if (uid) {
        meta.push(h("button", { class: "gm-chip", type: "button", "aria-label": `Sao chép UID ${uid}`, onclick: () => copyText(uid) }, icon("fa-regular fa-copy"), `UID ${uid}`));
      }
      if (g.server) meta.push(h("span", { class: "gm-chip" }, icon("fa-solid fa-earth-asia"), g.server));
      meta.push(live);

      return h(
        "section",
        { class: `gm-panel gm-${g.id}`, id: `gm-panel-${g.id}`, role: "tabpanel", "aria-labelledby": `gm-tab-${g.id}`, hidden: i !== current },
        h(
          "div",
          { class: "gm-banner" },
          h("h3", { class: "gm-game" }, g.name),
          nickname ? h("div", { class: "gm-player" }, nickname) : null,
          d?.signature ? h("div", { class: "gm-sign" }, `“${d.signature}”`) : null,
          h("div", { class: "gm-meta" }, meta)
        ),
        stats.length
          ? h("div", { class: "gm-stats" }, stats.map((s) => h("div", { class: "gm-stat" }, h("div", { class: "gm-stat-value" }, s.value), h("div", { class: "gm-stat-label" }, s.label))))
          : null,
        chars.length ? h("h4", { class: "gm-sub" }, d?.characters?.length ? "Nhân vật trưng bày" : "Nhân vật") : null,
        chars.length ? charGrid(chars) : null,
        d
          ? h(
              "p",
              { class: "gm-source" },
              "Dữ liệu từ ",
              h("a", { href: "https://enka.network", target: "_blank", rel: "noopener noreferrer" }, "Enka.Network"),
              data.updatedAt ? ` · cập nhật ${fmtUpdated(data.updatedAt)}` : ""
            )
          : null
      );
    }

    function select(i, { focus = false } = {}) {
      if (i === current || !panels[i]) return;
      const dir = i > current ? 1 : -1;
      const from = current;
      const out = panels[from];
      const inn = panels[i];
      tabs[from].setAttribute("aria-selected", "false");
      tabs[from].tabIndex = -1;
      tabs[i].setAttribute("aria-selected", "true");
      tabs[i].tabIndex = 0;
      if (focus) tabs[i].focus();
      current = i;

      const my = ++token;
      panels.forEach((p, k) => (p.hidden = k !== from));
      if (reduceMotion || !out.animate) {
        out.hidden = true;
        inn.hidden = false;
        return;
      }
      // flip the old card away and the new one in, in the direction of travel
      const away = `translateX(${-dir * 46}px) rotateY(${dir * 28}deg) scale(0.95)`;
      const enter = `translateX(${dir * 46}px) rotateY(${-dir * 28}deg) scale(0.95)`;
      out.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: away }], { duration: 200, easing: "ease-in" }).onfinish = () => {
        if (my !== token) return;
        out.hidden = true;
        inn.hidden = false;
        inn.animate([{ opacity: 0, transform: enter }, { opacity: 1, transform: "none" }], { duration: 380, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
      };
    }

    function build() {
      tabs.length = 0;
      panels.length = 0;
      list.forEach((g, i) => {
        const dot = h("span", { class: "live-dot", hidden: true, "aria-hidden": "true" });
        liveDots[i] = dot;
        tabs.push(
          h(
            "button",
            {
              class: `gm-tab gm-${g.id}`,
              id: `gm-tab-${g.id}`,
              type: "button",
              role: "tab",
              "aria-selected": String(i === current),
              "aria-controls": `gm-panel-${g.id}`,
              tabindex: i === current ? 0 : -1,
              onclick: () => select(i),
            },
            h("span", {}, g.short || g.name),
            dot
          )
        );
        panels.push(buildPanel(g, i));
      });
      const tablist = $("#gm-tabs");
      tablist.hidden = list.length < 2;
      tablist.replaceChildren(...tabs);
      $("#gm-stage").replaceChildren(...panels);
    }

    // "Đang chơi" chip + dot on the tab when Discord shows that game running
    function renderLive() {
      const acts = state.discord?.activities || [];
      list.forEach((g, i) => {
        const names = (g.discordName ? [g.discordName] : DISCORD_NAMES[g.id] || [g.name]).map((n) => n.toLowerCase());
        const a = acts.find((x) => x.type === 0 && names.includes(String(x.name || "").toLowerCase()));
        if (liveDots[i]) liveDots[i].hidden = !a;
        liveSlots[i]?.replaceChildren(
          ...(a
            ? [h("span", { class: "gm-chip is-live" }, icon("fa-solid fa-circle"), "Đang chơi", a.timestamps?.start ? h("span", { "data-since": a.timestamps.start }, "") : null)]
            : [])
        );
      });
      tickTimers();
    }

    async function loadData() {
      for (const url of [gc.dataUrl, "assets/data/games.json"].filter(Boolean)) {
        try {
          const res = await fetch(url, { cache: "no-cache" });
          if (!res.ok) continue;
          data = await res.json();
          return true;
        } catch {
          /* try the next source */
        }
      }
      return false;
    }

    return {
      init() {
        root.hidden = false;
        $("#gm-title").textContent = gc.title || "Game tôi chơi";
        build();
        renderLive();
        $("#gm-tabs").addEventListener("keydown", (e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          select((current + (e.key === "ArrowRight" ? 1 : -1) + list.length) % list.length, { focus: true });
        });
        if (list.some((g) => FETCHED.has(g.id) && uidOf(g))) {
          loadData().then((ok) => {
            if (!ok) return;
            build();
            renderLive();
          });
        }
      },
      renderLive,
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
      games.renderLive();
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
    music.play(); // deferred automatically if her page is open with its own song
    love.onEnter();
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
  games.init();
  deck.init();
  setupCursor();
  startTitle();
  setupEnter();
  loadDiscord();
  loadGitHub();
  setInterval(tickTimers, 1000);
})();
