import { LinkScanner } from "./linkScanner.js";
import { AUTOPLAY_MODES } from "./converters.js";

/* ───────────────────────── helpers ───────────────────────── */

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const isTouch = () =>
  !!globalThis.matchMedia?.("(hover: none) and (pointer: coarse)").matches;
const hostOf = (u) => u.hostname.replace(/^www\./, "");
const intParam = (u, name) => {
  const v = u.searchParams.get(name);
  return v !== null && /^\d+$/.test(v) ? +v : null;
};
const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const DAY = 24 * 60 * 60 * 1000;

export function resolveScope(scope) {
  if (scope instanceof HTMLElement) return scope;
  if (typeof scope === "string")
    return document.querySelector(scope) || document.documentElement;
  return document.documentElement;
}

/** Keeps the panel between 140px and 70% of the player. */
export const clampWidth = (px, hostWidth) =>
  Math.min(
    Math.max(Math.round(px), 140),
    Math.max(140, Math.floor(hostWidth * 0.7))
  );

/* ───────────────────────── storage ───────────────────────── */

/** Same API as JsonStore, nothing leaves the page. */
export class MemoryStore {
  #m = new Map();
  get(key) {
    const e = this.#m.get(key);
    if (!e) return null;
    if (e.expiresAt && Date.now() > e.expiresAt) {
      this.#m.delete(key);
      return null;
    }
    return e.data ?? null;
  }
  set(key, data, ttlMs) {
    this.#m.set(key, { data, expiresAt: ttlMs ? Date.now() + ttlMs : null });
  }
  remove(key) {
    this.#m.delete(key);
  }
}

/** JSON in a localStorage-like storage. Never throws. ttlMs is optional (no expiry by default). */
export class JsonStore {
  constructor({ storage = globalThis.localStorage, prefix = "lp:" } = {}) {
    this._s = storage;
    this._p = prefix;
  }
  get(key) {
    try {
      const raw = this._s.getItem(this._p + key);
      if (!raw) return null;
      const { data, expiresAt } = JSON.parse(raw);
      if (expiresAt && Date.now() > expiresAt) {
        this._s.removeItem(this._p + key);
        return null;
      }
      return data ?? null;
    } catch {
      return null;
    }
  }
  set(key, data, ttlMs) {
    try {
      this._s.setItem(
        this._p + key,
        JSON.stringify({ data, expiresAt: ttlMs ? Date.now() + ttlMs : null })
      );
    } catch {
      /* private mode or quota: storage is optional */
    }
  }
  remove(key) {
    try {
      this._s.removeItem(this._p + key);
    } catch {
      /* noop */
    }
  }
}

/* ───────────────────────── seasons (pure) ───────────────────────── */

const SEASON_RE =
  /\b(?:saison|season)\s*0*(\d{1,3})\b|\bs0*(\d{1,2})(?:\b|(?=e\d))/i;

/** [{ label, start, end }] (end exclusive) or null when grouping is useless. */
export function groupBySeason(items, counts = null) {
  const n = items.length;
  if (counts?.length) {
    const groups = [];
    let start = 0;
    counts.forEach((c, i) => {
      if (start < n) {
        groups.push({
          label: `Season ${i + 1}`,
          start,
          end: Math.min(start + c, n)
        });
        start += c;
      }
    });
    if (start < n) groups.push({ label: "Other", start, end: n });
    return groups.length > 1 ? groups : null;
  }
  const seasons = items.map((it) => {
    const m = SEASON_RE.exec(it.title);
    return m ? +(m[1] || m[2]) : null;
  });
  const first = seasons.find((s) => s !== null);
  if (first === undefined) return null;
  let cur = first > 1 ? 1 : null; // leading items without marker belong to season 1
  const groups = [];
  seasons.forEach((s, i) => {
    if (s !== null) cur = s;
    const last = groups[groups.length - 1];
    if (last && last.key === cur) last.end = i + 1;
    else
      groups.push({
        key: cur,
        label: cur === null ? "Other" : `Season ${cur}`,
        start: i,
        end: i + 1
      });
  });
  return groups.length > 1 ? groups : null;
}

/* ───────────────────────── providers ───────────────────────── */
/*
 * Provider contract:
 *   id, label, panel ({ toggle, open } or null)
 *   canHandle(url) · parse(url) → parsed (with initialIndex, 0-based, or null)
 *   buildEmbedSrc(parsed, { autoplay, index }) · getPlaylist(parsed) → Promise<items[]> (never rejects)
 *   getThumbnail(parsed) → Promise<string|null>
 *   createController(iframe, { parsed, index, onItemChange }) → { playAt(i, opts), dispose() }
 */

const noopController = { playAt() {}, dispose() {} };
const item = (id, index, title = "", channelTitle = "", thumbnailUrl = "") => ({
  id: String(id),
  index,
  title: title || `Video ${index + 1}`,
  channelTitle,
  thumbnailUrl
});

const YT_ORIGINS = [
  "https://www.youtube.com",
  "https://www.youtube-nocookie.com"
];

export class YouTubeProvider {
  id = "youtube";
  name = "YouTube";
  label = "YouTube player";
  panel = { toggle: "bottom-left", open: false };

  constructor({
    apiKey = null,
    store = null,
    fetchFn = (...a) => fetch(...a),
    origin = globalThis.location?.origin ?? ""
  } = {}) {
    this._apiKey = apiKey;
    this._store = store;
    this._fetch = fetchFn;
    this._origin = origin;
  }

  canHandle(url) {
    try {
      const u = new URL(url);
      const h = hostOf(u);
      if (
        (h === "youtube.com" || h === "youtube-nocookie.com") &&
        /^\/embed(\/|$)/.test(u.pathname)
      )
        return true;
      if (h === "youtube.com") {
        return (
          (u.pathname === "/watch" && u.searchParams.has("v")) ||
          (u.pathname === "/watch_videos" && u.searchParams.has("video_ids"))
        );
      }
      return h === "youtu.be" && u.pathname.length > 1;
    } catch {
      return false;
    }
  }

