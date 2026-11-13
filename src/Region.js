import {PanelRenderer} from "./ui/PanelRenderer.js";
import {NavigationJournal} from "./NavigationJournal.js";
import {Emitter} from "./utils/Emitter.js";

export class Region {
    #target;
    #host = null; // container (html element); null until it is discovered
    #registry;
    #infos = new Map();
    #journal = new NavigationJournal();
    #events = new Emitter();
    #panel;
    #player = null;
    #unsubscribe = null;
    #rendered = null;  // the info the current iframe shows
    #playerIndex = 0;  // the item the player is on
    #panelInfo = null; // the playlist the panel is drawn for
    #resolveMeta;
    #resolved = new WeakSet();
    #dependentViews = new Map();
    #currentBehavior;
    #pending = []; // navigation actions waiting for the container

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
        this.#target = target;
        this.#host = document.getElementById(target); // may be null: it will be registered when discovered
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

    // ───────── container ─────────

    /** The container has been discovered: runs the navigation actions that were waiting for it. */
    register(host) {
        if (this.#host !== host) {
            // another element replaces the previous container: what was drawn in it is gone
            if (this.#host) this.#resetContent();
            this.#host = host;
        }
        this.#flushPending();
    }

    hasPending() {
        return this.#pending.length > 0;
    }

    // ───────── navigation ─────────

    isCurrent(key) {
        const info = this.get(key);
        return !!(info && this.#journal.current?.info === info);
    }

    navigate(key, options) {
        if (!this.has(key))
            throw new Error(`No info found for key '${key}'`);
        this.#whenReady(() => {
            if (this.isCurrent(key)) {
                if (this.#currentBehavior === "skip") return;
                if (this.#currentBehavior === "toggle") return this.toggle();
            }
            this.#navigate(this.get(key), options);
        });
    }

    replace(key, {autoplay = false, index = 0} = {}) {
        if (!this.has(key))
            throw new Error(`No info found for key '${key}'`);
        this.#whenReady(() => {
            const info = this.get(key);
            this.#journal.replace({info, index});
            this.#show(info, {autoplay, index}, "replace");
        });
    }

    goBack() {
        if (!this.#host) return false;
        return this.#restore(this.#journal.back(), "back");
    }

    goForward() {
        if (!this.#host) return false;
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
        this.#playerIndex = index;
        this.#journal.updateCurrent({index});
        this.#panel.setCurrent(index); // immediate feedback; the player confirms with "itemChange"
        this.#changed("item");
    }

    /**
     * Takes over an iframe that is already in the page (and inside the target): the player drives it
     * and the panel is added for a playlist / list. `info` is parsed from the iframe src.
     */
    adopt(iframe, info, {index = 0} = {}) {
        // the parent of the iframe is its container: usable even when the target was not discovered yet
        if (!this.#host) this.register(iframe.parentElement);
        // iframe region == region with single info
        if (!this.#host.contains(iframe)) throw new Error(`The iframe is not inside #${this.#target}`);
        this.add(info);
        info = this.get(info.key); // the canonical info (the one already known for this key)
        this.#disposePlayer();
        this.#panelInfo = null; // drawn again against the adopted iframe
        this.#player = this.#registry.get(info.provider).createPlayer({iframe});
        this.#unsubscribe = this.#subscribe(this.#player);
        this.#rendered = info;
        this.#playerIndex = index;
        this.#journal.push({info, index});
        this.#syncPanel(info, iframe, index);
        this.#changed("adopt");
        this.#resolveMetaLater(info);
    }

    // ───────── visibility ─────────

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

    /** Runs now when the container is known, otherwise when it is registered. */
    #whenReady(action) {
        if (this.#host) return action();
        this.#pending.push(action);
    }

    #flushPending() {
        if (!this.#host || !this.#pending.length) return;
        const actions = this.#pending.splice(0);
        for (const action of actions) {
            try {
                action();
            } catch (error) {
                this.#fail(error);
            }
        }
    }

    #infoIndex() {
        return this.infos.indexOf(this.current);
    }

    #navigate(info, {autoplay = false, index = 0} = {}) {
        this.#journal.push({info, index});
        this.#show(info, {autoplay, index}, "navigate");
    }

    #restore(entry, reason) {
        if (!entry) return false;
        this.#show(entry.info, {autoplay: false, index: entry.index}, reason); // restore the state, do not start playing
        return true;
    }

    #step(delta) {
        if (!this.#host) return false;
        const target = this.infos[this.#infoIndex() + delta];
        if (!target) return false;
        this.#navigate(target, {autoplay: true});
        return true;
    }

    /**
     * The frame is rewritten ONLY when the info changes (another video, another video list, another
     * playlist). Same info, other item of the list / playlist: a single command to the existing player.
     */
    #show(info, {autoplay, index}, reason) {
        try {
            if (this.#player && this.#rendered === info) this.#select(info, {autoplay, index});
            else this.#render(info, {autoplay, index});
            this.#host.hidden = false;
        } catch (error) {
            this.#fail(error, {info});
            return;
        }
        this.#changed(reason);
        this.#resolveMetaLater(info);
    }

    #render(info, {autoplay, index}) {
        const provider = this.#registry.get(info.provider);

        // teardown of what was shown (another provider, another info): it must never block the new content
        const previous = this.#player?.iframe;
        this.#disposePlayer();
        try {
            previous?.remove();
        } catch (error) {
            console.warn("[Region] unable to remove the previous iframe", error);
        }
        this.#panelInfo = null; // the panel is anchored to the previous iframe: always drawn again
        this.#panel.clear();

        this.#player = provider.createPlayer();
        this.#unsubscribe = this.#subscribe(this.#player);

        this.#player.load(info, {autoplay, index});
        const iframe = this.#player.iframe;
        iframe.dataset.lp ||= this.#target; // marks it as ours: the region host must not discover it as a frame to adopt
        if (!iframe.isConnected) this.#host.prepend(iframe); // iframe before the panel (CSS anchoring)

        this.#rendered = info;
        this.#playerIndex = index;
        this.#syncPanel(info, iframe, index);
    }

    /** Same info: no new frame, only a command. */
    #select(info, {autoplay, index}) {
        if (info.isPlaylist && index !== this.#playerIndex) {
            this.#playerIndex = index;
            if (this.#player.selectItem) this.#player.selectItem(info, index, {autoplay});
            else this.#player.playAt(index);
            this.#panel.setCurrent(index);
        } else if (autoplay) {
            this.#player.play?.();
        }
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

    /** The name of the subscription method differs between players. */
    #subscribe(player) {
        const subscribe = player.subscribe;
        return subscribe.call(player, (e) => this.#onPlayerEvent(e));
    }

    #onPlayerEvent(event) {
        if (event.type === "itemChange") {
            this.#playerIndex = event.index;
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
            visible: this.isVisible
        });
    }

    #fail(error, context = {}) {
        const handled = this.#events.emit("error", {region: this, error, ...context});
        if (!handled) console.error("[Region]", error);
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
}