import {PanelRenderer} from "./ui/PanelRenderer.js";
import {NavigationJournal} from "./NavigationJournal.js";
import {Emitter} from "./utils/Emitter.js";

/**
 * A target container: owns ONE player (one iframe), ONE panel and the navigation journal.
 *
 * Navigation, three levels:
 *   journal   goBack() / goForward()                         between the states visited with navigate()
 *   region    nextInfo() / previousInfo()                    between the infos of the region (order of the links)
 *   item      nextItem() / previousItem() / playAt(i)       inside the active playlist / list (delegated to the player)
 *
 * Events (region.on(type, handler), handler gets { type, region, ... }):
 *   "change"  { reason, info, index, params, visible }  navigation state changed. reason: navigate | back | forward | item | visibility | adopt
 *             params: what was given to navigate(info, { params }), null otherwise.
 *   "state"   { state, index }                  player state: playing | paused | ended
 *   "error"   { error, info? }                  anything that failed (load, player, metadata)
 * The `can*` getters give the enabled / disabled state of the matching controls; read them on "change".
 */
export class Region {
    #target;
    #host;
    #registry;
    #infos = new Map();
    #journal = new NavigationJournal();
    #events = new Emitter();
    #panel;
    #player = null;
    #unsubscribe = null;
    #panelInfo = null; // the playlist the panel is drawn for
    #resolveMeta;
    #resolved = new WeakSet();
    #dependentViews = new Map();
    #currentBehavior;

    /**
     * @param {object} options
     * @param {(info) => Promise<boolean>|boolean} [options.resolveMeta] Completes the items of a playlist (true when it changed something).
     */
    constructor({
                    target,
                    registry,
                    currentBehavior = "toggle",
                    resolveMeta = null,
                    panelRenderer = null,
                    itemRenderer = null,
                    headerRenderer = null,
                    toggleRenderer = null,
                    groupRenderer = null,
                    thumbnails = null
                }) {
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

    // ───────── state ─────────

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

    // ───────── events ─────────

    on(type, handler) {
        return this.#events.on(type, handler);
    }

    off(type, handler) {
        this.#events.off(type, handler);
    }

    // ───────── infos ─────────

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

    // ───────── navigation ─────────

    isCurrent(key) {
        const info = this.get(key);
        return !!(info && this.#journal.current?.info === info);
    }

    /** Navigating to the info that is already current toggles the view instead (no new journal entry). */
    navigate(key, options) {
        if (!this.has(key))
            throw new Error(`No info found for key '${key}'`);
        if (this.isCurrent(key)) {
            if (this.#currentBehavior === "skip") return;
            if (this.#currentBehavior === "toggle") return this.toggle();
        }
        const info = this.get(key);
        this.#navigate(info,options);
    }

    #navigate(info, {autoplay = false, index = 0, params = null} = {}) {
        this.#journal.push({info, index, params}); // params are kept in the journal: back / forward restore them
        this.#show(info, {autoplay, index}, "navigate");
    }

    replace(key, {autoplay = false, index = 0, params = null} = {}) {
        if (!this.has(key))
            throw new Error(`No info found for key '${key}'`);
        const info = this.get(key);
        this.#journal.replace({info, index, params});
        this.#show(info, {autoplay, index}, "replace");
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
        this.#journal.updateCurrent({index});
        this.#panel.setCurrent(index); // immediate feedback; the player confirms with "itemChange"
        this.#changed("item");
    }

    /**
     * Takes over an iframe that is already in the page (and inside the target): the player drives it
     * and the panel is added for a playlist / list. `info` is parsed from the iframe src.
     */
    adopt(iframe, info, {index = 0} = {}) {
        if (!this.#host.contains(iframe)) throw new Error(`The iframe is not inside #${this.#target}`);
        this.add(info);
        this.#disposePlayer();
        this.#player = this.#registry.get(info.provider).createPlayer({iframe});
        this.#unsubscribe = this.#player.subscribe((e) => this.#onPlayerEvent(e));
        this.#journal.push({info, index});
        this.#syncPanel(info, iframe, index);
        this.#changed("adopt");
        this.#resolveMetaLater(info);
    }

    // ───────── visibility ─────────

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

    // ───────── dependent Views ─────────

    hasDependentView(id) {
        return this.#dependentViews.has(id);
    }

    registerDependentView(id, fn) {
        if (this.hasDependentView(id)) {
            throw new Error(`Duplicate dependent view ID: '${id}' is already registered.`);
        }
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
        for (const [id, fn] of this.#dependentViews) {
            try {
                fn(info);
            } catch (error) {
                console.error(`Error processing dependent view '${id}':`, error);
            }
        }
    }

    // ───────── internals ─────────

    #infoIndex() {
        return this.infos.indexOf(this.current);
    }

    #restore(entry, reason) {
        if (!entry) return false;
        this.#show(entry.info, {autoplay: false, index: entry.index}, reason); // restore the state, do not start playing
        return true;
    }

    #step(delta) {
        const target = this.infos[this.#infoIndex() + delta];
        if (!target) return false;
        this.#navigate(target, {autoplay: true});
        return true;
    }

    #show(info, {autoplay, index}, reason) {
        try {
            const provider = this.#registry.get(info.provider);

            // one iframe per region: replaced only when the provider changes
            if (this.#player?.kind !== provider.id) {
                const previous = this.#player?.iframe; // an adopted iframe is not removed by the player
                this.#disposePlayer();
                previous?.remove();
                this.#player = provider.createPlayer();
                this.#unsubscribe = this.#player.subscribe((e) => this.#onPlayerEvent(e));
            }

            this.#player.load(info, {autoplay, index});
            const iframe = this.#player.iframe;
            if (!iframe.isConnected) this.#host.prepend(iframe); // iframe before the panel (CSS anchoring)
            this.#host.hidden = false;

            this.#syncPanel(info, iframe, index);
        } catch (error) {
            this.#fail(error, {info});
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
        Promise.resolve(this.#resolveMeta(info)).then(
            (changed) => {
                if (!changed || this.current !== info || !this.#player?.iframe) return;
                this.#panelInfo = null; // force the redraw
                this.#syncPanel(info, this.#player.iframe, this.currentIndex);
            },
            (error) => this.#fail(error, {info})
        );
    }

    #onPlayerEvent(event) {
        if (event.type === "itemChange") {
            this.#journal.updateCurrent({index: event.index}); // going back restores the item too
            this.#panel.setCurrent(event.index);
            this.notifyDependentViews(this.current);
            this.#changed("item");
        } else if (event.type === "state") {
            this.#events.emit("state", {region: this, state: event.state, index: event.index ?? this.currentIndex});

        } else if (event.type === "error") {
            this.#fail(event.error, {info: this.current});
        }
    }

    #changed(reason) {
        this.#events.emit("change", {
            region: this,
            reason,
            info: this.current,
            index: this.currentIndex,
            params: this.#journal.current?.params ?? null,
            visible: this.isVisible
        });
    }

    #fail(error, context = {}) {
        const handled = this.#events.emit("error", {region: this, error, ...context});
        if (!handled) console.error("[Region]", error);
    }

    #disposePlayer() {
        this.#unsubscribe?.();
        this.#player?.dispose();
        this.#unsubscribe = null;
        this.#player = null;
    }
}