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
	// src/utils/helpers.js
	var toInt = (v) => {
		if (v == null || v === "") return null;
		const n = parseInt(v, 10);
		return Number.isNaN(n) ? null : n;
	};
	var toNumber = (value) => {
		if (value === void 0 || value === null || String(value).trim() === "") return void 0;
		const n = Number(value);
		return Number.isNaN(n) ? void 0 : n;
	};
	var toBool01 = (v) => {
		if (v === "1" || v === 1 || v === true) return true;
		if (v === "0" || v === 0 || v === false) return false;
		return null;
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
	var timeToSeconds = (v) => {
		if (v == null || v === "") return null;
		if (/^\d+$/.test(v)) return parseInt(v, 10);
		const m = String(v).match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
		if (!m || !m[1] && !m[2] && !m[3]) return null;
		return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
	};
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
	// src/DefaultRegionHost.js
	/**
	* Discovers links, target containers and frames in a root and reports the NEW ones.
	* No observer: discovery happens when discoverAll() is called (LinkPlayer.scan()), and what is
	* not found yet (a container created later...) is looked up again on the next call.
	*/
	var DefaultRegionHost = class {
		#id;
		#registeredLinks = /* @__PURE__ */ new Map();
		#registeredTargets = /* @__PURE__ */ new Map();
		#registeredFrames = /* @__PURE__ */ new Set();
		#defaultTarget = null;
		#root = null;
		#onLinkDiscovered = null;
		#onFrameDiscovered = null;
		#onTargetDiscovered = null;
		init({ id, root, onLinkDiscovered = null, onFrameDiscovered = null, onTargetDiscovered = null }) {
			this.#id = id;
			this.#root = root ?? document;
			this.#onLinkDiscovered = onLinkDiscovered;
			this.#onFrameDiscovered = onFrameDiscovered;
			this.#onTargetDiscovered = onTargetDiscovered;
		}
		get links() {
			return Object.freeze([...this.#registeredLinks.keys()]);
		}
		get targets() {
			return Object.freeze([...this.#registeredTargets]);
		}
		get frames() {
			return Object.freeze([...this.#registeredFrames]);
		}
		get defaultTarget() {
			return this.#defaultTarget;
		}
		setDefaultTarget(target) {
			this.#defaultTarget = target;
		}
		discoverAll() {
			this.discoverLinks();
			this.discoverTargets();
			this.discoverFrames();
		}
		discoverLinks() {
			this.#forget(this.#registeredLinks.keys(), (el) => this.#registeredLinks.delete(el));
			const linkElements = this.#root.querySelectorAll("[data-link]");
			const newLinks = [];
			for (const element of linkElements) {
				const href = element.tagName === "A" ? element.href : element.dataset.url;
				if (href && !this.#registeredLinks.has(element)) {
					this.#registeredLinks.set(element, href);
					newLinks.push(element);
				}
			}
			if (newLinks.length > 0) this.#onLinkDiscovered?.(newLinks);
		}
		discoverTargets() {
			this.#forget(this.#registeredTargets.values(), (el) => {
				for (const [id, container] of this.#registeredTargets) if (container === el) {
					this.#registeredTargets.delete(id);
					break;
				}
			});
			const wanted = /* @__PURE__ */ new Set();
			if (this.#defaultTarget) wanted.add(this.#defaultTarget);
			for (const link of this.#registeredLinks.keys()) {
				const target = link.dataset.target || this.#defaultTarget;
				if (target) wanted.add(target);
			}
			const newTargets = /* @__PURE__ */ new Map();
			for (const target of wanted) {
				const known = this.#registeredTargets.get(target);
				if (known?.isConnected) continue;
				const container = this.#findById(target);
				if (container && container !== known) {
					this.#registeredTargets.set(target, container);
					newTargets.set(target, container);
				}
			}
			if (newTargets.size > 0) this.#onTargetDiscovered?.(newTargets);
		}
		discoverFrames() {
			this.#forget(this.#registeredFrames, (el) => this.#registeredFrames.delete(el));
			const frameElements = this.#root.querySelectorAll("iframe");
			const newFrames = [];
			for (const element of frameElements) if (!this.#registeredFrames.has(element)) {
				this.#registeredFrames.add(element);
				newFrames.push(element);
			}
			if (newFrames.length > 0) this.#onFrameDiscovered?.(newFrames);
		}
		clear() {
			this.#registeredLinks.clear();
			this.#registeredTargets.clear();
			this.#registeredFrames.clear();
			this.#defaultTarget = null;
		}
		/** Elements removed from the page are forgotten, so they are discovered again if they come back. */
		#forget(elements, remove) {
			for (const el of [...elements]) if (!el.isConnected) remove(el);
		}
		/** `getElementById` only exists on a document / shadow root; a scope is an element. */
		#findById(id) {
			const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
			return this.#root.querySelector(`#${escaped}`);
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
			this.#defaultWidth = items.some((item) => item.thumbnail) ? 280 : 176;
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
			if (item.thumbnail) {
				const thumb = document.createElement("div");
				thumb.className = "lp-thumb";
				const image = document.createElement("img");
				image.alt = "";
				image.loading = "lazy";
				this._thumbnails.resolve(item.thumbnail).then((url) => {
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
	var NO_PARAMS = Object.freeze({});
	/**
	* Navigation params are a SNAPSHOT: later changes of the caller's object do not leak into the history,
	* and a hook cannot alter what the next one sees.
	*/
	var freezeParams = (params) => params ? Object.freeze({ ...params }) : NO_PARAMS;
	/**
	* What an afterNavigate hook receives.
	* @typedef {Object} NavigationState
	* @property {object} info    VideoInfo / VideoListInfo / PlaylistInfo shown.
	* @property {number} index   Item of the list / playlist (0 for a single video).
	* @property {object|null} item  The video playing: `info` for a single video, `info.videos[index]` for a list
	*                            (null while the items are not known yet).
	* @property {Readonly<object>} params  Free data given by the caller of navigate(); {} when none.
	* @property {string} reason  "navigate" | "replace" | "back" | "forward" | "restore" | "adopt" | "item" | "meta" | "immediate"
	*/
	var Region = class {
		#target;
		#host = null;
		#registry;
		#infos = /* @__PURE__ */ new Map();
		#journal = new NavigationJournal();
		#events = new Emitter();
		#panel;
		#player = null;
		#unsubscribe = null;
		#rendered = null;
		#playerIndex = 0;
		#panelInfo = null;
		#resolveMeta;
		#resolved = /* @__PURE__ */ new WeakSet();
		#afterHooks = /* @__PURE__ */ new Set();
		#from = null;
		#currentBehavior;
		#boundaryBehavior;
		#pending = [];
		/**
		* @param {object} options
		* @param {"toggle"|"skip"|string} [options.currentBehavior] What navigate() does on the info already shown.
		* @param {"stop"|"loop"} [options.boundaryBehavior] What nextInfo() / previousInfo() do at the ends of the
		*   list of infos: "stop" (nothing happens) or "loop" (last -> first, first -> last). Needs 2 infos or more.
		* @param {(info, options: {force: boolean}) => Promise<boolean>|boolean} [options.resolveMeta] Completes the metadata
		*   of an info (items of a playlist, title / channel of a single video...): true when it changed something. Called the
		*   first time each info is shown (force: false) and by refreshMeta(); it decides by itself what is worth fetching.
		*/
		constructor({ target, registry, currentBehavior = "toggle", boundaryBehavior = "stop", resolveMeta = null, panelRenderer = null, itemRenderer = null, headerRenderer = null, toggleRenderer = null, groupRenderer = null, thumbnails = null }) {
			this.#target = target;
			this.#host = document.getElementById(target);
			this.#registry = registry;
			this.#currentBehavior = currentBehavior;
			if (boundaryBehavior !== "stop" && boundaryBehavior !== "loop") throw new TypeError(`Invalid boundaryBehavior '${boundaryBehavior}': expected "stop" or "loop".`);
			this.#boundaryBehavior = boundaryBehavior;
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
		/** The params of the current navigation ({} when none). */
		get currentParams() {
			return this.#journal.current?.params ?? NO_PARAMS;
		}
		get isVisible() {
			return this.#host !== null && !this.#host.hidden;
		}
		/** true once the container (html element) is known. */
		get hasContainer() {
			return this.#host !== null;
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
			return this.#infoIndex() > 0 || this.#canLoop();
		}
		get canGoNextInfo() {
			const i = this.#infoIndex();
			return (i >= 0 ? i < this.#infos.size - 1 : this.#infos.size > 0) || this.#canLoop();
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
		/** The container has been discovered: runs the navigation actions that were waiting for it. */
		register(host) {
			if (this.#host !== host) {
				if (this.#host) this.#resetContent();
				this.#host = host;
			}
			this.#flushPending();
		}
		hasPending() {
			return this.#pending.length > 0;
		}
		isCurrent(key) {
			const info = this.get(key);
			return !!(info && this.#journal.current?.info === info);
		}
		/**
		* @param {string} key
		* @param {{autoplay?: boolean, index?: number, params?: object}} [options]
		*   `params`: free data of THIS navigation (who asked, why...). Given to the afterNavigate hooks and
		*   to the "change" event, and kept in the history (back / forward give them again).
		*/
		navigate(key, options) {
			if (!this.has(key)) throw new Error(`No info found for key '${key}'`);
			this.#whenReady(() => {
				if (this.isCurrent(key)) {
					if (this.#currentBehavior === "skip") return;
					if (this.#currentBehavior === "toggle") return this.toggle();
				}
				this.#navigate(this.get(key), options);
			});
		}
		/** Like navigate(), but the current history entry is replaced (nothing is added). */
		replace(key, { autoplay = false, index = 0, params } = {}) {
			if (!this.has(key)) throw new Error(`No info found for key '${key}'`);
			this.#whenReady(() => {
				const info = this.get(key);
				this.#journal.replace({
					info,
					index,
					params: freezeParams(params)
				});
				this.#show(info, {
					autoplay,
					index
				}, "replace");
			});
		}
		/**
		* Restores a saved state. Unlike navigate(), it never toggles: when the info is already the
		* current one (adopted iframe), only the item may change, with a single command.
		* @returns {boolean} false when the key is unknown (a saved key may have disappeared).
		*/
		restore(key, { index = 0, params } = {}) {
			if (!this.has(key)) return false;
			this.#whenReady(() => {
				const info = this.get(key);
				if (this.isCurrent(key)) {
					if (!info.isPlaylist || index === this.currentIndex) return;
					this.#journal.updateCurrent({ index });
					this.#select(info, {
						autoplay: false,
						index
					});
					this.#changed("restore");
					return;
				}
				this.#navigate(info, {
					autoplay: false,
					index,
					params
				}, "restore");
			});
			return true;
		}
		goBack() {
			if (!this.#host) return false;
			return this.#restore(this.#journal.back(), "back");
		}
		goForward() {
			if (!this.#host) return false;
			return this.#restore(this.#journal.forward(), "forward");
		}
		/** @param {{autoplay?: boolean, params?: object}} [options] autoplay is true by default. */
		nextInfo(options) {
			return this.#step(1, options);
		}
		previousInfo(options) {
			return this.#step(-1, options);
		}
		nextItem() {
			this.#player?.next();
		}
		previousItem() {
			this.#player?.previous();
		}
		playAt(index) {
			this.#playerIndex = index;
			this.#player?.playAt(index);
			this.#journal.updateCurrent({ index });
			this.#panel.setCurrent(index);
			this.#changed("item");
		}
		/**
		* Takes over an iframe that is already in the page (and inside the target): the player drives it
		* and the panel is added for a playlist / list. `info` is parsed from the iframe src.
		*/
		adopt(iframe, info, { index = 0, params } = {}) {
			if (!this.#host) this.register(iframe.parentElement);
			if (!this.#host.contains(iframe)) throw new Error(`The iframe is not inside #${this.#target}`);
			this.add(info);
			info = this.get(info.key);
			this.#disposePlayer();
			this.#panelInfo = null;
			this.#player = this.#registry.get(info.provider).createPlayer({ iframe });
			this.#unsubscribe = this.#subscribe(this.#player);
			this.#rendered = info;
			this.#playerIndex = index;
			this.#journal.push({
				info,
				index,
				params: freezeParams(params)
			});
			this.#syncPanel(info, iframe, index);
			this.#changed("adopt");
			this.#resolveMetaLater(info);
		}
		toggle() {
			if (!this.#host) return;
			if (this.#host.hidden) this.show();
			else this.hide();
		}
		show() {
			if (!this.#host) return;
			this.#host.hidden = false;
			this.#changed("visibility");
		}
		hide() {
			if (!this.#host) return;
			this.#player?.pause();
			this.#host.hidden = true;
			this.#changed("visibility");
		}
		dispose() {
			this.#disposePlayer();
			this.#panel.destroy();
			this.#pending.length = 0;
			this.#afterHooks.clear();
			this.#events.clear();
		}
		/**
		* Registers a hook run AFTER every navigation (navigate, replace, back, forward, restore, adopt) and every
		* item change of a playlist: the video is shown, the history and the panel are up to date. It is meant to
		* update the page next to the video; it cannot cancel or change the navigation. Not run for show / hide.
		* `to.reason === "meta"` : the titles / thumbnails of the playlist have just been completed.
		* A hook that throws (or rejects) is reported in the console and does not stop the others.
		* The same function registered twice runs once.
		*
		* @param {(to: NavigationState, from: NavigationState|null) => void|Promise<void>} hook
		* @param {{immediate?: boolean}} [options] immediate: also runs once now when something is already shown
		*   (`from` is null, reason "immediate"): useful when the hook is registered after the first scan.
		* @returns {() => void} Function that removes the hook.
		*/
		afterNavigate(hook, { immediate = false } = {}) {
			if (typeof hook !== "function") throw new TypeError("afterNavigate(): a function is expected");
			this.#afterHooks.add(hook);
			if (immediate) {
				const to = this.#state("immediate");
				if (to) this.#runHook(hook, to, null);
			}
			return () => this.#afterHooks.delete(hook);
		}
		/**
		* Completes the metadata (title, description, channel...) of an info, even a single video, then runs the
		* afterNavigate hooks with reason "meta" when something changed. Unlike the automatic call (first display only),
		* it asks again each time it is called.
		* @param {string} [key] Key of the info; the current one by default.
		* @param {{force?: boolean}} [options] force (default true): do not skip an info whose required fields are present.
		* @returns {Promise<boolean>} true when something changed; false too when there is nothing to resolve or it failed.
		*/
		refreshMeta(key = this.current?.key, { force = true } = {}) {
			const info = key ? this.get(key) : null;
			if (!info || !this.#resolveMeta) return Promise.resolve(false);
			this.#resolved.add(info);
			return this.#completeMeta(info, { force });
		}
		/** Runs now when the container is known, otherwise when it is registered. */
		#whenReady(action) {
			if (this.#host) return action();
			this.#pending.push(action);
		}
		#flushPending() {
			if (!this.#host || !this.#pending.length) return;
			const actions = this.#pending.splice(0);
			for (const action of actions) try {
				action();
			} catch (error) {
				this.#fail(error);
			}
		}
		#infoIndex() {
			return this.infos.indexOf(this.current);
		}
		#navigate(info, { autoplay = false, index = 0, params } = {}, reason = "navigate") {
			this.#journal.push({
				info,
				index,
				params: freezeParams(params)
			});
			this.#show(info, {
				autoplay,
				index
			}, reason);
		}
		/** The history entry carries its params: the hooks get the same ones as the first time. */
		#restore(entry, reason) {
			if (!entry) return false;
			this.#show(entry.info, {
				autoplay: false,
				index: entry.index
			}, reason);
			return true;
		}
		#step(delta, options = {}) {
			if (!this.#host) return false;
			const target = this.#stepTarget(delta);
			if (!target) return false;
			this.#navigate(target, {
				autoplay: true,
				...options
			});
			return true;
		}
		/** The info `delta` (1 or -1) away from the current one; at an end: the other end when looping, else undefined. */
		#stepTarget(delta) {
			const infos = this.infos;
			const next = infos[this.#infoIndex() + delta];
			if (next) return next;
			if (!this.#canLoop()) return void 0;
			return infos.at(delta > 0 ? 0 : -1);
		}
		/** Looping onto the only info would navigate to the current one (and toggle it): it needs two infos. */
		#canLoop() {
			return this.#boundaryBehavior === "loop" && this.#infos.size > 1;
		}
		/**
		* The frame is rewritten ONLY when the info changes (another video, another video list, another
		* playlist). Same info, other item of the list / playlist: a single command to the existing player.
		*/
		#show(info, { autoplay, index }, reason) {
			try {
				if (this.#player && this.#rendered === info) this.#select(info, {
					autoplay,
					index
				});
				else this.#render(info, {
					autoplay,
					index
				});
				this.#host.hidden = false;
			} catch (error) {
				this.#fail(error, { info });
				return;
			}
			this.#changed(reason);
			this.#resolveMetaLater(info);
		}
		#render(info, { autoplay, index }) {
			const provider = this.#registry.get(info.provider);
			const previous = this.#player?.iframe;
			this.#disposePlayer();
			try {
				previous?.remove();
			} catch (error) {
				console.warn("[Region] unable to remove the previous iframe", error);
			}
			this.#panelInfo = null;
			this.#panel.clear();
			this.#player = provider.createPlayer();
			this.#unsubscribe = this.#subscribe(this.#player);
			this.#playerIndex = index;
			this.#player.load(info, {
				autoplay,
				index
			});
			const iframe = this.#player.iframe;
			iframe.dataset.lp ||= this.#target;
			if (!iframe.isConnected) this.#host.prepend(iframe);
			this.#rendered = info;
			this.#syncPanel(info, iframe, index);
		}
		/** Same info: no new frame, only a command. */
		#select(info, { autoplay, index }) {
			if (info.isPlaylist && index !== this.#playerIndex) {
				this.#playerIndex = index;
				if (this.#player.selectItem) this.#player.selectItem(info, index, { autoplay });
				else this.#player.playAt(index);
				this.#panel.setCurrent(index);
			} else if (autoplay) this.#player.play?.();
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
		/** Metadata may come from an API: what is shown first is drawn again once it is known. Asked once per info. */
		#resolveMetaLater(info) {
			if (!this.#resolveMeta || this.#resolved.has(info)) return;
			this.#resolved.add(info);
			this.#completeMeta(info, { force: false });
		}
		#completeMeta(info, options) {
			return Promise.resolve(this.#resolveMeta(info, options)).then((changed) => {
				if (changed) this.#metaChanged(info);
				return Boolean(changed);
			}, (error) => {
				this.#fail(error, { info });
				return false;
			});
		}
		#metaChanged(info) {
			if (this.current !== info) return;
			if (info.isPlaylist && this.#player?.iframe) {
				this.#panelInfo = null;
				this.#syncPanel(info, this.#player.iframe, this.currentIndex);
			}
			this.#runAfterHooks("meta");
		}
		/** The name of the subscription method differs between players. */
		#subscribe(player) {
			return player.subscribe.call(player, (e) => this.#onPlayerEvent(e));
		}
		#onPlayerEvent(event) {
			if (event.type === "itemChange") {
				if (event.index === this.#playerIndex) return;
				this.#playerIndex = event.index;
				this.#journal.updateCurrent({ index: event.index });
				this.#panel.setCurrent(event.index);
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
				params: this.currentParams,
				visible: this.isVisible
			});
			if (reason !== "visibility") this.#runAfterHooks(reason);
		}
		#state(reason) {
			const entry = this.#journal.current;
			if (!entry) return null;
			const { info, index, params } = entry;
			const item = info.isPlaylist ? info.videos[index] ?? null : info;
			return Object.freeze({
				info,
				index,
				item,
				params: params ?? NO_PARAMS,
				reason
			});
		}
		#runAfterHooks(reason) {
			const to = this.#state(reason);
			if (!to) return;
			const from = this.#from;
			this.#from = to;
			for (const hook of [...this.#afterHooks]) this.#runHook(hook, to, from);
		}
		#runHook(hook, to, from) {
			try {
				const result = hook(to, from);
				if (typeof result?.then === "function") result.catch((error) => console.error("[Region] afterNavigate hook failed:", error));
			} catch (error) {
				console.error("[Region] afterNavigate hook failed:", error);
			}
		}
		#fail(error, context = {}) {
			if (!this.#events.emit("error", {
				region: this,
				error,
				...context
			})) console.error("[Region]", error);
		}
		/** The fields are cleared FIRST: a player that throws in dispose() must not stay registered. */
		#disposePlayer() {
			const unsubscribe = this.#unsubscribe;
			const player = this.#player;
			this.#unsubscribe = null;
			this.#player = null;
			this.#rendered = null;
			try {
				unsubscribe?.();
			} catch (error) {
				console.warn("[Region] unsubscribe failed", error);
			}
			try {
				player?.dispose();
			} catch (error) {
				console.warn(`[Region] dispose failed (${player?.kind ?? "player"})`, error);
			}
		}
		/** The container changed: nothing of what was drawn in the previous one exists anymore. */
		#resetContent() {
			this.#disposePlayer();
			this.#rendered = null;
			this.#panelInfo = null;
			this.#panel.clear();
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
			if (!provider?.id || !Array.isArray(provider.hosts)) throw new TypeError("register(): a providers needs an id and a hosts array");
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
	// src/providers/InfoParser.js
	var InfoParser = class {
		getUrl(element) {
			if (element.tagName === "A") return element.href;
			if (element.tagName === "IFRAME") return element.src;
			return element.dataset?.url;
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
		parseSrc(src) {
			throw new Error("parseSrc() must be implemented");
		}
		buildUrl(def) {
			throw new Error("buildUrl() must be implemented");
		}
		parseFromLink(link) {
			const url = this.getUrl(link);
			if (!url) throw new Error(`No URL found for element '${link}'`);
			return this.parseDefinition({
				url,
				...this.readLinkData(link)
			}, link);
		}
		parseFromFrame(frame) {
			throw new Error("parseFromFrame() must be implemented");
		}
		parseDefinition(def, element) {
			throw new Error("parseDefinition() must be implemented");
		}
		getValidUrl(url) {
			try {
				return new URL(String(url).trim());
			} catch {
				return null;
			}
		}
	};
	// src/models/UrlInfo.js
	var UrlInfo = class {
		#kind;
		#videoId;
		#videoIds;
		#playlistId;
		#startSeconds;
		#index;
		#labels;
		#source;
		constructor({ kind, videoId, videoIds, playlistId, startSeconds, index, labels, source }) {
			this.#kind = kind;
			this.#videoId = videoId;
			this.#videoIds = videoIds;
			this.#playlistId = playlistId;
			this.#startSeconds = startSeconds;
			this.#index = index;
			this.#labels = labels;
			this.#source = source;
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
		get startSeconds() {
			return this.#startSeconds;
		}
		get index() {
			return this.#index;
		}
		get labels() {
			return this.#labels;
		}
		get source() {
			return this.#source;
		}
	};
	var SrcInfo = class extends UrlInfo {
		#autoplay;
		#mute;
		constructor({ kind, videoId, videoIds, playlistId, startSeconds, index, labels, source, autoplay, mute }) {
			super({
				kind,
				videoId,
				videoIds,
				playlistId,
				startSeconds,
				index,
				labels,
				source
			});
			this.#autoplay = autoplay;
			this.#mute = mute;
		}
		get autoplay() {
			return this.#autoplay;
		}
		get mute() {
			return this.#mute;
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
		#source;
		constructor({ provider, target, videoId, autoplay, startSeconds, title, description, channel, channelUrl, thumbnail, duration, showOnInit, key, extra, source }) {
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
			this.#source = source;
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
		get source() {
			return this.#source;
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
		#autoplay;
		#videos = [];
		#extra;
		#source;
		constructor({ provider, target, videoIds, index, showOnInit, autoplay, key, extra, source }) {
			ValueChecks.requireNotNullOrEmpty(provider, "provider");
			ValueChecks.requireNotNullOrEmpty(target, "target");
			this.#provider = provider;
			this.#target = target;
			this.#videoIds = videoIds;
			this.#index = index;
			this.#showOnInit = showOnInit;
			this.#autoplay = autoplay;
			this.#videoIds = [...videoIds];
			this.#extra = extra;
			this.#source = source;
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
		get autoplay() {
			return this.#autoplay;
		}
		get videos() {
			return Object.freeze([...this.#videos]);
		}
		get extra() {
			return this.#extra;
		}
		get source() {
			return this.#source;
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
		#autoplay;
		#videos = [];
		#extra;
		#source;
		constructor({ provider, target, playlistId, videoId, showOnInit, autoplay, key, extra, source }) {
			ValueChecks.requireNotNullOrEmpty(provider, "provider");
			ValueChecks.requireNotNullOrEmpty(target, "target");
			ValueChecks.requireNotNullOrEmpty(playlistId, "playlistId");
			this.#provider = provider;
			this.#target = target;
			this.#playlistId = playlistId;
			this.#videoId = videoId;
			this.#showOnInit = showOnInit;
			this.#autoplay = autoplay;
			this.#extra = extra;
			this.#source = source;
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
		get autoplay() {
			return this.#autoplay;
		}
		get extra() {
			return this.#extra;
		}
		get source() {
			return this.#source;
		}
		addVideo(video) {
			this.#videos.push(video);
		}
		setVideos(videos) {
			this.#videos = [...videos];
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
		isValidVideoId(id) {
			return typeof id === "string" && /^[a-zA-Z0-9_-]{11}$/.test(id);
		}
		parseUrl(url) {
			const u = this.getValidUrl(url);
			if (!u) throw new Error("Invalid URL");
			let host = u.hostname.toLowerCase();
			if (host.startsWith("www.")) host = host.slice(4);
			const path = u.pathname.replace(/\/+$/, "") || "/";
			const p = u.searchParams;
			if (host === "youtu.be") {
				const videoId = path.slice(1);
				if (!this.isValidVideoId(videoId)) throw new Error("Invalid video ID");
				const playlistId = p.get("list") || null;
				const startSeconds = timeToSeconds(p.get("t"));
				return new UrlInfo({
					kind: playlistId ? "playlist" : "video",
					videoId,
					playlistId,
					startSeconds,
					source: url
				});
			}
			if (host === "youtube.com" || host.endsWith(".youtube.com")) {
				if (path === "/watch") {
					const videoId = p.get("v");
					const playlistId = p.get("list") || null;
					const index = toInt(p.get("index"));
					const startSeconds = timeToSeconds(p.get("t"));
					if (videoId && !this.isValidVideoId(videoId)) throw new Error("Invalid video ID");
					if (playlistId) return new UrlInfo({
						kind: "playlist",
						videoId: videoId || null,
						playlistId,
						startSeconds,
						index,
						source: url
					});
					if (videoId) return new UrlInfo({
						kind: "video",
						videoId,
						startSeconds,
						source: url
					});
					throw new Error("Missing video ID or playlist");
				}
				if (path === "/watch_videos") {
					const raw = p.get("video_ids");
					if (!raw) throw new Error("Missing video_ids");
					const videoIds = raw.split(",").map((id) => id.trim()).filter((id) => this.isValidVideoId(id));
					if (videoIds.length === 0) throw new Error("No valid video IDs");
					const index = toInt(p.get("index"));
					return new UrlInfo({
						kind: "videoList",
						videoIds,
						videoId: videoIds[0],
						index,
						source: url
					});
				}
			}
			throw new Error("Unsupported YouTube URL");
		}
		parseSrc(src) {
			const u = this.getValidUrl(src);
			if (!u) throw new Error("Invalid URL");
			let host = u.hostname.toLowerCase();
			if (host.startsWith("www.")) host = host.slice(4);
			if (host !== "youtube.com" && !host.endsWith(".youtube.com") && host !== "youtube-nocookie.com") throw new Error("Invalid embed host");
			const path = u.pathname.replace(/\/+$/, "");
			if (!path.startsWith("/embed")) throw new Error("Invalid embed URL");
			const p = u.searchParams;
			const seg = path.split("/").filter(Boolean)[1] || null;
			const videoId = seg && seg !== "videoseries" && this.isValidVideoId(seg) ? seg : null;
			const playlistId = p.get("list") || null;
			const rawPlaylist = p.get("playlist");
			const videoIds = rawPlaylist ? rawPlaylist.split(",").map((id) => id.trim()).filter((id) => this.isValidVideoId(id)) : null;
			const startSeconds = toInt(p.get("start"));
			const index = toInt(p.get("index"));
			const autoplay = toBool01(p.get("autoplay"));
			const mute = toBool01(p.get("mute"));
			let kind = null;
			if (playlistId) kind = "playlist";
			else if (videoIds && videoIds.length) kind = "videoList";
			else if (videoId) kind = "video";
			else throw new Error("Invalid embed URL");
			return new SrcInfo({
				kind,
				videoId,
				videoIds,
				playlistId,
				startSeconds,
				index,
				autoplay,
				mute,
				source: src
			});
		}
		parseFromFrame(frame) {
			if (frame.tagName !== "IFRAME") throw new Error(`Expected an IFRAME element, but received: <${frame.tagName.toLowerCase()}>`);
			const urlInfos = this.parseSrc(frame.src);
			if (!urlInfos) throw new Error(`Invalid iframe src: "${frame.src || "(empty)"}"`);
			const host = frame.parentElement;
			if (!host) throw new Error(`Iframe has no parent element (src: "${frame.src || "(empty)"}")`);
			const target = host.id ||= `host:${crypto.randomUUID()}`;
			switch (urlInfos.kind) {
				case "video": return new VideoInfo({
					provider: "youtube",
					target,
					videoId: urlInfos.videoId,
					autoplay: toAutoplayMode(urlInfos.autoplay),
					startSeconds: urlInfos.startSeconds,
					source: {
						url: urlInfos.source,
						element: frame
					}
				});
				case "videoList": return new VideoListInfo({
					provider: "youtube",
					target,
					videoId: urlInfos.videoId,
					videoIds: urlInfos.videoIds,
					index: urlInfos.index,
					source: {
						url: urlInfos.source,
						element: frame
					}
				});
				case "playlist": return new PlaylistInfo({
					provider: "youtube",
					target,
					playlistId: urlInfos.playlistId,
					videoId: urlInfos.videoId,
					source: {
						url: urlInfos.source,
						element: frame
					}
				});
			}
		}
		parseDefinition(def, element) {
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
					startSeconds: timeToSeconds(def.start) ?? urlInfos.startSeconds,
					title: def.title ?? "",
					description: def.description ?? "",
					channel: def.channel ?? "",
					channelUrl: def.channelUrl ?? "",
					duration: timeToSeconds(def.duration),
					thumbnail: def.thumbnail ?? this.#thumbnailUrlBuilder.getThumbnailUrl(urlInfos.videoId),
					showOnInit: def.showOnInit,
					key: def.key,
					extra: def.extra,
					source: {
						url: urlInfos.source,
						element
					}
				});
				case "videoList": {
					const index = urlInfos.index ?? def.index;
					const list = new VideoListInfo({
						provider: "youtube",
						target: def.target,
						videoIds: urlInfos.videoIds,
						index,
						showOnInit: def.showOnInit,
						autoplay: toAutoplayMode(def.autoplay),
						key: def.key,
						extra: def.extra,
						source: {
							url: urlInfos.source,
							element
						}
					});
					urlInfos.videoIds.forEach((videoId, i) => {
						const v = videos[i] ?? {};
						list.addVideo(new VideoInfo({
							provider: "youtube",
							target: def.target,
							videoId,
							autoplay: toAutoplayMode(v.autoplay ?? def.autoplay),
							startSeconds: timeToSeconds(v.start),
							title: v.title ?? "",
							description: v.description ?? "",
							channel: v.channel ?? "",
							channelUrl: v.channelUrl ?? "",
							duration: timeToSeconds(v.duration),
							thumbnail: v.thumbnail ?? this.#thumbnailUrlBuilder.getThumbnailUrl(videoId),
							key: v.key,
							extra: v.extra
						}));
					});
					return list;
				}
				case "playlist": {
					const playlist = new PlaylistInfo({
						provider: "youtube",
						target: def.target,
						playlistId: urlInfos.playlistId,
						videoId: urlInfos.videoId,
						showOnInit: def.showOnInit,
						autoplay: toAutoplayMode(def.autoplay),
						key: def.key,
						extra: def.extra,
						source: {
							url: urlInfos.source,
							element
						}
					});
					(videos.length ? videos : []).forEach((v, i) => {
						playlist.addVideo(new VideoInfo({
							provider: "youtube",
							target: def.target,
							videoId: v.videoId,
							autoplay: toAutoplayMode(v.autoplay),
							startSeconds: timeToSeconds(v.start),
							title: v.title ?? "",
							description: v.description ?? "",
							channel: v.channel ?? "",
							channelUrl: v.channelUrl ?? "",
							thumbnail: v.thumbnail ?? (v.videoId ? this.#thumbnailUrlBuilder.getThumbnailUrl(v.videoId) : ""),
							duration: timeToSeconds(v.duration),
							key: v.key,
							extra: v.extra
						}));
					});
					return playlist;
				}
			}
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
	var YouTubeIframeBridge = class {
		#iframe;
		#window;
		#listeners = /* @__PURE__ */ new Map();
		#connected = false;
		#ready = false;
		#queue = [];
		#lastIndex = null;
		#known = {};
		constructor(iframe, { window = globalThis } = {}) {
			this.#iframe = iframe;
			this.#window = window;
		}
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
			this.#handshake();
		}
		disconnect() {
			if (!this.#connected) return;
			this.#connected = false;
			this.#window.removeEventListener("message", this.#onMessage);
			this.#iframe.removeEventListener("load", this.#onIframeLoaded);
			this.#queue.length = 0;
			this.#listeners.clear();
		}
		command(func, args = []) {
			const message = {
				event: "command",
				func,
				args
			};
			if (this.#ready) this.send(message);
			else this.#queue.push(message);
		}
		send(message) {
			this.#iframe.contentWindow?.postMessage(JSON.stringify(message), this.#getTargetOrigin());
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
		#onIframeLoaded = () => {
			this.#ready = false;
			this.#handshake();
		};
		#handleState(state) {
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
				case 0: this.#emit({ type: YouTubeBridgeEvent.VideoEnded });
			}
		}
		#handleDelivery(info = {}) {
			if (info.playerState) this.#handleState(info.playerState);
			if (info.currentTime) this.#emit({
				type: YouTubeBridgeEvent.TimeUpdate,
				time: info.currentTime,
				duration: info.duration
			});
			if (info.duration) this.#emit({
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
		/** Marks the player as ready, sends the queued commands, then notifies `ready`. */
		#markReady() {
			if (this.#ready) return;
			this.#ready = true;
			this.#queue.splice(0).forEach((m) => this.send(m));
			this.#emit({ type: YouTubeBridgeEvent.Ready });
		}
		#remember(name, value) {
			if (value == null || this.#known[name] === value) return false;
			this.#known[name] = value;
			return true;
		}
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
		#parse(data) {
			if (typeof data !== "string") return null;
			try {
				return JSON.parse(data);
			} catch {
				return null;
			}
		}
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
	* Which iframe shows which info is decided by the caller (PlayerContentAdapter): another info means
	* another player (so another iframe); the same info with another item only needs `selectItem` / `playAt`.
	*
	* Events sent to subscribers (same shape for every providers):
	*   { type: "itemChange", index }  the playing item of a playlist / list changed
	*   { type: "state", state, index? } playing / paused / ended
	*   { type: "error", error }
	*/
	var YouTubePlayer = class {
		kind = "youtube";
		#builder;
		#createIframe;
		#iframe = null;
		#bridge = null;
		#owned = false;
		#listeners = /* @__PURE__ */ new Set();
		#loading = false;
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
			this.#loading = true;
			try {
				this.#load(info, {
					autoplay,
					index
				});
			} finally {
				this.#loading = false;
			}
		}
		#load(info, { autoplay, index }) {
			const verb = autoplay ? "load" : "cue";
			if (!this.#iframe) {
				this.#attach(this.#createIframe(this.#src(info, {
					autoplay,
					index
				})), true);
				if (index > 0) {
					if (info instanceof VideoListInfo) this.#bridge.command(`${verb}Playlist`, [
						info.videoIds,
						index,
						0
					]);
					else if (info instanceof PlaylistInfo) this.#bridge.command(`${verb}Playlist`, [{
						list: info.playlistId,
						listType: "playlist",
						index,
						startSeconds: 0
					}]);
				}
				return;
			}
			this.#bridge.resetState();
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
		/**
		* Another item of the list / playlist that is already loaded: one postMessage, the iframe is kept.
		* Without autoplay the item is only cued.
		*/
		selectItem(info, index, { autoplay = true } = {}) {
			if (autoplay) return this.playAt(index);
			if (info instanceof VideoListInfo) this.#bridge?.command("cuePlaylist", [
				info.videoIds,
				index,
				0
			]);
			else if (info instanceof PlaylistInfo) this.#bridge?.command("cuePlaylist", [{
				list: info.playlistId,
				listType: "playlist",
				index,
				startSeconds: 0
			}]);
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
			if (this.#loading) return;
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
			const q = this.#params({
				autoplay,
				startSeconds
			});
			q.set("playlist", videoIds.join(","));
			return this.#url(encodeURIComponent(videoIds[0]), q);
		}
		buildPlaylistSrc(playlistId, { autoplay, videoId } = {}) {
			if (!playlistId) throw new TypeError("buildPlaylistSrc(): playlistId is required");
			const q = this.#params({ autoplay });
			q.set("list", playlistId);
			return this.#url(videoId ? encodeURIComponent(videoId) : "videoseries", q);
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
	};
	// src/providers/MediaProvider.js
	var MediaProvider = class MediaProvider {
		id = null;
		hosts = [];
		constructor() {
			if (new.target === MediaProvider) throw new Error("MediaProvider is an abstract class.");
		}
		getInfoFromLink(link) {
			throw new Error(`${this.constructor.name} must implement getInfoFromElement().`);
		}
		getInfoFromFrame(frame) {
			throw new Error(`${this.constructor.name} must implement getInfoFromFrame().`);
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
		getInfoFromLink(link) {
			return this.#infoParser.parseFromLink(link);
		}
		getInfoFromFrame(frame) {
			return this.#infoParser.parseFromFrame(frame);
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
					labels: this.#splitLabels(this.#rawQueryParam(u, "labels")),
					source: url
				});
			}
			const match = /^\/video(?:embed)?\/(\d+)/.exec(u.pathname);
			return match ? new UrlInfo({
				kind: "video",
				videoId: match[1],
				source: url
			}) : null;
		}
		parseSrc(src) {
			const u = this.getValidUrl(src);
			if (!u) throw new Error(`Invalid URL: ${JSON.stringify(src)}`);
			const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
			if (host !== "ok.ru" && host !== "odnoklassniki.ru") throw new Error(`Invalid OK.ru embed host: '${host}'`);
			const m = u.pathname.match(/^\/videoembed\/(\d+)\/?$/);
			if (!m) throw new Error(`Invalid OK.ru embed path: '${u.pathname}'`);
			return new SrcInfo({
				kind: "video",
				videoId: m[1],
				autoplay: toBool01(u.searchParams.get("autoplay")),
				source: src
			});
		}
		parseFromFrame(frame) {
			if (frame.tagName !== "IFRAME") throw new Error(`Expected an IFRAME element, but received: <${frame.tagName.toLowerCase()}>`);
			const urlInfos = this.parseSrc(frame.src);
			if (!urlInfos) throw new Error(`Invalid iframe src: "${frame.src || "(empty)"}"`);
			const host = frame.parentElement;
			if (!host) throw new Error(`Iframe has no parent element (src: "${frame.src || "(empty)"}")`);
			const target = host.id ||= `host:${crypto.randomUUID()}`;
			switch (urlInfos.kind) {
				case "video": return new VideoInfo({
					provider: "okru",
					target,
					videoId: urlInfos.videoId,
					autoplay: toAutoplayMode(urlInfos.autoplay),
					source: {
						url: urlInfos.source,
						element: frame
					}
				});
			}
		}
		buildUrl(def) {
			if (!def) throw new TypeError("buildUrl(): definition is required");
			if (def.playlistId) throw new TypeError("buildUrl(): playlist not supported");
			const id = def.videoId ?? def.videoIds?.[0];
			if (!id) throw new TypeError("buildUrl(): need videoId or videoIds");
			return `https://ok.ru/video/${id}`;
		}
		parseDefinition(def, element) {
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
					startSeconds: timeToSeconds(def.start),
					title: def.title ?? "",
					description: def.description ?? "",
					channel: def.channel ?? "",
					channelUrl: def.channelUrl ?? "",
					thumbnail: def.thumbnail ?? "",
					duration: timeToSeconds(def.duration),
					showOnInit: def.showOnInit,
					key: def.key,
					extra: def.extra,
					source: {
						url: def.url,
						element
					}
				});
				case "videoList": {
					const labels = urlInfos.labels;
					const videoIds = urlInfos.videoIds;
					if (labels.length && labels.length !== videoIds.length) console.warn(`[OkruProvider] ${labels.length} labels for ${videoIds.length} videos (a comma in a title that is not encoded as %2C?)`);
					const index = urlInfos.index ?? def.index;
					const list = new VideoListInfo({
						provider: "okru",
						target: def.target,
						videoIds,
						index,
						showOnInit: def.showOnInit,
						autoplay: toAutoplayMode(def.autoplay),
						key: def.key,
						extra: def.extra,
						source: {
							url: def.url,
							element
						}
					});
					videoIds.forEach((videoId, i) => {
						const v = videos.length ? videos[i] : { title: labels[i] };
						list.addVideo(new VideoInfo({
							provider: "okru",
							target: def.target,
							videoId,
							autoplay: toAutoplayMode(v?.autoplay ?? def.autoplay),
							startSeconds: timeToSeconds(v?.start),
							title: v?.title ?? "",
							description: v?.description ?? "",
							channel: v?.channel ?? "",
							channelUrl: v?.channelUrl ?? "",
							thumbnail: v?.thumbnail ?? "",
							duration: timeToSeconds(v?.duration),
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
		getInfoFromLink(link) {
			return this.#infoParser.parseFromLink(link);
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
	* Completes the metadata of a YouTube video, list or playlist (panel, page sections...).
	* Order: what is declared (data-videos, code definitions) > YouTube Data API (cached) > fallback title ("Video 1"...).
	*
	* It only works when a REQUIRED field is empty (`required`, the title by default) unless `force` is given:
	* everything declared is then left alone and every other empty field is filled from the API too
	* (description, channel, channelUrl, thumbnail, duration).
	* Without `api` (no key, or refused) a list only gets the fallback title, and a single video gets nothing
	* (a fallback title would hide the real one later). Never rejects.
	*
	* Its result is applied by applyItems() (lists, metaMerge.js) or applyDefinition() (single video).
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
		* @param {(index: number) => string} [options.fallbackTitle] Title of a list item that is still without one.
		* @param {string[]} [options.required] The fields that must not stay empty (names of VideoInfo getters):
		*   when one is empty the API is asked. Add "description", "channel"... to complete a video that already has a title.
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
		* @param {VideoInfo|VideoListInfo|PlaylistInfo} info
		* @param {{ force?: boolean }} [options] force: ask even when nothing required is missing. Declared values are
		*   still never overwritten.
		* @returns {Promise<object[]|null>} Items [{ id, title, description, channel, channelUrl, thumbnail, duration }]
		*   (one item for a single video), or null when there is nothing to do (not YouTube, or nothing required is
		*   missing, or the API has nothing).
		*/
		async resolve(info, { force = false } = {}) {
			if (info.provider !== "youtube") return null;
			return info.isPlaylist ? this.#resolveList(info, force) : this.#resolveVideo(info, force);
		}
		async #resolveVideo(info, force) {
			const declared = fieldsOf(info);
			if (!force && this.#isComplete(declared)) return null;
			if (!this.#api?.available) return null;
			let meta;
			try {
				meta = (await this.#videosMeta([info.videoId])).get(info.videoId);
			} catch (error) {
				console.warn("[YouTubeMetaResolver] API failed:", error.message);
				return null;
			}
			return meta ? [{
				id: info.videoId,
				...fillEmpty(declared, meta)
			}] : null;
		}
		async #resolveList(info, force) {
			const declared = info.videos.map((v) => ({
				id: v.videoId,
				meta: fieldsOf(v)
			}));
			if (!force && declared.length > 0 && declared.every((d) => this.#isComplete(d.meta))) return null;
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
		/** Cache per video: two lists (or a list and a single video) sharing videos do not pay twice. */
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
	/**
	* Applies what the code defines for an info (the link may then be only a navigation link).
	* Single video: {title, description, channel, channelUrl, thumbnail, duration}, only the empty fields are filled.
	* List / playlist: {videos: [item]} (see applyItems), positional for a list of videos (the ids are known).
	* @returns {boolean} true when something changed.
	*/
	function applyDefinition(info, definition) {
		if (!definition) return false;
		if (!info.isPlaylist) return info.fillMissing(definition);
		const items = definition.videos;
		if (!items?.length) return false;
		applyItems(info, items);
		return true;
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
		render() {
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
			const tip = this.#tooltipRenderer.render();
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
	var LinkPlayer = class {
		#id;
		#scopeEl;
		#isGlobal;
		#currentBehavior;
		#boundaryBehavior;
		#useStorage;
		#scanEmbeds;
		#regions = /* @__PURE__ */ new Map();
		#initialized = /* @__PURE__ */ new WeakSet();
		#regionHost;
		#defaultTarget;
		#store;
		#registry;
		#tooltip;
		#thumbnails;
		#definitions;
		#youtubeMeta;
		#youtubeMetaScope;
		#panelOptions;
		#events = new Emitter();
		#detachers = /* @__PURE__ */ new Set();
		constructor({ scope = null, definitions = null, autoScan = true, useStorage = true, tooltip = true, currentBehavior = "toggle", boundaryBehavior = "stop", scanEmbeds = true, youtubeApiKey = null, youtubeMeta = null, youtubeMetaScope = "playlists", youtubeMetaRequired = void 0, fallbackTitle = void 0, okruEmbedBaseUrl = null, store = null, registry = null, regionHost = null, defaultTarget = null, panelRenderer = null, itemRenderer = null, headerRenderer = null, toggleRenderer = null, groupRenderer = null, tooltipRenderer = null, thumbnails = null, onChange = noop, onState = noop, onError = (e) => console.warn("[LinkPlayer]", e.error ?? e) } = {}) {
			this.#scopeEl = resolveScope(scope);
			this.#isGlobal = this.#scopeEl === null;
			this.#id = this.#isGlobal ? `lp-global` : `lp-${scope}`;
			this.#useStorage = useStorage;
			this.#scanEmbeds = scanEmbeds;
			this.#definitions = definitions;
			this.#currentBehavior = currentBehavior;
			this.#boundaryBehavior = boundaryBehavior;
			this.#store = store ?? (useStorage ? defaultStore() : new MemoryStore());
			this.#registry = registry ?? new ProviderRegistry([new YouTubeProvider(), new OkruProvider({ embedBaseUrl: okruEmbedBaseUrl })]);
			this.#regionHost = regionHost ?? new DefaultRegionHost();
			if (defaultTarget) this.#regionHost.setDefaultTarget(defaultTarget);
			this.#defaultTarget = this.#regionHost.defaultTarget;
			this.#regionHost.init({
				root: this.#scopeEl ?? document,
				onLinkDiscovered: (v) => this.#handleLinkDiscovered(v),
				onTargetDiscovered: (v) => this.#handleTargetDiscovered(v),
				onFrameDiscovered: (v) => this.#handleFrameDiscovered(v)
			});
			this.#thumbnails = thumbnails ?? new ThumbnailService();
			this.#tooltip = tooltip && !isTouch() ? new Tooltip(tooltipRenderer) : null;
			if (youtubeMetaScope !== "playlists" && youtubeMetaScope !== "all") throw new TypeError(`Invalid youtubeMetaScope '${youtubeMetaScope}': expected "playlists" or "all".`);
			this.#youtubeMetaScope = youtubeMetaScope;
			this.#youtubeMeta = youtubeMeta ?? new YouTubeMetaResolver({
				api: youtubeApiKey ? new YouTubeDataApi({ apiKey: youtubeApiKey }) : null,
				cache: this.#store,
				fallbackTitle,
				required: youtubeMetaRequired
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
		/**
		* Discovers what is new in the page (links, containers, frames). There is no observer:
		* call it again after the page changed (content added dynamically, a container created later...).
		* It is idempotent: what is already known is not handled twice.
		*/
		scan() {
			this.#regionHost.discoverAll();
			for (const region of this.#regions.values()) {
				if (this.#initialized.has(region)) continue;
				this.#initialized.add(region);
				this.#guard(() => this.#init(region));
			}
		}
		getRegion(target) {
			let region = this.#regions.get(target);
			if (region) return region;
			region = new Region({
				target,
				registry: this.#registry,
				currentBehavior: this.#currentBehavior,
				boundaryBehavior: this.#boundaryBehavior,
				resolveMeta: (info, options) => this.#enrich(info, options),
				thumbnails: this.#thumbnails,
				...this.#panelOptions
			});
			region.on("*", (event) => this.#onRegionEvent(event));
			this.#regions.set(target, region);
			return region;
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
			this.#regionHost.clear();
			this.#tooltip?.dispose();
			this.#events.clear();
		}
		#registerDefs(definitions) {
			if (!definitions) return;
			if (!Array.isArray(definitions)) throw new TypeError(`Invalid definitions: expected an Array, but received type '${typeof definitions}' (${JSON.stringify(definitions)}).`);
			definitions.forEach((def, index) => {
				const provider = def.url ? this.#registry.resolve(def.url) : this.#registry.get(def.provider);
				if (!def.target && this.#defaultTarget) def.target = this.#defaultTarget;
				const info = provider.getInfoFromDefinition(def);
				let target = def.target ||= this.#defaultTarget;
				if (!target) throw new Error(`Target is required for definition at index ${index} (definition: ${JSON.stringify(def)}).`);
				this.getRegion(target).add(info);
			});
		}
		/** An element that cannot be handled must not stop the others: the error is reported and the loop goes on. */
		#guard(fn, element = null) {
			try {
				fn();
			} catch (error) {
				this.#events.emit("error", {
					error,
					element
				});
			}
		}
		#handleLinkDiscovered(elements) {
			for (const element of elements) {
				if (element.dataset.lp) continue;
				this.#guard(() => this.#bindLink(element), element);
			}
		}
		#bindLink(element) {
			const target = element.dataset.target || this.#defaultTarget;
			if (!target) throw new Error(`Target not provided on ${describe(element)}`);
			const url = element.tagName === "A" ? element.href : element.dataset.url;
			if (!url) throw new Error(`Unable to resolve URL on ${describe(element)}`);
			const provider = this.#registry.resolve(url);
			const region = this.getRegion(target);
			if (!element.dataset.target) element.dataset.target = target;
			const parsed = provider.getInfoFromLink(element);
			const key = parsed.key;
			region.add(parsed);
			const info = region.get(key);
			const onClick = (e) => {
				e.preventDefault();
				region.navigate(key, {
					autoplay: info.autoplay === AUTOPLAY_MODES.INIT || info.autoplay === AUTOPLAY_MODES.CLICK,
					index: info.index
				});
			};
			element.addEventListener("click", onClick);
			element.dataset.lp = this.#id;
			const release = () => {
				delete element.dataset.lp;
			};
			const current = () => region.get(key) ?? info;
			const detachTip = this.#attachTooltip(element, current, provider);
			this.#detachers.add(() => {
				element.removeEventListener("click", onClick);
				detachTip();
				release();
			});
		}
		#handleTargetDiscovered(targets) {
			for (const [target, element] of targets) this.#guard(() => this.getRegion(target).register(element), element);
		}
		#handleFrameDiscovered(elements) {
			if (!this.#scanEmbeds) return;
			for (const element of elements) {
				if (element.dataset.lp) continue;
				this.#guard(() => this.#bindFrame(element), element);
			}
		}
		#bindFrame(element) {
			const src = element.src;
			if (!src) return;
			let provider;
			try {
				provider = this.#registry.resolve(src);
			} catch {
				return;
			}
			if (!provider) return;
			const host = element.parentElement;
			if (!host) throw new Error(`No parent element for ${describe(element)} (detached from the DOM?)`);
			const target = host.id ||= `host:${crypto.randomUUID()}`;
			const parsed = provider.getInfoFromFrame(element);
			this.getRegion(target).adopt(element, parsed);
			element.dataset.lp = this.#id;
		}
		async #enrich(info, { force = false } = {}) {
			if (info.provider !== "youtube") return false;
			if (!info.isPlaylist && !force && this.#youtubeMetaScope !== "all") return false;
			const items = await this.#youtubeMeta.resolve(info, { force });
			if (!items?.length) return false;
			if (info.isPlaylist) {
				applyItems(info, items);
				return true;
			}
			return applyDefinition(info, items[0]);
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
			const saved = this.getSavedState(region);
			if (saved && region.restore(saved.key, { index: saved.index ?? 0 })) return;
			const first = region.infos.find((info) => info.showOnInit);
			if (first && !region.isCurrent(first.key)) region.navigate(first.key, {
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
	/** `<iframe#main>`: what `${element}` should have shown instead of "[object HTMLIFrameElement]". */
	function describe(el) {
		if (!el) return String(el);
		return `<${el.localName ?? typeof el}${el.id ? `#${el.id}` : ""}>`;
	}
	return LinkPlayer;
});

//# sourceMappingURL=link-player.js.map