  parse(url) {
    const u = new URL(url);
    const emb = /^\/embed(?:\/([^/]+))?\/?$/.exec(u.pathname);
    const pathId = emb?.[1] && emb[1] !== "videoseries" ? emb[1] : null;
    const ids = u.searchParams.get(emb ? "playlist" : "video_ids");
    const videoIds = ids
      ? ids
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : null;
    if (pathId && videoIds && !videoIds.includes(pathId))
      videoIds.unshift(pathId);
    const urlIndex = intParam(u, "index");
    return {
      videoId: emb
        ? pathId
        : hostOf(u) === "youtu.be"
        ? u.pathname.slice(1)
        : u.searchParams.get("v"),
      playlistId: u.searchParams.get("list"),
      videoIds,
      startSeconds: intParam(u, "start") ?? intParam(u, "t"),
      // embed: index is 0-based, watch: 1-based
      initialIndex:
        urlIndex === null ? null : emb ? urlIndex : Math.max(urlIndex - 1, 0)
    };
  }

  buildEmbedSrc(p, { autoplay = false, index = null } = {}) {
    const q = new URLSearchParams({ enablejsapi: "1" });
    if (this._origin) q.set("origin", this._origin);
    if (autoplay) q.set("autoplay", "1");
    if (p.startSeconds !== null) q.set("start", p.startSeconds);

    if (p.videoIds?.length) {
      q.set("playlist", p.videoIds.join(","));
      if (index !== null) q.set("index", index); // 0-based on embeds
      return `https://www.youtube.com/embed/videoseries?${q}`;
    }
    if (p.playlistId) q.set("list", p.playlistId);
    if (p.playlistId && (index !== null || !p.videoId)) {
      if (index !== null) q.set("index", index);
      return `https://www.youtube.com/embed/videoseries?${q}`;
    }
    return `https://www.youtube.com/embed/${p.videoId}?${q}`;
  }

  async getThumbnail(p) {
    const id = p.videoId ?? p.videoIds?.[0];
    return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
  }

  async getPlaylist(p) {
    const key = p.playlistId ?? p.videoIds?.join(",");
    if (!key) return [];
    const cached = this._store?.get(`yt:${key}`);
    if (cached) return cached;

    let ids = p.videoIds ?? [];
    try {
      if (!this._apiKey)
        throw new Error("no apiKey (needed for list= playlists and titles)");
      if (p.playlistId) ids = await this._playlistIds(p.playlistId);
      const items = (await this._videos(ids)).map((v, i) =>
        item(v.id, i, v.title, v.channelTitle, v.thumbnailUrl)
      );
      if (items.length) this._store?.set(`yt:${key}`, items, DAY);
      return items;
    } catch (error) {
      console.warn("[YouTubeProvider]", error.message);
      return ids.map((id, i) =>
        item(id, i, "", "", `https://img.youtube.com/vi/${id}/mqdefault.jpg`)
      );
    }
  }

  async _json(path, params) {
    const q = new URLSearchParams({ ...params, key: this._apiKey });
    const res = await this._fetch(
      `https://www.googleapis.com/youtube/v3/${path}?${q}`
    );
    if (!res.ok) throw new Error(`YouTube API ${res.status}`);
    return res.json();
  }

  async _playlistIds(playlistId) {
    const ids = [];
    let pageToken = "";
    do {
      const d = await this._json("playlistItems", {
        part: "contentDetails",
        maxResults: "50",
        playlistId,
        ...(pageToken && { pageToken })
      });
      d.items?.forEach(
        (i) => i.contentDetails?.videoId && ids.push(i.contentDetails.videoId)
      );
      pageToken = d.nextPageToken ?? "";
    } while (pageToken);
    return ids;
  }

  async _videos(ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += 50) {
      const d = await this._json("videos", {
        part: "snippet,status",
        id: ids.slice(i, i + 50).join(",")
      });
      for (const v of d.items ?? []) {
        if (v.status?.privacyStatus === "private") continue;
        out.push({
          id: v.id,
          title: v.snippet.title,
          channelTitle: v.snippet.channelTitle || "",
          thumbnailUrl:
            v.snippet.thumbnails?.medium?.url ||
            v.snippet.thumbnails?.default?.url ||
            ""
        });
      }
    }
    return out;
  }

  /** postMessage API. onItemChange fires for changes made by the player itself (next video...). */
  createController(iframe, { index = null, onItemChange = () => {} } = {}) {
    const post = (m) =>
      iframe.contentWindow?.postMessage(JSON.stringify(m), "*");
    let synced = index === null; // nothing to force without an expected index
    const onLoad = () => post({ event: "listening" });
    const onMessage = (e) => {
      if (!YT_ORIGINS.includes(e.origin) || e.source !== iframe.contentWindow)
        return;
      let d;
      try {
        d = JSON.parse(e.data);
      } catch {
        return;
      }
      if (
        d.event !== "infoDelivery" ||
        d.info?.playerState !== 1 ||
        !Number.isInteger(d.info.playlistIndex)
      )
        return;
      // YouTube sometimes starts on the first video: force the expected one once
      if (!synced) {
        synced = true;
        if (d.info.playlistIndex !== index) return controller.playAt(index);
      }
      onItemChange(d.info.playlistIndex);
    };
    const controller = {
      playAt: (i) => post({ event: "command", func: "playVideoAt", args: [i] }),
      dispose() {
        globalThis.removeEventListener("message", onMessage);
        iframe.removeEventListener("load", onLoad);
      }
    };
    globalThis.addEventListener("message", onMessage);
    iframe.addEventListener("load", onLoad);
    return controller;
  }
}

export class DailymotionProvider {
  id = "dailymotion";
  name = "Dailymotion";
  label = "Dailymotion player";
  panel = null; // no item list without the Dailymotion API

  /**
   * playerId: Player ID from Dailymotion Studio (required by current embeds).
   * A Player ID found in the url itself (geo.dailymotion.com/player/ID.html) wins.
   * Without any, the legacy /embed/ url is used (no longer guaranteed to work).
   */
  constructor({ playerId = null } = {}) {
    this._playerId = playerId;
  }

