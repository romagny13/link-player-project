(function(global, factory) {
	typeof exports === "object" && typeof module !== "undefined" ? module.exports = factory() : typeof define === "function" && define.amd ? define([], factory) : (global = typeof globalThis !== "undefined" ? globalThis : global || self, global.LinkPlayer = factory());
})(this, function() {
	// src/utils/dom.js
	function resolveScope(scope) {
		if (scope == null) return null;
		if (typeof scope === "string") {
			let node = document.getElementById(scope);
			if (!node) try {
				node = document.querySelector(scope);
			} catch {}
			if (node) return node;
		}
		throw new Error(`Scope not found: ${String(scope)}`);
	}
	function injectStyles(id, CSS) {
		if (document.getElementById(id)) return;
		const s = document.createElement("style");
		s.id = id;
		s.textContent = CSS;
		document.head.appendChild(s);
	}
	function makeIframe({ width, height, src, allow, title, referrerPolicy, allowFullscreen = true, extraAttrs = {} }) {
		const iframe = document.createElement("iframe");
		if (width) iframe.width = width;
		if (height) iframe.height = height;
		if (!src) throw new TypeError("makeIframe(): src is required");
		iframe.src = src;
		if (title) iframe.title = title;
		iframe.frameBorder = "0";
		if (allow) iframe.allow = allow;
		if (referrerPolicy) iframe.referrerPolicy = referrerPolicy;
		if (allowFullscreen) iframe.allowFullscreen = true;
		for (const [k, v] of Object.entries(extraAttrs)) iframe.setAttribute(k, v);
		return iframe;
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
	// src/utils/helpers.js
	var toInt = (value) => {
		const n = parseInt(value, 10);
		return Number.isNaN(n) ? void 0 : n;
	};
	var toNumber = (value) => {
		if (value === void 0 || value === null || String(value).trim() === "") return void 0;
		const n = Number(value);
		return Number.isNaN(n) ? void 0 : n;
	};
	/** data-x (present, "", "true") -> true; absent, "false", "0", "no" -> false. */
	function toBoolean(value) {
		if (value === void 0 || value === null) return false;
		return ![
			"false",
			"0",
			"no"
		].includes(String(value).trim().toLowerCase());
	}
	var isEmpty = (v) => v === "" || v == null;
	var isTouch = () => !!globalThis.matchMedia?.("(hover: none) and (pointer: coarse)").matches;
	var AUTOPLAY_MODES = Object.freeze({
		NONE: "none",
		INIT: "init",
		CLICK: "click"
	});
	function toAutoplayMode(value) {
		if (value === void 0 || value === null) return AUTOPLAY_MODES.NONE;
		const v = String(value).trim().toLowerCase();
		if (v === "" || v === "true") return AUTOPLAY_MODES.INIT;
		if (v === "click") return AUTOPLAY_MODES.CLICK;
		return AUTOPLAY_MODES.NONE;
	}
	// src/utils/Emitter.js
	/**
	* Minimal event emitter. Handlers receive `{type, ...data}`.
	* "*" receives every event. A failing handler does not break the others.
	*/
	var Emitter = class {
		#handlers = /* @__PURE__ */ new Map();
		/** @returns {() => void} Function that removes the handler. */
		on(type, handler) {
			if (!this.#handlers.has(type)) this.#handlers.set(type, /* @__PURE__ */ new Set());
			this.#handlers.get(type).add(handler);
			return () => this.off(type, handler);
		}
		off(type, handler) {
			this.#handlers.get(type)?.delete(handler);
		}
		/** @returns {number} How many handlers were called (0: nobody listens). */
		emit(type, data = {}) {
			const event = {
				...data,
				type
			};
			const handlers = [...this.#handlers.get(type) ?? [], ...this.#handlers.get("*") ?? []];
			for (const handler of handlers) try {
				handler(event);
			} catch (error) {
				console.error(`[Emitter] handler of "${type}" failed`, error);
			}
			return handlers.length;
		}
		clear() {
			this.#handlers.clear();
		}
	};
	// src/ui/ThumbnailService.js
	var ThumbnailService = class {
		#pending = /* @__PURE__ */ new Map();
		/** @param {{ createImage?: () => HTMLImageElement }} options Injectable for tests. */
		constructor({ createImage = () => new Image() } = {}) {
			this.createImage = createImage;
		}
		/** @returns {Promise<string|null>} The url if it loads as an image, null otherwise. Never rejects. */
		resolve(url) {
			if (!url) return Promise.resolve(null);
			if (!this.#pending.has(url)) {
				const p = this.#load(url);
				this.#pending.set(url, p);
				p.then((result) => {
					if (!result) this.#pending.delete(url);
				});
			}
			return this.#pending.get(url);
		}
		#load(url) {
			return new Promise((resolve) => {
				const image = this.createImage();
				image.onload = () => resolve(url);
				image.onerror = () => resolve(null);
				image.src = url;
			});
		}
	};
	// src/ui/PanelRenderer.js
	var PANEL_CSS = `
:where(.lp-panel){
  --_bg:var(--lp-bg,#141414);--_line:var(--lp-border,#2a2a2a);--_hover:var(--lp-hover,#1e1e1e);
  --_text:var(--lp-text,#9a9a9a);--_text-on:var(--lp-text-active,#f0f0f0);--_muted:var(--lp-muted,#777);
  --_accent:var(--lp-accent,#f7931e);
  inset:0 0 0 auto;z-index:var(--lp-z,999);width:var(--lp-w,176px);max-width:70%;
  background:var(--_bg);border-left:1px solid var(--_line);color:var(--_text);
  font:12px var(--lp-font,system-ui,sans-serif);transition:transform .2s}
:where([data-lp-theme=light] .lp-panel){--_bg:var(--lp-bg,#fff);--_line:var(--lp-border,#e2e2e2);--_hover:var(--lp-hover,#f3f3f3);--_text:var(--lp-text,#555);--_text-on:var(--lp-text-active,#111);--_muted:var(--lp-muted,#999)}
:where(.lp-panel[data-open=false]){transform:translateX(100%);visibility:hidden}
:where(.lp-scroll){position:absolute;inset:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}

:where(.lp-handle){position:absolute;top:0;bottom:0;left:-5px;z-index:2;width:10px;cursor:col-resize;touch-action:none}
:where(.lp-handle)::after{content:"";position:absolute;top:0;bottom:0;left:4px;width:2px;background:var(--_accent);opacity:0;transition:opacity .15s}
:where(.lp-handle:hover,.lp-handle:focus-visible,[data-lp-resizing] .lp-handle)::after{opacity:.8}
:where(.lp-handle:focus-visible){outline:none}

:where(.lp-head){position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 8px 7px 12px;background:var(--_bg);color:var(--_muted);font-size:10px;letter-spacing:.12em;text-transform:uppercase}
:where(.lp-close){width:26px;height:26px;padding:0;cursor:pointer;border-radius:5px;border:1px solid color-mix(in srgb,var(--_accent) 35%,transparent);background:color-mix(in srgb,var(--_accent) 8%,transparent);color:var(--_accent);font:inherit}

:where(.lp-item){position:relative;display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--_line);cursor:pointer;user-select:none}
:where(.lp-item:hover,.lp-item[data-current]){background:var(--_hover)}
:where(.lp-item[data-current])::before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:var(--_accent)}
:where(.lp-item:focus-visible,.lp-group-head:focus-visible){outline:2px solid var(--_accent);outline-offset:-2px}
:where(.lp-num){min-width:18px;font-size:11px;color:var(--_muted)}
:where(.lp-item[data-current] .lp-num){color:var(--_accent)}
:where(.lp-info){flex:1;min-width:0}
:where(.lp-title){display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;line-height:1.3;color:var(--_text)}
:where(.lp-item[data-current] .lp-title){color:var(--_text-on);font-weight:500}
:where(.lp-chan,.lp-dur){margin-top:2px;font-size:10px;color:var(--_muted)}
:where(.lp-thumb){position:relative;width:80px;height:45px;flex-shrink:0;border-radius:3px;overflow:hidden;background:#1a1a1a}
:where(.lp-thumb img){display:block;width:100%;height:100%;object-fit:cover}
:where(.lp-tn){position:absolute;right:3px;bottom:2px;padding:1px 4px;border-radius:2px;background:rgba(0,0,0,.7);color:#fff;font-size:9px}

:where(.lp-group-head){display:block;width:100%;padding:8px 12px;border:0;border-bottom:1px solid var(--_line);background:var(--_hover);color:var(--_text);font:inherit;font-size:11px;letter-spacing:.08em;text-transform:uppercase;text-align:left;cursor:pointer;user-select:none}
:where(.lp-group[data-collapsed] .lp-group-items){display:none}

:where(.lp-toggle){position:absolute;z-index:calc(var(--lp-z,999) + 1);width:36px;height:36px;padding:0;border:0;border-radius:50%;background:var(--lp-toggle-bg,rgba(0,0,0,.55));color:var(--lp-toggle-color,#fff);font-size:18px;cursor:pointer;opacity:0;transition:opacity .15s}
:where(.lp-toggle[data-pos=top-right]){top:8px;right:60px}
:where(.lp-toggle[data-pos=bottom-left]){left:140px;bottom:20px}
:where(.lp-host:hover .lp-toggle,.lp-toggle:focus-visible){opacity:1}
@media(hover:none){:where(.lp-toggle){opacity:1}}

/* Anchor positioning: the panel and the toggle follow the box of the iframe, whatever its size or class.
   Without support, the rules above (panel fitted to the host) stay in force. */
@supports (anchor-name:--a){
  :where(.lp-host[data-lp-anchored] .lp-panel){
    position-anchor:var(--lp-anchor);
    top:anchor(top,0px);bottom:anchor(bottom,0px);right:anchor(right,0px);left:auto;
    max-width:calc(anchor-size(width,100%) * .7);
    position-visibility:anchors-visible}
  :where(.lp-host[data-lp-anchored] .lp-toggle){position-anchor:var(--lp-anchor);position-visibility:anchors-visible}
  :where(.lp-host[data-lp-anchored] .lp-toggle[data-pos=top-right]){top:calc(anchor(top,0px) + 8px);right:calc(anchor(right,0px) + 60px)}
  :where(.lp-host[data-lp-anchored] .lp-toggle[data-pos=bottom-left]){left:calc(anchor(left,0px) + 140px);bottom:calc(anchor(bottom,0px) + 20px)}
}
`;
	function ensureRelative(el) {
		if (getComputedStyle(el).position === "static") el.style.position = "relative";
	}
	var CAN_ANCHOR = globalThis.CSS?.supports?.("anchor-name", "--a") ?? false;
	var anchorId = 0;
	var PanelRenderer = class {
		#host = null;
		#iframe = null;
		#panel = null;
		#scroll = null;
		#handle = null;
		#toggle = null;
		#info = null;
		#onSelectItem = null;
		#open = null;
		#current = null;
		#collapsed = null;
		#width = 176;
		#defaultWidth = 176;
		#anchorName = null;
		#itemRenderer = null;
		#headerRenderer = null;
		#toggleRenderer = null;
		#groupRenderer = null;
		#options = {
			handleWidth: 10,
			header: true,
			open: true,
			togglePosition: void 0,
			seasons: true
		};
		constructor(options = {}, itemRenderer = null, headerRenderer = null, toggleRenderer = null, groupRenderer = null, thumbnails = null) {
			if (options.handleWidth) this.#options.handleWidth = options.handleWidth;
			if (options.header === false) this.#options.header = false;
			if (options.open !== void 0) this.#options.open = Boolean(options.open);
			if (options.togglePosition !== void 0) this.#options.togglePosition = options.togglePosition;
			if (options.seasons !== void 0) this.#options.seasons = options.seasons;
			this.#itemRenderer = itemRenderer ?? new ItemRenderer(thumbnails);
			this.#headerRenderer = headerRenderer ?? new HeaderRenderer();
			this.#toggleRenderer = toggleRenderer ?? new ToggleRenderer();
			this.#groupRenderer = groupRenderer ?? new GroupRenderer();
		}
		render({ host = null, iframe = null, info, current = null, onSelectItem = null, widths = null }) {
			host = host ?? iframe?.parentElement;
			if (!host) throw new Error("[PanelRenderer] host or an attached iframe is required");
			if (this.#host && this.#host !== host) this.clear();
			iframe = iframe ?? this.#iframe;
			injectStyles("lp-panel-styles", PANEL_CSS);
			const items = info.videos ?? [info];
			this.#host = host;
			this.#info = info;
			this.#onSelectItem = onSelectItem;
			this.#current = current ?? info.index ?? null;
			this.#defaultWidth = items.some((item) => item.thumbnailPath) ? 280 : 176;
			this.#setupHost(host);
			this.#setupAnchor(iframe);
			const saved = Number(widths?.get());
			this.#setWidth(saved > 0 ? saved : this.#defaultWidth);
			this.#ensurePanel();
			this.#ensureResizeHandle(widths);
			this.#fillPanel(items);
			this.#ensureToggle();
			this.#setOpen(this.#open ?? this.#options.open);
			this.#placeAfterIframe();
		}
		/** Marks the item that is playing, without drawing the panel again. */
		setCurrent(index, iframe = this.#iframe) {
			if (this.#host && iframe !== this.#iframe) {
				this.#setupAnchor(iframe);
				this.#placeAfterIframe();
			}
			this.#current = index;
			if (!this.#scroll) return;
			for (const row of this.#scroll.querySelectorAll("[data-index]")) {
				const isCurrent = Number(row.dataset.index) === index;
				row.toggleAttribute("data-current", isCurrent);
				if (isCurrent) {
					row.setAttribute("aria-current", "true");
					const group = row.closest(".lp-group");
					if (group?.hasAttribute("data-collapsed")) this.#setCollapsed(group, false);
					row.scrollIntoView?.({ block: "nearest" });
				} else row.removeAttribute("aria-current");
			}
		}
		clear() {
			this.#releaseAnchor();
			this.#panel?.remove();
			this.#panel = null;
			this.#scroll = null;
			this.#handle = null;
			this.#toggle?.remove();
			this.#toggle = null;
			this.#open = null;
			this.#current = null;
			this.#collapsed = null;
			this.#host?.style.removeProperty("--lp-w");
			this.#host?.classList.remove("lp-host");
			this.#host = null;
			this.#iframe = null;
		}
		destroy() {
			this.clear();
		}
		#setupHost(host) {
			host.classList.add("lp-host");
			ensureRelative(host);
		}
		#setupAnchor(iframe) {
			if (this.#iframe && this.#iframe !== iframe) this.#iframe.style.removeProperty("anchor-name");
			this.#iframe = iframe;
			if (!iframe || !CAN_ANCHOR) {
				this.#host.style.removeProperty("--lp-anchor");
				delete this.#host.dataset.lpAnchored;
				return;
			}
			const name = this.#anchorName ??= `--lp-a${++anchorId}`;
			iframe.style.setProperty("anchor-name", name);
			this.#host.style.setProperty("--lp-anchor", name);
			this.#host.dataset.lpAnchored = "";
		}
		#releaseAnchor() {
			this.#iframe?.style.removeProperty("anchor-name");
			this.#host?.style.removeProperty("--lp-anchor");
			if (this.#host) delete this.#host.dataset.lpAnchored;
		}
		#setWidth(px) {
			const box = this.#iframe?.offsetWidth || this.#host?.clientWidth || 0;
			const min = 120;
			const max = Math.max(min, box * .7);
			const width = Math.max(min, Math.min(max, Math.round(px)));
			this.#host?.style.setProperty("--lp-w", `${width}px`);
			this.#width = width;
			return width;
		}
		#ensureResizeHandle(widths) {
			if (this.#handle) return;
			const handle = document.createElement("div");
			handle.className = "lp-handle";
			const w = this.#options.handleWidth;
			Object.assign(handle.style, {
				position: "absolute",
				top: "0",
				bottom: "0",
				left: `${-w / 2}px`,
				width: `${w}px`
			});
			handle.tabIndex = 0;
			handle.title = "Drag to resize (double-click to reset)";
			handle.setAttribute("role", "separator");
			handle.setAttribute("aria-orientation", "vertical");
			let drag = null;
			handle.onpointerdown = (e) => {
				if (e.button !== 0) return;
				drag = {
					startX: e.clientX,
					startWidth: this.#width
				};
				handle.setPointerCapture?.(e.pointerId);
				this.#host.dataset.lpResizing = "";
				this.#host.style.userSelect = "none";
				this.#host.style.cursor = "col-resize";
				if (this.#iframe) this.#iframe.style.pointerEvents = "none";
				e.preventDefault();
			};
			handle.onpointermove = (e) => {
				if (!drag) return;
				this.#setWidth(drag.startWidth + (drag.startX - e.clientX));
			};
			const endDrag = () => {
				if (!drag) return;
				drag = null;
				delete this.#host.dataset.lpResizing;
				this.#host.style.userSelect = "";
				this.#host.style.cursor = "";
				if (this.#iframe) this.#iframe.style.pointerEvents = "";
				widths?.set(this.#width);
			};
			handle.onpointerup = endDrag;
			handle.onpointercancel = endDrag;
			handle.ondblclick = () => {
				this.#setWidth(this.#defaultWidth);
				widths?.clear();
			};
			handle.onkeydown = (e) => {
				if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
				e.preventDefault();
				const delta = e.key === "ArrowLeft" ? 16 : -16;
				this.#setWidth(this.#width + delta);
				widths?.set(this.#width);
			};
			this.#handle = handle;
			this.#panel.appendChild(handle);
		}
		#ensurePanel() {
			if (this.#panel) return;
			const panel = document.createElement("div");
			panel.className = "lp-panel";
			panel.style.position = "absolute";
			const scroll = document.createElement("div");
			scroll.className = "lp-scroll";
			panel.appendChild(scroll);
			panel.addEventListener("click", (event) => this.#onClick(event));
			panel.addEventListener("keydown", (event) => {
				if (event.key !== "Enter" && event.key !== " ") return;
				const row = event.target.closest?.("[data-index]");
				if (!row) return;
				event.preventDefault();
				this.#select(Number(row.dataset.index));
			});
			this.#panel = panel;
			this.#scroll = scroll;
			this.#host.appendChild(panel);
		}
		#onClick(event) {
			const action = event.target.closest?.("[data-lp-action]");
			if (action?.dataset.lpAction === "close") {
				this.#setOpen(false);
				this.#toggle?.focus();
				return;
			}
			if (action?.dataset.lpAction === "toggle-group") {
				const group = action.closest(".lp-group");
				if (group) this.#setCollapsed(group, !group.hasAttribute("data-collapsed"));
				return;
			}
			const row = event.target.closest?.("[data-index]");
			if (row) this.#select(Number(row.dataset.index));
		}
		#select(index) {
			this.#onSelectItem?.(index, this.#info);
		}
		#placeAfterIframe() {
			const f = this.#iframe;
			if (!f || !this.#host.contains(f)) return;
			for (const el of [this.#panel, this.#toggle]) if (el && f.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) this.#host.appendChild(el);
		}
		#fillPanel(items) {
			const scroll = this.#scroll;
			scroll.replaceChildren();
			if (this.#options.header) scroll.appendChild(this.#headerRenderer.render({
				count: items.length,
				canClose: true
			}));
			const seasons = this.#options.seasons;
			const groups = seasons === false ? null : groupBySeason(items, Array.isArray(seasons) ? seasons : null);
			if (!groups) {
				for (let index = 0; index < items.length; index++) scroll.appendChild(this.#renderItem(items, index));
				return;
			}
			if (this.#collapsed === null) {
				const at = this.#current ?? 0;
				this.#collapsed = new Set(groups.filter((g) => at < g.start || at >= g.end).map((g) => g.label));
			}
			for (const { label, start, end } of groups) {
				const collapsed = this.#collapsed.has(label);
				const group = document.createElement("div");
				group.className = "lp-group";
				group.dataset.label = label;
				if (collapsed) group.dataset.collapsed = "";
				const body = document.createElement("div");
				body.className = "lp-group-items";
				for (let index = start; index < end; index++) body.appendChild(this.#renderItem(items, index));
				group.append(this.#groupRenderer.render({
					label,
					count: end - start,
					collapsed
				}), body);
				scroll.appendChild(group);
			}
		}
		#renderItem(items, index) {
			return this.#itemRenderer.render(items[index], index, index === this.#current);
		}
		#setCollapsed(group, collapsed) {
			group.toggleAttribute("data-collapsed", collapsed);
			group.querySelector("[data-lp-action=toggle-group]")?.setAttribute("aria-expanded", String(!collapsed));
			if (collapsed) this.#collapsed?.add(group.dataset.label);
			else this.#collapsed?.delete(group.dataset.label);
		}
		#ensureToggle() {
			if (this.#toggle) return;
			const toggle = this.#toggleRenderer.render({ position: this.#options.togglePosition });
			toggle.addEventListener("click", () => this.#setOpen(true));
			this.#toggle = toggle;
			this.#host.appendChild(toggle);
		}
		#setOpen(open) {
			this.#open = open;
			if (this.#panel) this.#panel.dataset.open = String(open);
			if (this.#toggle) this.#toggle.hidden = open;
		}
	};
	var SEASON_RE = /\b(?:saison|season)\s*0*(\d{1,3})\b|\bs0*(\d{1,2})(?:\b|(?=e\d))/i;
	/**
	* Splits the items into seasons: [{ label, start, end }] (end exclusive), or null when grouping is useless.
	* @param {Array} items Items with `item.title`.
	* @param {number[]|null} counts Explicit number of items per season; when absent, "Season 2" / "S02E05" are read from the titles.
	*/
	function groupBySeason(items, counts = null) {
		const n = items.length;
		if (counts?.length) {
			const groups = [];
			let start = 0;
			counts.forEach((count, i) => {
				if (start < n) {
					groups.push({
						label: `Season ${i + 1}`,
						start,
						end: Math.min(start + count, n)
					});
					start += count;
				}
			});
			if (start < n) groups.push({
				label: "Other",
				start,
				end: n
			});
			return groups.length > 1 ? groups : null;
		}
		const seasons = items.map((item) => {
			const match = SEASON_RE.exec(item.title ?? "");
			return match ? +(match[1] || match[2]) : null;
		});
		const first = seasons.find((season) => season !== null);
		if (first === void 0) return null;
		let current = first > 1 ? 1 : null;
		const groups = [];
		seasons.forEach((season, i) => {
			if (season !== null) current = season;
			const last = groups[groups.length - 1];
			if (last && last.key === current) last.end = i + 1;
			else groups.push({
				key: current,
				label: current === null ? "Other" : `Season ${current}`,
				start: i,
				end: i + 1
			});
		});
		return groups.length > 1 ? groups : null;
	}
	/** The head of a season: the button that folds / unfolds it. */
	var GroupRenderer = class {
		render({ label, count, collapsed }) {
			const head = document.createElement("button");
			head.type = "button";
			head.className = "lp-group-head";
			head.textContent = `${label} · ${count}`;
			head.dataset.lpAction = "toggle-group";
			head.setAttribute("aria-expanded", String(!collapsed));
			return head;
		}
	};
	/**
	* The panel reacts to `data-lp-action` on any element of its content, so a custom renderer only has to set it:
	*   "close"         hides the panel
	*   "toggle-group"  folds / unfolds the season the element belongs to
	* and to `data-index` on an item (selects it).
	*/
	var HeaderRenderer = class {
		render({ count, canClose }) {
			const head = document.createElement("div");
			head.className = "lp-head";
			const title = document.createElement("span");
			title.className = "lp-head-title";
			title.textContent = `Playlist · ${count}`;
			head.append(title);
			if (canClose) {
				const close = document.createElement("button");
				close.type = "button";
				close.className = "lp-close";
				close.textContent = "»";
				close.title = "Hide playlist";
				close.setAttribute("aria-label", "Hide playlist");
				close.dataset.lpAction = "close";
				head.append(close);
			}
			return head;
		}
	};
	var ItemRenderer = class {
		constructor(thumbnails = null) {
			this._thumbnails = thumbnails ?? new ThumbnailService();
		}
		render(item, index, isCurrent = false) {
			const title = item.title || `Video ${index + 1}`;
			const row = document.createElement("div");
			row.className = "lp-item";
			row.dataset.index = String(index);
			row.title = title;
			row.tabIndex = 0;
			row.setAttribute("role", "button");
			if (isCurrent) {
				row.dataset.current = "";
				row.setAttribute("aria-current", "true");
			}
			const text = document.createElement("div");
			text.className = "lp-info";
			const titleEl = document.createElement("div");
			titleEl.className = "lp-title";
			titleEl.textContent = title;
			text.append(titleEl);
			if (item.channel) {
				const chan = document.createElement("div");
				chan.className = "lp-chan";
				chan.textContent = item.channel;
				text.append(chan);
			}
			if (item.thumbnailPath) {
				const thumb = document.createElement("div");
				thumb.className = "lp-thumb";
				const image = document.createElement("img");
				image.alt = "";
				image.loading = "lazy";
				this._thumbnails.resolve(item.thumbnailPath).then((url) => {
					if (url) image.src = url;
					else thumb.remove();
				});
				const tn = document.createElement("span");
				tn.className = "lp-tn";
				tn.textContent = String(index + 1);
				thumb.append(image, tn);
				row.append(thumb, text);
			} else {
				const num = document.createElement("span");
				num.className = "lp-num";
				num.textContent = String(index + 1).padStart(2, "0");
				row.append(num, text);
			}
			return row;
		}
	};
	var ToggleRenderer = class {
		/** @param {{ position?: string | object }} options Default position, used when the panel does not give one. */
		constructor({ position = "top-right" } = {}) {
			this.defaultPosition = position;
		}
		render({ position = this.defaultPosition } = {}) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "lp-toggle";
			button.textContent = "☰";
			button.title = "Show playlist";
			button.setAttribute("aria-label", "Show playlist");
			if (typeof position === "string") button.dataset.pos = position;
			else Object.assign(button.style, position);
			return button;
		}
	};
	// src/NavigationJournal.js
	/**
	* History of a region: stores navigation STATE ({info, index}), never views.
	* Going back / forward only moves the cursor; it never adds an entry.
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
		get entries() {
			return Object.freeze([...this.#entries]);
		}
		push(entry) {
			this.#entries.length = this.#cursor + 1;
			this.#entries.push({ ...entry });
			this.#cursor++;
		}
		/** Replaces the current entry (history.replaceState): nothing is added, the forward history is kept. */
		replace(entry) {
			if (this.#cursor < 0) return this.push(entry);
			this.#entries[this.#cursor] = { ...entry };
		}
		/** E.g. the playlist item changed while the entry is the current one. */
		updateCurrent(patch) {
			const current = this.current;
			if (current) Object.assign(current, patch);
		}
		back() {
			return this.canGoBack ? this.#entries[--this.#cursor] : null;
		}
		forward() {
			return this.canGoForward ? this.#entries[++this.#cursor] : null;
		}
	};
	// src/Region.js
	var Region = class {
		#target;
		#host;
		#registry;
		#infos = /* @__PURE__ */ new Map();
		#journal = new NavigationJournal();
		#events = new Emitter();
		#panel;
		#player = null;
		#unsubscribe = null;
		#panelInfo = null;
		#resolveMeta;
		#resolved = /* @__PURE__ */ new WeakSet();
		#dependentViews = /* @__PURE__ */ new Map();
		#currentBehavior;
		/**
		* @param {object} options
		* @param {(info) => Promise<boolean>|boolean} [options.resolveMeta] Completes the items of a playlist (true when it changed something).
		*/
		constructor({ target, registry, currentBehavior = "toggle", resolveMeta = null, panelRenderer = null, itemRenderer = null, headerRenderer = null, toggleRenderer = null, groupRenderer = null, thumbnails = null }) {
			const host = document.getElementById(target);
			if (!host) throw new Error(`Target #${target} not found`);
			this.#target = target;
			this.#host = host;
			this.#registry = registry;
			this.#currentBehavior = currentBehavior;
			this.#resolveMeta = resolveMeta;
			this.#panel = panelRenderer ?? new PanelRenderer({
				itemRenderer,
				headerRenderer,
				toggleRenderer,
				groupRenderer,
				thumbnails
			});
		}
		get target() {
			return this.#target;
		}
		get infos() {
			return Object.freeze([...this.#infos.values()]);
		}
		get current() {
			return this.#journal.current?.info ?? null;
		}
		get currentIndex() {
			return this.#journal.current?.index ?? 0;
		}
		get isVisible() {
			return !this.#host.hidden;
		}
		/** Number of items of the current playlist / list, null when unknown, 0 for a single video. */
		get itemCount() {
			const info = this.current;
			if (!info?.isPlaylist) return 0;
			return info.videoIds?.length ?? (info.videos.length || null);
		}
		get canGoBack() {
			return this.#journal.canGoBack;
		}
		get canGoForward() {
			return this.#journal.canGoForward;
		}
		get canGoPreviousInfo() {
			return this.#infoIndex() > 0;
		}
		get canGoNextInfo() {
			const i = this.#infoIndex();
			return i >= 0 ? i < this.#infos.size - 1 : this.#infos.size > 0;
		}
		get canGoPreviousItem() {
			return Boolean(this.current?.isPlaylist) && this.currentIndex > 0;
		}
		get canGoNextItem() {
			if (!this.current?.isPlaylist) return false;
			const count = this.itemCount;
			return count === null || this.currentIndex < count - 1;
		}
		on(type, handler) {
			return this.#events.on(type, handler);
		}
		off(type, handler) {
			this.#events.off(type, handler);
		}
		/** @returns {boolean} false when the key is already known (same link twice). */
		add(info) {
			if (this.#infos.has(info.key)) return false;
			this.#infos.set(info.key, info);
			return true;
		}
		has(key) {
			return this.#infos.has(key);
		}
		get(key) {
			return this.#infos.get(key);
		}
		isCurrent(key) {
			const info = this.get(key);
			return !!(info && this.#journal.current?.info === info);
		}
		/** Navigating to the info that is already current toggles the view instead (no new journal entry). */
		navigate(key, options) {
			if (!this.has(key)) throw new Error(`No info found for key '${key}'`);
			if (this.isCurrent(key)) {
				if (this.#currentBehavior === "skip") return;
				if (this.#currentBehavior === "toggle") return this.toggle();
			}
			const info = this.get(key);
			this.#navigate(info, options);
		}
		#navigate(info, { autoplay = false, index = 0 } = {}) {
			this.#journal.push({
				info,
				index
			});
			this.#show(info, {
				autoplay,
				index
			}, "navigate");
		}
		replace(key, { autoplay = false, index = 0 } = {}) {
			if (!this.has(key)) throw new Error(`No info found for key '${key}'`);
			const info = this.get(key);
			this.#journal.replace({
				info,
				index
			});
			this.#show(info, {
				autoplay,
				index
			}, "replace");
		}
		goBack() {
			return this.#restore(this.#journal.back(), "back");
		}
		goForward() {
			return this.#restore(this.#journal.forward(), "forward");
		}
		nextInfo() {
			return this.#step(1);
		}
		previousInfo() {
			return this.#step(-1);
		}
		nextItem() {
			this.#player?.next();
		}
		previousItem() {
			this.#player?.previous();
		}
		playAt(index) {
			this.#player?.playAt(index);
			this.#journal.updateCurrent({ index });
			this.#panel.setCurrent(index);
			this.#changed("item");
		}
		/**
		* Takes over an iframe that is already in the page (and inside the target): the player drives it
		* and the panel is added for a playlist / list. `info` is parsed from the iframe src.
		*/
		adopt(iframe, info, { index = 0 } = {}) {
			if (!this.#host.contains(iframe)) throw new Error(`The iframe is not inside #${this.#target}`);
			this.add(info);
			this.#disposePlayer();
			this.#player = this.#registry.get(info.provider).createPlayer({ iframe });
			this.#unsubscribe = this.#player.subscribe((e) => this.#onPlayerEvent(e));
			this.#journal.push({
				info,
				index
			});
			this.#syncPanel(info, iframe, index);
			this.#changed("adopt");
			this.#resolveMetaLater(info);
		}
		toggle() {
			if (this.#host.hidden) this.show();
			else this.hide();
		}
		show() {
			this.#host.hidden = false;
			this.#changed("visibility");
		}
		hide() {
			this.#player?.pause();
			this.#host.hidden = true;
			this.#changed("visibility");
		}
		dispose() {
			this.#disposePlayer();
			this.#panel.destroy();
			this.#events.clear();
		}
		hasDependentView(id) {
			return this.#dependentViews.has(id);
		}
		registerDependentView(id, fn) {
			if (this.hasDependentView(id)) throw new Error(`Duplicate dependent view ID: '${id}' is already registered.`);
			this.#dependentViews.set(id, fn);
		}
		unregisterDependentView(id) {
			if (!this.hasDependentView(id)) {
				console.warn(`Attempted to unregister non-existent dependent view: '${id}'`);
				return false;
			}
			return this.#dependentViews.delete(id);
		}
		notifyDependentViews(info) {
			for (const [id, fn] of this.#dependentViews) try {
				fn(info);
			} catch (error) {
				console.error(`Error processing dependent view '${id}':`, error);
			}
		}
		#infoIndex() {
			return this.infos.indexOf(this.current);
		}
		#restore(entry, reason) {
			if (!entry) return false;
			this.#show(entry.info, {
				autoplay: false,
				index: entry.index
			}, reason);
			return true;
		}
		#step(delta) {
			const target = this.infos[this.#infoIndex() + delta];
			if (!target) return false;
			this.#navigate(target, { autoplay: true });
			return true;
		}
		#show(info, { autoplay, index }, reason) {
			try {
				const provider = this.#registry.get(info.provider);
				if (this.#player?.kind !== provider.id) {
					const previous = this.#player?.iframe;
					this.#disposePlayer();
					previous?.remove();
					this.#player = provider.createPlayer();
					this.#unsubscribe = this.#player.subscribe((e) => this.#onPlayerEvent(e));
				}
				this.#player.load(info, {
					autoplay,
					index
				});
				const iframe = this.#player.iframe;
				if (!iframe.isConnected) this.#host.prepend(iframe);
				this.#host.hidden = false;
				this.#syncPanel(info, iframe, index);
			} catch (error) {
				this.#fail(error, { info });
				return;
			}
			this.#changed(reason);
			this.#resolveMetaLater(info);
		}
		#syncPanel(info, iframe, index) {
			if (!info.isPlaylist) {
				this.#panelInfo = null;
				return this.#panel.clear();
			}
			if (info === this.#panelInfo) return this.#panel.setCurrent(index);
			this.#panelInfo = info;
			this.#panel.render({
				host: this.#host,
				iframe,
				info,
				current: index,
				onSelectItem: (i) => this.playAt(i)
			});
		}
		/** Titles / thumbnails of a playlist may come from an API: the panel is drawn first, then drawn again. */
		#resolveMetaLater(info) {
			if (!info.isPlaylist || !this.#resolveMeta || this.#resolved.has(info)) return;
			this.#resolved.add(info);
			Promise.resolve(this.#resolveMeta(info)).then((changed) => {
				if (!changed || this.current !== info || !this.#player?.iframe) return;
				this.#panelInfo = null;
				this.#syncPanel(info, this.#player.iframe, this.currentIndex);
			}, (error) => this.#fail(error, { info }));
		}
		#onPlayerEvent(event) {
			if (event.type === "itemChange") {
				this.#journal.updateCurrent({ index: event.index });
				this.#panel.setCurrent(event.index);
				this.notifyDependentViews(this.current);
				this.#changed("item");
			} else if (event.type === "state") this.#events.emit("state", {
				region: this,
				state: event.state,
				index: event.index ?? this.currentIndex
			});
			else if (event.type === "error") this.#fail(event.error, { info: this.current });
		}
		#changed(reason) {
			this.#events.emit("change", {
				region: this,
				reason,
				info: this.current,
				index: this.currentIndex,
				visible: this.isVisible
			});
		}
		#fail(error, context = {}) {
			if (!this.#events.emit("error", {
				region: this,
				error,
				...context
			})) console.error("[Region]", error);
		}
		#disposePlayer() {
			this.#unsubscribe?.();
			this.#player?.dispose();
			this.#unsubscribe = null;
			this.#player = null;
		}
	};
	// src/providers/ProviderRegistry.js
	var ProviderRegistry = class {
		#providers = /* @__PURE__ */ new Map();
		constructor(providers = []) {
			for (const p of providers) this.register(p);
		}
		get providers() {
			return Object.freeze([...this.#providers.values()]);
		}
		register(provider) {
			if (!provider?.id || !Array.isArray(provider.hosts)) throw new TypeError("register(): a provider needs an id and a hosts array");
			this.#providers.set(provider.id.toLowerCase(), provider);
			return this;
		}
		get(id) {
			const provider = this.#providers.get(id.toLowerCase());
			if (!provider) throw new Error(`Unknown provider: "${id}"`);
			return provider;
		}
		has(id) {
			return this.#providers.has(id.toLowerCase());
		}
		resolve(urlString) {
			let hostname;
			try {
				hostname = new URL(urlString).hostname;
			} catch {
				throw new Error(`Invalid URL: '${urlString}'`);
			}
			for (const provider of this.#providers.values()) if (provider.hosts.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) return provider;
			throw new Error(`No provider handles '${hostname}'`);
		}
	};
	// src/models/UrlInfo.js
	var UrlInfo = class {
		#kind;
		#videoId;
		#videoIds;
		#playlistId;
		#index;
		#startSeconds;
		#labels;
		constructor({ kind, videoId, videoIds, playlistId, index, startSeconds, labels }) {
			this.#kind = kind;
			this.#videoId = videoId;
			this.#videoIds = videoIds;
			this.#playlistId = playlistId;
			this.#index = index;
			this.#startSeconds = startSeconds;
			this.#labels = labels;
		}
		get kind() {
			return this.#kind;
		}
		get videoId() {
			return this.#videoId;
		}
		get videoIds() {
			return this.#videoIds;
		}
		get playlistId() {
			return this.#playlistId;
		}
		get index() {
			return this.#index;
		}
		get startSeconds() {
			return this.#startSeconds;
		}
		get labels() {
			return this.#labels;
		}
	};
	// src/utils/ValueChecks.js
	var ValueChecks = class {
		static requireNotNull(value, name = "value") {
			if (value === null || value === void 0) throw new Error(`${name} must not be null or undefined`);
		}
		static requireNotNullOrEmpty(value, name = "value") {
			this.requireNotNull(value, name);
			if (typeof value === "string" && value.trim().length === 0) throw new Error(`${name} must not be empty`);
			if (Array.isArray(value) && value.length === 0) throw new Error(`${name} must not be empty`);
			if ((value instanceof Map || value instanceof Set) && value.size === 0) throw new Error(`${name} must not be empty`);
			if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) throw new Error(`${name} must not be empty`);
		}
	};
	// src/models/VideoInfo.js
	var VideoInfo = class {
		#key;
		#provider;
		#target;
		#videoId;
		#autoplay;
		#startSeconds;
		#title;
		#description;
		#channel;
		#channelUrl;
		#thumbnail;
		#duration;
		#showOnInit;
		#extra;
		constructor({ provider, target, videoId, autoplay, startSeconds, title, description, channel, channelUrl, thumbnail, duration, showOnInit, key = null, extra = null }) {
			ValueChecks.requireNotNullOrEmpty(provider, "provider");
			ValueChecks.requireNotNullOrEmpty(target, "target");
			ValueChecks.requireNotNullOrEmpty(videoId, "videoId");
			this.#provider = provider;
			this.#target = target;
			this.#videoId = videoId;
			this.#autoplay = autoplay;
			this.#startSeconds = startSeconds;
			this.#title = title;
			this.#description = description;
			this.#channel = channel;
			this.#channelUrl = channelUrl;
			this.#thumbnail = thumbnail;
			this.#duration = duration;
			this.#showOnInit = showOnInit;
			this.#extra = extra;
			this.#key = key ?? `${this.#provider}:${this.#videoId}`;
		}
		get key() {
			return this.#key;
		}
		get isPlaylist() {
			return false;
		}
		get provider() {
			return this.#provider;
		}
		get target() {
			return this.#target;
		}
		get title() {
			return this.#title;
		}
		get description() {
			return this.#description;
		}
		get channel() {
			return this.#channel;
		}
		get channelUrl() {
			return this.#channelUrl;
		}
		get thumbnail() {
			return this.#thumbnail;
		}
		get duration() {
			return this.#duration;
		}
		get videoId() {
			return this.#videoId;
		}
		get autoplay() {
			return this.#autoplay;
		}
		get startSeconds() {
			return this.#startSeconds;
		}
		get showOnInit() {
			return this.#showOnInit;
		}
		get extra() {
			return this.#extra;
		}
		fillMissing({ title, description, channel, channelUrl, thumbnail, duration } = {}) {
			let changed = false;
			if (isEmpty(this.#title) && title) {
				this.#title = title;
				changed = true;
			}
			if (isEmpty(this.#description) && description) {
				this.#description = description;
				changed = true;
			}
			if (isEmpty(this.#channel) && channel) {
				this.#channel = channel;
				changed = true;
			}
			if (isEmpty(this.#channelUrl) && channelUrl) {
				this.#channelUrl = channelUrl;
				changed = true;
			}
			if (isEmpty(this.#thumbnail) && thumbnail) {
				this.#thumbnail = thumbnail;
				changed = true;
			}
			if (isEmpty(this.#duration) && duration) {
				this.#duration = duration;
				changed = true;
			}
			return changed;
		}
	};
	// src/models/VideoListInfo.js
	var VideoListInfo = class {
		#key;
		#provider;
		#target;
		#videoIds;
		#index;
		#showOnInit;
		#videos = [];
		#extra;
		constructor(provider, target, videoIds, index, showOnInit, key = null, extra = null) {
			ValueChecks.requireNotNullOrEmpty(provider, "provider");
			ValueChecks.requireNotNullOrEmpty(target, "target");
			this.#provider = provider;
			this.#target = target;
			this.#videoIds = videoIds;
			this.#index = index;
			this.#showOnInit = showOnInit;
			this.#videoIds = [...videoIds];
			this.#extra = extra;
			this.#key = key ?? `${this.#provider}:list:${this.#videoIds.join(",")}`;
		}
		get key() {
			return this.#key;
		}
		get provider() {
			return this.#provider;
		}
		get target() {
			return this.#target;
		}
		get isPlaylist() {
			return true;
		}
		get videoIds() {
			return Object.freeze([...this.#videoIds]);
		}
		get index() {
			return this.#index;
		}
		get showOnInit() {
			return this.#showOnInit;
		}
		get videos() {
			return Object.freeze([...this.#videos]);
		}
		get extra() {
			return this.#extra;
		}
		addVideo(video) {
			this.#videos.push(video);
		}
		setVideos(videos) {
			this.#videos = [...videos];
		}
	};
	// src/models/PlaylistInfo.js
	var PlaylistInfo = class {
		#key;
		#provider;
		#target;
		#playlistId;
		#videoId;
		#showOnInit;
		#videos = [];
		#extra;
		constructor(provider, target, playlistId, videoId, showOnInit, key = null, extra = null) {
			ValueChecks.requireNotNullOrEmpty(provider, "provider");
			ValueChecks.requireNotNullOrEmpty(target, "target");
			ValueChecks.requireNotNullOrEmpty(playlistId, "playlistId");
			this.#provider = provider;
			this.#target = target;
			this.#playlistId = playlistId;
			this.#videoId = videoId;
			this.#showOnInit = showOnInit;
			this.#extra = extra;
			this.#key = key ?? `${this.#provider}:playlist:${this.#playlistId}`;
		}
		get key() {
			return this.#key;
		}
		get isPlaylist() {
			return true;
		}
		get provider() {
			return this.#provider;
		}
		get target() {
			return this.#target;
		}
		get playlistId() {
			return this.#playlistId;
		}
		get videoId() {
			return this.#videoId;
		}
		get videos() {
			return Object.freeze([...this.#videos]);
		}
		get showOnInit() {
			return this.#showOnInit;
		}
		get extra() {
			return this.#extra;
		}
		addVideo(video) {
			this.#videos.push(video);
		}
		setVideos(videos) {
			this.#videos = [...videos];
		}
	};
	// src/providers/InfoParser.js
	var InfoParser = class {
		getUrl(element) {
			if (element.tagName === "A") return element.href;
			if (element.tagName === "IFRAME") return element.src;
			return element.dataset?.url;
		}
		parseTime(t) {
			if (!t) return void 0;
			if (/^\d+$/.test(t)) return Number(t);
			const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(t);
			if (!m || !m[1] && !m[2] && !m[3]) return void 0;
			return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
		}
		parseJsonAttribute(value, name) {
			if (value === void 0) return void 0;
			let data;
			try {
				data = JSON.parse(value);
			} catch (error) {
				throw new Error(`Invalid JSON in ${name}: ${error.message}`);
			}
			if (!Array.isArray(data)) throw new Error(`${name} must be a JSON array`);
			return data;
		}
		readLinkData(element) {
			const data = element.dataset;
			return {
				autoplay: data.autoplay,
				start: data.start,
				title: data.title,
				description: data.description,
				channel: data.channel,
				channelUrl: data.channelUrl,
				thumbnail: data.thumbnail,
				duration: data.duration,
				videos: this.parseJsonAttribute(data.videos, "data-videos") ?? [],
				index: toNumber(data.index),
				target: data.target ?? (element.tagName === "IFRAME" ? element.parentElement?.id : void 0),
				showOnInit: toBoolean(data.showOnInit),
				key: data.key,
				extra: data.extra
			};
		}
		parseUrl(url) {
			throw new Error("parseUrl() must be implemented");
		}
		buildUrl(def) {
			throw new Error("buildUrl() must be implemented");
		}
		parseFromElement(element) {
			const url = this.getUrl(element);
			if (!url) throw new Error(`No URL found for element '${element}'`);
			return this.parseDefinition({
				url,
				...this.readLinkData(element)
			});
		}
		parseDefinition(def) {
			throw new Error("parseDefinition() must be implemented");
		}
	};
	// src/providers/youtube/YouTubeThumbnailUrlBuilder.js
	var YouTubeThumbnailUrlBuilder = class YouTubeThumbnailUrlBuilder {
		static #BASE_URL = "https://i.ytimg.com/vi";
		getThumbnailUrl(videoId) {
			ValueChecks.requireNotNullOrEmpty(videoId, "videoId");
			return `${YouTubeThumbnailUrlBuilder.#BASE_URL}/${videoId}/mqdefault.jpg`;
		}
	};
	// src/providers/youtube/YouTubeInfoParser.js
	var YouTubeInfoParser = class extends InfoParser {
		#thumbnailUrlBuilder;
		/**
		* @param {{ thumbnailUrlBuilder?: YouTubeThumbnailUrlBuilder | null }} [options]
		*/
		constructor({ thumbnailUrlBuilder = null } = {}) {
			super();
			this.#thumbnailUrlBuilder = thumbnailUrlBuilder ?? new YouTubeThumbnailUrlBuilder();
		}
		buildUrl(def) {
			if (!def) throw new TypeError("buildUrl(): definition is required");
			const q = new URLSearchParams();
			let path = "watch";
			if (def.playlistId) {
				q.set("list", def.playlistId);
				if (def.videoId) q.set("v", def.videoId);
			} else if (def.videoIds?.length) {
				path = "watch_videos";
				q.set("video_ids", def.videoIds.join(","));
				if (def.index != null) q.set("index", def.index);
			} else if (def.videoId) {
				q.set("v", def.videoId);
				if (def.start != null) q.set("t", def.start);
			} else throw new TypeError("buildUrl(): need playlistId, videoIds, or videoId");
			return `https://www.youtube.com/${path}?${q}`;
		}
		parseUrl(url) {
			const u = new URL(url);
			const q = u.searchParams;
			if (q.has("video_ids")) {
				const videoIds = q.get("video_ids").split(",").map((s) => s.trim()).filter(Boolean);
				if (videoIds.length === 0) return null;
				return new UrlInfo({
					kind: "videoList",
					videoIds,
					index: toInt(q.get("index"))
				});
			}
			const host = u.hostname.replace(/^www\./, "");
			const pathId = /^\/(?:embed|shorts|live)\/([\w-]+)/.exec(u.pathname)?.[1];
			const videoId = q.get("v") || (host === "youtu.be" ? u.pathname.split("/")[1] : null) || (pathId !== "videoseries" ? pathId : null) || null;
			if (q.has("list")) return new UrlInfo({
				kind: "playlist",
				playlistId: q.get("list"),
				videoId
			});
			const extra = (q.get("playlist") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
			if (extra.length) return new UrlInfo({
				kind: "videoList",
				videoIds: [videoId, ...extra].filter(Boolean),
				index: toInt(q.get("index"))
			});
			if (!videoId) throw new Error(`Invalid URL: no video or playlist id in '${url}'`);
			return new UrlInfo({
				kind: "video",
				videoId,
				startSeconds: this.parseTime(q.get("t") ?? q.get("start"))
			});
		}
		parseDefinition(def) {
			const urlInfos = this.parseUrl(def.url);
			if (!urlInfos) throw new Error(`Invalid URL: '${def.url}'`);
			const videos = def.videos ?? [];
			if (!Array.isArray(videos)) throw new Error("videos must be an array");
			switch (urlInfos.kind) {
				case "video": return new VideoInfo({
					provider: "youtube",
					target: def.target,
					videoId: urlInfos.videoId,
					autoplay: toAutoplayMode(def.autoplay),
					startSeconds: this.parseTime(def.start) ?? urlInfos.startSeconds,
					title: def.title ?? "",
					description: def.description ?? "",
					channel: def.channel ?? "",
					channelUrl: def.channelUrl ?? "",
					duration: this.parseTime(def.duration),
					thumbnail: def.thumbnail ?? this.#thumbnailUrlBuilder.getThumbnailUrl(urlInfos.videoId),
					showOnInit: def.showOnInit,
					key: def.key,
					extra: def.extra
				});
				case "videoList": {
					const index = urlInfos.index ?? def.index;
					const list = new VideoListInfo("youtube", def.target, urlInfos.videoIds, index, def.showOnInit, def.key);
					urlInfos.videoIds.forEach((videoId, i) => {
						const v = videos[i] ?? {};
						list.addVideo(new VideoInfo({
							provider: "youtube",
							target: def.target,
							videoId,
							autoplay: toAutoplayMode(v.autoplay ?? def.autoplay),
							startSeconds: this.parseTime(v.start),
							title: v.title ?? "",
							description: v.description ?? "",
							channel: v.channel ?? "",
							channelUrl: v.channelUrl ?? "",
							duration: this.parseTime(v.duration),
							thumbnail: v.thumbnail ?? this.#thumbnailUrlBuilder.getThumbnailUrl(videoId),
							key: v.key,
							extra: v.extra
						}));
					});
					return list;
				}
				case "playlist": {
					const playlist = new PlaylistInfo("youtube", def.target, urlInfos.playlistId, urlInfos.videoId, def.showOnInit, def.key);
					(videos.length ? videos : []).forEach((v, i) => {
						playlist.addVideo(new VideoInfo({
							provider: "youtube",
							target: def.target,
							videoId: v.videoId,
							autoplay: toAutoplayMode(v.autoplay),
							startSeconds: this.parseTime(v.start),
							title: v.title ?? "",
							description: v.description ?? "",
							channel: v.channel ?? "",
							channelUrl: v.channelUrl ?? "",
							thumbnail: v.thumbnail ?? (v.videoId ? this.#thumbnailUrlBuilder.getThumbnailUrl(v.videoId) : ""),
							duration: this.parseTime(v.duration),
							key: v.key,
							extra: v.extra
						}));
					});
					return playlist;
				}
			}
		}
	};
	// src/providers/youtube/YouTubeIframeBridge.js
	/** Event types sent to subscribers. */
	var YouTubeBridgeEvent = Object.freeze({
		Ready: "ready",
		StateChange: "stateChange",
		VideoPlay: "videoPlay",
		VideoPause: "videoPause",
		VideoBuffering: "videoBuffering",
		VideoEnded: "videoEnded",
		TimeUpdate: "timeUpdate",
		DurationChange: "durationChange",
		PlaylistIndexChange: "playlistIndexChange",
		VideoChange: "videoChange",
		VolumeChange: "volumeChange",
		MuteChange: "muteChange",
		RateChange: "rateChange",
		QualityChange: "qualityChange",
		Error: "error",
		Message: "message"
	});
	/**
	* @typedef {(
	*   | { type: "ready" }
	*   | { type: "stateChange", state: number }
	*   | { type: "videoPlay" }
	*   | { type: "videoPause" }
	*   | { type: "videoBuffering" }
	*   | { type: "videoEnded", index: number|null }
	*   | { type: "timeUpdate", time: number, duration?: number }
	*   | { type: "durationChange", duration: number }
	*   | { type: "playlistIndexChange", index: number }
	*   | { type: "videoChange", videoId: string, title?: string, author?: string }
	*   | { type: "volumeChange", volume: number, muted: boolean|null }
	*   | { type: "muteChange", volume: number|null, muted: boolean }
	*   | { type: "rateChange", rate: number }
	*   | { type: "qualityChange", quality: string }
	*   | { type: "error", code: number }
	*   | { type: "message", name: string, info: any }
	* )} YouTubeBridgeEventData
	*
	* - ready: the player is ready to receive commands.
	* - stateChange: raw state on every change (-1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued).
	* - videoPlay / videoPause / videoBuffering / videoEnded: shortcuts for the states 1, 2, 3 and 0.
	*   videoEnded is fired for every video of a playlist, including the last one;
	*   `index` is the playlist index, or null when unknown (e.g. a single video).
	* - timeUpdate: playback position, in seconds.
	* - durationChange: the duration of the current video is known or changed, in seconds.
	* - playlistIndexChange: the playing playlist item changed.
	* - videoChange: the current video changed (id, and title / author when the player gives them).
	* - volumeChange: the volume level changed (0-100). `muted` is the current mute state.
	* - muteChange: the player was muted or unmuted. `volume` is the current level.
	* - rateChange: the playback rate changed (1, 1.5, 2...).
	* - qualityChange: the playback quality changed ("small", "medium", "large", "hd720", "hd1080"...).
	* - error: YouTube error code.
	* - message: every message of the player, as it was received (`name` is its `event`). Debugging and
	*   anything not covered above. Delivered only to subscribers that ask for it in `types`.
	*
	* Every value-change event above (index, video, volume, mute, rate, quality, duration) is also
	* notified once for the first value known after a load: a custom control can initialise itself from it.
	* Where the values come from: the `infoDelivery` messages, the only ones read here besides `onReady`,
	* `initialDelivery`, `onStateChange` and `onError`. Seen on a real embed: `volume` and `muted` (always together),
	* `playbackQuality` with `availableQualityLevels` and `preferredQuality`. Not confirmed yet: `playbackRate`,
	* `duration` and `videoData`. Other messages (`apiInfoDelivery`: captions...) are only available as `message`.
	*/
	/**
	* Bridge between a YouTube iframe (embed URL with `enablejsapi=1`) and the page.
	* Listens to the iframe messages, notifies subscribers and sends commands to the player.
	*
	* @example
	* const bridge = new YouTubeIframeBridge(iframe);
	* // only what is needed
	* const unsubscribe = bridge.subscribe(
	*   (e) => console.log("now playing item", e.index),
	*   { types: [YouTubeBridgeEvent.PlaylistIndexChange] }
	* );
	* // everything typed (no filter)
	* bridge.subscribe((e) => { if (e.type === YouTubeBridgeEvent.MuteChange) console.log(e.muted); });
	* bridge.connect();
	* bridge.command("playVideoAt", [2]);
	*
	* Commands for custom controls: playVideo, pauseVideo, seekTo [seconds, true], setVolume [0-100],
	* mute, unMute, setPlaybackRate [rate], nextVideo, previousVideo, playVideoAt [index].
	*/
	var YouTubeIframeBridge = class {
		#iframe;
		#window;
		#listeners = /* @__PURE__ */ new Map();
		#connected = false;
		#ready = false;
		#queue = [];
		#lastIndex = null;
		#lastState = null;
		#known = {};
		/**
		* @param {HTMLIFrameElement} iframe The YouTube iframe to bridge.
		* @param {{ window?: Window }} [options] `window` receives the messages (injectable for tests).
		*/
		constructor(iframe, { window = globalThis } = {}) {
			this.#iframe = iframe;
			this.#window = window;
		}
		/**
		* Adds a subscriber. The same function is never added twice: subscribing it again replaces its filter.
		* @param {(event: YouTubeBridgeEventData) => void} onEvent
		* @param {object} [options]
		* @param {Iterable<string>} [options.types] YouTubeBridgeEvent values to receive. Omitted or empty:
		*   every typed event except `message`, which must be asked for explicitly.
		* @returns {() => void} Function that removes this subscriber.
		*/
		subscribe(onEvent, { types } = {}) {
			const wanted = types ? new Set(types) : null;
			this.#listeners.set(onEvent, wanted?.size ? wanted : null);
			return () => this.#listeners.delete(onEvent);
		}
		/**
		* Starts listening to the iframe and sends the handshake the player needs
		* before it delivers messages. Does nothing if already connected.
		*/
		connect() {
			if (this.#connected) return;
			this.#connected = true;
			this.#window.addEventListener("message", this.#onMessage);
			this.#iframe.addEventListener("load", this.#onIframeLoaded);
			this.#handshake();
		}
		/**
		* Stops listening, drops pending commands and removes all subscribers.
		* The bridge can be connected again afterwards.
		*/
		disconnect() {
			if (!this.#connected) return;
			this.#connected = false;
			this.#window.removeEventListener("message", this.#onMessage);
			this.#iframe.removeEventListener("load", this.#onIframeLoaded);
			this.#queue.length = 0;
			this.#listeners.clear();
		}
		/**
		* Sends a player API command. Queued until the player is ready.
		* @param {string} func Command name (playVideo, pauseVideo, playVideoAt, loadVideoById...).
		* @param {Array} [args] Command arguments.
		*/
		command(func, args = []) {
			const message = {
				event: "command",
				func,
				args
			};
			if (this.#ready) this.send(message);
			else this.#queue.push(message);
		}
		/**
		* Sends a raw message to the iframe.
		* @param {object} message Serialized to JSON.
		*/
		send(message) {
			this.#iframe.contentWindow?.postMessage(JSON.stringify(message), this.#getTargetOrigin());
		}
		resetState() {
			this.#lastIndex = null;
			this.#lastState = null;
			this.#known = {};
		}
		/** Tells the player to start sending messages to this page. */
		#handshake() {
			this.send({
				event: "listening",
				id: 1,
				channel: "widget"
			});
		}
		/** Arrow function: `this` must stay the bridge when used as an event listener. */
		#onMessage = (e) => {
			if (e.source !== this.#iframe.contentWindow) return;
			const d = this.#parse(e.data);
			if (!d?.event) return;
			this.#emit({
				type: YouTubeBridgeEvent.Message,
				name: d.event,
				info: d.info
			});
			switch (d.event) {
				case "onReady":
					this.#markReady();
					break;
				case "initialDelivery":
					this.#markReady();
					this.#handleDelivery(d.info);
					break;
				case "infoDelivery":
					this.#handleDelivery(d.info);
					break;
				case "onStateChange":
					this.#handleState(d.info);
					break;
				case "onError": this.#emit({
					type: YouTubeBridgeEvent.Error,
					code: d.info
				});
			}
		};
		/** Every (re)load of the iframe starts from scratch. */
		#onIframeLoaded = () => {
			this.#ready = false;
			this.#lastIndex = null;
			this.#lastState = null;
			this.#known = {};
			this.#handshake();
		};
		/**
		* Notifies a player state. The state can come from `onStateChange` or from
		* `infoDelivery`: an unchanged state is notified only once.
		* @param {number} state
		*/
		#handleState(state) {
			if (state === this.#lastState) return;
			this.#lastState = state;
			this.#emit({
				type: YouTubeBridgeEvent.StateChange,
				state
			});
			switch (state) {
				case 1:
					this.#emit({ type: YouTubeBridgeEvent.VideoPlay });
					break;
				case 2:
					this.#emit({ type: YouTubeBridgeEvent.VideoPause });
					break;
				case 3:
					this.#emit({ type: YouTubeBridgeEvent.VideoBuffering });
					break;
				case 0: this.#emit({
					type: YouTubeBridgeEvent.VideoEnded,
					index: this.#lastIndex
				});
			}
		}
		/**
		* Handles the player info. A delivery only holds what changed (plus the time, sent regularly), so a field
		* that is absent means "unchanged". Each value is notified only when it differs from the last one.
		* @param {object} [info]
		*/
		#handleDelivery(info = {}) {
			if (info.playerState != null) this.#handleState(info.playerState);
			if (info.currentTime != null) this.#emit({
				type: YouTubeBridgeEvent.TimeUpdate,
				time: info.currentTime,
				duration: info.duration
			});
			if (this.#remember("duration", info.duration)) this.#emit({
				type: YouTubeBridgeEvent.DurationChange,
				duration: info.duration
			});
			if (info.playlistIndex != null && info.playlistIndex !== this.#lastIndex) {
				this.#lastIndex = info.playlistIndex;
				this.#emit({
					type: YouTubeBridgeEvent.PlaylistIndexChange,
					index: info.playlistIndex
				});
			}
			if (info.videoData?.video_id && this.#remember("videoId", info.videoData.video_id)) this.#emit({
				type: YouTubeBridgeEvent.VideoChange,
				videoId: info.videoData.video_id,
				title: info.videoData.title,
				author: info.videoData.author
			});
			this.#handleSound(info);
			this.#handleRate(info.playbackRate);
			this.#handleQuality(info.playbackQuality);
		}
		/** Volume and mute come together in a delivery; each one is notified on its own change. */
		#handleSound({ volume, muted } = {}) {
			const volumeChanged = this.#remember("volume", volume);
			const mutedChanged = this.#remember("muted", muted);
			const sound = {
				volume: this.#known.volume ?? null,
				muted: this.#known.muted ?? null
			};
			if (volumeChanged) this.#emit({
				type: YouTubeBridgeEvent.VolumeChange,
				...sound
			});
			if (mutedChanged) this.#emit({
				type: YouTubeBridgeEvent.MuteChange,
				...sound
			});
		}
		#handleRate(rate) {
			if (this.#remember("rate", rate)) this.#emit({
				type: YouTubeBridgeEvent.RateChange,
				rate
			});
		}
		#handleQuality(quality) {
			if (this.#remember("quality", quality)) this.#emit({
				type: YouTubeBridgeEvent.QualityChange,
				quality
			});
		}
		/** @returns {boolean} true when `value` is present and differs from the last one stored under `name`. */
		#remember(name, value) {
			if (value == null || this.#known[name] === value) return false;
			this.#known[name] = value;
			return true;
		}
		/** Marks the player as ready, sends the queued commands, then notifies `ready`. */
		#markReady() {
			if (this.#ready) return;
			this.#ready = true;
			this.#queue.splice(0).forEach((m) => this.send(m));
			this.#emit({ type: YouTubeBridgeEvent.Ready });
		}
		/**
		* Sends an event to the subscribers that want it. Iterates over a copy, so a subscriber can
		* unsubscribe while being notified; a failing subscriber does not break the others.
		* @param {YouTubeBridgeEventData} event
		*/
		#emit(event) {
			for (const [onEvent, types] of [...this.#listeners]) {
				if (!(types ? types.has(event.type) : event.type !== YouTubeBridgeEvent.Message)) continue;
				try {
					onEvent(event);
				} catch (error) {
					console.error("[YouTubeIframeBridge] subscriber failed", error);
				}
			}
		}
		/**
		* Parses a message payload.
		* @param {unknown} data
		* @returns {object|null} null when the payload is not a JSON string.
		*/
		#parse(data) {
			if (typeof data !== "string") return null;
			try {
				return JSON.parse(data);
			} catch {
				return null;
			}
		}
		/**
		* Origin of the iframe, used as the postMessage target (https://www.youtube.com).
		* Falls back to "*" when the iframe has no valid src.
		* @returns {string}
		*/
		#getTargetOrigin() {
			try {
				return new URL(this.#iframe.src).origin;
			} catch {
				return "*";
			}
		}
	};
	// src/providers/youtube/YouTubePlayer.js
	/**
	* One YouTube iframe + its bridge. The iframe is created once (src), then driven with API
	* commands: loading another video does NOT replace the iframe.
	* An existing iframe (embed URL with enablejsapi=1) can be adopted: `new YouTubePlayer({builder, iframe})`.
	*
	* Events sent to subscribers (same shape for every provider):
	*   { type: "itemChange", index }  the playing item of a playlist / list changed
	*   { type: "ended", index }       a video ended
	*/
	var YouTubePlayer = class {
		kind = "youtube";
		#builder;
		#createIframe;
		#iframe = null;
		#bridge = null;
		#owned = false;
		#listeners = /* @__PURE__ */ new Set();
		/**
		* @param {Object} options
		* @param {YouTubeEmbedSrcBuilder} options.builder
		* @param {(src: string) => HTMLIFrameElement} [options.createIframe] Required unless an iframe is adopted.
		* @param {HTMLIFrameElement} [options.iframe] An existing iframe to adopt.
		*/
		constructor({ builder, createIframe = null, iframe = null }) {
			this.#builder = builder;
			this.#createIframe = createIframe;
			if (iframe) {
				this.#prepareAdopted(iframe);
				this.#attach(iframe, false);
			}
		}
		get iframe() {
			return this.#iframe;
		}
		subscribe(onEvent) {
			this.#listeners.add(onEvent);
			return () => this.#listeners.delete(onEvent);
		}
		/** Without enablejsapi the commands would never be sent: the iframe is reloaded once with it. */
		#prepareAdopted(iframe) {
			try {
				const url = new URL(iframe.src);
				const origin = this.#builder.origin;
				let changed = url.searchParams.get("enablejsapi") !== "1";
				url.searchParams.set("enablejsapi", "1");
				if (origin && url.searchParams.get("origin") !== origin) {
					url.searchParams.set("origin", origin);
					changed = true;
				}
				if (changed) iframe.src = url.href;
			} catch {}
		}
		/**
		* @param {VideoInfo|VideoListInfo|PlaylistInfo} info
		* @param {{autoplay?: boolean, index?: number}} [options] `index`: starting item of a list / playlist.
		*/
		load(info, { autoplay = false, index = 0 } = {}) {
			if (!this.#iframe) {
				this.#attach(this.#createIframe(this.#src(info, {
					autoplay,
					index
				})), true);
				return;
			}
			this.#bridge.resetState();
			const verb = autoplay ? "load" : "cue";
			if (info instanceof VideoInfo) this.#bridge.command(`${verb}VideoById`, [info.videoId, info.startSeconds ?? 0]);
			else if (info instanceof VideoListInfo) this.#bridge.command(`${verb}Playlist`, [
				info.videoIds,
				index,
				0
			]);
			else if (info instanceof PlaylistInfo) this.#bridge.command(`${verb}Playlist`, [{
				list: info.playlistId,
				listType: "playlist",
				index: index || this.#indexOfStartVideo(info),
				startSeconds: 0
			}]);
			else this.#invalid();
		}
		play() {
			this.#bridge?.command("playVideo");
		}
		pause() {
			this.#bridge?.command("pauseVideo");
		}
		next() {
			this.#bridge?.command("nextVideo");
		}
		previous() {
			this.#bridge?.command("previousVideo");
		}
		playAt(index) {
			this.#bridge?.command("playVideoAt", [index]);
		}
		dispose() {
			this.#bridge?.disconnect();
			if (this.#owned) this.#iframe?.remove();
			this.#bridge = null;
			this.#iframe = null;
			this.#listeners.clear();
		}
		#attach(iframe, owned) {
			this.#iframe = iframe;
			this.#owned = owned;
			this.#bridge = new YouTubeIframeBridge(iframe);
			this.#bridge.subscribe((e) => this.#onBridgeEvent(e), { types: [
				YouTubeBridgeEvent.PlaylistIndexChange,
				YouTubeBridgeEvent.VideoEnded,
				YouTubeBridgeEvent.VideoPlay,
				YouTubeBridgeEvent.VideoPause,
				YouTubeBridgeEvent.Error
			] });
			this.#bridge.connect();
		}
		#onBridgeEvent(e) {
			switch (e.type) {
				case YouTubeBridgeEvent.PlaylistIndexChange: return this.#emit({
					type: "itemChange",
					index: e.index
				});
				case YouTubeBridgeEvent.VideoPlay: return this.#emit({
					type: "state",
					state: "playing"
				});
				case YouTubeBridgeEvent.VideoPause: return this.#emit({
					type: "state",
					state: "paused"
				});
				case YouTubeBridgeEvent.VideoEnded: return this.#emit({
					type: "state",
					state: "ended",
					index: e.index
				});
				case YouTubeBridgeEvent.Error: return this.#emit({
					type: "error",
					error: /* @__PURE__ */ new Error(`YouTube player error ${e.code}`)
				});
			}
		}
		#emit(event) {
			for (const listener of [...this.#listeners]) listener(event);
		}
		#src(info, { autoplay, index }) {
			if (info instanceof VideoInfo) return this.#builder.buildVideoSrc(info.videoId, {
				autoplay,
				startSeconds: info.startSeconds
			});
			if (info instanceof VideoListInfo) return this.#builder.buildVideoListSrc(info.videoIds, {
				autoplay,
				index
			});
			if (info instanceof PlaylistInfo) return this.#builder.buildPlaylistSrc(info.playlistId, {
				autoplay,
				videoId: info.videoId
			});
			return this.#invalid();
		}
		/** Position of the starting video among the fallback videos (data-videos), 0 when unknown. */
		#indexOfStartVideo(info) {
			return Math.max(0, info.videos.findIndex((v) => v.videoId === info.videoId));
		}
		#invalid() {
			throw new Error("Invalid operation: VideoInfo, VideoListInfo or PlaylistInfo expected.");
		}
	};
	// src/providers/youtube/YouTubeEmbedSrcBuilder.js
	var YouTubeEmbedSrcBuilder = class YouTubeEmbedSrcBuilder {
		static #BASE_URL = "https://www.youtube.com/embed";
		#enablejsapi;
		#origin;
		constructor({ enablejsapi = false, origin = globalThis.location?.origin } = {}) {
			this.#enablejsapi = Boolean(enablejsapi);
			this.#origin = origin && origin !== "null" ? origin : null;
		}
		get enablejsapi() {
			return this.#enablejsapi;
		}
		get origin() {
			return this.#origin;
		}
		#params({ autoplay, startSeconds } = {}) {
			const q = new URLSearchParams();
			if (this.#enablejsapi) {
				q.set("enablejsapi", "1");
				if (this.#origin) q.set("origin", this.#origin);
			}
			if (autoplay) q.set("autoplay", "1");
			if (startSeconds > 0) q.set("start", String(Math.floor(startSeconds)));
			return q;
		}
		#url(path, q) {
			const s = q.toString();
			return `${YouTubeEmbedSrcBuilder.#BASE_URL}/${path}${s ? `?${s}` : ""}`;
		}
		buildVideoSrc(videoId, { autoplay, startSeconds } = {}) {
			if (!videoId) throw new TypeError("buildVideoSrc(): videoId is required");
			const q = this.#params({
				autoplay,
				startSeconds
			});
			return this.#url(encodeURIComponent(videoId), q);
		}
		buildVideoListSrc(videoIds, { autoplay, index, startSeconds } = {}) {
			if (!Array.isArray(videoIds) || !videoIds.length) throw new TypeError("buildVideoListSrc(): a non-empty array is required");
			const [first, ...rest] = videoIds;
			const q = this.#params({
				autoplay,
				startSeconds
			});
			if (rest.length) q.set("playlist", rest.join(","));
			if (index > 0) q.set("index", String(Math.floor(index)));
			return this.#url(encodeURIComponent(first), q);
		}
		buildPlaylistSrc(playlistId, { autoplay, videoId } = {}) {
			if (!playlistId) throw new TypeError("buildPlaylistSrc(): playlistId is required");
			const q = this.#params({ autoplay });
			q.set("list", playlistId);
			return this.#url(videoId ? encodeURIComponent(videoId) : "videoseries", q);
		}
	};
	// src/providers/MediaProvider.js
	var MediaProvider = class MediaProvider {
		id = null;
		hosts = [];
		constructor() {
			if (new.target === MediaProvider) throw new Error("MediaProvider is an abstract class.");
		}
		getInfoFromElement(link) {
			throw new Error(`${this.constructor.name} must implement getInfoFromElement().`);
		}
		getInfoFromDefinition(definition) {
			throw new Error(`${this.constructor.name} must implement getInfoFromDefinition().`);
		}
		createPlayer(options = {}) {
			throw new Error(`${this.constructor.name} must implement createPlayer().`);
		}
	};
	// src/providers/youtube/YouTubeProvider.js
	var YouTubeProvider = class extends MediaProvider {
		id = "youtube";
		hosts = [
			"youtube.com",
			"youtu.be",
			"youtube-nocookie.com"
		];
		#infoParser;
		#embedSrcBuilder;
		constructor({ infoParser = null, embedSrcBuilder = null, thumbnailUrlBuilder = null } = {}) {
			super();
			this.#infoParser = infoParser ?? new YouTubeInfoParser({ thumbnailUrlBuilder });
			this.#embedSrcBuilder = embedSrcBuilder ?? new YouTubeEmbedSrcBuilder({ enablejsapi: true });
		}
		getInfoFromElement(link) {
			return this.#infoParser.parseFromElement(link);
		}
		getInfoFromDefinition(definition) {
			if (!definition.url) definition.url = this.#infoParser.buildUrl(definition);
			return this.#infoParser.parseDefinition(definition);
		}
		createPlayer({ iframe = null } = {}) {
			return new YouTubePlayer({
				builder: this.#embedSrcBuilder,
				createIframe: (src) => makeIframe({
					width: "560",
					height: "315",
					src,
					title: "YouTube video player",
					allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
					referrerPolicy: "strict-origin-when-cross-origin",
					allowFullscreen: true,
					extraAttrs: {}
				}),
				iframe
			});
		}
	};
	// src/providers/okru/OkruInfoParser.js
	var OkruInfoParser = class extends InfoParser {
		#rawQueryParam(url, name) {
			for (const pair of url.search.slice(1).split("&")) {
				const separator = pair.indexOf("=");
				if ((separator === -1 ? pair : pair.slice(0, separator)) === name) return separator === -1 ? "" : pair.slice(separator + 1);
			}
			return null;
		}
		#splitIds = (rawValue) => rawValue.split(",").map((s) => this.#decodeText(s).trim()).filter(Boolean);
		#decodeText = (text) => {
			try {
				return decodeURIComponent(text);
			} catch {
				return text;
			}
		};
		/** Split BEFORE decoding: a comma inside a title is %2C, a raw comma separates two titles. An empty label stays in place (positional). */
		#splitLabels = (rawValue) => rawValue ? rawValue.split(",").map((s) => this.#decodeText(s).trim()) : [];
		parseUrl(url) {
			let u;
			try {
				u = new URL(url);
			} catch {
				return null;
			}
			const rawIds = this.#rawQueryParam(u, "video_ids");
			if (rawIds !== null) {
				const videoIds = this.#splitIds(rawIds);
				if (!videoIds.length) return null;
				return new UrlInfo({
					kind: "videoList",
					videoIds,
					index: toInt(u.searchParams.get("index")),
					labels: this.#splitLabels(this.#rawQueryParam(u, "labels"))
				});
			}
			const match = /^\/video(?:embed)?\/(\d+)/.exec(u.pathname);
			return match ? new UrlInfo({
				kind: "video",
				videoId: match[1]
			}) : null;
		}
		buildUrl(def) {
			if (!def) throw new TypeError("buildUrl(): definition is required");
			if (def.playlistId) throw new TypeError("buildUrl(): playlist not supported");
			const id = def.videoId ?? def.videoIds?.[0];
			if (!id) throw new TypeError("buildUrl(): need videoId or videoIds");
			return `https://ok.ru/video/${id}`;
		}
		parseDefinition(def) {
			const urlInfos = this.parseUrl(def.url);
			if (!urlInfos) throw new Error(`Invalid URL: '${def.url}'`);
			const videos = def.videos ?? [];
			if (!Array.isArray(videos)) throw new Error("videos must be an array");
			switch (urlInfos.kind) {
				case "video": return new VideoInfo({
					provider: "okru",
					target: def.target,
					videoId: urlInfos.videoId,
					autoplay: toAutoplayMode(def.autoplay),
					startSeconds: this.parseTime(def.start),
					title: def.title ?? "",
					description: def.description ?? "",
					channel: def.channel ?? "",
					channelUrl: def.channelUrl ?? "",
					thumbnail: def.thumbnail ?? "",
					duration: this.parseTime(def.duration),
					showOnInit: def.showOnInit,
					key: def.key,
					extra: def.extra
				});
				case "videoList": {
					const labels = urlInfos.labels;
					const videoIds = urlInfos.videoIds;
					if (labels.length && labels.length !== videoIds.length) console.warn(`[OkruProvider] ${labels.length} labels for ${videoIds.length} videos (a comma in a title that is not encoded as %2C?)`);
					const index = urlInfos.index ?? def.index;
					const list = new VideoListInfo("okru", def.target, videoIds, index, def.showOnInit, def.key);
					videoIds.forEach((videoId, i) => {
						const v = videos.length ? videos[i] : { title: labels[i] };
						list.addVideo(new VideoInfo({
							provider: "okru",
							target: def.target,
							videoId,
							autoplay: toAutoplayMode(v?.autoplay ?? def.autoplay),
							startSeconds: this.parseTime(v?.start),
							title: v?.title ?? "",
							description: v?.description ?? "",
							channel: v?.channel ?? "",
							channelUrl: v?.channelUrl ?? "",
							thumbnail: v?.thumbnail ?? "",
							duration: this.parseTime(v?.duration),
							key: v?.key,
							extra: v?.extra
						}));
					});
					return list;
				}
			}
		}
	};
	// src/providers/okru/OkruIframeBridge.js
	/** Event types sent to subscribers. */
	var OkruBridgeEvent = Object.freeze({
		Ready: "ready",
		StateChange: "stateChange",
		VideoPlay: "videoPlay",
		VideoPause: "videoPause",
		VideoEnded: "videoEnded",
		TimeUpdate: "timeUpdate",
		VolumeChange: "volumeChange",
		MuteChange: "muteChange",
		Error: "error",
		Message: "message"
	});
	/**
	* @typedef {(
	*   | { type: "ready" }
	*   | { type: "videoPlay" }
	*   | { type: "videoPause" }
	*   | { type: "videoEnded" }
	*   | { type: "timeUpdate", time: number, duration: number }
	*   | { type: "volumeChange", volume: number, muted: boolean|null }
	*   | { type: "muteChange", muted: boolean, volume: number|null }
	*   | { type: "error", message: string }
	*   | { type: "message", name: string, info: object }
	* )} OkruBridgeEventData
	*
	* - volumeChange: the volume level changed. Ok.ru uses 0 to 1 (YouTube uses 0 to 100).
	* - muteChange: the player was muted or unmuted. `volume` is the last level known, or null.
	*   Both events are notified only when the value changes; the first value known after a load is
	*   notified too, so a custom control can initialise itself.
	* - message: every message of the player, as it was received (`name` is its `event`, `info` the whole message).
	*   Delivered only to subscribers that ask for it in `types`.
	*
	* Seen on a real embed: `{ event: "mute" }`, `{ event: "unmute" }`,
	* `{ event: "volumechange", volume: 0.98, muted: false }`.
	*/
	var OkruIframeBridge = class {
		#iframe;
		#window;
		#listeners = /* @__PURE__ */ new Map();
		#connected = false;
		#ready = false;
		#readySrc = null;
		#queue = [];
		#known = {};
		constructor(iframe, { window = globalThis } = {}) {
			this.#iframe = iframe;
			this.#window = window;
		}
		/**
		* Adds a subscriber. The same function is never added twice: subscribing it again replaces its filter.
		* @param {(event: OkruBridgeEventData) => void} onEvent
		* @param {object} [options]
		* @param {Iterable<string>} [options.types] OkruBridgeEvent values to receive. Omitted or empty:
		*   every typed event except `message`, which must be asked for explicitly.
		* @returns {() => void} Function that removes this subscriber.
		*/
		subscribe(onEvent, { types } = {}) {
			const wanted = types ? new Set(types) : null;
			this.#listeners.set(onEvent, wanted?.size ? wanted : null);
			return () => this.#listeners.delete(onEvent);
		}
		connect() {
			if (this.#connected) return;
			this.#connected = true;
			this.#window.addEventListener("message", this.#onMessage);
			this.#iframe.addEventListener("load", this.#onIframeLoaded);
		}
		disconnect() {
			if (!this.#connected) return;
			this.#connected = false;
			this.#window.removeEventListener("message", this.#onMessage);
			this.#iframe.removeEventListener("load", this.#onIframeLoaded);
			this.#listeners.clear();
		}
		#onIframeLoaded = () => {
			if (this.#iframe.src === this.#readySrc) return;
			this.#ready = false;
			this.#known = {};
		};
		#onMessage = (e) => {
			if (e.source !== this.#iframe.contentWindow) return;
			const data = this.#parse(e.data);
			if (!data || !data.event) return;
			this.#emit({
				type: OkruBridgeEvent.Message,
				name: data.event,
				info: data
			});
			this.#markReady();
			switch (data.event) {
				case "started":
				case "resumed":
					this.#emit({ type: OkruBridgeEvent.VideoPlay });
					break;
				case "paused":
					this.#emit({ type: OkruBridgeEvent.VideoPause });
					break;
				case "ended":
					this.#emit({ type: OkruBridgeEvent.VideoEnded });
					break;
				case "timeupdate":
					this.#emit({
						type: OkruBridgeEvent.TimeUpdate,
						time: data.time,
						duration: data.duration
					});
					break;
				case "volumechange":
					this.#handleSound(data);
					break;
				case "mute":
					this.#handleSound({ muted: true });
					break;
				case "unmute":
					this.#handleSound({ muted: false });
					break;
				case "error": this.#emit({
					type: OkruBridgeEvent.Error,
					message: data.message
				});
			}
		};
		/**
		* `mute` / `unmute` and `volumechange` describe the same state: each value is notified only when it differs
		* from the last one, so a `mute` followed by `volumechange { muted: true }` gives a single muteChange.
		*/
		#handleSound({ volume, muted }) {
			const volumeChanged = this.#remember("volume", volume);
			const mutedChanged = this.#remember("muted", muted);
			const sound = {
				volume: this.#known.volume ?? null,
				muted: this.#known.muted ?? null
			};
			if (volumeChanged) this.#emit({
				type: OkruBridgeEvent.VolumeChange,
				...sound
			});
			if (mutedChanged) this.#emit({
				type: OkruBridgeEvent.MuteChange,
				...sound
			});
		}
		/** @returns {boolean} true when `value` is present and differs from the last one stored under `name`. */
		#remember(name, value) {
			if (value == null || this.#known[name] === value) return false;
			this.#known[name] = value;
			return true;
		}
		#parse(data) {
			if (!data) return null;
			if (typeof data === "object") return data;
			try {
				return JSON.parse(data);
			} catch {
				return null;
			}
		}
		#markReady() {
			if (this.#ready) return;
			this.#ready = true;
			this.#readySrc = this.#iframe.src;
			this.#queue.splice(0).forEach((m) => this.send(m));
			this.#emit({ type: OkruBridgeEvent.Ready });
		}
		/** Sends an event to the subscribers that want it; a failing subscriber does not break the others. */
		#emit(event) {
			for (const [onEvent, types] of [...this.#listeners]) {
				if (!(types ? types.has(event.type) : event.type !== OkruBridgeEvent.Message)) continue;
				try {
					onEvent(event);
				} catch (error) {
					console.error("[OkruIframeBridge] subscriber failed", error);
				}
			}
		}
		command(func, args = null) {
			const message = {
				method: func,
				args
			};
			if (this.#ready) this.send(message);
			else this.#queue.push(message);
		}
		send(message) {
			this.#iframe.contentWindow?.postMessage(typeof message === "string" ? message : JSON.stringify(message), this.#getTargetOrigin());
		}
		#getTargetOrigin() {
			try {
				return new URL(this.#iframe.src).origin;
			} catch {
				return "*";
			}
		}
	};
	// src/providers/okru/OkruEmbedSrcBuilder.js
	/**
	* Builds the src of an Ok.ru iframe.
	* - direct mode: https://ok.ru/videoembed/ID?autoplay=1&fromTime=90
	* - relay mode (relayBaseUrl given): <relayBaseUrl>?videoId=ID&autoplay=1&startSeconds=90&parentOrigin=...
	*/
	var OkruEmbedSrcBuilder = class OkruEmbedSrcBuilder {
		static #DIRECT_BASE_URL = "https://ok.ru/videoembed";
		#relayBaseUrl;
		#parentOrigin;
		/**
		* @param {{ relayBaseUrl?: string | null, parentOrigin?: string | null }} [options]
		*  parentOrigin defaults to globalThis.location.origin, read at build time.
		*/
		constructor({ relayBaseUrl = null, parentOrigin = null } = {}) {
			this.#relayBaseUrl = relayBaseUrl;
			this.#parentOrigin = parentOrigin;
		}
		get isRelay() {
			return Boolean(this.#relayBaseUrl);
		}
		/**
		* @param {{ videoId: string, autoplay?: boolean, startSeconds?: number }} params
		* @returns {string}
		*/
		build({ videoId, autoplay = false, startSeconds } = {}) {
			if (!videoId) throw new TypeError("videoId is required");
			return this.isRelay ? this.#buildRelay(videoId, autoplay, startSeconds) : this.#buildDirect(videoId, autoplay, startSeconds);
		}
		#buildDirect(videoId, autoplay, startSeconds) {
			const q = new URLSearchParams();
			if (autoplay) q.set("autoplay", "1");
			if (startSeconds > 0) q.set("fromTime", String(Math.floor(startSeconds)));
			const s = q.toString();
			return `${OkruEmbedSrcBuilder.#DIRECT_BASE_URL}/${encodeURIComponent(videoId)}${s ? `?${s}` : ""}`;
		}
		#buildRelay(videoId, autoplay, startSeconds) {
			const url = new URL(this.#relayBaseUrl);
			url.searchParams.set("videoId", videoId);
			if (autoplay) url.searchParams.set("autoplay", "1");
			if (startSeconds > 0) url.searchParams.set("startSeconds", String(Math.floor(startSeconds)));
			const origin = this.#parentOrigin ?? globalThis.location?.origin;
			if (origin) url.searchParams.set("parentOrigin", origin);
			return url.href;
		}
	};
	// src/providers/okru/OkruPlayer.js
	/**
	* One Ok.ru iframe + its bridge. Ok.ru has no "load" command: loading = changing the src.
	* A list of videos is emulated here: the player moves through the ids, and goes to the next one on `ended`.
	* Same events as YouTubePlayer ("itemChange", "ended").
	*/
	var OkruPlayer = class {
		kind = "okru";
		#createIframe;
		#urlBuilder;
		#iframe = null;
		#bridge = null;
		#owned = false;
		#listeners = /* @__PURE__ */ new Set();
		/** @type {{ id: string, info: import("../../models/VideoInfo.js").VideoInfo | null }[]} a single video is a list of one */
		#items = [];
		#index = 0;
		/**
		* @param {Object} options
		* @param {(src: string) => HTMLIFrameElement} [options.createIframe] Required unless an iframe is adopted.
		* @param {HTMLIFrameElement} [options.iframe] An existing iframe to adopt.
		* @param {string} [options.embedBaseUrl] Relay page url (ignored if urlBuilder is given).
		* @param {OkruEmbedSrcBuilder} [options.urlBuilder]
		*/
		constructor({ createIframe = null, iframe = null, embedBaseUrl = null, urlBuilder = null } = {}) {
			this.#createIframe = createIframe;
			this.#urlBuilder = urlBuilder ?? new OkruEmbedSrcBuilder({ relayBaseUrl: embedBaseUrl });
			if (iframe) this.#attach(iframe, false);
		}
		get iframe() {
			return this.#iframe;
		}
		subscribe(onEvent) {
			this.#listeners.add(onEvent);
			return () => this.#listeners.delete(onEvent);
		}
		load(info, { autoplay = false, index = 0 } = {}) {
			this.#items = info instanceof VideoListInfo ? info.videoIds.map((id, i) => ({
				id,
				info: info.videos[i] ?? null
			})) : [{
				id: info.videoId,
				info
			}];
			this.#show(index, autoplay);
		}
		play() {
			this.#bridge?.command("play");
		}
		pause() {
			this.#bridge?.command("pause");
		}
		next() {
			this.#show(this.#index + 1, true);
		}
		previous() {
			this.#show(this.#index - 1, true);
		}
		playAt(index) {
			this.#show(index, true);
		}
		dispose() {
			this.#bridge?.disconnect();
			if (this.#owned) this.#iframe?.remove();
			this.#bridge = null;
			this.#iframe = null;
			this.#listeners.clear();
		}
		#show(index, autoplay) {
			const item = this.#items[index];
			if (!item) return;
			this.#index = index;
			const src = this.#urlBuilder.build({
				videoId: item.id,
				autoplay,
				startSeconds: item.info?.startSeconds
			});
			if (this.#iframe) this.#iframe.src = src;
			else {
				if (!this.#createIframe) throw new Error("OkruPlayer: createIframe is required when no iframe is adopted");
				this.#attach(this.#createIframe(src), true);
			}
			if (this.#items.length > 1) this.#emit({
				type: "itemChange",
				index
			});
		}
		#attach(iframe, owned) {
			this.#iframe = iframe;
			this.#owned = owned;
			this.#bridge = new OkruIframeBridge(iframe);
			this.#bridge.subscribe((e) => this.#onBridgeEvent(e), { types: [
				OkruBridgeEvent.VideoPlay,
				OkruBridgeEvent.VideoPause,
				OkruBridgeEvent.VideoEnded,
				OkruBridgeEvent.Error
			] });
			this.#bridge.connect();
		}
		#onBridgeEvent(e) {
			switch (e.type) {
				case OkruBridgeEvent.VideoPlay: return this.#emit({
					type: "state",
					state: "playing",
					index: this.#index
				});
				case OkruBridgeEvent.VideoPause: return this.#emit({
					type: "state",
					state: "paused",
					index: this.#index
				});
				case OkruBridgeEvent.VideoEnded:
					this.#emit({
						type: "state",
						state: "ended",
						index: this.#index
					});
					if (this.#index + 1 < this.#items.length) this.next();
					return;
				case OkruBridgeEvent.Error: return this.#emit({
					type: "error",
					error: new Error(e.message ?? "Ok.ru player error")
				});
			}
		}
		#emit(event) {
			for (const listener of [...this.#listeners]) listener(event);
		}
	};
	// src/providers/okru/OkruProvider.js
	var OkruProvider = class extends MediaProvider {
		id = "okru";
		hosts = ["ok.ru"];
		#infoParser;
		#embedBaseUrl;
		constructor({ infoParser = null, embedBaseUrl = null } = {}) {
			super();
			this.#infoParser = infoParser ?? new OkruInfoParser();
			this.#embedBaseUrl = embedBaseUrl;
		}
		getInfoFromElement(link) {
			return this.#infoParser.parseFromElement(link);
		}
		getInfoFromDefinition(definition) {
			if (!definition.url) definition.url = this.#infoParser.buildUrl(definition);
			return this.#infoParser.parseDefinition(definition);
		}
		createPlayer({ iframe = null } = {}) {
			return new OkruPlayer({
				createIframe: (src) => makeIframe({
					width: "560",
					height: "315",
					src,
					title: "OK.ru video player",
					allow: "autoplay; fullscreen",
					referrerPolicy: "strict-origin-when-cross-origin",
					allowFullscreen: true,
					extraAttrs: {}
				}),
				iframe,
				embedBaseUrl: this.#embedBaseUrl
			});
		}
	};
	// src/providers/youtube/YouTubeDataApi.js
	var YouTubeApiError = class extends Error {
		constructor(status, reason) {
			super(`YouTube API ${status}${reason ? ` (${reason})` : ""}`);
			this.name = "YouTubeApiError";
			this.status = status;
		}
	};
	/** ISO 8601 duration ("PT1H2M3S") to seconds. */
	function parseIsoDuration(iso) {
		if (!iso) return null;
		const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
		return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : null;
	}
	var snippetMeta = (s = {}) => {
		const channelId = s.videoOwnerChannelId ?? s.channelId ?? "";
		return {
			title: s.title ?? "",
			description: s.description ?? "",
			channel: s.videoOwnerChannelTitle ?? s.channelTitle ?? "",
			channelId,
			channelUrl: channelId ? `https://www.youtube.com/channel/${channelId}` : "",
			thumbnail: (s.thumbnails?.medium ?? s.thumbnails?.default)?.url ?? ""
		};
	};
	/** Reasons after which every call would fail too. A private playlist (403) must not disable the API for the other videos. */
	var DISABLING_REASONS = /* @__PURE__ */ new Set([
		"keyInvalid",
		"quotaExceeded",
		"dailyLimitExceeded",
		"rateLimitExceeded",
		"accessNotConfigured",
		"ipRefererBlocked"
	]);
	var YouTubeDataApi = class {
		#key;
		#fetch;
		#timeoutMs;
		#disabled = false;
		constructor({ apiKey, fetch = globalThis.fetch?.bind(globalThis), timeoutMs = 3e3 } = {}) {
			this.#key = apiKey;
			this.#fetch = fetch;
			this.#timeoutMs = timeoutMs;
		}
		/** False without a key, or once the API refused the key or the quota: no more calls are made. */
		get available() {
			return Boolean(this.#key) && !this.#disabled;
		}
		/** @returns {Promise>} video id -> meta. Private or deleted videos are absent. */
		async videos(ids) {
			if (!ids || ids.length === 0) return /* @__PURE__ */ new Map();
			const result = /* @__PURE__ */ new Map();
			for (let i = 0; i < ids.length; i += 50) {
				const data = await this.#get("videos", {
					part: "snippet,contentDetails",
					id: ids.slice(i, i + 50).join(",")
				});
				for (const v of data.items ?? []) result.set(v.id, {
					...snippetMeta(v.snippet),
					duration: parseIsoDuration(v.contentDetails?.duration)
				});
			}
			return result;
		}
		/** @returns {Promise<{ id: string, meta: object }[]>} in playlist order, at most `maxItems`. */
		async playlistItems(playlistId, maxItems = 200) {
			if (!playlistId) return [];
			const entries = [];
			let pageToken;
			do {
				const data = await this.#get("playlistItems", {
					part: "snippet",
					playlistId,
					maxResults: 50,
					pageToken
				});
				for (const it of data.items ?? []) entries.push({
					id: it.snippet.resourceId.videoId,
					meta: snippetMeta(it.snippet)
				});
				pageToken = data.nextPageToken;
			} while (pageToken && entries.length < maxItems);
			return entries.slice(0, maxItems);
		}
		async #get(path, params) {
			if (!this.available) throw new YouTubeApiError(0, "ApiDisabled");
			const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
			for (const [k, v] of Object.entries({
				...params,
				key: this.#key
			})) if (v != null) url.searchParams.set(k, v);
			const res = await this.#fetch(url, { signal: AbortSignal.timeout(this.#timeoutMs) });
			if (!res.ok) {
				const reason = (await res.json().catch(() => null))?.error?.errors?.[0]?.reason;
				if (res.status === 401 || res.status === 429 || DISABLING_REASONS.has(reason)) this.#disabled = true;
				throw new YouTubeApiError(res.status, reason);
			}
			return res.json();
		}
	};
	// src/providers/youtube/YouTubeMetaResolver.js
	var DAY = 864e5;
	/** The fields of an item the API can give (the same names as the VideoInfo getters). */
	var FIELDS = [
		"title",
		"description",
		"channel",
		"channelUrl",
		"thumbnail",
		"duration"
	];
	var fieldsOf = (source = {}) => Object.fromEntries(FIELDS.map((f) => [f, source[f]]));
	var fillEmpty = (meta, extra = {}) => {
		const out = { ...meta };
		for (const f of FIELDS) if (isEmpty(out[f]) && !isEmpty(extra[f])) out[f] = extra[f];
		return out;
	};
	/** "PL123#3": the id given to a playlist item whose id is unknown (see applyItems). */
	var isPlaceholder = (id) => typeof id === "string" && id.includes("#");
	/**
	* Completes the items of a YouTube list / playlist for the panel.
	* Order: what is declared (data-videos, code definitions) > YouTube Data API (cached) > fallback title ("Video 1"...).
	*
	* It only works when a REQUIRED field is empty (`required`, the title by default): everything declared is then
	* left alone and every other empty field is filled from the API too (description, channel, channelUrl, thumbnail, duration).
	* Without `api` (no key, or refused) only the fallback title is given. Never rejects.
	*
	* Its result is applied by applyItems() (metaMerge.js).
	*/
	var YouTubeMetaResolver = class {
		#api;
		#cache;
		#videoTtlMs;
		#playlistTtlMs;
		#fallbackTitle;
		#required;
		/**
		* @param {object} [options]
		* @param {YouTubeDataApi|null} [options.api] null: the API is never called.
		* @param {{ get(key): any, set(key, value, ttlMs): void }|null} [options.cache]
		* @param {number} [options.videoTtlMs] Video titles rarely change.
		* @param {number} [options.playlistTtlMs] A playlist content changes more often.
		* @param {(index: number) => string} [options.fallbackTitle] Title of an item that is still without one.
		* @param {string[]} [options.required] The fields that must not stay empty (names of VideoInfo getters).
		*/
		constructor({ api = null, cache = null, videoTtlMs = 7 * DAY, playlistTtlMs = DAY, fallbackTitle = (i) => `Video ${i + 1}`, required = ["title"] } = {}) {
			this.#api = api;
			this.#cache = cache;
			this.#videoTtlMs = videoTtlMs;
			this.#playlistTtlMs = playlistTtlMs;
			this.#fallbackTitle = fallbackTitle;
			this.#required = required;
		}
		/**
		* @param {VideoListInfo|PlaylistInfo} info
		* @returns {Promise<object[]|null>} Items [{ id, title, description, channel, channelUrl, thumbnail, duration }]
		*   for applyItems(), or null when there is nothing to do (not YouTube, not a list, or nothing required is missing).
		*/
		async resolve(info) {
			if (info.provider !== "youtube" || !info.isPlaylist) return null;
			const declared = info.videos.map((v) => ({
				id: v.videoId,
				meta: fieldsOf(v)
			}));
			if (declared.length > 0 && declared.every((d) => this.#isComplete(d.meta))) return null;
			let fetched = [];
			if (this.#api?.available) try {
				fetched = await this.#fetchEntries(info);
			} catch (error) {
				console.warn("[YouTubeMetaResolver] API failed, defaults used:", error.message);
			}
			return this.#merge(this.#base(info, declared, fetched), fetched);
		}
		#isComplete(meta) {
			return this.#required.every((field) => !isEmpty(meta[field]));
		}
		async #fetchEntries(info) {
			if (info.playlistId) return this.#playlistEntries(info.playlistId);
			const meta = await this.#videosMeta(info.videoIds);
			return info.videoIds.filter((id) => meta.has(id)).map((id) => ({
				id,
				meta: meta.get(id)
			}));
		}
		/** Cache per video: two lists sharing videos do not pay twice. */
		async #videosMeta(ids) {
			const result = /* @__PURE__ */ new Map();
			const missing = [];
			for (const id of ids) {
				const hit = this.#cache?.get(`video:v2:${id}`);
				if (hit) result.set(id, hit);
				else missing.push(id);
			}
			if (missing.length) for (const [id, meta] of await this.#api.videos(missing)) {
				result.set(id, meta);
				this.#cache?.set(`video:v2:${id}`, meta, this.#videoTtlMs);
			}
			return result;
		}
		async #playlistEntries(playlistId) {
			const key = `playlist:v2:${playlistId}`;
			const hit = this.#cache?.get(key);
			if (hit) return hit;
			const entries = await this.#api.playlistItems(playlistId);
			if (entries.length) this.#cache?.set(key, entries, this.#playlistTtlMs);
			return entries;
		}
		/** The items to complete, in the order of the panel: declared, else the ids of a list (all of them), else what the API says. */
		#base(info, declared, fetched) {
			if (declared.length) return declared;
			if (info.videoIds?.length) return info.videoIds.map((id) => ({
				id,
				meta: {}
			}));
			return fetched;
		}
		#merge(base, fetched) {
			const byId = new Map(fetched.map((entry) => [entry.id, entry.meta]));
			return base.map(({ id, meta }, index) => {
				const entry = byId.has(id) ? {
					id,
					meta: byId.get(id)
				} : isPlaceholder(id) ? fetched[index] : null;
				const filled = fillEmpty(meta, entry?.meta);
				return {
					id: entry?.id ?? id,
					...filled,
					title: filled.title || this.#fallbackTitle(index)
				};
			});
		}
	};
	// src/metaMerge.js
	/** A text: what is declared, else the fallback, else "". A text is never undefined. */
	var text = (declared, fallback) => isEmpty(declared) ? fallback ?? "" : declared;
	/**
	* Anything that is not a text (a number, a flag, an object, a key): what is declared, else the fallback,
	* else left as it was. Never turned into "": the model gives its own default (key, extra...).
	*/
	var fill = (declared, fallback) => isEmpty(declared) && !isEmpty(fallback) ? fallback : declared;
	/**
	* Items -> videos of a list / playlist, IN PLACE (the info keeps its identity: regions and journal compare by reference).
	* Values already declared (data-*, data-videos, definitions) win; items only fill the gaps.
	* An item: { id?, title, description, channel, channelUrl, thumbnail, duration, startSeconds (seconds), showOnInit, key, extra, autoplay }.
	* @param {VideoListInfo|PlaylistInfo} info
	* @param {object[]} items
	*/
	function applyItems(info, items) {
		const current = info.videos;
		const videos = items.map((item, i) => {
			const id = [
				item.id,
				info.videoIds?.[i],
				current[i]?.videoId
			].find((v) => !isEmpty(v)) ?? (info.playlistId ? `${info.playlistId}#${i}` : null);
			if (isEmpty(id)) return null;
			const old = current[i]?.videoId === id ? current[i] : current.find((v) => v.videoId === id);
			return new VideoInfo({
				provider: info.provider,
				target: info.target,
				videoId: id,
				autoplay: old ? old.autoplay : toAutoplayMode(item.autoplay),
				startSeconds: fill(old?.startSeconds, item.startSeconds),
				title: text(old?.title, item.title),
				description: text(old?.description, item.description),
				channel: text(old?.channel, item.channel),
				channelUrl: text(old?.channelUrl, item.channelUrl),
				thumbnail: text(old?.thumbnail, item.thumbnail),
				duration: fill(old?.duration, item.duration),
				showOnInit: fill(old?.showOnInit, item.showOnInit),
				key: fill(old?.key, item.key),
				extra: fill(old?.extra, item.extra) ?? null
			});
		}).filter(Boolean);
		info.setVideos(videos);
	}
	// src/ui/Tooltip.js
	var TOOLTIP_CSS = `
@layer lp-tooltip {
    .lp-tip{position:fixed;z-index:99999;display:none;width:280px;height:158px;border-radius:8px;overflow:hidden;pointer-events:none;background:linear-gradient(135deg,#222222,#111111);box-shadow:0 8px 24px rgba(0,0,0,.55);opacity:0;transform:translateY(4px);transition:opacity .15s ease,transform .15s ease;font:500 14px var(--lp-font,system-ui,sans-serif);color:#fff}
    .lp-tip.lp-show{opacity:1;transform:none}
     .lp-tip{background:radial-gradient(circle at 50% 30%, #1a1a1a 0%, #0d0d0d 70%)}
    .lp-tip[data-provider=youtube]{background:radial-gradient(circle at 50% 30%, #1c1111 0%, #0d0d0d 70%); --fa:#4d1414; --fb:#141414}
    .lp-tip[data-provider=dailymotion]{background:radial-gradient(circle at 50% 30%, #11151c 0%, #0d0d0d 70%); --fa:#123a63; --fb:#101820}
    .lp-tip[data-provider=okru]{background:radial-gradient(circle at 50% 30%, #1c1510 0%, #0d0d0d 70%); --fa:#5a3508; --fb:#181108}
    
    .lp-tip img,.lp-tip-loader{display:block;width:100%;height:100%;object-fit:cover}
    .lp-tip img[hidden],.lp-tip-loader[hidden]{display:none}
    
    .lp-tip-loader{background:linear-gradient(90deg,transparent,#2a2a2a 50%,transparent) 0 0/200% 100% #111;animation:lp-shimmer 1.2s infinite}
    @keyframes lp-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}
    
    .lp-tip-play{position:absolute;top:50%;left:50%;width:52px;height:52px;transform:translate(-50%,-50%);border-radius:50%;background:rgba(0,0,0,0.6);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;transition:background 0.2s ease}
    .lp-tip-play::after{content:"";display:block;width:0;height:0;border-style:solid;border-width:8px 0 8px 14px;border-color:transparent transparent transparent #ffffff;margin-left:3px}
    
    .lp-tip-title{position:absolute;bottom:0;left:0;right:0;padding:24px 12px 12px 12px;background:linear-gradient(transparent,rgba(0,0,0,0.8));z-index:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;text-shadow:1px 1px 2px rgba(0,0,0,.5)}
    
    .lp-tip.lp-nothumb{background:linear-gradient(135deg,var(--fa,#2f2f2f),var(--fb,#141414))}
    .lp-tip.lp-nothumb::before{content:attr(data-name);position:absolute;top:10px;left:12px;font:600 10px var(--lp-font,system-ui,sans-serif);letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.55)}
    .lp-tip.lp-nothumb .lp-tip-play{top:42%}
    .lp-tip.lp-nothumb .lp-tip-title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:normal;line-height:1.3}
}
.lp-nav-item{display:flex;align-items:center;gap:8px;padding:0;border:2px solid transparent;border-radius:6px;background:none;cursor:pointer;overflow:hidden;font:inherit;color:inherit}
.lp-nav-item img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover}
.lp-nav-item.lp-active{border-color:var(--lp-accent,#f7931e)}
.lp-nav-item:focus-visible{outline:2px solid var(--lp-accent,#f7931e);outline-offset:2px}
`;
	var SHOW_DELAY_MS = 120;
	var HIDE_DELAY_MS = 150;
	var THUMB_TIMEOUT_MS = 3e3;
	var CURSOR_MARGIN = 14;
	var YOUTUBE_MISSING_WIDTH = 120;
	/** Default Renderer mis à jour avec le nouveau design */
	var TooltipRenderer = class {
		createElement() {
			const tip = document.createElement("div");
			tip.className = "lp-tip";
			const loader = document.createElement("div");
			loader.className = "lp-tip-loader";
			const img = document.createElement("img");
			img.alt = "";
			const play = document.createElement("div");
			play.className = "lp-tip-play";
			const span = document.createElement("span");
			span.className = "lp-tip-title";
			tip.append(loader, img, play, span);
			return tip;
		}
		onShow(tip, { title, provider }) {
			const [loader, img] = tip.children;
			tip.dataset.provider = provider.id ?? "";
			tip.dataset.name = provider.name ?? "";
			tip.classList.remove("lp-nothumb");
			tip.lastChild.textContent = title;
			loader.hidden = false;
			img.hidden = true;
			img.removeAttribute("src");
		}
		onLoading(tip) {
			const [loader] = tip.children;
			loader.hidden = false;
		}
		onThumbLoaded(tip, url) {
			const [loader, img] = tip.children;
			loader.hidden = true;
			img.src = url;
			img.hidden = false;
		}
		onFallback(tip) {
			const [loader] = tip.children;
			loader.hidden = true;
			tip.classList.add("lp-nothumb");
		}
	};
	/** Thumbnail tooltip on hover (not on touch devices). One shared element. */
	var Tooltip = class {
		#token = 0;
		#el = null;
		#timer = null;
		#hideTimer = null;
		#last = null;
		#tooltipRenderer;
		#onPointerDown = () => {
			clearTimeout(this.#timer);
			this.#hide();
		};
		constructor(tooltipRenderer = null) {
			this.#tooltipRenderer = tooltipRenderer ?? new TooltipRenderer();
			document.addEventListener("pointerdown", this.#onPointerDown, true);
		}
		attach(target, getThumb, title, provider = {}) {
			const onEnter = (e) => {
				this.#last = e;
				clearTimeout(this.#timer);
				this.#timer = setTimeout(() => this.#show(getThumb, title, provider), SHOW_DELAY_MS);
			};
			const onMove = (e) => {
				this.#last = e;
				this.#move(e);
			};
			const onLeave = () => {
				clearTimeout(this.#timer);
				this.#hide();
			};
			target.addEventListener("mouseenter", onEnter);
			target.addEventListener("mousemove", onMove);
			target.addEventListener("mouseleave", onLeave);
			return () => {
				target.removeEventListener("mouseenter", onEnter);
				target.removeEventListener("mousemove", onMove);
				target.removeEventListener("mouseleave", onLeave);
				clearTimeout(this.#timer);
				this.#hide();
			};
		}
		#build() {
			const tip = this.#tooltipRenderer.createElement();
			tip.classList.add("lp-tip");
			document.body.append(tip);
			return this.#el = tip;
		}
		async #show(getThumb, titleResolver, provider) {
			injectStyles("lp-tooltip-styles", TOOLTIP_CSS);
			clearTimeout(this.#hideTimer);
			const token = ++this.#token;
			const tip = this.#el ?? this.#build();
			const title = typeof titleResolver === "function" ? titleResolver() : titleResolver;
			this.#tooltipRenderer.onShow(tip, {
				title,
				provider
			});
			tip.style.display = "block";
			this.#move(this.#last);
			requestAnimationFrame(() => {
				if (token === this.#token) tip.classList.add("lp-show");
			});
			const fallback = () => {
				if (token !== this.#token) return;
				this.#tooltipRenderer.onFallback(tip);
			};
			const url = await this.#fetchThumb(getThumb);
			if (token !== this.#token) return;
			if (!url) return fallback();
			const probe = new Image();
			probe.onload = () => {
				if (token !== this.#token) return;
				if (provider.id === "youtube" && probe.naturalWidth <= YOUTUBE_MISSING_WIDTH) return fallback();
				this.#tooltipRenderer.onThumbLoaded(tip, url);
			};
			probe.onerror = () => {
				if (token === this.#token) fallback();
			};
			probe.src = url;
		}
		async #fetchThumb(getThumb) {
			let timeoutId;
			const timeout = new Promise((resolve) => {
				timeoutId = setTimeout(() => resolve(null), THUMB_TIMEOUT_MS);
			});
			const thumb = (async () => getThumb())().catch(() => null);
			try {
				return await Promise.race([thumb, timeout]);
			} finally {
				clearTimeout(timeoutId);
			}
		}
		#move(e) {
			if (!this.#el || !e) return;
			const { offsetWidth: w, offsetHeight: h } = this.#el;
			const m = CURSOR_MARGIN;
			this.#el.style.left = `${e.clientX + m + w > innerWidth ? e.clientX - w - m : e.clientX + m}px`;
			this.#el.style.top = `${e.clientY + m + h > innerHeight ? e.clientY - h - m : e.clientY + m}px`;
		}
		#hide() {
			this.#token++;
			if (!this.#el) return;
			this.#el.classList.remove("lp-show");
			clearTimeout(this.#hideTimer);
			this.#hideTimer = setTimeout(() => {
				if (this.#el) this.#el.style.display = "none";
			}, HIDE_DELAY_MS);
		}
		dispose() {
			this.#token++;
			clearTimeout(this.#timer);
			clearTimeout(this.#hideTimer);
			document.removeEventListener("pointerdown", this.#onPointerDown, true);
			this.#el?.remove();
			this.#el = null;
		}
	};
	// src/LinkPlayer.js
	var noop = () => {};
	var nextId = 0;
	/**
	* Who handles which element. A WeakMap, not an attribute: cloneNode() copies attributes but not listeners,
	* so an attribute would make a cloned link look handled when it is not. data-lp stays as a debugging aid only.
	*/
	var owners = /* @__PURE__ */ new WeakMap();
	var LinkPlayer = class {
		#id;
		#scopeEl;
		#isGlobal;
		#currentBehavior;
		#useStorage;
		#scanEmbeds;
		#regions = /* @__PURE__ */ new Map();
		#initialized = /* @__PURE__ */ new WeakSet();
		#store;
		#registry;
		#tooltip;
		#thumbnails;
		#definitions;
		#youtubeMeta;
		#panelOptions;
		#events = new Emitter();
		#detachers = /* @__PURE__ */ new Set();
		constructor({ scope = null, definitions = null, autoScan = true, useStorage = true, tooltip = true, currentBehavior = "toggle", scanEmbeds = true, youtubeApiKey = null, youtubeMeta = null, fallbackTitle = void 0, okruEmbedBaseUrl = null, store = null, registry = null, panelRenderer = null, itemRenderer = null, headerRenderer = null, toggleRenderer = null, groupRenderer = null, tooltipRenderer = null, thumbnails = null, onChange = noop, onState = noop, onError = (e) => console.warn("[LinkPlayer]", e.error ?? e) } = {}) {
			this.#scopeEl = resolveScope(scope);
			this.#isGlobal = this.#scopeEl === null;
			this.#id = `lp-${++nextId}`;
			if (this.#scopeEl) {
				const taken = this.#scopeEl.dataset.lpScope;
				if (taken && taken !== this.#id) throw new Error("This scope already has a LinkPlayer");
				this.#scopeEl.dataset.lpScope = this.#id;
			}
			this.#useStorage = useStorage;
			this.#scanEmbeds = scanEmbeds;
			this.#definitions = definitions;
			this.#currentBehavior = currentBehavior;
			this.#store = store ?? (useStorage ? defaultStore() : new MemoryStore());
			this.#registry = registry ?? new ProviderRegistry([new YouTubeProvider(), new OkruProvider({ embedBaseUrl: okruEmbedBaseUrl })]);
			this.#thumbnails = thumbnails ?? new ThumbnailService();
			this.#tooltip = tooltip && !isTouch() ? new Tooltip(tooltipRenderer) : null;
			this.#youtubeMeta = youtubeMeta ?? new YouTubeMetaResolver({
				api: youtubeApiKey ? new YouTubeDataApi({ apiKey: youtubeApiKey }) : null,
				cache: this.#store,
				fallbackTitle
			});
			this.#panelOptions = {
				panelRenderer,
				itemRenderer,
				headerRenderer,
				toggleRenderer,
				groupRenderer
			};
			this.on("change", onChange);
			this.on("state", onState);
			this.on("error", onError);
			this.#registerDefs(definitions);
			if (autoScan) this.scan();
		}
		get id() {
			return this.#id;
		}
		get isGlobal() {
			return this.#isGlobal;
		}
		get useStorage() {
			return this.#useStorage;
		}
		get regions() {
			return Object.freeze([...this.#regions.values()]);
		}
		on(type, handler) {
			return this.#events.on(type, handler);
		}
		off(type, handler) {
			this.#events.off(type, handler);
		}
		getRegion(target) {
			let region = this.#regions.get(target);
			if (region) return region;
			region = new Region({
				target,
				registry: this.#registry,
				currentBehavior: this.#currentBehavior,
				resolveMeta: (info) => this.#enrich(info),
				thumbnails: this.#thumbnails,
				...this.#panelOptions
			});
			region.on("*", (event) => this.#onRegionEvent(event));
			this.#regions.set(target, region);
			return region;
		}
		/**
		* Can be called again after the page changed: links and iframes already handled are skipped.
		* Also initializes (saved state / showOnInit) the regions that were not yet: call it after define() calls
		* made once the first scan is done.
		*/
		scan() {
			let taken = 0;
			for (const element of this.getLinks()) {
				const owner = owners.get(element);
				if (owner === this) continue;
				if (owner) {
					taken++;
					continue;
				}
				try {
					this.#register(element);
				} catch (error) {
					this.#events.emit("error", {
						error,
						element
					});
				}
			}
			if (taken) this.#events.emit("error", { error: /* @__PURE__ */ new Error(`${taken} element(s) already handled by another LinkPlayer: create the scoped player first, or declare the scope in the HTML (data-lp-scope)`) });
			for (const region of this.#regions.values()) {
				if (this.#initialized.has(region)) continue;
				this.#initialized.add(region);
				this.#init(region);
			}
		}
		/** The links this player is responsible for: those whose innermost scope boundary is its own (none for the global one). */
		getLinks() {
			return [...this.getRoot().querySelectorAll("[data-link]")].filter((element) => element.closest("[data-lp-scope]") === this.#scopeEl);
		}
		getRoot() {
			return this.#scopeEl ?? document;
		}
		getSavedState(region) {
			return this.#useStorage ? this.#store.get(`state:${region.target}`) : null;
		}
		dispose() {
			if (this.#scopeEl?.dataset.lpScope === this.#id) delete this.#scopeEl.dataset.lpScope;
			for (const detach of this.#detachers) detach();
			this.#detachers.clear();
			this.#regions.forEach((region) => region.dispose());
			this.#regions.clear();
			this.#tooltip?.dispose();
			this.#events.clear();
		}
		#registerDefs(definitions) {
			if (!Array.isArray(definitions)) return;
			for (const def of definitions) {
				const info = (def.url ? this.#registry.resolve(def.url) : this.#registry.get(def.provider)).getInfoFromDefinition(def);
				const target = def.target;
				if (!target) throw new Error("Target required");
				this.getRegion(target).add(info);
			}
		}
		#register(element) {
			const isIframe = element.tagName === "IFRAME";
			if (isIframe && !this.#scanEmbeds) return;
			const target = element.dataset.target || (isIframe ? element.parentElement?.id : null);
			if (!target) throw new Error("Target required");
			const url = isIframe ? element.src : element.tagName === "A" ? element.href : element.dataset.url;
			if (!url) throw new Error("No URL provided");
			const provider = this.#registry.resolve(url);
			const region = this.getRegion(target);
			const parsed = provider.getInfoFromElement(element);
			const info = region.add(parsed) ? parsed : region.get(parsed.key);
			owners.set(element, this);
			element.dataset.lp = this.#id;
			const release = () => {
				owners.delete(element);
				delete element.dataset.lp;
			};
			if (isIframe) {
				region.adopt(element, info);
				this.#detachers.add(release);
				return;
			}
			const key = info.key;
			const current = () => region.get(key) ?? info;
			const onClick = (e) => {
				e.preventDefault();
				const target = current();
				region.navigate(target.key, {
					autoplay: target.autoplay === AUTOPLAY_MODES.INIT || target.autoplay === AUTOPLAY_MODES.CLICK,
					index: target.index
				});
			};
			element.addEventListener("click", onClick);
			const detachTip = this.#attachTooltip(element, current, provider);
			this.#detachers.add(() => {
				element.removeEventListener("click", onClick);
				detachTip();
				release();
			});
		}
		/** Completes the items of a playlist; called by the region the first time the playlist is shown. */
		async #enrich(info) {
			if (info.provider !== "youtube") return false;
			const items = await this.#youtubeMeta.resolve(info);
			if (!items?.length) return false;
			applyItems(info, items);
			return true;
		}
		/** The region events already carry `info` and `data`. */
		#onRegionEvent(event) {
			this.#events.emit(event.type, event);
			if (event.type === "change") this.#save(event);
		}
		/** The state is saved at every navigation change, not only when the page closes. */
		#save({ region, info, index }) {
			if (!this.#useStorage || !info) return;
			this.#store.set(`state:${region.target}`, {
				key: info.key,
				index
			});
		}
		#init(region) {
			if (region.current) return;
			const saved = this.getSavedState(region);
			const restored = saved && region.get(saved.key);
			if (restored) return region.navigate(restored.key, { index: saved.index ?? 0 });
			const first = region.infos.find((info) => info.showOnInit);
			if (first) region.navigate(first.key, {
				autoplay: first.autoplay === AUTOPLAY_MODES.INIT,
				index: first.index
			});
		}
		/** Values are read when the tooltip opens, so what the API or the definitions filled in later is used. */
		#tooltipData(info) {
			const first = info.isPlaylist ? info.videos[0] : info;
			return {
				title: first?.title ?? "",
				thumbnail: first?.thumbnail || null
			};
		}
		#attachTooltip(element, getInfo, provider) {
			if (!this.#tooltip) return noop;
			return this.#tooltip.attach(element, () => this.#thumbnails.resolve(this.#tooltipData(getInfo()).thumbnail), () => this.#tooltipData(getInfo()).title, {
				id: provider.id,
				name: provider.name ?? provider.id
			});
		}
	};
	return LinkPlayer;
});

//# sourceMappingURL=link-player.js.map