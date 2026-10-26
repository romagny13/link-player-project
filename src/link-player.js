(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define([], factory);
  } else if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.LinkPlayer = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const TOOLTIP_SHOW_DELAY = 120;
  const TOOLTIP_IMG_SIZE = { width: 280, height: 158 };
  const TOOLTIP_ID = "linkplayer-tooltip";
  const TOOLTIP_STYLES_ID = "linkplayer-tooltip-styles";
  const OKRU_PLAYLIST_STYLES_ID = "linkplayer-okru-playlist-styles";
  const INLINE_TARGET_STYLES_ID = "linkplayer-inline-target-styles";
  const OKRU_SIDEBAR_WIDTH_KEY = "linkplayer-okru-sidebar-width";
  const OKRU_SIDEBAR_MIN_WIDTH = 140;
  const TOOLTIP_THUMB_TIMEOUT = 3000;
  const PROVIDER_LABELS = {
    youtube: "YouTube",
    dailymotion: "Dailymotion",
    okru: "Ok.ru"
  };

  function isTouchDevice() {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  }

  function getTheme() {
    try {
      const saved = localStorage.getItem("theme");
      if (saved) return saved;
    } catch {
      /* localStorage indisponible (sandbox, mode privé...) */
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function resolveScope(scope) {
    if (scope instanceof HTMLElement) return scope;
    if (typeof scope === "string")
      return document.querySelector(scope) || document.documentElement;
    return document.documentElement;
  }

  function getLinks(scope) {
    return scope.querySelectorAll("a[data-link]");
  }

  function injectInlineTargetStyles() {
    if (document.getElementById(INLINE_TARGET_STYLES_ID)) return;
    const s = document.createElement("style");
    s.id = INLINE_TARGET_STYLES_ID;
    s.textContent = `
.lp-inline-target {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
}
.lp-inline-target:empty { display: none; }
.lp-inline-target iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
}
    `;
    document.head.appendChild(s);
  }

  function resolveTargetContainer(link) {
    // data-target attribute
    if (link.dataset.target)
      return document.getElementById(link.dataset.target);
    // target created
    const next = link.nextElementSibling;
    if (next?.classList.contains("lp-inline-target")) return next;
    // create target
    injectInlineTargetStyles();
    const div = document.createElement("div");
    div.className = "lp-inline-target";
    link.insertAdjacentElement("afterend", div);
    return div;
  }

  // detect link url

  function isYouTubeUrl(url) {
    try {
      const u = new URL(url);
      const host = u.hostname.replace("www.", "");
      if (host === "youtube.com") {
        return (
          (u.pathname === "/watch" && u.searchParams.has("v")) ||
          (u.pathname === "/watch_videos" && u.searchParams.has("video_ids"))
        );
      }
      return host === "youtu.be" && u.pathname.length > 1;
    } catch {
      return false;
    }
  }

  function isDailymotionUrl(url) {
    try {
      const u = new URL(url);
      const host = u.hostname.replace("www.", "");
      return (
        host === "dailymotion.com" &&
        (u.pathname.startsWith("/video/") ||
          u.pathname.startsWith("/playlist/"))
      );
    } catch {
      return false;
    }
  }

  function isOkruUrl(url) {
    try {
      const u = new URL(url);
      const host = u.hostname.replace("www.", "");
      return host === "ok.ru" && u.pathname.startsWith("/video/");
    } catch {
      return false;
    }
  }

  function getUrlType(url) {
    if (isYouTubeUrl(url)) return "youtube";
    if (isDailymotionUrl(url)) return "dailymotion";
    if (isOkruUrl(url)) return "okru";
    return null;
  }

  // id vidéo : s'arrête à & ? # (ex: youtu.be/ID?si=...&t=110)
  const YT_VIDEO_RE = /(?:youtu\.be\/|[?&]v=)([^&?#]+)/;

  function parseYouTubeIds(url) {
    const videoMatch = url.match(YT_VIDEO_RE);
    const playlistMatch = url.match(/[?&]list=([^&#]+)/);
    const videoIdsMatch = url.match(/[?&]video_ids=([^&#]+)/);
    const tMatch = url.match(/[?&]t=(\d+)/);
    const indexMatch = url.match(/[?&]index=(\d+)/);

    return {
      videoId: videoMatch ? videoMatch[1] : null,
      playlistId: playlistMatch ? playlistMatch[1] : null,
      videoIds: videoIdsMatch ? videoIdsMatch[1].split(",") : null,
      startSeconds: tMatch ? parseInt(tMatch[1], 10) : null,
      index: indexMatch ? parseInt(indexMatch[1], 10) : null
    };
  }

  function parseDailymotionIds(url) {
    try {
      const u = new URL(url);
      const video = u.pathname.match(/^\/video\/([^/]+)/);
      const playlist =
        u.pathname.match(/^\/playlist\/([^/]+)/) ||
        (u.searchParams.has("playlist")
          ? [null, u.searchParams.get("playlist")]
          : null);
      if (video)
        return {
          type: "video",
          id: video[1],
          playlistId: playlist?.[1] ?? null
        };
      if (playlist)
        return { type: "playlist", id: playlist[1], playlistId: playlist[1] };
    } catch {
      /* noop */
    }
    return { type: null, id: null, playlistId: null };
  }

  function safeDecode(s) {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  }

  function parseOkruIds(url) {
    try {
      const u = new URL(url);
      const video = u.pathname.match(/^\/video\/([^/]+)/);
      if (video) {
        const playlistIds = u.searchParams.has("video_ids")
          ? u.searchParams
            .get("video_ids")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
          : null;
        const rawLabels = u.search.match(/[?&]labels=([^&]*)/)?.[1];
        const labels = rawLabels
          ? rawLabels
            .split(",")
            .map((s) => safeDecode(s.trim()))
            .filter(Boolean)
          : null;
        const indexParam = u.searchParams.get("index");
        const index = indexParam !== null ? parseInt(indexParam, 10) : null;
        return {
          type: "video",
          id: video[1],
          playlistIds,
          labels,
          index: Number.isNaN(index) ? null : index
        };
      }
    } catch {
      /* noop */
    }
    return { type: null, id: null, playlistIds: null, labels: null, index: null };
  }

  // Retourne la liste ordonnée des vidéos de la playlist
  function getOkruPlaylist(ids) {
    if (!ids.playlistIds || !ids.playlistIds.length) return [ids.id];
    return ids.playlistIds.includes(ids.id)
      ? [...ids.playlistIds]
      : [ids.id, ...ids.playlistIds];
  }

  // Retourne l'id de la vidéo à lancer en premier (selon l'index)
  function resolveOkruStartId(ids, indexOverride) {
    const list = getOkruPlaylist(ids);
    const index = indexOverride != null ? indexOverride : ids.index;
    if (index != null && index >= 0 && index < list.length) return list[index];
    return ids.id;
  }

  // "S2", "(s2)", "S2E5", "Saison 2", "Season 2"
  const SEASON_RE =
    /\b(?:saison|season)\s*0*(\d{1,3})\b|\bs0*(\d{1,2})(?:\b|(?=e\d))/i;

  function detectSeason(label) {
    const m = SEASON_RE.exec(label || "");
    return m ? parseInt(m[1] || m[2], 10) : null;
  }

  // Retourne [{ label, start, end }] (end exclu) ou null si pas de groupement utile
  function buildOkruSeasonGroups(count, labels, counts, seasonLabel = "Saison") {
    // 1) découpage explicite
    if (counts && counts.length) {
      const groups = [];
      let start = 0;
      counts.forEach((n, i) => {
        if (n > 0 && start < count) {
          const end = Math.min(start + n, count);
          groups.push({ label: `${seasonLabel} ${i + 1}`, start, end });
          start = end;
        }
      });
      if (start < count) groups.push({ label: "Autres", start, end: count });
      return groups.length > 1 ? groups : null;
    }

    // 2) détection automatique depuis les labels
    if (!labels || !labels.length) return null;
    const seasons = Array.from({ length: count }, (_, i) =>
      detectSeason(labels[i])
    );
    const firstDetected = seasons.find((s) => s != null);
    if (firstDetected == null) return null;

    let current = firstDetected > 1 ? 1 : null; // début sans marqueur => saison 1
    const groups = [];
    seasons.forEach((s, i) => {
      if (s != null) current = s;
      const last = groups[groups.length - 1];
      if (last && last.key === current) {
        last.end = i + 1;
      } else {
        groups.push({
          key: current,
          label: current == null ? "Autres" : `${seasonLabel} ${current}`,
          start: i,
          end: i + 1
        });
      }
    });
    return groups.length > 1 ? groups : null;
  }

  // IFRAME src

  function buildParams(autoplay, extra) {
    const p = new URLSearchParams(extra);
    if (autoplay) p.set("autoplay", "1");
    return p;
  }

  function buildYouTubeEmbedSrc(ids, autoplay) {
    if (ids.videoId) {
      const p = buildParams(
        autoplay,
        ids.playlistId ? { list: ids.playlistId } : {}
      );
      p.set("enablejsapi", "1");
      if (ids.startSeconds != null) p.set("start", ids.startSeconds);
      if (ids.playlistId && ids.index != null) p.set("index", ids.index);
      return `https://www.youtube.com/embed/${ids.videoId}?${p}`;
    }

    if (ids.videoIds && ids.videoIds.length) {
      const p = buildParams(autoplay, { playlist: ids.videoIds.join(",") });
      p.set("enablejsapi", "1");
      if (ids.startSeconds != null) p.set("start", ids.startSeconds);
      if (ids.index != null) p.set("index", ids.index);
      return `https://www.youtube.com/embed/videoseries?${p}`;
    }

    return null;
  }

  function buildDailymotionEmbedSrc(ids, autoplay) {
    if (!ids.id) return null;
    const p = buildParams(autoplay);
    if (ids.type === "playlist") {
      return `https://www.dailymotion.com/embed/playlist/${ids.id}?${p}`;
    }
    if (ids.playlistId) p.set("playlist", ids.playlistId);
    return `https://www.dailymotion.com/embed/video/${ids.id}?${p}`;
  }

  function buildOkruEmbedSrc(ids, autoplay, baseUrl) {
    if (!ids.id) return null;
    const qs = buildParams(autoplay).toString();
    const sep = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${ids.id}${qs ? sep + qs : ""}`;
  }

  // build html iframe

  function buildIframe(src, title) {
    return (
      `<iframe src="${src}" title="${title}" frameborder="0" ` +
      `allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`
    );
  }

  function pauseYouTubeIframe(iframe) {
    if (!iframe || !iframe.contentWindow) return;
    if (iframe.src.includes("youtube.com")) {
      iframe.contentWindow.postMessage(
        JSON.stringify({ event: "command", func: "pauseVideo", args: [] }),
        "https://www.youtube.com"
      );
    }
  }

  function pauseDailymotionIframe(iframe) {
    if (!iframe || !iframe.contentWindow) return;
    if (iframe.src.includes("dailymotion.com")) {
      iframe.contentWindow.postMessage("pause", "https://www.dailymotion.com");
    }
  }

  function getSidebarWidth(labels) {
    const MAX_CHARS_PER_LINE = 28; // ~2 lignes confortables
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.font = "12px system-ui, sans-serif";

    // On mesure chaque label tronqué à MAX_CHARS_PER_LINE
    const maxPx = Math.max(
      ...labels.map((l) => {
        const truncated =
          l.length > MAX_CHARS_PER_LINE ? l.slice(0, MAX_CHARS_PER_LINE) : l;
        return ctx.measureText(truncated).width;
      })
    );

    const CHROME = 66; // num + gap + arrow + paddings
    const width = Math.min(Math.max(Math.ceil(maxPx) + CHROME, 176), 280);
    return `${width}px`;
  }

  function injectOkruPlaylistStyles() {
    if (document.getElementById(OKRU_PLAYLIST_STYLES_ID)) return;
    const s = document.createElement("style");
    s.id = OKRU_PLAYLIST_STYLES_ID;
    s.textContent = `
.lp-okru-wrap {
  position: absolute;
  inset: 0;
  overflow: hidden;

  --lp-okru-bg: #141414;
  --lp-okru-border: #2a2a2a;
  --lp-okru-item-border: #1c1c1c;
  --lp-okru-item-hover: #1e1e1e;
  --lp-okru-text-muted: #777;
  --lp-okru-text-active: #f0f0f0;
  --lp-okru-num: #3a3a3a;
  --lp-okru-accent: #f7931e;
  --lp-okru-header-label: #4a4a4a;
  --lp-okru-toggle-bg: rgba(0, 0, 0, 0.55);
  --lp-okru-toggle-color: #fff;
  --lp-okru-scrollbar-thumb: #2e2e2e;
}

.lp-okru-wrap[data-lp-theme="light"] {
  --lp-okru-bg: #ffffff;
  --lp-okru-border: #e2e2e2;
  --lp-okru-item-border: #ececec;
  --lp-okru-item-hover: #f3f3f3;
  --lp-okru-text-muted: #555;
  --lp-okru-text-active: #111;
  --lp-okru-num: #b0b0b0;
  --lp-okru-accent: #f7931e;
  --lp-okru-header-label: #888;
  --lp-okru-toggle-bg: rgba(255, 255, 255, 0.75);
  --lp-okru-toggle-color: #111;
  --lp-okru-scrollbar-thumb: #d0d0d0;
}

.lp-okru-iframe-slot {
  position: absolute;
  inset: 0;
}
.lp-okru-iframe-slot iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
}

.lp-okru-sidebar {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: var(--lp-okru-sidebar-w, 176px);
  max-width: 70%;
  background: var(--lp-okru-bg);
  border-left: 1px solid var(--lp-okru-border);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: var(--lp-okru-scrollbar-thumb) transparent;
  z-index: 999;
  transform: translateX(0);
  transition: transform .2s ease;
}
.lp-okru-sidebar.lp-okru-sidebar-collapsed {
  transform: translateX(100%);
}
.lp-okru-sidebar::-webkit-scrollbar { width: 3px; }
.lp-okru-sidebar::-webkit-scrollbar-thumb { background: var(--lp-okru-scrollbar-thumb); border-radius: 2px; }

.lp-okru-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 8px 7px 12px;
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--lp-okru-bg);
}
.lp-okru-sidebar-header span:first-child {
  font-size: 10px;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--lp-okru-header-label);
  font-family: system-ui, sans-serif;
}

.lp-okru-sidebar-collapse-btn {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(247, 147, 30, 0.08);
  border: 1px solid rgba(247, 147, 30, 0.35);
  border-radius: 5px;
  cursor: pointer;
  color: var(--lp-okru-accent);
  transition: color .12s, background .12s, border-color .12s, transform .12s;
  padding: 0;
  flex-shrink: 0;
}
.lp-okru-sidebar-collapse-btn:hover {
  color: #fff;
  background: var(--lp-okru-accent);
  border-color: var(--lp-okru-accent);
  transform: scale(1.08);
}
.lp-okru-sidebar-collapse-btn:active { transform: scale(0.95); }
.lp-okru-sidebar-collapse-btn svg { display: block; width: 11px; height: 11px; }

.lp-okru-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--lp-okru-item-border);
  cursor: pointer;
  transition: background .12s;
  user-select: none;
}
.lp-okru-item:last-child { border-bottom: none; }
.lp-okru-item:hover { background: var(--lp-okru-item-hover); }
.lp-okru-item.lp-okru-active {
  background: var(--lp-okru-item-hover);
  border-left: 2px solid var(--lp-okru-accent);
  padding-left: 10px;
}
.lp-okru-num {
  font-size: 11px;
  color: var(--lp-okru-num);
  font-family: system-ui, sans-serif;
  min-width: 18px;
  flex-shrink: 0;
}
.lp-okru-item.lp-okru-active .lp-okru-num { color: var(--lp-okru-accent); }
.lp-okru-label {
  flex: 1;
  font-size: 12px;
  color: var(--lp-okru-text-muted);
  font-family: system-ui, sans-serif;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  overflow-wrap: break-word;
}
.lp-okru-item.lp-okru-active .lp-okru-label { color: var(--lp-okru-text-active); }
.lp-okru-arrow {
  flex-shrink: 0;
  width: 0; height: 0;
  border-style: solid;
  border-width: 4px 0 4px 6px;
  border-color: transparent transparent transparent var(--lp-okru-num);
}
.lp-okru-item.lp-okru-active .lp-okru-arrow {
  border-color: transparent transparent transparent var(--lp-okru-accent);
}

.lp-okru-toggle {
  position: absolute;
  top: 8px;
  right: 60px;
  width: 28px;
  height: 28px;
  display: none;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  background: var(--lp-okru-toggle-bg);
  color: var(--lp-okru-toggle-color);
  opacity: 0;
  pointer-events: none;
  transition: opacity .15s;
  padding: 0;
}
.lp-okru-toggle:hover {
  opacity: 0.8 !important;
}
.lp-okru-toggle svg { width: 18px; height: 18px; flex-shrink: 0; }

.lp-okru-wrap.lp-okru-collapsed .lp-okru-toggle { display: flex; }
.lp-okru-wrap.lp-okru-collapsed:hover .lp-okru-toggle {
  opacity: 1;
  pointer-events: auto;
}
.lp-okru-wrap.lp-okru-touch.lp-okru-collapsed .lp-okru-toggle {
  opacity: 1;
  pointer-events: auto;
}

.lp-okru-season-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  background: var(--lp-okru-item-hover);
  border-bottom: 1px solid var(--lp-okru-item-border);
  font-family: system-ui, sans-serif;
  font-size: 11px;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--lp-okru-text-muted);
  transition: color .12s;
}
.lp-okru-season-header:hover { color: var(--lp-okru-text-active); }
.lp-okru-season-title { flex: 1; }
.lp-okru-season-count {
  font-size: 10px;
  color: var(--lp-okru-num);
}
.lp-okru-season-chevron {
  width: 0; height: 0;
  border-style: solid;
  border-width: 5px 4px 0 4px;
  border-color: var(--lp-okru-accent) transparent transparent transparent;
  transition: transform .15s;
  flex-shrink: 0;
}
.lp-okru-season-collapsed .lp-okru-season-chevron { transform: rotate(-90deg); }
.lp-okru-season-collapsed .lp-okru-season-body { display: none; }
.lp-okru-resize {
  position: absolute;
  top: 0;
  bottom: 0;
  right: calc(min(var(--lp-okru-sidebar-w, 176px), 70%) - 5px);
  width: 10px;
  cursor: col-resize;
  touch-action: none;
  z-index: 1000;
}
.lp-okru-resize::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 4px;
  width: 2px;
  background: var(--lp-okru-accent);
  opacity: 0;
  transition: opacity .15s;
}
.lp-okru-resize:hover::after,
.lp-okru-resize:focus-visible::after,
.lp-okru-resizing .lp-okru-resize::after { opacity: .8; }
.lp-okru-resize:focus-visible { outline: none; }

.lp-okru-resizing { user-select: none; cursor: col-resize; }
.lp-okru-resizing .lp-okru-iframe-slot iframe { pointer-events: none; }

/* sidebar repliée : plus de poignée */
.lp-okru-wrap.lp-okru-collapsed .lp-okru-resize { display: none; }
    `;
    document.head.appendChild(s);
  }

  function readSavedSidebarWidth() {
    try {
      const n = parseInt(localStorage.getItem(OKRU_SIDEBAR_WIDTH_KEY), 10);
      return n >= OKRU_SIDEBAR_MIN_WIDTH ? n : null;
    } catch {
      return null;
    }
  }

  function saveSidebarWidth(w) {
    try {
      localStorage.setItem(OKRU_SIDEBAR_WIDTH_KEY, String(w));
    } catch {
      /* noop */
    }
  }

  function clearSavedSidebarWidth() {
    try {
      localStorage.removeItem(OKRU_SIDEBAR_WIDTH_KEY);
    } catch {
      /* noop */
    }
  }

  function createOkruResizeHandle(wrap, sidebar, autoWidth, persist) {
    const handle = document.createElement("div");
    handle.className = "lp-okru-resize";
    handle.tabIndex = 0;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-label", "Resize playlist");
    handle.title = "Drag to resize (double-click to reset)";

    // largeur max = 70 % du player ; min = OKRU_SIDEBAR_MIN_WIDTH
    function setWidth(px) {
      const max = Math.max(
        OKRU_SIDEBAR_MIN_WIDTH,
        Math.floor(wrap.clientWidth * 0.7)
      );
      const w = Math.min(Math.max(Math.round(px), OKRU_SIDEBAR_MIN_WIDTH), max);
      wrap.style.setProperty("--lp-okru-sidebar-w", `${w}px`);
      return w;
    }

    let startX = 0;
    let startW = 0;
    let current = 0;

    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      startX = e.clientX;
      startW = sidebar.getBoundingClientRect().width;
      current = startW;
      handle.setPointerCapture(e.pointerId);
      wrap.classList.add("lp-okru-resizing");
      e.preventDefault();
    });

    handle.addEventListener("pointermove", (e) => {
      if (!handle.hasPointerCapture(e.pointerId)) return;
      // la sidebar est à droite : glisser vers la gauche l'agrandit
      current = setWidth(startW + (startX - e.clientX));
    });

    const endDrag = (e) => {
      if (!handle.hasPointerCapture(e.pointerId)) return;
      handle.releasePointerCapture(e.pointerId);
      wrap.classList.remove("lp-okru-resizing");
      if (persist) saveSidebarWidth(current);
    };
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);

    handle.addEventListener("dblclick", () => {
      wrap.style.setProperty("--lp-okru-sidebar-w", `${autoWidth}px`);
      if (persist) clearSavedSidebarWidth();
    });

    handle.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const delta = e.key === "ArrowLeft" ? 16 : -16;
      current = setWidth(sidebar.getBoundingClientRect().width + delta);
      if (persist) saveSidebarWidth(current);
    });

    return handle;
  }

  function buildOkruPlaylistLayout(iframeSrc, ids, okruBase, theme, opts = {}) {
    injectOkruPlaylistStyles();

    const allIds = getOkruPlaylist(ids);
    const activeId = opts.startId || ids.id;

    // Si l'id de l'URL a été ajouté en tête (absent de video_ids), les labels
    // (alignés sur video_ids) sont décalés d'un cran : on réaligne.
    const offset = allIds.length - (ids.playlistIds ? ids.playlistIds.length : 0);
    const rawLabels = ids.labels || [];
    const allLabels = offset > 0 ? [...Array(offset).fill(""), ...rawLabels] : rawLabels;

    const wrap = document.createElement("div");
    wrap.className = "lp-okru-wrap";
    wrap.setAttribute("data-lp-theme", theme === "light" ? "light" : "dark");
    if (isTouchDevice()) wrap.classList.add("lp-okru-touch");

    const iframeSlot = document.createElement("div");
    iframeSlot.className = "lp-okru-iframe-slot";
    const iframe = document.createElement("iframe");
    iframe.src = iframeSrc;
    iframe.title = "Ok.ru player";
    iframe.setAttribute("frameborder", "0");
    iframe.setAttribute("allow", "autoplay; fullscreen; picture-in-picture");
    iframe.setAttribute("allowfullscreen", "");
    iframeSlot.appendChild(iframe);

    const sidebar = document.createElement("div");
    sidebar.className = "lp-okru-sidebar";
    const autoWidth =
      rawLabels.length > 0 ? parseInt(getSidebarWidth(rawLabels), 10) : 176;
    const resizable = opts.resizable !== false;
    const persist = opts.persistWidth !== false;
    const savedWidth = resizable && persist ? readSavedSidebarWidth() : null;
    wrap.style.setProperty("--lp-okru-sidebar-w", `${savedWidth || autoWidth}px`);

    const header = document.createElement("div");
    header.className = "lp-okru-sidebar-header";
    header.innerHTML = `
        <span>Playlist</span>
        <span class="lp-okru-sidebar-collapse-btn" title="Hide playlist">
            <svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 2l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M6 2l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </span>
    `;

    header
      .querySelector(".lp-okru-sidebar-collapse-btn")
      .addEventListener("click", () => {
        sidebar.classList.add("lp-okru-sidebar-collapsed");
        wrap.classList.add("lp-okru-collapsed");
      });

    sidebar.appendChild(header);

    function createItem(videoId, index) {
      const item = document.createElement("div");
      item.className =
        "lp-okru-item" + (videoId === activeId ? " lp-okru-active" : "");
      item.dataset.videoId = videoId;

      const num = document.createElement("span");
      num.className = "lp-okru-num";
      num.textContent = String(index + 1).padStart(2, "0");

      const label = document.createElement("span");
      label.className = "lp-okru-label";
      const textContent = allLabels[index] || `Video ${index + 1}`;
      label.textContent = textContent;
      item.title = textContent;

      const arrow = document.createElement("span");
      arrow.className = "lp-okru-arrow";

      item.appendChild(num);
      item.appendChild(label);
      item.appendChild(arrow);

      item.addEventListener("click", () => {
        // l'utilisateur vient de cliquer : on lance directement la lecture
        iframe.src = buildOkruEmbedSrc({ id: videoId }, true, okruBase);
        sidebar
          .querySelectorAll(".lp-okru-item")
          .forEach((el) => el.classList.remove("lp-okru-active"));
        item.classList.add("lp-okru-active");
        opts.onSelect?.(videoId, index);
      });

      return item;
    }

    const groups =
      opts.groupSeasons === false
        ? null
        : buildOkruSeasonGroups(
          allIds.length,
          allLabels,
          opts.seasonCounts,
          opts.seasonLabel || "Saison"
        );

    if (!groups) {
      allIds.forEach((videoId, i) => sidebar.appendChild(createItem(videoId, i)));
    } else {
      const activeIndex = allIds.indexOf(activeId);

      groups.forEach((g) => {
        const section = document.createElement("div");
        section.className = "lp-okru-season";

        const head = document.createElement("div");
        head.className = "lp-okru-season-header";
        head.innerHTML = `
          <span class="lp-okru-season-chevron"></span>
          <span class="lp-okru-season-title"></span>
          <span class="lp-okru-season-count"></span>
        `;
        head.querySelector(".lp-okru-season-title").textContent = g.label;
        head.querySelector(".lp-okru-season-count").textContent = g.end - g.start;

        const body = document.createElement("div");
        body.className = "lp-okru-season-body";
        for (let i = g.start; i < g.end; i++) {
          body.appendChild(createItem(allIds[i], i));
        }

        // seule la saison de la vidéo active est dépliée
        if (!(activeIndex >= g.start && activeIndex < g.end)) {
          section.classList.add("lp-okru-season-collapsed");
        }
        head.addEventListener("click", () =>
          section.classList.toggle("lp-okru-season-collapsed")
        );

        section.appendChild(head);
        section.appendChild(body);
        sidebar.appendChild(section);
      });
    }

    const toggle = document.createElement("div");
    toggle.className = "lp-okru-toggle";
    toggle.title = "Show playlist";
    toggle.innerHTML = `
        <svg viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
            <line x1="3" y1="5"  x2="15" y2="5"  stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="3" y1="9"  x2="15" y2="9"  stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="3" y1="13" x2="10" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
    `;

    toggle.addEventListener("click", () => {
      sidebar.classList.remove("lp-okru-sidebar-collapsed");
      wrap.classList.remove("lp-okru-collapsed");
    });

    iframeSlot.appendChild(toggle);

    wrap.appendChild(iframeSlot);
    wrap.appendChild(sidebar);
    if (resizable) {
      wrap.appendChild(createOkruResizeHandle(wrap, sidebar, autoWidth, persist));
    }

    return wrap;
  }

  // Tooltip
  const _thumbCache = new Map();

  async function resolveThumbnailCached(url) {
    if (_thumbCache.has(url)) return _thumbCache.get(url);
    const result = await resolveThumbnail(url);
    _thumbCache.set(url, result);
    return result;
  }

  function resolveYouTubeThumbnail(url) {
    const video = url.match(YT_VIDEO_RE);
    if (video) return `https://img.youtube.com/vi/${video[1]}/hqdefault.jpg`;
    const ids = url.match(/[?&]video_ids=([^&,#]+)/);
    if (ids) return `https://img.youtube.com/vi/${ids[1]}/hqdefault.jpg`;
    return null;
  }

  function resolveDailymotionThumbnail(url) {
    const video = url.match(/\/video\/([^_?/]+)/);
    if (video) return `https://www.dailymotion.com/thumbnail/video/${video[1]}`;
    return null;
  }

  async function resolveOkruThumbnail(url) {
    try {
      // on n'envoie que la partie sans query (video_ids / labels peuvent être énormes)
      const cleanUrl = url.split("?")[0];
      const res = await fetch(
        `https://ok.ru/oembed?url=${encodeURIComponent(cleanUrl)}&format=json`
      );
      if (!res.ok) return null;
      const data = await res.json();
      return data.thumbnail_url ?? null;
    } catch {
      return null;
    }
  }

  async function resolveThumbnail(url) {
    if (isYouTubeUrl(url)) return resolveYouTubeThumbnail(url);
    if (isDailymotionUrl(url)) return resolveDailymotionThumbnail(url);
    if (isOkruUrl(url)) return resolveOkruThumbnail(url);
    return null;
  }

  function injectTooltipStyles() {
    if (document.getElementById(TOOLTIP_STYLES_ID)) return;
    const s = document.createElement("style");
    s.id = TOOLTIP_STYLES_ID;
    const h = TOOLTIP_IMG_SIZE.height;
    s.textContent = `
       #${TOOLTIP_ID} {
            position: relative;
            height: ${h}px;
            background: #1a1a1a;
        }

        /* Fallback sans miniature : même taille, placeholder aux couleurs du service */
        #${TOOLTIP_ID}.lp-no-thumb {
            background: linear-gradient(135deg, var(--lp-fb-a, #2f2f2f), var(--lp-fb-b, #141414));
        }
        #${TOOLTIP_ID}[data-provider="youtube"]     { --lp-fb-a: #4d1414; --lp-fb-b: #141414; }
        #${TOOLTIP_ID}[data-provider="dailymotion"] { --lp-fb-a: #123a63; --lp-fb-b: #101820; }
        #${TOOLTIP_ID}[data-provider="okru"]        { --lp-fb-a: #5a3508; --lp-fb-b: #181108; }

        #${TOOLTIP_ID}.lp-no-thumb::before {
            content: attr(data-provider-label);
            position: absolute;
            top: 10px;
            left: 12px;
            font: 600 10px system-ui, sans-serif;
            letter-spacing: .12em;
            text-transform: uppercase;
            color: rgba(255,255,255,.55);
        }
        #${TOOLTIP_ID}.lp-no-thumb .lp-tooltip-play { top: 42%; }
        #${TOOLTIP_ID}.lp-no-thumb .lp-tooltip-title {
            white-space: normal;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            line-height: 1.3;
        }
        #${TOOLTIP_ID}::after {
            content: '';
            position: absolute;
            bottom: 0; left: 0; right: 0;
            height: 60px;
            background: linear-gradient(to bottom, transparent, rgba(0,0,0,.7));
            pointer-events: none;
        }
        #${TOOLTIP_ID}.lp-no-thumb::after {
            display: none;
        }
        #${TOOLTIP_ID} .lp-tooltip-loader,
        #${TOOLTIP_ID} .lp-tooltip-img {
            display: block;
            width: 100%;
            height: ${h}px;
        }
        #${TOOLTIP_ID} .lp-tooltip-loader {
            background: #111;
            position: relative;
        }
        #${TOOLTIP_ID} .lp-tooltip-loader::after {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(90deg, transparent 0%, #2a2a2a 50%, transparent 100%);
            background-size: 200% 100%;
            animation: lp-shimmer 1.2s infinite;
        }
        #${TOOLTIP_ID} .lp-tooltip-img { object-fit: cover; }
        #${TOOLTIP_ID} .lp-tooltip-play {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 68px;
            height: 48px;
            background-color: rgba(0,0,0,.8);
            border-radius: 12px;
            opacity: 0.9;
            transition: opacity .2s, background .2s, border-color .2s;
        }
        #${TOOLTIP_ID} .lp-tooltip-play::after {
            content: '';
            position: absolute;
            top: 50%;
            left: 55%;
            transform: translate(-50%, -50%);
            border-style: solid;
            border-width: 12px 0 12px 20px;
            border-color: transparent transparent transparent white;
        }
        #${TOOLTIP_ID}:hover .lp-tooltip-play {
            opacity: 1;
            background: rgba(255,255,255,.15);
            border-color: rgba(255,255,255,.55);
        }
        #${TOOLTIP_ID} .lp-tooltip-title {
            position: absolute;
            bottom: 12px; left: 12px; right: 12px;
            color: #fff;
            font-size: 14px; font-weight: 500;
            font-family: system-ui, sans-serif;
            z-index: 1;
            text-shadow: 1px 1px 2px rgba(0,0,0,.5);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        @keyframes lp-shimmer {
            from { background-position: 200% 0; }
            to   { background-position: -200% 0; }
        }
        @media (hover: none) {
            #${TOOLTIP_ID} .lp-tooltip-play { opacity: 1; }
        }
    `;
    document.head.appendChild(s);
  }

  function createTooltipEl() {
    const el = document.createElement("div");
    el.id = TOOLTIP_ID;
    el.innerHTML = `
            <div class="lp-tooltip-loader"></div>
            <img class="lp-tooltip-img" alt="" />
            <div class="lp-tooltip-play"></div>
            <span class="lp-tooltip-title"></span>
        `;
    Object.assign(el.style, {
      display: "none",
      position: "fixed",
      zIndex: "9999",
      width: `${TOOLTIP_IMG_SIZE.width}px`,
      borderRadius: "8px",
      overflow: "hidden",
      boxShadow: "0 8px 24px rgba(0,0,0,.55)",
      pointerEvents: "none",
      transition: "opacity .15s ease, transform .15s ease",
      opacity: "0",
      transform: "translateY(4px)"
    });
    document.body.appendChild(el);
    injectTooltipStyles();
    return el;
  }

  function getTooltipEl() {
    return document.getElementById(TOOLTIP_ID) || createTooltipEl();
  }

  function positionTooltip(tooltip, e) {
    const margin = 14;
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    let x = e.clientX + margin;
    let y = e.clientY + margin;
    if (x + tw > window.innerWidth) x = e.clientX - tw - margin;
    if (y + th > window.innerHeight) y = e.clientY - th - margin;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }

  // Évite les courses : timer de masquage + jeton pour ignorer les
  // miniatures qui arrivent après qu'un autre lien a pris la main.
  let _hideTimer = null;
  let _tooltipToken = 0;

  async function showTooltip(tooltip, url, label, forcedThumb) {
    clearTimeout(_hideTimer);
    const token = ++_tooltipToken;

    const img = tooltip.querySelector(".lp-tooltip-img");
    const loader = tooltip.querySelector(".lp-tooltip-loader");
    const title = tooltip.querySelector(".lp-tooltip-title");

    const provider = getUrlType(url);
    tooltip.dataset.provider = provider || "";
    tooltip.dataset.providerLabel = PROVIDER_LABELS[provider] || "";

    tooltip.classList.remove("lp-no-thumb");
    img.style.display = "none";
    img.removeAttribute("src");
    loader.style.display = "block";
    title.textContent = label || "";

    tooltip.style.display = "block";
    requestAnimationFrame(() => {
      tooltip.style.opacity = "1";
      tooltip.style.transform = "translateY(0)";
    });

    const useFallback = () => {
      loader.style.display = "none";
      tooltip.classList.add("lp-no-thumb");
    };

    const thumbUrl =
      forcedThumb ||
      (await Promise.race([
        resolveThumbnailCached(url),
        new Promise((resolve) =>
          setTimeout(() => resolve(null), TOOLTIP_THUMB_TIMEOUT)
        )
      ]));
    if (token !== _tooltipToken) return;

    if (!thumbUrl) {
      useFallback();
      return;
    }

    const image = new Image();
    image.onload = () => {
      if (token !== _tooltipToken) return;
      // YouTube renvoie une image grise 120x90 quand la vidéo n'existe plus
      if (provider === "youtube" && image.naturalWidth <= 120) {
        useFallback();
        return;
      }
      loader.style.display = "none";
      img.src = thumbUrl;
      img.style.display = "block";
    };
    image.onerror = () => {
      if (token !== _tooltipToken) return;
      useFallback();
    };
    image.src = thumbUrl;
  }

  function hideTooltip(tooltip) {
    _tooltipToken++;
    tooltip.style.opacity = "0";
    tooltip.style.transform = "translateY(4px)";
    clearTimeout(_hideTimer);
    _hideTimer = setTimeout(() => {
      tooltip.style.display = "none";
    }, 150);
  }

  function isTooltipVisible(tooltip) {
    return !!tooltip && tooltip.style.display !== "none";
  }

  // Garde-fou global : ferme le tooltip si un tap a lieu hors du lien/tooltip.
  // Utile sur les appareils hybrides (souris + tactile) où mouseleave peut
  // ne pas se déclencher de façon fiable après un tap.
  let _tooltipOutsideHandlerAttached = false;

  function attachTooltipOutsideTapHandler(tooltip) {
    if (_tooltipOutsideHandlerAttached) return;
    _tooltipOutsideHandlerAttached = true;

    document.addEventListener(
      "pointerdown",
      (e) => {
        if (!isTooltipVisible(tooltip)) return;
        const target = e.target;
        if (tooltip.contains(target)) return;
        if (target.closest && target.closest("a[data-link]")) return;
        hideTooltip(tooltip);
      },
      true
    );
  }

  class LinkPlayer {
    static VERSION = "1.0.14";
    constructor(options = {}) {
      this._options = options;
      this._scope = resolveScope(options.scope);
      this._okruBase = options.embedBaseUrl || "https://ok.ru/videoembed/";

      if (options.theme) {
        this._theme = options.theme === "light" ? "light" : "dark"; // dark par défaut
      } else {
        this._theme = getTheme();
      }

      this._tooltip = null;

      try {
        this.scan();
      } catch (err) {
        this._options.onError?.("LinkPlayer init failed: " + err.message);
      }
    }

    _attachTooltip(link) {
      if (this._options.tooltip === false) return;
      // Pas de tooltip de survol sur tactile : il n'y a pas de "hover" avant
      // le tap, et mouseenter/mouseleave ne se comportent pas de façon fiable.
      if (isTouchDevice()) return;

      if (!this._tooltip) this._tooltip = getTooltipEl();
      const tooltip = this._tooltip;
      attachTooltipOutsideTapHandler(tooltip);
      let timer = null;

      link.addEventListener("mouseenter", () => {
        timer = setTimeout(
          () =>
            showTooltip(
              tooltip,
              link.href,
              link.textContent.trim(),
              link.dataset.thumbnail
            ),
          TOOLTIP_SHOW_DELAY
        );
      });
      link.addEventListener("mousemove", (e) => positionTooltip(tooltip, e));
      link.addEventListener("mouseleave", () => {
        clearTimeout(timer);
        hideTooltip(tooltip);
      });
    }

    _mountEmbed(targetContainer, link, autoplay) {
      // objectif: generer le code html de l'iframe dans le target container
      const currentIframe = targetContainer.querySelector("iframe");
      const url = link.href;

      const urlType = getUrlType(url);
      if (urlType == null) {
        this._options.onError?.(`URL not supported : ${url}`);
        return;
      }

      let newSrc = null;
      let iframeHtml = null;
      if (urlType === "youtube") {
        newSrc = buildYouTubeEmbedSrc(parseYouTubeIds(url), autoplay);
        if (!newSrc) {
          this._options.onError?.(`URL not supported : ${url}`);
          return;
        }
        if (currentIframe) {
          pauseYouTubeIframe(currentIframe);
          if (newSrc === currentIframe.src) {
            targetContainer.innerHTML = "";
            return;
          }
        }
        iframeHtml = buildIframe(newSrc, "YouTube player");
        targetContainer.innerHTML = iframeHtml;
        this._options.onChange?.(url, link);
      } else if (urlType === "dailymotion") {
        newSrc = buildDailymotionEmbedSrc(parseDailymotionIds(url), autoplay);
        if (!newSrc) {
          this._options.onError?.(`URL not supported : ${url}`);
          return;
        }
        if (currentIframe) {
          pauseDailymotionIframe(currentIframe);
          if (newSrc === currentIframe.src) {
            targetContainer.innerHTML = "";
            return;
          }
        }
        iframeHtml = buildIframe(newSrc, "Dailymotion player");
        targetContainer.innerHTML = iframeHtml;
        this._options.onChange?.(url, link);
      } else if (urlType === "okru") {
        const ids = parseOkruIds(url);

        // data-index prioritaire sur le paramètre ?index= de l'URL
        const dataIndex =
          link.dataset.index !== undefined
            ? parseInt(link.dataset.index, 10)
            : null;
        const startId = resolveOkruStartId(
          ids,
          Number.isNaN(dataIndex) ? null : dataIndex
        );

        newSrc = buildOkruEmbedSrc({ id: startId }, autoplay, this._okruBase);
        if (!newSrc) {
          this._options.onError?.(`URL not supported : ${url}`);
          return;
        }
        if (currentIframe && newSrc === currentIframe.src) {
          targetContainer.innerHTML = "";
          return;
        }

        if (ids.id && ids.playlistIds && ids.playlistIds.length > 0) {
          const seasonCounts = link.dataset.seasons
            ? link.dataset.seasons
              .split(",")
              .map((n) => parseInt(n, 10))
              .filter((n) => n > 0)
            : null;

          const layout = buildOkruPlaylistLayout(
            newSrc,
            ids,
            this._okruBase,
            this._theme,
            {
              startId,
              seasonCounts,
              groupSeasons: this._options.groupSeasons, // false pour désactiver
              seasonLabel: this._options.seasonLabel, // ex: "Season"
              resizable: this._options.resizable,       // false pour désactiver
              persistWidth: this._options.persistWidth, // false pour ne pas mémoriser
              onSelect: (videoId, index) =>
                this._options.onChange?.(url, link, { videoId, index })
            }
          );
          targetContainer.replaceChildren(layout);

          // fait défiler uniquement la sidebar (scrollIntoView ferait
          // défiler toute la page)
          const sb = layout.querySelector(".lp-okru-sidebar");
          const active = layout.querySelector(".lp-okru-active");
          if (sb && active) {
            sb.scrollTop = Math.max(
              0,
              active.offsetTop - sb.clientHeight / 2 + active.offsetHeight / 2
            );
          }
        } else {
          iframeHtml = buildIframe(newSrc, "Ok.ru player");
          targetContainer.innerHTML = iframeHtml;
        }
        this._options.onChange?.(url, link);
      }
    }

    scan() {
      // on recupere tous les links avec attribut data-link
      const links = getLinks(this._scope);
      links.forEach((link) => {
        // autoplay
        const autoplay = link.hasAttribute("data-autoplay");

        // show on init
        if (link.hasAttribute("data-show-on-init")) {
          const container = resolveTargetContainer(link);
          if (container) this._mountEmbed(container, link, autoplay);
        }

        link.addEventListener("click", (e) => {
          e.preventDefault();
          const container = resolveTargetContainer(link);
          if (container) this._mountEmbed(container, link, autoplay);
        });

        this._attachTooltip(link);
      });
    }
  }

  LinkPlayer._internal = {
    // device
    isTouchDevice,
    getTheme,
    // detect
    isYouTubeUrl,
    isDailymotionUrl,
    isOkruUrl,
    getUrlType,
    // parsers
    parseYouTubeIds,
    parseDailymotionIds,
    parseOkruIds,
    getOkruPlaylist,
    resolveOkruStartId,
    detectSeason,
    buildOkruSeasonGroups,
    // builders
    buildYouTubeEmbedSrc,
    buildDailymotionEmbedSrc,
    buildOkruEmbedSrc,
    buildIframe,
    buildOkruPlaylistLayout,
    // thumbnails
    resolveYouTubeThumbnail,
    resolveDailymotionThumbnail,
    resolveOkruThumbnail,
    resolveThumbnail,
    resolveThumbnailCached,
    // cache
    thumbnailCache: _thumbCache,
    // tooltip
    getTooltipEl,
    showTooltip,
    hideTooltip,
    positionTooltip,
    isTooltipVisible
  };

  return LinkPlayer;
});