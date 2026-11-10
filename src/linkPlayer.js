import {YouTubeProvider} from "./providers/youtube/YouTubeProvider.js";
import {OkruProvider} from "./providers/okru/OkruProvider.js";
import {ProviderRegistry} from "./providers/ProviderRegistry.js";
import {YouTubeDataApi} from "./providers/youtube/YouTubeDataApi.js";
import {YouTubeMetaResolver} from "./providers/youtube/YouTubeMetaResolver.js";
import {resolveScope} from "./utils/dom.js";
import {defaultStore, MemoryStore} from "./storage.js";
import {AUTOPLAY_MODES, isTouch} from "./utils/helpers.js";
import {Emitter} from "./utils/Emitter.js";
import {Tooltip} from "./ui/Tooltip.js";
import {ThumbnailService} from "./ThumbnailService.js";
import {Region} from "./Region.js";
import {applyDefinition, applyItems, resolveDefinition} from "./MetaMerge.js";

const noop = () => {
};

let nextId = 0;

/**
 * Who handles which element. A WeakMap, not an attribute: cloneNode() copies attributes but not listeners,
 * so an attribute would make a cloned link look handled when it is not. data-lp stays as a debugging aid only.
 */
const owners = new WeakMap();

/**
 * Events (lp.on(type, handler); handler gets { type, region, ... }):
 *   "change"  navigation state of a region changed (see Region)
 *   "state"   player state: playing | paused | ended
 *   "error"   anything that failed (a link, a load, a player, metadata); the scan goes on
 *   onChange / onState / onError are shortcuts for the three of them.
 *
 * Metadata, in order: declared on the link (data-*) > `definitions` (code) > YouTube Data API (cached) > "Video 1"...
 *   definitions: { [info.key]: { title, channel, thumbnail } | { videos: [{ id?, title, ... }] } } or (info) => ...
 *   A link may then be only a navigation link (href + data-target).
 *
 * Existing iframes: <iframe data-link data-target="id" src="https://www.youtube.com/embed/..."> inside the target.
 */
export class LinkPlayer {
    #id;
    #scopeEl;
    #isGlobal;
    #useStorage;
    #scanEmbeds;
    #regions = new Map();
    #names = new Map(); // your own keys -> { region, info, data }
    #byInfo = new WeakMap(); // info -> { name, data }: events carry them
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
                    autoScan = true,
                    useStorage = true,
                    tooltip = true,
                    scanEmbeds = true,
                    youtubeApiKey = null,
                    youtubeMeta = null,
                    definitions = null,
                    fallbackTitle = undefined,
                    okruEmbedBaseUrl = null,
                    store = null,
                    registry = null,
                    panelRenderer = null,
                    itemRenderer = null,
                    headerRenderer = null,
                    toggleRenderer = null,
                    groupRenderer = null,
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

