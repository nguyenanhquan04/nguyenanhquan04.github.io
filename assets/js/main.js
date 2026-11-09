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

  const state = { discord: null, github: null };

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
  const music = (() => {
    const m = cfg.music || {};
    const audio = $("#audio");
    if (!m.src) return { play() {} };

    const player = $("#player");
    const vol = $("#player-volume");
    const iconEl = $("#player-icon");
    const titleWrap = $("#player-title-wrap");

    audio.src = m.src;
    audio.volume = clamp(m.volume ?? 0.35, 0, 1);
    vol.value = audio.volume;
    $("#player-title").textContent = m.title || "";
    player.hidden = false;

    const sync = () => {
      iconEl.className = audio.paused ? "fa-solid fa-play" : "fa-solid fa-pause";
    };
    audio.addEventListener("play", sync);
    audio.addEventListener("pause", sync);
    $("#player-toggle").addEventListener("click", () => {
      if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
    });
    vol.addEventListener("input", () => {
      audio.volume = +vol.value;
    });

    requestAnimationFrame(() => {
      if (titleWrap.scrollWidth > titleWrap.clientWidth + 2) titleWrap.classList.add("is-marquee");
    });

    return {
      play() {
        audio.play().catch(() => {
          // Autoplay blocked (no enter screen): start on the first click outside the player.
          const once = (e) => {
            if (e.target.closest("#player")) return;
            document.removeEventListener("pointerdown", once);
            audio.play().catch(() => {});
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
      const text = graphemes(displayName());
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
      if (tilt) card.style.transform = `rotateX(${(0.5 - py) * 7}deg) rotateY(${(px - 0.5) * 9}deg)`;
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

  function cardShell({ href, media, label, labelIcon, body }) {
    const inner = [
      h("div", { class: "acard-media" }, media),
      h("div", { class: "acard-body" }, h("div", { class: "acard-label" }, icon(labelIcon), label), body),
    ];
    const el = href
      ? h("a", { class: "acard", href, target: "_blank", rel: "noopener noreferrer" }, inner)
      : h("div", { class: "acard" }, inner);
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

  function buildDiscordCard(p) {
    const u = p.discord_user;
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
  function setPresence(data) {
    if (!data || !data.discord_user) return;
    state.discord = data;
    renderProfile();
    renderActivity();
  }

  async function loadDiscord() {
    const id = String(integ.discordId || "").trim();
    if (!id) return;
    if (!/^\d{17,20}$/.test(id)) {
      console.warn("[bio] discordId không hợp lệ (phải là dãy 17–20 chữ số):", id);
      return;
    }

    let monitored = true;
    try {
      const res = await fetch(`https://api.lanyard.rest/v1/users/${id}`);
      const json = await res.json();
      if (json.success) {
        setPresence(json.data);
      } else {
        monitored = false;
        console.warn(
          `[bio] Lanyard: ${json.error?.message || "không tìm thấy người dùng"}.`,
          "Hãy tham gia server Lanyard để hiện trạng thái Discord: https://discord.gg/UrXF2cfJ7F"
        );
      }
    } catch (err) {
      console.warn("[bio] Không gọi được Lanyard REST, thử WebSocket:", err);
    }
    if (monitored) connectLanyard(id, 0);
  }

  function connectLanyard(id, attempt) {
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
        ws.send(JSON.stringify({ op: 2, d: { subscribe_to_id: id } }));
        clearInterval(heartbeat);
        heartbeat = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 3 }));
        }, msg.d?.heartbeat_interval || 30000);
        attempt = 0;
      } else if (msg.op === 0 && (msg.t === "INIT_STATE" || msg.t === "PRESENCE_UPDATE")) {
        setPresence(msg.d);
      }
    });
    ws.addEventListener("close", () => {
      clearInterval(heartbeat);
      const delay = Math.min(30000, 2000 * 2 ** attempt);
      setTimeout(() => connectLanyard(id, attempt + 1), delay);
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
    $("#player").classList.add("is-visible");
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
  setupTilt();
  setupCursor();
  startTitle();
  setupEnter();
  loadDiscord();
  loadGitHub();
  setInterval(tickTimers, 1000);
})();
