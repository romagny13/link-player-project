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
    #regionHost;
    #defaultTarget;
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
                    regionHost = null,
                    defaultTarget = null,
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

        this.#regionHost = regionHost ?? new DefaultRegionHost();
        if (defaultTarget)
            this.#regionHost.setDefaultTarget(defaultTarget);
        this.#defaultTarget = this.#regionHost.defaultTarget;

        // global scope: the document (the host needs a root to query)
        this.#regionHost.init({
            root: this.#scopeEl ?? document,
            onLinkDiscovered: (v) => this.#handleLinkDiscovered(v),
            onTargetDiscovered: (v) => this.#handleTargetDiscovered(v),
            onFrameDiscovered: (v) => this.#handleFrameDiscovered(v)
        });

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

    /**
     * Discovers what is new in the page (links, containers, frames). There is no observer:
     * call it again after the page changed (content added dynamically, a container created later...).
     * It is idempotent: what is already known is not handled twice.
     */
    scan() {
        this.#regionHost.discoverAll();

        for (const region of this.#regions.values()) {
            if (this.#initialized.has(region)) continue; // init once: a second scan must not toggle the region
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
            resolveMeta: (info) => this.#enrich(info),
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
        if (this.#scopeEl?.dataset.lpScope === this.#id)
            delete this.#scopeEl.dataset.lpScope;
        for (const detach of this.#detachers) detach();
        this.#detachers.clear();
        this.#regions.forEach((region) => region.dispose());
        this.#regions.clear();
        this.#regionHost.clear();
        this.#tooltip?.dispose();
        this.#events.clear();
    }

    // ───────── internals ─────────

    #registerDefs(definitions) {
        if (!definitions) return;
        if (!Array.isArray(definitions))
            throw new TypeError(`Invalid definitions: expected an Array, but received type '${typeof definitions}' (${JSON.stringify(definitions)}).`);

        definitions.forEach((def, index) => {
            const provider = def.url
                ? this.#registry.resolve(def.url)
                : this.#registry.get(def.provider);
            const info = provider.getInfoFromDefinition(def);

            const target = def.target;
            if (!target) throw new Error(`Target is required for definition at index ${index} (definition: ${JSON.stringify(def)}).`);

            const region = this.getRegion(target);
            region.add(info);
        });
    }

    /** An element that cannot be handled must not stop the others: the error is reported and the loop goes on. */
    #guard(fn, element = null) {
        try {
            fn();
        } catch (error) {
            this.#events.emit("error", {error, element});
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
        if (!target)
            throw new Error(`Target not provided on ${describe(element)}`);

        const url = element.tagName === "A" ? element.href : element.dataset.url;
        if (!url)
            throw new Error(`Unable to resolve URL on ${describe(element)}`);

        const provider = this.#registry.resolve(url);
        const region = this.getRegion(target);
        // the parsers read the target from data-target: a link that relies on defaultTarget
        // gets it written there (the previous DefaultRegionHost did it in discoverTargets)
        if (!element.dataset.target) element.dataset.target = target;
        const parsed = provider.getInfoFromLink(element);
        const key = parsed.key;
        // region.add() returns a boolean: the info to use is the one the region holds for this key
        // (a definition added before, or the first link with the same key)
        region.add(parsed);
        const info = region.get(key);

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

    #handleTargetDiscovered(targets) {
        for (const [target, element] of targets) {
            this.#guard(() => this.getRegion(target).register(element), element);
        }
    }

    #handleFrameDiscovered(elements) {
        if (!this.#scanEmbeds) return;
        for (const element of elements) {
            if (element.dataset.lp) continue; // ours (created by a region) or already adopted
            this.#guard(() => this.#bindFrame(element), element);
        }
    }

    #bindFrame(element) {
        const src = element.src;
        if (!src) return; // nothing to adopt (yet)

        let provider;
        try {
            provider = this.#registry.resolve(src);
        } catch {
            return; // an iframe that is not an embed of a known provider: not our business
        }
        if (!provider) return;

        const host = element.parentElement;
        if (!host)
            throw new Error(`No parent element for ${describe(element)} (detached from the DOM?)`);
        // the parent of the iframe is its container: it gets an id when it has none
        const target = (host.id ||= `host:${crypto.randomUUID()}`);

        const parsed = provider.getInfoFromFrame(element);
        const region = this.getRegion(target);
        region.adopt(element, parsed);

        element.dataset.lp = this.#id;
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

/** `<iframe#main>`: what `${element}` should have shown instead of "[object HTMLIFrameElement]". */
function describe(el) {
    if (!el) return String(el);
    return `<${el.localName ?? typeof el}${el.id ? `#${el.id}` : ""}>`;
}


/**
 * Discovers links, target containers and frames in a root and reports the NEW ones.
 * No observer: discovery happens when discoverAll() is called (LinkPlayer.scan()), and what is
 * not found yet (a container created later...) is looked up again on the next call.
 */
export class DefaultRegionHost {
    #registeredLinks = new Map();   // element -> url
    #registeredTargets = new Map(); // target id -> container
    #registeredFrames = new Set();
    #defaultTarget = null;
    #root = null;
    #onLinkDiscovered = null;
    #onFrameDiscovered = null;
    #onTargetDiscovered = null

    init({root, onLinkDiscovered = null, onFrameDiscovered = null, onTargetDiscovered = null}) {
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

            // keyed by element: two links to the same url are two links
            if (href && !this.#registeredLinks.has(element)) {
                this.#registeredLinks.set(element, href);
                newLinks.push(element);
            }
        }

        if (newLinks.length > 0) this.#onLinkDiscovered?.(newLinks);
    }

    discoverTargets() {
        const wanted = new Set();
        if (this.#defaultTarget) wanted.add(this.#defaultTarget);
        for (const link of this.#registeredLinks.keys()) {
            const target = link.dataset.target || this.#defaultTarget; // the element is not modified
            if (target) wanted.add(target);
        }

        const newTargets = new Map();
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

        for (const element of frameElements) {
            if (!this.#registeredFrames.has(element)) {
                this.#registeredFrames.add(element);
                newFrames.push(element);
            }
        }

        if (newFrames.length > 0) this.#onFrameDiscovered?.(newFrames);
    }

    clear() {
        this.#registeredLinks.clear();
        this.#registeredTargets.clear();
        this.#registeredFrames.clear();
        this.#defaultTarget = null;
    }

    // ───────── internals ─────────

    /** Elements removed from the page are forgotten, so they are discovered again if they come back. */
    #forget(elements, remove) {
        for (const el of [...elements]) if (!el.isConnected) remove(el);
    }

    /** `getElementById` only exists on a document / shadow root; a scope is an element. */
    #findById(id) {
        return typeof this.#root.getElementById === "function"
            ? this.#root.getElementById(id)
            : this.#root.querySelector(`#${CSS.escape(id)}`);
    }
}