        this.#store = store ?? (useStorage ? defaultStore() : new MemoryStore());
        this.#registry = registry ??
            new ProviderRegistry([
                new YouTubeProvider(),
                new OkruProvider({embedBaseUrl: okruEmbedBaseUrl})
            ]);
        this.#thumbnails = thumbnails ?? new ThumbnailService();
        this.#tooltip = tooltip && !isTouch() ? new Tooltip() : null;
        this.#youtubeMeta = youtubeMeta ?? new YouTubeMetaResolver({
            api: youtubeApiKey ? new YouTubeDataApi({apiKey: youtubeApiKey}) : null,
            cache: this.#store,
            fallbackTitle
        });
        this.#panelOptions = {panelRenderer, itemRenderer, headerRenderer, toggleRenderer, groupRenderer};

        this.on("change", onChange);
        this.on("state", onState);
        this.on("error", onError);

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
            resolveMeta: (info) => this.#enrich(info),
            thumbnails: this.#thumbnails,
            ...this.#panelOptions
        });
        region.on("*", (event) => this.#onRegionEvent(event));
        this.#regions.set(target, region);
        return region;
    }

    /** Can be called again after the page changed: links and iframes already handled are skipped. */
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

    // ───────── code-only use (no link at all) ─────────

    /**
     * Defines an info in code, then navigates to it by name: lp.define("intro", {...}); lp.navigate("intro").
     * `url` gives the provider and the ids (video, list of videos, playlist); the rest is metadata.
     * @param {string} name Your own key.
     * @param {object} definition
     * @param {string} definition.url
     * @param {string} definition.target Id of the container.
     * @param {string|boolean} [definition.autoplay]
     * @param {number} [definition.start]
     * @param {string} [definition.title] Single video only.
     * @param {string} [definition.channel]
     * @param {string} [definition.thumbnail]
     * @param {Array<{id?: string, title?: string, channel?: string, thumbnail?: string}>} [definition.videos]
     *   List / playlist: positional for a list of videos; `id` is optional for a playlist (placeholder id).
     * @param {number} [definition.count] Playlist: number of items, without ids or titles.
     * @param {*} [definition.data] Anything you want to find again: it comes back as `event.data` on every
     *   "change" / "state" of this info (description, links, a view model...).
     * @returns the info.
     */
    define(name, {url, target, autoplay, start, title, channel, thumbnail, videos, count, data = null} = {}) {
        if (!name) throw new Error("define(): a name is required");
        if (this.#names.has(name)) throw new Error(`Name '${name}' is already used`);
        if (!url || !target) throw new Error("define(): url and target are required");

        const provider = this.#registry.resolve(url);
        const region = this.getRegion(target);
        const parsed = provider.getInfo({tagName: "A", href: url, dataset: {target, autoplay, start}}); // the parsers only read these
        const info = region.add(parsed) ? parsed : region.get(parsed.key);
        this.#setName(name, region, info, data);
        if (info === parsed) this.#applyDefinition(info, name, {title, channel, thumbnail, videos, count});
        return info;
    }

    /** Navigates to an info by the name given with data-key or define(). */
    navigate(name, options) {
        const entry = this.#names.get(name);
        if (!entry) throw new Error(`Unknown name '${name}'`);
        entry.region.navigate(entry.info, options);
    }

    /** The info known under this name, or null. */
    get(name) {
        return this.#names.get(name)?.info ?? null;
    }

    dispose() {
        this.#names.clear();
        if (this.#scopeEl?.dataset.lpScope === this.#id) delete this.#scopeEl.dataset.lpScope;
        for (const detach of this.#detachers) detach();
        this.#detachers.clear();
        this.#regions.forEach((region) => region.dispose());
        this.#regions.clear();
        this.#tooltip?.dispose();
        this.#events.clear();
    }

    // ───────── internals ─────────

    #register(element) {
        const isIframe = element.tagName === "IFRAME";
        if (isIframe && !this.#scanEmbeds) return;

        const target = element.dataset.target || (isIframe ? element.parentElement?.id : null);
        if (!target) throw new Error("Target required");

        const url = isIframe ? element.src : element.tagName === "A" ? element.href : element.dataset.url;
        if (!url) throw new Error("No URL provided");

        const provider = this.#registry.resolve(url);
        const region = this.getRegion(target);

        const parsed = provider.getInfo(element);
        const info = region.add(parsed) ? parsed : region.get(parsed.key); // same link twice: keep the first object
        const name = element.dataset.key || null; // your own key: lp.navigate(name), definitions[name]
        if (name) this.#setName(name, region, info);
        if (info === parsed) this.#applyDefinition(info, name);

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

        const onClick = (e) => {
            e.preventDefault();
            region.navigate(info, {
                autoplay: info.autoplay === AUTOPLAY_MODES.INIT || info.autoplay === AUTOPLAY_MODES.CLICK,
                index: info.index
            });
        };
        element.addEventListener("click", onClick);

        const detachTip = this.#attachTooltip(element, info, provider);
        this.#detachers.add(() => {
            element.removeEventListener("click", onClick);
            detachTip();
            release();
        });
    }

    #setName(name, region, info, data = null) {
        const known = this.#names.get(name);
        if (known && known.info !== info) throw new Error(`Name '${name}' is already used`);
        this.#names.set(name, {region, info, data});
        this.#byInfo.set(info, {name, data});
    }

    /** `inline` (from define()) first, then the `definitions` option; what is already filled is never overwritten. */
    #applyDefinition(info, name = null, inline = null) {
        try {
            applyDefinition(info, inline);
            applyDefinition(info, resolveDefinition(this.#definitions, info, name));
        } catch (error) {
            this.#events.emit("error", {error, info});
        }
    }

    /** Completes the items of a playlist; called by the region the first time the playlist is shown. */
    async #enrich(info) {
        const items = await this.#youtubeMeta.resolve(info);
        if (!items?.length) return false;
        applyItems(info, items);
        return true;
    }

    /** Forwards the region event, plus the `name` and `data` given to define() for event.info (null when there are none). */
    #onRegionEvent(event) {
        const entry = event.info ? this.#byInfo.get(event.info) : null;
        this.#events.emit(event.type, {...event, name: entry?.name ?? null, data: entry?.data ?? null});
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
        if (restored) return region.navigate(restored, {index: saved.index ?? 0});

        const first = region.infos.find((info) => info.showOnInit);
        if (first) {
            region.navigate(first, {
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

    #attachTooltip(element, info, provider) {
        if (!this.#tooltip) return noop;
        return this.#tooltip.attach(
            element,
            () => this.#thumbnails.resolve(this.#tooltipData(info).thumbnail), // no argument: the tooltip calls it bare
            () => this.#tooltipData(info).title,
            {id: provider.id, name: provider.name ?? provider.id}
        );
    }
}