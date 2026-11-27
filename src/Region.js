import {NavigationJournal} from "./NavigationJournal.js";
import {Emitter} from "./utils/Emitter.js";
import {claim, release} from "./utils/ownership.js";
import {itemCountOf, toIndex} from "./utils/items.js";

/** Navigation params are a SNAPSHOT: later changes of the caller's object do not leak into the history. */
const freezeParams = (params) => (params ? Object.freeze({...params}) : NO_PARAMS);
/** A navigation requested before the element exists keeps its autoplay only if the element comes soon. */
const DEFERRED_AUTOPLAY_MS = 2000;
const SILENT_REASONS = new Set(["meta", "immediate"]);

const NO_PARAMS = Object.freeze({});
const NO_SOUND = Object.freeze({muted: null, volume: null});   // + ici, hors de la classe

/**
 * ROLE: a named place of the page that shows ONE info at a time (single active region).
 * It owns: the infos (by key), the journal, the active view, the hooks and the behaviors.
 * It does NOT touch the DOM (the adapter does), does not know providers (the view factory does), and does not
 * fetch metadata, draw the panel or save anything (behaviors do, through afterNavigate).
 *
 * "Two times" life: a region exists without its element. navigate() then only moves the journal; when attach()
 * gives the element, the region shows its CURRENT state (the last navigation, not all of them).
 *
 * afterNavigate(hook) is the extension point. A hook receives a context (frozen):
 *   { region, info, index, item, params, reason, view }
 *   reason: "navigate" | "replace" | "back" | "forward" | "restore" | "adopt" | "attach" | "detach"
 *           | "item" (the item changed) | "meta" (metadata arrived) | "immediate"
 *   view: the active MediaView, null when the region has no element / nothing shown.
 *   and as 2nd argument, the context the previous call received (`from`), or null.
 *
 * Events: "change" (context, not for meta / immediate), "state" { state, index }, "error" { error }
 */
export class Region {
    #name;
    #adapter;
    #views;
    #currentBehavior;
    #boundary;
    #infos = new Map();
    #journal = new NavigationJournal();
    #events = new Emitter();
    #hooks = new Set();
    #behaviors = [];
    #element = null;
    #view = null;
    #viewInfo = null;
    #unsubscribe = null;
    #observed = 0;       // the item the view is on (requested or announced)
    #playerState = null;
    #deferred = null;    // { at } : autoplay requested while there was no element
    #from = null;
    #sound = NO_SOUND;

    /**
     * @param {object} options
     * @param {ContentAdapter} options.adapter  How views are laid out in the element.
     * @param {ViewFactory} options.views       Info -> view.
     * @param {"toggle"|"skip"|"playPause"} [options.currentBehavior] What activate() does on the info already shown.
     * @param {"stop"|"loop"} [options.boundaryBehavior] What nextInfo() / previousInfo() do at the ends (loop needs 2 infos).
     */
    constructor({name, adapter, views, currentBehavior = "toggle", boundaryBehavior = "stop"}) {
        if (boundaryBehavior !== "stop" && boundaryBehavior !== "loop")
            throw new TypeError(`Invalid boundaryBehavior '${boundaryBehavior}': expected "stop" or "loop".`);
        this.#name = name;
        this.#adapter = adapter;
        this.#views = views;
        this.#currentBehavior = currentBehavior;
        this.#boundary = boundaryBehavior;
    }

    // ───────── state ─────────

    get name() {
        return this.#name;
    }

    get element() {
        return this.#element;
    }

    get view() {
        return this.#view;
    }