  canHandle(url) {
    try {
      const u = new URL(url);
      const h = hostOf(u);
      if (h === "geo.dailymotion.com")
        return (
          /^\/player\/[^/]+\.(?:html|js)$/.test(u.pathname) &&
          (u.searchParams.has("video") || u.searchParams.has("playlist"))
        );
      return (
        h === "dailymotion.com" &&
        (u.pathname.startsWith("/video/") ||
          u.pathname.startsWith("/playlist/"))
      );
    } catch {
      return false;
    }
  }

  parse(url) {
    const u = new URL(url);

    // Existing embed: https://geo.dailymotion.com/player/{playerId}.html?video=…&playlist=…
    const geo = /^\/player\/([^/]+)\.(?:html|js)$/.exec(u.pathname);
    if (hostOf(u) === "geo.dailymotion.com" && geo) {
      const video = u.searchParams.get("video");
      const playlistId = u.searchParams.get("playlist");
      return {
        type: video ? "video" : "playlist",
        id: video ?? playlistId,
        playlistId,
        playerId: geo[1],
        initialIndex: null
      };
    }

    const video = u.pathname.match(/^\/video\/([^/]+)/);
    const playlist = u.pathname.match(/^\/playlist\/([^/]+)/);
    return {
      type: video ? "video" : "playlist",
      id: (video ?? playlist)[1],
      playlistId: playlist?.[1] ?? u.searchParams.get("playlist"),
      playerId: null,
      initialIndex: null
    };
  }

  buildEmbedSrc(p, { autoplay = false } = {}) {
    const playerId = p.playerId ?? this._playerId;

    if (playerId) {
      const q = new URLSearchParams();
      if (p.type === "video") q.set("video", p.id);
      if (p.playlistId) q.set("playlist", p.playlistId);
      if (autoplay) q.set("autoplay", "true"); // runtime parameter: check the Web SDK reference
      return `https://geo.dailymotion.com/player/${playerId}.html?${q}`;
    }

    // Legacy fallback: may stop working, set `dailymotionPlayerId` instead
    const kind = p.type === "playlist" ? "playlist" : "video";
    return `https://www.dailymotion.com/embed/${kind}/${p.id}${
      autoplay ? "?autoplay=1" : ""
    }`;
  }

  async getThumbnail(p) {
    return p.type === "video"
      ? `https://www.dailymotion.com/thumbnail/video/${p.id}`
      : null;
  }
  async getPlaylist() {
    return [];
  }
  createController() {
    return noopController;
  }
}

export class OkruProvider {
  id = "okru";
  name = "Ok.ru";
  label = "Ok.ru player";
  panel = { toggle: "top-right", open: true };

  constructor({
    embedBaseUrl = "https://ok.ru/videoembed/",
    fetchFn = (...a) => fetch(...a)
  } = {}) {
    this._base = embedBaseUrl;
    this._fetch = fetchFn;
  }

  canHandle(url) {
    try {
      const u = new URL(url);
      return hostOf(u) === "ok.ru" && u.pathname.startsWith("/video/");
    } catch {
      return false;
    }
  }

