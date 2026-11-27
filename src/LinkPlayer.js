import {resolveScope} from "./utils/dom.js";
import {AUTOPLAY_MODES, isTouch, describe} from "./utils/helpers.js";
import {Emitter} from "./utils/Emitter.js";
import {isClaimed} from "./utils/ownership.js";
import {defaultStore, MemoryStore} from "./storage.js";
import {RegionHost} from "./RegionHost.js";
import {RegionCatalog} from "./RegionCatalog.js";
import {CommandBinder} from "./views/CommandBinder.js";
import {Region} from "./Region.js";
import {ViewFactory} from "./views/ViewFactory.js";
import {MetaService} from "./MetaService.js";
import {SingleActiveAdapter} from "./adapters/SingleActiveAdapter.js";
import {FormatBehavior} from "./behaviors/FormatBehavior.js";
import {MuteBehavior} from "./behaviors/MuteBehavior.js";
import {PanelBehavior} from "./behaviors/PanelBehavior.js";
import {MetaBehavior} from "./behaviors/MetaBehavior.js";
import {ActiveLinkBehavior} from "./behaviors/ActiveLinkBehavior.js";
import {PersistenceBehavior} from "./behaviors/PersistenceBehavior.js";
import {ProviderRegistry} from "./providers/ProviderRegistry.js";
import {YouTubeProvider} from "./providers/youtube/YouTubeProvider.js";
import {OkruProvider} from "./providers/okru/OkruProvider.js";
import {YouTubeDataApi} from "./providers/youtube/YouTubeDataApi.js";
import {YouTubeMetaResolver} from "./providers/youtube/YouTubeMetaResolver.js";
import {PanelRenderer} from "./ui/PanelRenderer.js";
import {Tooltip} from "./ui/Tooltip.js";
import {ThumbnailService} from "./ui/ThumbnailService.js";

let scopeCounter = 0;

function scopeLabel(scope, el) {
    if (typeof scope === "string") return scope;
    return el.id || `el${++scopeCounter}`;
}

const noop = () => {
};

/**
 * ROLE: composition root + facade. It builds the parts, wires them, and is the ONE place that decides
 * "is this element already handled?" (utils/ownership.js) before turning what RegionHost found into
 * regions, infos and commands. It holds no navigation logic (Region), no DOM discovery (RegionHost),
 * no layout (adapter).
 */
export class LinkPlayer {
    #id;
    #root;
    #isGlobal;
    #scanEmbeds;
    #defaultTarget;
    #definitions;
    #host;
    #catalog;
    #binder = new CommandBinder();
    #registry;
    #store;
    #persistence;
    #meta;
    #views;
    #tooltip;
    #thumbnails;
    #regionOptions;
    #panelOptions;
    #activeClass;
    #activeWhenPlaying;
    #events = new Emitter();
    #initialized = new WeakSet();
    #detachers = new Set();

    constructor({
                    scope = null,
                    definitions = null,
                    autoScan = true,
                    useStorage = true,
                    tooltip = true,
                    currentBehavior = "toggle",
                    boundaryBehavior = "stop",
                    scanEmbeds = true,
                    activeClass = "is-active",
                    activeWhenPlaying = false,
                    youtubeApiKey = null,
                    youtubeMeta = null,
                    youtubeMetaScope = "playlists",
                    youtubeMetaRequired = undefined,
                    fallbackTitle = undefined,
                    okruEmbedBaseUrl = null,
                    store = null,
                    registry = null,
                    regionHost = null,
                    defaultTarget = null,
                    panelOptions = {},
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
        this.#root = resolveScope(scope);
        this.#isGlobal = this.#root === null;
        this.#id = this.#isGlobal ? "lp-global" : `lp-${scopeLabel(scope, this.#root)}`;
        this.#scanEmbeds = scanEmbeds;
        this.#defaultTarget = defaultTarget;
        this.#definitions = definitions;
        this.#activeClass = activeClass;
        this.#activeWhenPlaying = activeWhenPlaying;

        this.#store = store ?? (useStorage ? defaultStore() : new MemoryStore());
        this.#persistence = new PersistenceBehavior({store: this.#store, enabled: useStorage});
        this.#registry = registry ?? new ProviderRegistry([
            new YouTubeProvider(),
            new OkruProvider({embedBaseUrl: okruEmbedBaseUrl})
        ]);
        this.#views = new ViewFactory(this.#registry);
        this.#host = regionHost ?? new RegionHost();
        this.#catalog = new RegionCatalog({create: (name) => this.#createRegion(name)});