    get infos() {
        return Object.freeze([...this.#infos.values()]);
    }

    get current() {
        return this.#journal.current?.info ?? null;
    }

    get currentIndex() {
        const entry = this.#journal.current;
        return entry?.info.isPlaylist ? entry.index : 0;
    }

    get currentParams() {
        return this.#journal.current?.params ?? NO_PARAMS;
    }

    get itemCount() {
        return itemCountOf(this.current);
    }

    get playerState() {
        return this.#playerState;
    }

    get isVisible() {
        return this.#adapter.visible;
    }

    get canMute() { return this.#view?.canMute ?? false; }

    get muted() {
        return this.#sound.muted;
    }                       // null si inconnu
    get volume() {
        return this.#sound.volume;
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
        return this.current?.isPlaylist === true && this.currentIndex > 0;
    }

    get canGoNextItem() {
        const count = this.itemCount;
        return this.current?.isPlaylist === true && (count === null || this.currentIndex < count - 1);
    }

    has(key) {
        return this.#infos.has(key);
    }

    get(key) {
        return this.#infos.get(key);
    }

    isCurrent(key) {
        const info = this.#infos.get(key);
        return Boolean(info) && this.current === info;
    }

    /** The current state as a hook context, or null when nothing was navigated to yet. */
    context(reason = "immediate") {
        const entry = this.#journal.current;
        if (!entry) return null;
        const {info, params} = entry;
        const index = info.isPlaylist ? entry.index : 0;
        const item = info.isPlaylist ? (info.videos[index] ?? null) : info;
        const view = this.#viewInfo === info ? this.#view : null;
        return Object.freeze({region: this, info, index, item, params: params ?? NO_PARAMS, reason, view});
    }

    // ───────── events, hooks, behaviors ─────────

    on(type, handler) {
        return this.#events.on(type, handler);
    }

    off(type, handler) {
        this.#events.off(type, handler);
    }

    /**
     * `hook(context, from)` is called after each navigation (once the view follows it).
     * @param {{immediate?: boolean}} [options] immediate: also called now, for the current state.
     * @returns {() => void} unsubscribe
     */
    afterNavigate(hook, {immediate = false} = {}) {
        this.#hooks.add(hook);
        if (immediate) {
            const ctx = this.context("immediate");
            if (ctx) this.#callHook(hook, ctx, this.#from);
        }
        return () => this.#hooks.delete(hook);
    }

    /** A behavior is `{ attach(region), dispose?(region) }`: it lives as long as the region and only uses the public API. */
    use(behavior) {
        this.#behaviors.push(behavior);
        behavior.attach(this);
        return this;
    }

    /** Something outside changed what the hooks show (metadata arrived, a trigger was added...). */
    notify(reason = "immediate") {
        this.#changed(reason);
    }

    report(error, context = {}) {
        const handled = this.#events.emit("error", {region: this, error, ...context});
        if (!handled) console.warn(`[Region ${this.#name}]`, error);
    }

    // ───────── infos ─────────

    /** A key is unique: the first info added wins. @returns the info the region holds for this key. */
    add(info) {
        if (!this.#infos.has(info.key)) this.#infos.set(info.key, info);
        return this.#infos.get(info.key);
    }

    // ───────── element ─────────

    /** The element is there (again): the region shows its current state in it. */
    attach(element) {
        if (this.#element === element) return;
        if (this.#element) this.detach();
        this.#element = element;
        this.#adapter.attach(element);
        if (!this.#journal.current) return;
        const deferred = this.#deferred;
        this.#deferred = null;
        const autoplay = deferred !== null && Date.now() - deferred.at <= DEFERRED_AUTOPLAY_MS;
        this.#reconcile(autoplay);
        this.#changed("attach");
    }

    /** The element left: the view goes, the state stays. */
    detach() {
        if (!this.#element) return;
        this.#dropView();
        this.#adapter.detach();
        this.#element = null;
        this.#changed("detach");
    }

    /** Takes over an iframe already in the element (its parent): the region shows it as the current info. */
    adopt(iframe, info, {index = 0, params} = {}) {
        if (!this.#element || iframe.parentElement !== this.#element)
            throw new Error(`Region '${this.#name}': an adopted iframe must be a child of the region element`);
        const held = this.add(info);
        const view = this.#views.adopt(iframe, held);
        this.#dropView();
        this.#journal.push({info: held, index: toIndex(index), params: freezeParams(params)});
        this.#view = view;
        this.#viewInfo = held;
        this.#observed = toIndex(index);
        this.#unsubscribe = view.subscribe((event) => this.#onViewEvent(view, event));
        this.#adapter.adopt(view);
        claim(iframe, this);
        this.#changed("adopt");
    }

    // ───────── navigation ─────────

    /** Always moves the state, even toward the current info (what a click on the current one does is activate()). */
    navigate(key, {index, params, autoplay = false} = {}, reason = "navigate") {
        const info = this.#need(key);
        this.#journal.push({info, index: toIndex(index), params: freezeParams(params)});
        this.#commit(reason, autoplay);
    }

    /** Like navigate(), the current entry is replaced (nothing is added to the history). */
    replace(key, {index, params, autoplay = false} = {}) {
        const info = this.#need(key);
        this.#journal.replace({info, index: toIndex(index), params: freezeParams(params)});
        this.#commit("replace", autoplay);
    }

    /**
     * Restores a saved state: never plays. @returns {boolean} false when the key is unknown (it may have disappeared).
     */
    restore(key, {index, params} = {}) {
        const info = this.#infos.get(key);
        if (!info) return false;
        const i = toIndex(index);
        if (this.isCurrent(key)) {
            if (!info.isPlaylist || i === this.currentIndex) return true;
            this.#journal.updateCurrent({index: i});
        } else {
            this.#journal.push({info, index: i, params: freezeParams(params)});
        }
        this.#commit("restore", false);
        return true;
    }

    /** The entry point of a control (a link): applies the currentBehavior when the info is already the shown one. */
    activate(key, options = {}) {
        if (this.isCurrent(key) && this.#view) {
            if (this.#currentBehavior === "skip") return false;
            if (this.#currentBehavior === "playPause") {
                this.#playerState === "playing" ? this.pause() : this.play();
                return true;
            }
            if (this.#currentBehavior === "toggle") {
                if (this.isVisible) this.hide();
                else {
                    this.show();
                    if (options.autoplay) this.play();
                }
                return true;
            }
        }
        this.navigate(key, options);
        return true;
    }

    back() {
        return this.#journal.back() ? (this.#commit("back", false), true) : false;
    }

    forward() {
        return this.#journal.forward() ? (this.#commit("forward", false), true) : false;
    }

    nextInfo(options) {
        return this.#step(1, options);
    }

    previousInfo(options) {
        return this.#step(-1, options);
    }

    nextItem() {
        if (!this.#view || !this.canGoNextItem) return false;
        this.#view.next();
        return true;
    }

    previousItem() {
        if (!this.#view || !this.canGoPreviousItem) return false;
        this.#view.previous();
        return true;
    }

    /** Another item of the current list (asked by the caller or by the panel). */
    selectItem(index, {autoplay = true} = {}) {
        if (!this.current?.isPlaylist) return false;
        this.#journal.updateCurrent({index: toIndex(index)});
        this.#commit("item", autoplay);
        return true;
    }

    // ───────── controls (on the view) ─────────

    play() {
        if (!this.#view) return;
        this.#view.play();
        this.#assumeState("playing");
    }

    pause() {
        if (!this.#view) return;
        this.#view.pause();
        this.#assumeState("paused");
    }

    seekTo(seconds, {play = true} = {}) {
        if (!this.#view) return;
        this.#view.seekTo(seconds, {play});
        if (play) this.#assumeState("playing");
    }

    show() {
        this.#adapter.setVisible(true);
    }

    hide() {
        if (!this.#element) return;
        this.pause();
        this.#adapter.setVisible(false);
    }

    toggle() {
        this.isVisible ? this.hide() : this.show();
    }

    mute() {
        this.#view?.mute();
    }

    unmute() {
        this.#view?.unmute();
    }

    toggleMute() {
        this.muted ? this.unmute() : this.mute();
    }

    setVolume(volume) {
        this.#view?.setVolume(Math.min(1, Math.max(0, Number(volume) || 0)));
    }

    dispose() {
        this.detach();
        for (const behavior of this.#behaviors) behavior.dispose?.(this);
        this.#behaviors.length = 0;
        this.#hooks.clear();
        this.#events.clear();
    }

    // ───────── internals ─────────

    #need(key) {
        const info = this.#infos.get(key);
        if (!info) throw new Error(`No info found for key '${key}' in region '${this.#name}'`);
        return info;
    }

    #infoIndex() {
        return this.infos.indexOf(this.current);
    }

    #canLoop() {
        return this.#boundary === "loop" && this.#infos.size > 1;
    }

    #step(delta, options = {}) {
        const infos = this.infos;
        let target = infos[this.#infoIndex() + delta];
        if (!target && this.#canLoop()) target = infos.at(delta > 0 ? 0 : -1);
        if (!target) return false;
        this.navigate(target.key, {autoplay: true, ...options});
        return true;
    }

    #commit(reason, autoplay) {
        if (this.#element) this.#reconcile(autoplay);
        else this.#deferred = autoplay ? {at: Date.now()} : null;
        this.#changed(reason);
    }

    /** Makes the view follow the journal: another info = a new view, same info = one command. */
    #reconcile(autoplay) {
        const entry = this.#journal.current;
        if (!entry || !this.#element) return;
        const {info} = entry;
        const index = info.isPlaylist ? entry.index : 0;
        try {
            if (this.#view && this.#viewInfo === info) this.#select(info, index, autoplay);
            else this.#render(info, index, autoplay);
            this.#adapter.setVisible(true);
        } catch (error) {
            this.report(error, {info});
        }
    }

    #select(info, index, autoplay) {
        if (info.isPlaylist && index !== this.#observed) {
            this.#observed = index; // BEFORE the command: a view that answers at once is then ignored as already known
            this.#view.selectItem(info, index, {autoplay});
        } else if (autoplay) {
            this.#view.play();
        }
    }

    #render(info, index, autoplay) {
        const view = this.#views.create(info);
        const previous = {view: this.#view, info: this.#viewInfo, off: this.#unsubscribe};

        // the new view is current BEFORE load(): a view that announces its item at once is then handled as expected
        this.#view = view;
        this.#viewInfo = info;
        this.#observed = index;
        this.#playerState = null;
        this.#sound = NO_SOUND;
        this.#unsubscribe = view.subscribe((event) => this.#onViewEvent(view, event));
        try {
            view.load(info, {autoplay, index});
            this.#adapter.place(view);
        } catch (error) { // the previous view stays as it was
            this.#unsubscribe();
            view.dispose();
            this.#view = previous.view;
            this.#viewInfo = previous.info;
            this.#unsubscribe = previous.off;
            throw error;
        }
        claim(view.root, this);
        this.#retire(previous.view, previous.off);
    }

    /** Detaches and disposes a view that is no longer the active one (the adapter already replaced its root). */
    #retire(view, off) {
        if (!view) return;
        try {
            off?.();
            if (view.root) release(view.root, this);
            view.dispose();
        } catch (error) {
            console.warn(`[Region ${this.#name}] a view failed to dispose`, error);
        }
    }

    /** No view anymore: its root is removed (when we created it). The fields are cleared FIRST. */
    #dropView() {
        const view = this.#view;
        const unsubscribe = this.#unsubscribe;
        this.#view = null;
        this.#viewInfo = null;
        this.#unsubscribe = null;
        this.#playerState = null;
        this.#sound = NO_SOUND;
        this.#adapter.clear();
        this.#retire(view, unsubscribe);
    }

    /** What a view says about its item is OBSERVED, what the caller asks is REQUESTED; only here an announced item is believed. */
    #onViewEvent(view, event) {
        if (view !== this.#view) return;
        if (event.type === "itemChange") {
            const count = itemCountOf(this.#viewInfo);
            const i = event.index;
            // not a position of THIS list (-1, or beyond it): the view does not know its list yet, believe nothing
            if (!Number.isInteger(i) || i < 0 || (count !== null && i >= count)) return;
            if (i === this.#observed) return; // already known (requested, or first notification after a load)
            this.#observed = i;
            this.#journal.updateCurrent({index: i});
            this.#changed("item");
        } else if (event.type === "state") {
            this.#playerState = event.state;
            this.#events.emit("state", {region: this, state: event.state, index: event.index ?? this.currentIndex});
        } else if (event.type === "sound") {
            this.#sound = {
                muted: event.muted ?? this.#sound.muted,
                volume: event.volume ?? this.#sound.volume
            };
            this.#events.emit("sound", {region: this, ...this.#sound});
        } else if (event.type === "error") {
            this.report(event.error);
        }
    }

    #assumeState(state) {
        if (this.#playerState === state) return;
        this.#playerState = state;
        this.#events.emit("state", {region: this, state, index: this.currentIndex});
    }

    #changed(reason) {
        const ctx = this.context(reason);
        if (!ctx) return; // nothing navigated to yet: nothing to tell
        this.#runHooks(ctx);
        if (!SILENT_REASONS.has(reason)) this.#events.emit("change", ctx);
    }

    #runHooks(ctx) {
        const from = this.#from;
        this.#from = ctx;
        for (const hook of [...this.#hooks]) this.#callHook(hook, ctx, from);
    }

    /** A failing hook must not stop the others (nor the navigation). */
    #callHook(hook, ctx, from) {
        try {
            hook(ctx, from);
        } catch (error) {
            this.report(error, {hook});
        }
    }
}
