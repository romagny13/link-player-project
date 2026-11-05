import { el, isUrl } from "./util.js";
import { DuplicateEntryError } from "./util.js";
import { EntrySet } from "./model.js";
import { NavigationService, neighbourEntry } from "./navigation.js";
import { defaultNavRenderer, defaultPanelRenderer } from "./renderers.js";
import { injectStyles } from "./styles.js";

class Emitter {
    #h = new Map();
    on(event, fn) {
        (this.#h.get(event) ?? this.#h.set(event, new Set()).get(event)).add(fn);
        return () => this.#h.get(event)?.delete(fn);
    }
    emit(event, payload) {
        for (const fn of [...(this.#h.get(event) ?? [])])
            try {
                fn(payload);
            } catch (e) {
                console.error(`[LinkPlayer] "${event}" handler failed`, e);
            }
    }
    clearHandlers() {
        this.#h.clear();
    }
}

/** One region's DOM: iframe + the panel produced by a renderer. */
export class RegionView {
    constructor({ container, panelRenderer = defaultPanelRenderer, itemRenderer = defaultItemRenderer, widths = null, resizable = true }) {
        injectStyles();
        this._c = container;
        container.classList.add("lp-host");
        this._renderer = panelRenderer;
        this._itemRenderer = itemRenderer ?? defaultItemRenderer;
        this._widths = widths;
        this._resizable = resizable;
        this._handle = null;
        this._adopted = null;
        this._hadAdopted = false;
    }

    setPanelRenderer(fn) {
        this._renderer = fn;
    }

    setItemRenderer(fn) { this._itemRenderer = fn ?? defaultItemRenderer; }

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
        return f;
    }
    showPanel(ctx) {
        this._dropPanel();
        this._handle = this._renderer({
            host: this._c,
            widths: this._widths,
            resizable: this._resizable,
            itemRenderer: this._itemRenderer,
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
}

/**
 * A zone (data-target). Events: "change" { entry, itemIndex } · "state" snapshot · "items" { entry, items }
 * · "entries" { entry } · "error" { error, entry }.
 */
export class Region extends Emitter {
    constructor({ target, container, registry, store = null, panel = true, panelRenderer, itemRenderer, navRenderer = defaultNavRenderer, resizable = true }) {
        super();
        this.target = target;
        this.container = container;
        this.sets = [];
        this.entries = []; // registration order: this is the order of next/previous link
        this.persist = true;
        this._registry = registry;
        this._navRenderer = navRenderer;
        this._itemRenderer = itemRenderer ?? defaultItemRenderer;
        this._byKey = new Map();
        this._auto = new Map();
        this._navs = new Set();
        this._navHosts = new WeakMap();
        const widths =
            resizable && store
                ? {
                    get: () => store.get("panel-width"),
                    set: (w) => store.set("panel-width", w),
                    clear: () => store.remove("panel-width")
                }
                : null;
        this.view = new RegionView({ container, panelRenderer, itemRenderer, widths, resizable });
        this.navigation = new NavigationService({ region: this, view: this.view, panel });
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

    setItemRenderer(fn) { this.view.setItemRenderer(fn); }

    /* ───── entries ───── */

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

    /* ───── state and navigation bar ───── */

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
            // wrap is not considered: with { wrap: true } enable your buttons yourself
            hasNextLink: !!neighbourEntry(this.entries, key, 1),
            hasPreviousLink: !!neighbourEntry(this.entries, key, -1),
            canGoBack: nav.journal.canGoBack,
            canGoForward: nav.journal.canGoForward
        };
    }

    setNavRenderer(fn) { this._navRenderer = fn; }

    /** Renders the entries of this region as buttons/images in `container`. Returns a detach function. */
    attachNav(container, renderer = this._navRenderer) {
        const host = typeof container === "string" ? document.getElementById(container) : container;
        if (!host) throw new Error(`Navigation container not found: "${container}"`);
        this._navHosts.get(host)?.();
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
        let pending = false; // several add() in a row render once
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
            if (this._navHosts.get(host) === detach) this._navHosts.delete(host);
            host.replaceChildren();
            delete host.dataset.lpCount;
        };
        this._navHosts.set(host, detach);
        render();
        return detach;
    }

    dispose() {
        [...this._navs].forEach((d) => d());
        this.navigation.dispose();
        this.view.dispose();
        this.clearHandlers();
    }
}