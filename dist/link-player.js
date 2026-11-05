(function(global, factory) {
	typeof exports === "object" && typeof module !== "undefined" ? module.exports = factory() : typeof define === "function" && define.amd ? define([], factory) : (global = typeof globalThis !== "undefined" ? globalThis : global || self, global.LinkPlayer = factory());
})(this, function() {
	// src/util.js
	var el$1 = (tag, cls, text) => {
		const e = document.createElement(tag);
		if (cls) e.className = cls;
		if (text !== void 0) e.textContent = text;
		return e;
	};
	var isTouch = () => !!globalThis.matchMedia?.("(hover: none) and (pointer: coarse)").matches;
	var hostOf = (u) => u.hostname.replace(/^www\./, "");
	var intParam = (u, name) => {
		const v = u.searchParams.get(name);
		return v !== null && /^\d+$/.test(v) ? +v : null;
	};
	var safeDecode = (s) => {
		try {
			return decodeURIComponent(s);
		} catch {
			return s;
		}
	};
	var isUrl = (s) => typeof s === "string" && /^https?:\/\//i.test(s.trim());
	var DAY = 864e5;
	var AUTOPLAY_MODES = Object.freeze({
		NONE: "none",
		INIT: "init",
		CLICK: "click"
	});
	function toAutoplayMode(value) {
		if (value === void 0 || value === null) return AUTOPLAY_MODES.NONE;
		const v = String(value).trim().toLowerCase();
		if (v === "" || v === "true" || v === "init") return AUTOPLAY_MODES.INIT;
		if (v === "click") return AUTOPLAY_MODES.CLICK;
		return AUTOPLAY_MODES.NONE;
	}
	/** 32-bit FNV-1a, base36: short, stable keys for long id lists. */
	function shortHash(str) {
		let h = 2166136261;
		for (let i = 0; i < str.length; i++) {
			h ^= str.charCodeAt(i);
			h = Math.imul(h, 16777619);
		}
		return (h >>> 0).toString(36);
	}
	var UnsupportedUrlError = class extends Error {
		constructor(ref) {
			super(`No provider can handle this reference: ${ref}`);
			this.name = "UnsupportedUrlError";
		}
	};
	var DuplicateEntryError = class extends Error {
		constructor(key) {
			super(`Entry already registered: ${key}`);
			this.name = "DuplicateEntryError";
		}
	};
	/** One video of a playlist. */
	var makeItem = (id, index, { title = "", channel = "", thumbnail = "", duration = null } = {}) => ({
		id: String(id),
		index,
		title: title || `Video ${index + 1}`,
		channel,
		thumbnail,
		duration
	});
	/** Element, id or selector. null → global. Throws when a given scope does not exist. */
	function resolveScope(scope) {
		if (scope == null) return null;
		if (scope instanceof Element) return scope;
		if (typeof scope === "string") {
			let node = document.getElementById(scope);
			if (!node) try {
				node = document.querySelector(scope);
			} catch {}
			if (node) return node;
		}
		throw new Error(`Scope not found: ${String(scope)}`);
	}
	// src/storage.js
	var MemoryStore = class {
		#m = /* @__PURE__ */ new Map();
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
			this.#m.set(key, {
				data,
				expiresAt: ttlMs ? Date.now() + ttlMs : null
			});
		}
		remove(key) {
			this.#m.delete(key);
		}
	};
	/** JSON in a localStorage-like storage. Never throws. ttlMs is optional (no expiry by default). */
	var JsonStore = class {
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
				this._s.setItem(this._p + key, JSON.stringify({
					data,
					expiresAt: ttlMs ? Date.now() + ttlMs : null
				}));
			} catch {}
		}
		remove(key) {
			try {
				this._s.removeItem(this._p + key);
			} catch {}
		}
	};
	/** localStorage when reachable, memory otherwise (sandboxed iframes throw on access). */
	function defaultStore() {
		try {
			return new JsonStore();
		} catch {
			return new MemoryStore();
		}
	}
	// src/providers/registry.js
	var ProviderRegistry = class {
		constructor(providers = []) {
			this._providers = [...providers];
		}
		register(provider) {
			this._providers.push(provider);
			return this;
		}
		/** By url. @throws UnsupportedUrlError */
		resolve(url) {
			const p = this._providers.find((p) => p.canHandle(url));
			if (!p) throw new UnsupportedUrlError(url);
			return p;
		}
		/** By id ("youtube"...). @throws Error */
		get(id) {
			const p = this._providers.find((p) => p.id === id);
			if (!p) throw new Error(`Unknown provider: "${id}"`);
			return p;
		}
	};
	// src/providers/youtube.js
	var YT_ORIGINS = ["https://www.youtube.com", "https://www.youtube-nocookie.com"];
	var thumbOf = (id) => `https://img.youtube.com/vi/${id}/mqdefault.jpg`;
	var isoToSeconds = (s = "") => {
		const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(s);
		return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : null;
	};
	var YouTubeEmbedSrcBuilder = class {
		constructor({ origin = globalThis.location?.origin ?? "" } = {}) {
			this._origin = origin;
		}
		buildSrc({ autoplay = false, startSeconds = null, videoId = null, videoIds = null, playlistId = null, index = null } = {}) {
			const q = new URLSearchParams({ enablejsapi: "1" });
			if (this._origin) q.set("origin", this._origin);
			if (autoplay) q.set("autoplay", "1");
			if (startSeconds !== null) q.set("start", startSeconds);
			if (videoIds?.length) {
				q.set("playlist", videoIds.join(","));
				if (index !== null) q.set("index", index);
				return `https://www.youtube.com/embed/videoseries?${q}`;
			}
			if (playlistId) {
				q.set("list", playlistId);
				if (index !== null || !videoId) {
					if (index !== null) q.set("index", index);
					return `https://www.youtube.com/embed/videoseries?${q}`;
				}
			}
			if (!videoId) throw new TypeError("YouTube: videoId, videoIds or playlistId required");
			return `https://www.youtube.com/embed/${videoId}?${q}`;
		}
	};
	var YouTubeProvider = class {
		id = "youtube";
		name = "YouTube";
		label = "YouTube player";
		panel = {
			toggle: "bottom-left",
			open: false
		};
		constructor({ apiKey = null, store = null, fetchFn = (...a) => fetch(...a), origin } = {}) {
			this._apiKey = apiKey;
			this._store = store;
			this._fetch = fetchFn;
			this._src = new YouTubeEmbedSrcBuilder({ origin });
		}
		canHandle(url) {
			try {
				const u = new URL(url);
				const h = hostOf(u);
				if ((h === "youtube.com" || h === "youtube-nocookie.com") && /^\/embed(\/|$)/.test(u.pathname)) return true;
				if (h === "youtube.com") return u.pathname === "/watch" && u.searchParams.has("v") || u.pathname === "/watch_videos" && u.searchParams.has("video_ids");
				return h === "youtu.be" && u.pathname.length > 1;
			} catch {
				return false;
			}
		}
		/** ref: url | video id | playlist id | array of video ids | { videoId, playlistId, videoIds, startSeconds, initialIndex } */
		parse(ref) {
			if (Array.isArray(ref)) return this._shape({ videoIds: ref.map(String) });
			if (ref && typeof ref === "object") return this._shape(ref);
			const s = String(ref).trim();
			if (isUrl(s)) return this._parseUrl(s);
			if (/^(PL|UU|LL|FL|OL|RD)[\w-]{10,}$/.test(s)) return this._shape({ playlistId: s });
			if (/^[\w-]{11}$/.test(s)) return this._shape({ videoId: s });
			throw new UnsupportedUrlError(s);
		}
		_shape({ videoId = null, playlistId = null, videoIds = null, startSeconds = null, initialIndex = null }) {
			const ids = videoIds?.length ? videoIds : null;
			return {
				provider: this.id,
				videoId,
				playlistId,
				videoIds: ids,
				startSeconds,
				initialIndex,
				isCollection: !!(ids || playlistId)
			};
		}
		_parseUrl(url) {
			if (!this.canHandle(url)) throw new UnsupportedUrlError(url);
			const u = new URL(url);
			const emb = /^\/embed(?:\/([^/]+))?\/?$/.exec(u.pathname);
			const pathId = emb?.[1] && emb[1] !== "videoseries" ? emb[1] : null;
			const ids = u.searchParams.get(emb ? "playlist" : "video_ids");
			const videoIds = ids ? ids.split(",").map((s) => s.trim()).filter(Boolean) : null;
			if (pathId && videoIds && !videoIds.includes(pathId)) videoIds.unshift(pathId);
			const urlIndex = intParam(u, "index");
			return this._shape({
				videoId: emb ? pathId : hostOf(u) === "youtu.be" ? u.pathname.slice(1) : u.searchParams.get("v"),
				playlistId: u.searchParams.get("list"),
				videoIds,
				startSeconds: intParam(u, "start") ?? intParam(u, "t"),
				initialIndex: urlIndex === null ? null : emb ? urlIndex : Math.max(urlIndex - 1, 0)
			});
		}
		keyOf(p) {
			return [
				"yt",
				p.videoId,
				p.playlistId,
				p.videoIds && shortHash(p.videoIds.join(",")),
				p.startSeconds && `t${p.startSeconds}`,
				p.initialIndex != null && `i${p.initialIndex}`
			].filter(Boolean).join(":");
		}
		buildSrc(p, { autoplay = false, index = null } = {}) {
			return this._src.buildSrc({
				...p,
				autoplay,
				index
			});
		}
		thumbnailForId(id) {
			return thumbOf(id);
		}
		thumbnailFor(p) {
			const id = p.videoId ?? p.videoIds?.[0];
			return id ? thumbOf(id) : null;
		}
		/** Playlist without a known first id: take the first discovered item. */
		async fetchThumbnail(p) {
			return this.thumbnailFor(p) ?? (await this.discoverItems(p))[0]?.thumbnail ?? null;
		}
		/** Never rejects. Titles/durations need the Data API; without a key the items are generic. */
		async discoverItems(p) {
			const key = p.playlistId ?? p.videoIds?.join(",");
			if (!key) return [];
			const cached = this._store?.get(`yt:${key}`);
			if (cached) return cached;
			let ids = p.videoIds ?? [];
			try {
				if (!this._apiKey) throw new Error("no apiKey (needed for list= playlists and titles)");
				if (p.playlistId) ids = await this._playlistIds(p.playlistId);
				const items = (await this._videos(ids)).map((v, i) => makeItem(v.id, i, v));
				if (items.length) this._store?.set(`yt:${key}`, items, DAY);
				return items;
			} catch (error) {
				console.warn("[YouTubeProvider]", error.message);
				return ids.map((id, i) => makeItem(id, i, { thumbnail: thumbOf(id) }));
			}
		}
		async _json(path, params) {
			const q = new URLSearchParams({
				...params,
				key: this._apiKey
			});
			const res = await this._fetch(`https://www.googleapis.com/youtube/v3/${path}?${q}`);
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
					...pageToken && { pageToken }
				});
				d.items?.forEach((i) => i.contentDetails?.videoId && ids.push(i.contentDetails.videoId));
				pageToken = d.nextPageToken ?? "";
			} while (pageToken);
			return ids;
		}
		async _videos(ids) {
			const out = [];
			for (let i = 0; i < ids.length; i += 50) {
				const d = await this._json("videos", {
					part: "snippet,status,contentDetails",
					id: ids.slice(i, i + 50).join(",")
				});
				for (const v of d.items ?? []) {
					if (v.status?.privacyStatus === "private") continue;
					out.push({
						id: v.id,
						title: v.snippet.title,
						channel: v.snippet.channelTitle || "",
						thumbnail: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || "",
						duration: isoToSeconds(v.contentDetails?.duration)
					});
				}
			}
			return out;
		}
		/** postMessage API. onItemChange fires for changes made by the player itself. */
		createController(iframe, { index = null, onItemChange = () => {} } = {}) {
			const post = (m) => iframe.contentWindow?.postMessage(JSON.stringify(m), "*");
			let synced = index === null;
			const onLoad = () => post({ event: "listening" });
			const onMessage = (e) => {
				if (!YT_ORIGINS.includes(e.origin) || e.source !== iframe.contentWindow) return;
				let d;
				try {
					d = JSON.parse(e.data);
				} catch {
					return;
				}
				if (d.event !== "infoDelivery" || d.info?.playerState !== 1 || !Number.isInteger(d.info.playlistIndex)) return;
				if (!synced) {
					synced = true;
					if (d.info.playlistIndex !== index) return controller.playAt(index);
				}
				onItemChange(d.info.playlistIndex);
			};
			const controller = {
				playAt: (i) => post({
					event: "command",
					func: "playVideoAt",
					args: [i]
				}),
				dispose() {
					globalThis.removeEventListener("message", onMessage);
					iframe.removeEventListener("load", onLoad);
				}
			};
			globalThis.addEventListener("message", onMessage);
			iframe.addEventListener("load", onLoad);
			return controller;
		}
	};
	// src/providers/dailymotion.js
	var DailymotionProvider = class {
		id = "dailymotion";
		name = "Dailymotion";
		label = "Dailymotion player";
		panel = null;
		/** playerId: Player ID from Dailymotion Studio. An id found in an existing embed url wins. */
		constructor({ playerId = null } = {}) {
			this._playerId = playerId;
		}
		canHandle(url) {
			try {
				const u = new URL(url);
				const h = hostOf(u);
				if (h === "geo.dailymotion.com") return /^\/player\/[^/]+\.(?:html|js)$/.test(u.pathname) && (u.searchParams.has("video") || u.searchParams.has("playlist"));
				return h === "dailymotion.com" && (u.pathname.startsWith("/video/") || u.pathname.startsWith("/playlist/"));
			} catch {
				return false;
			}
		}
		/** ref: url | video id (x…) | { videoId, playlistId, playerId } */
		parse(ref) {
			if (ref && typeof ref === "object" && !Array.isArray(ref)) return this._shape(ref);
			const s = String(ref).trim();
			if (!isUrl(s)) {
				if (/^x[a-z0-9]+$/i.test(s)) return this._shape({ videoId: s });
				throw new UnsupportedUrlError(s);
			}
			if (!this.canHandle(s)) throw new UnsupportedUrlError(s);
			const u = new URL(s);
			const geo = /^\/player\/([^/]+)\.(?:html|js)$/.exec(u.pathname);
			if (hostOf(u) === "geo.dailymotion.com" && geo) return this._shape({
				videoId: u.searchParams.get("video"),
				playlistId: u.searchParams.get("playlist"),
				playerId: geo[1]
			});
			const video = u.pathname.match(/^\/video\/([^/]+)/);
			const playlist = u.pathname.match(/^\/playlist\/([^/]+)/);
			return this._shape({
				videoId: video?.[1] ?? null,
				playlistId: playlist?.[1] ?? u.searchParams.get("playlist")
			});
		}
		_shape({ videoId = null, playlistId = null, playerId = null }) {
			if (!videoId && !playlistId) throw new TypeError("Dailymotion: videoId or playlistId required");
			return {
				provider: this.id,
				type: videoId ? "video" : "playlist",
				id: videoId ?? playlistId,
				videoId,
				playlistId,
				playerId,
				initialIndex: null,
				isCollection: !!playlistId
			};
		}
		keyOf(p) {
			return [
				"dm",
				p.type,
				p.id,
				p.videoId && p.playlistId
			].filter(Boolean).join(":");
		}
		buildSrc(p, { autoplay = false } = {}) {
			const playerId = p.playerId ?? this._playerId;
			if (playerId) {
				const q = new URLSearchParams();
				if (p.videoId) q.set("video", p.videoId);
				if (p.playlistId) q.set("playlist", p.playlistId);
				if (autoplay) q.set("autoplay", "true");
				return `https://geo.dailymotion.com/player/${playerId}.html?${q}`;
			}
			return `https://www.dailymotion.com/embed/${p.type}/${p.id}${autoplay ? "?autoplay=1" : ""}`;
		}
		thumbnailForId(id) {
			return `https://www.dailymotion.com/thumbnail/video/${id}`;
		}
		thumbnailFor(p) {
			return p.videoId ? this.thumbnailForId(p.videoId) : null;
		}
		async fetchThumbnail(p) {
			return this.thumbnailFor(p);
		}
		async discoverItems() {
			return [];
		}
		createController() {
			return {
				playAt() {},
				dispose() {}
			};
		}
	};
	// src/providers/okru.js
	var OkruProvider = class {
		id = "okru";
		name = "Ok.ru";
		label = "Ok.ru player";
		panel = {
			toggle: "top-right",
			open: true
		};
		constructor({ embedBaseUrl = "https://ok.ru/videoembed/", fetchFn = (...a) => fetch(...a) } = {}) {
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
		/** ref: url | video id | array of ids | { videoId, itemIds, labels, initialIndex } */
		parse(ref) {
			if (Array.isArray(ref)) return this._shape({ itemIds: ref.map(String) });
			if (ref && typeof ref === "object") return this._shape(ref);
			const s = String(ref).trim();
			if (isUrl(s)) return this._parseUrl(s);
			if (/^\d+$/.test(s)) return this._shape({ videoId: s });
			throw new UnsupportedUrlError(s);
		}
		_shape({ videoId = null, itemIds = null, labels = [], initialIndex = null }) {
			const ids = itemIds?.length ? itemIds.map(String) : videoId ? [String(videoId)] : [];
			if (!ids.length) throw new TypeError("Ok.ru: videoId or itemIds required");
			const id = videoId ? String(videoId) : ids[0];
			return {
				provider: this.id,
				videoId: id,
				itemIds: ids,
				labels,
				initialIndex: initialIndex ?? Math.max(ids.indexOf(id), 0),
				isCollection: ids.length > 1
			};
		}
		_parseUrl(url) {
			if (!this.canHandle(url)) throw new UnsupportedUrlError(url);
			const u = new URL(url);
			const videoId = u.pathname.match(/^\/video\/([^/]+)/)[1];
			const listed = (u.searchParams.get("video_ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
			const itemIds = !listed.length ? [videoId] : listed.includes(videoId) ? listed : [videoId, ...listed];
			const raw = u.search.match(/[?&]labels=([^&]*)/)?.[1];
			const names = raw ? raw.split(",").map((s) => safeDecode(s.trim())).filter(Boolean) : [];
			const offset = itemIds.length - listed.length;
			const labels = offset > 0 && listed.length ? [...Array(offset).fill(""), ...names] : names;
			return this._shape({
				videoId,
				itemIds,
				labels,
				initialIndex: intParam(u, "index")
			});
		}
		keyOf(p) {
			return [
				"ok",
				p.videoId,
				p.itemIds.length > 1 && shortHash(p.itemIds.join(",")),
				p.initialIndex > 0 && `i${p.initialIndex}`
			].filter(Boolean).join(":");
		}
		buildSrc(p, { autoplay = false, index = null } = {}) {
			const id = index === null ? p.videoId : p.itemIds[index] ?? p.videoId;
			return `${this._base}${id}${autoplay ? (this._base.includes("?") ? "&" : "?") + "autoplay=1" : ""}`;
		}
		thumbnailForId() {
			return null;
		}
		thumbnailFor() {
			return null;
		}
		async fetchThumbnail(p) {
			try {
				const res = await this._fetch(`https://ok.ru/oembed?url=${encodeURIComponent(`https://ok.ru/video/${p.videoId}`)}&format=json`);
				return res.ok ? (await res.json()).thumbnail_url ?? null : null;
			} catch {
				return null;
			}
		}
		async discoverItems(p) {
			return p.itemIds.length < 2 ? [] : p.itemIds.map((id, i) => makeItem(id, i, { title: p.labels[i] }));
		}
		/** No player API on Ok.ru: changing video means reloading the iframe. */
		createController(iframe, { parsed }) {
			return {
				playAt: (i, { autoplay = true } = {}) => {
					iframe.src = this.buildSrc(parsed, {
						autoplay,
						index: i
					});
				},
				dispose() {}
			};
		}
	};
	// src/model.js
	/** One registered url (video or playlist). Metadata declared in code always wins over what the provider discovers. */
	var Entry = class {
		constructor({ key, provider, parsed, url = null, meta = {}, source = "code", link = null }) {
			Object.assign(this, {
				key,
				provider,
				parsed,
				url,
				source,
				link,
				set: null
			});
			this.title = meta.title ?? "";
			this.channel = meta.channel ?? "";
			this.thumbnail = meta.thumbnail ?? provider.thumbnailFor(parsed) ?? null;
			this.duration = meta.duration ?? null;
			this.autoplay = toAutoplayMode(meta.autoplay);
			this.startIndex = meta.startIndex ?? null;
			this.showOnInit = !!meta.showOnInit;
			this.panel = meta.panel !== false;
			this.seasonCounts = meta.seasonCounts ?? null;
			this._declared = meta.items ? meta.items.map((it, i) => makeItem(it.id, i, {
				...it,
				thumbnail: it.thumbnail ?? provider.thumbnailForId?.(it.id) ?? ""
			})) : null;
			this._items = null;
			this._thumb = null;
		}
		get isCollection() {
			return !!(this._declared || this.parsed.isCollection);
		}
		/** Declared items win (no network); otherwise the provider discovers them. Resolved once, never rejects. */
		ensureItems() {
			return this._items ??= this._declared ? Promise.resolve(this._declared) : Promise.resolve(this.provider.discoverItems(this.parsed)).catch(() => []);
		}
		resolveThumbnail() {
			return this._thumb ??= this.thumbnail ? Promise.resolve(this.thumbnail) : Promise.resolve(this.provider.fetchThumbnail(this.parsed)).then((u) => this.thumbnail = u ?? null).catch(() => null);
		}
	};
	/** A group of entries of one provider, with shared properties. */
	var EntrySet = class {
		constructor(region, provider, commonProps = {}) {
			this.region = region;
			this.provider = provider;
			this.commonProps = commonProps;
			this.entries = [];
		}
		/**
		* ref: url | bare id | array of ids | provider object. null when `meta.items` lists the videos.
		* meta: title, channel, thumbnail, duration, items[{ id, title, channel, thumbnail, duration }],
		*       autoplay ("none"|"init"|"click"), startIndex, showOnInit, panel, seasonCounts, key
		* @throws DuplicateEntryError, UnsupportedUrlError
		*/
		add(ref, meta = {}) {
			this._add(ref, meta, "code");
			return this;
		}
		/** A playlist described entirely in code: no API call needed. */
		addList(items, meta = {}) {
			return this.add(null, {
				...meta,
				items
			});
		}
		/** @internal returns the entry */
		_add(ref, meta, source, extra = {}) {
			const m = {
				...this.commonProps,
				...meta
			};
			if (ref == null && !m.items?.length) throw new TypeError("add(): a reference or items are required");
			const parsed = this.provider.parse(ref ?? m.items.map((i) => i.id));
			const key = m.key ?? this.provider.keyOf(parsed) + (m.startIndex != null ? `@${m.startIndex}` : "");
			const url = typeof ref === "string" && /^https?:\/\//i.test(ref) ? ref : null;
			const entry = new Entry({
				key,
				provider: this.provider,
				parsed,
				url,
				meta: m,
				source,
				link: extra.link ?? null
			});
			this.region._register(this, entry);
			entry.set = this;
			this.entries.push(entry);
			return entry;
		}
	};
	// src/journal.js
	/**
	* History of one region, with a cursor: back / forward like a browser.
	* Entries: { key, url, index, info }. `info` (LinkInfo) is memory only, never saved.
	*/
	var NavigationJournal = class {
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
			this.#entries.splice(this.#cursor + 1);
			this.#entries.push(entry);
			this.#cursor = this.#entries.length - 1;
		}
		/** Updates the current entry (e.g. the episode changed) without creating history. */
		replaceCurrent(patch) {
			if (!this.current) return this.push(patch);
			this.#entries[this.#cursor] = {
				...this.current,
				...patch
			};
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
	};
	// src/navigation.js
	function neighbourEntry(entries, currentKey, delta, wrap = false) {
		const n = entries.length;
		if (!n) return null;
		const at = entries.findIndex((e) => e.key === currentKey);
		if (at === -1) return delta > 0 ? entries[0] : entries[n - 1];
		if (n === 1) return null;
		const i = at + delta;
		if (i >= 0 && i < n) return entries[i];
		return wrap ? entries[(i + n) % n] : null;
	}
	/** reason: "click" (user or next/previous) | "init" (first display). */
	var wantsAutoplay = (entry, reason) => entry.autoplay === AUTOPLAY_MODES.INIT || reason === "click" && entry.autoplay === AUTOPLAY_MODES.CLICK;
	/** Navigation of one region: entries → iframe → panel, with a journal. Sync methods return a boolean and report errors on the region; navigate* methods are awaitable. */
	var NavigationService = class {
		#region;
		#view;
		#panel;
		#token = 0;
		#controller = null;
		#entry = null;
		#itemIndex = null;
		#visible = false;
		#navigated = false;
		constructor({ region, view, journal = new NavigationJournal(), panel = true }) {
			this.#region = region;
			this.#view = view;
			this.#panel = panel;
			this.journal = journal;
		}
		get entry() {
			return this.#entry;
		}
		get itemIndex() {
			return this.#itemIndex;
		}
		get isOpen() {
			return this.#visible;
		}
		get hasNavigated() {
			return this.#navigated;
		}
		/** index (0-based) wins over entry.startIndex, which wins over the url's own index. */
		async navigateTo(entry, { autoplay = false, itemIndex = null, push = true } = {}) {
			const token = ++this.#token;
			this.#navigated = true;
			const { provider, parsed } = entry;
			const start = itemIndex ?? entry.startIndex ?? parsed.initialIndex ?? null;
			const itemsPromise = entry.ensureItems();
			const src = provider.buildSrc(parsed, {
				autoplay,
				index: start
			});
			this.#controller?.dispose();
			const iframe = this.#view.showEmbed(src, entry.title || provider.label);
			this.#controller = provider.createController(iframe, {
				parsed,
				index: start,
				onItemChange: (i) => this.#setItemIndex(i)
			});
			this.#entry = entry;
			this.#itemIndex = start;
			this.#visible = true;
			const record = {
				key: entry.key,
				index: start,
				entry
			};
			push ? this.journal.push(record) : this.journal.replaceCurrent(record);
			this.#changed();
			const items = await itemsPromise;
			if (token !== this.#token) return;
			this.#region.emit("items", {
				entry,
				items
			});
			if (!this.#panel || !provider.panel || !entry.panel || items.length < 2) return;
			this.#view.showPanel({
				entry,
				items,
				index: this.#itemIndex ?? 0,
				cfg: provider.panel,
				onSelect: (i) => this.select(i)
			});
		}
		/** Url, key or any url of a known video. An unknown url is registered on the fly. */
		async navigateByUrl(url, opts) {
			return this.navigateTo(this.#region.ensureEntry(url), opts);
		}
		async navigateByIndex(index, opts) {
			const entry = this.#region.entries[index];
			if (!entry) throw new RangeError(`No entry at index ${index}`);
			return this.navigateTo(entry, opts);
		}
		/** Entry | index | key | url. No-op when already displayed. */
		go(target, { reason = "click", autoplay, itemIndex = null, push = true } = {}) {
			let entry;
			try {
				entry = this.#region.resolveTarget(target);
			} catch (error) {
				this.#region.emit("error", {
					error,
					entry: null
				});
				return false;
			}
			if (!entry || entry === this.#entry && this.#visible && itemIndex == null) return false;
			this.#fire(this.navigateTo(entry, {
				autoplay: autoplay ?? wantsAutoplay(entry, reason),
				itemIndex,
				push
			}), entry);
			return true;
		}
		/** Same entry: hide / show again. Otherwise: navigate. */
		toggle(entry, opts = {}) {
			if (entry === this.#entry) return this.#visible ? (this.hide(), true) : this.show({ autoplay: opts.autoplay ?? wantsAutoplay(entry, "click") });
			return this.go(entry, opts);
		}
		nextLink({ wrap = false, autoplay } = {}) {
			return this.#step(1, wrap, autoplay);
		}
		previousLink({ wrap = false, autoplay } = {}) {
			return this.#step(-1, wrap, autoplay);
		}
		#step(delta, wrap, autoplay) {
			const entry = neighbourEntry(this.#region.entries, this.#entry?.key, delta, wrap);
			if (!entry) return false;
			this.#fire(this.navigateTo(entry, { autoplay: autoplay ?? wantsAutoplay(entry, "click") }), entry);
			return true;
		}
		back() {
			return this.#walk(this.journal.back());
		}
		forward() {
			return this.#walk(this.journal.forward());
		}
		#walk(record) {
			if (!record) return false;
			this.#fire(this.navigateTo(record.entry, {
				itemIndex: record.index,
				autoplay: true,
				push: false
			}), record.entry);
			return true;
		}
		/** The panel picked an item. */
		select(index) {
			if (index === this.#itemIndex) return;
			this.#controller?.playAt(index, { autoplay: true });
			this.#setItemIndex(index);
		}
		/** Hides player and panel, keeps the journal and the current item. */
		hide() {
			this.#token++;
			this.#controller?.dispose();
			this.#controller = null;
			this.#visible = false;
			this.#view.clear();
			this.#state();
		}
		show({ autoplay = false } = {}) {
			const record = this.journal.current;
			if (!record) return false;
			this.#fire(this.navigateTo(record.entry, {
				itemIndex: record.index,
				autoplay,
				push: false
			}), record.entry);
			return true;
		}
		/** Full reset: journal, current entry and saved state. */
		close() {
			this.dispose();
			this.#entry = null;
			this.#itemIndex = null;
			this.journal.clear();
			this.#region.emit("change", {
				entry: null,
				itemIndex: null
			});
			this.#state();
		}
		/** Stops everything silently (no events, saved state untouched). */
		dispose() {
			this.#token++;
			this.#controller?.dispose();
			this.#controller = null;
			this.#visible = false;
			this.#view.clear();
		}
		#fire(promise, entry) {
			promise.catch((error) => this.#region.emit("error", {
				error,
				entry
			}));
		}
		#setItemIndex(i) {
			if (i === this.#itemIndex) return;
			this.#itemIndex = i;
			this.#view.setActive(i);
			this.journal.replaceCurrent({ index: i });
			this.#changed();
		}
		#changed() {
			this.#region.emit("change", {
				entry: this.#entry,
				itemIndex: this.#itemIndex
			});
			this.#state();
		}
		#state() {
			this.#region.emit("state", this.#region.getState());
		}
	};
	// src/seasons.js
	var SEASON_RE = /\b(?:saison|season)\s*0*(\d{1,3})\b|\bs0*(\d{1,2})(?:\b|(?=e\d))/i;
	/** [{ label, start, end }] (end exclusive) or null when grouping is useless. */
	function groupBySeason(items, counts = null) {
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
			if (start < n) groups.push({
				label: "Other",
				start,
				end: n
			});
			return groups.length > 1 ? groups : null;
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
			else groups.push({
				key: cur,
				label: cur === null ? "Other" : `Season ${cur}`,
				start: i,
				end: i + 1
			});
		});
		return groups.length > 1 ? groups : null;
	}
	// src/renderers.js
	var clampWidth = (px, hostWidth) => Math.min(Math.max(Math.round(px), 140), Math.max(140, Math.floor(hostWidth * .7)));
	/**
	* Panel renderer contract (override with the `panelRenderer` option or region.setPanelRenderer()):
	*   ctx    { host, entry, items, index, cfg:{toggle,open}, onSelect(i), widths, resizable }
	*   return { setActive(i, mode?), destroy() }
	*/
	function defaultPanelRenderer({ host, entry, items, index, cfg, onSelect, widths, resizable }) {
		const defaultWidth = items.some((i) => i.thumbnail) ? 280 : 176;
		const setWidth = (w) => {
			const v = clampWidth(w, host.clientWidth || Infinity);
			host.style.setProperty("--lp-w", `${v}px`);
			return v;
		};
		let width = setWidth(widths?.get() ?? defaultWidth);
		const root = el$1("div", "lp-panel");
		const head = el$1("div", "lp-head");
		const toggle = el$1("button", "lp-toggle", "☰");
		const close = el$1("button", "lp-close", "»");
		const handle = el$1("div", "lp-resize");
		toggle.type = close.type = "button";
		toggle.dataset.pos = cfg?.toggle ?? "top-right";
		toggle.title = toggle.ariaLabel = "Show playlist";
		close.title = close.ariaLabel = "Hide playlist";
		head.append(el$1("span", "", `Playlist · ${items.length}`), close);
		root.append(head);
		let fromUser = false;
		/** "center": middle of the panel. "nearest": scroll only when the item is hidden. */
		const reveal = (mode) => {
			const a = root.querySelector(".lp-active");
			if (!a) return;
			const headH = head.offsetHeight;
			const top = a.offsetTop;
			const bottom = top + a.offsetHeight;
			let next = null;
			if (mode === "center") next = top - headH - (root.clientHeight - headH - a.offsetHeight) / 2;
			else if (top < root.scrollTop + headH) next = top - headH;
			else if (bottom > root.scrollTop + root.clientHeight) next = bottom - root.clientHeight;
			if (next !== null) root.scrollTop = Math.max(0, next);
		};
		const setOpen = (open) => {
			root.classList.toggle("lp-closed", !open);
			toggle.hidden = open;
			handle.hidden = !open || !resizable;
			if (open) reveal("center");
		};
		toggle.onclick = () => setOpen(true);
		close.onclick = () => setOpen(false);
		const makeItem = (it) => {
			const d = el$1("div", "lp-item");
			d.dataset.i = it.index;
			d.title = it.title;
			d.tabIndex = 0;
			d.setAttribute("role", "button");
			const info = el$1("div", "lp-info");
			info.append(el$1("div", "lp-title", it.title));
			if (it.channel) info.append(el$1("div", "lp-chan", it.channel));
			if (it.thumbnail) {
				const t = el$1("div", "lp-thumb");
				const img = new Image();
				img.src = it.thumbnail;
				img.alt = "";
				img.loading = "lazy";
				t.append(img, el$1("span", "lp-tn", String(it.index + 1)));
				d.append(t, info);
			} else d.append(el$1("span", "lp-num", String(it.index + 1).padStart(2, "0")), info);
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
		const groups = groupBySeason(items, entry.seasonCounts);
		if (!groups) items.forEach((it) => root.append(makeItem(it)));
		else groups.forEach((g) => {
			const sec = el$1("div", "lp-season");
			const sh = el$1("div", "lp-sh", `${g.label} (${g.end - g.start})`);
			sh.onclick = () => sec.classList.toggle("lp-collapsed");
			sec.append(sh, ...items.slice(g.start, g.end).map(makeItem));
			if (!(index >= g.start && index < g.end)) sec.classList.add("lp-collapsed");
			root.append(sec);
		});
		let drag = null;
		handle.tabIndex = 0;
		handle.title = "Drag to resize (double-click to reset)";
		handle.setAttribute("role", "separator");
		handle.onpointerdown = (e) => {
			if (e.button) return;
			drag = {
				x: e.clientX,
				w: root.getBoundingClientRect().width
			};
			handle.setPointerCapture(e.pointerId);
			host.classList.add("lp-resizing");
			e.preventDefault();
		};
		handle.onpointermove = (e) => {
			if (drag) width = setWidth(drag.w + drag.x - e.clientX);
		};
		handle.onpointerup = handle.onpointercancel = () => {
			if (!drag) return;
			drag = null;
			host.classList.remove("lp-resizing");
			widths?.set(width);
		};
		handle.ondblclick = () => {
			width = setWidth(defaultWidth);
			widths?.clear();
		};
		handle.onkeydown = (e) => {
			if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
			e.preventDefault();
			width = setWidth(root.getBoundingClientRect().width + (e.key === "ArrowLeft" ? 16 : -16));
			widths?.set(width);
		};
		host.append(root, toggle, handle);
		const setActive = (i, mode = "nearest") => {
			root.querySelectorAll(".lp-item").forEach((n) => n.classList.toggle("lp-active", +n.dataset.i === i));
			root.querySelector(".lp-active")?.closest(".lp-season")?.classList.remove("lp-collapsed");
			if (!fromUser) reveal(mode);
		};
		setOpen(cfg?.open ?? false);
		setActive(index, "center");
		return {
			setActive,
			destroy() {
				root.remove();
				toggle.remove();
				handle.remove();
			}
		};
	}
	/**
	* Navigation renderer contract (region.attachNav(container, renderer)), called on every state or entries change:
	*   ctx { container, region, entries, state, isActive(entryOrKey), go(target, opts),
	*         next(opts), previous(opts), back(), forward() }
	* It must be idempotent: update in place rather than rebuilding, or focus is lost on click.
	*/
	function defaultNavRenderer({ container, entries, isActive, go }) {
		if (container.dataset.lpCount !== String(entries.length)) {
			container.dataset.lpCount = String(entries.length);
			container.replaceChildren(...entries.map((entry) => {
				const b = el$1("button", "lp-nav-item");
				b.type = "button";
				b.dataset.key = entry.key;
				if (entry.thumbnail) {
					const img = new Image();
					img.src = entry.thumbnail;
					img.alt = "";
					img.loading = "lazy";
					b.append(img);
				}
				b.append(el$1("span", "lp-nav-title", entry.title || entry.key));
				b.onclick = () => go(entry);
				return b;
			}));
		}
		container.querySelectorAll(".lp-nav-item").forEach((b) => {
			const on = isActive(b.dataset.key);
			b.classList.toggle("lp-active", on);
			on ? b.setAttribute("aria-current", "true") : b.removeAttribute("aria-current");
		});
	}
	// src/styles.js
	var CSS = `
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
.lp-nav-item{display:flex;align-items:center;gap:8px;padding:0;border:2px solid transparent;border-radius:6px;background:none;cursor:pointer;overflow:hidden;font:inherit;color:inherit}
.lp-nav-item img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover}
.lp-nav-item.lp-active{border-color:var(--lp-accent,#f7931e)}
.lp-nav-item:focus-visible{outline:2px solid var(--lp-accent,#f7931e);outline-offset:2px}
`;
	function injectStyles$1() {
		if (document.getElementById("lp-styles")) return;
		const s = el$1("style");
		s.id = "lp-styles";
		s.textContent = CSS;
		document.head.appendChild(s);
	}
	// src/region.js
	var Emitter = class {
		#h = /* @__PURE__ */ new Map();
		on(event, fn) {
			(this.#h.get(event) ?? this.#h.set(event, /* @__PURE__ */ new Set()).get(event)).add(fn);
			return () => this.#h.get(event)?.delete(fn);
		}
		emit(event, payload) {
			for (const fn of [...this.#h.get(event) ?? []]) try {
				fn(payload);
			} catch (e) {
				console.error(`[LinkPlayer] "${event}" handler failed`, e);
			}
		}
		clearHandlers() {
			this.#h.clear();
		}
	};
	/** One region's DOM: iframe + the panel produced by a renderer. */
	var RegionView = class {
		constructor({ container, panelRenderer = defaultPanelRenderer, widths = null, resizable = true }) {
			injectStyles$1();
			this._c = container;
			container.classList.add("lp-host");
			this._renderer = panelRenderer;
			this._widths = widths;
			this._resizable = resizable;
			this._handle = null;
			this._adopted = null;
			this._hadAdopted = false;
		}
		setPanelRenderer(fn) {
			this._renderer = fn;
		}
		/** An iframe already in the page: the next showEmbed() reuses it. */
		adoptIframe(iframe) {
			this._adopted = iframe;
			this._hadAdopted = true;
		}
		showEmbed(src, title) {
			this._dropPanel();
			if (this._adopted) {
				const f = this._adopted;
				this._adopted = null;
				f.title ||= title;
				if (f.src !== src) f.src = src;
				return f;
			}
			const f = el$1("iframe", "lp-frame");
			f.src = src;
			f.title = title;
			f.allow = "autoplay; fullscreen; picture-in-picture; web-share";
			f.allowFullscreen = true;
			f.referrerPolicy = "strict-origin-when-cross-origin";
			this._c.replaceChildren(f);
			return f;
		}
		showPanel(ctx) {
			this._dropPanel();
			this._handle = this._renderer({
				host: this._c,
				widths: this._widths,
				resizable: this._resizable,
				...ctx
			}) ?? null;
		}
		setActive(i) {
			this._handle?.setActive?.(i);
		}
		clear() {
			this._dropPanel();
			this._c.replaceChildren();
		}
		/** Releases the container. An adopted iframe belongs to the page: it is left in place. */
		dispose() {
			this._dropPanel();
			if (!this._hadAdopted) this._c.replaceChildren();
			this._c.classList.remove("lp-host");
			this._c.style.removeProperty("--lp-w");
		}
		_dropPanel() {
			this._handle?.destroy?.();
			this._handle = null;
		}
	};
	/**
	* A zone (data-target). Events: "change" { entry, itemIndex } · "state" snapshot · "items" { entry, items }
	* · "entries" { entry } · "error" { error, entry }.
	*/
	var Region = class extends Emitter {
		constructor({ target, container, registry, store = null, panel = true, panelRenderer, navRenderer = defaultNavRenderer, resizable = true }) {
			super();
			this.target = target;
			this.container = container;
			this.sets = [];
			this.entries = [];
			this.persist = true;
			this._registry = registry;
			this._navRenderer = navRenderer;
			this._byKey = /* @__PURE__ */ new Map();
			this._auto = /* @__PURE__ */ new Map();
			this._navs = /* @__PURE__ */ new Set();
			const widths = resizable && store ? {
				get: () => store.get("panel-width"),
				set: (w) => store.set("panel-width", w),
				clear: () => store.remove("panel-width")
			} : null;
			this.view = new RegionView({
				container,
				panelRenderer,
				widths,
				resizable
			});
			this.navigation = new NavigationService({
				region: this,
				view: this.view,
				panel
			});
		}
		/** providerId: "youtube" | "okru" | "dailymotion" | any registered id. */
		createSet(providerId, commonProps = {}) {
			const set = new EntrySet(this, this._registry.get(providerId), commonProps);
			this.sets.push(set);
			return set;
		}
		/** Set that receives the detected links of a provider (created on demand). */
		detectedSet(provider) {
			if (!this._auto.has(provider.id)) this._auto.set(provider.id, this.createSet(provider.id));
			return this._auto.get(provider.id);
		}
		setPanelRenderer(fn) {
			this.view.setPanelRenderer(fn);
		}
		_register(set, entry) {
			if (this._byKey.has(entry.key)) throw new DuplicateEntryError(entry.key);
			this._byKey.set(entry.key, entry);
			this.entries.push(entry);
			this.emit("entries", { entry });
		}
		_remove(entry) {
			if (this._byKey.get(entry.key) !== entry) return;
			this._byKey.delete(entry.key);
			this.entries.splice(this.entries.indexOf(entry), 1);
			entry.set?.entries.splice(entry.set.entries.indexOf(entry), 1);
			if (this.navigation.entry === entry) this.navigation.hide();
			this.emit("entries", { entry });
		}
		/** Key, or any url of a registered video (youtu.be and watch?v= match). */
		find(ref) {
			if (typeof ref !== "string") return null;
			const hit = this._byKey.get(ref) ?? this.entries.find((e) => e.url === ref);
			if (hit || !isUrl(ref)) return hit ?? null;
			try {
				const p = this._registry.resolve(ref);
				return this._byKey.get(p.keyOf(p.parse(ref))) ?? null;
			} catch {
				return null;
			}
		}
		/** Registers an unknown url on the fly. @throws UnsupportedUrlError */
		ensureEntry(url) {
			return this.find(url) ?? this.detectedSet(this._registry.resolve(url))._add(url, {}, "link");
		}
		/** Entry | index | key | url → Entry (or null). */
		resolveTarget(target) {
			if (target && typeof target === "object") return this._byKey.get(target.key) === target ? target : null;
			if (typeof target === "number") return this.entries[target] ?? null;
			if (typeof target === "string") return this.find(target) ?? (isUrl(target) ? this.ensureEntry(target) : null);
			return null;
		}
		getState() {
			const nav = this.navigation;
			const key = nav.entry?.key;
			return {
				target: this.target,
				isOpen: nav.isOpen,
				entry: nav.entry,
				entryIndex: key ? this.entries.findIndex((e) => e.key === key) : -1,
				entryCount: this.entries.length,
				itemIndex: nav.itemIndex,
				hasNextLink: !!neighbourEntry(this.entries, key, 1),
				hasPreviousLink: !!neighbourEntry(this.entries, key, -1),
				canGoBack: nav.journal.canGoBack,
				canGoForward: nav.journal.canGoForward
			};
		}
		/** Renders the entries of this region as buttons/images in `container`. Returns a detach function. */
		attachNav(container, renderer = this._navRenderer) {
			const host = typeof container === "string" ? document.getElementById(container) : container;
			if (!host) throw new Error(`Navigation container not found: "${container}"`);
			const nav = this.navigation;
			const render = () => {
				const state = this.getState();
				renderer({
					container: host,
					region: this,
					entries: this.entries,
					state,
					isActive: (k) => state.isOpen && state.entry?.key === (k?.key ?? k),
					go: (t, o) => nav.go(t, o),
					next: (o) => nav.nextLink(o),
					previous: (o) => nav.previousLink(o),
					back: () => nav.back(),
					forward: () => nav.forward()
				});
			};
			let pending = false;
			const schedule = () => {
				if (pending) return;
				pending = true;
				queueMicrotask(() => {
					pending = false;
					render();
				});
			};
			const offs = [this.on("state", schedule), this.on("entries", schedule)];
			const detach = () => {
				offs.forEach((off) => off());
				this._navs.delete(detach);
				host.replaceChildren();
				delete host.dataset.lpCount;
			};
			this._navs.add(detach);
			render();
			return detach;
		}
		dispose() {
			[...this._navs].forEach((d) => d());
			this.navigation.dispose();
			this.view.dispose();
			this.clearHandlers();
		}
	};
	// src/linkScanner.js
	var intAttr = (v) => v != null && /^\d+$/.test(v) ? +v : null;
	/** [data-link] elements: <a href> or any element with data-url. */
	function readLinks(root) {
		return [...root.querySelectorAll("[data-link]")].map(readLink).filter(Boolean);
	}
	function readLink(node) {
		const d = node.dataset;
		const url = (node.tagName === "A" ? node.href : d.url) || "";
		if (!url) return null;
		return {
			link: node,
			url,
			target: d.target ?? "",
			meta: {
				key: d.key || void 0,
				title: d.title || node.textContent.trim(),
				channel: d.channel,
				thumbnail: d.thumbnail || node.querySelector("img")?.src || void 0,
				autoplay: node.hasAttribute("data-autoplay") ? toAutoplayMode(d.autoplay) : "none",
				showOnInit: node.hasAttribute("data-show-on-init") && d.showOnInit !== "false",
				startIndex: intAttr(d.index),
				seasonCounts: d.seasons ? d.seasons.split(",").map(Number).filter((n) => n > 0) : null,
				panel: d.panel !== "false"
			}
		};
	}
	// src/tooltip.js
	/** Thumbnail tooltip on hover (not on touch devices). One shared element. */
	var Tooltip = class {
		constructor() {
			this._token = 0;
			this._el = null;
			this._timer = null;
			this._hideTimer = null;
			this._last = null;
			document.addEventListener("pointerdown", () => {
				clearTimeout(this._timer);
				this._hide();
			}, true);
		}
		/** provider: { id, name } of the link's provider, used for the fallback look. */
		attach(target, getThumb, title, provider = {}) {
			target.addEventListener("mouseenter", (e) => {
				this._last = e;
				this._timer = setTimeout(() => this._show(getThumb, title, provider), 120);
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
			tip.append(el("div", "lp-tip-loader"), img, el("div", "lp-tip-play"), el("span", "lp-tip-title"));
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
			const url = await Promise.race([getThumb(), new Promise((r) => setTimeout(() => r(null), 3e3))]);
			if (token !== this._token) return;
			if (!url) return fallback();
			const probe = new Image();
			probe.onload = () => {
				if (token !== this._token) return;
				if (provider.id === "youtube" && probe.naturalWidth <= 120) return fallback();
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
	};
	// src/linkPlayer.js
	var REG = globalThis[Symbol.for("linkplayer.v3")] ??= {
		live: /* @__PURE__ */ new Set(),
		seq: 0
	};
	var depthOf = (n) => {
		let d = 0;
		for (; n; n = n.parentElement) d++;
		return d;
	};
	/**
	* The single instance that handles `node`: the one with the deepest scope; the global one comes last.
	* Equal depth: the oldest. Independent of the order in which instances were created.
	*/
	function ownerOf(node) {
		if (node.closest?.("[data-lp-ignore]")) return null;
		let best = null;
		let bestDepth = -2;
		for (const p of REG.live) {
			if (!p._contains(node)) continue;
			const d = p.isGlobal ? -1 : depthOf(p.scopeEl);
			if (d > bestDepth || d === bestDepth && p._seq < best._seq) {
				best = p;
				bestDepth = d;
			}
		}
		return best;
	}
	var noop = () => {};
	return class LinkPlayer {
		static VERSION = "3.0.0";
		static get(id) {
			return [...REG.live].find((p) => p.id === id) ?? null;
		}
		static get instances() {
			return [...REG.live];
		}
		/**
		* @param o.id             unique name (default "lp-N")
		* @param o.scope          element, id or selector. Omitted: global (everything no scoped instance owns)
		* @param o.panelRenderer  override the playlist panel (see renderers.js)
		* @param o.navRenderer    default renderer of region.attachNav()
		* @param o.scanEmbeds     adopt existing playlist iframes
		* @param o.onChange       (target, entry|null)
		* @param o.onState        (target, state) after every navigation, hide, show, close
		* @param o.onError        (error, entryOrInfo?)
		*/
		constructor({ id = null, scope = null, registry = null, store = null, useStorage = true, panel = true, panelRenderer = defaultPanelRenderer, navRenderer = defaultNavRenderer, resizable = true, tooltip = true, scanEmbeds = true, activeClass = "is-active", youtubeApiKey = null, okruEmbedBaseUrl, dailymotionPlayerId = null, onChange = noop, onState = noop, onError = (e) => console.warn("[LinkPlayer]", e) } = {}) {
			this.scopeEl = resolveScope(scope);
			this.isGlobal = this.scopeEl === null;
			this._seq = ++REG.seq;
			this.id = id ?? `lp-${this._seq}`;
			if (LinkPlayer.get(this.id)) throw new Error(`LinkPlayer id already in use: "${this.id}"`);
			this._store = store ?? (useStorage ? defaultStore() : new MemoryStore());
			this.registry = registry ?? new ProviderRegistry([
				new YouTubeProvider({
					apiKey: youtubeApiKey,
					store: this._store
				}),
				new DailymotionProvider({ playerId: dailymotionPlayerId }),
				new OkruProvider({ embedBaseUrl: okruEmbedBaseUrl })
			]);
			Object.assign(this, {
				_useStorage: useStorage,
				_panel: panel,
				_panelRenderer: panelRenderer,
				_navRenderer: navRenderer,
				_resizable: resizable,
				_scanEmbeds: scanEmbeds,
				_activeClass: activeClass,
				_onChange: onChange,
				_onState: onState,
				_onError: onError
			});
			this._tooltip = tooltip && !isTouch() ? new Tooltip() : null;
			this._regions = /* @__PURE__ */ new Map();
			this._bound = /* @__PURE__ */ new Map();
			this._failed = /* @__PURE__ */ new WeakSet();
			this._queued = /* @__PURE__ */ new WeakSet();
			this._embedCount = 0;
			this._destroyed = false;
			REG.live.add(this);
			for (const p of REG.live) if (p !== this) p._reconcile();
			this.scan();
		}
		_contains(node) {
			return this.isGlobal || this.scopeEl.contains(node);
		}
		getRegion(target, container = document.getElementById(target)) {
			let region = this._regions.get(target);
			if (region) return region;
			if (!container) throw new Error(`Target not found: "${target}"`);
			region = new Region({
				target,
				container,
				registry: this.registry,
				store: this._store,
				panel: this._panel,
				panelRenderer: this._panelRenderer,
				navRenderer: this._navRenderer,
				resizable: this._resizable
			});
			region.on("change", ({ entry, itemIndex }) => this._persist(region, entry, itemIndex));
			region.on("state", (s) => this._syncActive(region, s));
			region.on("entries", () => this._scheduleInit(region));
			region.on("error", ({ error, entry }) => this._onError(error, entry));
			this._regions.set(target, region);
			return region;
		}
		get regions() {
			return [...this._regions.values()];
		}
		nextLink(target, opts) {
			return this._regions.get(target)?.navigation.nextLink(opts) ?? false;
		}
		previousLink(target, opts) {
			return this._regions.get(target)?.navigation.previousLink(opts) ?? false;
		}
		scan() {
			if (this._destroyed) return;
			const root = this.scopeEl ?? document;
			let infos = [];
			try {
				infos = readLinks(root);
			} catch (error) {
				return this._onError(error);
			}
			for (const info of infos) if (!this._bound.has(info.link) && !this._failed.has(info.link) && ownerOf(info.link) === this) this._bindLink(info);
			if (this._scanEmbeds) try {
				this._adoptEmbeds(root);
			} catch (error) {
				this._onError(error);
			}
			this._regions.forEach((r) => this._init(r));
		}
		/** An unsupported link is reported once and left alone: a click follows its href. */
		_bindLink({ link, url, target, meta }) {
			let region, entry;
			try {
				if (!target) throw new Error(`data-target is required (${url})`);
				const provider = this.registry.resolve(url);
				region = this.getRegion(target);
				entry = region.detectedSet(provider)._add(url, meta, "link", { link });
			} catch (error) {
				this._failed.add(link);
				return this._onError(error, {
					url,
					link
				});
			}
			const onClick = (e) => {
				e.preventDefault();
				region.navigation.toggle(entry);
			};
			link.addEventListener("click", onClick);
			const detachTip = this._tooltip?.attach(link, () => entry.resolveThumbnail(), entry.title, {
				id: entry.provider.id,
				name: entry.provider.name
			});
			this._bound.set(link, {
				region,
				entry,
				off: () => {
					link.removeEventListener("click", onClick);
					detachTip?.();
					link.classList.remove(this._activeClass);
				}
			});
		}
		/** Host of an existing iframe: its own parent when it holds only the iframe (.video-container...), else a wrapper. */
		_hostFor(iframe) {
			const p = iframe.parentElement;
			if (p && p !== this.scopeEl && p !== document.body && p.children.length === 1 && !p.textContent.trim()) return p;
			const w = +iframe.getAttribute("width") || 0;
			const h = +iframe.getAttribute("height") || 0;
			const wrap = document.createElement("div");
			wrap.style.cssText = `width:100%;${w ? `max-width:${w}px;` : ""}aspect-ratio:${w && h ? `${w}/${h}` : "16/9"}`;
			iframe.replaceWith(wrap);
			wrap.append(iframe);
			iframe.classList.add("lp-frame");
			return wrap;
		}
		_adoptEmbeds(root) {
			root.querySelectorAll("iframe").forEach((iframe) => {
				if (this._bound.has(iframe) || iframe.closest(".lp-host") || iframe.dataset.panel === "false") return;
				if (ownerOf(iframe) !== this) return;
				let url, provider, parsed;
				try {
					url = new URL(iframe.getAttribute("src") ?? "", location.href).href;
					provider = this.registry.resolve(url);
					parsed = provider.parse(url);
				} catch {
					return;
				}
				if (!provider.panel || !parsed.isCollection) return;
				try {
					const target = `embed-${this.id}-${++this._embedCount}`;
					const region = this.getRegion(target, this._hostFor(iframe));
					region.persist = false;
					region.view.adoptIframe(iframe);
					const entry = region.detectedSet(provider)._add(url, { key: target }, "embed");
					this._bound.set(iframe, {
						region,
						entry,
						off: () => {}
					});
					region.navigation.go(entry, { autoplay: false });
				} catch (error) {
					this._onError(error);
				}
			});
		}
		_scheduleInit(region) {
			if (this._queued.has(region)) return;
			this._queued.add(region);
			queueMicrotask(() => {
				this._queued.delete(region);
				if (!this._destroyed) this._init(region);
			});
		}
		/** Restore the saved entry/item (paused: browsers block autoplay on load), otherwise showOnInit. */
		_init(region) {
			const nav = region.navigation;
			if (nav.hasNavigated || !region.entries.length) return;
			const saved = this._useStorage && region.persist ? this._store.get(`state:${region.target}`) : null;
			const restored = saved && (region.find(saved.key) ?? region.find(saved.url));
			if (restored) return void nav.go(restored, {
				itemIndex: saved.index,
				autoplay: false
			});
			const first = region.entries.find((e) => e.showOnInit);
			if (first) nav.go(first, { reason: "init" });
		}
		_persist(region, entry, itemIndex) {
			if (this._useStorage && region.persist) {
				const k = `state:${region.target}`;
				entry ? this._store.set(k, {
					key: entry.key,
					url: entry.url,
					index: itemIndex
				}) : this._store.remove(k);
			}
			this._onChange(region.target, entry);
		}
		_syncActive(region, state) {
			for (const e of region.entries) e.link?.classList.toggle(this._activeClass, state.isOpen && e === state.entry);
			this._onState(region.target, state);
		}
		/** Releases elements that a narrower scope now owns. */
		_reconcile() {
			for (const node of [...this._bound.keys()]) if (ownerOf(node) !== this) this._unbind(node);
		}
		_unbind(node) {
			const rec = this._bound.get(node);
			if (!rec) return;
			this._bound.delete(node);
			rec.off();
			rec.region._remove(rec.entry);
			if (!rec.region.entries.length) {
				this._regions.delete(rec.region.target);
				rec.region.dispose();
			}
		}
		/** Releases every link, listener and player. The saved state is kept. Idempotent. */
		destroy() {
			if (this._destroyed) return;
			this._destroyed = true;
			REG.live.delete(this);
			for (const node of [...this._bound.keys()]) this._unbind(node);
			this._regions.forEach((r) => r.dispose());
			this._regions.clear();
			this._tooltip?.dispose();
			for (const p of REG.live) p.scan();
		}
	};
});

//# sourceMappingURL=link-player.js.map