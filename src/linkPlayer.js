import { isTouch, resolveScope, AUTOPLAY_MODES } from "./util.js";
import { MemoryStore, defaultStore } from "./storage.js";
import { ProviderRegistry } from "./providers/registry.js";
import { YouTubeProvider } from "./providers/youtube.js";
import { DailymotionProvider } from "./providers/dailymotion.js";
import { OkruProvider } from "./providers/okru.js";
import { Region } from "./region.js";
import { defaultItemRenderer, defaultNavRenderer, defaultPanelRenderer } from "./renderers.js";
import { readLinks } from "./linkScanner.js";
import { Tooltip } from "./tooltip.js";

/* ───── instance registry, shared even if the plugin is bundled twice ───── */
const REG = (globalThis[Symbol.for("linkplayer.v3")] ??= { live: new Set(), seq: 0 });
const depthOf = (n) => {
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
        if (d > bestDepth || (d === bestDepth && p._seq < best._seq)) {
            best = p;
            bestDepth = d;
        }
    }
    return best;
}

const noop = () => { };

export class LinkPlayer {
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
    constructor({
        id = null,
        scope = null,
        registry = null,
        store = null,
        useStorage = true,
        panel = true,
        panelRenderer = defaultPanelRenderer,
        itemRenderer = defaultItemRenderer,
        navRenderer = defaultNavRenderer,
        resizable = true,
        tooltip = true,
        scanEmbeds = true,
        activeClass = "is-active",
        youtubeApiKey = null,
        okruEmbedBaseUrl,
        dailymotionPlayerId = null,
        onChange = noop,
        onState = noop,
        onError = (e) => console.warn("[LinkPlayer]", e)
    } = {}) {
        this.scopeEl = resolveScope(scope); // throws when a given scope does not exist
        this.isGlobal = this.scopeEl === null;
        this._seq = ++REG.seq;
        this.id = id ?? `lp-${this._seq}`;
        if (LinkPlayer.get(this.id)) throw new Error(`LinkPlayer id already in use: "${this.id}"`);

        this._store = store ?? (useStorage ? defaultStore() : new MemoryStore());
        this.registry =
            registry ??
            new ProviderRegistry([
                new YouTubeProvider({ apiKey: youtubeApiKey, store: this._store }),
                new DailymotionProvider({ playerId: dailymotionPlayerId }),
                new OkruProvider({ embedBaseUrl: okruEmbedBaseUrl })
            ]);
        Object.assign(this, {
            _useStorage: useStorage, _panel: panel, _panelRenderer: panelRenderer, _itemRenderer: itemRenderer, _navRenderer: navRenderer,
            _resizable: resizable, _scanEmbeds: scanEmbeds, _activeClass: activeClass,
            _onChange: onChange, _onState: onState, _onError: onError
        });
        this._tooltip = tooltip && !isTouch() ? new Tooltip() : null;
        this._regions = new Map();
        this._bound = new Map(); // element → { region, entry, off }
        this._failed = new WeakSet(); // links reported once, not retried at every scan
        this._queued = new WeakSet();
        this._embedCount = 0;
        this._destroyed = false;

        REG.live.add(this);
        for (const p of REG.live) if (p !== this) p._reconcile(); // a narrower scope takes its elements from broader ones
        this.scan();
    }

    _contains(node) {
        return this.isGlobal || this.scopeEl.contains(node);
    }

    /* ───── regions ───── */

    getRegion(target, container = document.getElementById(target)) {
        let region = this._regions.get(target);
        if (region) return region;
        if (!container) throw new Error(`Target not found: "${target}"`);
        region = new Region({
            target, container, registry: this.registry, store: this._store, panel: this._panel,
            panelRenderer: this._panelRenderer, itemRenderer: this._itemRenderer, navRenderer: this._navRenderer, resizable: this._resizable
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

    /* shortcuts, same as region.navigation.nextLink() / previousLink() */
    nextLink(target, opts) {
        return this._regions.get(target)?.navigation.nextLink(opts) ?? false;
    }
    previousLink(target, opts) {
        return this._regions.get(target)?.navigation.previousLink(opts) ?? false;
    }

    /* ───── scan ───── */

    scan() {
        if (this._destroyed) return;
        const root = this.scopeEl ?? document;
        let infos = [];
        try {
            infos = readLinks(root);
        } catch (error) {
            return this._onError(error);
        }
        for (const info of infos)
            if (!this._bound.has(info.link) && !this._failed.has(info.link) && ownerOf(info.link) === this) this._bindLink(info);
        if (this._scanEmbeds) {
            try {
                this._adoptEmbeds(root);
            } catch (error) {
                this._onError(error);
            }
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
            return this._onError(error, { url, link });
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
                return; // not an embed we know
            }
            if (!provider.panel || !parsed.isCollection) return; // nothing to add to a single video
            try {
                const target = `embed-${this.id}-${++this._embedCount}`;
                const region = this.getRegion(target, this._hostFor(iframe));
                region.persist = false;
                region.view.adoptIframe(iframe);
                const entry = region.detectedSet(provider)._add(url, { key: target }, "embed");
                this._bound.set(iframe, { region, entry, off: () => { } });
                region.navigation.go(entry, { autoplay: false });
            } catch (error) {
                this._onError(error);
            }
        });
    }

    /* ───── init, persistence, active class ───── */

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
        if (restored) return void nav.go(restored, { itemIndex: saved.index, autoplay: false });
        const first = region.entries.find((e) => e.showOnInit);
        if (first) nav.go(first, { reason: "init" });
    }

    _persist(region, entry, itemIndex) {
        if (this._useStorage && region.persist) {
            const k = `state:${region.target}`;
            entry ? this._store.set(k, { key: entry.key, url: entry.url, index: itemIndex }) : this._store.remove(k);
        }
        this._onChange(region.target, entry);
    }

    _syncActive(region, state) {
        for (const e of region.entries) e.link?.classList.toggle(this._activeClass, state.isOpen && e === state.entry);
        this._onState(region.target, state);
    }

    /* ───── ownership ───── */

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
        for (const p of REG.live) p.scan(); // elements this instance owned can be taken by another
    }
}