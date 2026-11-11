import {resolveScope} from "./utils/dom.js";
import {defaultStore, MemoryStore} from "./storage.js";
import {AUTOPLAY_MODES, isTouch} from "./utils/helpers.js";
import {Emitter} from "./utils/Emitter.js";
import {Region} from "./Region.js";
import {ProviderRegistry} from "./providers/ProviderRegistry.js";
import {YouTubeProvider} from "./providers/youtube/YouTubeProvider.js";
import {OkruProvider} from "./providers/okru/OkruProvider.js";
import {YouTubeDataApi} from "./providers/youtube/YouTubeDataApi.js";
import {YouTubeMetaResolver} from "./providers/youtube/YouTubeMetaResolver.js";
import {applyItems} from "./metaMerge.js";
import {Tooltip} from "./ui/Tooltip.js";
import {ThumbnailService} from "./ui/ThumbnailService.js";

const noop = () => {
};

let nextId = 0;

/**
 * Who handles which element. A WeakMap, not an attribute: cloneNode() copies attributes but not listeners,
 * so an attribute would make a cloned link look handled when it is not. data-lp stays as a debugging aid only.
 */
const owners = new WeakMap();

export class LinkPlayer {
    #id;
    #scopeEl;
    #isGlobal;
    #currentBehavior;
    #useStorage;
    #scanEmbeds;
    #regions = new Map();
    #initialized = new WeakSet();
    #store;
    #registry;
    #tooltip;
    #thumbnails;
    #definitions;
    #youtubeMeta;
    #panelOptions;
    #events = new Emitter();
    #detachers = new Set();

    constructor({
                    scope = null,
                    definitions = null,
                    autoScan = true,
                    useStorage = true,
                    tooltip = true,
                    currentBehavior = "toggle",
                    scanEmbeds = true,
                    youtubeApiKey = null,
                    youtubeMeta = null,
                    fallbackTitle = undefined,
                    okruEmbedBaseUrl = null,
                    store = null,
                    registry = null,
                    panelRenderer = null,
                    itemRenderer = null,
                    headerRenderer = null,
                    toggleRenderer = null,
                    groupRenderer = null,
                    tooltipRenderer = null,
                    thumbnails = null,
                    onChange = noop,
                    onState = noop,
                    onError = (e) => console.warn("[LinkPlayer]", e.error ?? e)
                } = {}) {
        this.#scopeEl = resolveScope(scope); // throws when a given scope does not exist
        this.#isGlobal = this.#scopeEl === null;
        this.#id = `lp-${++nextId}`; // unique: two players may share a selector, or have an element as scope

        // A scope is a boundary: its links belong to ITS player, the global one skips them (innermost scope wins).
        // Declare it in the HTML too (<div data-lp-scope>) when a global player may be created first.
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
        this.#registry = registry ??
            new ProviderRegistry([
                new YouTubeProvider(),
                new OkruProvider({embedBaseUrl: okruEmbedBaseUrl})
            ]);
        this.#thumbnails = thumbnails ?? new ThumbnailService();
        this.#tooltip = tooltip && !isTouch() ? new Tooltip(tooltipRenderer) : null;
        this.#youtubeMeta = youtubeMeta ?? new YouTubeMetaResolver({
            api: youtubeApiKey ? new YouTubeDataApi({apiKey: youtubeApiKey}) : null,
            cache: this.#store,
            fallbackTitle
        });
        this.#panelOptions = {panelRenderer, itemRenderer, headerRenderer, toggleRenderer, groupRenderer};

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
            if (owner === this) continue; // already handled by this player
            if (owner) {
                taken++;
                continue;
            }
            try {
                this.#register(element);
            } catch (error) {
                this.#events.emit("error", {error, element}); // one bad link must not stop the others
            }
        }
        if (taken) {
            this.#events.emit("error", {
                error: new Error(`${taken} element(s) already handled by another LinkPlayer: create the scoped player first, `
                    + `or declare the scope in the HTML (data-lp-scope)`)
            });
        }

        for (const region of this.#regions.values()) {
            if (this.#initialized.has(region)) continue; // init once: a second scan must not toggle the region
            this.#initialized.add(region);
            this.#init(region);
        }
    }

    /** The links this player is responsible for: those whose innermost scope boundary is its own (none for the global one). */
    getLinks() {
        return [...this.getRoot().querySelectorAll("[data-link]")]
            .filter((element) => element.closest("[data-lp-scope]") === this.#scopeEl);
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

    // ───────── internals ─────────

    #registerDefs(definitions) {
        if(!Array.isArray(definitions))
            return;

        for (const def of definitions) {
            const provider = def.url ? this.#registry.resolve(def.url) :
                this.#registry.get(def.provider);
            const info = provider.getInfoFromDefinition(def);

            const target = def.target;
            if (!target) throw new Error("Target required");

            const region = this.getRegion(target);
            region.add(info);
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

        const parsed = provider.getInfoFromElement(element); // data-key is injected in the model (info.key)
        const info = region.add(parsed) ? parsed : region.get(parsed.key); // same key twice: keep the first object
        // if (info === parsed) this.#applyDefinition(info);

        owners.set(element, this);
        element.dataset.lp = this.#id; // debugging aid: the source of truth is `owners`
        const release = () => {
            owners.delete(element);
            delete element.dataset.lp;
        };

        if (isIframe) {
            region.adopt(element, info);
            this.#detachers.add(release);
            return;
        }

        // resolved by key when used: region.replace() may have swapped the object since the link was registered
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
        if(info.provider !== "youtube")
            return false;
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
    #save({region, info, index}) {
        if (!this.#useStorage || !info) return;
        this.#store.set(`state:${region.target}`, {key: info.key, index});
    }

    #init(region) {
        if (region.current) return; // adopted iframe: already showing something

        const saved = this.getSavedState(region);
        const restored = saved && region.get(saved.key);
        if (restored) return region.navigate(restored.key, {index: saved.index ?? 0});

        const first = region.infos.find((info) => info.showOnInit);
        if (first) {
            region.navigate(first.key, {
                autoplay: first.autoplay === AUTOPLAY_MODES.INIT,
                index: first.index
            });
        }
    }

    // ───────── tooltip ─────────

    /** Values are read when the tooltip opens, so what the API or the definitions filled in later is used. */
    #tooltipData(info) {
        const first = info.isPlaylist ? info.videos[0] : info;
        return {title: first?.title ?? "", thumbnail: first?.thumbnail || null};
    }

    #attachTooltip(element, getInfo, provider) {
        if (!this.#tooltip) return noop;
        return this.#tooltip.attach(
            element,
            () => this.#thumbnails.resolve(this.#tooltipData(getInfo()).thumbnail), // no argument: the tooltip calls it bare
            () => this.#tooltipData(getInfo()).title,
            {id: provider.id, name: provider.name ?? provider.id}
        );
    }
}