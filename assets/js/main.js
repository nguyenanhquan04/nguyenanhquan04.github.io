/*
 * Bio page runtime. Reads window.PROFILE from config.js.
 * Live data:
 *   - Discord presence + Spotify: Lanyard (https://github.com/Phineas/lanyard), REST + WebSocket
 *   - Genshin / HSR stats: assets/data/games.json (filled from Enka.Network by scripts/fetch-games.mjs)
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

  const state = { discord: null, lover: null };
  // name to show before (or without) Discord data: the page's <title> in index.html
  const PAGE_TITLE = document.title;

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
  // pixelarticons (24px pixel icons) for the retro UI chrome
  const pxIcon = (name) => h("i", { class: `pixelart-icons-font-${name}`, "aria-hidden": "true" });

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

  // Pixel night sky: square stars on a 3px grid that twinkle in steps, bright ones flash into a
  // "+" sparkle, and every few seconds a shooting star leaves a trail of fading squares.
  function startSky({ shooting = true, still = false } = {}) {
    const G = 3; // one sky pixel, in CSS px
    const COLORS = ["255,255,255", "255,255,255", "255,255,255", "205,222,255", "255,236,200", "226,214,255"];
    const LEVELS = [0.25, 0.5, 0.75, 1]; // brightness steps, like a limited palette
    const rand = (a, b) => a + Math.random() * (b - a);
    const snap = (v) => Math.round(v / G) * G;
    const step = (a) => LEVELS.reduce((best, l) => (Math.abs(l - a) < Math.abs(best - a) ? l : best), LEVELS[0]);
    let stars = [];
    let meteors = [];
    let nextMeteor = 0;
    let last = 0;
    let ctx = null;
    let size = null;

    const c = canvas2d(({ w, h }) => {
      const count = Math.round(clamp((w * h) / 5200, 70, 300));
      stars = Array.from({ length: count }, () => {
        const bright = Math.random() < 0.07;
        return {
          x: snap(Math.random() * w),
          y: snap(Math.random() * h * 0.92),
          big: !bright && Math.random() < 0.12, // 2x2 star
          c: COLORS[Math.floor(Math.random() * COLORS.length)],
          base: bright ? rand(0.75, 1) : rand(0.3, 0.8),
          amp: rand(0.2, 0.5),
          speed: rand(0.0006, 0.002),
          phase: Math.random() * Math.PI * 2,
          bright,
        };
      });
      if (still && ctx) drawStars(0); // redraw the static sky after a resize
    });
    if (!c) return;
    ({ ctx, size } = c);

    const px = (x, y, n, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, G * n, G * n);
    };

    function drawStars(t) {
      if (still) ctx.clearRect(0, 0, size.w, size.h);
      for (const s of stars) {
        const wave = still ? 0 : Math.sin(s.phase + t * s.speed);
        const a = step(clamp(s.base + wave * s.amp, 0.1, 1));
        const col = `rgba(${s.c},${a})`;
        if (s.bright && wave > 0.55) {
          // sparkle: a plus sign, with a dim outer tip at the peak
          px(s.x, s.y, 1, col);
          px(s.x - G, s.y, 1, col);
          px(s.x + G, s.y, 1, col);
          px(s.x, s.y - G, 1, col);
          px(s.x, s.y + G, 1, col);
          if (wave > 0.85) {
            const dim = `rgba(${s.c},${step(a * 0.5)})`;
            px(s.x - 2 * G, s.y, 1, dim);
            px(s.x + 2 * G, s.y, 1, dim);
            px(s.x, s.y - 2 * G, 1, dim);
            px(s.x, s.y + 2 * G, 1, dim);
          }
        } else {
          px(s.x, s.y, s.big ? 2 : 1, col);
        }
      }
    }

    function spawnMeteor() {
      const dir = Math.random() < 0.5 ? -1 : 1;
      const angle = rand(0.35, 0.6); // 20°–34° below horizontal
      const speed = rand(0.8, 1.3) * (Math.max(size.w, size.h) / 1000); // px per ms, scaled to the screen
      meteors.push({
        x: rand(size.w * 0.15, size.w * 0.85),
        y: rand(0, size.h * 0.4),
        vx: Math.cos(angle) * speed * dir,
        vy: Math.sin(angle) * speed,
        len: Math.round(rand(14, 26)), // trail length in sky pixels
        life: 0,
        ttl: rand(800, 1400),
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
        const fade = p < 0.12 ? p / 0.12 : 1 - (p - 0.12) / 0.88;
        const sp = Math.hypot(m.vx, m.vy) || 1;
        const ux = (m.vx / sp) * G;
        const uy = (m.vy / sp) * G;
        // trail: one square per sky pixel behind the head, fading in steps
        for (let k = m.len; k >= 1; k -= 1) {
          const a = step(fade * (1 - k / m.len));
          if (a <= LEVELS[0] && k > m.len * 0.7) continue;
          px(snap(m.x - ux * k), snap(m.y - uy * k), 1, `rgba(200,220,255,${(a * 0.9).toFixed(2)})`);
        }
        const hx = snap(m.x);
        const hy = snap(m.y);
        px(hx - G, hy - G, 1, `rgba(220,232,255,${step(fade * 0.5)})`); // small glow around the head
        px(hx, hy, 2, `rgba(255,255,255,${step(fade)})`);
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

    // Playlist rows as an RPG menu: ▶ cursor on the current song, number, thumbnail, title, artist
    const thumb = (t) => {
      const box = h("span", { class: "px-thumb", "aria-hidden": "true" }, pxIcon("music"));
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
          { class: "px-row", type: "button", onclick: () => load(i, true) },
          h("span", { class: "px-cur" }, pxIcon("play")),
          h("span", { class: "px-row-num" }, String(i + 1).padStart(2, "0")),
          thumb(t),
          h("span", { class: "px-text" }, h("span", { class: "px-row-title" }, t.title), t.artist ? h("span", { class: "px-row-artist" }, t.artist) : null)
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
      root.style.setProperty("--prog", "0");

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
      el.playIcon.className = playing ? "pixelart-icons-font-pause" : "pixelart-icons-font-play";
      el.play.setAttribute("aria-label", playing ? "Tạm dừng" : "Phát");
      el.state.textContent = playing ? "Đang phát" : "Tạm dừng";
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    }

    function syncVolume() {
      const v = audio.muted ? 0 : audio.volume;
      el.volIcon.className = `pixelart-icons-font-${v === 0 ? "volume-x" : v < 0.5 ? "volume-1" : "volume-3"}`;
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
      // tape moves from the left spool to the right one as the song plays
      root.style.setProperty("--prog", (audio.currentTime / audio.duration).toFixed(3));
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
    return cfg.name || d?.global_name || d?.display_name || d?.username || PAGE_TITLE || "?";
  }

  function handle() {
    if (cfg.username) return cfg.username;
    const u = state.discord?.discord_user?.username;
    return u ? `@${u}` : "";
  }

  function avatarUrl() {
    if (cfg.avatar) return cfg.avatar;
    if (state.discord?.discord_user) return discordAvatar(state.discord.discord_user, 256);
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

    renderPresence();

    const meta = $("#meta");
    const parts = [];
    const hd = handle();
    if (hd) parts.push(h("span", {}, hd));
    if (cfg.location) parts.push(h("span", {}, pxIcon("pin"), cfg.location));
    meta.replaceChildren(...parts);
  }

  // Player 1 status: a coloured square + online/idle/dnd/offline under the name, and the
  // Discord custom status as a thought bubble rising from the avatar
  let presenceSig = null;
  function renderPresence() {
    const box = $("#presence");
    const thought = $("#thought");
    const p = integ.showDiscord !== false ? state.discord : null;
    const custom = p?.activities?.find((a) => a.type === 4);
    const sig = JSON.stringify([p?.discord_status, custom?.state, custom?.emoji]);
    if (sig === presenceSig) return;
    presenceSig = sig;

    const hasThought = !!(custom && (custom.state || custom.emoji));
    box.hidden = !p;
    thought.hidden = !hasThought;
    $(".profile").classList.toggle("has-thought", hasThought);
    if (!p) return;

    const status = p.discord_status || "offline";
    box.replaceChildren(h("span", { class: "pr-status" }, h("span", { class: "mini-dot", "data-status": status }), STATUS_TEXT[status] || STATUS_TEXT.offline));

    if (hasThought) {
      const nodes = [];
      const e = custom.emoji;
      if (e?.id) {
        nodes.push(h("img", { class: "emoji", alt: e.name || "", src: `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? "gif" : "png"}?size=48` }));
      } else if (e?.name) {
        nodes.push(`${e.name} `);
      }
      if (custom.state) nodes.push(custom.state);
      $("#thought-text").replaceChildren(...nodes);
    }
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
          h("span", { class: "arrow" }, pxIcon("external-link"))
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

  // Pixel arrow cursor (CSS, see .px-cursor in style.css), only with a mouse
  function setupCursor() {
    if (!finePointer || fx.cursor === false) return;
    document.documentElement.classList.add("px-cursor");
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
      trailing: LOVE_PAGE ? h("span", { class: "lcard-go", "aria-hidden": "true" }, pxIcon("chevron-right")) : null,
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
    const LEVEL_SHORT = { wuwa: "UL", genshin: "AR", hsr: "TL" };
    const LEVEL_MAX = { genshin: 60, hsr: 70 }; // WuWa: set games.list[].maxLevel in config.js to show the bar
    let data = {};
    let current = 0;
    let token = 0;
    const tabs = [];
    const panels = [];
    const liveSlots = [];
    const liveDots = [];

    const fmtNum = (n) => (typeof n === "number" ? n.toLocaleString("vi-VN") : String(n));
    const filled = (v) => v != null && v !== "";
    // some in-game names are only invisible characters (variation selectors, zero-width spaces)
    const visible = (s) => (/[^\s\uFE00-\uFE0F\u200B-\u200D\u2060\uFEFF]/.test(String(s || "")) ? String(s).trim() : "");
    const uidOf = (g) => String(g.uid || "").trim();

    function statsFor(g, d) {
      const out = [];
      const add = (label, value) => filled(value) && out.push({ label, value: fmtNum(value) });
      if (g.id === "genshin" && d) {
        add("Cấp Thế Giới", d.worldLevel);
        add("Thành tựu", d.achievements);
        add("La Hoàn Thâm Cảnh", d.abyss);
        add("Kịch Trường Ảo Tưởng", d.theater);
        add("Thân thiết tối đa", d.friendship ? `${d.friendship} nhân vật` : "");
      } else if (g.id === "hsr" && d) {
        add("Cấp Cân Bằng", d.worldLevel);
        add("Thành tựu", d.achievements);
        add("Nhân vật", d.characterCount);
        add("Nón Ánh Sáng", d.lightCones);
        add("Vũ Trụ Mô Phỏng", d.universe ? `Thế giới ${d.universe}` : "");
      } else if (!levelInfo(g, d)) {
        add(LEVEL_LABEL[g.id] || "Cấp", g.level);
      }
      (Array.isArray(g.stats) ? g.stats : []).forEach((s) => s && s.label && add(s.label, s.value));
      return out;
    }

    // { level, max } when the level can be drawn as an EXP bar
    function levelInfo(g, d) {
      const level = Number(d?.level ?? g.level);
      const max = Number(g.maxLevel || LEVEL_MAX[g.id]);
      return level > 0 && max > 0 ? { level, max } : null;
    }

    function levelBar(g, d) {
      const lv = levelInfo(g, d);
      if (!lv) return null;
      const pct = clamp((lv.level / lv.max) * 100, 0, 100);
      return h(
        "div",
        { class: "gm-level", role: "img", "aria-label": `${LEVEL_LABEL[g.id] || "Cấp"} ${lv.level}/${lv.max}` },
        h("span", { class: "gm-lv" }, LEVEL_SHORT[g.id] || "LV", h("b", {}, String(lv.level))),
        h("span", { class: "gm-bar", style: `--fill:${pct}%` }),
        h("span", { class: "gm-max" }, lv.level >= lv.max ? "MAX" : `/${lv.max}`)
      );
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
            img.addEventListener("error", () => img.replaceWith(pxIcon("user")), { once: true });
            box.append(img);
          } else {
            box.append(pxIcon("user"));
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
      const nickname = visible(g.nickname) || visible(d?.nickname); // config.js wins, so a name can be set by hand
      const stats = statsFor(g, d);
      const chars = d?.characters?.length ? d.characters : (Array.isArray(g.characters) ? g.characters : []).filter(Boolean).map((name) => ({ name }));

      const live = h("span", { class: "gm-live" });
      liveSlots[i] = live;
      const meta = [];
      if (uid) {
        meta.push(h("button", { class: "gm-chip", type: "button", "aria-label": `Sao chép UID ${uid}`, "data-tip": "Bấm để sao chép", onclick: () => copyText(uid) }, pxIcon("copy"), `UID ${uid}`));
      }
      if (g.server) meta.push(h("span", { class: "gm-chip" }, pxIcon("map"), g.server));
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
        levelBar(g, d),
        stats.length
          ? h(
              "dl",
              { class: "gm-stats" },
              stats.map((s) =>
                h("div", { class: "gm-stat" }, h("dt", { class: "gm-stat-label" }, h("span", {}, s.label)), h("dd", { class: "gm-stat-value" }, s.value))
              )
            )
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
      // 8-bit screen change: the old screen blinks out, the new one wipes in, in steps,
      // from the side of the tab you picked
      const from0 = dir > 0 ? "inset(0 100% 0 0)" : "inset(0 0 0 100%)";
      out.animate([{ opacity: 1 }, { opacity: 0.4 }, { opacity: 1 }, { opacity: 0 }], { duration: 160, easing: "steps(1, end)" }).onfinish = () => {
        if (my !== token) return;
        out.hidden = true;
        inn.hidden = false;
        inn.animate([{ clipPath: from0 }, { clipPath: "inset(0 0 0 0)" }], { duration: 320, easing: "steps(8, end)" });
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
            ? [h("span", { class: "gm-chip is-live" }, h("span", { class: "live-sq", "aria-hidden": "true" }), "Đang chơi", a.timestamps?.start ? h("span", { "data-since": a.timestamps.start }, "") : null)]
            : [])
        );
      });
      tickTimers();
    }

    // Sources in order: the live Cloudflare Worker (games.liveUrl), then games.json on GitHub,
    // then the copy deployed with the site. A source must answer within a few seconds.
    async function loadData() {
      const sources = [
        gc.liveUrl && { url: gc.liveUrl, cache: "default" },
        gc.dataUrl && { url: gc.dataUrl, cache: "no-cache" },
        { url: "assets/data/games.json", cache: "no-cache" },
      ].filter(Boolean);
      for (const src of sources) {
        const ctl = typeof AbortController === "function" ? new AbortController() : null;
        const timer = ctl && setTimeout(() => ctl.abort(), 6000);
        try {
          const res = await fetch(src.url, { cache: src.cache, signal: ctl?.signal });
          if (!res.ok) continue;
          const json = await res.json();
          // the Worker can answer with only some games (e.g. Enka down and no cached copy yet)
          if (!Object.keys(json).some((k) => FETCHED.has(k))) continue;
          data = json;
          return true;
        } catch {
          /* try the next source */
        } finally {
          clearTimeout(timer);
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

  /* ------------------------------------------------------------------ */
  /* Notices: what I'm doing right now (a game, an app, Spotify) pops up */
  /* in the bottom-left corner like a game notification, stays while it */
  /* lasts, and slides away when it ends or the visitor closes it.       */
  /* ------------------------------------------------------------------ */
  const notices = (() => {
    const box = $("#notices");
    const live = new Map(); // key -> { el, sig, body }
    const dismissed = new Set(); // event ids closed by the visitor
    let ready = false; // only after the enter screen

    function specs() {
      const p = state.discord;
      if (!p) return [];
      const out = [];
      (p.activities || [])
        .filter((a) => a.type !== 4 && !isSpotify(a))
        .forEach((a, i) => {
          const key = `act:${a.application_id || a.name}:${i}`;
          out.push({
            key,
            event: `${key}:${a.timestamps?.start || ""}`,
            sig: JSON.stringify([a.name, a.details, a.state, a.assets, a.timestamps?.start, a.url]),
            build: () => buildActivityCard(a),
          });
        });
      if (integ.showSpotify !== false && p.listening_to_spotify && p.spotify) {
        const sp = p.spotify;
        out.push({
          key: "spotify",
          event: `spotify:${sp.track_id}`,
          sig: JSON.stringify([sp.track_id, sp.timestamps?.start, sp.timestamps?.end]),
          build: () => buildSpotifyCard(sp),
        });
      }
      return out.filter((x) => !dismissed.has(x.event));
    }

    function leave(key) {
      const n = live.get(key);
      if (!n) return;
      live.delete(key);
      n.el.classList.add("is-leaving");
      setTimeout(() => n.el.remove(), reduceMotion ? 0 : 360);
    }

    function render() {
      if (!ready || integ.showDiscord === false) return;
      const want = specs();
      const keys = new Set(want.map((x) => x.key));
      for (const k of [...live.keys()]) if (!keys.has(k)) leave(k);
      for (const x of want) {
        const n = live.get(x.key);
        if (n && n.sig === x.sig) continue;
        if (n) {
          // same app or song, new details: swap the content in place, no new pop-up
          const body = x.build();
          n.body.replaceWith(body);
          Object.assign(n, { sig: x.sig, body, event: x.event });
          continue;
        }
        const body = x.build();
        const close = h("button", { class: "nt-close", type: "button", "aria-label": "Đóng thông báo" }, pxIcon("close"));
        const el = h("div", { class: "notice", role: "status" }, body, close);
        const entry = { el, sig: x.sig, body, event: x.event };
        close.addEventListener("click", () => {
          dismissed.add(entry.event);
          leave(x.key);
        });
        live.set(x.key, entry);
        box.append(el);
      }
      tickTimers();
    }

    return {
      start() {
        ready = true;
        render();
      },
      render,
    };
  })();

  /* Quick jump (PC): three buttons on the right edge scroll to Player 1, music and games,
     and light up for the section in view. */
  function setupQuickNav() {
    const nav = $("#quick-nav");
    const items = [
      { el: $(".win-profile"), icon: "user", label: "Người chơi 1" },
      { el: $("#music"), icon: "music", label: "Máy nghe nhạc" },
      { el: $("#games"), icon: "gamepad", label: "Game" },
    ].filter((x) => x.el && !x.el.hidden);
    if (items.length < 2) return;

    const buttons = items.map((x) =>
      h(
        "button",
        {
          class: "qn-btn",
          type: "button",
          "aria-label": x.label,
          "data-tip": x.label,
          onclick: () => x.el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" }),
        },
        pxIcon(x.icon)
      )
    );
    nav.replaceChildren(...buttons);
    nav.hidden = false;

    // The current section is the last one whose top has passed 40% of the screen. At the very
    // bottom of the page the last section counts, since it may never reach that line.
    const mark = (i) => buttons.forEach((b, k) => (k === i ? b.setAttribute("aria-current", "true") : b.removeAttribute("aria-current")));
    let picked = -1; // a clicked button stays lit while its smooth scroll is running
    let pickTimer;
    const update = () => {
      if (picked >= 0) return mark(picked);
      const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
      const mid = window.innerHeight * 0.4;
      let best = 0;
      items.forEach((x, i) => {
        if (x.el.getBoundingClientRect().top - 40 <= mid) best = i;
      });
      mark(atBottom ? items.length - 1 : best);
    };
    buttons.forEach((b, i) =>
      b.addEventListener("click", () => {
        picked = i;
        mark(i);
      })
    );
    let raf = 0;
    window.addEventListener("scroll", () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
      // once scrolling settles, go back to tracking the position
      clearTimeout(pickTimer);
      pickTimer = setTimeout(() => {
        picked = -1;
        update();
      }, 160);
    }, { passive: true });
    window.addEventListener("resize", update);
    update();
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
      notices.render();
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

  /* ------------------------------------------------------------------ */
  /* Enter screen + boot                                                 */
  /* ------------------------------------------------------------------ */
  function reveal() {
    $("#stage").classList.add("is-visible");
    startTypewriter();
    music.play(); // deferred automatically if her page is open with its own song
    love.onEnter();
    setTimeout(notices.start, reduceMotion ? 0 : 900); // after the windows have dropped in
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
  setupQuickNav();
  setupCursor();
  startTitle();
  setupEnter();
  loadDiscord();
  setInterval(tickTimers, 1000);
})();
