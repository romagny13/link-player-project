import {PanelRenderer} from "./ui/PanelRenderer.js";
import {NavigationJournal} from "./NavigationJournal.js";
import {Emitter} from "./utils/Emitter.js";

const NO_PARAMS = Object.freeze({});

/**
 * Navigation params are a SNAPSHOT: later changes of the caller's object do not leak into the history,
 * and a hook cannot alter what the next one sees.
 */
const freezeParams = (params) => (params ? Object.freeze({...params}) : NO_PARAMS);

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
    #afterHooks = new Set();
    #from = null;      // the state notified last: the `from` of the next hook call
    #currentBehavior;
    #boundaryBehavior;
    #pending = []; // navigation actions waiting for the container

    /**
     * @param {object} options
     * @param {"toggle"|"skip"|string} [options.currentBehavior] What navigate() does on the info already shown.
     * @param {"stop"|"loop"} [options.boundaryBehavior] What nextInfo() / previousInfo() do at the ends of the
     *   list of infos: "stop" (nothing happens) or "loop" (last -> first, first -> last). Needs 2 infos or more.
     * @param {(info, options: {force: boolean}) => Promise<boolean>|boolean} [options.resolveMeta] Completes the metadata
     *   of an info (items of a playlist, title / channel of a single video...): true when it changed something. Called the
     *   first time each info is shown (force: false) and by refreshMeta(); it decides by itself what is worth fetching.
     */
    constructor({
                    target,
                    registry,
                    currentBehavior = "toggle",
                    boundaryBehavior = "stop",
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
        if (boundaryBehavior !== "stop" && boundaryBehavior !== "loop")
            throw new TypeError(`Invalid boundaryBehavior '${boundaryBehavior}': expected "stop" or "loop".`);
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
        const hasNext = i >= 0 ? i < this.#infos.size - 1 : this.#infos.size > 0;
        return hasNext || this.#canLoop();
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

    /**
     * @param {string} key
     * @param {{autoplay?: boolean, index?: number, params?: object}} [options]
     *   `params`: free data of THIS navigation (who asked, why...). Given to the afterNavigate hooks and
     *   to the "change" event, and kept in the history (back / forward give them again).
     */
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

    /** Like navigate(), but the current history entry is replaced (nothing is added). */
    replace(key, {autoplay = false, index = 0, params} = {}) {
        if (!this.has(key))
            throw new Error(`No info found for key '${key}'`);
        this.#whenReady(() => {
            const info = this.get(key);
            this.#journal.replace({info, index, params: freezeParams(params)});
            this.#show(info, {autoplay, index}, "replace");
        });
    }

    /**
     * Restores a saved state. Unlike navigate(), it never toggles: when the info is already the
     * current one (adopted iframe), only the item may change, with a single command.
     * @returns {boolean} false when the key is unknown (a saved key may have disappeared).
     */
    restore(key, {index = 0, params} = {}) {
        if (!this.has(key)) return false;
        this.#whenReady(() => {
            const info = this.get(key);
            if (this.isCurrent(key)) {
                if (!info.isPlaylist || index === this.currentIndex) return;
                this.#journal.updateCurrent({index});
                this.#select(info, {autoplay: false, index});
                this.#changed("restore");
                return;
            }
            this.#navigate(info, {autoplay: false, index, params}, "restore");
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
        this.#playerIndex = index; // BEFORE the command: a player that answers synchronously (Ok.ru) is then ignored as already known
        this.#player?.playAt(index);
        this.#journal.updateCurrent({index});
        this.#panel.setCurrent(index); // immediate feedback; the player confirms with "itemChange"
        this.#changed("item");
    }

    /**
     * Takes over an iframe that is already in the page (and inside the target): the player drives it
     * and the panel is added for a playlist / list. `info` is parsed from the iframe src.
     */
    adopt(iframe, info, {index = 0, params} = {}) {
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
        this.#journal.push({info, index, params: freezeParams(params)});
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
        this.#afterHooks.clear();
        this.#events.clear();
    }

    // ───────── after-navigation hooks ─────────

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
    afterNavigate(hook, {immediate = false} = {}) {
        if (typeof hook !== "function") throw new TypeError("afterNavigate(): a function is expected");
        this.#afterHooks.add(hook);
        if (immediate) {
            const to = this.#state("immediate");
            if (to) this.#runHook(hook, to, null);
        }
        return () => this.#afterHooks.delete(hook);
    }

    // ───────── metadata ─────────

    /**
     * Completes the metadata (title, description, channel...) of an info, even a single video, then runs the
     * afterNavigate hooks with reason "meta" when something changed. Unlike the automatic call (first display only),
     * it asks again each time it is called.
     * @param {string} [key] Key of the info; the current one by default.
     * @param {{force?: boolean}} [options] force (default true): do not skip an info whose required fields are present.
     * @returns {Promise<boolean>} true when something changed; false too when there is nothing to resolve or it failed.
     */
    refreshMeta(key = this.current?.key, {force = true} = {}) {
        const info = key ? this.get(key) : null;
        if (!info || !this.#resolveMeta) return Promise.resolve(false);
        this.#resolved.add(info);
        return this.#completeMeta(info, {force});
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

    #navigate(info, {autoplay = false, index = 0, params} = {}, reason = "navigate") {
        this.#journal.push({info, index, params: freezeParams(params)});
        this.#show(info, {autoplay, index}, reason);
    }

    /** The history entry carries its params: the hooks get the same ones as the first time. */
    #restore(entry, reason) {
        if (!entry) return false;
        this.#show(entry.info, {autoplay: false, index: entry.index}, reason); // restore the state, do not start playing
        return true;
    }

    #step(delta, options = {}) {
        if (!this.#host) return false;
        const target = this.#stepTarget(delta);
        if (!target) return false;
        this.#navigate(target, {autoplay: true, ...options});
        return true;
    }

    /** The info `delta` (1 or -1) away from the current one; at an end: the other end when looping, else undefined. */
    #stepTarget(delta) {
        const infos = this.infos;
        const next = infos[this.#infoIndex() + delta];
        if (next) return next;
        if (!this.#canLoop()) return undefined;
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

        // teardown of what was shown (another providers, another info): it must never block the new content
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

        this.#playerIndex = index; // BEFORE load(): a player that notifies its item synchronously (Ok.ru) is then ignored
        this.#player.load(info, {autoplay, index});
        const iframe = this.#player.iframe;
        iframe.dataset.lp ||= this.#target; // marks it as ours: the region host must not discover it as a frame to adopt
        if (!iframe.isConnected) this.#host.prepend(iframe); // iframe before the panel (CSS anchoring)

        this.#rendered = info;
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

    /** Metadata may come from an API: what is shown first is drawn again once it is known. Asked once per info. */
    #resolveMetaLater(info) {
        if (!this.#resolveMeta || this.#resolved.has(info)) return;
        this.#resolved.add(info);
        this.#completeMeta(info, {force: false});
    }

    #completeMeta(info, options) {
        return Promise.resolve(this.#resolveMeta(info, options)).then(
            (changed) => {
                if (changed) this.#metaChanged(info);
                return Boolean(changed);
            },
            (error) => {
                this.#fail(error, {info});
                return false;
            }
        );
    }

    #metaChanged(info) {
        if (this.current !== info) return;
        if (info.isPlaylist && this.#player?.iframe) {
            this.#panelInfo = null; // force the redraw
            this.#syncPanel(info, this.#player.iframe, this.currentIndex);
        }
        this.#runAfterHooks("meta"); // `to.item` may have just got its title, channel...
    }

    /** The name of the subscription method differs between players. */
    #subscribe(player) {
        const subscribe = player.subscribe;
        return subscribe.call(player, (e) => this.#onPlayerEvent(e));
    }

    #onPlayerEvent(event) {
        if (event.type === "itemChange") {
            // already known (playAt, select, first notification after a load): no second notification
            if (event.index === this.#playerIndex) return;
            this.#playerIndex = event.index;
            this.#journal.updateCurrent({index: event.index}); // going back restores the item too
            this.#panel.setCurrent(event.index);
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
            params: this.currentParams,
            visible: this.isVisible
        });
        if (reason !== "visibility") this.#runAfterHooks(reason);
    }

    // ───────── hooks (internals) ─────────

    #state(reason) {
        const entry = this.#journal.current;
        if (!entry) return null;
        const {info, index, params} = entry;
        const item = info.isPlaylist ? (info.videos[index] ?? null) : info;
        return Object.freeze({info, index, item, params: params ?? NO_PARAMS, reason});
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
            if (typeof result?.then === "function") {
                result.catch((error) => console.error("[Region] afterNavigate hook failed:", error));
            }
        } catch (error) {
            console.error("[Region] afterNavigate hook failed:", error);
        }
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