  /** itemIds: ordered ids (the url's id is prepended when absent); labels: aligned with itemIds. */
  parse(url) {
    const u = new URL(url);
    const videoId = u.pathname.match(/^\/video\/([^/]+)/)[1];
    const listed = (u.searchParams.get("video_ids") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const itemIds = !listed.length
      ? [videoId]
      : listed.includes(videoId)
      ? listed
      : [videoId, ...listed];

    // Raw match on purpose: titles contain encoded commas, so split BEFORE decoding
    const raw = u.search.match(/[?&]labels=([^&]*)/)?.[1];
    const names = raw
      ? raw
          .split(",")
          .map((s) => safeDecode(s.trim()))
          .filter(Boolean)
      : [];
    const offset = itemIds.length - listed.length;
    const labels =
      offset > 0 && listed.length
        ? [...Array(offset).fill(""), ...names]
        : names;

    return {
      videoId,
      itemIds,
      labels,
      initialIndex:
        intParam(u, "index") ?? Math.max(itemIds.indexOf(videoId), 0)
    };
  }

  buildEmbedSrc(p, { autoplay = false, index = null } = {}) {
    const id = index === null ? p.videoId : p.itemIds[index] ?? p.videoId;
    return `${this._base}${id}${
      autoplay ? (this._base.includes("?") ? "&" : "?") + "autoplay=1" : ""
    }`;
  }

  async getThumbnail(p) {
    try {
      const res = await this._fetch(
        `https://ok.ru/oembed?url=${encodeURIComponent(
          `https://ok.ru/video/${p.videoId}`
        )}&format=json`
      );
      return res.ok ? (await res.json()).thumbnail_url ?? null : null;
    } catch {
      return null;
    }
  }

  async getPlaylist(p) {
    return p.itemIds.length < 2
      ? []
      : p.itemIds.map((id, i) => item(id, i, p.labels[i]));
  }

  /** No player API on Ok.ru: changing video means reloading the iframe. */
  createController(iframe, { parsed }) {
    return {
      playAt: (i, { autoplay = true } = {}) => {
        iframe.src = this.buildEmbedSrc(parsed, { autoplay, index: i });
      },
      dispose() {}
    };
  }
}

export class UnsupportedUrlError extends Error {
  constructor(url) {
    super(`No provider can handle this URL: ${url}`);
    this.name = "UnsupportedUrlError";
  }
}

export class ProviderRegistry {
  constructor(providers = []) {
    this._providers = [...providers];
  }
  register(provider) {
    this._providers.push(provider);
    return this;
  }
  resolve(url) {
    const provider = this._providers.find((p) => p.canHandle(url));
    if (!provider) throw new UnsupportedUrlError(url);
    return provider;
  }
}

/* ───────────────────────── navigation (no DOM) ───────────────────────── */

/**
 * History of one region, with a cursor: back / forward like a browser.
 * Entries: { key, url, index, info }. `info` (LinkInfo) is memory only, never saved.
 */
export class NavigationJournal {
  #entries = [];
  #cursor = -1;

  get current() {
    return this.#entries[this.#cursor] ?? null;
  }
  get canGoBack() {
    return this.#cursor > 0;
  }
  get canGoForward() {
    return this.#cursor < this.#entries.length - 1;
  }
  get size() {
    return this.#entries.length;
  }

  push(entry) {
    this.#entries.splice(this.#cursor + 1); // a new navigation drops the "forward" part
    this.#entries.push(entry);
    this.#cursor = this.#entries.length - 1;
  }
  /** Updates the current entry (e.g. the episode changed) without creating history. */
  replaceCurrent(patch) {
    if (!this.current) return this.push(patch);
    this.#entries[this.#cursor] = { ...this.current, ...patch };
  }
  back() {
    return this.canGoBack ? this.#entries[--this.#cursor] : null;
  }
  forward() {
    return this.canGoForward ? this.#entries[++this.#cursor] : null;
  }
  clear() {
    this.#entries = [];
    this.#cursor = -1;
  }
}

/** Orchestrates one region: provider → iframe → panel → journal. The view is injected. */
export class NavigationService {
  #token = 0; // invalidates a navigation superseded by a newer one
  #controller = null;
  #index = null;
  #visible = false;

  /** view: { showEmbed(src, title) → iframe, showPanel(opts), setActive(i), clear() } */
  constructor({
    registry,
    view,
    journal = new NavigationJournal(),
    panel = true,
    onChange = () => {},
    onHide = () => {}
  }) {
    this._registry = registry;
    this._view = view;
    this._panel = panel;
    this._onChange = onChange;
    this.journal = journal;
    this._onHide = onHide;
  }

  get current() {
    return this.journal.current;
  }

  get isOpen() {
    return this.#visible;
  }

  /** @throws UnsupportedUrlError. index (0-based) wins over data-index, which wins over the url's index. */
  async navigate(info, { autoplay = false, index = null, push = true } = {}) {
    const provider = this._registry.resolve(info.url);
    const parsed = provider.parse(info.url);
    const token = ++this.#token;
    const itemsPromise = provider.getPlaylist(parsed); // started now, awaited only for the panel
    const start = index ?? info.startIndex ?? parsed.initialIndex ?? null;

    this.#controller?.dispose();
    const iframe = this._view.showEmbed(
      provider.buildEmbedSrc(parsed, { autoplay, index: start }),
      provider.label
    );
    this.#controller = provider.createController(iframe, {
      parsed,
      index: start,
      onItemChange: (i) => this.#setIndex(i)
    });
    this.#index = start;

    this.#visible = true;
    const entry = { key: info.key, url: info.url, index: start, info };
    push ? this.journal.push(entry) : this.journal.replaceCurrent(entry);
    this._onChange(this.journal.current);

    // data-panel="false" on the link disables the panel for this link only
    if (
      !this._panel ||
      !provider.panel ||
      info.link?.dataset?.panel === "false"
    )
      return;
    const items = await itemsPromise;
    if (token !== this.#token || items.length === 0) return;
    this._view.showPanel({
      items,
      index: this.#index ?? 0,
      cfg: provider.panel,
      seasonCounts: info.seasonCounts,
      onSelect: (i) => this.select(i)
    });
  }

  /** User picked an item in the panel. */
  select(index) {
    if (index === this.#index) return;
    this.#controller?.playAt(index, { autoplay: true });
    this.#setIndex(index);
  }

  goBack() {
    return this.#go(this.journal.back());
  }
  goForward() {
    return this.#go(this.journal.forward());
  }

  /** Hides the player and panel but keeps the journal and the current episode. */
  hide() {
    this.#token++; // a late playlist must not reopen the panel
    this.#controller?.dispose();
    this.#controller = null;
    this.#visible = false;
    this._view.clear();
    this._onHide(this.journal.current);
  }

  show({ autoplay = false } = {}) {
    const e = this.journal.current;
    return e
      ? this.navigate(e.info, { index: e.index, autoplay, push: false })
      : null;
  }

  close() {
    this.#token++;
    this.#controller?.dispose();
    this.#controller = null;
    this.#index = null;
    this.#visible = false;
    this._view.clear();
    this.journal.clear();
    this._onChange(null);
  }

  #go(entry) {
    return entry
      ? this.navigate(entry.info, {
          index: entry.index,
          autoplay: true,
          push: false
        })
      : null;
  }

  #setIndex(i) {
    if (i === this.#index) return;
    this.#index = i;
    this._view.setActive(i);
    this.journal.replaceCurrent({ index: i });
    this._onChange(this.journal.current);
  }
}

/* ───────────────────────── views (the only DOM code) ───────────────────────── */

const CSS = `
.lp-host{position:relative}
.lp-frame{position:absolute;inset:0;width:100%;height:100%;border:0}
.lp-panel{--b:var(--lp-bg,#141414);--l:var(--lp-border,#2a2a2a);--h:var(--lp-hover,#1e1e1e);--t:var(--lp-text,#9a9a9a);--ta:var(--lp-text-active,#f0f0f0);--n:var(--lp-muted,#555);--a:var(--lp-accent,#f7931e);position:absolute;inset:0 0 0 auto;z-index:999;width:var(--lp-w,176px);max-width:70%;display:flex;flex-direction:column;overflow:hidden auto;overscroll-behavior:contain;scroll-behavior:auto;scrollbar-width:thin;background:var(--b);border-left:1px solid var(--l);font:12px var(--lp-font,system-ui,sans-serif);transition:transform .2s}
.lp-panel.lp-closed{transform:translateX(100%);visibility:hidden}
[data-lp-theme=light] .lp-panel{--b:var(--lp-bg,#fff);--l:var(--lp-border,#e2e2e2);--h:var(--lp-hover,#f3f3f3);--t:var(--lp-text,#555);--ta:var(--lp-text-active,#111);--n:var(--lp-muted,#b0b0b0)}
.lp-head{position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;align-items:center;padding:8px 8px 7px 12px;background:var(--b);color:var(--n);font-size:10px;letter-spacing:.12em;text-transform:uppercase}
.lp-close{width:26px;height:26px;padding:0;cursor:pointer;border-radius:5px;border:1px solid color-mix(in srgb,var(--a) 35%,transparent);background:color-mix(in srgb,var(--a) 8%,transparent);color:var(--a)}
.lp-item{position:relative;display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--l);cursor:pointer;user-select:none}
.lp-item:hover,.lp-item.lp-active{background:var(--h)}
.lp-item.lp-active::before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:var(--a)}
.lp-item:focus-visible{outline:2px solid var(--a);outline-offset:-2px}
.lp-num{min-width:18px;font-size:11px;color:var(--n)}
.lp-active .lp-num{color:var(--a)}
.lp-info{flex:1;min-width:0}
.lp-title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;line-height:1.3;color:var(--t)}
.lp-active .lp-title{color:var(--ta);font-weight:500}
.lp-chan{margin-top:2px;font-size:10px;color:var(--n)}
.lp-thumb{position:relative;width:80px;height:45px;flex-shrink:0;border-radius:3px;overflow:hidden;background:#1a1a1a}
.lp-thumb img{display:block;width:100%;height:100%;object-fit:cover}
.lp-tn{position:absolute;right:3px;bottom:2px;padding:1px 4px;border-radius:2px;background:rgba(0,0,0,.7);color:#fff;font-size:9px}
.lp-sh{padding:8px 12px;background:var(--h);border-bottom:1px solid var(--l);color:var(--t);font-size:11px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;user-select:none}
.lp-collapsed .lp-item{display:none}
.lp-toggle{position:absolute;z-index:9999;width:36px;height:36px;padding:0;border:0;border-radius:50%;background:var(--lp-toggle-bg,rgba(0,0,0,.55));color:var(--lp-toggle-color,#fff);font-size:18px;cursor:pointer;opacity:0;transition:opacity .15s}
.lp-toggle[hidden],.lp-resize[hidden]{display:none}
.lp-toggle[data-pos=top-right]{top:8px;right:60px}
.lp-toggle[data-pos=bottom-left]{left:140px;bottom:20px}
.lp-host:hover .lp-toggle,.lp-toggle:focus-visible{opacity:1}
@media(hover:none){.lp-toggle{opacity:1}}
.lp-resize{position:absolute;top:0;bottom:0;z-index:1000;width:10px;cursor:col-resize;touch-action:none;right:calc(min(var(--lp-w,176px),70%) - 5px)}
.lp-resize::after{content:"";position:absolute;inset:0 auto 0 4px;width:2px;background:var(--lp-accent,#f7931e);opacity:0;transition:opacity .15s}
.lp-resize:hover::after,.lp-resize:focus-visible::after,.lp-resizing .lp-resize::after{opacity:.8}
.lp-resize:focus-visible{outline:none}
.lp-resizing{user-select:none;cursor:col-resize}
.lp-resizing iframe{pointer-events:none}
.lp-tip{position:fixed;z-index:99999;display:none;width:280px;height:158px;border-radius:8px;overflow:hidden;pointer-events:none;background:var(--lp-tip-bg,#1a1a1a);box-shadow:0 8px 24px rgba(0,0,0,.55);opacity:0;transform:translateY(4px);transition:opacity .15s ease,transform .15s ease}
.lp-tip.lp-show{opacity:1;transform:none}
.lp-tip[data-provider=youtube]{--fa:#4d1414;--fb:#141414}
.lp-tip[data-provider=dailymotion]{--fa:#123a63;--fb:#101820}
.lp-tip[data-provider=okru]{--fa:#5a3508;--fb:#181108}
.lp-tip::after{content:"";position:absolute;inset:auto 0 0;height:60px;background:linear-gradient(transparent,rgba(0,0,0,.7));pointer-events:none}
.lp-tip img,.lp-tip-loader{display:block;width:100%;height:100%}
.lp-tip img{object-fit:cover}
.lp-tip img[hidden],.lp-tip-loader[hidden]{display:none}
.lp-tip-loader{background:linear-gradient(90deg,transparent,#2a2a2a 50%,transparent) 0 0/200% 100% #111;animation:lp-shimmer 1.2s infinite}
@keyframes lp-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}
.lp-tip-play{position:absolute;top:50%;left:50%;width:68px;height:48px;transform:translate(-50%,-50%);border-radius:12px;background:rgba(0,0,0,.8)}
.lp-tip-play::after{content:"";position:absolute;top:50%;left:55%;transform:translate(-50%,-50%);border:solid transparent;border-width:12px 0 12px 20px;border-left-color:#fff}
.lp-tip-title{position:absolute;left:12px;right:12px;bottom:12px;z-index:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#fff;font:500 14px var(--lp-font,system-ui,sans-serif);text-shadow:1px 1px 2px rgba(0,0,0,.5)}
.lp-tip.lp-nothumb{background:linear-gradient(135deg,var(--fa,#2f2f2f),var(--fb,#141414))}
.lp-tip.lp-nothumb::before{content:attr(data-name);position:absolute;top:10px;left:12px;font:600 10px var(--lp-font,system-ui,sans-serif);letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.55)}
.lp-tip.lp-nothumb::after{display:none}
.lp-tip.lp-nothumb .lp-tip-play{top:42%}
.lp-tip.lp-nothumb .lp-tip-title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:normal;line-height:1.3}
`;

function injectStyles() {
  if (document.getElementById("lp-styles")) return;
  const s = el("style");
  s.id = "lp-styles";
  s.textContent = CSS;
  document.head.appendChild(s);
}

/** One region's DOM: iframe + playlist panel (toggle button, items, seasons, resize handle). */
export class RegionView {
  /** widths: { get, set, clear } for the saved panel width (or null) */
  constructor({ container, widths = null, resizable = true }) {
    injectStyles();
    this._c = container;
    this._c.classList.add("lp-host");
    this._widths = widths;
    this._resizable = resizable;
    this._panel = null;
  }

  /** Marks an iframe already in the page: showEmbed() will reuse it instead of creating one. */
  adoptIframe(iframe) {
    this._adopted = iframe;
  }

  showEmbed(src, title) {
    if (this._adopted) {
      const f = this._adopted;
      this._adopted = null;
      this._c
        .querySelectorAll(".lp-panel,.lp-toggle,.lp-resize")
        .forEach((e) => e.remove());
      f.title ||= title;
      if (f.src !== src) f.src = src; // adds enablejsapi=1 (one reload)
      return f;
    }
    const f = el("iframe", "lp-frame");
    f.src = src;
    f.title = title;
    f.allow = "autoplay; fullscreen; picture-in-picture; web-share";
    f.allowFullscreen = true;
    f.referrerPolicy = "strict-origin-when-cross-origin";
    this._c.replaceChildren(f);
    this._panel = null;
    return f;
  }

  clear() {
    this._c.replaceChildren();
    this._panel = null;
  }

  setActive(i) {
    this._panel?.setActive(i);
  }

  showPanel({ items, index, cfg, seasonCounts, onSelect }) {
    this._c
      .querySelectorAll(".lp-panel,.lp-toggle,.lp-resize")
      .forEach((e) => e.remove());
    const c = this._c;
    const defaultWidth = items.some((i) => i.thumbnailUrl) ? 280 : 176;
    const setWidth = (w) => {
      const v = clampWidth(w, c.clientWidth || Infinity);
      c.style.setProperty("--lp-w", `${v}px`);
      return v;
    };
    let width = setWidth(this._widths?.get() ?? defaultWidth);

    const root = el("div", "lp-panel");
    const head = el("div", "lp-head");
    const toggle = el("button", "lp-toggle", "☰");
    const handle = el("div", "lp-resize");
    toggle.type = "button";
    toggle.dataset.pos = cfg?.toggle ?? "top-right";
    toggle.title = toggle.ariaLabel = "Show playlist";
    const close = el("button", "lp-close", "»");
    close.type = "button";
    close.title = close.ariaLabel = "Hide playlist";
    head.append(el("span", "", `Playlist · ${items.length}`), close);
    root.append(head);

    let fromUser = false; // true while a click/keypress inside the panel is being handled

    /** "center": put the active item in the middle. "nearest": scroll only if it is hidden. */
    const reveal = (mode) => {
      const a = root.querySelector(".lp-active");
      if (!a) return;
      const headH = head.offsetHeight; // sticky header covers the top of the viewport
      const top = a.offsetTop;
      const bottom = top + a.offsetHeight;
      let next = null;
      if (mode === "center") {
        next = top - headH - (root.clientHeight - headH - a.offsetHeight) / 2;
      } else if (top < root.scrollTop + headH) {
        next = top - headH;
      } else if (bottom > root.scrollTop + root.clientHeight) {
        next = bottom - root.clientHeight;
      }
      if (next !== null) root.scrollTop = Math.max(0, next); // not scrollIntoView: it scrolls the page
    };

    const setOpen = (open) => {
      root.classList.toggle("lp-closed", !open);
      toggle.hidden = open;
      handle.hidden = !open || !this._resizable;
      if (open) reveal("center");
    };
    toggle.onclick = () => setOpen(true);
    close.onclick = () => setOpen(false);

    const makeItem = (it) => {
      const d = el("div", "lp-item");
      d.dataset.i = it.index;
      d.title = it.title;
      d.tabIndex = 0;
      d.setAttribute("role", "button");
      const info = el("div", "lp-info");
      info.append(el("div", "lp-title", it.title)); // textContent: titles are untrusted
      if (it.channelTitle) info.append(el("div", "lp-chan", it.channelTitle));
      if (it.thumbnailUrl) {
        const t = el("div", "lp-thumb");
        const img = new Image();
        img.src = it.thumbnailUrl;
        img.alt = "";
        img.loading = "lazy";
        t.append(img, el("span", "lp-tn", String(it.index + 1)));
        d.append(t, info);
      } else {
        d.append(
          el("span", "lp-num", String(it.index + 1).padStart(2, "0")),
          info
        );
      }

      const pick = (i) => {
        fromUser = true;
        try {
          onSelect(i); // setActive() runs synchronously inside
        } finally {
          fromUser = false;
        }
      };
      d.onclick = () => pick(it.index);
      d.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          pick(it.index);
        }
      };

      return d;
    };

    const groups = groupBySeason(items, seasonCounts);
    if (!groups) items.forEach((it) => root.append(makeItem(it)));
    else
      groups.forEach((g) => {
        const sec = el("div", "lp-season");
        const sh = el("div", "lp-sh", `${g.label} (${g.end - g.start})`);
        sh.onclick = () => sec.classList.toggle("lp-collapsed");
        sec.append(sh, ...items.slice(g.start, g.end).map(makeItem));
        if (!(index >= g.start && index < g.end))
          sec.classList.add("lp-collapsed");
        root.append(sec);
      });

    // resize: drag, double-click to reset, arrows
    let drag = null;
    handle.tabIndex = 0;
    handle.title = "Drag to resize (double-click to reset)";
    handle.setAttribute("role", "separator");
    handle.onpointerdown = (e) => {
      if (e.button) return;
      drag = { x: e.clientX, w: root.getBoundingClientRect().width };
      handle.setPointerCapture(e.pointerId);
      c.classList.add("lp-resizing");
      e.preventDefault();
    };
    handle.onpointermove = (e) => {
      if (drag) width = setWidth(drag.w + drag.x - e.clientX);
    }; // panel is on the right
    handle.onpointerup = handle.onpointercancel = () => {
      if (!drag) return;
      drag = null;
      c.classList.remove("lp-resizing");
      this._widths?.set(width);
    };
    handle.ondblclick = () => {
      width = setWidth(defaultWidth);
      this._widths?.clear();
    };
    handle.onkeydown = (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      width = setWidth(
        root.getBoundingClientRect().width + (e.key === "ArrowLeft" ? 16 : -16)
      );
      this._widths?.set(width);
    };

    c.append(root, toggle, handle);
    this._panel = {
      setActive: (i, mode = "nearest") => {
        root
          .querySelectorAll(".lp-item")
          .forEach((n) => n.classList.toggle("lp-active", +n.dataset.i === i));
        root
          .querySelector(".lp-active")
          ?.closest(".lp-season")
          ?.classList.remove("lp-collapsed"); // expand before measuring
        if (!fromUser) reveal(mode);
      }
    };
    setOpen(cfg?.open ?? false);
    this._panel.setActive(index, "center"); // initial display: centered
  }
}

/** Thumbnail tooltip on hover (not on touch devices). One shared element. */
export class Tooltip {
  constructor() {
    this._token = 0; // ignores a thumbnail that arrives after another link took over
    this._el = null;
    this._timer = null;
    this._hideTimer = null;
    this._last = null;
    // A click or tap anywhere closes it (mouseleave is unreliable on hybrid devices)
    document.addEventListener(
      "pointerdown",
      () => {
        clearTimeout(this._timer);
        this._hide();
      },
      true
    );
  }

  /** provider: { id, name } of the link's provider, used for the fallback look. */
  attach(target, getThumb, title, provider = {}) {
    target.addEventListener("mouseenter", (e) => {
      this._last = e;
      this._timer = setTimeout(
        () => this._show(getThumb, title, provider),
        120
      );
    });
    target.addEventListener("mousemove", (e) => this._move(e));
    target.addEventListener("mouseleave", () => {
      clearTimeout(this._timer);
      this._hide();
    });
  }

  _build() {
    const tip = el("div", "lp-tip");
    const img = new Image();
    img.alt = "";
    tip.append(
      el("div", "lp-tip-loader"),
      img,
      el("div", "lp-tip-play"),
      el("span", "lp-tip-title")
    );
    document.body.append(tip);
    return (this._el = tip);
  }

  async _show(getThumb, title, provider) {
    injectStyles();
    clearTimeout(this._hideTimer);
    const token = ++this._token;
    const tip = this._el ?? this._build();
    const [loader, img] = tip.children;

    tip.dataset.provider = provider.id ?? "";
    tip.dataset.name = provider.name ?? "";
    tip.classList.remove("lp-nothumb");
    tip.lastChild.textContent = title;
    loader.hidden = false;
    img.hidden = true;
    img.removeAttribute("src");
    tip.style.display = "block";
    this._move(this._last);
    requestAnimationFrame(() => {
      if (token === this._token) tip.classList.add("lp-show");
    });

    const fallback = () => {
      loader.hidden = true;
      tip.classList.add("lp-nothumb");
    };
    const url = await Promise.race([
      getThumb(),
      new Promise((r) => setTimeout(() => r(null), 3000))
    ]);
    if (token !== this._token) return;
    if (!url) return fallback();

    const probe = new Image();
    probe.onload = () => {
      if (token !== this._token) return;
      // YouTube serves a grey 120x90 image when the video no longer exists
      if (provider.id === "youtube" && probe.naturalWidth <= 120)
        return fallback();
      loader.hidden = true;
      img.src = url;
      img.hidden = false;
    };
    probe.onerror = () => {
      if (token === this._token) fallback();
    };
    probe.src = url;
  }

  _move(e) {
    if (!this._el || !e) return;
    const m = 14;
    const { offsetWidth: w, offsetHeight: h } = this._el;
    this._el.style.left = `${
      e.clientX + m + w > innerWidth ? e.clientX - w - m : e.clientX + m
    }px`;
    this._el.style.top = `${
      e.clientY + m + h > innerHeight ? e.clientY - h - m : e.clientY + m
    }px`;
  }

  _hide() {
    this._token++;
    if (!this._el) return;
    this._el.classList.remove("lp-show");
    clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => {
      this._el.style.display = "none";
    }, 150);
  }
}

/* ───────────────────────── composition ───────────────────────── */

/** A zone (data-target): its links and its navigation service (which owns the journal). */
export class PlayerRegion {
  constructor({ target, registry, view, panel, onChange, onHide }) {
    this.target = target;
    this.view = view;
    this.links = [];
    this.navigationService = new NavigationService({
      registry,
      view,
      panel,
      onChange,
      onHide
    });
  }
}

export class LinkPlayer {
  static VERSION = "2.0.5";

  /**
   * @param {Object} o
   * @param o.useStorage   save the last url + index of each region and restore it on load (default true)
   * @param o.panel        false disables every playlist panel (data-panel="false" disables one link)
   * @param o.resizable    panel resize handle + saved width
   * @param o.tooltip      thumbnail on hover
   * @param o.registry     custom ProviderRegistry (otherwise built from the options below)
   * @param o.onChange     (target, entry|null) => void
   * @param o.onError      (error, linkInfo?) => void
   */
  constructor({
    scope = document,
    scanner = new LinkScanner(),
    store = null,
    registry = null,
    useStorage = true,
    panel = true,
    resizable = true,
    tooltip = true,
    activeClass = "is-active",
    youtubeApiKey = null,
    okruEmbedBaseUrl,
    dailymotionPlayerId = null,
    onChange = () => {},
    onError = (e) => console.warn("[LinkPlayer]", e)
  } = {}) {
    this._scope = resolveScope(scope);
    this._scanner = scanner;
    this._store = store ?? (useStorage ? new JsonStore() : new MemoryStore());
    this._useStorage = useStorage;
    this._panel = panel;
    this._resizable = resizable;
    this._activeClass = activeClass;
    this._onChange = onChange;
    this._onError = onError;
    this._registry =
      registry ??
      new ProviderRegistry([
        new YouTubeProvider({ apiKey: youtubeApiKey, store }),
        new DailymotionProvider({ playerId: dailymotionPlayerId }),
        new OkruProvider({ embedBaseUrl: okruEmbedBaseUrl })
      ]);
    this._tooltip = tooltip && !isTouch() ? new Tooltip() : null;
    this._regions = new Map();
    this._bound = new WeakSet();
    this._thumbs = new Map();
    this._embedCount = 0;
    this.scan();
  }

  getRegion(target, container = document.getElementById(target)) {
    if (!this._regions.has(target)) {
      if (!container) throw new Error(`Target not found: "${target}"`);
      const widths = this._resizable
        ? {
            get: () => this._store.get("panel-width"),
            set: (w) => this._store.set("panel-width", w),
            clear: () => this._store.remove("panel-width")
          }
        : null;
      this._regions.set(
        target,
        new PlayerRegion({
          target,
          registry: this._registry,
          panel: this._panel,
          view: new RegionView({
            container,
            widths,
            resizable: this._resizable
          }),
          onChange: (entry) => this._changed(target, entry),
          onHide: () => this._hidden(target)
        })
      );
    }
    return this._regions.get(target);
  }

  /** Host of an existing iframe: its own parent when it holds only the iframe (.video-container...), otherwise a wrapper. */
  _hostFor(iframe) {
    const p = iframe.parentElement;
    if (
      p &&
      p !== this._scope &&
      p !== document.body &&
      p.children.length === 1 &&
      !p.textContent.trim()
    )
      return p; // existing styles stay untouched

    const w = +iframe.getAttribute("width") || 0;
    const h = +iframe.getAttribute("height") || 0;
    const wrap = document.createElement("div");
    wrap.style.cssText = `width:100%;${
      w ? `max-width:${w}px;` : ""
    }aspect-ratio:${w && h ? `${w}/${h}` : "16/9"}`;
    iframe.replaceWith(wrap);
    wrap.append(iframe);
    iframe.classList.add("lp-frame"); // fills the wrapper
    return wrap;
  }

  _adoptEmbeds() {
    this._scope.querySelectorAll("iframe").forEach((iframe) => {
      if (this._bound.has(iframe) || iframe.closest(".lp-host")) return;
      if (iframe.dataset.panel === "false") return;

      let url, provider;
      try {
        url = new URL(iframe.getAttribute("src") ?? "", location.href).href;
        provider = this._registry.resolve(url);
      } catch {
        return; // not an embed we know
      }
      if (!provider.panel) return; // nothing to show (Dailymotion...)

      this._bound.add(iframe);
      const target = `embed-${++this._embedCount}`;
      const region = this.getRegion(target, this._hostFor(iframe));
      region.view.adoptIframe(iframe);

      const info = {
        key: target,
        url,
        link: iframe,
        autoplay: "none",
        startIndex: null,
        seasonCounts: null
      };
      this._run(info, () =>
        region.navigationService.navigate(info, { autoplay: false })
      );
    });
  }

  scan() {
    let infos = [];
    try {
      infos = this._scanner.scan(this._scope);
    } catch (error) {
      return this._onError(error);
    }

    for (const info of infos) {
      if (this._bound.has(info.link)) continue; // already handled by a previous scan
      let region;
      try {
        if (!info.target)
          throw new Error(`data-target is required (${info.url})`);
        region = this.getRegion(info.target);
      } catch (error) {
        this._onError(error, info);
        continue;
      }
      this._bound.add(info.link);
      region.links.push(info);

      info.link.addEventListener("click", (e) => {
        e.preventDefault();
        this._click(region, info);
      });

      let provider = null;
      try {
        provider = this._registry.resolve(info.url);
      } catch {
        /* unsupported url: reported on click */
      }
      this._tooltip?.attach(
        info.link,
        () => this._thumbnail(info),
        info.link.textContent.trim(),
        { id: provider?.id, name: provider?.name }
      );
    }

    try {
      this._adoptEmbeds();
    } catch (error) {
      this._onError(error);
    }
    this._regions.forEach((region) => this._init(region));
  }

  /** Restore the saved url/index, otherwise data-show-on-init. */
  _init(region) {
    if (region.navigationService.current) return; // already started (second scan)

    // 1. storage
    const saved = this._useStorage
      ? this._store.get(`state:${region.target}`)
      : null;
    if (saved?.url) {
      const info = region.links.find((l) => l.url === saved.url) ?? {
        url: saved.url,
        key: saved.key,
        autoplay: AUTOPLAY_MODES.NONE,
        startIndex: null,
        seasonCounts: null
      };
      // Browsers block autoplay on page load: restore paused
      return this._run(info, () =>
        region.navigationService.navigate(info, {
          index: saved.index,
          autoplay: info.autoplay === AUTOPLAY_MODES.INIT
        })
      );
    }

    // 2. show on init
    const first = region.links.find((l) => l.showOnInit);
    if (first)
      this._run(first, () =>
        region.navigationService.navigate(first, {
          autoplay: first.autoplay === AUTOPLAY_MODES.INIT
        })
      );
  }

  _click(region, info) {
    const ns = region.navigationService;
    const autoplay =
      info.autoplay === AUTOPLAY_MODES.INIT ||
      info.autoplay === AUTOPLAY_MODES.CLICK;

    if (ns.current?.key === info.key)
      return ns.isOpen
        ? ns.hide()
        : this._run(info, () => ns.show({ autoplay }));

    this._run(info, () => ns.navigate(info, { autoplay }));
  }

  _changed(target, entry) {
    const links = this._regions.get(target)?.links ?? [];
    links.forEach((l) =>
      l.link.classList.toggle(this._activeClass, !!entry && l.key === entry.key)
    );
    if (this._useStorage) {
      entry
        ? this._store.set(`state:${target}`, {
            key: entry.key,
            url: entry.url,
            index: entry.index
          })
        : this._store.remove(`state:${target}`);
    }
    this._onChange(target, entry);
  }

  _hidden(target) {
    (this._regions.get(target)?.links ?? []).forEach((l) =>
      l.link.classList.remove(this._activeClass)
    );
  }

  async _thumbnail(info) {
    if (info.thumbnail) return info.thumbnail;
    if (!this._thumbs.has(info.url)) {
      this._thumbs.set(
        info.url,
        (async () => {
          try {
            const provider = this._registry.resolve(info.url);
            return await provider.getThumbnail(provider.parse(info.url));
          } catch {
            return null;
          }
        })()
      );
    }
    return this._thumbs.get(info.url);
  }

  async _run(info, fn) {
    try {
      await fn();
    } catch (error) {
      this._onError(error, info);
    }
  }
}
