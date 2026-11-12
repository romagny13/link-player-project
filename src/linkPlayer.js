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
        this.#scopeEl = resolveScope(scope);
        this.#isGlobal = this.#scopeEl === null;
        this.#id = this.#isGlobal ? `lp-global` : `lp-${scope}`;

        this.#useStorage = useStorage;
        this.#scanEmbeds = scanEmbeds;
        this.#definitions = definitions;
        this.#currentBehavior = currentBehavior;

        this.#store = store ?? (useStorage ? defaultStore() : new MemoryStore());
        this.#registry =
            registry ??
            new ProviderRegistry([
                new YouTubeProvider(),
                new OkruProvider({embedBaseUrl: okruEmbedBaseUrl})
            ]);
        this.#thumbnails = thumbnails ?? new ThumbnailService();
        this.#tooltip = tooltip && !isTouch() ? new Tooltip(tooltipRenderer) : null;
        this.#youtubeMeta =
            youtubeMeta ??
            new YouTubeMetaResolver({
                api: youtubeApiKey
                    ? new YouTubeDataApi({apiKey: youtubeApiKey})
                    : null,
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

    scan() {
        // links
        const elements = this.getLinks();
        for (const element of elements) {
            if (element.dataset.lp)
                continue;

            const data = element.dataset;
            const target = data.target;
            if (!target)
                throw new Error(`Target not provided on '${element}'`);

            const url = element.tagName === "A" ? element.href : element.dataset.url;
            if (!url)
                throw new Error(`Unable to resolve URL on element '${element}'`);

            const provider = this.#registry.resolve(url);
            const region = this.getRegion(target);
            const parsed = provider.getInfoFromElement(element);
            const key = parsed.key;
            // region has definition ?
            const info = region.has(key) ?
                region.get(key)
                : region.add(parsed);

            const onClick = (e) => {
                e.preventDefault();
                region.navigate(key, {
                    autoplay:
                        info.autoplay === AUTOPLAY_MODES.INIT ||
                        info.autoplay === AUTOPLAY_MODES.CLICK,
                    index: info.index
                });
            };
            element.addEventListener("click", onClick);
            element.dataset.lp = this.#id;

            // tooltip
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

        for (const region of this.#regions.values()) {
            if (this.#initialized.has(region)) continue; // init once: a second scan must not toggle the region
            this.#initialized.add(region);
            this.#init(region);
        }
    }

    getLinks() {
        return this.getRoot().querySelectorAll("[data-link]");
    }

    getRoot() {
        return this.#scopeEl ?? document;
    }

    getSavedState(region) {
        return this.#useStorage ? this.#store.get(`state:${region.target}`) : null;
    }

    dispose() {
        if (this.#scopeEl?.dataset.lpScope === this.#id)
            delete this.#scopeEl.dataset.lpScope;
        for (const detach of this.#detachers) detach();
        this.#detachers.clear();
        this.#regions.forEach((region) => region.dispose());
        this.#regions.clear();
        this.#tooltip?.dispose();
        this.#events.clear();
    }

    // ───────── internals ─────────

    #registerDefs(definitions) {
        if (!definitions) return;
        if (!Array.isArray(definitions))
            throw new TypeError(`Invalid definitions: expected an Array, but received type '${typeof definitions}' (${JSON.stringify(definitions)}).`);

        for (const def of definitions) {
            const provider = def.url
                ? this.#registry.resolve(def.url)
                : this.#registry.get(def.provider);
            const info = provider.getInfoFromDefinition(def);

            const target = def.target;
            if (!target) throw new Error(`Target is required for definition at index ${index} (definition: ${JSON.stringify(def)}).`);

            const region = this.getRegion(target);
            region.add(info);
        }
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
    #save({region, info, index}) {
        if (!this.#useStorage || !info) return;
        this.#store.set(`state:${region.target}`, {key: info.key, index});
    }

    #init(region) {
        const saved = this.getSavedState(region);
        const restored = saved && region.get(saved.key);
        if (restored)
            return region.navigate(restored.key, {index: saved.index ?? 0});

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