        this.#thumbnails = thumbnails ?? new ThumbnailService();
        this.#tooltip = tooltip && !isTouch() ? new Tooltip(tooltipRenderer) : null;
        this.#meta = new MetaService({
            scope: youtubeMetaScope,
            youtube: youtubeMeta ?? new YouTubeMetaResolver({
                api: youtubeApiKey ? new YouTubeDataApi({apiKey: youtubeApiKey}) : null,
                cache: this.#store,
                fallbackTitle,
                required: youtubeMetaRequired
            })
        });

        this.#regionOptions = {currentBehavior, boundaryBehavior};
        this.#panelOptions = {panelOptions, itemRenderer, headerRenderer, toggleRenderer, groupRenderer};

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

    get regions() {
        return this.#catalog.regions;
    }

    on(type, handler) {
        return this.#events.on(type, handler);
    }

    off(type, handler) {
        this.#events.off(type, handler);
    }

    getRegion(name) {
        return this.#catalog.get(name);
    }

    // facade: the same words as the region, by name
    navigate(name, key, options) {
        return this.getRegion(name).navigate(key, options);
    }

    nextInfo(name, options) {
        return this.getRegion(name).nextInfo(options);
    }

    previousInfo(name, options) {
        return this.getRegion(name).previousInfo(options);
    }

    /** Asks the metadata of an info again (e.g. after the API key changed). */
    async refreshMeta(name, key = this.getRegion(name).current?.key, {force = true} = {}) {
        const region = this.getRegion(name);
        const info = key ? region.get(key) : null;
        if (!info) return false;
        const changed = await this.#meta.ensure(info, {force});
        if (changed && region.isCurrent(key)) region.notify("meta");
        return changed;
    }

    /**
     * Looks at the page and handles what is not handled yet (links, regions, iframes).
     * No observer: call it again after the page changed. It can be called any number of times.
     */
    scan() {
        const found = this.#host.discover(this.#root ?? document, {
            defaultTarget: this.#defaultTarget,
            // regions that exist without a link (definitions, getRegion()) are looked up by id too
            targets: this.#catalog.regions.map((region) => region.name)
        });

        for (const link of found.links)
            if (!isClaimed(link.element)) this.#guard(() => this.#bindLink(link), link.element);

        for (const {name, element} of found.regions)
            this.#guard(() => this.#catalog.bind(name, element), element); // idempotent

        if (this.#scanEmbeds)
            for (const frame of found.frames)
                if (!isClaimed(frame)) this.#guard(() => this.#bindFrame(frame), frame);

        this.#catalog.refresh();

        for (const region of this.#catalog.regions) {
            if (!this.#initialized.has(region)) {
                this.#initialized.add(region);
                this.#guard(() => this.#init(region));
            } else {
                region.notify("immediate"); // new triggers may need their active class
            }
        }
    }

    dispose() {
        for (const detach of this.#detachers) detach();
        this.#detachers.clear();
        this.#binder.dispose();
        this.#catalog.dispose();
        this.#tooltip?.dispose();
        this.#events.clear();
    }

    // ───────── wiring ─────────

    #createRegion(name) {
        const region = new Region({
            name,
            adapter: new SingleActiveAdapter(),
            views: this.#views,
            ...this.#regionOptions
        });
        const {panelOptions, itemRenderer, headerRenderer, toggleRenderer, groupRenderer} = this.#panelOptions;

        region.use(new FormatBehavior())
            .use(new MetaBehavior({ meta: this.#meta }))
            .use(new MuteBehavior())
            .use(new PanelBehavior({ panel: new PanelRenderer(panelOptions, itemRenderer, headerRenderer, toggleRenderer, groupRenderer, this.#thumbnails) }))
            .use(this.#persistence); // one instance, shared: it keeps one subscription per region

        if (this.#activeClass)
            region.use(new ActiveLinkBehavior({binder: this.#binder, activeClass: this.#activeClass, whenPlaying: this.#activeWhenPlaying}));
        region.on("*", (event) => this.#events.emit(event.type, event));
        return region;
    }

    /** An element that cannot be handled must not stop the others: the error is reported and the loop goes on. */
    #guard(fn, element = null) {
        try {
            fn();
        } catch (error) {
            this.#events.emit("error", {error, element});
        }
    }

    #registerDefs(definitions) {
        if (!definitions) return;
        if (!Array.isArray(definitions))
            throw new TypeError(`Invalid definitions: expected an Array, but received type '${typeof definitions}' (${JSON.stringify(definitions)}).`);

        definitions.forEach((def, index) => {
            const provider = def.url ? this.#registry.resolve(def.url) : this.#registry.get(def.provider);
            const target = (def.target ||= this.#defaultTarget);
            if (!target) throw new Error(`Target is required for definition at index ${index} (definition: ${JSON.stringify(def)}).`);
            this.getRegion(target).add(provider.getInfoFromDefinition(def));
        });
    }

    #bindLink({element, url, target: linkTarget}) {
        const target = linkTarget ?? this.#defaultTarget;
        if (!target) throw new Error(`Target not provided on ${describe(element)}`);

        const provider = this.#registry.resolve(url);
        const region = this.getRegion(target);
        // the parsers read the target from data-target
        if (!element.dataset.target) element.dataset.target = target;

        // a definition (or an earlier link) with the same key wins: the region returns the info it holds
        const info = region.add(provider.getInfoFromLink(element));
        const autoplay = info.autoplay === AUTOPLAY_MODES.INIT || info.autoplay === AUTOPLAY_MODES.CLICK;

        if (!this.#binder.bind(element, region, info.key, {autoplay, index: info.index})) return;

        if (this.#tooltip) {
            const current = () => region.get(info.key) ?? info;
            this.#detachers.add(this.#tooltip.attach(
                element,
                () => this.#thumbnails.resolve(tooltipData(current()).thumbnail),
                () => tooltipData(current()).title,
                {id: provider.id, name: provider.name ?? provider.id}
            ));
        }
    }

    #bindFrame(frame) {
        if (!frame.src) return; // nothing to adopt (yet)
        let provider;
        try {
            provider = this.#registry.resolve(frame.src);
        } catch {
            return; // not an embed of a known provider: not our business
        }
        const host = frame.parentElement;
        if (!host) throw new Error(`No parent element for ${describe(frame)} (detached from the DOM?)`);

        // the parent of the iframe is its region element: it is named after its id / data-region
        const name = this.#catalog.nameOf(host) ?? (host.dataset.region ||= host.id || `host:${crypto.randomUUID()}`);
        const region = this.#catalog.bind(name, host);
        region.adopt(frame, provider.getInfoFromFrame(frame));
    }

    #init(region) {
        if (this.#persistence.restore(region)) return;
        const first = region.infos.find((info) => info.showOnInit);
        if (first && !region.isCurrent(first.key))
            region.navigate(first.key, {autoplay: first.autoplay === AUTOPLAY_MODES.INIT, index: first.index});
    }
}

/** Values are read when the tooltip opens, so what the API or the definitions filled in later is used. */
function tooltipData(info) {
    const first = info.isPlaylist ? info.videos[0] : info;
    return {title: first?.title ?? "", thumbnail: first?.thumbnail || null};
}
