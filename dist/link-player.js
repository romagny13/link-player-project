(function(global, factory) {
  typeof exports === "object" && typeof module !== "undefined" ? module.exports = factory() : typeof define === "function" && define.amd ? define(factory) : (global = typeof globalThis !== "undefined" ? globalThis : global || self, global.LinkPlayer = factory());
})(this, (function() {
  "use strict";var __defProp = Object.defineProperty;
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);
var __privateWrapper = (obj, member, setter, getter) => ({
  set _(value) {
    __privateSet(obj, member, value, setter);
  },
  get _() {
    return __privateGet(obj, member, getter);
  }
});

  var _m, _entries, _cursor, _token, _controller, _index, _count, _visible, _NavigationService_instances, step_fn, go_fn, setIndex_fn;
  function toBool(value) {
    if (value === void 0 || value === null) return false;
    const v = String(value).trim().toLowerCase();
    return v !== "false" && v !== "0";
  }
  function toIntOrNull(value) {
    if (value === void 0 || value === null) return null;
    const v = String(value).trim();
    return /^\d+$/.test(v) ? parseInt(v, 10) : null;
  }
  function toIntList(value) {
    if (value === void 0 || value === null) return null;
    const list = String(value).split(",").map(toIntOrNull).filter((n) => n !== null && n > 0);
    return list.length > 0 ? list : null;
  }
  function toStringOrNull(value) {
    if (value === void 0 || value === null) return null;
    const v = String(value).trim();
    return v === "" ? null : v;
  }
  const AUTOPLAY_MODES = Object.freeze({
    NONE: "none",
    // false
    INIT: "init",
    // true
    CLICK: "click"
    // click
  });
  function toAutoplayMode(value) {
    if (value === void 0 || value === null) return AUTOPLAY_MODES.NONE;
    const v = String(value).trim().toLowerCase();
    if (v === "" || v === "true") return AUTOPLAY_MODES.INIT;
    if (v === "click") return AUTOPLAY_MODES.CLICK;
    return AUTOPLAY_MODES.NONE;
  }
  const DATA_ATTRIBUTES = Object.freeze({
    key: "key",
    url: "url",
    // required
    target: "target",
    autoplay: "autoplay",
    showOnInit: "showOnInit",
    index: "index",
    seasons: "seasons",
    thumbnail: "thumbnail"
  });
  const LINK_SELECTOR = "[data-link]";
  class InvalidUrlError extends Error {
    constructor(message) {
      super(message);
      this.name = "InvalidUrlError";
    }
  }
  function assertValidUrl(value) {
    const text = value == null ? "" : String(value).trim();
    if (text === "") throw new InvalidUrlError("URL is missing or empty");
    try {
      new URL(text);
    } catch {
      throw new InvalidUrlError(`URL is malformed: "${text}"`);
    }
    return text;
  }
  const MAX_QUERY = 48;
  function shortHash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }
  function keyFromUrl(url) {
    const u = new URL(assertValidUrl(url));
    const query = [...u.searchParams].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join("&");
    const base = `${u.hostname.replace(/^www\./, "")}${u.pathname}`;
    if (!query) return base;
    return `${base}?${query.length > MAX_QUERY ? `#${shortHash(query)}` : query}`;
  }
  function readRawLink(link) {
    var _a;
    const d = link.dataset ?? {};
    return {
      key: d[DATA_ATTRIBUTES.key],
      dataUrl: d[DATA_ATTRIBUTES.url],
      href: ((_a = link.getAttribute) == null ? void 0 : _a.call(link, "href")) ?? void 0,
      target: d[DATA_ATTRIBUTES.target],
      autoplay: d[DATA_ATTRIBUTES.autoplay],
      showOnInit: d[DATA_ATTRIBUTES.showOnInit],
      index: d[DATA_ATTRIBUTES.index],
      seasons: d[DATA_ATTRIBUTES.seasons],
      thumbnail: d[DATA_ATTRIBUTES.thumbnail]
    };
  }
  function parseLink(raw) {
    const url = assertValidUrl(
      toStringOrNull(raw.dataUrl) ?? toStringOrNull(raw.href)
    );
    return Object.freeze({
      url,
      key: toStringOrNull(raw.key) ?? keyFromUrl(url),
      target: toStringOrNull(raw.target),
      autoplay: toAutoplayMode(raw.autoplay),
      showOnInit: toBool(raw.showOnInit),
      startIndex: toIntOrNull(raw.index),
      seasonCounts: toIntList(raw.seasons),
      thumbnail: toStringOrNull(raw.thumbnail)
    });
  }
  class LinkScanner {
    findLinks(scope) {
      return scope.querySelectorAll(LINK_SELECTOR);
    }
    scan(scope = document) {
      return Array.from(this.findLinks(scope)).map(
        (link) => Object.freeze({ ...parseLink(readRawLink(link)), link })
      );
    }
  }
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== void 0) e.textContent = text;
    return e;
  };
  const isTouch = () => {
    var _a;
    return !!((_a = globalThis.matchMedia) == null ? void 0 : _a.call(globalThis, "(hover: none) and (pointer: coarse)").matches);
  };
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
  const DAY = 24 * 60 * 60 * 1e3;
  function resolveScope(scope) {
    if (scope instanceof HTMLElement) return scope;
    if (typeof scope === "string")
      return document.querySelector(scope) || document.documentElement;
    return document.documentElement;
  }
  const clampWidth = (px, hostWidth) => Math.min(
    Math.max(Math.round(px), 140),
    Math.max(140, Math.floor(hostWidth * 0.7))
  );
  class MemoryStore {
    constructor() {
      __privateAdd(this, _m, /* @__PURE__ */ new Map());
    }
    get(key) {
      const e = __privateGet(this, _m).get(key);
      if (!e) return null;
      if (e.expiresAt && Date.now() > e.expiresAt) {
        __privateGet(this, _m).delete(key);
        return null;
      }
      return e.data ?? null;
    }
    set(key, data, ttlMs) {
      __privateGet(this, _m).set(key, { data, expiresAt: ttlMs ? Date.now() + ttlMs : null });
    }
    remove(key) {
      __privateGet(this, _m).delete(key);
    }
  }
  _m = new WeakMap();
  class JsonStore {
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
      }
    }
    remove(key) {
      try {
        this._s.removeItem(this._p + key);
      } catch {
      }
    }
  }
  const SEASON_RE = /\b(?:saison|season)\s*0*(\d{1,3})\b|\bs0*(\d{1,2})(?:\b|(?=e\d))/i;
  function groupBySeason(items, counts = null) {
    const n = items.length;
    if (counts == null ? void 0 : counts.length) {
      const groups2 = [];
      let start = 0;
      counts.forEach((c, i) => {
        if (start < n) {
          groups2.push({
            label: `Season ${i + 1}`,
            start,
            end: Math.min(start + c, n)
          });
          start += c;
        }
      });
      if (start < n) groups2.push({ label: "Other", start, end: n });
      return groups2.length > 1 ? groups2 : null;
    }
    const seasons = items.map((it) => {
      const m = SEASON_RE.exec(it.title);
      return m ? +(m[1] || m[2]) : null;
    });
    const first = seasons.find((s) => s !== null);
    if (first === void 0) return null;
    let cur = first > 1 ? 1 : null;
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
  const noopController = { playAt() {
  }, dispose() {
  } };
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
  class YouTubeProvider {
    constructor({
      apiKey = null,
      store = null,
      fetchFn = (...a) => fetch(...a),
      origin = ((_a) => (_a = globalThis.location) == null ? void 0 : _a.origin)() ?? ""
    } = {}) {
      __publicField(this, "id", "youtube");
      __publicField(this, "name", "YouTube");
      __publicField(this, "label", "YouTube player");
      __publicField(this, "panel", { toggle: "bottom-left", open: false });
      this._apiKey = apiKey;
      this._store = store;
      this._fetch = fetchFn;
      this._origin = origin;
    }
    canHandle(url) {
      try {
        const u = new URL(url);
        const h = hostOf(u);
        if ((h === "youtube.com" || h === "youtube-nocookie.com") && /^\/embed(\/|$)/.test(u.pathname))
          return true;
        if (h === "youtube.com") {
          return u.pathname === "/watch" && u.searchParams.has("v") || u.pathname === "/watch_videos" && u.searchParams.has("video_ids");
        }
        return h === "youtu.be" && u.pathname.length > 1;
      } catch {
        return false;
      }
    }
    parse(url) {
      const u = new URL(url);
      const emb = /^\/embed(?:\/([^/]+))?\/?$/.exec(u.pathname);
      const pathId = (emb == null ? void 0 : emb[1]) && emb[1] !== "videoseries" ? emb[1] : null;
      const ids = u.searchParams.get(emb ? "playlist" : "video_ids");
      const videoIds = ids ? ids.split(",").map((s) => s.trim()).filter(Boolean) : null;
      if (pathId && videoIds && !videoIds.includes(pathId))
        videoIds.unshift(pathId);
      const urlIndex = intParam(u, "index");
      return {
        videoId: emb ? pathId : hostOf(u) === "youtu.be" ? u.pathname.slice(1) : u.searchParams.get("v"),
        playlistId: u.searchParams.get("list"),
        videoIds,
        startSeconds: intParam(u, "start") ?? intParam(u, "t"),
        // embed: index is 0-based, watch: 1-based
        initialIndex: urlIndex === null ? null : emb ? urlIndex : Math.max(urlIndex - 1, 0)
      };
    }
    buildEmbedSrc(p, { autoplay = false, index = null } = {}) {
      var _a;
      const q = new URLSearchParams({ enablejsapi: "1" });
      if (this._origin) q.set("origin", this._origin);
      if (autoplay) q.set("autoplay", "1");
      if (p.startSeconds !== null) q.set("start", p.startSeconds);
      if ((_a = p.videoIds) == null ? void 0 : _a.length) {
        q.set("playlist", p.videoIds.join(","));
        if (index !== null) q.set("index", index);
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
      var _a;
      const id = p.videoId ?? ((_a = p.videoIds) == null ? void 0 : _a[0]);
      return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
    }
    async getPlaylist(p) {
      var _a, _b, _c;
      const key = p.playlistId ?? ((_a = p.videoIds) == null ? void 0 : _a.join(","));
      if (!key) return [];
      const cached = (_b = this._store) == null ? void 0 : _b.get(`yt:${key}`);
      if (cached) return cached;
      let ids = p.videoIds ?? [];
      try {
        if (!this._apiKey)
          throw new Error("no apiKey (needed for list= playlists and titles)");
        if (p.playlistId) ids = await this._playlistIds(p.playlistId);
        const items = (await this._videos(ids)).map(
          (v, i) => item(v.id, i, v.title, v.channelTitle, v.thumbnailUrl)
        );
        if (items.length) (_c = this._store) == null ? void 0 : _c.set(`yt:${key}`, items, DAY);
        return items;
      } catch (error) {
        console.warn("[YouTubeProvider]", error.message);
        return ids.map(
          (id, i) => item(id, i, "", "", `https://img.youtube.com/vi/${id}/mqdefault.jpg`)
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
      var _a;
      const ids = [];
      let pageToken = "";
      do {
        const d = await this._json("playlistItems", {
          part: "contentDetails",
          maxResults: "50",
          playlistId,
          ...pageToken && { pageToken }
        });
        (_a = d.items) == null ? void 0 : _a.forEach(
          (i) => {
            var _a2;
            return ((_a2 = i.contentDetails) == null ? void 0 : _a2.videoId) && ids.push(i.contentDetails.videoId);
          }
        );
        pageToken = d.nextPageToken ?? "";
      } while (pageToken);
      return ids;
    }
    async _videos(ids) {
      var _a, _b, _c, _d, _e;
      const out = [];
      for (let i = 0; i < ids.length; i += 50) {
        const d = await this._json("videos", {
          part: "snippet,status",
          id: ids.slice(i, i + 50).join(",")
        });
        for (const v of d.items ?? []) {
          if (((_a = v.status) == null ? void 0 : _a.privacyStatus) === "private") continue;
          out.push({
            id: v.id,
            title: v.snippet.title,
            channelTitle: v.snippet.channelTitle || "",
            thumbnailUrl: ((_c = (_b = v.snippet.thumbnails) == null ? void 0 : _b.medium) == null ? void 0 : _c.url) || ((_e = (_d = v.snippet.thumbnails) == null ? void 0 : _d.default) == null ? void 0 : _e.url) || ""
          });
        }
      }
      return out;
    }
    /** postMessage API. onItemChange fires for changes made by the player itself (next video...). */
    createController(iframe, { index = null, onItemChange = () => {
    } } = {}) {
      const post = (m) => {
        var _a;
        return (_a = iframe.contentWindow) == null ? void 0 : _a.postMessage(JSON.stringify(m), "*");
      };
      let synced = index === null;
      const onLoad = () => post({ event: "listening" });
      const onMessage = (e) => {
        var _a;
        if (!YT_ORIGINS.includes(e.origin) || e.source !== iframe.contentWindow)
          return;
        let d;
        try {
          d = JSON.parse(e.data);
        } catch {
          return;
        }
        if (d.event !== "infoDelivery" || ((_a = d.info) == null ? void 0 : _a.playerState) !== 1 || !Number.isInteger(d.info.playlistIndex))
          return;
        if (!synced) {
          synced = true;
          if (d.info.playlistIndex !== index) return controller.playAt(index);
        }
        onItemChange(d.info.playlistIndex);
      };
      const controller = {
        playAt: (i) => post({ event: "command", func: "playVideoAt", args: [i] }),
        next: () => (post({ event: "command", func: "nextVideo", args: [] }), true),
        previous: () => (post({ event: "command", func: "previousVideo", args: [] }), true),
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
  class DailymotionProvider {
    // no item list without the Dailymotion API
    /**
     * playerId: Player ID from Dailymotion Studio (required by current embeds).
     * A Player ID found in the url itself (geo.dailymotion.com/player/ID.html) wins.
     * Without any, the legacy /embed/ url is used (no longer guaranteed to work).
     */
    constructor({ playerId = null } = {}) {
      __publicField(this, "id", "dailymotion");
      __publicField(this, "name", "Dailymotion");
      __publicField(this, "label", "Dailymotion player");
      __publicField(this, "panel", null);
      this._playerId = playerId;
    }
    canHandle(url) {
      try {
        const u = new URL(url);
        const h = hostOf(u);
        if (h === "geo.dailymotion.com")
          return /^\/player\/[^/]+\.(?:html|js)$/.test(u.pathname) && (u.searchParams.has("video") || u.searchParams.has("playlist"));
        return h === "dailymotion.com" && (u.pathname.startsWith("/video/") || u.pathname.startsWith("/playlist/"));
      } catch {
        return false;
      }
    }
    parse(url) {
      const u = new URL(url);
      const geo = /^\/player\/([^/]+)\.(?:html|js)$/.exec(u.pathname);
      if (hostOf(u) === "geo.dailymotion.com" && geo) {
        const video2 = u.searchParams.get("video");
        const playlistId = u.searchParams.get("playlist");
        return {
          type: video2 ? "video" : "playlist",
          id: video2 ?? playlistId,
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
        playlistId: (playlist == null ? void 0 : playlist[1]) ?? u.searchParams.get("playlist"),
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
        if (autoplay) q.set("autoplay", "true");
        return `https://geo.dailymotion.com/player/${playerId}.html?${q}`;
      }
      const kind = p.type === "playlist" ? "playlist" : "video";
      return `https://www.dailymotion.com/embed/${kind}/${p.id}${autoplay ? "?autoplay=1" : ""}`;
    }
    async getThumbnail(p) {
      return p.type === "video" ? `https://www.dailymotion.com/thumbnail/video/${p.id}` : null;
    }
    async getPlaylist() {
      return [];
    }
    createController() {
      return noopController;
    }
  }
  class OkruProvider {
    constructor({
      embedBaseUrl = "https://ok.ru/videoembed/",
      fetchFn = (...a) => fetch(...a)
    } = {}) {
      __publicField(this, "id", "okru");
      __publicField(this, "name", "Ok.ru");
      __publicField(this, "label", "Ok.ru player");
      __publicField(this, "panel", { toggle: "top-right", open: true });
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
      var _a;
      const u = new URL(url);
      const videoId = u.pathname.match(/^\/video\/([^/]+)/)[1];
      const listed = (u.searchParams.get("video_ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const itemIds = !listed.length ? [videoId] : listed.includes(videoId) ? listed : [videoId, ...listed];
      const raw = (_a = u.search.match(/[?&]labels=([^&]*)/)) == null ? void 0 : _a[1];
      const names = raw ? raw.split(",").map((s) => safeDecode(s.trim())).filter(Boolean) : [];
      const offset = itemIds.length - listed.length;
      const labels = offset > 0 && listed.length ? [...Array(offset).fill(""), ...names] : names;
      return {
        videoId,
        itemIds,
        labels,
        initialIndex: intParam(u, "index") ?? Math.max(itemIds.indexOf(videoId), 0)
      };
    }
    buildEmbedSrc(p, { autoplay = false, index = null } = {}) {
      const id = index === null ? p.videoId : p.itemIds[index] ?? p.videoId;
      return `${this._base}${id}${autoplay ? (this._base.includes("?") ? "&" : "?") + "autoplay=1" : ""}`;
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
      return p.itemIds.length < 2 ? [] : p.itemIds.map((id, i) => item(id, i, p.labels[i]));
    }
    /** No player API on Ok.ru: changing video means reloading the iframe. */
    createController(iframe, { parsed }) {
      return {
        playAt: (i, { autoplay = true } = {}) => {
          iframe.src = this.buildEmbedSrc(parsed, { autoplay, index: i });
        },
        dispose() {
        }
      };
    }
  }
  class UnsupportedUrlError extends Error {
    constructor(url) {
      super(`No provider can handle this URL: ${url}`);
      this.name = "UnsupportedUrlError";
    }
  }
  class ProviderRegistry {
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
  class NavigationJournal {
    constructor() {
      __privateAdd(this, _entries, []);
      __privateAdd(this, _cursor, -1);
    }
    get current() {
      return __privateGet(this, _entries)[__privateGet(this, _cursor)] ?? null;
    }
    get canGoBack() {
      return __privateGet(this, _cursor) > 0;
    }
    get canGoForward() {
      return __privateGet(this, _cursor) < __privateGet(this, _entries).length - 1;
    }
    get size() {
      return __privateGet(this, _entries).length;
    }
    push(entry) {
      __privateGet(this, _entries).splice(__privateGet(this, _cursor) + 1);
      __privateGet(this, _entries).push(entry);
      __privateSet(this, _cursor, __privateGet(this, _entries).length - 1);
    }
    /** Updates the current entry (e.g. the episode changed) without creating history. */
    replaceCurrent(patch) {
      if (!this.current) return this.push(patch);
      __privateGet(this, _entries)[__privateGet(this, _cursor)] = { ...this.current, ...patch };
    }
    back() {
      return this.canGoBack ? __privateGet(this, _entries)[--__privateWrapper(this, _cursor)._] : null;
    }
    forward() {
      return this.canGoForward ? __privateGet(this, _entries)[++__privateWrapper(this, _cursor)._] : null;
    }
    clear() {
      __privateSet(this, _entries, []);
      __privateSet(this, _cursor, -1);
    }
  }
  _entries = new WeakMap();
  _cursor = new WeakMap();
  class NavigationService {
    /** view: { showEmbed(src, title) → iframe, showPanel(opts), setActive(i), clear() } */
    constructor({
      registry,
      view,
      journal = new NavigationJournal(),
      panel = true,
      onChange = () => {
      },
      onHide = () => {
      },
      onItemsLoaded = () => {
      }
    }) {
      __privateAdd(this, _NavigationService_instances);
      __privateAdd(this, _token, 0);
      // invalidates a navigation superseded by a newer one
      __privateAdd(this, _controller, null);
      __privateAdd(this, _index, null);
      __privateAdd(this, _count, 0);
      __privateAdd(this, _visible, false);
      this._registry = registry;
      this._view = view;
      this._panel = panel;
      this._onChange = onChange;
      this.journal = journal;
      this._onHide = onHide;
      this._onItemsLoaded = onItemsLoaded;
    }
    get current() {
      return this.journal.current;
    }
    get isOpen() {
      return __privateGet(this, _visible);
    }
    get hasNextItem() {
      return __privateGet(this, _visible) && __privateGet(this, _count) > 0 && (__privateGet(this, _index) ?? 0) < __privateGet(this, _count) - 1;
    }
    get hasPreviousItem() {
      return __privateGet(this, _visible) && __privateGet(this, _count) > 0 && (__privateGet(this, _index) ?? 0) > 0;
    }
    get itemIndex() {
      return __privateGet(this, _index);
    }
    get itemCount() {
      return __privateGet(this, _count);
    }
    /** @returns {boolean} false when there is nothing to go to (end of list, no playlist...). */
    nextItem() {
      return __privateMethod(this, _NavigationService_instances, step_fn).call(this, 1);
    }
    previousItem() {
      return __privateMethod(this, _NavigationService_instances, step_fn).call(this, -1);
    }
    /** @throws UnsupportedUrlError. index (0-based) wins over data-index, which wins over the url's index. */
    async navigate(info, { autoplay = false, index = null, push = true } = {}) {
      var _a, _b, _c;
      const provider = this._registry.resolve(info.url);
      const parsed = provider.parse(info.url);
      const token = ++__privateWrapper(this, _token)._;
      const itemsPromise = provider.getPlaylist(parsed);
      const start = index ?? info.startIndex ?? parsed.initialIndex ?? null;
      __privateSet(this, _count, 0);
      (_a = __privateGet(this, _controller)) == null ? void 0 : _a.dispose();
      const iframe = this._view.showEmbed(
        provider.buildEmbedSrc(parsed, { autoplay, index: start }),
        provider.label
      );
      __privateSet(this, _controller, provider.createController(iframe, {
        parsed,
        index: start,
        onItemChange: (i) => __privateMethod(this, _NavigationService_instances, setIndex_fn).call(this, i)
      }));
      __privateSet(this, _index, start);
      __privateSet(this, _visible, true);
      const entry = { key: info.key, url: info.url, index: start, info };
      push ? this.journal.push(entry) : this.journal.replaceCurrent(entry);
      this._onChange(this.journal.current);
      const items = await itemsPromise;
      if (token !== __privateGet(this, _token)) return;
      __privateSet(this, _count, items.length);
      this._onItemsLoaded(__privateGet(this, _count));
      if (!this._panel || !provider.panel || ((_c = (_b = info.link) == null ? void 0 : _b.dataset) == null ? void 0 : _c.panel) === "false" || items.length === 0)
        return;
      this._view.showPanel({
        items,
        index: __privateGet(this, _index) ?? 0,
        cfg: provider.panel,
        seasonCounts: info.seasonCounts,
        onSelect: (i) => this.select(i)
      });
    }
    /** User picked an item in the panel. */
    select(index) {
      var _a;
      if (index === __privateGet(this, _index)) return;
      (_a = __privateGet(this, _controller)) == null ? void 0 : _a.playAt(index, { autoplay: true });
      __privateMethod(this, _NavigationService_instances, setIndex_fn).call(this, index);
    }
    goBack() {
      return __privateMethod(this, _NavigationService_instances, go_fn).call(this, this.journal.back());
    }
    goForward() {
      return __privateMethod(this, _NavigationService_instances, go_fn).call(this, this.journal.forward());
    }
    /** Hides the player and panel but keeps the journal and the current episode. */
    hide() {
      var _a;
      __privateWrapper(this, _token)._++;
      (_a = __privateGet(this, _controller)) == null ? void 0 : _a.dispose();
      __privateSet(this, _controller, null);
      __privateSet(this, _visible, false);
      this._view.clear();
      this._onHide(this.journal.current);
    }
    show({ autoplay = false } = {}) {
      const e = this.journal.current;
      return e ? this.navigate(e.info, { index: e.index, autoplay, push: false }) : null;
    }
    close() {
      var _a;
      __privateWrapper(this, _token)._++;
      (_a = __privateGet(this, _controller)) == null ? void 0 : _a.dispose();
      __privateSet(this, _controller, null);
      __privateSet(this, _index, null);
      __privateSet(this, _count, 0);
      __privateSet(this, _visible, false);
      this._view.clear();
      this.journal.clear();
      this._onChange(null);
    }
  }
  _token = new WeakMap();
  _controller = new WeakMap();
  _index = new WeakMap();
  _count = new WeakMap();
  _visible = new WeakMap();
  _NavigationService_instances = new WeakSet();
  step_fn = function(delta) {
    var _a, _b;
    if (!__privateGet(this, _visible)) return false;
    if (__privateGet(this, _count)) {
      const i = (__privateGet(this, _index) ?? 0) + delta;
      if (i < 0 || i >= __privateGet(this, _count)) return false;
      this.select(i);
      return true;
    }
    return ((_b = (_a = __privateGet(this, _controller)) == null ? void 0 : _a[delta > 0 ? "next" : "previous"]) == null ? void 0 : _b.call(_a)) === true;
  };
  go_fn = function(entry) {
    return entry ? this.navigate(entry.info, {
      index: entry.index,
      autoplay: true,
      push: false
    }) : null;
  };
  setIndex_fn = function(i) {
    if (i === __privateGet(this, _index)) return;
    __privateSet(this, _index, i);
    this._view.setActive(i);
    this.journal.replaceCurrent({ index: i });
    this._onChange(this.journal.current);
  };
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
  class RegionView {
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
        const f2 = this._adopted;
        this._adopted = null;
        this._c.querySelectorAll(".lp-panel,.lp-toggle,.lp-resize").forEach((e) => e.remove());
        f2.title || (f2.title = title);
        if (f2.src !== src) f2.src = src;
        return f2;
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
      var _a;
      (_a = this._panel) == null ? void 0 : _a.setActive(i);
    }
    showPanel({ items, index, cfg, seasonCounts, onSelect }) {
      var _a;
      this._c.querySelectorAll(".lp-panel,.lp-toggle,.lp-resize").forEach((e) => e.remove());
      const c = this._c;
      const defaultWidth = items.some((i) => i.thumbnailUrl) ? 280 : 176;
      const setWidth = (w) => {
        const v = clampWidth(w, c.clientWidth || Infinity);
        c.style.setProperty("--lp-w", `${v}px`);
        return v;
      };
      let width = setWidth(((_a = this._widths) == null ? void 0 : _a.get()) ?? defaultWidth);
      const root = el("div", "lp-panel");
      const head = el("div", "lp-head");
      const toggle = el("button", "lp-toggle", "☰");
      const handle = el("div", "lp-resize");
      toggle.type = "button";
      toggle.dataset.pos = (cfg == null ? void 0 : cfg.toggle) ?? "top-right";
      toggle.title = toggle.ariaLabel = "Show playlist";
      const close = el("button", "lp-close", "»");
      close.type = "button";
      close.title = close.ariaLabel = "Hide playlist";
      head.append(el("span", "", `Playlist · ${items.length}`), close);
      root.append(head);
      let fromUser = false;
      const reveal = (mode) => {
        const a = root.querySelector(".lp-active");
        if (!a) return;
        const headH = head.offsetHeight;
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
        if (next !== null) root.scrollTop = Math.max(0, next);
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
        info.append(el("div", "lp-title", it.title));
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
            onSelect(i);
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
      };
      handle.onpointerup = handle.onpointercancel = () => {
        var _a2;
        if (!drag) return;
        drag = null;
        c.classList.remove("lp-resizing");
        (_a2 = this._widths) == null ? void 0 : _a2.set(width);
      };
      handle.ondblclick = () => {
        var _a2;
        width = setWidth(defaultWidth);
        (_a2 = this._widths) == null ? void 0 : _a2.clear();
      };
      handle.onkeydown = (e) => {
        var _a2;
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        width = setWidth(
          root.getBoundingClientRect().width + (e.key === "ArrowLeft" ? 16 : -16)
        );
        (_a2 = this._widths) == null ? void 0 : _a2.set(width);
      };
      c.append(root, toggle, handle);
      this._panel = {
        setActive: (i, mode = "nearest") => {
          var _a2, _b;
          root.querySelectorAll(".lp-item").forEach((n) => n.classList.toggle("lp-active", +n.dataset.i === i));
          (_b = (_a2 = root.querySelector(".lp-active")) == null ? void 0 : _a2.closest(".lp-season")) == null ? void 0 : _b.classList.remove("lp-collapsed");
          if (!fromUser) reveal(mode);
        }
      };
      setOpen((cfg == null ? void 0 : cfg.open) ?? false);
      this._panel.setActive(index, "center");
    }
  }
  class Tooltip {
    constructor() {
      this._token = 0;
      this._el = null;
      this._timer = null;
      this._hideTimer = null;
      this._last = null;
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
      return this._el = tip;
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
        new Promise((r) => setTimeout(() => r(null), 3e3))
      ]);
      if (token !== this._token) return;
      if (!url) return fallback();
      const probe = new Image();
      probe.onload = () => {
        if (token !== this._token) return;
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
      this._el.style.left = `${e.clientX + m + w > innerWidth ? e.clientX - w - m : e.clientX + m}px`;
      this._el.style.top = `${e.clientY + m + h > innerHeight ? e.clientY - h - m : e.clientY + m}px`;
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
  class PlayerRegion {
    constructor({
      target,
      registry,
      view,
      panel,
      onChange,
      onHide,
      onItemsLoaded
    }) {
      this.target = target;
      this.view = view;
      this.links = [];
      this.navigationService = new NavigationService({
        registry,
        view,
        panel,
        onChange,
        onHide,
        onItemsLoaded
      });
    }
  }
  function neighbourLink(links, currentKey, delta, wrap = false) {
    const n = links.length;
    if (!n) return null;
    const at = links.findIndex((l) => l.key === currentKey);
    if (at === -1) return delta > 0 ? links[0] : links[n - 1];
    if (n === 1) return null;
    const i = at + delta;
    if (i >= 0 && i < n) return links[i];
    return wrap ? links[(i + n) % n] : null;
  }
  class LinkPlayer {
    /**
     * @param {Object} o
     * @param o.useStorage   save the last url + index of each region and restore it on load (default true)
     * @param o.panel        false disables every playlist panel (data-panel="false" disables one link)
     * @param o.resizable    panel resize handle + saved width
     * @param o.tooltip      thumbnail on hover
     * @param o.registry     custom ProviderRegistry (otherwise built from the options below)
     * @param o.onNavigationState (target, state) => void
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
      onChange = () => {
      },
      onNavigationState = () => {
      },
      onError = (e) => console.warn("[LinkPlayer]", e)
    } = {}) {
      this._scope = resolveScope(scope);
      this._scanner = scanner;
      this._store = store ?? (useStorage ? new JsonStore() : new MemoryStore());
      this._useStorage = useStorage;
      this._panel = panel;
      this._resizable = resizable;
      this._activeClass = activeClass;
      this._onNavState = onNavigationState;
      this._onChange = onChange;
      this._onError = onError;
      this._registry = registry ?? new ProviderRegistry([
        new YouTubeProvider({ apiKey: youtubeApiKey, store: this._store }),
        new DailymotionProvider({ playerId: dailymotionPlayerId }),
        new OkruProvider({ embedBaseUrl: okruEmbedBaseUrl })
      ]);
      this._tooltip = tooltip && !isTouch() ? new Tooltip() : null;
      this._regions = /* @__PURE__ */ new Map();
      this._bound = /* @__PURE__ */ new WeakSet();
      this._thumbs = /* @__PURE__ */ new Map();
      this._embedCount = 0;
      this.scan();
    }
    getRegion(target, container = document.getElementById(target)) {
      if (!this._regions.has(target)) {
        if (!container) throw new Error(`Target not found: "${target}"`);
        const widths = this._resizable ? {
          get: () => this._store.get("panel-width"),
          set: (w) => this._store.set("panel-width", w),
          clear: () => this._store.remove("panel-width")
        } : null;
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
            onHide: () => this._hidden(target),
            onItemsLoaded: () => this._emitNav(target)
          })
        );
      }
      return this._regions.get(target);
    }
    /** Host of an existing iframe: its own parent when it holds only the iframe (.video-container...), otherwise a wrapper. */
    _hostFor(iframe) {
      const p = iframe.parentElement;
      if (p && p !== this._scope && p !== document.body && p.children.length === 1 && !p.textContent.trim())
        return p;
      const w = +iframe.getAttribute("width") || 0;
      const h = +iframe.getAttribute("height") || 0;
      const wrap = document.createElement("div");
      wrap.style.cssText = `width:100%;${w ? `max-width:${w}px;` : ""}aspect-ratio:${w && h ? `${w}/${h}` : "16/9"}`;
      iframe.replaceWith(wrap);
      wrap.append(iframe);
      iframe.classList.add("lp-frame");
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
          return;
        }
        if (!provider.panel) return;
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
        this._run(
          info,
          () => region.navigationService.navigate(info, { autoplay: false })
        );
      });
    }
    /* ── episodes (inside the current playlist) ── */
    nextItem(target) {
      var _a;
      return ((_a = this._regions.get(target)) == null ? void 0 : _a.navigationService.nextItem()) ?? false;
    }
    previousItem(target) {
      var _a;
      return ((_a = this._regions.get(target)) == null ? void 0 : _a.navigationService.previousItem()) ?? false;
    }
    /* ── links (between the links of the zone) ── */
    nextLink(target, opts) {
      return this._stepLink(target, 1, opts);
    }
    previousLink(target, opts) {
      return this._stepLink(target, -1, opts);
    }
    /** @returns {boolean} false at the edges (unless wrap) or for an unknown zone. */
    _stepLink(target, delta, { wrap = false, autoplay } = {}) {
      var _a;
      const region = this._regions.get(target);
      if (!region) return false;
      const ns = region.navigationService;
      const link = neighbourLink(region.links, (_a = ns.current) == null ? void 0 : _a.key, delta, wrap);
      if (!link) return false;
      this._run(
        link,
        () => ns.navigate(link, { autoplay: autoplay ?? this._clickAutoplay(link) })
      );
      return true;
    }
    /** Everything a custom navigation bar needs to enable/disable its buttons. */
    getNavigationState(target) {
      var _a;
      const region = this._regions.get(target);
      if (!region) return null;
      const ns = region.navigationService;
      const key = (_a = ns.current) == null ? void 0 : _a.key;
      return {
        target,
        isOpen: ns.isOpen,
        index: ns.itemIndex,
        count: ns.itemCount,
        hasNextItem: ns.hasNextItem,
        hasPreviousItem: ns.hasPreviousItem,
        hasNextLink: !!neighbourLink(region.links, key, 1),
        hasPreviousLink: !!neighbourLink(region.links, key, -1)
      };
    }
    _emitNav(target) {
      const state = this.getNavigationState(target);
      if (state) this._onNavState(target, state);
    }
    scan() {
      var _a;
      let infos = [];
      try {
        infos = this._scanner.scan(this._scope);
      } catch (error) {
        return this._onError(error);
      }
      for (const info of infos) {
        if (this._bound.has(info.link)) continue;
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
        }
        (_a = this._tooltip) == null ? void 0 : _a.attach(
          info.link,
          () => this._thumbnail(info),
          info.link.textContent.trim(),
          { id: provider == null ? void 0 : provider.id, name: provider == null ? void 0 : provider.name }
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
      if (region.navigationService.current) return;
      const saved = this._useStorage ? this._store.get(`state:${region.target}`) : null;
      if (saved == null ? void 0 : saved.url) {
        const info = region.links.find((l) => l.url === saved.url) ?? {
          url: saved.url,
          key: saved.key,
          autoplay: AUTOPLAY_MODES.NONE,
          startIndex: null,
          seasonCounts: null
        };
        return this._run(
          info,
          () => region.navigationService.navigate(info, {
            index: saved.index,
            autoplay: info.autoplay === AUTOPLAY_MODES.INIT
          })
        );
      }
      const first = region.links.find((l) => l.showOnInit);
      if (first)
        this._run(
          first,
          () => region.navigationService.navigate(first, {
            autoplay: first.autoplay === AUTOPLAY_MODES.INIT
          })
        );
    }
    _clickAutoplay(info) {
      return info.autoplay === AUTOPLAY_MODES.INIT || info.autoplay === AUTOPLAY_MODES.CLICK;
    }
    // _click: only the autoplay line changes
    _click(region, info) {
      var _a, _b;
      const ns = region.navigationService;
      const autoplay = this._clickAutoplay(info);
      if (((_a = ns.current) == null ? void 0 : _a.key) === info.key && ((_b = ns.current) == null ? void 0 : _b.url) === info.url)
        return ns.isOpen ? ns.hide() : this._run(info, () => ns.show({ autoplay }));
      this._run(info, () => ns.navigate(info, { autoplay }));
    }
    _changed(target, entry) {
      var _a;
      const links = ((_a = this._regions.get(target)) == null ? void 0 : _a.links) ?? [];
      links.forEach(
        (l) => l.link.classList.toggle(this._activeClass, !!entry && l.key === entry.key)
      );
      if (this._useStorage) {
        entry ? this._store.set(`state:${target}`, {
          key: entry.key,
          url: entry.url,
          index: entry.index
        }) : this._store.remove(`state:${target}`);
      }
      this._onChange(target, entry);
      this._emitNav(target);
    }
    _hidden(target) {
      var _a;
      (((_a = this._regions.get(target)) == null ? void 0 : _a.links) ?? []).forEach(
        (l) => l.link.classList.remove(this._activeClass)
      );
      this._emitNav(target);
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
  __publicField(LinkPlayer, "VERSION", "2.0.7");
  return LinkPlayer;
}));
//# sourceMappingURL=link-player.js.map
